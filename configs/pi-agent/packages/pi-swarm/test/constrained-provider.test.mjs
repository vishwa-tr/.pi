import {
	bindConstrainedRuntime, createConstrainedRuntime,
} from "../extensions/swarm/constrained-provider.mjs";
import {
	assertProviderSelection, createProviderCapability, PROVIDER_DATA_SCOPE,
} from "../extensions/swarm/provider-capability.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { repository } from "./helpers.mjs";
import { guardNetwork } from "./network-guard.mjs";
import { SwarmHost } from "../extensions/swarm/host.mjs";
import { createSwarmExtension } from "../extensions/swarm/extension.mjs";

const descriptor = () => ({ version: 1, provider: "fixture-provider", modelId: "fixture-model", api: "openai-completions",
	endpoint: "https://provider.invalid/v1/chat/completions", transport: "https-chat-completions", outboundData: [...PROVIDER_DATA_SCOPE] });
const credential = "fixture-secret-never-persist";
const delta = (value, finish = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`;
const encoded = text => delta({ role: "assistant", content: text }) + delta({}, "stop") + "data: [DONE]\n\n";
function response(data = encoded("Fixture answer"), chunkSize = 3) {
	return { status: 200, contentType: "text/event-stream; charset=utf-8", body: (async function* () {
		const bytes = Buffer.from(data);
		for (let i = 0; i < bytes.length; i += chunkSize) yield bytes.subarray(i, i + chunkSize);
	})() };
}
async function fixture(transport, options = {}) {
	const capability = createProviderCapability(descriptor());
	const runtime = await createConstrainedRuntime({ capability, credential, transport, ...options });
	const model = runtime.getModel("fixture-provider", "fixture-model");
	const cancel = new AbortController();
	let admissions = 0;
	const admission = { assert: async () => { admissions++; cancel.signal.throwIfAborted(); }, check: () => cancel.signal.throwIfAborted(), signal: () => cancel.signal };
	const bound = bindConstrainedRuntime(runtime, capability, admission);
	return { runtime, capability, model, bound, cancel, admissions: () => admissions };
}
const context = { systemPrompt: "Explicit guidance", messages: [{ role: "user", content: "Hello", timestamp: 1 }] };

for (const method of ["stream", "streamSimple", "complete", "completeSimple"]) {
	test(`constrained ${method} uses exact constructed request without SDK auth/discovery`, async t => {
		guardNetwork(t);
		const calls = [];
		const f = await fixture(request => { calls.push(request); return response(encoded("héllo")); });
		const value = f.bound[method](f.model, context);
		const result = await (value.result ? value.result() : value);
		assert.equal(result.stopReason, "stop"); assert.equal(result.content[0].text, "héllo");
		assert.equal(f.admissions(), 1); assert.equal(calls.length, 1);
		const request = calls[0];
		assert.equal(request.url, descriptor().endpoint); assert.equal(request.method, "POST");
		assert.equal(request.headers.authorization, `Bearer ${credential}`);
		assert.deepEqual(JSON.parse(request.body), { model: "fixture-model", messages: [{ role: "system", content: "Explicit guidance" }, { role: "user", content: "Hello" }], stream: true, max_tokens: 4096 });
		assert.equal(request.redirect, "error"); assert.equal(request.retries, 0);
		assert.ok(!JSON.stringify(f.runtime).includes(credential));
	});
}

test("branded selection rejects forged runtimes, capabilities, model and request overrides before transport", async t => {
	guardNetwork(t);
	let calls = 0;
	const f = await fixture(() => { calls++; return response(); });
	const selection = { provider: f.model.provider, modelId: f.model.id, thinkingLevel: "off" };
	assert.throws(() => assertProviderSelection(f.capability, selection, { ...f.runtime }), { code: "PROVIDER" });
	assert.throws(() => assertProviderSelection(createProviderCapability(descriptor()), selection, f.runtime), { code: "PROVIDER" });
	assert.throws(() => assertProviderSelection(f.capability, { ...selection, thinkingLevel: "high" }, f.runtime), { code: "PROVIDER" });
	assert.equal((await f.runtime.completeSimple(f.model, context)).stopReason, "error");
	for (const patch of [{ apiKey: "override" }, { headers: {} }, { env: {} }, { samplingParams: { model: "other" } }, { reasoning: "high" }, { maxRetries: 1 }]) {
		assert.equal((await f.bound.completeSimple(f.model, context, patch)).stopReason, "error");
	}
	assert.equal((await f.bound.completeSimple({ ...f.model }, context)).stopReason, "error");
	assert.equal(calls, 0);
});

test("fragmented tool calls are validated and round-trip with tool results", async t => {
	guardNetwork(t);
	const wire = delta({ tool_calls: [{ index: 0, id: "call1", type: "function", function: { name: "inspect", arguments: '{"x":' } }] }) +
		delta({ tool_calls: [{ index: 0, function: { arguments: '1}' } }] }) + delta({}, "tool_calls") + "data: [DONE]\n\n";
	const requests = [];
	const f = await fixture(request => { requests.push(JSON.parse(request.body)); return response(requests.length === 1 ? wire : encoded("Done")); });
	const tools = [{ name: "inspect", description: "Fixture inspection", parameters: { type: "object", properties: { x: { type: "number" } } } }];
	const first = await f.bound.completeSimple(f.model, { ...context, tools });
	assert.equal(first.stopReason, "toolUse");
	assert.deepEqual(first.content, [{ type: "toolCall", id: "call1", name: "inspect", arguments: { x: 1 } }]);
	await f.bound.completeSimple(f.model, { ...context, tools, messages: [...context.messages, first, { role: "toolResult", toolCallId: "call1", content: [{ type: "text", text: "result" }] }] });
	assert.equal(f.admissions(), 2);
	assert.deepEqual(requests[1].messages.at(-1), { role: "tool", tool_call_id: "call1", content: "result" });
	assert.equal(requests[1].messages.at(-2).tool_calls[0].function.arguments, '{"x":1}');
});

for (const [label, transport] of [
	["model substitution", () => response('data: {"model":"other","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')],
	["oversized response", () => response("x".repeat(4 * 1024 * 1024 + 1), 5 * 1024 * 1024)],
	["redirect", () => ({ status: 307, contentType: "text/event-stream", location: "https://other.invalid" })],
	["status", () => ({ status: 401, body: credential })],
	["transport exception", () => { throw new Error(credential); }],
	["response error", () => response(`data: {"error":"${credential}"}\n\n`)],
	["malformed JSON", () => response("data: not-json\n\n")],
	["truncated response", () => response(delta({ content: credential }))],
	["unknown finish", () => response(delta({}, "content_filter") + "data: [DONE]\n\n")],
	["reasoning", () => response(delta({ reasoning_content: credential }))],
	["invalid arguments", () => response(delta({ content: credential }) + delta({ tool_calls: [{ index: 0, id: "call1", type: "function", function: { name: "inspect", arguments: "[]" } }] }, "tool_calls") + "data: [DONE]\n\n")],
]) {
	test(`${label} fails closed with a fixed sanitized error and no retry`, async t => {
		guardNetwork(t);
		let calls = 0;
		const f = await fixture(request => { calls++; return transport(request); });
		const result = await f.bound.completeSimple(f.model, context);
		assert.equal(result.stopReason, "error"); assert.equal(calls, 1);
		assert.equal(result.errorMessage, "Constrained provider request failed");
		assert.ok(!JSON.stringify(result).includes(credential)); assert.deepEqual(result.content, []);
	});
}

for (const reason of ["abort", "deadline"]) {
	test(`${reason} cancels the actual request and yields only sanitized cancellation`, async t => {
		guardNetwork(t);
		let started;
		const ready = new Promise(resolve => { started = resolve; });
		const f = await fixture(request => new Promise((_, reject) => {
			started(request); request.signal.addEventListener("abort", () => reject(new Error(credential)), { once: true });
		}), { timeoutMs: 30 });
		const pending = f.bound.completeSimple(f.model, context);
		const request = await ready;
		if (reason === "abort") f.cancel.abort();
		const result = await pending;
		assert.equal(request.signal.aborted, true); assert.equal(result.stopReason, "aborted");
		assert.equal(result.errorMessage, "Constrained provider request cancelled");
	});
}

function modeBus() {
	const events = new EventEmitter();
	let mode = { version: 1, instanceId: "provider1", revision: 1, contextRevision: 1, ready: true,
		sessionId: "owner1", selectedMode: "off", enforcedMode: "off", runMode: null, pendingChange: false };
	events.on("pi-plan:query-mode", request => request.respond({ ...mode }));
	return { events, change(values) { mode = { ...mode, ...values, revision: mode.revision + 1 }; events.emit("pi-plan:mode-changed", { ...mode }); } };
}
const specification = { objective: "Constrained offline integration", criteria: ["Protocol validated"], scope: ["Disposable fixture"] };
const approve = () => ({ approved: true, existingChanges: "preserve", reconciled: true });

test("real SDK host follow-ups, compaction, persisted errors and paused restore use the constrained path", async t => {
	guardNetwork(t);
	const root = repository(t);
	const requests = [];
	const tool = delta({ tool_calls: [{ index: 0, id: "call1", type: "function", function: { name: "swarm_status", arguments: "{}" } }] }, "tool_calls") + "data: [DONE]\n\n";
	const f = await fixture(request => {
		requests.push(JSON.parse(request.body));
		if (requests.length === 5) throw new Error(credential);
		return response(requests.length === 1 ? tool : encoded("Confirmed fixture summary."));
	});
	const mode = modeBus();
	const options = { events: mode.events, sessionId: "owner1", providerCapability: f.capability,
		modelRuntime: f.runtime, mainModel: f.model, requestApproval: approve, tickIntervalMs: 0 };
	assert.equal(typeof createSwarmExtension(options), "function");
	const host = new SwarmHost(options);
	await host.launch({ workspace: root, runId: "run1", specification });
	await host.recruit({ id: "worker", specialization: "Protocol", brief: "Inspect fixture", reason: "Initial check" });
	host.wake("worker", "Decision context ".repeat(15000)); await host.idle();
	assert.equal(requests.length, 2, JSON.stringify(host.snapshot().driver));
	assert.ok(requests[1].messages.some(message => message.role === "tool"));
	host.wake("worker", "More context ".repeat(15000)); await host.idle();
	await host.compact("worker"); await host.idle();
	assert.equal(requests.length, 4, JSON.stringify(host.snapshot().driver));
	assert.ok(host.history("worker").some(entry => entry.type === "compaction"));
	host.wake("worker"); await host.idle();
	assert.equal(requests.length, 5);
	assert.ok(JSON.stringify(host.history("worker")).includes("Constrained provider request failed"));
	assert.ok(!JSON.stringify(host.history("worker")).includes(credential));
	assert.ok(!JSON.stringify(host.snapshot()).includes(credential));
	await host.close();
	const restored = new SwarmHost(options);
	await restored.restore({ workspace: root, runId: "run1" });
	assert.throws(() => restored.wake("worker"), { code: "HOST_DENIED" });
	assert.equal(requests.length, 5);
	await restored.resume(); restored.wake("worker"); await restored.idle();
	assert.equal(requests.length, 6);
	await restored.close();
});

test("mode revocation during an actual SDK request aborts transport and never renews admission", async t => {
	guardNetwork(t);
	const root = repository(t);
	let started;
	const ready = new Promise(resolve => { started = resolve; });
	const f = await fixture(request => new Promise((_, reject) => {
		started(request); request.signal.addEventListener("abort", () => reject(new Error(credential)), { once: true });
	}));
	const mode = modeBus();
	const host = new SwarmHost({ events: mode.events, sessionId: "owner1", providerCapability: f.capability,
		modelRuntime: f.runtime, mainModel: f.model, requestApproval: approve, tickIntervalMs: 0 });
	await host.launch({ workspace: root, runId: "run1", specification });
	await host.recruit({ id: "worker", specialization: "Protocol", brief: "Inspect fixture", reason: "Initial check" });
	host.wake("worker"); const request = await ready;
	mode.change({ selectedMode: "plan", enforcedMode: "plan" });
	await host.idle(); assert.equal(request.signal.aborted, true);
	mode.change({ selectedMode: "off", enforcedMode: "off" });
	assert.throws(() => host.wake("worker"), { code: "HOST_DENIED" });
	assert.ok(!JSON.stringify(host.history("worker")).includes(credential));
	await host.close();
});

test("SDK request mutation callbacks are inert and multimodal input is rejected", async t => {
	guardNetwork(t);
	let calls = 0;
	const f = await fixture(() => { calls++; return response(); });
	const forbidden = () => { throw new Error("Must not invoke SDK request override"); };
	const result = await f.bound.completeSimple(f.model, context, { onPayload: forbidden, transformHeaders: forbidden, onResponse: forbidden });
	assert.equal(result.stopReason, "stop");
	const image = { ...context, messages: [{ role: "user", content: [{ type: "image", data: "fixture", mimeType: "image/png" }] }] };
	assert.equal((await f.bound.completeSimple(f.model, image)).stopReason, "error");
	assert.equal(calls, 1);
});

test("revocation during request construction fences dispatch after asynchronous admission", async t => {
	guardNetwork(t);
	let calls = 0;
	const f = await fixture(() => { calls++; return response(); });
	const input = { ...context, get messages() { f.cancel.abort(); return context.messages; } };
	const result = await f.bound.completeSimple(f.model, input);
	assert.equal(result.stopReason, "aborted"); assert.equal(calls, 0);
});

test("revocation at response completion publishes no text or tool-call events", async t => {
	guardNetwork(t);
	let f;
	f = await fixture(() => ({ status: 200, contentType: "text/event-stream", body: (async function* () {
		yield encoded(credential); f.cancel.abort();
	})() }));
	const stream = f.bound.streamSimple(f.model, context);
	const events = [];
	for await (const event of stream) events.push(event.type);
	assert.deepEqual(events, ["start", "error"]);
	assert.ok(!JSON.stringify(await stream.result()).includes(credential));
});

test("manual compaction cancellation retains ownership until an uncooperative transport actually settles", async t => {
	guardNetwork(t);
	const root = repository(t);
	let calls = 0;
	let started;
	let release;
	const ready = new Promise(resolve => { started = resolve; });
	const f = await fixture(request => {
		calls++;
		if (calls < 3) return response();
		started(request);
		return new Promise(resolve => { release = () => resolve(response(encoded(credential))); });
	});
	const mode = modeBus();
	const host = new SwarmHost({ events: mode.events, sessionId: "owner1", providerCapability: f.capability,
		modelRuntime: f.runtime, mainModel: f.model, requestApproval: approve, tickIntervalMs: 0 });
	await host.launch({ workspace: root, runId: "run1", specification });
	await host.recruit({ id: "worker", specialization: "Protocol", brief: "Inspect fixture", reason: "Initial check" });
	host.wake("worker", "Decision context ".repeat(15000)); await host.idle();
	host.wake("worker", "More context ".repeat(15000)); await host.idle();
	const compaction = host.compact("worker");
	const request = await ready;
	assert.equal((await host.pause({ timeoutMs: 5 })).settled, false);
	assert.equal(request.signal.aborted, true);
	assert.equal(host.snapshot().run.sessions.turns.length, 1);
	assert.equal(host.snapshot().driver.active.length, 1);
	release(); await compaction; await host.idle();
	assert.equal(host.snapshot().run.sessions.turns.length, 0);
	assert.ok(!host.history("worker").some(entry => entry.type === "compaction"));
	assert.ok(!JSON.stringify(host.history("worker")).includes(credential));
	assert.equal(calls, 3);
	await host.close();
});

test("the run deadline aborts an in-flight SDK transport independently of its request timeout", async t => {
	guardNetwork(t);
	const root = repository(t);
	let started;
	const ready = new Promise(resolve => { started = resolve; });
	const f = await fixture(request => new Promise((_, reject) => {
		started(request); request.signal.addEventListener("abort", () => reject(new Error(credential)), { once: true });
	}), { timeoutMs: 10000 });
	const mode = modeBus();
	const host = new SwarmHost({ events: mode.events, sessionId: "owner1", providerCapability: f.capability,
		modelRuntime: f.runtime, mainModel: f.model, requestApproval: approve, tickIntervalMs: 5 });
	await host.launch({ workspace: root, runId: "run1", specification: { ...specification, limits: { durationMs: 500 } } });
	await host.recruit({ id: "worker", specialization: "Protocol", brief: "Inspect fixture", reason: "Initial check" });
	host.wake("worker"); const request = await ready;
	await host.idle();
	assert.equal(request.signal.aborted, true);
	assert.equal(host.snapshot().run.status, "paused");
	assert.ok(host.snapshot().run.elapsedMs >= 500);
	assert.equal(host.snapshot().run.sessions.turns.length, 0);
	await host.close();
});
