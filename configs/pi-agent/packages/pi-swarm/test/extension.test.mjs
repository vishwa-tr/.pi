import { mainAgentAction } from "./main-agent-actions.mjs";
import { prepareLayout } from "../extensions/swarm/store/layout.mjs";
import test from "node:test";
import { join } from "node:path";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { repository } from "./helpers.mjs";
import { createMockRuntime } from "./sdk-env.mjs";
import { matchesKey } from "@earendil-works/pi-tui";
import { SwarmController } from "../extensions/swarm/core.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createSwarmExtension } from "../extensions/swarm/extension.mjs";

function dashboardUI(f) {
	let view;
	f.ctx.ui.custom = factory => new Promise(resolve => {
		f.event("ui_prompt_start", { kind: "custom" });
		const bindings = { matches: (data, action) => matchesKey(data, action === "tui.select.cancel" ? "escape" : action === "tui.select.confirm" ? "enter" : "up") };
		view = factory({ terminal: { rows: 24 }, requestRender() {} }, { fg: (_, text) => text }, bindings, resolve);
	});
	return () => view;
}

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function until(predicate) {
	for (let i = 0; i < 1000; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
	assert.fail("Condition did not settle");
}
async function fixture(t, { script = () => ({ text: "Mock planning complete" }), runner, entries = [], root, mock, approvalTimeoutMs } = {}) {
	root ??= repository(t);
	mock ??= await createMockRuntime(script);
	const events = new EventEmitter();
	const handlers = new Map(); const commands = new Map(); const notices = []; const prompts = [];
	const mode = { version: 1, instanceId: "instance1", revision: 1, contextRevision: 1, ready: true, sessionId: "owner1", selectedMode: "off", enforcedMode: "off", runMode: null, pendingChange: false };
	events.on("pi-plan:query-mode", request => request.respond({ ...mode }));
	events.on("swarm:confirm-request", request => request.claim(async () => ({ approved: true })));
	const responses = { input: [], select: [], confirm: [] };
	const dialog = kind => async (...args) => {
		prompts.push({ kind, args });
		const answer = responses[kind].shift();
		if (typeof answer === "function") return answer(...args);
		if (answer !== undefined) return answer;
		if (kind === "select") return ["Approve", "Preserve existing work", "Continue", "Attest settlement"].find(choice => args[1].includes(choice));
		if (kind === "confirm") return true;
		return "All processes independently checked and stopped in the mock fixture";
	};
	const ctx = { cwd: root, mode: "tui", hasUI: true, isIdle: () => true,
		sessionManager: { getSessionId: () => "owner1", getSessionFile: () => "owner.jsonl", getEntries: () => entries, getBranch: () => entries },
		ui: { input: dialog("input"), select: dialog("select"), confirm: dialog("confirm"), notify: (text, level) => notices.push({ text, level }) } };
	const tools = new Map(); const messages = [];
	const pi = { registerMessageRenderer() {}, registerTool: tool => tools.set(tool.name, tool), sendMessage: (message, options) => { messages.push({ message, options }); if (message.customType === "swarm-agreement") prompts.push({ kind: "packet", args: [message.content] }); }, events, on: (name, handler) => handlers.set(name, handler), registerCommand: (name, command) => commands.set(name, command), appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }) };
	createSwarmExtension({ modelRuntime: mock.modelRuntime, mainModel: mock.model, runner, tickIntervalMs: 0, approvalTimeoutMs })(pi);
	const slashCommand = args => commands.get("swarm").handler(args, ctx);
 const command = args => mainAgentAction(tools, ctx, args, output => prompts.push({ kind: "packet", args: [output.content[0].text] }));
	const event = (name, data = {}) => handlers.get(name)(data, ctx);
	const status = async () => { await command("status"); return JSON.parse(notices.at(-1).text); };
	const packets = () => prompts.filter(p => p.kind === "packet").map(p => p.args[0]);
	return { slashCommand, commands, tools, messages, root, mock, entries, notices, prompts, responses, ctx, command, event, status, events, mode, packets };
}

