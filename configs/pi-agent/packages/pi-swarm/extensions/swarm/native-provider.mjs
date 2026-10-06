import { isDeepStrictEqual } from "node:util";
import { requireCondition as check } from "./errors.mjs";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createProviderCapability, PROVIDER_DATA_SCOPE } from "./provider-capability.mjs";

/** Host-only model selection. Reuses the host's Pi runtime as is; never constructs or refreshes one.
 * Static public imports let Pi's normal loader supply its own SDK identity; dynamic bare
 * imports from native ESM bypass that mapping.
 */
export async function createNativeRuntime({ modelRuntime, modelRegistry, mainModel, thinkingLevel = "off", override } = {}) {
	check((modelRuntime instanceof ModelRuntime && modelRegistry === undefined) ||
		(modelRegistry instanceof ModelRegistry && modelRuntime === undefined), "PROVIDER", "Supply one public Pi ModelRuntime or ModelRegistry");
	// Extensions only receive the registry; Pi 1.0 sessions need the ModelRuntime behind it.
	const runtime = modelRuntime ?? modelRegistry.runtime;
	check(runtime instanceof ModelRuntime, "PROVIDER", "The model registry does not expose a Pi ModelRuntime");
	const selected = override?.model ?? mainModel;
	const model = runtime.getModel(selected?.provider, selected?.id);
	check(model && model.api !== "pi-virtual" && (!model.type || model.type === "chat"), "PROVIDER", "An explicit physical chat model is required; automatic routing is disabled");
	check(isDeepStrictEqual(model, selected), "PROVIDER", "Selected model differs from the host catalog");
	const level = override?.thinkingLevel ?? thinkingLevel;
	check(getSupportedThinkingLevels(model).includes(level), "MODEL", "Unsupported thinking selection");
	const providerCapability = createProviderCapability({
		version: 1, provider: model.provider, modelId: model.id,
		api: model.api, endpoint: informationalEndpoint(model.baseUrl), transport: "pi-native", outboundData: [...PROVIDER_DATA_SCOPE]
	});
	return Object.freeze({ modelRuntime: runtime, mainModel: structuredClone(model), thinkingLevel: level, providerCapability });
}

// Informational catalog URL only. Omit credential-bearing/opaque routing metadata.
function informationalEndpoint(value) {
	try {
		const url = new URL(value);
		if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash) return url.href;
	} catch { }
	return null;
}
