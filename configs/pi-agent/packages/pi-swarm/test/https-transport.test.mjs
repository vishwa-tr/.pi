import {
	authorizeHttpsEgress, authorizeLoopbackHttpsTest, createHttpsTransport, isPublicIPv4,
} from "../extensions/swarm/https-transport.mjs";
import {
	bindConstrainedRuntime, createConstrainedRuntime,
} from "../extensions/swarm/constrained-provider.mjs";
import test from "node:test";
import https from "node:https";
import dns from "node:dns/promises";
import assert from "node:assert/strict";
import { repository } from "./helpers.mjs";
import { EventEmitter, once } from "node:events";
import { guardNetwork } from "./network-guard.mjs";
import { syncBuiltinESMExports } from "node:module";
import { ephemeralTlsFixture } from "./tls-fixture.mjs";
import { SwarmHost } from "../extensions/swarm/host.mjs";
import { createProviderCapability, PROVIDER_DATA_SCOPE } from "../extensions/swarm/provider-capability.mjs";

const credential = "ephemeral-fixture-secret";
const context = { messages: [{ role: "user", content: "Hello", timestamp: 1 }] };
const descriptor = endpoint => ({ version: 1, provider: "fixture", modelId: "fixture-model", api: "openai-completions",
	endpoint, transport: "https-chat-completions", outboundData: [...PROVIDER_DATA_SCOPE] });
const delta = (value, finish = null) => `data: ${JSON.stringify({ model: "fixture-model", choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`;
const encoded = text => delta({ content: text }) + delta({}, "stop") + "data: [DONE]\n\n";

async function fixture(t, handler, { mismatch = false, untrusted = false, timeoutMs = 3000 } = {}) {
	const material = ephemeralTlsFixture({ mismatch });
	const requests = [];
	const server = https.createServer(material, async (req, res) => {
		let body = "";
		for await (const chunk of req) body += chunk;
		requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
		handler(req, res, requests.length);
	});
	server.on("tlsClientError", () => {});
	server.listen(0, "127.0.0.1"); await once(server, "listening");
	t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
	const port = server.address().port;
	const guard = guardNetwork(t, { loopbackPort: port });
	const endpoint = `https://localhost:${port}/v1/chat/completions`;
	const capability = createProviderCapability(descriptor(endpoint));
	const authorization = authorizeLoopbackHttpsTest(capability, { allowNetwork: true, endpoint, modelId: "fixture-model", ca: untrusted ? ephemeralTlsFixture().ca : material.ca });
	const transport = createHttpsTransport({ capability, authorization });
	const runtime = await createConstrainedRuntime({ capability, credential, transport, timeoutMs });
	const model = runtime.getModel("fixture", "fixture-model");
	const cancel = new AbortController();
	let admissions = 0;
	const admission = { assert: async () => { admissions++; cancel.signal.throwIfAborted(); }, check: () => cancel.signal.throwIfAborted(), signal: () => cancel.signal };
	const bound = bindConstrainedRuntime(runtime, capability, admission);
	return { ...guard, requests, runtime, bound, model, cancel, capability, transport, authorization, endpoint, admissions: () => admissions };
}

test("ephemeral CA/leaf strictly verify actual fragmented TLS/SSE and exact request", async t => {
	const f = await fixture(t, (_req, res) => {
		res.writeHead(200, { "content-type": "text/event-stream" });
		const bytes = Buffer.from(encoded("héllo"));
		for (const byte of bytes) res.write(Buffer.from([byte]));
		res.end();
	});
	const result = await f.bound.completeSimple(f.model, context);
	assert.equal(result.stopReason, "stop"); assert.equal(result.content[0].text, "héllo");
	assert.equal(f.sockets.size, 0);
	assert.equal(f.requests.length, 1);
	assert.equal(f.requests[0].url, "/v1/chat/completions");
	assert.equal(f.requests[0].headers.authorization, `Bearer ${credential}`);
	assert.equal(f.requests[0].body.model, f.model.id);
	assert.equal(f.requests[0].headers.connection, "close");
	assert.deepEqual(Object.keys(f.requests[0].headers).sort(), ["accept", "authorization", "connection", "content-length", "content-type", "host"]);
	assert.ok(!JSON.stringify(f.runtime).includes(credential));
});