test("factory is opt-in and rejects absent or live runtimes without registration", () => {
	assert.throws(() => createSwarmExtension());
	assert.throws(() => createSwarmExtension({ mainModel: { provider: "live", api: "live" }, modelRuntime: {} }));
});

test("editable agreement and explicit preservation launch a real mock SDK planner; shutdown/reload stays paused", async t => {
	const f = await fixture(t);
	writeFileSync(join(f.root, "user.txt"), "preserve\n");
	f.responses.input.push('"Edited goal"');
	f.responses.select.push("Edit agreement", "objective", "Approve", "Preserve existing work");
	await f.command("start Original goal");
	await until(() => f.mock.calls.length === 1);
	assert.equal((await f.status()).objective, "Edited goal");
	assert.equal(readFileSync(join(f.root, "user.txt"), "utf8"), "preserve\n");
	assert.equal(f.entries.length, 1);
	await f.event("session_shutdown", { reason: "reload" });
	const reloaded = await fixture(t, { root: f.root, mock: f.mock, entries: f.entries });
	await reloaded.event("session_start", { reason: "reload" });
	assert.equal((await reloaded.status()).status, "paused");
	assert.equal(f.mock.calls.length, 1);
	await reloaded.command("resume");
	await until(() => f.mock.calls.length === 2);
	assert.equal((await reloaded.status()).cycle, 1);
	await reloaded.command("stop");
	assert.equal((await reloaded.status()).status, "stopped");
	await reloaded.command("restart");
	assert.equal((await reloaded.status()).cycle, 2);
	await reloaded.event("session_shutdown");
});

for (const field of ["criteria", "scope"]) {
	test(`${field} remains editable in the approval screen`, async t => {
		const f = await fixture(t);
		f.responses.select.push("Edit agreement", field, "Cancel");
		f.responses.input.push('["Explicit requirement", "No deployment"]');
		await assert.rejects(f.command("start goal"));
		const decisions = f.prompts.filter(p => p.kind === "select" && p.args[1].includes("Approve"));
		assert.equal(decisions.length, 2);
		assert.equal(f.packets().length, 2);
		assert.match(f.packets()[1], /Explicit requirement/);
		assert.match(f.packets()[1], /No deployment/);
		assert.equal(f.prompts.indexOf(decisions[1]) - 1, f.prompts.findLastIndex(p => p.kind === "packet"), "Edited agreement shown before deciding");
		assert.equal(f.prompts.filter(p => p.kind === "input").length, 1);
		assert.equal(existsSync(join(prepareLayout(f.root, "run1").stateRoot)), false);
		assert.equal(f.mock.calls.length, 0);
		await f.event("session_shutdown");
	});
}

for (const supplied of [true]) {
	test(`${supplied ? "supplied" : "prompted"} objective reaches one agreement without redundant questions`, async t => {
		const f = await fixture(t);
		const objective = "Fix src/example.js.\n  Preserve spacing; no new dependencies. Run tests.";
		if (!supplied) f.responses.input.push(objective);
		f.responses.select.push("Cancel");
		await assert.rejects(f.command(supplied ? `start ${objective}` : "start"));
		assert.equal(f.prompts.filter(p => p.kind === "input").length, supplied ? 0 : 1);
		const decisions = f.prompts.filter(p => p.kind === "select");
		assert.equal(decisions.length, 1);
		assert.equal(f.packets().length, 1);
		assert.ok(f.packets()[0].includes(JSON.stringify(objective)));
		assert.match(f.packets()[0], /requirements in the approved objective/);
		assert.match(f.packets()[0], /file and dependency constraints/);
		assert.equal(f.messages.filter(item => item.message.customType === "swarm-agreement").length, 0);
		assert.equal(f.mock.calls.length, 0);
		assert.equal(existsSync(join(prepareLayout(f.root, "run1").stateRoot)), false);
		await f.event("session_shutdown");
	});
}

