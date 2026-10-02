import test from "node:test";
import assert from "node:assert/strict";
import { repository } from "./helpers.mjs";
import { createMockRuntime } from "./sdk-env.mjs";
import { SwarmController } from "../extensions/swarm/core.mjs";
import { SwarmSessions } from "../extensions/swarm/sessions.mjs";
import { WorkspaceRuntime } from "../extensions/swarm/workspace.mjs";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";

const code = expected => error => error.code === expected;
function tool(name, args, id = name) { return { toolCalls: [{ id, name, arguments: args }] }; }
async function fixture(t, script, limits, workspaceOptions = {}) {
	const root = repository(t);
	const mock = await createMockRuntime(script);
	const config = { workspace: root, runId: "run1", ownerSessionId: "owner1", clock: () => 0 };
	const c = await SwarmController.open({ ...config, create: { objective: "Implement invitations", criteria: ["Invitations work"], scope: ["src"], limits } });
	const workspace = await WorkspaceRuntime.attach(c, { authorize: async () => true, ...workspaceOptions });
	const driver = await SwarmSessions.attach(c, { workspace, modelRuntime: mock.modelRuntime, mainModel: mock.model, tickIntervalMs: 0 });
	await driver.resume({ reconciled: true });
	return { root, config, mock, c, workspace, driver };
}
const specialist = id => ({ id, specialization: `${id} focus`, brief: "Preserve focused context", reason: "Independent approved work" });
async function shutdown(f) { await f.driver.pause(); await f.driver.close(); }

test("persistent specialist retains identity and context through pause and reopen", async t => {
	const f = await fixture(t, [{ text: "Remember the email decision" }, { text: "I retained the decision" }]);
	const created = await f.driver.recruit(specialist("builder"));
	f.driver.wake("builder"); await f.driver.idle();
	assert.deepEqual(f.driver.snapshot().errors, []);
	assert.equal(f.c.snapshot().sessions.history[0].outcome, "settled");
	assert.ok((await f.driver.history("builder")).some(entry => entry.type === "message"));
	await shutdown(f);
	const c = await SwarmController.open(f.config);
	const workspace = await WorkspaceRuntime.attach(c, { authorize: async () => true });
	const driver = await SwarmSessions.attach(c, { workspace, modelRuntime: f.mock.modelRuntime, mainModel: { provider: "ignored", id: "ignored" }, tickIntervalMs: 0 });
	await driver.resume({ reconciled: true }); driver.wake("builder"); await driver.idle();
	assert.equal(c.snapshot().sessions.workers[0].sessionId, created.sessionId);
	assert.ok(JSON.stringify(f.mock.calls.at(-1).context).includes("Remember the email decision"));
	assert.equal(c.snapshot().sessions.selection.modelId, f.mock.selection.modelId);
	await driver.pause(); await driver.close();
});

test("peer tools wake another specialist without main-agent relaying", async t => {
	const f = await fixture(t, ({ context }) => {
		const system = getCurrentSystemPrompt(context.messages);
		const hasResult = context.messages.some(message => message.role === "toolResult");
		if (system.includes("sender focus") && !hasResult) return tool("swarm_message", { to: "receiver", text: "Use the existing schema" });
		return { text: system.includes("receiver focus") ? "Received the schema decision" : "Sent" };
	});
	await f.driver.recruit(specialist("sender")); await f.driver.recruit(specialist("receiver"));
	f.driver.wake("sender"); await f.driver.idle();
	assert.deepEqual(f.driver.snapshot().errors, []);
	assert.equal(f.c.snapshot().messages.length, 1);
	assert.equal(f.c.snapshot().sessions.workers.find(worker => worker.workerId === "receiver").delivered.length, 1);
	assert.ok(f.mock.calls.some(call => JSON.stringify(call.context).includes("Use the existing schema") && getCurrentSystemPrompt(call.context.messages).includes("receiver focus")));
	await shutdown(f);
});

test("specialists recruit practical run-local peers with identical tool sets", async t => {
	const f = await fixture(t, ({ context }) => {
		if (getCurrentSystemPrompt(context.messages).includes("lead focus") && !context.messages.some(message => message.role === "toolResult")) return tool("swarm_recruit", specialist("database"));
		return { text: "Focused work" };
	});
	await f.driver.recruit(specialist("lead")); f.driver.wake("lead"); await f.driver.idle();
	assert.deepEqual(f.driver.snapshot().errors, []);
	assert.equal(f.c.snapshot().workers.length, 2);
	const sets = f.mock.calls.map(call => getCurrentTools(call.context.messages).map(tool => tool.name).sort());
	for (const set of sets) assert.deepEqual(set, sets[0]);
	assert.ok(sets[0].includes("swarm_recruit"));
	assert.ok(!sets[0].includes("team_spawn"));
	await shutdown(f);
});

