import {
	closeSync, constants, fchmodSync, fstatSync, ftruncateSync, lstatSync, mkdirSync,
	openSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { SwarmError, requireCondition } from "./state.mjs";

export function hash(value) { return createHash("sha256").update(value).digest("hex"); }
const encoded = value => JSON.stringify(value);
const identity = stat => [stat.dev, stat.ino, stat.mode, stat.birthtimeNs].map(String);
const metadata = stat => [...identity(stat), stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].map(String);
const same = (left, right) => encoded(left) === encoded(right);
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

function statOrMissing(path) {
	try { return lstatSync(path, { bigint: true }); }
	catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function regular(stat) {
	requireCondition(stat.isFile() && stat.nlink === 1n, "PATH", "Target must be an ordinary file without hardlink aliases");
}
function directory(stat) {
	requireCondition(stat?.isDirectory() && !stat.isSymbolicLink(), "PATH", "Parent must be a real directory");
}
function filesystem(action) {
	try { return action(); }
	catch (error) {
		if (error instanceof SwarmError) throw error;
		const code = ["EEXIST", "ENOENT"].includes(error.code) ? "STALE" : "PATH";
		throw new SwarmError(code, `Workspace filesystem operation failed (${error.code ?? "unknown"})`);
	}
}

function applyEdits(content, edits) {
	requireCondition(Array.isArray(edits) && edits.length > 0, "INPUT", "Expected nonempty edits array");
	const matches = edits.map(edit => {
		requireCondition(edit && typeof edit === "object" && !Array.isArray(edit)
			&& Object.keys(edit).sort().join() === "newText,oldText"
			&& typeof edit.oldText === "string" && edit.oldText.length > 0
			&& typeof edit.newText === "string", "INPUT", "Each edit requires nonempty oldText and string newText");
		const start = content.indexOf(edit.oldText);
		requireCondition(start !== -1, "NOT_FOUND", "Edit text was not found");
		requireCondition(content.indexOf(edit.oldText, start + 1) === -1, "AMBIGUOUS", "Edit text is not unique");
		return { start, end: start + edit.oldText.length, replacement: edit.newText };
	}).sort((left, right) => left.start - right.start);
	let result = "";
	let end = 0;
	for (const match of matches) {
		requireCondition(match.start >= end, "AMBIGUOUS", "Edits overlap");
		result += content.slice(end, match.start) + match.replacement;
		end = match.end;
	}
	return result + content.slice(end);
}

/** Synchronous stale-state checks, not an OS lock against external writers. */
export class WorkspaceFiles {
	#root;
	#rootIdentity;
	#protected;

	constructor(root, { protectedPaths = [] } = {}) {
		requireCondition(typeof root === "string" && isAbsolute(root), "INPUT", "Expected canonical absolute workspace root");
		requireCondition(Array.isArray(protectedPaths), "INPUT", "Expected protected paths array");
		filesystem(() => {
			this.#root = resolve(root);
			requireCondition(realpathSync(this.#root) === this.#root, "PATH", "Workspace root must not have symlink aliases");
			const stat = lstatSync(this.#root, { bigint: true });
			directory(stat);
			this.#rootIdentity = identity(stat);
		});
		this.#protected = protectedPaths.map(path => this.#normalize(path));
	}

	#checkRoot() {
		const stat = statOrMissing(this.#root);
		directory(stat);
		requireCondition(realpathSync(this.#root) === this.#root && same(identity(stat), this.#rootIdentity),
			"PATH", "Workspace root identity changed");
	}

	#normalize(path) {
		requireCondition(typeof path === "string" && path.length > 0 && !path.includes("\0") && !path.includes("\\"), "INPUT", "Invalid workspace path");
		// Reject even normalized-away traversal/control components rather than hide aliases.
		const components = path.split(sep);
		requireCondition(!components.some(part => ["..", ".git", ".swarms"].includes(part)), "PATH", "Traversal and control paths are protected");
		const normalized = relative(this.#root, resolve(this.#root, path));
		requireCondition(normalized !== "" && normalized !== ".." && !normalized.startsWith(`..${sep}`) && !isAbsolute(normalized), "PATH", "Path is outside workspace or identifies its root");
		return normalized;
	}

	#allowed(path) {
		const normalized = this.#normalize(path);
		requireCondition(!this.#protected.some(protectedPath => normalized === protectedPath || normalized.startsWith(`${protectedPath}${sep}`)), "PATH", "Path is protected");
		return normalized;
	}

	#inspect(path) {
		this.#checkRoot();
		const parents = [["", this.#rootIdentity]];
		const parts = path.split(sep);
		let absolute = this.#root;
		for (let index = 0; index < parts.length; index++) {
			absolute = join(absolute, parts[index]);
			const stat = statOrMissing(absolute);
			if (!stat) return { parents, leaf: null };
			if (index === parts.length - 1) {
				regular(stat);
				return { parents, leaf: metadata(stat) };
			}
			directory(stat);
			parents.push([parts.slice(0, index + 1).join(sep), identity(stat)]);
		}
	}

	path(path) {
		return filesystem(() => {
			const normalized = this.#allowed(path);
			this.#inspect(normalized);
			return normalized;
		});
	}

	#capture(path, fd, textOnly = false) {
		const before = this.#inspect(path);
		let bytes = null;
		if (before.leaf) {
			const owned = fd === undefined;
			const handle = owned ? openSync(join(this.#root, path), READ_FLAGS) : fd;
			try {
				const stat = fstatSync(handle, { bigint: true });
				regular(stat);
				requireCondition(same(metadata(stat), before.leaf), "STALE", "Opened target identity changed");
				bytes = readFileSync(handle);
				if (textOnly) requireCondition(Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes), "INPUT", "Exact text edits require valid UTF-8");
				requireCondition(same(metadata(fstatSync(handle, { bigint: true })), before.leaf), "STALE", "File changed during read");
			} finally { if (owned) closeSync(handle); }
		}
		requireCondition(same(this.#inspect(path), before), "STALE", "Path changed during read");
		return {
			path, content: bytes === null ? null : bytes.toString("utf8"),
			fingerprint: hash(encoded([path, before, bytes === null ? null : hash(bytes)])),
		};
	}

	read(path) { return filesystem(() => this.#capture(this.#allowed(path))); }

	#mutate(path, expectedFingerprint, transform, textOnly = false) {
		return filesystem(() => {
			requireCondition(typeof expectedFingerprint === "string" && /^[a-f0-9]{64}$/.test(expectedFingerprint), "INPUT", "A read fingerprint is required");
			const normalized = this.#allowed(path);
			const original = this.#capture(normalized, undefined, textOnly);
			requireCondition(original.fingerprint === expectedFingerprint, "STALE", "Reread the changed target before editing");
			const content = transform(original.content);
			const bytes = Buffer.from(content, "utf8");
			let fd;
			try {
				if (original.content !== null) {
					fd = openSync(join(this.#root, normalized), constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
					requireCondition(this.#capture(normalized, fd).fingerprint === expectedFingerprint, "STALE", "Target changed before write");
				} else {
					const parents = this.#createParents(normalized, expectedFingerprint);
					fd = openSync(join(this.#root, normalized), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o666);
					const stat = fstatSync(fd, { bigint: true });
					regular(stat);
					const created = this.#inspect(normalized);
					requireCondition(same(created.parents, parents) && same(created.leaf, metadata(stat)), "STALE", "Created target identity changed");
				}
				const mode = Number(fstatSync(fd, { bigint: true }).mode & 0o7777n);
				// Explicit positions: validating through the same handle consumed its read offset.
				let written = 0;
				while (written < bytes.length) {
					const count = writeSync(fd, bytes, written, bytes.length - written, written);
					requireCondition(count > 0, "IO", "File write made no progress");
					written += count;
				}
				ftruncateSync(fd, bytes.length);
				if ((fstatSync(fd).mode & 0o7777) !== mode) fchmodSync(fd, mode);
			} finally { if (fd !== undefined) closeSync(fd); }
			return this.#capture(normalized);
		});
	}

	#createParents(path, expectedFingerprint) {
		requireCondition(this.#capture(path).fingerprint === expectedFingerprint, "STALE", "Missing path changed before creation");
		const parts = path.split(sep).slice(0, -1);
		let expected = this.#inspect(path);
		for (let index = 0; index < parts.length; index++) {
			requireCondition(same(this.#inspect(path), expected), "STALE", "Parent identity changed before creation");
			const parent = join(this.#root, ...parts.slice(0, index + 1));
			if (!statOrMissing(parent)) mkdirSync(parent);
			directory(lstatSync(parent, { bigint: true }));
			const next = this.#inspect(path);
			requireCondition(next.leaf === null && same(next.parents.slice(0, expected.parents.length), expected.parents), "STALE", "Parent identity changed during creation");
			expected = next;
		}
		requireCondition(same(this.#inspect(path), expected), "STALE", "Missing target changed before open");
		return expected.parents;
	}

	write(path, content, expectedFingerprint) {
		requireCondition(typeof content === "string", "INPUT", "Expected string content");
		return this.#mutate(path, expectedFingerprint, () => content);
	}

	edit(path, edits, expectedFingerprint) {
		return this.#mutate(path, expectedFingerprint, content => {
			requireCondition(content !== null, "NOT_FOUND", "Cannot edit a missing file");
			return applyEdits(content, edits);
		}, true);
	}

	#tree(path = "", excludeControl = true) {
		this.#checkRoot();
		const absolute = join(this.#root, path);
		const stat = statOrMissing(absolute);
		if (!stat) return [path, "missing"];
		if (stat.isSymbolicLink()) {
			const value = readlinkSync(absolute, { encoding: "buffer" });
			requireCondition(same(metadata(lstatSync(absolute, { bigint: true })), metadata(stat)), "STALE", "Symlink changed during snapshot");
			return [path, "symlink", metadata(stat), hash(value)];
		}
		if (stat.isFile()) return [path, "file", this.#capture(path).fingerprint];
		directory(stat);
		const names = readdirSync(absolute, { encoding: "buffer" }).map(bytes => {
			const name = bytes.toString("utf8");
			requireCondition(Buffer.from(name, "utf8").equals(bytes), "PATH", "Snapshot requires UTF-8 filenames");
			return name;
		}).sort();
		const children = [];
		for (const name of names) {
			if (excludeControl && [".git", ".swarms"].includes(name)) continue;
			children.push(this.#tree(join(path, name), excludeControl));
		}
		requireCondition(same(identity(lstatSync(absolute, { bigint: true })), identity(stat)), "STALE", "Directory changed during snapshot");
		return [path, "directory", identity(stat), children];
	}

	#gitSnapshot() {
		const controlPath = join(this.#root, ".git");
		const stat = statOrMissing(controlPath);
		requireCondition(stat && !stat.isSymbolicLink(), "PATH", "Git metadata is missing or aliased");
		let gitRoot = controlPath;
		let pointer = null;
		if (stat.isFile()) {
			// Linked worktrees put a gitdir pointer here; never execute Git to resolve it.
			pointer = this.#capture(".git");
			const match = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(pointer.content);
			requireCondition(match, "PATH", "Unsupported Git directory pointer");
			gitRoot = resolve(this.#root, match[1]);
		} else directory(stat);
		const git = new WorkspaceFiles(gitRoot);
		const commonPointer = git.read("commondir");
		let common = git;
		if (commonPointer.content !== null) {
			requireCondition(/^[^\r\n]+\r?\n?$/.test(commonPointer.content), "PATH", "Invalid common Git directory pointer");
			common = new WorkspaceFiles(resolve(gitRoot, commonPointer.content.replace(/\r?\n$/, "")));
		}
		const head = git.read("HEAD");
		requireCondition(head.content !== null, "PATH", "Git HEAD is missing");
		return [pointer, identity(stat), git.#rootIdentity, common.#rootIdentity, commonPointer,
			head, git.read("index"), git.#tree("refs", false), common.read("packed-refs"), common.#tree("refs", false)];
	}

	/** Opaque deterministic digest; includes ignored files but not volatile coordination/Git internals. */
	snapshot() {
		return filesystem(() => {
			const capture = () => hash(encoded([this.#tree(), this.#gitSnapshot()]));
			const fingerprint = capture();
			requireCondition(capture() === fingerprint, "STALE", "Workspace changed during snapshot");
			this.#checkRoot();
			return fingerprint;
		});
	}
}