test("maximum-length objective is preserved without duplicating it into seeded fields", async t => {
	const f = await fixture(t);
	const constraints = "\nOnly src/example.js; no new dependencies; run the existing tests.";
	const objective = "x".repeat(32768 - constraints.length) + constraints;
	await f.command(`start ${objective}`);
	await until(() => f.mock.calls.length === 1);
	assert.equal((await f.status()).objective, objective);
	const quotedObjective = JSON.stringify(objective); // Worker instructions contain a JSON data record.
	assert.ok(JSON.stringify(f.mock.calls[0].context).includes(JSON.stringify(quotedObjective).slice(1, -1)));
	assert.equal(f.prompts.filter(p => p.kind === "input").length, 0);
	await f.event("session_shutdown");
});

test("malformed agreement edit retains original and permits a corrected edit", async t => {
	const f = await fixture(t);
	f.responses.input.push('[', '"Corrected goal"');
	f.responses.select.push("Edit agreement", "objective", "Edit agreement", "objective", "Approve");
	await f.command("start goal");
	assert.equal((await f.status()).objective, "Corrected goal");
	assert.ok(f.notices.some(n => n.text === "Invalid JSON; agreement unchanged"));
	await f.event("session_shutdown");
});

test("invalid agreement value returns a sanitized main-tool error", async t => {
	const f = await fixture(t);
	f.responses.input.push('[]');
	f.responses.select.push("Edit agreement", "objective", "Approve");
	await assert.rejects(f.command("start goal"), /Swarm request refused/);
	assert.equal(f.mock.calls.length, 0);
	assert.equal(existsSync(join(prepareLayout(f.root, "run1").stateRoot)), false);
	await f.event("session_shutdown");
});

for (const stage of ["approval", "preservation"]) {
	test(`cancel at ${stage} creates no storage or SDK calls`, async t => {
		const f = await fixture(t);
		if (stage === "approval") f.responses.select.push("Cancel");
		if (stage === "preservation") f.responses.select.push("Approve", "Cancel");
		if (stage === "objective") f.responses.input.push(() => undefined);
		if (["approval", "preservation"].includes(stage)) await assert.rejects(f.command("start goal"));
		else await f.command("start");
		assert.equal(existsSync(join(prepareLayout(f.root, "run1").stateRoot)), false);
		assert.equal(f.mock.calls.length, 0);
		await f.event("session_shutdown");
	});
}

for (const action of ["pause", "stop", "shutdown", "tree", "mode"]) {
	test(`${action} cancels active approval and rejects a late human answer`, async t => {
		const f = await fixture(t); const shown = deferred(); const answer = deferred();
		f.responses.select.push((title, choices, options) => { shown.resolve(options.signal); return answer.promise; });
		const launch = assert.rejects(f.command("start goal"));
		const signal = await shown.promise;
		if (action === "shutdown") await f.event("session_shutdown");
		else if (action === "tree") await f.event("session_before_tree");
		else if (action === "mode") { Object.assign(f.mode, { revision: 2, selectedMode: "plan" }); f.events.emit("pi-plan:mode-changed", { ...f.mode }); }
		else await f.command(action);
		assert.equal(signal.aborted, true);
		answer.resolve("Approve"); await launch;
		assert.equal(existsSync(join(prepareLayout(f.root, "run1").stateRoot)), false);
		assert.equal(f.mock.calls.length, 0);
		await f.event("session_shutdown");
	});
}

test("main-tool approval streams its packet while the main agent is busy", async t => {
 const f = await fixture(t); f.ctx.isIdle = () => false; f.responses.select.push("Cancel");
 await assert.rejects(f.command("start goal"));
 assert.equal(f.packets().length, 1); assert.equal(f.mock.calls.length, 0);
 await f.event("session_shutdown");
});

