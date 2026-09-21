import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SwarmHost } from "../extensions/swarm/host.mjs";
import { SwarmController } from "../extensions/swarm/core.mjs";
import { createMockRuntime } from "./sdk-env.mjs";
import { repository } from "./helpers.mjs";

const code = expected => error => error.code === expected;
const approved = request => ({ approved: true, existingChanges: "preserve", reconciled: request.requiresReconciliation });
const specification = { objective: "Implement invitations", criteria: ["Invitations work"], scope: ["src"] };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function modeBus() {
	const events = new EventEmitter();
	let snapshot = { version: 1, instanceId: "instance1", revision: 1, contextRevision: 1, ready: true, sessionId: "owner1", selectedMode: "off", enforcedMode: "off", runMode: null, pendingChange: false };
	events.on("pi-plan:query-mode", request => request.respond({ ...snapshot }));
	return { events, change(values) { snapshot = { ...snapshot, ...values, revision: snapshot.revision + 1 }; events.emit("pi-plan:mode-changed", { ...snapshot }); } };
}
async function fixture(t, options = {}) {
	const root = repository(t);
	const bus = modeBus();
	const mock = await createMockRuntime(options.script ?? []);
	const host = new SwarmHost({ events: bus.events, sessionId: "owner1", requestApproval: options.approval ?? approved, modelRuntime: mock.modelRuntime, mainModel: mock.model, tickIntervalMs: 0, approvalTimeoutMs: options.timeout ?? 1000, safetyTimeoutMs: 1000 });
	const launch = () => host.launch({ workspace: root, runId: "run1", specification });
	return { root, ...bus, mock, host, launch };
}

test("read-only host history does not create sessions or dispatch and validates persisted identity", async t => {
	const f = await fixture(t, { script: () => ({ text: "History evidence" }) });
	await f.launch();
	await f.host.recruit({ id: "worker", specialization: "Review", brief: "Inspect", reason: "Independent inspection" });
	const before = f.host.snapshot();
	const entries = f.host.history("worker");
	assert.deepEqual(f.host.snapshot(), before);
	assert.equal(f.mock.calls.length, 0);
	assert.ok(Array.isArray(entries));
	assert.throws(() => f.host.history("missing"), { code: "NOT_FOUND" });
	const binding = before.run.sessions.workers[0];
	const path = join(f.root, ".swarms", "run1", "sessions", binding.sessionFile);
	const original = readFileSync(path, "utf8");
	writeFileSync(path, original.replace(binding.sessionId, "wrong-identity"));
	assert.throws(() => f.host.history("worker"));
	writeFileSync(path, original);
	await f.host.close();
});

test("launch waits for explicit human approval before creating storage or sessions", async t => {
	const decision = deferred(); const presented = deferred();
	const f = await fixture(t, { approval: request => { presented.resolve(request); return decision.promise; } });
	const launch = f.launch(); const request = await presented.promise;
	assert.equal(request.action, "launch");
	assert.equal(request.requiresExistingWorkDecision, true);
	assert.equal(f.mock.calls.length, 0);
	assert.equal(existsSync(join(f.root, ".swarms")), false);
	decision.resolve(approved(request)); await launch;
	assert.equal(f.host.snapshot().run.status, "running");
	assert.equal(f.host.snapshot().run.hostApprovals[0].existingChanges, "preserve");
	assert.equal(f.mock.calls.length, 0);
	await f.host.close();
});

test("dirty checkout requires an explicit preservation decision", async t => {
	const f = await fixture(t, { approval: () => ({ approved: true }) });
	writeFileSync(join(f.root, "user.txt"), "user work\n");
	await assert.rejects(f.launch(), code("DIRTY"));
	assert.equal(readFileSync(join(f.root, "user.txt"), "utf8"), "user work\n");
	assert.equal(existsSync(join(f.root, ".swarms")), false);
	await f.host.close();
});

test("approved launch edits are captured but are not inferred from mutable request data", async t => {
	const f = await fixture(t, { approval: request => ({ ...approved(request), specification: { ...request.specification, objective: "Human-edited objective" } }) });
	await f.launch();
	assert.equal(f.host.snapshot().run.objective, "Human-edited objective");
	await f.host.close();
});

for (const selectedMode of ["plan", "discuss", "quick"]) {
	test(`${selectedMode} denies launch before any approval or storage`, async t => {
		let prompts = 0;
		const f = await fixture(t, { approval: request => { prompts++; return approved(request); } });
		f.change({ selectedMode, enforcedMode: "off", pendingChange: true });
		await assert.rejects(f.launch(), code("MODE_DENIED"));
		assert.equal(prompts, 0);
		assert.equal(existsSync(join(f.root, ".swarms")), false);
		await f.host.close();
	});
}