test("revocation at socket settlement suppresses an otherwise valid response", async t => {
	let respond;
	const ready = new Promise(resolve => { respond = resolve; });
	const f = await fixture(t, (_req, res) => respond(res));
	const pending = f.bound.completeSimple(f.model, context);
	const response = await ready;
	const [socket] = f.sockets;
	socket.once("close", () => f.cancel.abort());
	response.writeHead(200, { "content-type": "text/event-stream" });
	response.end(encoded(credential));
	const result = await pending;
	assert.equal(result.stopReason, "aborted"); assert.deepEqual(result.content, []);
	assert.ok(!JSON.stringify(result).includes(credential)); assert.equal(f.sockets.size, 0);
});

for (const kind of ["redirect", "invalid-sse", "model-substitution", "certificate-mismatch", "untrusted-certificate"]) {
	test(`${kind} fails once, redacts credentials and awaits actual socket closure`, async t => {
		const f = await fixture(t, (_req, res) => {
			res.writeHead(kind === "redirect" ? 307 : 200, { "content-type": "text/event-stream", location: "https://forbidden.invalid/chat/completions" });
			res.write(kind === "model-substitution" ? encoded(credential).replaceAll('"fixture-model"', '"other"') : `data: ${credential}\n\n`);
			// Intentionally never end: parser/status rejection must destroy the socket.
		}, { mismatch: kind === "certificate-mismatch", untrusted: kind === "untrusted-certificate" });
		const result = await f.bound.completeSimple(f.model, context);
		assert.equal(result.stopReason, "error"); assert.equal(result.errorMessage, "Constrained provider request failed");
		assert.ok(!JSON.stringify(result).includes(credential));
		assert.equal(f.requests.length, ["certificate-mismatch", "untrusted-certificate"].includes(kind) ? 0 : 1);
		assert.equal(f.sockets.size, 0);
	});
}

for (const phase of ["headers", "body"]) for (const reason of ["cancel", "deadline"]) {
	test(`slow ${phase} ${reason} waits for actual client socket close`, async t => {
		let started;
		const ready = new Promise(resolve => { started = resolve; });
		const f = await fixture(t, (_req, res) => {
			if (phase === "body") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(delta({ content: credential })); }
			started();
		}, { timeoutMs: reason === "deadline" ? 150 : 3000 });
		const pending = f.bound.completeSimple(f.model, context);
		await ready;
		assert.equal(f.sockets.size, 1);
		if (reason === "cancel") f.cancel.abort();
		const result = await pending;
		assert.equal(result.stopReason, "aborted"); assert.equal(f.sockets.size, 0);
		assert.equal(f.requests.length, 1); assert.ok(!JSON.stringify(result).includes(credential));
	});
}

test("egress authorization is identity-bound, exact and cannot be forged or upgraded", async t => {
	guardNetwork(t);
	const endpoint = "https://provider.invalid/v1/chat/completions";
	const capability = createProviderCapability(descriptor(endpoint));
	const options = { allowNetwork: true, endpoint, modelId: "fixture-model" };
	for (const patch of [{ allowNetwork: false }, { endpoint: "https://other.invalid/v1/chat/completions" }, { modelId: "other" }, { headers: {} }]) {
		assert.throws(() => authorizeHttpsEgress(capability, { ...options, ...patch }));
	}
	const authorization = authorizeHttpsEgress(capability, options);
	assert.throws(() => createHttpsTransport({ capability, authorization: {} }));
	assert.throws(() => createHttpsTransport({ capability: createProviderCapability(descriptor(endpoint)), authorization }));
	const transport = createHttpsTransport({ capability, authorization });
	await assert.rejects(createConstrainedRuntime({ capability, credential, transport: { ...transport } }));
	for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "169.254.169.254", "[::1]"]) {
		const local = `https://${host}/v1/chat/completions`;
		assert.throws(() => authorizeHttpsEgress(createProviderCapability(descriptor(local)), { ...options, endpoint: local }));
	}
	assert.throws(() => authorizeLoopbackHttpsTest(capability, { ...options, ca: "invalid" }));
});