test("run link follows the active branch, not every session entry", async t => {
	const f = await fixture(t); await f.command("start goal"); await f.command("pause"); await f.event("session_shutdown");
	const other = await fixture(t, { root: f.root, entries: f.entries, mock: f.mock });
	other.ctx.sessionManager.getBranch = () => [];
	await other.event("session_start", { reason: "resume" });
	await other.command("status"); assert.match(other.notices.at(-1).text, /No Swarm/);
	await other.event("session_shutdown");
	const linked = await fixture(t, { root: f.root, entries: f.entries, mock: f.mock });
	await linked.event("session_start", { reason: "resume" });
	assert.equal((await linked.status()).status, "paused", JSON.stringify(linked.notices));
	await linked.event("session_shutdown");
});

for (const mode of ["rpc", "json", "print"]) {
	test(`${mode} cannot authorize execution`, async t => {
		const f = await fixture(t); f.ctx.mode = mode;
		await assert.rejects(f.command("start goal"));
		assert.equal(f.prompts.length, 0); assert.equal(f.mock.calls.length, 0);
		await f.event("session_shutdown");
	});
}

test("fork does not inherit the owner link or take checkout control", async t => {
	const f = await fixture(t); await f.command("start goal"); await f.command("pause"); await f.event("session_shutdown");
	const fork = await fixture(t, { root: f.root, entries: f.entries, mock: f.mock });
	fork.ctx.sessionManager.getSessionId = () => "fork1";
	await fork.event("session_start", { reason: "fork" });
	await fork.command("status"); assert.match(fork.notices.at(-1).text, /No Swarm/);
	await assert.rejects(fork.command(`restore ${f.entries[0].data.runId}`));
	await fork.event("session_shutdown");
});

test("streaming mock SDK work is actually aborted before reload releases controller ownership", async t => {
	const f = await fixture(t, { script: () => ({ waitForAbort: true }) });
	await f.command("start goal"); await until(() => f.mock.calls.length === 1);
	await f.event("session_shutdown", { reason: "reload" });
	assert.equal(f.mock.calls[0].options.signal.aborted, true);
	const c = await SwarmController.open({ workspace: f.root, runId: f.entries[0].data.runId, ownerSessionId: "owner1" });
	assert.equal(c.snapshot().status, "paused"); assert.equal(c.snapshot().sessions.turns.length, 0);
	await c.close();
});

for (const boundary of ["open", "recruit"]) {
	test(`shutdown waits for late ${boundary} acquisition and prevents planner dispatch`, async t => {
		const f = await fixture(t); const entered = deferred(); const release = deferred();
		const originalOpen = SwarmController.open;
		const originalOwner = SwarmController.prototype.owner;
		t.after(() => { SwarmController.open = originalOpen; SwarmController.prototype.owner = originalOwner; });
		if (boundary === "open") SwarmController.open = async options => { const c = await originalOpen(options); entered.resolve(); await release.promise; return c; };
		else SwarmController.prototype.owner = async function(type, ...args) { const value = await originalOwner.call(this, type, ...args); if (type === "worker.create") { entered.resolve(); await release.promise; } return value; };
		const launch = assert.rejects(f.command("start goal")); await entered.promise;
		const shutdown = f.event("session_shutdown"); release.resolve(); await shutdown; await launch;
		assert.equal(f.mock.calls.length, 0);
		SwarmController.open = originalOpen; SwarmController.prototype.owner = originalOwner;
		// Late acquisition must not retain a live lock, even when shutdown predated the owner link.
		const { readdirSync } = await import("node:fs");
		const runId = readdirSync(join(prepareLayout(f.root, "run1").stateRoot)).find(name => /^[a-f0-9-]{36}$/.test(name));
		const c = await SwarmController.open({ workspace: f.root, runId, ownerSessionId: "owner1" });
		assert.equal(c.snapshot().status, "paused"); await c.close();
	});
}

const shellScript = [
	{ toolCalls: [{ name: "swarm_task", arguments: { action: "create", id: "task1", title: "Check", criteria: [0], dependencies: [] } }] },
	{ toolCalls: [{ name: "swarm_task", arguments: { action: "claim", taskId: "task1", kind: "build" } }] },
	{ toolCalls: [{ name: "bash", arguments: { command: "mock uncertain command" } }] },
];

