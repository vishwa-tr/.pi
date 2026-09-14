import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { runShell } from "../extensions/swarm/shell.mjs";

const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const nodeCommand = source => `${quote(process.execPath)} -e ${quote(source)}`;

async function workspace(t) {
	const cwd = await mkdtemp(join(tmpdir(), "swarm-shell-test-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	return cwd;
}

async function waitForFile(path) {
	const deadline = performance.now() + 5000;
	while (performance.now() < deadline) {
		try {
			const content = await readFile(path, "utf8");
			if (content) return content;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		await delay(10);
	}
	throw new Error("Timed out waiting for command readiness");
}

function killGroup(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return;
	try {
		process.kill(-pid, "SIGKILL");
	} catch (error) {
		if (error.code !== "ESRCH") throw error;
	}
}

function pidExists(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error.code === "ESRCH") return false;
		throw error;
	}
}

test("captures actual exit zero, both streams, cwd, and host environment", async t => {
	const cwd = await workspace(t);
	const controller = new AbortController();
	const result = await runShell({
		command: 'printf "%s" "$SHELL_TEST_VALUE"; printf error >&2; printf marker > artifact',
		cwd,
		signal: controller.signal,
		env: { SHELL_TEST_VALUE: "hello" },
	});
	assert.deepEqual(result, { exitCode: 0, stdout: "hello", stderr: "error", settled: true, aborted: false, truncated: false });
	assert.equal(await readFile(join(cwd, "artifact"), "utf8"), "marker");
	assert.equal(getEventListeners(controller.signal, "abort").length, 0);
	controller.abort();
});

test("actual nonzero status overrides lying success output", async t => {
	const cwd = await workspace(t);
	const result = await runShell({ command: 'printf "All tests passed. exitCode: 0\\n"; exit 23', cwd });
	assert.equal(result.exitCode, 23);
	assert.equal(result.stdout, "All tests passed. exitCode: 0\n");
	assert.equal(result.settled, true);
	assert.equal(result.aborted, false);
});

test("a pre-aborted signal does not launch a shell or create a file", async t => {
	const cwd = await workspace(t);
	const controller = new AbortController();
	controller.abort();
	const result = await runShell({ command: "printf changed > forbidden", cwd, signal: controller.signal });
	assert.deepEqual(result, { exitCode: null, stdout: "", stderr: "", settled: true, aborted: true, truncated: false });
	await assert.rejects(stat(join(cwd, "forbidden")), { code: "ENOENT" });
	assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("spawn failure before launch rejects and removes the abort listener", async t => {
	const cwd = await workspace(t);
	const controller = new AbortController();
	await assert.rejects(runShell({ command: "true", cwd: join(cwd, "missing"), signal: controller.signal }), { code: "ENOENT" });
	await delay(20); // Node emits close after the error that rejects the promise.
	assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("abort kills a running timer process and awaits its real close", { timeout: 10000 }, async t => {
	const cwd = await workspace(t);
	const controller = new AbortController();
	let pid;
	t.after(() => { controller.abort(); killGroup(pid); });
	const command = `exec ${nodeCommand('require("node:fs").writeFileSync("ready", String(process.pid)); setInterval(() => {}, 1000)')}`;
	const pending = runShell({ command, cwd, signal: controller.signal });
	pid = Number(await waitForFile(join(cwd, "ready")));
	assert.equal(pidExists(pid), true);
	controller.abort();
	const result = await pending;
	assert.equal(result.aborted, true);
	assert.equal(result.exitCode, null);
	assert.equal(result.settled, true);
	assert.equal(pidExists(pid), false);
	assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("abort escalates to KILL when a timer process ignores TERM", { timeout: 10000 }, async t => {
	const cwd = await workspace(t);
	const controller = new AbortController();
	let pid;
	t.after(() => { controller.abort(); killGroup(pid); });
	const command = `exec ${nodeCommand('process.on("SIGTERM", () => {}); require("node:fs").writeFileSync("ready", String(process.pid)); setInterval(() => {}, 1000)')}`;
	const pending = runShell({ command, cwd, signal: controller.signal });
	pid = Number(await waitForFile(join(cwd, "ready")));
	controller.abort();
	const result = await pending;
	assert.equal(result.exitCode, null);
	assert.equal(result.settled, true);
	assert.equal(result.aborted, true);
	assert.equal(pidExists(pid), false);
});

test("abort reaches same-group descendants, not just the Bash leader", { timeout: 10000 }, async t => {
	const cwd = await workspace(t);
	const controller = new AbortController();
	let leader;
	t.after(() => { controller.abort(); killGroup(leader); });
	// Bash traps TERM and reaps its child. Without group signalling, wait would
	// stall and the descendant would survive killing only the shell.
	const timer = nodeCommand('require("node:fs").writeFileSync("ready", String(process.pid)); setInterval(() => {}, 1000)');
	const command = `printf '%s' "$$" > leader; trap 'wait "$worker"; exit 0' TERM; ${timer} & worker=$!; wait "$worker"`;
	const pending = runShell({ command, cwd, signal: controller.signal });
	const descendant = Number(await waitForFile(join(cwd, "ready")));
	leader = Number(await waitForFile(join(cwd, "leader")));
	controller.abort();
	const result = await pending;
	assert.equal(result.aborted, true);
	assert.equal(result.exitCode, 0); // Trap exit, not a fabricated abort status.
	assert.equal(result.settled, true);
	assert.equal(pidExists(leader), false);
	assert.equal(pidExists(descendant), false);
});

test("drains large stdout/stderr while limiting each captured stream", async t => {
	const cwd = await workspace(t);
	const command = nodeCommand('process.stdout.write("x".repeat(2 * 1024 * 1024)); process.stderr.write("y".repeat(2 * 1024 * 1024))');
	const result = await runShell({ command, cwd });
	assert.equal(result.exitCode, 0);
	assert.equal(result.settled, true);
	assert.equal(result.truncated, true);
	assert.equal(Buffer.byteLength(result.stdout), 1024 * 1024);
	assert.equal(Buffer.byteLength(result.stderr), 1024 * 1024);
});

test("invalid UTF-8 cannot expand returned output past the byte limit", async t => {
	const cwd = await workspace(t);
	const result = await runShell({ command: nodeCommand('process.stdout.write(Buffer.alloc(1024 * 1024, 255))'), cwd });
	assert.equal(result.exitCode, 0);
	assert.equal(result.truncated, true);
	assert.ok(Buffer.byteLength(result.stdout) <= 1024 * 1024);
});

test("ordinary background descendants are reported unsettled, not killed", { timeout: 10000 }, async t => {
	const cwd = await workspace(t);
	let leader;
	let descendant;
	t.after(() => killGroup(leader)); // Explicit trusted cleanup, not runner policy.
	const timer = nodeCommand('setInterval(() => {}, 1000)');
	const command = `printf '%s' "$$" > leader; ${timer} </dev/null >/dev/null 2>&1 & printf '%s' "$!" > descendant`;
	const result = await runShell({ command, cwd });
	leader = Number(await readFile(join(cwd, "leader"), "utf8"));
	descendant = Number(await readFile(join(cwd, "descendant"), "utf8"));
	assert.equal(result.exitCode, 0);
	assert.equal(result.settled, false);
	assert.equal(result.aborted, false);
	assert.equal(pidExists(descendant), true);
	killGroup(leader);
});
