import {
	dispatchHttpsRequest, isHttpsTransport, settleHttpsRequest,
} from "./https-transport.mjs";
import { requireCondition as check } from "./errors.mjs";
import { providerDescriptor } from "./provider-capability.mjs";

const runtimes = new WeakMap();
const FAILURE = "Constrained provider request failed";
const CANCELLED = "Constrained provider request cancelled";
const LIMIT = 4 * 1024 * 1024;

function requireValid(condition) {
	check(condition, "PROVIDER", FAILURE);
}

function text(content) {
	if (typeof content === "string") return content;
	requireValid(Array.isArray(content) && content.every(block => block.type === "text" && typeof block.text === "string"));
	return content.map(block => block.text).join("\n");
}

/** Deliberately text-only Chat Completions, without provider-specific payload knobs. */
function requestBody(descriptor, context, options) {
	const messages = [];
	if (context.systemPrompt) messages.push({ role: "system", content: text(context.systemPrompt) });
	for (const message of context.messages) {
		if (message.role === "user") messages.push({ role: "user", content: text(message.content) });
		else if (message.role === "toolResult") {
			messages.push({ role: "tool", tool_call_id: message.toolCallId, content: text(message.content) });
		} else if (message.role === "assistant") {
			requireValid(Array.isArray(message.content) && message.content.every(block => ["text", "toolCall"].includes(block.type)));
			const calls = message.content.filter(block => block.type === "toolCall");
			messages.push({ role: "assistant", content: text(message.content.filter(block => block.type === "text")),
				...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) });
		} else requireValid(false);
	}
	const body = { model: descriptor.modelId, messages, stream: true, max_tokens: options.maxTokens ?? 4096 };
	requireValid(Number.isSafeInteger(body.max_tokens) && body.max_tokens > 0 && body.max_tokens <= 8192);
	if (context.tools?.length) body.tools = context.tools.map(tool => ({ type: "function", function: {
		name: tool.name, description: tool.description, parameters: tool.parameters,
	} }));
	const serialized = JSON.stringify(body);
	requireValid(Buffer.byteLength(serialized) <= LIMIT);
	return serialized;
}

