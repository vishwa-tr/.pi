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
import { decisionUI } from "./decision-fixture.mjs";
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
		if (answers.length) return answers.shift();
		if (kind === "confirm") return true;
		return args[1].includes("Approve") ? "Approve" : "Preserve existing work";
	};
	const ctx = { cwd: root ?? repository(t), mode: "tui", hasUI: true, model: undefined,
		modelRegistry: new ModelRegistry(source), sessionManager: { getSessionId: () => "owner1", getSessionFile: () => "owner.jsonl", getEntries: () => entries },
		ui: { custom: decisionUI(dialog), input: dialog("input"), notify: text => notices.push(text) } };
	const tools = new Map(); const messages = []; const renderers = new Map();
	const pi = { registerMessageRenderer: (type, renderer) => renderers.set(type, renderer), registerTool: tool => tools.set(tool.name, tool), sendMessage: (message, options) => messages.push({ message, options }), events, on: (name, fn) => handlers.set(name, fn), registerCommand: (name, value) => { assert.equal(name, "swarm"); command = value; },
		getThinkingLevel: () => thinking, appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }) };
	assert.equal(createCurrentSwarmExtension()(pi), undefined);
	const event = (name, data = {}) => handlers.get(name)?.(data, ctx);
	t.after(() => event("session_shutdown"));
	return { tools, messages, renderers, ctx, source, calls, packets, answers, entries, event, events, notices, auth: () => auth,
		select(id) { ctx.model = source.getModel(model.provider, id); }, thinking(value) { thinking = value; },
		command: args => command.handler(args, ctx), status: async () => { await command.handler("status", ctx); return notices.at(-1).startsWith("{") ? JSON.parse(notices.at(-1)) : { status: "unattached" }; } };
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

