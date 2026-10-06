import { execFileSync } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import { requireCondition as check } from "./errors.mjs";
import { WorkspaceFiles, hash } from "./workspace-files.mjs";

/** Read-only launch inspection. Never refresh/stage the index or modify ignore rules. */
export function inspectCheckout(workspace) {
	const root = realpathSync(workspace);
	const git = (...args) => execFileSync("git", ["--no-optional-locks", "-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	let records = [];
	let repository = false;
	try {
		repository = realpathSync(git("rev-parse", "--show-toplevel").trim()) === root;
		if (repository) records = git("status", "--porcelain=v1", "-z", "--untracked-files=all").split("\0").filter(Boolean);
	} catch { /* Git is optional; the content fingerprint still covers existing files. */ }
	const changes = repository ? [] : readdirSync(root, { withFileTypes: true }).map(entry => ({ status: "??", path: entry.name + (entry.isDirectory() ? "/" : "") }));
	for (let i = 0; i < records.length; i++) {
		const status = records[i].slice(0, 2);
		const entry = { status, path: records[i].slice(3) };
		if (/[RC]/.test(status)) entry.previousPath = records[++i];
		changes.push(entry);
	}
	return { root, repository, changes, fingerprint: new WorkspaceFiles(root).snapshot() };
}

function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
	return value;
}
export function specificationFingerprint(value) { return hash(JSON.stringify(canonical(value))); }

export { validateApproval } from "./approval-state.mjs";