test("mode ABA and late approval cannot revive cancelled launch", async t => {
	const decision = deferred(); const presented = deferred();
	const f = await fixture(t, { approval: request => { presented.resolve(request); return decision.promise; } });
	const rejected = assert.rejects(f.launch()); await presented.promise;
	f.change({ selectedMode: "plan", enforcedMode: "plan" });
	f.change({ selectedMode: "off", enforcedMode: "off" });
	decision.resolve({ approved: true, existingChanges: "preserve" }); await rejected;
	assert.equal(existsSync(join(f.root, ".swarms")), false);
	assert.equal(f.mock.calls.length, 0);
	await f.host.close();
});

test("external edits during approval require a fresh decision and are never rolled back", async t => {
	const decision = deferred(); const presented = deferred();
	const f = await fixture(t, { approval: request => { presented.resolve(request); return decision.promise; } });
	const rejected = assert.rejects(f.launch(), code("STALE")); const request = await presented.promise;
	writeFileSync(join(f.root, "new-user-work"), "preserve me");
	decision.resolve(approved(request)); await rejected;
	assert.equal(readFileSync(join(f.root, "new-user-work"), "utf8"), "preserve me");
	assert.equal(existsSync(join(f.root, ".swarms")), false);
	await f.host.close();
});

test("approval timeout aborts its provider and ignores later completion", async t => {
	let signal;
	const decision = deferred();
	const f = await fixture(t, { timeout: 5, approval: request => { signal = request.signal; return decision.promise; } });
	await assert.rejects(f.launch(), code("CANCELLED"));
	assert.equal(signal.aborted, true);
	decision.resolve({ approved: true, existingChanges: "preserve" });
	await Promise.resolve();
	assert.equal(f.host.snapshot().run, null);
	await f.host.close();
});

test("restriction pauses a running host and Off does not automatically resume it", async t => {
	const f = await fixture(t);
	await f.launch();
	f.change({ selectedMode: "plan", enforcedMode: "off", pendingChange: true });
	await f.host.idle();
	assert.equal(f.host.snapshot().run.status, "paused");
	f.change({ selectedMode: "off", enforcedMode: "off", pendingChange: false });
	assert.throws(() => f.host.wake("builder"), code("HOST_DENIED"));
	await f.host.resume();
	assert.equal(f.host.snapshot().run.status, "running");
	assert.equal(f.host.snapshot().run.hostApprovals.at(-1).action, "resume");
	await f.host.close();
});

test("same-mode context restore revokes approval; harmless Off lifecycle does not", async t => {
	const f = await fixture(t);
	await f.launch();
	f.change({ runMode: "off" });
	assert.equal(f.host.snapshot().run.status, "running");
	f.change({ runMode: null });
	f.change({ contextRevision: 2 });
	await f.host.idle();
	assert.equal(f.host.snapshot().run.status, "paused");
	await f.host.close();
});

test("explicit restart approval resets cycle and reacquires stopped ownership", async t => {
	const f = await fixture(t);
	await f.launch(); await f.host.pause({ stop: true });
	assert.equal(f.host.snapshot().run.status, "stopped");
	await f.host.resume({ restart: true });
	assert.equal(f.host.snapshot().run.cycle, 2);
	assert.equal(f.host.snapshot().run.hostApprovals.at(-1).action, "restart");
	await f.host.close();
});

test("create-only launch cannot adopt another host's differently approved run", async t => {
	const decision = deferred(); const presented = deferred();
	const f = await fixture(t, { approval: request => { presented.resolve(request); return decision.promise; } });
	const launch = assert.rejects(f.launch(), code("DUPLICATE")); const request = await presented.promise;
	const other = new SwarmHost({ events: f.events, sessionId: "owner1", requestApproval: approved, modelRuntime: f.mock.modelRuntime, mainModel: f.mock.model, tickIntervalMs: 0 });
	await other.launch({ workspace: f.root, runId: "run1", specification: { ...specification, objective: "Another approved objective" } });
	await other.close(); decision.resolve(approved(request)); await launch;
	assert.equal(f.host.snapshot().run, null);
	await f.host.close();
});