test("public IPv4 admission rejects special-use and IPv6 addresses", () => {
	for (const value of ["0.0.0.0", "10.0.0.1", "100.64.0.1", "127.1.2.3", "169.254.1.1", "172.31.0.1", "192.168.0.1", "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::1", "::ffff:127.0.0.1"]) assert.equal(isPublicIPv4(value), false, value);
	assert.equal(isPublicIPv4("8.8.8.8"), true); // Pure classification, no connection.
});

test("unbound/overridden runtime and revoked admission never dispatch TLS", async t => {
	const f = await fixture(t, (_req, res) => res.end());
	assert.equal((await f.runtime.completeSimple(f.model, context)).stopReason, "error");
	assert.equal((await f.bound.completeSimple(f.model, context, { headers: {} })).stopReason, "error");
	assert.equal((await f.bound.completeSimple({ ...f.model }, context)).stopReason, "error");
	f.cancel.abort();
	assert.equal((await f.bound.completeSimple(f.model, context)).stopReason, "error");
	assert.equal(f.requests.length, 0); assert.equal(f.sockets.size, 0);
});

function modeBus() {
	const events = new EventEmitter();
	let mode = { version: 1, instanceId: "fixture-mode", revision: 1, contextRevision: 1, ready: true,
		sessionId: "owner1", selectedMode: "off", enforcedMode: "off", runMode: null, pendingChange: false };
	events.on("pi-plan:query-mode", request => request.respond({ ...mode }));
	return { events, change(value) {
		mode = { ...mode, selectedMode: value, enforcedMode: value, revision: mode.revision + 1 };
		events.emit("pi-plan:mode-changed", { ...mode });
	} };
}
const specification = { objective: "Loopback TLS integration", criteria: ["Protocol validated"], scope: ["Disposable fixture"] };
async function hostFixture(t, f, options = {}) {
	const root = repository(t);
	const mode = modeBus();
	const inputs = { events: mode.events, sessionId: "owner1", providerCapability: f.capability,
		modelRuntime: f.runtime, mainModel: f.model, requestApproval: () => ({ approved: true, existingChanges: "preserve", reconciled: true }),
		tickIntervalMs: 0, ...options };
	const host = new SwarmHost(inputs);
	await host.launch({ workspace: root, runId: "run1", specification });
	await host.recruit({ id: "worker", specialization: "Protocol", brief: "Inspect fixture", reason: "Initial check" });
	return { host, mode, root, inputs };
}

test("actual SDK TLS tool follow-ups, native compaction and restore retain approval gates", async t => {
	const tool = delta({ tool_calls: [{ index: 0, id: "call1", type: "function", function: { name: "swarm_status", arguments: "{}" } }] }, "tool_calls") + "data: [DONE]\n\n";
	const f = await fixture(t, (_req, res, count) => {
		res.writeHead(200, { "content-type": "text/event-stream" });
		res.end(count === 1 ? tool : encoded("Fixture summary."));
	});
	const { host, root, inputs } = await hostFixture(t, f);
	host.wake("worker", "Decision context ".repeat(15000)); await host.idle();
	assert.equal(f.requests.length, 2); assert.equal(f.sockets.size, 0);
	assert.ok(f.requests[1].body.messages.some(message => message.role === "tool"));
	host.wake("worker", "More context ".repeat(15000)); await host.idle();
	await host.compact("worker"); await host.idle();
	assert.equal(f.requests.length, 4); assert.equal(f.sockets.size, 0);
	assert.ok(host.history("worker").some(entry => entry.type === "compaction"));
	assert.ok(!JSON.stringify(host.history("worker")).includes(credential));
	await host.close();
	const restored = new SwarmHost(inputs);
	await restored.restore({ workspace: root, runId: "run1" });
	assert.throws(() => restored.wake("worker"), { code: "HOST_DENIED" });
	assert.equal(f.requests.length, 4);
	await restored.resume(); restored.wake("worker"); await restored.idle();
	assert.equal(f.requests.length, 5); assert.equal(f.sockets.size, 0);
	await restored.close();
});