test("task assignment stays owned while idle but releases the model execution slot", async t => {
	const f = await fixture(t, ({ context }) => {
		if (!context.messages.some(message => message.role === "toolResult")) {
			const builder = getCurrentSystemPrompt(context.messages).includes("builder focus");
			return tool("swarm_task", { action: "claim", taskId: builder ? "first" : "second", kind: "build" });
		}
		return { text: "Waiting for peer input" };
	}, { active: 1 });
	await f.driver.recruit(specialist("builder")); await f.driver.recruit(specialist("reviewer"));
	for (const id of ["first", "second"]) await f.c.owner("task.create", { id, title: id, criteria: [0], dependencies: [] });
	f.driver.wake("builder"); f.driver.wake("reviewer"); await f.driver.idle();
	assert.deepEqual(f.driver.snapshot().errors, []);
	assert.equal(f.c.snapshot().tasks.filter(task => task.assignment).length, 2);
	assert.equal(f.c.snapshot().sessions.turns.length, 0);
	await shutdown(f);
});

test("pause aborts real SDK streaming and cannot dispatch queued work", async t => {
	const f = await fixture(t, [{ waitForAbort: true }], { active: 1 });
	await f.driver.recruit(specialist("first")); await f.driver.recruit(specialist("second"));
	f.driver.wake("first"); f.driver.wake("second");
	while (!f.mock.calls.length) await new Promise(resolve => setImmediate(resolve));
	const result = await f.driver.pause();
	assert.equal(result.settled, true);
	assert.equal(f.c.snapshot().status, "paused");
	assert.equal(f.mock.calls.length, 1);
	assert.equal(f.c.snapshot().sessions.history[0].outcome, "interrupted");
	assert.equal(f.c.snapshot().sessions.turns.length, 0);
	assert.throws(() => f.driver.wake("second"), code("STATE"));
	await f.driver.close();
});

test("new guidance aborts stale turns and is delivered before further tools", async t => {
	const f = await fixture(t, [{ waitForAbort: true }, { text: "Using new guidance" }]);
	await f.driver.recruit(specialist("builder")); f.driver.wake("builder");
	while (!f.mock.calls.length) await new Promise(resolve => setImmediate(resolve));
	await f.driver.redirect("Use the existing email template"); await f.driver.idle();
	assert.deepEqual(f.driver.snapshot().errors, []);
	assert.equal(f.mock.calls.length, 2);
	assert.ok(JSON.stringify(f.mock.calls[1].context).includes("Use the existing email template"));
	assert.equal(f.c.snapshot().workers[0].guidanceRevision, 1);
	await f.driver.pause(); const calls = f.mock.calls.length;
	await f.driver.redirect("Do not resume automatically"); await f.driver.idle();
	assert.equal(f.mock.calls.length, calls);
	await f.driver.close();
});

test("redirect during admission refreshes guidance without unexpectedly pausing", async t => {
	const f = await fixture(t, [{ text: "Fresh guidance accepted" }]);
	await f.driver.recruit(specialist("builder"));
	let release;
	let entered;
	const gate = new Promise(resolve => { release = resolve; });
	const ready = new Promise(resolve => { entered = resolve; });
	const system = f.c.system.bind(f.c);
	let first = true;
	f.c.system = async (...args) => {
		if (args[0] === "session.turn.start" && first) { first = false; entered(); await gate; }
		return system(...args);
	};
	f.driver.wake("builder"); await ready;
	await f.driver.redirect("New guidance before admission"); release(); await f.driver.idle();
	assert.equal(f.c.snapshot().status, "running");
	assert.deepEqual(f.driver.snapshot().errors, []);
	assert.equal(f.mock.calls.length, 1);
	assert.ok(JSON.stringify(f.mock.calls[0].context).includes("New guidance before admission"));
	await shutdown(f);
});

test("terminal provider errors consume the assigned task attempt", async t => {
	const f = await fixture(t, [tool("swarm_task", { action: "claim", taskId: "first", kind: "build" }), { error: "Mock provider failure" }]);
	await f.driver.recruit(specialist("builder"));
	await f.c.owner("task.create", { id: "first", title: "Feature", criteria: [0], dependencies: [] });
	f.driver.wake("builder"); await f.driver.idle();
	assert.equal(f.c.snapshot().sessions.history[0].outcome, "failed");
	assert.equal(f.c.snapshot().tasks[0].failures, 1);
	assert.equal(f.c.snapshot().tasks[0].assignment, null);
	await shutdown(f);
});

