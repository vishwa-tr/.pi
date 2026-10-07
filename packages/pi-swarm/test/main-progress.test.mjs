import test from "node:test";
import assert from "node:assert/strict";
import { createProgress } from "../extensions/swarm/progress.mjs";
import { registerMainTools, swarmSummary } from "../extensions/swarm/main-tools.mjs";

function fixture(t) {
	const snapshot = { run: { objective: "Fixture objective", status: "running", revision: 1, cycle: 1,
		workers: [{ id: "planner" }], tasks: [], sessions: { turns: [] }, workspace: { operations: [] } }, pendingApproval: false };
	const listeners = new Set(); const messages = [];
	let current = true;
	const pi = { sendMessage: (...args) => messages.push(args) };
	const host = { snapshot: () => structuredClone(snapshot), subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
	const progress = createProgress(pi, () => current);
	progress.bind(host);
	t.after(() => progress.dispose());
	return { snapshot, messages, listeners, progress, invalidate: () => { current = false; },
		update: () => { for (const listener of listeners) listener("fixture"); } };
}

const delay = () => new Promise(resolve => setTimeout(resolve, 800));

test("chat progress is event driven, starts once, coalesces completions and sends no model turns", async t => {
	const f = fixture(t); f.progress.launched();
	assert.equal(f.messages.length, 1);
	for (let i = 0; i < 40; i++) f.update();
	assert.equal(f.messages.length, 1);
	f.snapshot.run.tasks.push({ id: "task", title: "Task", status: "done", assignment: null });
	f.update(); f.update();
	f.snapshot.run.status = "completed"; f.update(); f.update();
	await delay();
	assert.equal(f.messages.length, 2);
	assert.match(f.messages[1][0].content, /task completion recorded.*run completed/);
	assert.ok(f.messages.every(([, options]) => options.triggerTurn === false));
	for (let i = 0; i < 20; i++) f.update();
	await delay(); assert.equal(f.messages.length, 2);
});

test("approval notices wait for native focus; dispose removes listeners and pending messages", async t => {
	const f = fixture(t); f.progress.launched();
	f.snapshot.pendingApproval = true; f.update();
	await delay(); assert.equal(f.messages.length, 1);
	f.snapshot.pendingApproval = false; f.update();
	await delay(); assert.equal(f.messages.length, 2);
	assert.match(f.messages[1][0].content, /human approval requested/);
	f.snapshot.run.status = "paused"; f.update();
	f.progress.dispose();
	assert.equal(f.listeners.size, 0);
	await delay(); assert.equal(f.messages.length, 2);
});

test("inspection/restoration and stale owner context do not generate chat or model activity", async t => {
	const f = fixture(t);
	f.update(); await delay(); assert.equal(f.messages.length, 0);
	f.progress.launched();
	f.snapshot.run.status = "stopped"; f.update(); f.invalidate();
	await delay(); assert.equal(f.messages.length, 1);
});

test("status bounds large boards, counts all tasks, and omits private host fields", () => {
	const snapshot = { errors: ["PRIVATE_ERROR"], run: { objective: "界".repeat(10000), status: "running", cycle: 1, revision: 1,
		workspaceRoot: "PRIVATE_HOST_PATH", ownerSessionId: "PRIVATE_OWNER", hostApprovals: [{ provider: "PRIVATE_PROVIDER" }],
		workers: [{ id: "planner" }], tasks: Array.from({ length: 500 }, (_, i) => ({ id: `task${i}`, title: "界".repeat(300), status: "blocked", blocker: "blocked", assignment: null })),
		sessions: { turns: [{ workerId: "planner" }] }, workspace: { operations: [] } } };
	const summary = swarmSummary(snapshot);
	assert.equal(summary.tasks.length, 50); assert.equal(summary.tasksTruncated, true);
	assert.equal(summary.progress.total, 500); assert.equal(summary.progress.blocked, 500);
	assert.equal(summary.objective.length, 512); assert.equal(summary.objectiveTruncated, true);
	assert.equal(summary.errorsPresent, true);
	assert.doesNotMatch(JSON.stringify(summary), /PRIVATE_/);
});

test("main history pages preserve positions and omit provider diagnostics, signatures and host metadata", async () => {
	const tools = new Map();
	const entries = Array.from({ length: 31 }, (_, i) => ({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "x".repeat(i === 0 ? 3000 : 4), textSignature: "PRIVATE_SIGNATURE" }], errorMessage: "PRIVATE_ERROR", responseId: "PRIVATE_RESPONSE" } }));
	registerMainTools({ registerTool: tool => tools.set(tool.name, tool) }, { inspect: () => ({ status: "paused" }), history: () => entries });
	const result = await tools.get("swarm_history").execute("id", { workerId: "planner", offset: 0, limit: 20 }, undefined, undefined, {});
	assert.equal(result.details.total, 31); assert.equal(result.details.nextOffset, 20);
	assert.equal(result.details.entries[0].truncated, true);
	assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
	const next = await tools.get("swarm_history").execute("id", { workerId: "planner", offset: 20, limit: 20 }, undefined, undefined, {});
	assert.equal(next.details.entries.length, 11); assert.equal(next.details.nextOffset, null);
	assert.equal(entries.length, 31);
});
