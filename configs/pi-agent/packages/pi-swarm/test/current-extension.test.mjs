import {
	InMemoryCredentialStore, createAssistantMessageEventStream, createProvider, envApiKeyAuth,
} from "@earendil-works/pi-ai";
import test from "node:test";
import { join } from "node:path";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { repository } from "./helpers.mjs";
import { decisionUI } from "./decision-fixture.mjs";
import { guardNetwork } from "./network-guard.mjs";
import { SwarmHost } from "../extensions/swarm/host.mjs";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createCurrentSwarmExtension } from "../extensions/swarm/extension.mjs";

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
	const pi = { events, on: (name, fn) => handlers.set(name, fn), registerCommand: (name, value) => { assert.equal(name, "swarm"); command = value; },
		getThinkingLevel: () => thinking, appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }) };
	assert.equal(createCurrentSwarmExtension()(pi), undefined);
	const event = (name, data = {}) => handlers.get(name)?.(data, ctx);
	t.after(() => event("session_shutdown"));
	return { ctx, source, calls, packets, answers, entries, event, auth: () => auth,
		select(id) { ctx.model = source.getModel(model.provider, id); }, thinking(value) { thinking = value; },
		command: args => command.handler(args, ctx), status: async () => { await command.handler("status", ctx); return notices.at(-1).startsWith("{") ? JSON.parse(notices.at(-1)) : { status: "unattached" }; } };
}

async function until(predicate) {
	for (let i = 0; i < 1000; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
	assert.fail("Worker did not settle");
}

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