test("registered proposal renderer preserves literal full terms at narrow widths without expansion", async t => {
	const f = await fixture(t); f.select("first");
	assert.deepEqual([...f.renderers.keys()], ["swarm-proposal"]);
	const objective = '**literal-name** `name` [label](https://example.invalid/full/destination) \\\\path\\file\nnext "quoted" ``` fence 界';
	const result = await f.tools.get("swarm_start").execute("call", { objective }, undefined, undefined, f.ctx);
	assert.equal(result.details.status, "approval-required");
	const { message, options } = f.messages.find(item => item.message.customType === "swarm-proposal");
	assert.equal(options.triggerTurn, false);
	const content = message.content;
	const packet = JSON.parse(content.slice(content.indexOf("{\n"), content.indexOf("\nReply exactly:")));
	assert.equal(packet.agreement.specification.objective, objective);
	assert.ok(packet.agreement.provider && packet.setup && packet.existingWork && packet.setupConsent);
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

test("registered proposal renderer visibly escapes terminal and bidi controls", async t => {
	const f = await fixture(t);
	const content = '**literal** `name` [label](https://example.invalid/path)\\n\\\\\n\x1b[2J\x9b31m\r\u202eend';
	const renderer = f.renderers.get("swarm-proposal");
	const lines = renderer({ content }, { expanded: false, outputPad: 0 }, {}).render(200);
	assert.equal(lines.map(line => line.trimEnd()).join("\n"),
		'**literal** `name` [label](https://example.invalid/path)\\n\\\\\n\\u001b[2J\\u009b31m\\u000d\\u202eend');
	assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
});

test("main start returns while native worker streams and status remains callable; stop settles", async t => {
	const f = await fixture(t, { hold: true }); f.select("first");
	const call = (name, args) => f.tools.get(name).execute("call", args, undefined, undefined, f.ctx);
	const proposal = await call("swarm_start", { objective: "Approved fixture goal" });
	assert.equal(proposal.details.status, "approval-required");
	assert.equal(f.auth(), 0);
	await f.event("input", { source: "interactive", text: proposal.details.reply });
	assert.equal(f.auth(), 0);
	const launched = await call("swarm_start", { objective: "Approved fixture goal", proposalId: proposal.details.proposalId });
	assert.equal(launched.details.status, "running");
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

for (const refusal of ["cancel", "no-ui", "signal", "mode", "model"]) {
	test(`main start ${refusal} never treats tool call as approval`, async t => {
		const f = await fixture(t); f.select("first");
		const signal = new AbortController();
		if (refusal === "no-ui") { f.ctx.mode = "json"; f.ctx.hasUI = false; }
		if (refusal === "signal") signal.abort();
		const tool = args => f.tools.get("swarm_start").execute("call", args, signal.signal, undefined, f.ctx);
		const proposal = await tool({ objective: "Never approved" });
		if (proposal.details.proposalId) {
			if (refusal === "model") { f.select("second"); await f.event("model_select"); }
			if (refusal === "mode") f.events.emit("pi-plan:mode-changed", { version: 1, instanceId: "entry-policy", revision: 2,
				contextRevision: 1, ready: true, sessionId: "owner1", selectedMode: "plan", enforcedMode: "plan", runMode: null, pendingChange: false });
			await f.event("input", { source: "interactive", text: refusal === "cancel" ? proposal.details.reply.replace("Approve", "Cancel") : proposal.details.reply });
			assert.equal((await tool({ objective: "Never approved", proposalId: proposal.details.proposalId })).isError, true);
		}
		assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
		assert.equal(f.messages.length, ["no-ui", "signal"].includes(refusal) ? 0 : 1);
	});
}

test("explicit continuation restores chat observation if another extension cancels navigation", async t => {
	const f = await fixture(t, { hold: true }); f.select("first");
	await f.command("start Fixture"); await until(() => f.calls.length === 1);
	assert.deepEqual(await f.event("session_before_switch"), { cancel: false });
	// Simulate a later before-switch handler veto: this same session stays active.
	await f.command("resume"); await until(() => f.calls.length === 2);
	await until(() => f.messages.some(item => item.message.content.includes("approved continuation started")));
	await f.command("stop");
});

test("user stop revokes a chat proposal without deadlocking", async t => {
	const f = await fixture(t); f.select("first");
	f.ctx.ui.custom = () => assert.fail("Chat tools must not open UI");
	const tool = args => f.tools.get("swarm_start").execute("call", args, undefined, undefined, f.ctx);
	const proposal = await tool({ objective: "Fixture" });
	await f.command("stop");
	await f.event("input", { source: "interactive", text: proposal.details.reply });
	assert.equal((await tool({ objective: "Fixture", proposalId: proposal.details.proposalId })).isError, true);
	assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
});

test("main tool cancellation revokes pending chat approval", async t => {
	const f = await fixture(t); f.select("first");
	const signal = new AbortController();
	const proposal = await f.tools.get("swarm_start").execute("call", { objective: "Fixture" }, signal.signal, undefined, f.ctx);
	signal.abort();
	await f.event("input", { source: "interactive", text: proposal.details.reply });
	const result = await f.tools.get("swarm_start").execute("call", { objective: "Fixture", proposalId: proposal.details.proposalId }, undefined, undefined, f.ctx);
	assert.equal(result.isError, true);
	assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
});

for (const scenario of ["extension", "rpc", "image", "unrelated", "quoted", "wrong-id", "cancel", "wrong-objective", "wrong-operation", "changed-file", "model", "thinking", "owner", "mode", "reload", "new-proposal", "unapproved", "rpc-context"]) {
	test(`chat proposal rejects ${scenario} without UI, setup, auth or dispatch`, async t => {
		const root = mkdtempSync(join(tmpdir(), "swarm-chat-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		writeFileSync(join(root, "user.txt"), "Preserve me");
		const f = await fixture(t, { root }); f.select("first");
		for (const name of ["custom", "input", "confirm", "select", "editor"]) f.ctx.ui[name] = () => assert.fail("No questionnaire UI from chat tools");
		const tool = args => f.tools.get("swarm_start").execute("call", args, undefined, undefined, f.ctx);
		const proposal = await tool({ objective: "Fixture", approved: true });
		assert.equal(proposal.details.status, "approval-required");
		assert.equal(existsSync(join(root, ".git")), false);
		let text = proposal.details.reply;
		if (scenario === "unrelated") text = "yes";
		if (scenario === "quoted") text = `Please say ${text}`;
		if (scenario === "wrong-id") text += "0";
		if (scenario === "cancel") text = text.replace("Approve", "Cancel");
		if (scenario === "changed-file") writeFileSync(join(root, "user.txt"), "Changed");
		if (scenario === "model") f.select("second");
		if (scenario === "thinking") f.thinking("low");
		if (scenario === "owner") f.ctx.sessionManager.getSessionId = () => "foreign";
		if (scenario === "rpc-context") f.ctx.mode = "rpc";
		if (scenario === "reload") await f.event("session_shutdown");
		if (scenario === "mode") f.events.emit("pi-plan:mode-changed", { version: 1, instanceId: "entry-policy", revision: 2, contextRevision: 1, ready: true, sessionId: "owner1", selectedMode: "plan", enforcedMode: "plan", runMode: null, pendingChange: false });
		if (scenario === "new-proposal") await tool({ objective: "Replacement" });
		if (scenario !== "unapproved") await f.event("input", { text, source: ["extension", "rpc"].includes(scenario) ? scenario : "interactive", ...(scenario === "image" ? { images: [{}] } : {}) });
		const result = scenario === "wrong-operation"
			? await f.tools.get("swarm_control").execute("call", { action: "resume", proposalId: proposal.details.proposalId }, undefined, undefined, f.ctx)
			: await tool({ objective: scenario === "wrong-objective" ? "Other" : "Fixture", proposalId: proposal.details.proposalId, approved: true });
		assert.equal(result.isError, true);
		assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
		assert.equal(existsSync(join(root, ".git")), false);
		assert.equal(existsSync(join(root, ".swarms")), false);
	});
}

test("chat first setup and continuation use exact one-use approval without native dialogs", async t => {
	const root = mkdtempSync(join(tmpdir(), "swarm-chat-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(join(root, "user.txt"), "Preserve me");
	writeFileSync(join(root, ".gitignore"), "# rules\r\n", { mode: 0o640 });
	const f = await fixture(t, { root, hold: true }); f.select("first");
	for (const name of ["custom", "input", "confirm", "select", "editor"]) f.ctx.ui[name] = () => assert.fail("No questionnaire UI from chat tools");
	const tool = (name, args) => f.tools.get(name).execute("call", args, undefined, undefined, f.ctx);
	const launch = { objective: "Fixture \u001b[31m \u202e goal" };
	const proposal = await tool("swarm_start", launch);
	assert.equal(proposal.details.status, "approval-required");
	assert.ok(f.messages[0].message.content.includes("git-init"));
	assert.ok(!f.messages[0].message.content.includes("\u202e"));
	await f.event("input", { source: "interactive", text: proposal.details.reply });
	assert.equal(f.auth(), 0);
	assert.equal((await tool("swarm_start", { ...launch, proposalId: proposal.details.proposalId })).details.status, "running");
	await until(() => f.calls.length === 1);
	assert.equal(readFileSync(join(root, "user.txt"), "utf8"), "Preserve me");
	assert.equal(readFileSync(join(root, ".gitignore"), "utf8"), "# rules\r\n/.swarms/\r\n");
	assert.equal(execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8" }), "");
	await tool("swarm_control", { action: "pause" });
	assert.equal((await tool("swarm_start", { ...launch, proposalId: proposal.details.proposalId })).isError, true);
	for (const action of ["resume", "restart"]) {
		const next = await tool("swarm_control", { action });
		assert.equal(next.details.status, "approval-required");
		await f.event("input", { source: "interactive", text: next.details.reply });
		assert.equal((await tool("swarm_control", { action, proposalId: next.details.proposalId })).details.status, "running");
		await until(() => f.calls.length === (action === "resume" ? 2 : 3));
		await tool("swarm_control", { action: "pause" });
	}
});

test("normal entry registers synchronously without model, auth, provider dispatch or discovery", async t => {
	const f = await fixture(t);
	await f.event("session_start", { reason: "startup" });
	await f.command("status");
	assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
	await assert.rejects(f.command("start goal"), { code: "MODEL" });
	assert.equal(existsSync(join(f.ctx.cwd, ".swarms")), false);
	f.select("first"); f.ctx.sessionManager.getSessionFile = () => undefined;
	await assert.rejects(f.command("start goal"), { code: "SESSION" });
	assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
});

test("normal entry snapshots current model and thinking at launch, not load or cancelled agreement", async t => {
	const f = await fixture(t); f.select("first");
	f.answers.push("Cancel");
	await assert.rejects(f.command("start cancelled"), { code: "AUTHORITY" });
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
	for (const stage of ["objective", "agreement"]) {
		test(`${event} during ${stage} prevents late approval and auth`, async t => {
			const f = await fixture(t); f.select("first");
			let shown = false; let release;
			const answer = new Promise(resolve => { release = resolve; });
			if (stage === "objective") f.ctx.ui.input = async () => { shown = true; return answer; };
			else f.ctx.ui.custom = decisionUI(() => async () => { shown = true; return answer; });
			const launch = stage === "objective" ? f.command("start") : assert.rejects(f.command("start goal"));
			await until(() => shown);
			f.select("second"); f.thinking("low");
			await f.event(event);
			release(stage === "objective" ? "Late goal" : "Approve");
			await launch;
			assert.equal(f.calls.length, 0); assert.equal(f.auth(), 0);
			assert.equal(existsSync(join(f.ctx.cwd, ".swarms")), false);
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
	await assert.rejects(f.command("resume"), { code: "AUTHORITY" });
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
		await resume;
		assert.equal(next.packets.length, 0);
		assert.equal(next.calls.length, 0);
		if (cancellation === "owner-change") {
			await assert.rejects(next.command("resume"), { code: "OWNERSHIP" });
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
	const resume = assert.rejects(next.command("resume"), { code: "OWNERSHIP" });
	await next.event("thinking_level_select");
	await resume;
	assert.equal(next.packets.length, 0); assert.equal(next.calls.length, 0);
	await next.command("stop");
	assert.equal((await next.status()).status, "stopped");
});

test("normal entry denies missing policy and non-TUI before provider dispatch", async t => {
	const f = await fixture(t, { policy: false }); f.select("first");
	f.ctx.mode = "print"; f.ctx.hasUI = false;
	await assert.rejects(f.command("start goal"), { code: "UI" });
	f.ctx.mode = "tui"; f.ctx.hasUI = true;
	await assert.rejects(f.command("start goal"));
	assert.equal(f.calls.length, 0); assert.equal(f.auth(), 0);
	assert.equal(existsSync(join(f.ctx.cwd, ".swarms")), false);
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


function uninitialized(t) {
	const root = mkdtempSync(join(tmpdir(), "swarm-entry-setup-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(join(root, "source.txt"), "preserve\n");
	return root;
}

test("normal entry obtains setup consent before questions, host binding or model calls", async t => {
	const root = uninitialized(t); const f = await fixture(t, { root }); f.select("first");
	const confirmations = []; const questions = [];
	f.ctx.ui.confirm = async title => { confirmations.push(title); return true; };
	f.ctx.ui.input = async title => { questions.push(title); return undefined; };
	await f.command("start");
	assert.equal(confirmations.length, 2);
	assert.deepEqual(questions, ["Swarm objective"]);
	assert.equal(readFileSync(join(root, ".gitignore"), "utf8"), "/.swarms/\n");
	assert.equal(readFileSync(join(root, "source.txt"), "utf8"), "preserve\n");
	assert.equal(existsSync(join(root, ".swarms")), false);
	assert.equal((await f.status()).status, "unattached");
	assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
});

for (const restriction of ["missing-policy", "plan", "no-ui", "decline"]) {
	test(`normal entry ${restriction} makes no prerequisite changes`, async t => {
		const root = uninitialized(t);
		const f = await fixture(t, { root, policy: restriction !== "missing-policy" }); f.select("first");
		let confirmations = 0; let questions = 0;
		f.ctx.ui.confirm = async () => { confirmations++; return false; };
		f.ctx.ui.input = async () => { questions++; return undefined; };
		if (restriction === "no-ui") f.ctx.hasUI = false;
		if (restriction === "plan") {
			f.events.removeAllListeners("pi-plan:query-mode");
			f.events.on("pi-plan:query-mode", request => request.respond({ version: 1, instanceId: "restricted", revision: 1,
				contextRevision: 1, ready: true, sessionId: "owner1", selectedMode: "plan", enforcedMode: "plan", runMode: null, pendingChange: false }));
		}
		if (restriction === "decline") await f.command("start goal");
		else await assert.rejects(f.command("start goal"), { code: restriction === "no-ui" ? "UI" : "MODE_DENIED" });
		assert.equal(confirmations, restriction === "decline" ? 1 : 0);
		assert.equal(questions, 0); assert.equal(f.calls.length, 0); assert.equal(f.auth(), 0);
		assert.deepEqual(readdirSync(root), ["source.txt"]);
	});
}

for (const cancellation of ["model_select", "thinking_level_select", "pause", "session_before_switch", "owner", "mode"]) {
	test(`normal entry ${cancellation} during ignore consent prevents the second setup write`, async t => {
		const root = uninitialized(t); const f = await fixture(t, { root }); f.select("first");
		let confirmations = 0;
		f.ctx.ui.confirm = async (_title, _message, { signal }) => {
			if (++confirmations === 1) return true;
			if (cancellation === "mode") f.events.emit("pi-plan:mode-changed", { version: 1, instanceId: "entry-policy", revision: 2,
				contextRevision: 1, ready: true, sessionId: "owner1", selectedMode: "plan", enforcedMode: "plan", runMode: null, pendingChange: false });
			else if (cancellation === "owner") f.ctx.sessionManager.getSessionId = () => "replacement";
			else if (cancellation === "pause") await f.command("pause");
			else await f.event(cancellation);
			if (cancellation !== "owner") assert.equal(signal.aborted, true);
			return true; // A late approval cannot revive the operation.
		};
		if (cancellation === "owner") await assert.rejects(f.command("start goal"), { code: "OWNERSHIP" });
		else await f.command("start goal");
		assert.equal(existsSync(join(root, ".git")), true);
		assert.equal(existsSync(join(root, ".gitignore")), false);
		assert.equal(existsSync(join(root, ".swarms")), false);
		assert.equal(f.auth(), 0); assert.equal(f.calls.length, 0);
	});
}

test("normal entry setup errors are actionable, sanitized and do not fall through to questions", async t => {
	const root = uninitialized(t); const f = await fixture(t, { root }); f.select("first");
	execFileSync("git", ["-C", root, "init", "-q"]);
	writeFileSync(join(root, ".gitignore"), Buffer.from([0]));
	f.ctx.ui.input = () => assert.fail("must not ask launch questions");
	await f.command("start goal");
	assert.match(f.notices.at(-1), /unsupported data/);
	assert.ok(!f.notices.at(-1).includes(root));
	assert.equal(f.calls.length, 0); assert.equal(f.auth(), 0);
});
