import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { WorkspaceFiles, hash } from "./workspace-files.mjs";
import { requireCondition as check } from "./errors.mjs";

/** Read-only launch inspection. Never refresh/stage the index or modify ignore rules. */
export function inspectCheckout(workspace) {
	const root = realpathSync(workspace);
	const git = (...args) => execFileSync("git", ["--no-optional-locks", "-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	check(realpathSync(git("rev-parse", "--show-toplevel").trim()) === root, "PATH", "Launch requires the checkout root");
	git("check-ignore", "-q", "--", ".swarms/");
	check(git("ls-files", "-z", "--", ".swarms").length === 0, "PATH", "Runtime storage must not be tracked");
	const records = git("status", "--porcelain=v1", "-z", "--untracked-files=all").split("\0").filter(Boolean);
	const changes = [];
	for (let i = 0; i < records.length; i++) {
		const status = records[i].slice(0, 2);
		const entry = { status, path: records[i].slice(3) };
		if (/[RC]/.test(status)) entry.previousPath = records[++i];
		changes.push(entry);
	}
	return { root, changes, fingerprint: new WorkspaceFiles(root).snapshot() };
}

function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
	return value;
}
export function specificationFingerprint(value) { return hash(JSON.stringify(canonical(value))); }

export { validateApproval } from "./approval-state.mjs";
