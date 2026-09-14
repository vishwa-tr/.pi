import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
	chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync,
	renameSync, rmSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { WorkspaceFiles, hash } from "../extensions/swarm/workspace-files.mjs";
import { SwarmError } from "../extensions/swarm/state.mjs";
import { repository } from "./helpers.mjs";

function rejects(code, action) {
	assert.throws(action, error => error instanceof SwarmError && error.code === code);
}
function fixture(t, content = "alpha beta gamma\n") {
	const root = repository(t);
	writeFileSync(join(root, "source.txt"), content);
	return { root, files: new WorkspaceFiles(root) };
}
function git(root, ...args) {
	return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

test("canonical paths and immutable content fingerprints", t => {
	const { root, files } = fixture(t);
	assert.equal(files.path("./source.txt"), "source.txt");
	assert.equal(files.path(join(root, "source.txt")), "source.txt");
	assert.equal(files.path("new/./file.txt"), "new/file.txt");
	const first = files.read("source.txt");
	assert.deepEqual(first, { path: "source.txt", content: "alpha beta gamma\n", fingerprint: first.fingerprint });
	assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
	assert.deepEqual(files.read("source.txt"), first);
	first.content = "caller change";
	assert.equal(files.read("source.txt").content, "alpha beta gamma\n");
	assert.equal(hash("hello"), hash(Buffer.from("hello")));
});

test("multi-edit matches the original text, not prior replacements", t => {
	const { files } = fixture(t);
	const original = files.read("source.txt");
	const changed = files.edit("source.txt", [
		{ oldText: "gamma", newText: "alpha" },
		{ oldText: "alpha", newText: "beta" },
		{ oldText: "beta", newText: "longer" },
	], original.fingerprint);
	assert.equal(changed.content, "beta longer alpha\n");
	assert.notEqual(changed.fingerprint, original.fingerprint);
	assert.deepEqual(changed, files.read("source.txt"));
});

test("adjacent matches and deletions are valid", t => {
	const { files } = fixture(t, "abc");
	const changed = files.edit("source.txt", [
		{ oldText: "a", newText: "" }, { oldText: "bc", newText: "z" },
	], files.read("source.txt").fingerprint);
	assert.equal(changed.content, "z");
});

test("invalid edits do not change any original bytes", t => {
	const { root, files } = fixture(t, "alpha beta gamma");
	const initial = files.read("source.txt");
	const cases = [
		["INPUT", []],
		["INPUT", [{ oldText: "", newText: "x" }]],
		["INPUT", [{ oldText: "alpha", newText: 3 }]],
		["INPUT", [{ oldText: "alpha", newText: "x", extra: true }]],
		["NOT_FOUND", [{ oldText: "alpha", newText: "x" }, { oldText: "missing", newText: "x" }]],
		["AMBIGUOUS", [{ oldText: "alpha beta", newText: "x" }, { oldText: "beta", newText: "y" }]],
		["AMBIGUOUS", [{ oldText: "alpha", newText: "x" }, { oldText: "alpha", newText: "y" }]],
	];
	for (const [code, edits] of cases) {
		rejects(code, () => files.edit("source.txt", edits, initial.fingerprint));
		assert.deepEqual(files.read("source.txt"), initial);
		assert.equal(readFileSync(join(root, "source.txt"), "utf8"), initial.content);
	}
});

test("repeated and self-overlapping matches are ambiguous", t => {
	const { files } = fixture(t, "aaaa");
	for (const oldText of ["a", "aa", "aaa"]) {
		rejects("AMBIGUOUS", () => files.edit("source.txt", [{ oldText, newText: "x" }], files.read("source.txt").fingerprint));
	}
	assert.equal(files.read("source.txt").content, "aaaa");
});

test("write truncates through the checked handle and preserves executable mode", t => {
	const { root, files } = fixture(t);
	chmodSync(join(root, "source.txt"), 0o751);
	const original = files.read("source.txt");
	const updated = files.write("source.txt", "ok", original.fingerprint);
	assert.equal(updated.content, "ok");
	assert.equal(lstatSync(join(root, "source.txt")).mode & 0o7777, 0o751);
	assert.equal(files.write("source.txt", "", updated.fingerprint).content, "");
});

test("same-length external edits are stale even when mtime is restored", t => {
	const { root, files } = fixture(t, "first");
	const original = files.read("source.txt");
	const stat = lstatSync(join(root, "source.txt"));
	writeFileSync(join(root, "source.txt"), "other");
	utimesSync(join(root, "source.txt"), stat.atime, stat.mtime);
	rejects("STALE", () => files.write("source.txt", "lost", original.fingerprint));
	rejects("STALE", () => files.edit("source.txt", [{ oldText: "first", newText: "lost" }], original.fingerprint));
	assert.equal(files.read("source.txt").content, "other");
});

test("mode, ctime, and inode changes invalidate file fingerprints", t => {
	const { root, files } = fixture(t);
	const initial = files.read("source.txt");
	chmodSync(join(root, "source.txt"), 0o600);
	rejects("STALE", () => files.write("source.txt", "changed", initial.fingerprint));
	const beforeRewrite = files.read("source.txt");
	writeFileSync(join(root, "source.txt"), beforeRewrite.content);
	assert.notEqual(files.read("source.txt").fingerprint, beforeRewrite.fingerprint);
	const beforeReplace = files.read("source.txt");
	writeFileSync(join(root, "replacement.txt"), beforeReplace.content, { mode: 0o600 });
	renameSync(join(root, "replacement.txt"), join(root, "source.txt"));
	rejects("STALE", () => files.write("source.txt", "changed", beforeReplace.fingerprint));
	assert.equal(files.read("source.txt").content, initial.content);
});

test("missing leaves carry fingerprints and can create checked parent directories", t => {
	const { root, files } = fixture(t);
	const missing = files.read("new/deep/file.txt");
	assert.equal(missing.content, null);
	assert.deepEqual(files.read("new/deep/file.txt"), missing);
	assert.equal(existsSync(join(root, "new")), false);
	const created = files.write("new/deep/file.txt", "new bytes", missing.fingerprint);
	assert.equal(created.content, "new bytes");
	assert.deepEqual(files.read("new/deep/file.txt"), created);
	rejects("STALE", () => files.write("new/deep/file.txt", "lost", missing.fingerprint));
});

test("concurrent creation of a missing file or parent invalidates the read", t => {
	const { root, files } = fixture(t);
	const missing = files.read("new.txt");
	writeFileSync(join(root, "new.txt"), "user bytes");
	rejects("STALE", () => files.write("new.txt", "lost", missing.fingerprint));
	assert.equal(files.read("new.txt").content, "user bytes");
	const missingParent = files.read("new/child/file.txt");
	mkdirSync(join(root, "new"));
	rejects("STALE", () => files.write("new/child/file.txt", "lost", missingParent.fingerprint));
	assert.equal(existsSync(join(root, "new/child")), false);
});

test("replaced parent identities stale existing and missing file reads", t => {
	const { root, files } = fixture(t);
	mkdirSync(join(root, "parent"));
	writeFileSync(join(root, "parent/file.txt"), "user bytes");
	const existing = files.read("parent/file.txt");
	const missing = files.read("parent/new.txt");
	renameSync(join(root, "parent"), join(root, "old-parent"));
	mkdirSync(join(root, "parent"));
	// Keep the file inode; only its parent directory changed.
	renameSync(join(root, "old-parent/file.txt"), join(root, "parent/file.txt"));
	rejects("STALE", () => files.write("parent/file.txt", "lost", existing.fingerprint));
	rejects("STALE", () => files.write("parent/new.txt", "lost", missing.fingerprint));
	assert.equal(files.read("parent/file.txt").content, "user bytes");
});

test("fingerprints are required, path-bound, and edit cannot create a file", t => {
	const { root, files } = fixture(t);
	const original = files.read("source.txt");
	writeFileSync(join(root, "other.txt"), original.content);
	rejects("INPUT", () => files.write("source.txt", "lost"));
	rejects("INPUT", () => files.write("source.txt", Buffer.from("lost"), original.fingerprint));
	rejects("STALE", () => files.write("other.txt", "lost", original.fingerprint));
	const missing = files.read("absent/file.txt");
	rejects("NOT_FOUND", () => files.edit(missing.path, [{ oldText: "x", newText: "y" }], missing.fingerprint));
	assert.equal(existsSync(join(root, "absent")), false);
});

test("outside, traversal, and control components are rejected", t => {
	const { root, files } = fixture(t);
	for (const path of ["../escape", `${root}-alias/file`, root, ".", "x/../../escape", "x/../source.txt",
		".git/config", "nested/.git/HEAD", ".swarms/state", "nested/.swarms/state", ".git/../source.txt"]) {
		rejects("PATH", () => files.path(path));
	}
	for (const path of ["", null, "bad\0name", "bad\\name"]) rejects("INPUT", () => files.path(path));
	const protectedFiles = new WorkspaceFiles(root, { protectedPaths: ["private", "source.txt"] });
	for (const path of ["private", "private/child", "source.txt", ".git/HEAD"]) rejects("PATH", () => protectedFiles.read(path));
	assert.equal(protectedFiles.path("private-other/file"), "private-other/file");
});

test("symlink leaves, dangling links, and parent aliases cannot be used", t => {
	const { root, files } = fixture(t);
	const outside = repository(t);
	writeFileSync(join(outside, "user.txt"), "external bytes");
	mkdirSync(join(root, "real"));
	writeFileSync(join(root, "real/file.txt"), "internal bytes");
	symlinkSync("source.txt", join(root, "alias.txt"));
	symlinkSync("missing", join(root, "dangling.txt"));
	symlinkSync("real", join(root, "parent-alias"));
	symlinkSync(outside, join(root, "outside"));
	for (const path of ["alias.txt", "dangling.txt", "parent-alias/file.txt", "parent-alias/new/file.txt", "outside/user.txt"]) {
		rejects("PATH", () => files.path(path));
		rejects("PATH", () => files.read(path));
		rejects("PATH", () => files.write(path, "lost", "0".repeat(64)));
	}
	assert.equal(readFileSync(join(outside, "user.txt"), "utf8"), "external bytes");
	const before = files.read("real/file.txt");
	renameSync(join(root, "real"), join(root, "moved"));
	symlinkSync("moved", join(root, "real"));
	rejects("PATH", () => files.write(before.path, "lost", before.fingerprint));
	assert.equal(readFileSync(join(root, "moved/file.txt"), "utf8"), "internal bytes");
});

test("hardlinks and unsupported special targets fail closed without touching bytes", t => {
	const { root, files } = fixture(t);
	const initial = files.read("source.txt");
	linkSync(join(root, "source.txt"), join(root, "alias.txt"));
	for (const path of ["source.txt", "alias.txt"]) {
		rejects("PATH", () => files.read(path));
		rejects("PATH", () => files.write(path, "lost", initial.fingerprint));
	}
	rejects("PATH", () => files.snapshot());
	assert.equal(readFileSync(join(root, "source.txt"), "utf8"), initial.content);
	rmSync(join(root, "alias.txt"));
	mkdirSync(join(root, "directory"));
	rejects("PATH", () => files.read("directory"));
	execFileSync("mkfifo", [join(root, "pipe")]);
	rejects("PATH", () => files.read("pipe"));
	rejects("PATH", () => files.snapshot());
});

test("workspace root replacement or aliasing invalidates every operation", t => {
	const { root, files } = fixture(t);
	const original = files.read("source.txt");
	const moved = `${root}-moved`;
	t.after(() => rmSync(moved, { recursive: true, force: true }));
	renameSync(root, moved);
	mkdirSync(root);
	writeFileSync(join(root, "source.txt"), "replacement bytes");
	for (const action of [() => files.path("source.txt"), () => files.read("source.txt"),
		() => files.write("source.txt", "lost", original.fingerprint), () => files.snapshot()]) rejects("PATH", action);
	assert.equal(readFileSync(join(root, "source.txt"), "utf8"), "replacement bytes");
	rmSync(root, { recursive: true });
	symlinkSync(moved, root);
	rejects("PATH", () => new WorkspaceFiles(root));
	rejects("PATH", () => files.read("source.txt"));
});

test("snapshots include tracked, untracked, ignored, and binary file drift", t => {
	const { root, files } = fixture(t);
	writeFileSync(join(root, ".gitignore"), "/.swarms/\nignored.txt\n");
	git(root, "add", "source.txt", ".gitignore");
	let prior = files.snapshot();
	assert.equal(files.snapshot(), prior);
	for (const [path, bytes] of [["source.txt", "tracked drift"], ["new.txt", "untracked"],
		["ignored.txt", "ignored"], ["binary.dat", Buffer.from([0, 255, 128])]]) {
		writeFileSync(join(root, path), bytes);
		const next = files.snapshot();
		assert.notEqual(next, prior);
		assert.equal(files.snapshot(), next);
		prior = next;
	}
	rmSync(join(root, "new.txt"));
	assert.notEqual(files.snapshot(), prior);
});

test("snapshots detect index bytes and branch/ref drift without changing source or index", t => {
	const { root, files } = fixture(t);
	const beforeIndex = files.snapshot();
	git(root, "add", "source.txt");
	const index = readFileSync(join(root, ".git/index"));
	const indexed = files.snapshot();
	assert.notEqual(indexed, beforeIndex);
	git(root, "symbolic-ref", "HEAD", "refs/heads/another");
	const branched = files.snapshot();
	assert.notEqual(branched, indexed);
	writeFileSync(join(root, ".git/refs/heads/another"), `${"1".repeat(40)}\n`);
	const referenced = files.snapshot();
	assert.notEqual(referenced, branched);
	writeFileSync(join(root, ".git/packed-refs"), `${"2".repeat(40)} refs/heads/packed\n`);
	assert.notEqual(files.snapshot(), referenced);
	assert.deepEqual(readFileSync(join(root, ".git/index")), index);
	assert.equal(files.read("source.txt").content, "alpha beta gamma\n");
});

test("coordination and volatile Git internals do not invalidate snapshots", t => {
	const { root, files } = fixture(t);
	const initial = files.snapshot();
	mkdirSync(join(root, ".swarms"));
	writeFileSync(join(root, ".swarms/state"), "coordination one");
	writeFileSync(join(root, ".git/FETCH_HEAD"), "volatile fetch metadata");
	writeFileSync(join(root, ".git/index.lock"), "temporary lock");
	writeFileSync(join(root, ".git/config"), "unrelated config metadata");
	assert.equal(files.snapshot(), initial);
	writeFileSync(join(root, ".swarms/state"), "coordination two");
	assert.equal(files.snapshot(), initial);
});

test("snapshot hashes symlink values without following outside targets", t => {
	const { root, files } = fixture(t);
	const outside = repository(t);
	writeFileSync(join(outside, "file"), "outside bytes");
	symlinkSync(outside, join(root, "link"));
	symlinkSync(".", join(root, "cycle"));
	const initial = files.snapshot();
	writeFileSync(join(outside, "file"), "outside changed");
	assert.equal(files.snapshot(), initial);
	rmSync(join(root, "link"));
	symlinkSync("missing-target", join(root, "link"));
	assert.notEqual(files.snapshot(), initial);
});

test("snapshots resolve linked-worktree gitdir and commondir files without Git commands", t => {
	const { root, files } = fixture(t);
	const control = repository(t);
	const gitRoot = join(control, "worktree-metadata");
	mkdirSync(gitRoot);
	writeFileSync(join(gitRoot, "HEAD"), "ref: refs/heads/main\n");
	writeFileSync(join(gitRoot, "commondir"), "../.git\n");
	rmSync(join(root, ".git"), { recursive: true });
	writeFileSync(join(root, ".git"), `gitdir: ${gitRoot}\n`);
	const initial = files.snapshot();
	writeFileSync(join(control, ".git/refs/heads/main"), `${"3".repeat(40)}\n`);
	assert.notEqual(files.snapshot(), initial);
	const referenced = files.snapshot();
	writeFileSync(join(gitRoot, "index"), "index bytes");
	assert.notEqual(files.snapshot(), referenced);
});

function interceptMutationOpen(t, target, beforeOpen, action) {
	const open = fs.openSync;
	let intercepted = false;
	t.mock.method(fs, "openSync", (path, flags, ...rest) => {
		if (path === target && (flags & fs.constants.O_RDWR) && !intercepted) {
			intercepted = true;
			beforeOpen();
		}
		return open(path, flags, ...rest);
	});
	syncBuiltinESMExports();
	try { action(); }
	finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
	assert.equal(intercepted, true);
}

test("an external change immediately before mutation open is rejected on the handle", t => {
	const { root, files } = fixture(t, "first");
	const initial = files.read("source.txt");
	const target = join(root, "source.txt");
	interceptMutationOpen(t, target, () => writeFileSync(target, "other"), () => {
		rejects("STALE", () => files.write("source.txt", "lost", initial.fingerprint));
	});
	assert.equal(readFileSync(target, "utf8"), "other");
});

test("NOFOLLOW prevents a last-moment leaf symlink from changing another file", t => {
	const { root, files } = fixture(t);
	const initial = files.read("source.txt");
	const target = join(root, "source.txt");
	writeFileSync(join(root, "user.txt"), "user bytes");
	interceptMutationOpen(t, target, () => {
		rmSync(target);
		symlinkSync("user.txt", target);
	}, () => rejects("PATH", () => files.write("source.txt", "lost", initial.fingerprint)));
	assert.equal(readFileSync(join(root, "user.txt"), "utf8"), "user bytes");
});

test("O_EXCL preserves a file created immediately before mutation open", t => {
	const { root, files } = fixture(t);
	const initial = files.read("new.txt");
	const target = join(root, "new.txt");
	interceptMutationOpen(t, target, () => writeFileSync(target, "user bytes"), () => {
		rejects("STALE", () => files.write("new.txt", "lost", initial.fingerprint));
	});
	assert.equal(readFileSync(target, "utf8"), "user bytes");
});

test("snapshot fails closed on filenames that cannot be represented losslessly", t => {
	const { root, files } = fixture(t);
	writeFileSync(Buffer.concat([Buffer.from(`${root}/`), Buffer.from([0xff])]), "user bytes");
	rejects("PATH", () => files.snapshot());
});

test("exact text edits fail closed on invalid UTF-8 rather than replacing user bytes", t => {
	const { root, files } = fixture(t);
	const bytes = Buffer.from([0xff, 0x61, 0x62]);
	writeFileSync(join(root, "source.txt"), bytes);
	const initial = files.read("source.txt");
	rejects("INPUT", () => files.edit("source.txt", [{ oldText: "ab", newText: "cd" }], initial.fingerprint));
	assert.deepEqual(readFileSync(join(root, "source.txt")), bytes);
});