for (const action of ["pause", "shutdown"]) {
	test(`${action} cancels SDK tool safety confirmation before actual runner admission`, async t => {
		let executions = 0;
		const f = await fixture(t, { script: shellScript, runner: async () => { executions++; return { settled: true, exitCode: 0 }; } });
		const shown = deferred(); const answer = deferred();
		f.events.removeAllListeners("swarm:confirm-request");
		f.events.on("swarm:confirm-request", envelope => envelope.claim(request => { shown.resolve(request.signal); return answer.promise; }));
		await f.command("start goal"); const signal = await shown.promise;
		if (action === "pause") await f.command("pause");
		else await f.event("session_shutdown");
		assert.equal(signal.aborted, true);
		answer.resolve({ approved: true }); await Promise.resolve();
		assert.equal(executions, 0);
		if (action === "pause") await f.event("session_shutdown");
	});
}

test("agreement editing is cancelled by shutdown with no late launch", async t => {
	const f = await fixture(t); const shown = deferred(); const answer = deferred();
	f.responses.select.push("Edit agreement", "objective");
	f.responses.input.push((_title, _placeholder, options) => { shown.resolve(options.signal); return answer.promise; });
	const launch = assert.rejects(f.command("start goal")); const signal = await shown.promise;
	await f.event("session_shutdown"); assert.equal(signal.aborted, true);
	answer.resolve('"Late edit"'); await launch;
	assert.equal(existsSync(join(prepareLayout(f.root, "run1").stateRoot)), false);
});

test("timed-out native launch decision receives cancellation and cannot create storage", async t => {
	const f = await fixture(t, { approvalTimeoutMs: 30 }); const shown = deferred(); const answer = deferred();
	f.responses.select.push((_title, _choices, options) => { shown.resolve(options.signal); return answer.promise; });
	const launch = assert.rejects(f.command("start goal")); const signal = await shown.promise;
	await launch; assert.equal(signal.aborted, true); answer.resolve("Approve");
	assert.equal(existsSync(join(prepareLayout(f.root, "run1").stateRoot)), false);
	await f.event("session_shutdown");
});

test("live uncertain shell requires explicit evidence; attestation does not manufacture successful receipts", async t => {
	const f = await fixture(t, { script: shellScript, runner: async () => ({ settled: false, exitCode: null }) });
	await f.command("start goal");
	await until(() => f.mock.calls.length === 3);
	let state;
	for (let i = 0; i < 100; i++) { state = await f.status(); if (state.unresolvedOperations[0]?.uncertain) break; await new Promise(resolve => setTimeout(resolve, 2)); }
	assert.equal(state.status, "pausing"); assert.equal(state.unresolvedOperations.length, 1);
	f.responses.input.push(" ");
	await assert.rejects(f.command("reconcile"));
	assert.equal((await f.status()).unresolvedOperations.length, 1);
	await f.command("reconcile");
	await f.command("pause");
	assert.equal((await f.status()).status, "paused");
	await f.event("session_shutdown");
	const c = await SwarmController.open({ workspace: f.root, runId: f.entries[0].data.runId, ownerSessionId: "owner1" });
	assert.equal(c.snapshot().workspace.receipts[0].outcome, "unknown");
	assert.equal(c.snapshot().settlementAttestations.length, 1);
	assert.equal(f.mock.calls.length, 3);
	await c.close();
});

