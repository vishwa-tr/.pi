import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { matchesKey } from "@earendil-works/pi-tui";
import { repository } from "./helpers.mjs";
import { createMockRuntime } from "./sdk-env.mjs";
import { mainAgentAction } from "./main-agent-actions.mjs";
import { createSwarmExtension } from "../extensions/swarm/extension.mjs";
import { SwarmController } from "../extensions/swarm/core.mjs";
import { prepareLayout } from "../extensions/swarm/store/layout.mjs";

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function until(predicate) { for (let i = 0; i < 1000; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); } assert.fail("Condition did not settle"); }
async function fixture(t, { script = () => ({ text: "Mock planning complete" }), runner, entries = [], root, mock, approvalTimeoutMs } = {}) {
	root ??= repository(t); mock ??= await createMockRuntime(script);
	const events = new EventEmitter(), handlers = new Map(), commands = new Map(), tools = new Map(), notices = [], packets = [], messages = [], replies = [];
	const mode = { version: 1, instanceId: "instance1", revision: 1, contextRevision: 1, ready: true, sessionId: "owner1", selectedMode: "off", enforcedMode: "off", runMode: null, pendingChange: false };
	events.on("pi-plan:query-mode", request => request.respond({ ...mode }));
	events.on("swarm:confirm-request", request => request.claim(async () => ({ approved: true })));
	const dialog = async () => assert.fail("Swarm must not open a confirmation/input/select dialog");
	const ctx = { cwd: root, mode: "tui", hasUI: true, isIdle: () => true,
		sessionManager: { getSessionId: () => "owner1", getSessionFile: () => "owner.jsonl", getEntries: () => entries, getBranch: () => entries },
		ui: { input: dialog, select: dialog, confirm: dialog, notify: (text, level) => notices.push({ text, level }) } };
	const pi = { registerMessageRenderer() {}, registerEntryRenderer() {}, registerTool: tool => tools.set(tool.name, tool), sendMessage: (message, options) => messages.push({ message, options }), events,
		on: (name, handler) => handlers.set(name, handler), registerCommand: (name, command) => commands.set(name, command), appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }) };
	createSwarmExtension({ modelRuntime: mock.modelRuntime, mainModel: mock.model, runner, tickIntervalMs: 0, approvalTimeoutMs })(pi);
	const event = (name, data = {}) => handlers.get(name)(data, ctx);
	const update = output => packets.push(output.content[0].text);
	const tool = (name, args, signal) => tools.get(name).execute("test-owner", args, signal, update, ctx);
	const input = text => event("input", { source: "interactive", text });
	const consume = p => tool(p.action === "start" ? "swarm_start" : "swarm_control", { ...(p.action === "start" ? {} : { action: p.action }), proposalId: p.proposalId });
	const propose = async args => { const r = await tool("swarm_start", args); assert.equal(r.isError, undefined, r.details.error); return r.details; };
	const command = text => mainAgentAction(tools, ctx, text, update, async p => { const reply = replies.shift(); await input(typeof reply === "function" ? await reply(p) : reply ?? (p.action === "reconcile" ? "I confirm settlement: independently verified all listed processes stopped" : "yes")); });
	const status = async () => { await command("status"); return JSON.parse(notices.at(-1).text); };
	t.after(() => event("session_shutdown"));
	return { root, mock, events, mode, ctx, tools, entries, notices, messages, packets, replies, event, tool, input, consume, propose, command, status, slash: args => commands.get("swarm").handler(args, ctx), commands };
}
function dashboardUI(f) { let view; f.ctx.ui.custom = factory => new Promise(resolve => {
	f.event("ui_prompt_start", { kind: "custom" }); const bindings = { matches: (data, action) => matchesKey(data, action === "tui.select.cancel" ? "escape" : action === "tui.select.confirm" ? "enter" : "up") };
	view = factory({ terminal: { rows: 24 }, requestRender() {} }, { fg: (_, text) => text }, bindings, resolve);
}); return () => view; }