test("cancellation during failure accounting still retires the SDK turn", async t => {
	const f = await fixture(t, [tool("swarm_task", { action: "claim", taskId: "first", kind: "build" }), { error: "Mock failure" }]);
	await f.driver.recruit(specialist("builder"));
	await f.c.owner("task.create", { id: "first", title: "Feature", criteria: [0], dependencies: [] });
	let release; let entered;
	const gate = new Promise(resolve => { release = resolve; });
	const ready = new Promise(resolve => { entered = resolve; });
	const worker = f.c.worker.bind(f.c);
	f.c.worker = id => {
		const bound = worker(id);
		return { dispatch: async (type, ...args) => {
			if (type === "task.fail") { entered(); await gate; }
			return bound.dispatch(type, ...args);
		} };
	};
	f.driver.wake("builder"); await ready;
	const pause = f.driver.pause(); release();
	assert.equal((await pause).settled, true);
	assert.equal(f.c.snapshot().sessions.turns.length, 0);
	assert.equal(f.c.snapshot().sessions.history.at(-1).outcome, "interrupted");
	assert.equal(f.c.snapshot().tasks[0].assignment, null);
	assert.deepEqual(f.driver.snapshot().errors, []);
	await f.driver.close();
});

test("native driver compaction preserves specialist identity and refreshes shared state", async t => {
	const f = await fixture(t, [{ text: "First decision" }, { text: "Second decision" }, { text: "Preserved focused decisions and unresolved questions" }, { text: "Continuing with current state" }]);
	const created = await f.driver.recruit(specialist("builder"));
	f.driver.wake("builder", "Decision context ".repeat(15000)); await f.driver.idle();
	f.driver.wake("builder", "More context ".repeat(15000)); await f.driver.idle();
	await f.driver.compact("builder");
	assert.deepEqual(f.driver.snapshot().errors, []);
	assert.ok((await f.driver.history("builder", 100)).some(entry => entry.type === "compaction"));
	assert.equal(f.c.snapshot().sessions.workers[0].sessionId, created.sessionId);
	f.driver.wake("builder"); await f.driver.idle();
	assert.ok(JSON.stringify(f.mock.calls.at(-1).context).includes("guidance"));
	assert.equal(f.c.snapshot().sessions.history.filter(turn => turn.kind === "compaction").length, 1);
	await shutdown(f);
});

test("pause timeout does not release an SDK turn with an unsettled tool", async t => {
	let release; let entered;
	const gate = new Promise(resolve => { release = resolve; });
	const ready = new Promise(resolve => { entered = resolve; });
	const f = await fixture(t, [tool("swarm_task", { action: "claim", taskId: "first", kind: "build" }), tool("bash", { command: "true" })], undefined, { authorize: async () => { entered(); await gate; return true; } });
	await f.driver.recruit(specialist("builder"));
	await f.c.owner("task.create", { id: "first", title: "Feature", criteria: [0], dependencies: [] });
	f.driver.wake("builder"); await ready;
	assert.equal((await f.driver.pause({ timeoutMs: 1 })).settled, false);
	assert.equal(f.c.snapshot().sessions.turns.length, 1);
	await assert.rejects(f.c.system("run.settle"), code("UNSETTLED"));
	release(); await f.driver.idle();
	assert.equal(f.c.snapshot().status, "paused");
	assert.equal(f.c.snapshot().sessions.turns.length, 0);
	await f.driver.close();
});

test("real SDK coding tools use guarded claims and recorded command evidence", async t => {
	const f = await fixture(t, ({ context }) => {
		const results = context.messages.filter(message => message.role === "toolResult");
		switch (results.length) {
			case 0: return tool("swarm_task", { action: "claim", taskId: "build", kind: "build" });
			case 1: return tool("swarm_files", { action: "claim", paths: ["feature.txt"] });
			case 2: return tool("read", { path: "feature.txt" });
			case 3: return tool("write", { path: "feature.txt", content: "implemented" });
			case 4: return tool("bash", { command: "test -f feature.txt" });
			case 5: {
				const execution = JSON.parse(results.at(-1).content[0].text).executionId;
				return tool("swarm_report", { action: "submit", summary: "Implemented", receipts: [execution] });
			}
			default: return { text: "Awaiting independent review" };
		}
	});
	await f.driver.recruit(specialist("builder"));
	await f.c.owner("task.create", { id: "build", title: "Feature", criteria: [0], dependencies: [] });
	f.driver.wake("builder"); await f.driver.idle();
	assert.deepEqual(f.driver.snapshot().errors, []);
	assert.equal(f.c.snapshot().tasks[0].status, "submitted");
	assert.equal(f.c.snapshot().tasks[0].assignment, null);
	assert.equal(f.c.snapshot().workspace.receipts.length, 2);
	assert.ok(f.mock.calls.every(call => !call.context.messages.some(message => message.role === "toolResult" && message.isError)));
	await shutdown(f);
});
