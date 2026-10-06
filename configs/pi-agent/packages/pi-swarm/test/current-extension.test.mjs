import { mainAgentAction } from "./main-agent-actions.mjs";
import { prepareLayout } from "../extensions/swarm/store/layout.mjs";
import {
	InMemoryCredentialStore, createAssistantMessageEventStream, createProvider, envApiKeyAuth,
} from "@earendil-works/pi-ai";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { repository } from "./helpers.mjs";
import { execFileSync } from "node:child_process";
import { guardNetwork } from "./network-guard.mjs";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import { SwarmHost } from "../extensions/swarm/host.mjs";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createCurrentSwarmExtension } from "../extensions/swarm/extension.mjs";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

async function fixture(t, { policy = true, entries = [], root, hold = false } = {}) {
	guardNetwork(t);
	const credentials = new InMemoryCredentialStore();
	await credentials.modify("entry-fixture", () => ({ type: "api_key", key: "memory-fixture" }));
	const source = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
	const model = { id: "first", name: "Entry fixture", provider: "entry-fixture", api: "openai-responses",
		baseUrl: "https://entry.invalid/v1", reasoning: true, input: ["text"], contextWindow: 128000, maxTokens: 8192,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
	const calls = []; let auth = 0;
	const originalAuth = source.getAuth.bind(source);
	source.getAuth = (...args) => { auth++; return originalAuth(...args); };
	const stream = (selected, _context, options) => {
		assert.equal(options.apiKey, "memory-fixture");
		calls.push({ model: selected.id, reasoning: options.reasoning });
		const output = createAssistantMessageEventStream();
		const message = { role: "assistant", content: [{ type: "text", text: "Offline answer" }], api: selected.api,
			provider: selected.provider, model: selected.id, timestamp: Date.now(), stopReason: "stop",
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
		if (hold) {
			void (async () => {
				if (!options.signal.aborted) await new Promise(resolve => options.signal.addEventListener("abort", resolve, { once: true }));
				message.stopReason = "aborted";
				output.push({ type: "error", reason: "aborted", error: message }); output.end();
			})();
		} else { output.push({ type: "done", reason: "stop", message }); output.end(); }
		return output;
	};
	source.registerNativeProvider(createProvider({ id: model.provider, models: [model, { ...model, id: "second" }],
		auth: { apiKey: envApiKeyAuth("Fixture", []) }, api: { stream, streamSimple: stream } }));
	const events = new EventEmitter(); const handlers = new Map(); const notices = []; const packets = [];
	if (policy) events.on("pi-plan:query-mode", request => request.respond({ version: 1, instanceId: "entry-policy", revision: 1,
		contextRevision: 1, ready: true, sessionId: "owner1", selectedMode: "off", enforcedMode: "off", runMode: null, pendingChange: false }));
	const answers = []; let command; let thinking = "high";
	const dialog = kind => async (...args) => {
		if (kind === "input") return '["Fixture only"]';
		packets.push(args[0]);
		if (answers.length) {
			const answer = answers.shift();
			return typeof answer === "function" ? answer(...args) : answer;
		}
		if (kind === "confirm") return true;
		return ["Approve", "Preserve existing work", "Continue", "Attest settlement"].find(choice => args[1].includes(choice));
	};
	const ctx = { cwd: root ?? repository(t), mode: "tui", hasUI: true, model: undefined, isIdle: () => true,
		modelRegistry: new ModelRegistry(source), sessionManager: { getSessionId: () => "owner1", getSessionFile: () => "owner.jsonl", getEntries: () => entries, getBranch: () => entries },
		ui: { custom: () => assert.fail("Approval needs no custom TUI component"), input: dialog("input"), select: dialog("select"), confirm: dialog("confirm"), notify: text => notices.push(text) } };
	const tools = new Map(); const messages = []; const renderers = new Map();
	const pi = { registerMessageRenderer: (type, renderer) => renderers.set(type, renderer), registerTool: tool => tools.set(tool.name, tool), sendMessage: (message, options) => messages.push({ message, options }), events, on: (name, fn) => handlers.set(name, fn), registerCommand: (name, value) => { assert.equal(name, "swarm"); command = value; },
		getThinkingLevel: () => thinking, appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }) };
	assert.equal(createCurrentSwarmExtension()(pi), undefined);
	const event = (name, data = {}) => handlers.get(name)?.(data, ctx);
	t.after(() => event("session_shutdown"));
	// Main tools stream their approval packet as a partial result before each dialog.
	const updates = [];
	const tool = (name, args, signal) => tools.get(name).execute("call", args, signal, update => updates.push(update.content[0].text), ctx);
	return { tools, tool, updates, handlers, messages, renderers, ctx, source, calls, packets, answers, entries, event, events, notices, auth: () => auth,
		select(id) { ctx.model = source.getModel(model.provider, id); }, thinking(value) { thinking = value; },
		slashCommand: args => command.handler(args, ctx), command: args => mainAgentAction(tools, ctx, args, output => updates.push(output.content[0].text)), status: async () => { await mainAgentAction(tools, ctx, "status"); return notices.at(-1).startsWith("{") ? JSON.parse(notices.at(-1)) : { status: "unattached" }; } };
}

