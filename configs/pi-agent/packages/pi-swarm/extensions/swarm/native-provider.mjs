import { isDeepStrictEqual } from "node:util";
import { requireCondition as check } from "./errors.mjs";
import { createProviderCapability, PROVIDER_DATA_SCOPE } from "./provider-capability.mjs";

const runtimes = new WeakMap();

/** Host-only injection. Reuses a public Pi runtime/registry; never constructs or refreshes one. */
export async function createNativeRuntime({ modelRuntime, modelRegistry, mainModel, thinkingLevel = "off", override } = {}) {
	const { ModelRegistry, ModelRuntime } = await import("@earendil-works/pi-coding-agent");
	check((modelRuntime instanceof ModelRuntime && modelRegistry === undefined) ||
		(modelRegistry instanceof ModelRegistry && modelRuntime === undefined), "PROVIDER", "Supply one public Pi ModelRuntime or ModelRegistry");
	const source = modelRuntime ?? modelRegistry;
	const lookup = modelRuntime ? "getModel" : "find";
	const selected = override?.model ?? mainModel;
	const model = source[lookup](selected?.provider, selected?.id);
	check(model && model.api !== "pi-virtual" && (!model.type || model.type === "chat"), "PROVIDER", "An explicit physical chat model is required; automatic routing is disabled");
	check(isDeepStrictEqual(model, selected), "PROVIDER", "Selected model differs from the host catalog");
	const level = override?.thinkingLevel ?? thinkingLevel;
	const { createAssistantMessageEventStream, getSupportedThinkingLevels } = await import("@earendil-works/pi-ai");
	const thinkingLevels = getSupportedThinkingLevels(model);
	check(thinkingLevels.includes(level), "MODEL", "Unsupported thinking selection");
	const snapshot = structuredClone(model);
	const capability = createProviderCapability({ version: 1, provider: model.provider, modelId: model.id,
		api: model.api, endpoint: informationalEndpoint(model.baseUrl), transport: "pi-native", outboundData: [...PROVIDER_DATA_SCOPE] });
	const methods = [lookup, "getProvider", "stream", "streamSimple", ...(modelRuntime ? ["getAuth"] : [])];
	const binding = { source, lookup, model: snapshot, capability, thinkingLevels, createAssistantMessageEventStream,
		methods, references: methods.map(name => source[name]), provider: source.getProvider(model.provider) };
	check(binding.provider, "PROVIDER", "Selected provider unavailable");
	binding.providerMethods = [binding.provider.stream, binding.provider.streamSimple];
	const runtime = facade(binding);
	return Object.freeze({ modelRuntime: runtime, mainModel: structuredClone(snapshot), thinkingLevel: level, providerCapability: capability });
}

export function isNativeRuntime(runtime, capability) {
	return Boolean(runtimes.has(runtime) && runtimes.get(runtime).capability === capability);
}

export function assertNativeRuntime(runtime, capability, selection) {
	check(isNativeRuntime(runtime, capability), "PROVIDER", "Matching host-created native runtime required");
	const binding = runtimes.get(runtime);
	check(!selection || binding.thinkingLevels.includes(selection.thinkingLevel), "MODEL", "Unsupported thinking selection");
	const { source, model, provider } = binding;
	check(binding.methods.every((name, index) => source[name] === binding.references[index]) &&
		source.getProvider(model.provider) === provider && provider.stream === binding.providerMethods[0] &&
		provider.streamSimple === binding.providerMethods[1] &&
		isDeepStrictEqual(source[binding.lookup](model.provider, model.id), model),
	"PROVIDER", "Host provider or model metadata changed; create a new binding and obtain fresh approval");
	return structuredClone(model);
}

export function bindNativeRuntime(runtime, capability, admission) {
	assertNativeRuntime(runtime, capability);
	check(admission && ["assert", "check", "signal"].every(name => typeof admission[name] === "function"),
		"PROVIDER", "Per-request admission required");
	return facade(runtimes.get(runtime), admission);
}

function facade(binding, admission) {
	const { model, source } = binding;
	const stream = (method, selected, context, options = {}) => {
		const output = binding.createAssistantMessageEventStream();
		void dispatch(method, selected, context, options, output);
		return output;
	};
	const runtime = Object.freeze({
		getModel: (provider, id) => provider === model.provider && id === model.id ? structuredClone(model) : undefined,
		getProvider: id => id === model.provider ? binding.provider : undefined,
		getModels: () => [structuredClone(model)], getAvailableSnapshot: () => [structuredClone(model)],
		// Selection is explicit, not an availability certification. Resolve auth exactly once,
		// inside the native stream; never extract credentials into the Swarm/compaction facade.
		hasConfiguredAuth: id => id === model.provider, getAuth: async () => undefined,
		isUsingOAuth: id => id === model.provider && source.isUsingOAuth(binding.lookup === "find" ? model : id),
		stream: (m, c, o) => stream("stream", m, c, o),
		streamSimple: (m, c, o) => stream("streamSimple", m, c, o),
		complete: (m, c, o) => stream("stream", m, c, o).result(),
		completeSimple: (m, c, o) => stream("streamSimple", m, c, o).result(),
	});
	runtimes.set(runtime, binding);
	return runtime;

	async function dispatch(method, selected, context, options, output) {
		let result;
		let failure;
		let signal;
		const cancel = new AbortController();
		try {
			check(admission && isDeepStrictEqual(selected, model), "PROVIDER", "Unbound or substituted native model request");
			check(!options.deferred, "PROVIDER", "Deferred work is not supported by Swarm settlement");
			await admission.assert();
			signal = AbortSignal.any([admission.signal(), cancel.signal, ...(options.signal ? [options.signal] : [])]);
			assertNativeRuntime(runtime, binding.capability);
			admission.check(); signal.throwIfAborted();
			// Native Pi owns auth, request options, conversion, networking, and provider errors.
			// transformHeaders runs after native auth; recheck admission before provider dispatch.
			const native = source[method](selected, context, { ...options, signal, transformHeaders: async headers => {
				const transformed = options.transformHeaders ? await options.transformHeaders(headers) : headers;
				assertNativeRuntime(runtime, binding.capability);
				admission.check(); signal.throwIfAborted();
				return transformed;
			} });
			for await (const event of native) {
				try { admission.check(); signal.throwIfAborted(); }
				catch (error) { failure ??= error; cancel.abort(); }
				// Drain rather than racing abort against SDK completion. A provider ignoring
				// cancellation keeps this request and its worker turn unsettled.
				if (!failure && event.type !== "done" && event.type !== "error") output.push(event);
			}
			result = await native.result();
			assertNativeRuntime(runtime, binding.capability);
			admission.check(); signal.throwIfAborted();
		} catch (error) { failure ??= error; }
		if (failure) result = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
			usage: result?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: signal?.aborted ? "aborted" : "error", errorMessage: "Native provider request not admitted or failed", timestamp: Date.now() };
		if (["error", "aborted"].includes(result.stopReason)) output.push({ type: "error", reason: result.stopReason, error: result });
		else output.push({ type: "done", reason: result.stopReason, message: result });
		output.end();
	}
}

// Informational catalog URL only. Omit credential-bearing/opaque routing metadata.
function informationalEndpoint(value) {
	try {
		const url = new URL(value);
		if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash) return url.href;
	} catch {}
	return null;
}
