import {
	chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync,
	readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { prepareLaunchCheckout } from "../extensions/swarm/launch-setup.mjs";

function fixture(t, { repository = false, ignore } = {}) {
	const root = mkdtempSync(join(tmpdir(), "swarm-setup-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (repository) git("init", "--quiet");
	if (ignore !== undefined) writeFileSync(join(root, ".gitignore"), ignore);
	const prompts = []; const notices = []; const answers = [];
	const controller = new AbortController();
	const ctx = { cwd: root, mode: "tui", hasUI: true, ui: {
		confirm: async (title, message, options) => { prompts.push({ title, message, options }); return answers.shift() ?? false; },
		notify: text => notices.push(text),
	} };
	const assertCurrent = () => { if (controller.signal.aborted) throw Object.assign(new Error("Cancelled"), { code: "OWNERSHIP" }); };
	return { root, git, ctx, prompts, notices, answers, controller,
		run: () => prepareLaunchCheckout(ctx, { signal: controller.signal, assertCurrent }) };
}

test("declining Git initialization leaves an ordinary folder byte-for-byte untouched", async t => {
	const f = fixture(t); writeFileSync(join(f.root, "source.txt"), "keep\n");
	assert.equal(await f.run(), false);
	assert.deepEqual(readdirSync(f.root), ["source.txt"]);
	assert.equal(readFileSync(join(f.root, "source.txt"), "utf8"), "keep\n");
	assert.match(f.prompts[0].message, /No files will be staged/);
	assert.ok(f.prompts[0].message.includes(JSON.stringify(f.root)));
});

for (const original of [undefined, "", "# keep", "# keep\n", "# keep\r\nother\r\n"]) {
	test(`approved setup preserves ignore bytes and newline style: ${JSON.stringify(original)}`, async t => {
		const f = fixture(t, { ignore: original });
		writeFileSync(join(f.root, "source.txt"), "unchanged");
		if (original !== undefined) chmodSync(join(f.root, ".gitignore"), 0o640);
		f.answers.push(true, true);
		assert.equal(await f.run(), true);
		const newline = original?.includes("\r\n") ? "\r\n" : "\n";
		const separator = original && !original.endsWith("\n") ? newline : "";
		assert.equal(readFileSync(join(f.root, ".gitignore"), "utf8"), `${original ?? ""}${separator}/.swarms/${newline}`);
		if (original !== undefined) assert.equal(lstatSync(join(f.root, ".gitignore")).mode & 0o777, 0o640);
		assert.equal(readFileSync(join(f.root, "source.txt"), "utf8"), "unchanged");
		assert.equal(f.git("ls-files"), "");
		assert.throws(() => f.git("rev-parse", "--verify", "HEAD"));
		f.git("check-ignore", "-q", "--", ".swarms/probe/events.jsonl");
		assert.equal(existsSync(join(f.root, ".swarms")), false);
		assert.ok(f.notices.every(text => /remain/.test(text)));
		assert.equal(f.prompts.length, 2);
	});
}

test("declining ignore setup preserves an existing repository and staged work", async t => {
	const f = fixture(t, { repository: true, ignore: "# retain\n" });
	f.git("add", ".gitignore");
	const index = readFileSync(join(f.root, ".git/index"));
	assert.equal(await f.run(), false);
	assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
	assert.equal(readFileSync(join(f.root, ".gitignore"), "utf8"), "# retain\n");
	assert.equal(f.prompts.length, 1);
});

test("declining second setup step retains explicitly approved Git initialization only", async t => {
	const f = fixture(t); f.answers.push(true, false);
	assert.equal(await f.run(), false);
	assert.deepEqual(readdirSync(f.root), [".git"]);
});

test("an already excluded empty checkout needs no setup confirmation", async t => {
	const f = fixture(t, { repository: true, ignore: "/.swarms/\n" });
	assert.equal(await f.run(), true);
	assert.equal(f.prompts.length, 0);
});

for (const step of [1, 2]) {
	test(`cancellation during confirmation ${step} prevents all subsequent changes`, async t => {
		const f = fixture(t); let calls = 0;
		f.ctx.ui.confirm = async () => { if (++calls === step) f.controller.abort(); return true; };
		await assert.rejects(f.run(), { code: "OWNERSHIP" });
		assert.equal(existsSync(join(f.root, ".git")), step === 2);
		assert.equal(existsSync(join(f.root, ".gitignore")), false);
		assert.equal(existsSync(join(f.root, ".swarms")), false);
	});
}

test("root mismatch never initializes a nested repository or writes parent rules", async t => {
	const f = fixture(t, { repository: true });
	const nested = join(f.root, "nested"); mkdirSync(nested); f.ctx.cwd = nested;
	await assert.rejects(f.run(), error => error.code === "SETUP" && /checkout root/.test(error.message));
	assert.deepEqual(readdirSync(nested), []);
	assert.equal(existsSync(join(f.root, ".gitignore")), false);
	assert.equal(f.prompts.length, 0);
});

test("tracked runtime state fails without changing the index or files", async t => {
	const f = fixture(t, { repository: true }); mkdirSync(join(f.root, ".swarms"));
	writeFileSync(join(f.root, ".swarms/evidence"), "retain"); f.git("add", ".swarms");
	const index = readFileSync(join(f.root, ".git/index"));
	await assert.rejects(f.run(), /already tracked/);
	assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
	assert.equal(readFileSync(join(f.root, ".swarms/evidence"), "utf8"), "retain");
	assert.equal(f.prompts.length, 0);
});

for (const kind of ["symlink", "hardlink", "directory", "nul", "encoding"]) {
	test(`unsafe root ignore ${kind} is refused without following or replacing it`, async t => {
		const f = fixture(t, { repository: true }); const target = join(f.root, ".gitignore");
		writeFileSync(join(f.root, "source"), "keep");
		if (kind === "symlink") symlinkSync("source", target);
		if (kind === "hardlink") linkSync(join(f.root, "source"), target);
		if (kind === "directory") mkdirSync(target);
		if (kind === "nul") writeFileSync(target, Buffer.from([0]));
		if (kind === "encoding") writeFileSync(target, Buffer.from([255]));
		const stat = lstatSync(target);
		await assert.rejects(f.run(), { code: "SETUP" });
		assert.equal(lstatSync(target).ino, stat.ino);
		assert.equal(readFileSync(join(f.root, "source"), "utf8"), "keep");
		assert.equal(f.prompts.length, 0);
	});
}

test("ignore edits made while consent is pending are never overwritten", async t => {
	const f = fixture(t, { repository: true, ignore: "original\n" });
	f.ctx.ui.confirm = async () => { writeFileSync(join(f.root, ".gitignore"), "user edit\n"); return true; };
	await assert.rejects(f.run(), /changed during confirmation/);
	assert.equal(readFileSync(join(f.root, ".gitignore"), "utf8"), "user edit\n");
	assert.equal(readdirSync(f.root).some(name => name.endsWith(".tmp")), false);
});

test("broken Git metadata is not mistaken for an uninitialized project", async t => {
	const f = fixture(t); symlinkSync("missing-metadata", join(f.root, ".git"));
	await assert.rejects(f.run(), { code: "SETUP" });
	assert.equal(f.prompts.length, 0);
	assert.ok(lstatSync(join(f.root, ".git")).isSymbolicLink());
});

test("missing Git reports a fixed actionable error without raw cwd or command output", async t => {
	const f = fixture(t); const before = process.env.PATH;
	process.env.PATH = f.root;
	try {
		await assert.rejects(f.run(), error => error.code === "SETUP" && /Git is not available/.test(error.message) && !error.message.includes(f.root));
	} finally { process.env.PATH = before; }
	assert.deepEqual(readdirSync(f.root), []);
});


test("a real worktree root is recognized without initializing nested metadata", async t => {
	const f = fixture(t, { repository: true });
	f.git("-c", "user.name=Fixture", "-c", "user.email=noreply@example.com", "commit", "--allow-empty", "-qm", "Fixture");
	const worktree = join(f.root, "linked");
	f.git("worktree", "add", "--quiet", "--detach", worktree);
	f.ctx.cwd = worktree; f.answers.push(true);
	assert.equal(await f.run(), true);
	assert.ok(lstatSync(join(worktree, ".git")).isFile());
	assert.match(f.prompts[0].title, /runtime files/);
	assert.equal(f.prompts.length, 1);
	assert.equal(readFileSync(join(worktree, ".gitignore"), "utf8"), "/.swarms/\n");
	assert.equal(existsSync(join(f.root, ".gitignore")), false);
});

for (const stage of ["init", "ignore"]) {
	test(`permission failure during ${stage} gives fixed guidance and preserves source`, async t => {
		if (process.getuid?.() === 0) { t.skip("Permission checks require a non-root test user"); return; }
		const f = fixture(t, { repository: stage === "ignore", ignore: "# keep\n" });
		f.answers.push(true);
		chmodSync(f.root, 0o500);
		try {
			await assert.rejects(f.run(), error => error.code === "SETUP" && /permissions/.test(error.message) && !error.message.includes(f.root));
			assert.equal(readFileSync(join(f.root, ".gitignore"), "utf8"), "# keep\n");
			assert.equal(existsSync(join(f.root, ".swarms")), false);
		} finally { chmodSync(f.root, 0o700); }
	});
}

test("malformed Git configuration never leaks raw Git diagnostics", async t => {
	const f = fixture(t, { repository: true });
	writeFileSync(join(f.root, ".git/config"), "[private-invalid-config\n");
	await assert.rejects(f.run(), error => error.code === "SETUP" && !error.message.includes("private-invalid") && !error.message.includes(f.root));
	assert.equal(f.prompts.length, 0);
});

for (const stage of ["init", "ignore"]) {
	test(`same-path root replacement during ${stage} consent refuses writes to the replacement`, async t => {
		// Both directories remain inside this fixture's owned temporary parent.
		const f = fixture(t);
		const project = join(f.root, "project");
		const original = join(f.root, "original");
		mkdirSync(project);
		writeFileSync(join(project, "source.txt"), "original source\n");
		if (stage === "ignore") f.git("-C", project, "init", "--quiet");
		f.ctx.cwd = project;
		let prompts = 0;
		let replacementConfig;
		f.ctx.ui.confirm = async title => {
			prompts++;
			assert.match(title, stage === "init" ? /Set up Git/ : /runtime files/);
			renameSync(project, original);
			mkdirSync(project);
			writeFileSync(join(project, "source.txt"), "replacement source\n");
			if (stage === "ignore") {
				f.git("-C", project, "init", "--quiet");
				replacementConfig = readFileSync(join(project, ".git/config"));
			}
			return true;
		};
		await assert.rejects(f.run(), error => error.code === "SETUP" && /directory changed/.test(error.message));
		assert.equal(prompts, 1);
		assert.deepEqual(readdirSync(project), stage === "init" ? ["source.txt"] : [".git", "source.txt"]);
		assert.deepEqual(readdirSync(original), stage === "init" ? ["source.txt"] : [".git", "source.txt"]);
		assert.equal(readFileSync(join(original, "source.txt"), "utf8"), "original source\n");
		assert.equal(readFileSync(join(project, "source.txt"), "utf8"), "replacement source\n");
		if (replacementConfig) assert.deepEqual(readFileSync(join(project, ".git/config")), replacementConfig);
		assert.deepEqual(f.notices, []);
	});
}

test("ambient Git routing cannot redirect approved initialization or ignore setup", async t => {
	const f = fixture(t);
	const other = fixture(t, { repository: true, ignore: "# unrelated\n" });
	const config = readFileSync(join(other.root, ".git/config"));
	const routing = {
		GIT_DIR: join(other.root, ".git"), GIT_WORK_TREE: other.root,
		GIT_INDEX_FILE: join(other.root, "redirected-index"),
	};
	const before = Object.fromEntries(Object.keys(routing).map(key => [key, process.env[key]]));
	f.answers.push(true, true);
	Object.assign(process.env, routing);
	try { assert.equal(await f.run(), true); }
	finally {
		for (const [key, value] of Object.entries(before)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
	assert.equal(f.prompts.length, 2);
	assert.equal(existsSync(join(f.root, ".git")), true);
	assert.equal(readFileSync(join(f.root, ".gitignore"), "utf8"), "/.swarms/\n");
	assert.deepEqual(readFileSync(join(other.root, ".git/config")), config);
	assert.equal(readFileSync(join(other.root, ".gitignore"), "utf8"), "# unrelated\n");
	assert.deepEqual(readdirSync(other.root), [".git", ".gitignore"]);
});

test("a replaced cwd alias cannot redirect an approved setup write", async t => {
	const f = fixture(t); const first = join(f.root, "first"); const second = join(f.root, "second");
	mkdirSync(first); mkdirSync(second);
	const alias = join(f.root, "alias"); symlinkSync(first, alias); f.ctx.cwd = alias;
	f.ctx.ui.confirm = async () => { rmSync(alias); symlinkSync(second, alias); return true; };
	await assert.rejects(f.run(), /directory changed/);
	assert.deepEqual(readdirSync(first), []); assert.deepEqual(readdirSync(second), []);
});
