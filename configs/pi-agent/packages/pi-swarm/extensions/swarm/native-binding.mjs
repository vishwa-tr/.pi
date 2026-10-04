import { isDeepStrictEqual } from "node:util";
import { requireCondition as check } from "./errors.mjs";

// SDK-free capability bookkeeping: foundation validation never loads the SDK.
const runtimes = new WeakMap();

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
	return createNativeFacade(runtimes.get(runtime), admission);
}

/** Internal trusted constructor used only after the public SDK selection checks. */
export function createNativeFacade(binding, admission) {
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
		// Native streaming resolves auth once; never extract credentials for compaction.
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
			// Pi owns auth/transport. Recheck after native auth before provider dispatch.
			const native = source[method](selected, context, { ...options, signal, transformHeaders: async headers => {
				const transformed = options.transformHeaders ? await options.transformHeaders(headers) : headers;
				assertNativeRuntime(runtime, binding.capability);
				admission.check(); signal.throwIfAborted();
				return transformed;
			} });
			for await (const event of native) {
				try { admission.check(); signal.throwIfAborted(); }
				catch (error) { failure ??= error; cancel.abort(); }
				// Drain: an uncooperative provider retains its turn and ownership.
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
