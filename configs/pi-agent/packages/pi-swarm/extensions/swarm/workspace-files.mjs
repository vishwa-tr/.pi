import { createHash } from "node:crypto";
import { requireCondition as check } from "./errors.mjs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";

export function hash(value) { return createHash("sha256").update(value).digest("hex"); }

/** Read-only path validation and content fingerprints. Pi owns all coding IO. */
export class WorkspaceFiles {
	#root;
	#identity;
	#protected;
	constructor(root, { protectedPaths = [] } = {}) {
		check(typeof root === "string" && isAbsolute(root), "INPUT", "Expected absolute workspace root");
		this.#root = realpathSync(root);
		check(this.#root === resolve(root), "PATH", "Workspace aliases are unsupported");
		const stat = lstatSync(root);
		check(stat.isDirectory(), "PATH", "Workspace must be a directory");
		this.#identity = [stat.dev, stat.ino, stat.birthtimeMs].join(":");
		this.#protected = protectedPaths;
	}
	path(path) {
		this.#checkRoot();
		check(typeof path === "string" && path.length > 0 && !path.includes("\0"), "INPUT", "Invalid workspace path");
		const parts = path.replaceAll("\\", "/").split("/");
		check(!parts.some(part => ["..", ".git"].includes(part)), "PATH", "Traversal and Git control paths are protected");
		const normalized = relative(this.#root, resolve(this.#root, path));
		check(normalized && normalized !== ".." && !normalized.startsWith(`..${sep}`) && !isAbsolute(normalized), "PATH", "Path is outside the workspace");
		check(!this.#protected.some(part => normalized === part || normalized.startsWith(`${part}${sep}`)), "PATH", "Protected path");
		let current = this.#root;
		const components = normalized.split(sep);
		for (let i = 0; i < components.length; i++) {
			current = join(current, components[i]);
			const stat = statOrMissing(current);
			if (!stat) break;
			check(!stat.isSymbolicLink(), "PATH", "Workspace file aliases are unsupported");
			check(i === components.length - 1 ? stat.isFile() && stat.nlink === 1 : stat.isDirectory(), "PATH", "Expected ordinary file and directory parents");
		}
		return normalized;
	}
	fingerprint(path) {
		const normalized = this.path(path);
		return hash(JSON.stringify(capture(join(this.#root, normalized))));
	}
	snapshot({ includeGit = true } = {}) {
		this.#checkRoot();
		const snapshot = () => hash(JSON.stringify([capture(this.#root, true), includeGit ? gitState(this.#root) : null]));
		const fingerprint = snapshot();
		check(snapshot() === fingerprint, "STALE", "Workspace changed during snapshot");
		this.#checkRoot();
		return fingerprint;
	}
	#checkRoot() {
		const stat = lstatSync(this.#root);
		check(stat.isDirectory() && !stat.isSymbolicLink() && [stat.dev, stat.ino, stat.birthtimeMs].join(":") === this.#identity,
			"PATH", "Workspace root identity changed");
	}
}

function statOrMissing(path) {
	try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function capture(path, excludeGit = false) {
	const stat = statOrMissing(path);
	if (!stat) return null;
	if (stat.isSymbolicLink()) return ["link", readlinkSync(path)];
	if (stat.isFile()) return ["file", stat.mode, hash(readFileSync(path))];
	check(stat.isDirectory(), "PATH", "Unsupported workspace file type");
	return ["directory", stat.mode, readdirSync(path).sort().filter(name => !excludeGit || name !== ".git")
		.map(name => [name, capture(join(path, name), excludeGit)])];
}
function gitState(root) {
	const control = join(root, ".git");
	const stat = statOrMissing(control);
	if (!stat) return null;
	check(!stat.isSymbolicLink(), "PATH", "Git metadata must not be aliased");
	const pointer = stat.isFile() ? readFileSync(control, "utf8") : null;
	const match = pointer === null ? null : /^gitdir: ([^\r\n]+)\r?\n?$/.exec(pointer);
	check(pointer === null || match, "PATH", "Invalid Git directory pointer");
	const git = pointer === null ? control : resolve(root, match[1]);
	const commonFile = join(git, "commondir");
	const common = statOrMissing(commonFile) ? resolve(git, readFileSync(commonFile, "utf8").trim()) : git;
	return [pointer, capture(join(git, "HEAD")), capture(join(git, "index")), capture(join(git, "refs")),
		capture(join(common, "packed-refs")), capture(join(common, "refs"))];
}