async function consume(response, signal, tools, modelId) {
	requireValid(response?.status === 200 && response.contentType?.split(";")[0].trim() === "text/event-stream");
	requireValid(response.body?.[Symbol.asyncIterator]);
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let pending = "";
	let bytes = 0;
	let done = false;
	let finish;
	let result = "";
	const calls = new Map();
	function event(frame) {
		const lines = frame.split("\n").filter(line => line && !line.startsWith(":"));
		if (!lines.length) return;
		requireValid(lines.every(line => line.startsWith("data:")) && !done);
		const data = lines.map(line => line.slice(5).trimStart()).join("\n");
		if (data === "[DONE]") { done = true; return; }
		const chunk = JSON.parse(data);
		requireValid(!chunk.error && Array.isArray(chunk.choices) && chunk.choices.length === 1 &&
			(chunk.model === undefined || chunk.model === modelId));
		const choice = chunk.choices[0];
		requireValid(choice.index === 0 && !finish);
		const delta = choice.delta;
		requireValid(delta && Object.keys(delta).every(key => ["role", "content", "tool_calls"].includes(key)));
		if (delta.role !== undefined) requireValid(delta.role === "assistant");
		if (delta.content != null) { requireValid(typeof delta.content === "string"); result += delta.content; }
		if (delta.tool_calls !== undefined) {
			requireValid(Array.isArray(delta.tool_calls));
			for (const part of delta.tool_calls) {
				requireValid(Number.isSafeInteger(part.index) && part.index >= 0 && part.index < 64);
				let call = calls.get(part.index);
				if (!call) { call = { id: "", name: "", arguments: "" }; calls.set(part.index, call); }
				if (part.type !== undefined) requireValid(part.type === "function");
				if (part.id !== undefined) { requireValid(typeof part.id === "string" && !call.id); call.id = part.id; }
				if (part.function?.name !== undefined) { requireValid(typeof part.function.name === "string" && !call.name); call.name = part.function.name; }
				if (part.function?.arguments !== undefined) { requireValid(typeof part.function.arguments === "string"); call.arguments += part.function.arguments; }
			}
		}
		if (choice.finish_reason != null) { requireValid(["stop", "length", "tool_calls"].includes(choice.finish_reason)); finish = choice.finish_reason; }
	}
	for await (const chunk of response.body) {
		signal.throwIfAborted();
		requireValid(typeof chunk === "string" || chunk instanceof Uint8Array);
		bytes += Buffer.byteLength(chunk); requireValid(bytes <= LIMIT);
		pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
		pending = pending.replace(/\r\n/g, "\n");
		let end;
		while ((end = pending.indexOf("\n\n")) !== -1) { event(pending.slice(0, end)); pending = pending.slice(end + 2); }
	}
	signal.throwIfAborted();
	pending += decoder.decode();
	requireValid(done && finish && !pending.trim() && ((finish === "tool_calls") === Boolean(calls.size)));
	const content = result ? [{ type: "text", text: result }] : [];
	const ids = new Set();
	for (let index = 0; index < calls.size; index++) {
		const call = calls.get(index);
		requireValid(call && /^[a-zA-Z0-9_-]{1,200}$/.test(call.id) && !ids.has(call.id) && tools?.some(tool => tool.name === call.name));
		ids.add(call.id);
		const args = JSON.parse(call.arguments);
		requireValid(args && Object.getPrototypeOf(args) === Object.prototype);
		content.push({ type: "toolCall", id: call.id, name: call.name, arguments: args });
	}
	return { content, stopReason: finish === "tool_calls" ? "toolUse" : finish };
}

function publish(result, output, stream) {
	// No partial text or tool calls escape an invalid or revoked response.
	for (const block of result.content) {
		const contentIndex = output.content.length;
		if (block.type === "text") {
			output.content.push({ type: "text", text: "" });
			stream.push({ type: "text_start", contentIndex, partial: output });
			output.content[contentIndex].text = block.text;
			stream.push({ type: "text_delta", contentIndex, delta: block.text, partial: output });
			stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
		} else {
			output.content.push({ ...block, arguments: {} });
			stream.push({ type: "toolcall_start", contentIndex, partial: output });
			output.content[contentIndex].arguments = block.arguments;
			stream.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(block.arguments), partial: output });
			stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
		}
	}
	output.stopReason = result.stopReason;
	stream.push({ type: "done", reason: output.stopReason, message: output });
}

/** Host-only runtime: trusted offline callback or separately authorized branded HTTPS client. */
export async function createConstrainedRuntime({ capability, credential, transport, timeoutMs = 30000 }) {
	const descriptor = providerDescriptor(capability);
	requireValid(descriptor.transport === "https-chat-completions" && descriptor.api === "openai-completions");
	requireValid(typeof credential === "string" && /^[\x21-\x7e]{1,4096}$/.test(credential));
	requireValid((typeof transport === "function" || isHttpsTransport(transport, capability)) && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 600000);
	const model = Object.freeze({ id: descriptor.modelId, provider: descriptor.provider, api: descriptor.api,
		baseUrl: descriptor.endpoint, name: "Constrained text model", reasoning: false, input: Object.freeze(["text"]),
		contextWindow: 32768, maxTokens: 8192, cost: Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }) });
	// Keep the pure reducer/descriptor dependency graph SDK-free.
	const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");
	const binding = { capability, descriptor, credential, transport, timeoutMs, model, createAssistantMessageEventStream };
	return facade(binding);
}