for (const compact of [false, true]) {
	test(`actual SDK ${compact ? "compaction" : "prompt"} mode revocation settles TLS before retiring turn`, async t => {
		let started;
		const ready = new Promise(resolve => { started = resolve; });
		const f = await fixture(t, (_req, res, count) => {
			res.writeHead(200, { "content-type": "text/event-stream" });
			if (compact && count < 3) res.end(encoded("Fixture answer."));
			else { res.write(delta({ content: credential })); started(); }
		});
		const { host, mode } = await hostFixture(t, f);
		let pending;
		if (compact) {
			host.wake("worker", "Decision context ".repeat(15000)); await host.idle();
			host.wake("worker", "More context ".repeat(15000)); await host.idle();
			pending = host.compact("worker");
		} else host.wake("worker");
		await ready;
		assert.equal(f.sockets.size, 1); assert.equal(host.snapshot().run.sessions.turns.length, 1);
		mode.change("plan");
		await pending; await host.idle();
		assert.equal(f.sockets.size, 0); assert.equal(host.snapshot().run.sessions.turns.length, 0);
		assert.ok(!host.history("worker").some(entry => entry.type === "compaction"));
		assert.ok(!JSON.stringify(host.history("worker")).includes(credential));
		mode.change("off");
		assert.throws(() => host.wake("worker"), { code: "HOST_DENIED" });
		assert.equal(f.requests.length, compact ? 3 : 1);
		await host.close();
	});
}

test("explicit TLS client ignores proxy environment and global HTTPS agent", async t => {
	const f = await fixture(t, (_req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(encoded("Direct")); });
	const keys = ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NODE_USE_ENV_PROXY"];
	const saved = keys.map(key => [key, process.env[key]]);
	const agent = https.globalAgent;
	t.after(() => {
		https.globalAgent = agent;
		for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
	});
	for (const key of keys) process.env[key] = key === "NODE_USE_ENV_PROXY" ? "1" : "http://forbidden.invalid:1";
	https.globalAgent = { protocol: "https:", addRequest() { throw new Error("Global agent must not route requests"); } };
	assert.equal((await f.bound.completeSimple(f.model, context)).stopReason, "stop");
	assert.equal(f.requests.length, 1); assert.equal(f.sockets.size, 0);
});

for (const scenario of ["private", "mixed", "empty", "revoked", "deadline"]) {
	test(`production DNS ${scenario} fails before any socket (stubbed resolution only)`, async t => {
		guardNetwork(t);
		const endpoint = "https://provider.invalid/v1/chat/completions";
		const capability = createProviderCapability(descriptor(endpoint));
		const authorization = authorizeHttpsEgress(capability, { allowNetwork: true, endpoint, modelId: "fixture-model" });
		const transport = createHttpsTransport({ capability, authorization });
		const runtime = await createConstrainedRuntime({ capability, transport, credential, timeoutMs: scenario === "deadline" ? 20 : 3000 });
		const model = runtime.getModel("fixture", "fixture-model");
		const cancel = new AbortController();
		const bound = bindConstrainedRuntime(runtime, capability, { assert: async () => {}, check: () => cancel.signal.throwIfAborted(), signal: () => cancel.signal });
		const original = dns.lookup;
		let calls = 0;
		let release;
		dns.lookup = async (host, options) => {
			calls++; assert.equal(host, "provider.invalid"); assert.deepEqual(options, { family: 4, all: true, verbatim: true });
			if (scenario === "revoked") cancel.abort();
			if (scenario === "deadline") await new Promise(resolve => { release = resolve; });
			if (scenario === "empty") return [];
			const publicAddress = { address: "8.8.8.8", family: 4 };
			const privateAddress = { address: "127.0.0.1", family: 4 };
			return scenario === "private" ? [privateAddress] : scenario === "mixed" ? [publicAddress, privateAddress] : [publicAddress];
		};
		syncBuiltinESMExports();
		try {
			let completed = false;
			const pending = bound.completeSimple(model, context).then(value => { completed = true; return value; });
			if (scenario === "deadline") {
				await new Promise(resolve => setTimeout(resolve, 50));
				assert.equal(completed, false, "Uncancellable OS DNS work retains settlement ownership");
				release();
			}
			const result = await pending;
			assert.equal(result.stopReason, ["revoked", "deadline"].includes(scenario) ? "aborted" : "error");
			assert.equal(calls, 1);
		} finally { dns.lookup = original; syncBuiltinESMExports(); }
	});
}