for (const action of ["pause", "close"]) {
	test(`${action} accounts for a controller acquired after approval`, async t => {
		const entered = deferred(); const release = deferred();
		const original = SwarmController.open;
		t.after(() => { SwarmController.open = original; });
		SwarmController.open = async options => { const c = await original.call(SwarmController, options); entered.resolve(); await release.promise; return c; };
		const f = await fixture(t);
		const rejected = assert.rejects(f.launch(), code("CANCELLED")); await entered.promise;
		const stopped = f.host[action](); release.resolve(); await stopped; await rejected;
		assert.equal(f.host.snapshot().run.status, "paused");
		assert.equal(f.mock.calls.length, 0);
		if (action === "pause") await f.host.close();
		SwarmController.open = original;
		const reopened = await SwarmController.open({ workspace: f.root, runId: "run1", ownerSessionId: "owner1" });
		await reopened.close();
	});
}

test("pause cancels an approved continuation before it can regain execution authority", async t => {
	const f = await fixture(t); await f.launch(); await f.host.pause();
	const entered = deferred(); const release = deferred();
	const original = SwarmController.prototype.owner;
	t.after(() => { SwarmController.prototype.owner = original; });
	SwarmController.prototype.owner = async function(type, ...args) {
		const result = await original.call(this, type, ...args);
		if (type === "host.continue") { entered.resolve(); await release.promise; }
		return result;
	};
	const rejected = assert.rejects(f.host.resume(), code("CANCELLED")); await entered.promise;
	const paused = f.host.pause(); release.resolve(); await paused; await rejected;
	assert.equal(f.host.snapshot().run.status, "paused");
	assert.throws(() => f.host.wake("builder"), code("HOST_DENIED"));
	await f.host.close();
});

test("close during terminal restart releases the newly acquired controller", async t => {
	const f = await fixture(t); await f.launch(); await f.host.pause({ stop: true });
	const entered = deferred(); const release = deferred();
	const original = SwarmController.open;
	t.after(() => { SwarmController.open = original; });
	SwarmController.open = async options => { const c = await original.call(SwarmController, options); entered.resolve(); await release.promise; return c; };
	const rejected = assert.rejects(f.host.resume({ restart: true }), code("CANCELLED")); await entered.promise;
	const closed = f.host.close(); release.resolve(); await closed; await rejected;
	SwarmController.open = original;
	const reopened = await SwarmController.open({ workspace: f.root, runId: "run1", ownerSessionId: "owner1" });
	assert.equal(reopened.snapshot().status, "stopped");
	await reopened.close();
});

const shellScript = [
	{ toolCalls: [{ id: "create", name: "swarm_task", arguments: { action: "create", id: "task1", title: "Feature", criteria: [0], dependencies: [] } }] },
	{ toolCalls: [{ id: "claim", name: "swarm_task", arguments: { action: "claim", taskId: "task1", kind: "build" } }] },
	{ toolCalls: [{ id: "shell", name: "bash", arguments: { command: "printf unsafe > marker" } }] },
	{ text: "Settled" },
];
async function wakeBuilder(f) {
	await f.host.recruit({ id: "builder", specialization: "build", brief: "Focused implementation", reason: "Approved work" });
	f.host.wake("builder");
}

test("missing safety provider denies actual SDK shell execution", async t => {
	const f = await fixture(t, { script: shellScript }); await f.launch(); await wakeBuilder(f); await f.host.idle();
	assert.equal(existsSync(join(f.root, "marker")), false);
	assert.equal(f.host.snapshot().run.workspace.operations.length, 0);
	assert.ok(f.mock.calls.some(call => call.context.messages.some(message => message.role === "toolResult" && message.isError)));
	await f.host.close();
});

test("mode revocation during a durable execution-start gap prevents the side effect", async t => {
	const entered = deferred(); const release = deferred();
	const original = SwarmController.prototype.system;
	t.after(() => { SwarmController.prototype.system = original; });
	SwarmController.prototype.system = async function(type, ...args) {
		const result = await original.call(this, type, ...args);
		if (type === "workspace.start") { entered.resolve(); await release.promise; }
		return result;
	};
	const f = await fixture(t, { script: shellScript });
	f.events.on("swarm:confirm-request", request => request.claim(() => ({ approved: true })));
	await f.launch(); await wakeBuilder(f); await entered.promise;
	f.change({ selectedMode: "quick", enforcedMode: "off", pendingChange: true });
	release.resolve(); await f.host.idle();
	assert.equal(existsSync(join(f.root, "marker")), false);
	assert.equal(f.host.snapshot().run.status, "paused");
	assert.equal(f.host.snapshot().run.workspace.operations.length, 0);
	await f.host.close();
});