for (const action of ["close", "pause", "stop", "tree", "shutdown", "prompt"]) {
 test(`dashboard ${action} disposes inspection without spontaneous dispatch`, async t => {
  const f = await fixture(t, { script: () => ({ waitForAbort: true }) });
  const view = dashboardUI(f);
  await f.command("start goal"); await until(() => f.mock.calls.length === 1);
  const rawOpened = f.command("dashboard");
  const opened = action === "shutdown" ? assert.rejects(rawOpened) : rawOpened;
  assert.match(view().render(60).join("\n"), /SWARM live/);
  if (action === "close") view().handleInput("\x1b");
  else if (action === "pause") await f.command("pause");
  else if (action === "stop") await f.slashCommand("stop");
  else if (action === "tree") await f.event("session_before_tree");
  else if (action === "shutdown") await f.event("session_shutdown", { reason: "reload" });
  else await f.event("ui_prompt_start", { kind: "confirm" });
  await opened;
  assert.equal(view().closed, true);
  assert.equal(f.mock.calls.length, 1);
  if (action === "pause") assert.equal((await f.status()).status, "paused");
  if (action === "stop") assert.equal((await f.status()).status, "stopped");
  await f.event("session_shutdown");
 });
}

test("dashboard continuation closes before human approval and cannot overlap controls", async t => {
 const f = await fixture(t); const view = dashboardUI(f);
 await f.command("start goal"); await f.command("pause");
 f.responses.select.push(() => { assert.equal(view().closed, true); return "Cancel"; });
 const opened = f.command("");
 await assert.rejects(f.command("resume"));
 view().handleInput("r");
 assert.equal(view().closed, false);
 view().handleInput("\x1b"); await opened;
 await assert.rejects(f.command("resume"));
 assert.equal((await f.status()).status, "paused");
 await f.event("session_shutdown");
});

test("worker safety approval dismisses dashboard first and blocks reopening until settled", async t => {
	const ready = deferred(); const answer = deferred(); let shown = false;
	const f = await fixture(t, { script: async ({ index }) => {
		if (index === 0) { await ready.promise; return { toolCalls: [{ name: "swarm_task", arguments: { action: "create", id: "task1", title: "Check", criteria: [0], dependencies: [] } }] }; }
		if (index === 1) return { toolCalls: [{ name: "swarm_task", arguments: { action: "claim", taskId: "task1", kind: "build" } }] };
		if (index === 2) return { toolCalls: [{ name: "bash", arguments: { command: "true" } }] };
		return { text: "Done" };
	} });
	const view = dashboardUI(f);
	f.events.removeAllListeners("swarm:confirm-request");
	f.events.on("swarm:confirm-request", request => request.claim(async () => {
		assert.equal(view().closed, true); shown = true; return answer.promise;
	}));
	await f.command("start goal");
	const opened = f.command("dashboard"); ready.resolve();
	await until(() => shown); await opened;
	await assert.rejects(f.command("dashboard"));
	answer.resolve({ approved: false });
	await f.command("pause"); await f.event("session_shutdown");
});

test("dashboard with no run is read-only; foreign session cannot use brakes or inspect host", async t => {
 const f = await fixture(t); const view = dashboardUI(f);
 const opened = f.command(""); view().handleInput("\x1b"); await opened;
 assert.equal(existsSync(join(prepareLayout(f.root, "run1").stateRoot)), false);
 assert.equal(f.mock.calls.length, 0);
 await f.command("start goal");
 f.ctx.sessionManager.getSessionId = () => "other";
 for (const action of ["dashboard", "pause", "stop", "status"]) await assert.rejects(f.command(action));
 await f.event("session_shutdown");
});

test("only /swarm stop is exposed; other slash actions are inert", async t => {
 const f = await fixture(t);
 assert.deepEqual([...f.commands.keys()], ["swarm"]);
 assert.equal(f.commands.get("swarm").getArgumentCompletions("stop"), null);
 assert.deepEqual(f.commands.get("swarm").getArgumentCompletions(""), [{ value: "stop", label: "stop" }]);
 for (const action of ["", "start goal", "status", "pause", "restore run1", "resume", "restart", "reconcile", "dashboard"]) await f.slashCommand(action);
 assert.equal(f.prompts.length, 0); assert.equal(f.mock.calls.length, 0); assert.equal(f.entries.length, 0);
 assert.ok(f.notices.every(notice => notice.text.includes("main agent")));
 await f.command("start goal"); await f.slashCommand("stop");
 assert.equal((await f.status()).status, "stopped"); await f.event("session_shutdown");
});