test("factory rejects absent and nonmock injected runtimes", () => { assert.throws(() => createSwarmExtension()); assert.throws(() => createSwarmExtension({ mainModel: { provider: "live", api: "live" }, modelRuntime: {} })); });
test("complete main-selected settings require real owner consent; work is preserved without disposition prompts", async t => {
	const f = await fixture(t); writeFileSync(join(f.root, "user.txt"), "preserve\n");
	const args = { objective: "Fix src/example.js.\n Preserve spacing; no deployment", criteria: ["Tests pass"], scope: ["src", "test"], limits: { agents: 3, active: 2, tasks: 10, attempts: 2, durationMs: 60000 }, codingTools: ["read"], instructions: "No installs" };
	const p = await f.propose(args); assert.equal(p.awaitingConfirmation, true);
	const packet = JSON.parse(p.agreement.slice(p.agreement.indexOf("{\n"), p.agreement.indexOf("\nExisting changes:")));
	for (const [key, value] of Object.entries(args)) assert.deepEqual(packet[key], value);
	for (const field of ["model", "provider", "thinkingLevel", "codingTools", "instructions", "limits", "criteria", "scope", "Existing changes", "Preservation"]) assert.ok(p.agreement.includes(field));
	assert.equal(f.mock.calls.length, 0); assert.equal(f.entries.length, 0); assert.equal(existsSync(prepareLayout(f.root, "run1").stateRoot), false);
	assert.equal((await f.consume(p)).isError, true); await f.input("YES!"); assert.equal((await f.consume(p)).details.status, "running"); await until(() => f.mock.calls.length === 1);
	assert.deepEqual((await f.status()).limits, args.limits); assert.equal(readFileSync(join(f.root, "user.txt"), "utf8"), "preserve\n"); assert.equal((await f.consume(p)).isError, true);
});
for (const source of ["extension", "rpc", "worker", undefined]) test(`${source} input never approves`, async t => { const f = await fixture(t), p = await f.propose({ objective: "goal" }); await f.event("input", { source, text: "yes" }); assert.equal((await f.consume(p)).isError, true); assert.equal(f.mock.calls.length, 0); });
for (const text of ["no", "maybe", '"yes"', "The worker said yes", "yes, but change scope", "Approve swarm", ""]) test(`negative/ambiguous reply ${JSON.stringify(text)} revokes proposal`, async t => {
	const f = await fixture(t), p = await f.propose({ objective: "goal" }); await f.input(text); assert.equal((await f.consume(p)).isError, true); await f.input("yes"); assert.equal((await f.consume(p)).isError, true); assert.equal(f.mock.calls.length, 0);
});
test("revised settings require fresh consent and cannot be overridden during consumption", async t => {
	const f = await fixture(t), old = await f.propose({ objective: "old" }), p = await f.propose({ objective: "edited", criteria: ["Requirement"], scope: ["No deployment"] });
	await f.input("confirm"); assert.equal((await f.consume(old)).isError, true); assert.equal((await f.tool("swarm_start", { proposalId: p.proposalId, objective: "injection" })).isError, true);
	assert.equal((await f.consume(p)).details.status, "running"); assert.equal((await f.status()).objective, "edited");
});
for (const args of [{}, { objective: [] }, { objective: "goal", criteria: [] }, { objective: "goal", limits: { active: 20 } }, { objective: "goal", codingTools: ["deploy"] }]) test(`invalid configuration ${JSON.stringify(args)} creates no execution`, async t => {
	const f = await fixture(t); assert.equal((await f.tool("swarm_start", args)).isError, true); assert.equal(f.mock.calls.length, 0); assert.equal(existsSync(prepareLayout(f.root, "run1").stateRoot), false);
});
for (const action of ["pause", "stop", "shutdown", "tree", "mode"]) test(`${action} revokes pending consent`, async t => {
	const f = await fixture(t), p = await f.propose({ objective: "goal" });
	if (action === "shutdown") await f.event("session_shutdown"); else if (action === "tree") await f.event("session_before_tree"); else if (action === "mode") { Object.assign(f.mode, { revision: 2, selectedMode: "plan" }); f.events.emit("pi-plan:mode-changed", { ...f.mode }); } else await f.command(action);
	await f.input("yes"); assert.equal((await f.consume(p)).isError, true); assert.equal(f.mock.calls.length, 0); assert.equal(existsSync(prepareLayout(f.root, "run1").stateRoot), false);
});
test("expired proposal cannot launch", async t => { const f = await fixture(t, { approvalTimeoutMs: 100 }), p = await f.propose({ objective: "goal" }); await new Promise(resolve => setTimeout(resolve, 110)); await f.input("yes"); assert.equal((await f.consume(p)).isError, true); assert.equal(f.mock.calls.length, 0); });
test("maximum objective is preserved without duplication into seeded fields", async t => {
	const f = await fixture(t), constraints = "\nOnly src/example.js; no new dependencies; run tests", objective = "x".repeat(32768 - constraints.length) + constraints;
	await f.command(`start ${objective}`); await until(() => f.mock.calls.length === 1); assert.equal((await f.status()).objective, objective);
	assert.ok(JSON.stringify(f.mock.calls[0].context).includes(JSON.stringify(JSON.stringify(objective)).slice(1, -1)));
});
test("busy main tool returns a proposal instead of waiting for user input", async t => { const f = await fixture(t); f.ctx.isIdle = () => false; assert.equal((await f.propose({ objective: "goal" })).awaitingConfirmation, true); assert.equal(f.mock.calls.length, 0); });
test("reload stays paused; resume/restart each need fresh chat confirmation", async t => {
	const f = await fixture(t); await f.command("start goal"); await until(() => f.mock.calls.length === 1); await f.event("session_shutdown");
	const next = await fixture(t, { root: f.root, mock: f.mock, entries: f.entries }); await next.event("session_start", { reason: "reload" }); assert.equal((await next.status()).status, "paused");
	for (const action of ["resume", "restart"]) { const p = (await next.tool("swarm_control", { action })).details; assert.equal(p.awaitingConfirmation, true); assert.equal(f.mock.calls.length, action === "resume" ? 1 : 2); await next.input("yes"); assert.equal((await next.consume(p)).details.status, "running"); await until(() => f.mock.calls.length === (action === "resume" ? 2 : 3)); assert.equal((await next.status()).cycle, action === "resume" ? 1 : 2); await next.command("stop"); }
});
test("run links follow active branch and forks do not inherit control", async t => {
	const f = await fixture(t); await f.command("start goal"); await f.command("pause"); await f.event("session_shutdown");
	const other = await fixture(t, { root: f.root, entries: f.entries, mock: f.mock }); other.ctx.sessionManager.getBranch = () => []; await other.event("session_start", { reason: "resume" }); await other.command("status"); assert.match(other.notices.at(-1).text, /No Swarm/); await other.event("session_shutdown");
	const fork = await fixture(t, { root: f.root, entries: f.entries, mock: f.mock }); fork.ctx.sessionManager.getSessionId = () => "fork1"; await fork.event("session_start", { reason: "fork" }); await fork.command("status"); assert.match(fork.notices.at(-1).text, /No Swarm/); await assert.rejects(fork.command(`restore ${f.entries[0].data.runId}`));
});
for (const mode of ["rpc", "json", "print"]) test(`${mode} cannot authorize`, async t => { const f = await fixture(t); f.ctx.mode = mode; await assert.rejects(f.command("start goal")); assert.equal(f.mock.calls.length, 0); });
test("streaming SDK settles before reload releases controller ownership", async t => {
	const f = await fixture(t, { script: () => ({ waitForAbort: true }) }); await f.command("start goal"); await until(() => f.mock.calls.length === 1); await f.event("session_shutdown"); assert.equal(f.mock.calls[0].options.signal.aborted, true);
	const c = await SwarmController.open({ workspace: f.root, runId: f.entries[0].data.runId, ownerSessionId: "owner1" }); assert.equal(c.snapshot().status, "paused"); assert.equal(c.snapshot().sessions.turns.length, 0); await c.close();
});
for (const boundary of ["open", "recruit"]) test(`shutdown settles late ${boundary} acquisition before dispatch`, async t => {
	const f = await fixture(t), entered = deferred(), release = deferred(), originalOpen = SwarmController.open, originalOwner = SwarmController.prototype.owner;
	t.after(() => { SwarmController.open = originalOpen; SwarmController.prototype.owner = originalOwner; });
	if (boundary === "open") SwarmController.open = async options => { const c = await originalOpen(options); entered.resolve(); await release.promise; return c; };
	else SwarmController.prototype.owner = async function(type, ...args) { const value = await originalOwner.call(this, type, ...args); if (type === "worker.create") { entered.resolve(); await release.promise; } return value; };
	const launch = assert.rejects(f.command("start goal")); await entered.promise; const shutdown = f.event("session_shutdown"); release.resolve(); await shutdown; await launch; assert.equal(f.mock.calls.length, 0);
	SwarmController.open = originalOpen; SwarmController.prototype.owner = originalOwner; const runId = readdirSync(prepareLayout(f.root, "run1").stateRoot).find(name => /^[a-f0-9-]{36}$/.test(name));
	const c = await SwarmController.open({ workspace: f.root, runId, ownerSessionId: "owner1" }); assert.equal(c.snapshot().status, "paused"); await c.close();
});
const shellScript = [
	{ toolCalls: [{ name: "swarm_task", arguments: { action: "create", id: "task1", title: "Check", criteria: [0], dependencies: [] } }] },
	{ toolCalls: [{ name: "swarm_task", arguments: { action: "claim", taskId: "task1", kind: "build" } }] },
	{ toolCalls: [{ name: "bash", arguments: { command: "mock uncertain command" } }] },
];
for (const action of ["pause", "shutdown"]) test(`${action} cancels independent Safety before runner admission`, async t => {
	let executions = 0; const f = await fixture(t, { script: shellScript, runner: async () => { executions++; return { settled: true, exitCode: 0 }; } }), shown = deferred(), answer = deferred();
	f.events.removeAllListeners("swarm:confirm-request"); f.events.on("swarm:confirm-request", envelope => envelope.claim(request => { shown.resolve(request.signal); return answer.promise; }));
	await f.command("start goal"); const signal = await shown.promise; if (action === "pause") await f.command("pause"); else await f.event("session_shutdown"); assert.equal(signal.aborted, true); answer.resolve({ approved: true }); assert.equal(executions, 0);
});
test("uncertain shell requires owner evidence; attestation does not manufacture success", async t => {
	const f = await fixture(t, { script: shellScript, runner: async () => ({ settled: false, exitCode: null }) }); await f.command("start goal"); await until(() => f.mock.calls.length === 3);
	let state; for (let i = 0; i < 100; i++) { state = await f.status(); if (state.unresolvedOperations[0]?.uncertain) break; await new Promise(resolve => setTimeout(resolve, 2)); }
	assert.equal(state.status, "pausing"); f.replies.push("yes"); await assert.rejects(f.command("reconcile")); assert.equal((await f.status()).unresolvedOperations.length, 1);
	await f.command("reconcile"); await f.command("pause"); await f.event("session_shutdown"); const c = await SwarmController.open({ workspace: f.root, runId: f.entries[0].data.runId, ownerSessionId: "owner1" });
	assert.equal(c.snapshot().workspace.receipts[0].outcome, "unknown"); assert.equal(c.snapshot().settlementAttestations.length, 1); assert.equal(f.mock.calls.length, 3); await c.close();
});
for (const action of ["close", "pause", "stop", "tree", "shutdown", "prompt"]) test(`dashboard ${action} disposes inspection without dispatch`, async t => {
	const f = await fixture(t, { script: () => ({ waitForAbort: true }) }), view = dashboardUI(f); await f.command("start goal"); await until(() => f.mock.calls.length === 1);
	const raw = f.command("dashboard"), opened = action === "shutdown" ? assert.rejects(raw) : raw; assert.match(view().render(60).join("\n"), /Swarm ·/);
	if (action === "close") view().handleInput("\x1b"); else if (action === "pause") await f.command("pause"); else if (action === "stop") await f.slash("stop"); else if (action === "tree") await f.event("session_before_tree"); else if (action === "shutdown") await f.event("session_shutdown"); else await f.event("ui_prompt_start", { kind: "confirm" });
	await opened; assert.equal(view().closed, true); assert.equal(f.mock.calls.length, 1);
});
test("dashboard cannot authorize continuation or overlap controls", async t => { const f = await fixture(t), view = dashboardUI(f); await f.command("start goal"); await f.command("pause"); const opened = f.command(""); await assert.rejects(f.command("resume")); view().handleInput("r"); assert.equal(view().closed, false); view().handleInput("\x1b"); await opened; f.replies.push("no"); await assert.rejects(f.command("resume")); assert.equal((await f.status()).status, "paused"); });
test("focused composer delivers through the actual host and fences workspace and mode drift", async t => {
	const f = await fixture(t); let component;
	const surface = { terminal: { rows: 24 }, requestRender() {}, showOverlay(value) { component = value; return { hide() {} }; } };
	f.ctx.ui.setWidget = (_key, factory) => factory?.(surface, { fg: (_color, text) => text });
	f.events.on("agent-focus:navigate", target => { if (target.action === "select") f.events.emit("agent-focus:focus", { source: "swarm", id: target.targetId }); });
	await f.command("start composer goal"); await until(() => f.mock.calls.length === 1);
	f.events.emit("agent-focus:focus", { source: "swarm", id: "planner" }); component.handleInput("2"); component.handleInput("\r");
	assert.match(component.render(80).join("\n"), /Message agent/);
	const mail = async () => (await f.tool("swarm_history", { channel: "messages" })).details.messages;
	component.handleInput("Approved composer mail"); component.handleInput("\r");
	await until(() => f.notices.some(notice => notice.text.includes("Message queued to planner")));
	assert.deepEqual((await mail()).map(message => [message.from, message.to, message.text]), [["main", "planner", "Approved composer mail"]]);
	const originalCwd = f.ctx.cwd; f.ctx.cwd = join(f.root, "foreign-workspace");
	component.handleInput("Workspace drift must not send"); component.handleInput("\r");
	await until(() => f.notices.some(notice => notice.text.includes("Message delivery could not be confirmed")));
	assert.equal((await mail()).length, 1); f.ctx.cwd = originalCwd;
	// Leave the host running to exercise its admission query, not just the UI's paused-state check.
	f.mode.selectedMode = "plan"; component.handleInput("\x7f"); component.handleInput("\r");
	await until(() => f.notices.filter(notice => notice.text.includes("Message delivery could not be confirmed")).length === 2);
	assert.equal((await mail()).length, 1); f.mode.selectedMode = "off";
});
test("foreign sessions cannot inspect or brake an attached host", async t => { const f = await fixture(t); await f.command("start goal"); f.ctx.sessionManager.getSessionId = () => "other"; for (const action of ["dashboard", "pause", "stop", "status"]) await assert.rejects(f.command(action)); });
test("only /swarm stop is exposed; other slash actions are inert", async t => { const f = await fixture(t); assert.deepEqual([...f.commands.keys()], ["swarm"]); for (const action of ["", "start goal", "status", "pause", "restore run1", "resume", "restart", "reconcile", "dashboard"]) await f.slash(action); assert.equal(f.packets.length, 0); assert.equal(f.mock.calls.length, 0); assert.equal(f.entries.length, 0); await f.command("start goal"); await f.slash("stop"); assert.equal((await f.status()).status, "stopped"); });