async function until(predicate) {
	for (let i = 0; i < 1000; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
	assert.fail("Worker did not settle");
}

test("main tools are registered without auth; status and history listing stay inert", async t => {
	const f = await fixture(t);
	assert.deepEqual([...f.tools.keys()], ["swarm_start", "swarm_status", "swarm_control", "swarm_history"]);
	for (const name of ["swarm_status", "swarm_history", "swarm_status"]) {
		const result = await f.tools.get(name).execute("call", {}, undefined, undefined, f.ctx);
		assert.equal(result.isError, undefined);
		assert.equal(result.details.status, "unattached");
	}
	assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
});

test("registered agreement renderer preserves literal full terms at narrow widths without expansion", async t => {
	const f = await fixture(t); f.select("first");
	assert.deepEqual([...f.renderers.keys()], ["swarm-agreement"]);
	const objective = '**literal-name** `name` [label](https://example.invalid/full/destination) \\\\path\\file\nnext "quoted" ``` fence 界';
	f.answers.push("Cancel");
	await assert.rejects(f.command(`start ${objective}`));
	const content = f.updates.find(text => text.startsWith("Swarm approval packet: LAUNCH"));
 const message = { customType: "swarm-agreement", content, display: true };
	const packet = JSON.parse(content.slice(content.indexOf("{\n"), content.indexOf("\nProvider agreement")));
	assert.equal(packet.objective, objective);
	assert.ok(content.includes("Existing changes:") && content.includes('"transport": "pi-native"'));
	const renderer = f.renderers.get(message.customType);
	for (const expanded of [false, true]) {
		const component = renderer(message, { expanded, outputPad: 2 }, {});
		assert.ok(component instanceof Text);
		for (const width of [12, 24, 60, 80, 120]) {
			const lines = component.render(width);
			assert.ok(lines.every(line => visibleWidth(line) <= width));
			// Wrapping/padding can move whitespace, but cannot omit any field or
			// interpret Markdown, JSON escapes, URLs, or approval/cancellation text.
			assert.equal(lines.join("").replace(/\s/g, ""), content.replace(/\s/g, ""));
		}
		assert.equal(component.render(10000).map(line => line.trimEnd()).join("\n"), content);
	}
	assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
});

test("registered agreement renderer visibly escapes terminal and bidi controls", async t => {
	const f = await fixture(t);
	const content = '**literal** `name` [label](https://example.invalid/path)\\n\\\\\n\x1b[2J\x9b31m\r\u202eend';
	const renderer = f.renderers.get("swarm-agreement");
	const lines = renderer({ content }, { expanded: false, outputPad: 0 }, {}).render(200);
	assert.equal(lines.map(line => line.trimEnd()).join("\n"),
		'**literal** `name` [label](https://example.invalid/path)\\n\\\\\n\\u001b[2J\\u009b31m\\u000d\\u202eend');
	assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
});

test("main tool packet renders every line, sanitized, instead of a collapsed preview", async t => {
	const f = await fixture(t);
	const theme = { fg: (_color, text) => text };
	const text = Array.from({ length: 60 }, (_, i) => `packet-line-${i}`).join("\n") + "\n\x1b[2J\u202eend";
	for (const name of ["swarm_start", "swarm_control"]) {
		const component = f.tools.get(name).renderResult({ content: [{ type: "text", text }], details: {} }, { expanded: false, isPartial: true }, theme, {});
		const rendered = component.render(80).map(line => line.trimEnd()).join("\n");
		for (let i = 0; i < 60; i++) assert.ok(rendered.includes(`packet-line-${i}`));
		assert.ok(rendered.endsWith("\\u001b[2J\\u202eend"));
	}
	for (const name of ["swarm_status", "swarm_history"]) assert.equal(f.tools.get(name).renderResult, undefined);
});

test("main start returns while native worker streams and status remains callable; stop settles", async t => {
	const f = await fixture(t, { hold: true }); f.select("first");
	const call = (name, args) => f.tool(name, args);
	f.answers.push((title, choices) => {
		assert.equal(f.auth(), 0, "No auth before the human approves");
		assert.match(title, /^LAUNCH \(Pi native provider\)/); assert.equal(choices[0], "Cancel");
		assert.match(f.updates.at(-1), /"objective": "Approved fixture goal"/);
		return "Approve";
	});
	const launched = await call("swarm_start", { objective: "Approved fixture goal" });
	assert.equal(launched.details.status, "running");
	assert.match(f.updates[0], /^Inspecting Swarm workspace before approval/);
	assert.match(f.updates[1], /^Swarm approval packet: LAUNCH \(Pi native provider\)/);
	assert.ok(f.messages.every(item => item.message.customType !== "swarm-agreement"));
	await until(() => f.calls.length === 1);
	assert.equal((await call("swarm_status", {})).details.status, "running");
	const auth = f.auth();
	const history = await call("swarm_history", { workerId: "planner", limit: 1 });
	assert.equal(history.details.persistedOnly, true);
	assert.ok(history.details.entries.length <= 1);
	assert.equal(f.auth(), auth);
	assert.equal(f.messages.filter(item => item.message.content.includes("approved launch started")).length, 1);
	assert.ok(f.messages.every(item => item.options.triggerTurn === false));
	const stopped = await call("swarm_control", { action: "stop" });
	assert.equal(stopped.details.status, "stopped");
	assert.equal(stopped.details.unsettled.turns, 0);
	assert.equal(f.calls.length, 1);
});

for (const refusal of ["cancel", "escape", "no-ui", "no-update", "signal", "aborted", "stop", "mode", "model", "model-silent", "thinking", "owner", "session-file", "rpc-context", "reload", "changed-file"]) {
	test(`main start ${refusal} never treats the tool call as approval`, async t => {
		const f = await fixture(t); f.select("first");
		writeFileSync(join(f.ctx.cwd, "user.txt"), "Preserve me");
		const signal = new AbortController();
		if (refusal === "no-ui") { f.ctx.mode = "json"; f.ctx.hasUI = false; }
		if (refusal === "signal") signal.abort();
		let shown = 0;
		// Every change happens while the human's dialog is open; the human then approves late.
		f.answers.push(async () => {
			shown++;
			if (refusal === "cancel") return "Cancel";
			if (refusal === "escape") return undefined;
			if (refusal === "aborted") signal.abort();
			if (refusal === "stop") await f.command("stop");
			if (refusal === "model") { f.select("second"); await f.event("model_select"); }
			if (refusal === "model-silent") f.select("second");
			if (refusal === "thinking") f.thinking("low");
			if (refusal === "owner") f.ctx.sessionManager.getSessionId = () => "foreign";
			if (refusal === "session-file") f.ctx.sessionManager.getSessionFile = () => "other.jsonl";
			if (refusal === "rpc-context") f.ctx.mode = "rpc";
			if (refusal === "reload") await f.event("session_shutdown");
			if (refusal === "changed-file") writeFileSync(join(f.ctx.cwd, "user.txt"), "Changed");
			if (refusal === "mode") f.events.emit("pi-plan:mode-changed", { version: 1, instanceId: "entry-policy", revision: 2,
				contextRevision: 1, ready: true, sessionId: "owner1", selectedMode: "plan", enforcedMode: "plan", runMode: null, pendingChange: false });
			return "Approve";
		});
		const result = refusal === "no-update"
			? await f.tools.get("swarm_start").execute("call", { objective: "Never approved" }, undefined, undefined, f.ctx)
			: await f.tool("swarm_start", { objective: "Never approved" }, signal.signal);
		assert.equal(result.isError, true);
		assert.equal(shown, ["no-ui", "no-update", "signal"].includes(refusal) ? 0 : 1);
		assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
		assert.equal(existsSync(join(prepareLayout(f.ctx.cwd, "run1").stateRoot)), false);
		assert.ok(f.messages.every(item => item.message.customType !== "swarm-agreement"));
	});
}

test("chat text cannot answer an in-tool approval: there is no input listener", async t => {
	const f = await fixture(t); f.select("first");
	assert.equal(f.handlers.has("input"), false);
	f.answers.push("Cancel");
	assert.equal((await f.tool("swarm_start", { objective: "Approve swarm" })).isError, true);
	assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
});

test("explicit continuation restores chat observation if another extension cancels navigation", async t => {
	const f = await fixture(t, { hold: true }); f.select("first");
	await f.command("start Fixture"); await until(() => f.calls.length === 1);
	assert.deepEqual(await f.event("session_before_switch"), { cancel: false });
	// Simulate a later before-switch handler veto: this same session stays active.
	await f.command("resume"); await until(() => f.calls.length === 2);
	await until(() => f.messages.some(item => item.message.content.includes("approved continuation started")));
	await f.command("stop");
});

test("tool cancellation closes the open in-tool dialog and denies a late answer", async t => {
	const f = await fixture(t); f.select("first");
	const signal = new AbortController();
	let dialogSignal;
	f.answers.push((_title, _choices, options) => new Promise(resolve => {
		dialogSignal = options.signal;
		signal.abort();
		setTimeout(() => resolve("Approve"), 5);
	}));
	const result = await f.tool("swarm_start", { objective: "Fixture" }, signal.signal);
	assert.equal(result.isError, true);
	assert.equal(dialogSignal.aborted, true);
	assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
	assert.equal(existsSync(join(prepareLayout(f.ctx.cwd, "run1").stateRoot)), false);
});

test("chat launch without Git and continuation ask native dialogs inside each tool call", async t => {
	const root = mkdtempSync(join(tmpdir(), "swarm-chat-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(join(root, "user.txt"), "Preserve me");
	writeFileSync(join(root, ".gitignore"), "# rules\r\n", { mode: 0o640 });
	const f = await fixture(t, { root, hold: true }); f.select("first");
	const order = [];
	const select = f.ctx.ui.select;
	const confirm = f.ctx.ui.confirm;
	f.ctx.ui.select = (...args) => { order.push(`select:${args[0].split(":")[0]}@${f.updates.length}`); return select(...args); };
	f.ctx.ui.confirm = (...args) => { order.push(`confirm:${args[0]}`); return confirm(...args); };
	const launch = { objective: "Fixture \u001b[31m \u202e goal" };
	assert.equal((await f.tool("swarm_start", launch)).details.status, "running");
	// Setup consent precedes any setup action and the agreement; each packet precedes its select.
	assert.deepEqual(order, ["select:LAUNCH (Pi native provider)@2", "select:Preserve and proceed?@3"]);
	assert.ok(f.updates[1].includes("Fixture \\u001b[31m \\u202e goal"));
	assert.ok(f.updates.every(text => !/[\x1b\u202e]/.test(text)));
	assert.match(f.updates[2], /user\.txt/);
	await until(() => f.calls.length === 1);
	assert.equal(readFileSync(join(root, "user.txt"), "utf8"), "Preserve me");
	assert.equal(readFileSync(join(root, ".gitignore"), "utf8"), "# rules\r\n");
	assert.equal(existsSync(join(root, ".git")), false);
	await f.tool("swarm_control", { action: "pause" });
	for (const action of ["resume", "restart"]) {
		order.length = 0;
		const before = f.updates.length;
		assert.equal((await f.tool("swarm_control", { action })).details.status, "running");
		assert.deepEqual(order, [`select:${action.toUpperCase()} (Pi native provider)@${before + 2}`, `select:Preserve and proceed?@${before + 3}`, `select:Workspace reconciliation@${before + 3}`]);
		await until(() => f.calls.length === (action === "resume" ? 2 : 3));
		await f.tool("swarm_control", { action: "pause" });
	}
	f.answers.push("Cancel");
	assert.equal((await f.tool("swarm_control", { action: "resume" })).isError, true);
	assert.equal(f.calls.length, 3);
});

test("normal entry registers synchronously without model, auth, provider dispatch or discovery", async t => {
	const f = await fixture(t);
	await f.event("session_start", { reason: "startup" });
	await f.command("status");
	assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
	await assert.rejects(f.command("start goal"));
	assert.equal(existsSync(join(prepareLayout(f.ctx.cwd, "run1").stateRoot)), false);
	f.select("first"); f.ctx.sessionManager.getSessionFile = () => undefined;
	await assert.rejects(f.command("start goal"));
	assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
});

test("normal entry snapshots current model and thinking at launch, not load or cancelled agreement", async t => {
	const f = await fixture(t); f.select("first");
	f.answers.push("Cancel");
	await assert.rejects(f.command("start cancelled"));
	assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
	f.select("second"); f.thinking("low");
	await f.command("start current selection"); await until(() => f.calls.length === 1);
	assert.deepEqual(f.calls[0], { model: "second", reasoning: "low" });
	await f.command("pause");
	f.select("first"); await f.event("model_select");
	assert.equal((await f.status()).status, "paused");
	const before = f.packets.length;
	await f.command("resume"); await until(() => f.calls.length === 2);
	assert.ok(f.packets.length > before); assert.equal(f.calls[1].model, "second");
});

for (const event of ["model_select", "thinking_level_select"]) {
	for (const stage of ["agreement"]) {
		test(`${event} during ${stage} prevents late approval and auth`, async t => {
			const f = await fixture(t); f.select("first");
			let shown = false; let release;
			const answer = new Promise(resolve => { release = resolve; });
			if (stage === "objective") f.ctx.ui.input = async () => { shown = true; return answer; };
			else f.ctx.ui.select = async () => { shown = true; return answer; };
			const launch = stage === "objective" ? f.command("start") : assert.rejects(f.command("start goal"));
			await until(() => shown);
			f.select("second"); f.thinking("low");
			await f.event(event);
			release(stage === "objective" ? "Late goal" : "Approve");
			await launch;
			assert.equal(f.calls.length, 0); assert.equal(f.auth(), 0);
			assert.equal(existsSync(join(prepareLayout(f.ctx.cwd, "run1").stateRoot)), false);
		});
	}
}

test("main model change aborts active native work and requires new approval of the pinned model", async t => {
	const f = await fixture(t, { hold: true }); f.select("first");
	await f.command("start goal"); await until(() => f.calls.length === 1);
	f.select("second"); await f.event("model_select");
	assert.equal((await f.status()).status, "paused");
	assert.equal(f.calls.length, 1);
	f.answers.push("Cancel");
	await assert.rejects(f.command("resume"));
	assert.equal(f.calls.length, 1);
	await f.command("resume"); await until(() => f.calls.length === 2);
	assert.equal(f.calls[1].model, "first");
	await f.command("stop");
});

for (const cancellation of ["model_select", "thinking_level_select", "pause"]) {
	test(`same-turn ${cancellation} cancels resume before a new host operation`, async t => {
		const f = await fixture(t, { hold: true }); f.select("first");
		await f.command("start goal"); await until(() => f.calls.length === 1);
		await f.command("pause");
		const approvals = f.packets.length;
		const resume = f.command("resume");
		const cancelled = cancellation === "pause" ? f.command("pause") : f.event(cancellation);
		await Promise.all([resume, cancelled]);
		assert.equal(f.packets.length, approvals, "cancelled command must not present fresh approval");
		assert.equal(f.calls.length, 1);
		assert.equal((await f.status()).status, "paused");
		// Only a later explicit command may create a fresh continuation operation.
		await f.command("resume"); await until(() => f.calls.length === 2);
		assert.ok(f.packets.length > approvals);
		await f.command("stop");
	});
}

for (const cancellation of ["model_select", "pause", "owner-change"]) {
	test(`restore-waiting resume stays cancelled after ${cancellation}`, async t => {
		const f = await fixture(t); f.select("first");
		await f.command("start goal"); await until(() => f.calls.length === 1);
		await f.event("session_shutdown");
		const next = await fixture(t, { entries: f.entries, root: f.ctx.cwd }); next.select("first");
		await next.event("session_start", { reason: "reload" });
		// Hold only the return from a real, completed host restore, before command ownership exists.
		const restore = SwarmHost.prototype.restore;
		let restored = false;
		let release;
		const waiting = new Promise(resolve => { release = resolve; });
		t.mock.method(SwarmHost.prototype, "restore", async function (...args) {
			const result = await restore.apply(this, args);
			restored = true;
			await waiting;
			return result;
		});
		t.after(release);
		const resume = next.command("resume");
		await until(() => restored);
		if (cancellation === "owner-change") next.ctx.sessionManager.getSessionId = () => "other-owner";
		else if (cancellation === "pause") await next.command("pause");
		else await next.event(cancellation);
		release();
		if (cancellation === "owner-change") await assert.rejects(resume); else await resume;
		assert.equal(next.packets.length, 0);
		assert.equal(next.calls.length, 0);
		if (cancellation === "owner-change") {
			await assert.rejects(next.command("resume"));
			next.ctx.sessionManager.getSessionId = () => "owner1";
		}
		assert.equal((await next.status()).status, "paused");
		await next.command("resume"); await until(() => next.calls.length === 1);
		await next.command("stop");
	});
}

test("same-turn context change fences lazy restore setup and preserves owner recovery", async t => {
	const f = await fixture(t); f.select("first");
	await f.command("start goal"); await until(() => f.calls.length === 1);
	await f.event("session_shutdown");
	const next = await fixture(t, { entries: f.entries, root: f.ctx.cwd }); next.select("first");
	await next.event("session_start", { reason: "reload" });
	const resume = assert.rejects(next.command("resume"));
	await next.event("thinking_level_select");
	await resume;
	assert.equal(next.packets.length, 0); assert.equal(next.calls.length, 0);
	await next.command("stop");
	assert.equal((await next.status()).status, "stopped");
});

test("normal entry denies non-TUI but runs standalone after explicit approval", async t => {
	const f = await fixture(t, { policy: false }); f.select("first");
	f.ctx.mode = "print"; f.ctx.hasUI = false;
	await assert.rejects(f.command("start goal"));
	assert.equal(f.calls.length, 0); assert.equal(f.auth(), 0);
 f.ctx.mode = "tui"; f.ctx.hasUI = true;
 await f.command("start goal"); await until(() => f.calls.length === 1);
 assert.equal((await f.status()).status, "running");
 await f.command("stop");
});

test("normal entry reload restore stays paused and fork cannot inherit owner link", async t => {
	const f = await fixture(t); f.select("first");
	await f.command("start goal"); await until(() => f.calls.length === 1);
	await f.event("session_shutdown");
	const next = await fixture(t, { entries: f.entries, root: f.ctx.cwd }); next.select("first");
	await next.event("session_start", { reason: "reload" });
	assert.equal((await next.status()).status, "paused");
	assert.equal(next.auth(), 0); assert.equal(next.calls.length, 0);
	await next.event("session_shutdown");
	const brake = await fixture(t, { entries: f.entries, root: f.ctx.cwd }); brake.select("first");
	await brake.event("session_start", { reason: "reload" });
	await brake.command("stop");
	assert.equal((await brake.status()).status, "stopped");
	assert.equal(brake.auth(), 0); assert.equal(brake.calls.length, 0);
	await brake.event("session_shutdown");
	const fork = await fixture(t, { entries: f.entries, root: f.ctx.cwd }); fork.select("first");
	await fork.event("session_start", { reason: "fork" });
	assert.equal(fork.auth(), 0); assert.equal(fork.calls.length, 0);
	assert.equal((await fork.status()).status, "unattached");
});


test("cancelled standalone launch preserves a non-Git project without creating runtime state", async t => {
 const root = mkdtempSync(join(tmpdir(), "swarm-plain-"));
 t.after(() => rmSync(root, { recursive: true, force: true }));
 writeFileSync(join(root, "source.txt"), "preserve\n");
 const f = await fixture(t, { root, policy: false }); f.select("first");
 f.answers.push("Cancel");
 await assert.rejects(f.command("start goal"));
 assert.deepEqual(readdirSync(root), ["source.txt"]);
 assert.equal(existsSync(prepareLayout(root, "run1").stateRoot), false);
 assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
});

test('main-agent tools restore by run ID in another session without automatic dispatch', async t => {
 const first = await fixture(t, { policy: false }); first.select('first');
 await first.command('start restore through chat'); await until(() => first.calls.length === 1);
 const runId = first.entries.find(entry => entry.customType === 'swarm-run-v1').data.runId;
 await first.event('session_shutdown');
 const next = await fixture(t, { policy: false, root: first.ctx.cwd }); next.select('first');
 next.ctx.sessionManager.getSessionId = () => 'second-owner';
 await next.command(`restore ${runId}`);
 assert.equal((await next.tool('swarm_status', {})).details.runId, runId);
 assert.equal(next.calls.length, 0);
 next.answers.push('Cancel'); await assert.rejects(next.command('resume'));
 assert.equal(next.calls.length, 0);
 await next.command('resume'); await until(() => next.calls.length === 1);
 await next.slashCommand('stop'); assert.equal((await next.status()).status, 'stopped');
});

test('restore and recovery validate run identifiers at the main-tool boundary', async t => {
 const f = await fixture(t, { policy: false }); f.select('first');
 for (const args of [{ action: 'restore' }, { action: 'restore', runId: '../escape' }, { action: 'reconcile', runId: '../escape' }]) {
  assert.equal((await f.tool('swarm_control', args)).isError, true);
 }
 assert.equal(f.calls.length, 0); assert.equal(f.packets.length, 0);
});


test("main-tool failures expose safe phase and code without exception paths", async t => {
	const f = await fixture(t, { policy: false });
	let response = await f.tool("swarm_start", { objective: "goal" });
	assert.deepEqual(response.details.diagnostic, { code: "MODEL", phase: "setup", message: "Select an available physical model before starting." });
	f.select("first"); f.answers.push("Cancel");
	response = await f.tool("swarm_start", { objective: "goal" });
	assert.equal(response.details.diagnostic.code, "AUTHORITY");
	assert.equal(response.details.diagnostic.phase, "approval");
	assert.equal(f.calls.length, 0);
	assert.equal(response.content[0].text.includes(f.ctx.cwd), false);
	const { registerMainTools } = await import("../extensions/swarm/main-tools.mjs");
	const tools = new Map();
	registerMainTools({ registerTool: tool => tools.set(tool.name, tool) }, {
		chatControl: async () => { throw new Error("provider token /private/path \x1b[2J"); },
	});
	response = await tools.get("swarm_start").execute("call", {}, undefined, undefined, {});
	assert.deepEqual(response.details.diagnostic, { code: "FAILED", phase: "setup", message: "The Swarm operation failed; inspect status before continuing." });
	assert.equal(JSON.stringify(response).includes("private/path"), false);
	assert.equal(JSON.stringify(response).includes("provider token"), false);
});
