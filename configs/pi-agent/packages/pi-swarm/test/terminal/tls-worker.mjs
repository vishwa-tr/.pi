// Explicitly loaded test-only process resource. Kept across native extension reload so
// the immutable approved endpoint does not change; quit owns server/guard cleanup.
import https from "node:https";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { guardNetwork } from "../network-guard.mjs";
import { ephemeralTlsFixture } from "../tls-fixture.mjs";
import { createConstrainedRuntime } from "../../extensions/swarm/constrained-provider.mjs";
import { authorizeLoopbackHttpsTest, createHttpsTransport } from "../../extensions/swarm/https-transport.mjs";
import { createProviderCapability, PROVIDER_DATA_SCOPE } from "../../extensions/swarm/provider-capability.mjs";

const resourceKey = Symbol.for("swarm.terminal.tls-resource");
const modelId = "terminal-scripted";

export async function createTlsWorker(record, nextStep) {
	let resource = globalThis[resourceKey];
	if (!resource) {
		resource = await startReceiver(record);
		globalThis[resourceKey] = resource;
	}
	resource.nextStep = nextStep;
	const capability = createProviderCapability({ version: 1, provider: "terminal-tls", modelId,
		api: "openai-completions", transport: "https-chat-completions", endpoint: resource.endpoint,
		outboundData: [...PROVIDER_DATA_SCOPE] });
	const authorization = authorizeLoopbackHttpsTest(capability, { allowNetwork: true,
		endpoint: resource.endpoint, modelId, ca: resource.ca });
	const transport = createHttpsTransport({ capability, authorization });
	const modelRuntime = await createConstrainedRuntime({ capability, transport,
		credential: resource.credential, timeoutMs: 120000 });
	return { modelRuntime, model: modelRuntime.getModel("terminal-tls", modelId), providerCapability: capability,
		close: () => resource.close() };
}

async function startReceiver(record) {
	const certificates = ephemeralTlsFixture();
	const credential = randomBytes(32).toString("hex");
	const sockets = new Set();
	const cleanup = [];
	const resource = { credential, ca: certificates.ca, nextStep: undefined, endpoint: undefined, close: undefined };
	let sequence = 0;
	const server = https.createServer(certificates, async (request, response) => {
		const id = ++sequence;
		try {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const bytes = Buffer.concat(chunks);
			const body = JSON.parse(bytes.toString("utf8"));
			assert.equal(request.method, "POST");
			assert.equal(request.url, "/v1/chat/completions");
			assert.equal(request.headers.authorization, `Bearer ${credential}`);
			assert.equal(body.model, modelId);
			assert.equal(body.stream, true);
			assert.deepEqual(Object.keys(body).sort(), ["max_tokens", "messages", "model", "stream", "tools"]);
			record({ type: "tls-request", id, method: request.method, path: request.url, model: body.model,
				hash: createHash("sha256").update(bytes).digest("hex"), last: body.messages.at(-1) });
			response.on("close", () => record({ type: "tls-response-close", id, completed: response.writableFinished }));
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.write(": fixture stream\n\n");
			const controller = new AbortController();
			response.on("close", () => controller.abort());
			const step = await resource.nextStep({ options: { signal: controller.signal } });
			if (controller.signal.aborted) return;
			if (step.waitForAbort) return; // Real TLS body remains live until native cancellation.
			const tools = step.toolCalls?.map((call, index) => ({ index, id: `tls-${id}-${index}`, type: "function",
				function: { name: call.name, arguments: JSON.stringify(call.arguments) } }));
			const delta = tools ? { tool_calls: tools } : { content: step.text ?? "fixture finished" };
			record({ type: "tls-response", id, tools: step.toolCalls ?? [] });
			response.end(`data: ${JSON.stringify({ model: modelId, choices: [{ index: 0, delta, finish_reason: tools ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
		} catch {
			record({ type: "tls-fixture-error", id });
			response.destroy();
		}
	});
	server.on("connection", socket => {
		sockets.add(socket);
		socket.once("close", () => { sockets.delete(socket); record({ type: "tls-server-socket-close" }); });
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	resource.endpoint = `https://localhost:${port}/v1/chat/completions`;
	const guard = guardNetwork({ after: callback => cleanup.push(callback) }, { loopbackPort: port });
	resource.close = async () => {
		await new Promise(resolve => server.close(resolve));
		// Server close callback can precede accepted socket close notifications.
		for (let i = 0; sockets.size && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
		assert.equal(sockets.size, 0);
		assert.equal(guard.sockets.size, 0);
		for (const callback of cleanup) callback();
		record({ type: "tls-settled", requests: sequence, serverSockets: sockets.size, clientSockets: guard.sockets.size });
		delete globalThis[resourceKey];
	};
	return resource;
}