function facade(binding, admission) {
	const { model, descriptor } = binding;
	const streamSimple = (selected, context, options = {}) => {
		const stream = binding.createAssistantMessageEventStream();
		const output = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "pending", timestamp: Date.now() };
		void (async () => {
			let signal;
			let timer;
			let request;
			let result;
			let failed = false;
			const deadline = new AbortController();
			try {
				requireValid(admission && selected === model);
				for (const key of ["apiKey", "headers", "env", "samplingParams", "temperature", "fetch", "metadata", "deferred", "thinkingBudgets", "toolChoice"]) {
					requireValid(options[key] === undefined);
				}
				requireValid((!options.reasoning || options.reasoning === "off") && !options.maxRetries &&
					(!options.transport || ["auto", "sse"].includes(options.transport)));
				await admission.assert();
				signal = AbortSignal.any([admission.signal(), deadline.signal, ...(options.signal ? [options.signal] : [])]);
				timer = setTimeout(() => deadline.abort(), binding.timeoutMs);
				signal.throwIfAborted();
				request = Object.freeze({ url: descriptor.endpoint, method: "POST", headers: Object.freeze({
					"content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${binding.credential}`,
				}), body: requestBody(descriptor, context, options), signal, redirect: "error", retries: 0 });
				stream.push({ type: "start", partial: output });
				// No await between the final admission and transport dispatch. SDK header/payload
				// callbacks are intentionally never invoked; only this module assembles requests.
				admission.check(); signal.throwIfAborted();
				const response = await (isHttpsTransport(binding.transport, binding.capability)
					? dispatchHttpsRequest(binding.transport, request, admission) : binding.transport(request));
				signal.throwIfAborted();
				result = await consume(response, signal, context.tools, model.id);
			} catch {
				failed = true;
				output.content = [];
				output.stopReason = signal?.aborted ? "aborted" : "error";
				output.errorMessage = signal?.aborted ? CANCELLED : FAILURE;
			} finally {
				// Even rejection before body iteration must retire the actual socket. A response
				// object's arbitrary callbacks cannot participate in this private branded contract.
				if (failed) deadline.abort();
				await settleHttpsRequest(binding.transport, request);
				if (!failed) {
					try { admission.check(); signal.throwIfAborted(); }
					catch {
						failed = true;
						output.stopReason = signal?.aborted ? "aborted" : "error";
						output.errorMessage = signal?.aborted ? CANCELLED : FAILURE;
					}
				}
				clearTimeout(timer);
				deadline.abort();
				// Terminal SDK events resolve result(); emit only after settlement and final admission.
				if (failed) stream.push({ type: "error", reason: output.stopReason, error: output });
				else publish(result, output, stream);
				stream.end();
			}
		})();
		return stream;
	};
	const provider = Object.freeze({ id: model.provider, stream: streamSimple, streamSimple });
	const runtime = Object.freeze({ getModel: (provider, id) => provider === model.provider && id === model.id ? model : undefined,
		getProvider: id => id === model.provider ? provider : undefined, getProviders: () => [provider],
		getModels: () => [model], getAvailable: async () => [model], getAvailableSnapshot: () => [model],
		hasConfiguredAuth: id => id === model.provider, checkAuth: async id => id === model.provider ? { type: "api_key" } : undefined,
		getAuth: async () => undefined, isUsingOAuth: () => false, isUsingSubscription: () => false,
		stream: streamSimple, streamSimple, complete: (m, c, o) => streamSimple(m, c, o).result(), completeSimple: (m, c, o) => streamSimple(m, c, o).result(),
	});
	runtimes.set(runtime, binding);
	return runtime;
}

export function isConstrainedRuntime(runtime, capability) {
	return Boolean(runtimes.has(runtime) && runtimes.get(runtime).capability === capability);
}

export function bindConstrainedRuntime(runtime, capability, admission) {
	requireValid(isConstrainedRuntime(runtime, capability) && admission &&
		["assert", "check", "signal"].every(name => typeof admission[name] === "function"));
	return facade(runtimes.get(runtime), admission);
}
