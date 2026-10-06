import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { execFile } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import { SwarmError, requireCondition as check } from "./errors.mjs";
import { WorkspaceFiles, hash } from "./workspace-files.mjs";

/** Keep complete synchronous fingerprints off the host event loop; cancellation retires the worker. */
export async function inspectCheckout(workspace, { signal, timeoutMs = 120000, additionalPaths = [] } = {}) {
	check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, "INPUT", "Invalid inspection timeout");
	signal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
	check(!signal.aborted, "CANCELLED", "Workspace inspection was cancelled");
	const root = await realpath(workspace);
	const git = async (...args) => (await promisify(execFile)("git", ["--no-optional-locks", "-C", root, ...args], { signal, encoding: "utf8", timeout: 10000 })).stdout;
	let records = [];
	let repository = false;
	let paths;
	try {
		repository = await realpath((await git("rev-parse", "--show-toplevel")).trim()) === root;
	} catch { /* Without Git checkout metadata, retain the complete-tree fallback. */ }
	if (repository) {
		// Fail closed if Git inspection fails after identifying a checkout.
		records = (await git("status", "--porcelain=v1", "-z", "--untracked-files=all")).split("\0").filter(Boolean);
		paths = [...new Set((await git("ls-files", "--cached", "--others", "--exclude-standard", "-z")).split("\0").filter(Boolean))].sort();
	}
	if (paths) paths = [...new Set([...paths, ...additionalPaths])].sort();
	check(!signal.aborted, "CANCELLED", "Workspace inspection was cancelled or timed out");
	return new Promise((resolve, reject) => {
		if (signal.aborted) return reject(new SwarmError("CANCELLED", "Workspace inspection was cancelled"));
		const worker = new Worker(new URL("./checkout-worker.mjs", import.meta.url), { execArgv: [], workerData: { workspace: root, repository, records, paths } });
		let settled = false;
		const finish = (error, result) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", abort);
			// Await termination so stop/close do not leave a fingerprint scan running.
			worker.terminate().then(() => error ? reject(error) : resolve(result), reject);
		};
		const abort = () => finish(new SwarmError("CANCELLED", "Workspace inspection was cancelled"));
		worker.once("message", message => {
			if (message.error) finish(new SwarmError(message.error.code ?? "INSPECTION", message.error.message));
			else finish(null, message.result);
		});
		worker.once("error", error => finish(error));
		worker.once("exit", () => {
			if (!settled) finish(new SwarmError("INSPECTION", "Workspace inspection worker exited without a result"));
		});
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
	});
}

/** Read-only worker implementation. Never refresh/stage the index or modify ignore rules. */
export function inspectCheckoutSync(workspace, { repository = false, records = [], paths } = {}) {
	const root = realpathSync(workspace);
	const changes = repository ? [] : readdirSync(root, { withFileTypes: true }).map(entry => ({ status: "??", path: entry.name + (entry.isDirectory() ? "/" : "") }));
	for (let i = 0; i < records.length; i++) {
		const status = records[i].slice(0, 2);
		const entry = { status, path: records[i].slice(3) };
		if (/[RC]/.test(status)) entry.previousPath = records[++i];
		changes.push(entry);
	}
	return {
		root, repository, changes,
		fingerprintScope: repository ? "Git tracked and non-ignored files plus Git control state; ignored files are checked per operation for explicit edit/write targets, not globally snapshotted. Indirect shell changes to ignored files are outside receipt/drift coverage" : "Complete directory tree plus Git control state",
		fingerprint: new WorkspaceFiles(root).snapshot({ paths })
	};
}

function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
	return value;
}
export function specificationFingerprint(value) { return hash(JSON.stringify(canonical(value))); }

export { validateApproval } from "./approval-state.mjs";
