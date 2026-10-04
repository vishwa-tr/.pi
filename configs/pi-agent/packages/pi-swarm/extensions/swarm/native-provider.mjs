import { isDeepStrictEqual } from "node:util";
import { createNativeFacade } from "./native-binding.mjs";
import { requireCondition as check } from "./errors.mjs";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createProviderCapability, PROVIDER_DATA_SCOPE } from "./provider-capability.mjs";
import { createAssistantMessageEventStream, getSupportedThinkingLevels } from "@earendil-works/pi-ai";

export { assertNativeRuntime, bindNativeRuntime, isNativeRuntime } from "./native-binding.mjs";

/** Host-only injection. Reuses a public Pi runtime/registry; never constructs or refreshes one.
 * Static public imports let Pi's normal loader supply its own SDK identity; dynamic bare
 * imports from native ESM bypass that mapping. Foundation bookkeeping remains SDK-free.
 */
export async function createNativeRuntime({ modelRuntime, modelRegistry, mainModel, thinkingLevel = "off", override } = {}) {
	check((modelRuntime instanceof ModelRuntime && modelRegistry === undefined) ||
		(modelRegistry instanceof ModelRegistry && modelRuntime === undefined), "PROVIDER", "Supply one public Pi ModelRuntime or ModelRegistry");
	const source = modelRuntime ?? modelRegistry;
	const lookup = modelRuntime ? "getModel" : "find";
	const selected = override?.model ?? mainModel;
	const model = source[lookup](selected?.provider, selected?.id);
	check(model && model.api !== "pi-virtual" && (!model.type || model.type === "chat"), "PROVIDER", "An explicit physical chat model is required; automatic routing is disabled");
	check(isDeepStrictEqual(model, selected), "PROVIDER", "Selected model differs from the host catalog");
	const level = override?.thinkingLevel ?? thinkingLevel;
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
	const runtime = createNativeFacade(binding);
	return Object.freeze({ modelRuntime: runtime, mainModel: structuredClone(snapshot), thinkingLevel: level, providerCapability: capability });
}

// Informational catalog URL only. Omit credential-bearing/opaque routing metadata.
function informationalEndpoint(value) {
	try {
		const url = new URL(value);
		if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash) return url.href;
	} catch {}
	return null;
}
