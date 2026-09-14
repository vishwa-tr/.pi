import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

const OUTPUT_LIMIT = 1024 * 1024;
const TERM_GRACE_MS = 250;
const ABORT_SETTLEMENT_MS = 1000;
const GROUP_POLL_MS = 20;

function captureOutput() {
	const chunks = [];
	let size = 0;
	let truncated = false;
	return {
		append(chunk) {
			const remaining = OUTPUT_LIMIT - size;
			if (chunk.length > remaining) truncated = true;
			if (remaining <= 0) return;
			const kept = chunk.subarray(0, remaining);
			chunks.push(Buffer.from(kept));
			size += kept.length;
		},
		markTruncated() {
			truncated = true;
		},
		result() {
			// Invalid UTF-8 expands when decoded; cap the returned UTF-8 bytes too.
			const encoded = Buffer.from(Buffer.concat(chunks, size).toString("utf8"));
			if (encoded.length > OUTPUT_LIMIT) truncated = true;
			const decoder = new StringDecoder("utf8");
			const text = decoder.write(encoded.subarray(0, OUTPUT_LIMIT));
			return { text, truncated };
		},
	};
}

function groupExists(pid) {
	try {
		process.kill(-pid, 0);
		return true;
	} catch (error) {
		// Permission errors and unknown failures are not evidence of settlement.
		return error.code !== "ESRCH";
	}
}

function signalGroup(pid, signal) {
	try {
		process.kill(-pid, signal);
	} catch {
		// Settlement is established separately, never from a signal's success.
	}
}

/**
 * Execute trusted-host-authorized Bash in its own POSIX process group.
 * runShell({ command, cwd, signal?, env? }) -> Promise<{
 *   exitCode: number|null, stdout: string, stderr: string,
 *   settled: boolean, aborted: boolean, truncated: boolean
 * }>
 *
 * A pre-aborted request returns settled:true without launching. Otherwise exitCode
 * comes only from the child's close event; signal termination has exitCode:null.
 * Pre-launch setup/spawn failures reject. After launch, errors never imply that
 * nothing ran: they produce settled:false. Each output stream is capped at 1 MiB.
 *
 * Abort sends group TERM, then KILL after 250ms, and waits for actual child close.
 * Descendant settlement is checked for up to 1s after abort. If the child itself
 * cannot exit, the promise remains pending rather than claiming it stopped.
 * Normal completion NEVER kills background children: after child close, a surviving
 * process group (including zombies or a failed probe) returns settled:false.
 * Background children retaining output pipes can delay close until cancellation.
 * The caller must
 * retain workspace ownership until explicit trusted reconciliation in that case.
 *
 * This is cancellation coordination, NOT a sandbox. Processes that escape the
 * process group (setsid, daemonization, etc.), external writers, and effects beyond
 * the workspace are not covered. env defaults to process.env with no identifiers
 * added; Bash may honor environment startup settings. env is a trusted host input.
 */
export async function runShell({ command, cwd, signal, env = process.env }) {
	const setupError = message => Object.assign(new TypeError(message), { settled: true });
	if (typeof command !== "string" || command.includes("\0")) throw setupError("Expected a shell command without NUL bytes");
	if (typeof cwd !== "string" || !cwd || cwd.includes("\0")) throw setupError("Expected a working directory");
	if (signal !== undefined && !(signal instanceof AbortSignal)) throw setupError("Expected an AbortSignal");
	if (process.platform === "win32") throw setupError("Shell process groups require POSIX");
	if (signal?.aborted) {
		return { exitCode: null, stdout: "", stderr: "", settled: true, aborted: true, truncated: false };
	}

	const stdout = captureOutput();
	const stderr = captureOutput();
	let child;
	try {
		child = spawn("/bin/bash", ["--noprofile", "--norc", "-c", command], {
			cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		error.settled = true;
		throw error;
	}

	return new Promise((resolve, reject) => {
		let aborted = false;
		let exited = false;
		let closed = false;
		let failed = false;
		let finished = false;
		let exitCode = null;
		let abortDeadline = Infinity;
		let killTimer;
		let deadlineTimer;
		let pollTimer;

		function cleanup() {
			clearTimeout(killTimer);
			clearTimeout(deadlineTimer);
			clearTimeout(pollTimer);
			signal?.removeEventListener("abort", onAbort);
			child.removeListener("error", onError);
			child.removeListener("exit", onExit);
			child.removeListener("close", onClose);
			child.stdout.removeListener("data", stdout.append);
			child.stderr.removeListener("data", stderr.append);
			child.stdout.removeListener("error", onStreamError);
			child.stderr.removeListener("error", onStreamError);
		}

		function finish(settled) {
			if (finished) return;
			finished = true;
			cleanup();
			const out = stdout.result();
			const err = stderr.result();
			resolve({ exitCode, stdout: out.text, stderr: err.text, settled: settled && !failed, aborted, truncated: out.truncated || err.truncated });
		}

		function checkSettlement() {
			if (!closed || finished) return;
			if (!groupExists(child.pid)) return finish(true);
			if (!aborted || performance.now() >= abortDeadline) return finish(false);
			pollTimer = setTimeout(checkSettlement, GROUP_POLL_MS);
		}

		function closeAbortedPipes() {
			// An escaped descendant can retain pipes after the direct child exits.
			// Destroying pipes is not evidence of death: still wait for child close.
			if (!exited || closed) return;
			if (!child.stdout.readableEnded) stdout.markTruncated();
			if (!child.stderr.readableEnded) stderr.markTruncated();
			child.stdout.destroy();
			child.stderr.destroy();
		}

		function onAbort() {
			if (aborted || finished) return;
			aborted = true;
			abortDeadline = performance.now() + ABORT_SETTLEMENT_MS;
			if (child.pid) signalGroup(child.pid, "SIGTERM");
			killTimer = setTimeout(() => {
				if (child.pid) signalGroup(child.pid, "SIGKILL");
			}, TERM_GRACE_MS);
			deadlineTimer = setTimeout(closeAbortedPipes, ABORT_SETTLEMENT_MS);
		}

		function onError(error) {
			if (!child.pid) {
				// Node emits close after a spawn failure. Keep handlers through close
				// so no deferred stream error is left unhandled.
				failed = true;
				error.settled = true;
				reject(error);
				return;
			}
			failed = true;
		}

		function onStreamError() {
			failed = true;
		}

		function onExit() {
			exited = true;
			if (aborted && performance.now() >= abortDeadline) closeAbortedPipes();
		}

		function onClose(code) {
			closed = true;
			exitCode = Number.isInteger(code) ? code : null;
			if (!child.pid) {
				finished = true;
				cleanup();
				return;
			}
			checkSettlement();
		}

		child.stdout.on("data", stdout.append);
		child.stderr.on("data", stderr.append);
		child.stdout.on("error", onStreamError);
		child.stderr.on("error", onStreamError);
		child.on("error", onError);
		child.once("exit", onExit);
		child.once("close", onClose);
		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) onAbort();
	});
}
