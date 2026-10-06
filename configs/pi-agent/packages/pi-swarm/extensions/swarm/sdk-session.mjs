import {
	SessionManager, SettingsManager, createAgentSession, createExtensionRuntime,
} from "@earendil-works/pi-coding-agent";
import { dirname, isAbsolute, resolve } from "node:path";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { invariant, privateDirectory } from "./store/files.mjs";
import { assertProviderSelection, providerDescriptor } from "./provider-capability.mjs";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function canonicalPath(path) {
	invariant(typeof path === "string" && isAbsolute(path) && resolve(path) === path,
		"Session paths must be absolute and canonical");
	invariant(realpathSync(path) === path, "Session paths must not contain aliases or symlinks");
	return path;
}

/** Read the active branch of native history without constructing a session or exposing a manager. */
export function readSessionHistory(path, cwd, sessionId) {
	const sessionDir = dirname(path);
	const found = findSessionFile(sessionDir, cwd, sessionId, path);
	if (found === undefined) return [];
	const manager = SessionManager.open(found, sessionDir);
	invariant(manager.getSessionId() === sessionId && manager.getCwd() === cwd, "Session history identity changed");
	return manager.getBranch();
}

// This is deliberately not DefaultResourceLoader: even a reload cannot discover local resources.
function isolatedLoader(systemPrompt) {
	const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
	return {
		getExtensions: () => extensions,
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => systemPrompt,
		getSystemPromptSource: () => undefined,
		getAppendSystemPrompt: () => [],
		getAppendSystemPromptSources: () => [],
		extendResources: () => { throw new Error("Swarm resource discovery is disabled"); },
		reload: async () => {},
	};
}

function openManager(cwd, sessionDir, sessionId, sessionFile) {
	if (sessionFile === undefined) return SessionManager.create(cwd, sessionDir);
	invariant(dirname(sessionFile) === sessionDir, "Session file must be inside its private directory");
	const found = findSessionFile(sessionDir, cwd, sessionId, sessionFile);
	if (found === undefined) return SessionManager.create(cwd, sessionDir, { id: sessionId });
	const manager = SessionManager.open(found, sessionDir);
	invariant(manager.getSessionId() === sessionId && manager.getCwd() === cwd, "SDK changed session identity");
	return manager;
}

// Pi writes a session file only once it holds a prompt. A worker bound before its first prompt has
// no file yet, and if it was reopened first, that prompt lands in a new file with the same session ID.
function findSessionFile(sessionDir, cwd, sessionId, sessionFile) {
	const found = existsSync(sessionFile) ? sessionFile : SessionManager.findById(cwd, sessionId, sessionDir);
	return found === undefined ? undefined : canonicalPath(found);
}

/** Non-discovering SDK factory for offline mocks or the host's own Pi model runtime.
 * `admitRequest` runs before every model request the session makes. */
export async function createSdkSession({ cwd, sessionDir, sessionId, sessionFile, modelRuntime, selection, systemPrompt, customTools, providerCapability, admitRequest }) {
	// Gate before directories, sessions, authentication lookup, or fallback selection.
	const native = providerCapability !== undefined && providerDescriptor(providerCapability).transport === "pi-native";
	if (providerCapability) assertProviderSelection(providerCapability, selection, modelRuntime);
	invariant(native || selection?.provider === "swarm-mock", "This phase only supports the swarm-mock provider");
	invariant(typeof selection.modelId === "string" && THINKING_LEVELS.has(selection.thinkingLevel), "Explicit model and thinking selection required");
	invariant(modelRuntime && typeof modelRuntime.getModel === "function", "Model runtime required");
	const model = modelRuntime.getModel(selection.provider, selection.modelId);
	invariant(native || (model?.provider === "swarm-mock" && model.api === "swarm-mock" && model.id === selection.modelId),
		"Selected swarm-mock model/API unavailable; fallback is disabled");
	invariant(admitRequest === undefined || typeof admitRequest === "function", "Invalid request admission");
	invariant(typeof systemPrompt === "string" && systemPrompt.trim().length > 0, "Explicit system prompt required");
	invariant(Array.isArray(customTools), "Explicit custom tools required");
	const names = customTools.map((tool) => {
		invariant(tool && typeof tool.name === "string" && tool.name.length > 0 && typeof tool.execute === "function",
			"Invalid custom tool");
		return tool.name;
	});
	invariant(new Set(names).size === names.length, "Duplicate custom tool name");
	canonicalPath(cwd);
	invariant(lstatSync(cwd).isDirectory(), "Workspace must be a directory");
	invariant(typeof sessionDir === "string" && isAbsolute(sessionDir) && resolve(sessionDir) === sessionDir,
		"Session directory must be absolute and canonical");
	canonicalPath(dirname(sessionDir));
	privateDirectory(sessionDir);
	canonicalPath(sessionDir);
	const manager = openManager(cwd, sessionDir, sessionId, sessionFile);
	const settingsManager = SettingsManager.inMemory({ cacheWarming: "off" });
	const { session, modelFallbackMessage } = await createAgentSession({
		cwd, agentDir: sessionDir, modelRuntime, model, thinkingLevel: selection.thinkingLevel,
		scopedModels: [{ model, thinkingLevel: selection.thinkingLevel }],
		sessionManager: manager, settingsManager, resourceLoader: isolatedLoader(systemPrompt),
		tools: names, customTools,
	});
	if (admitRequest) {
		// Every model request (prompt, tool follow-up, retry, compaction summary) goes through
		// the agent's stream function, and Pi's loop does not check for abort before calling it.
		const stream = session.agent.streamFunction;
		session.agent.streamFunction = async (...request) => {
			await admitRequest();
			return stream(...request);
		};
	}
	try {
		invariant(!modelFallbackMessage && session.model?.id === model.id && session.model?.api === model.api &&
			session.model?.provider === model.provider && session.thinkingLevel === selection.thinkingLevel,
		"SDK changed the approved model/thinking selection");
		const tools = session.getAllTools();
		invariant(tools.length === names.length && tools.every((tool) => names.includes(tool.name) && tool.sourceInfo?.source === "sdk"),
			"SDK exposed a tool outside the custom tool boundary");
		invariant(session.getActiveToolNames().length === names.length &&
			session.getActiveToolNames().every((name) => names.includes(name)), "SDK changed the custom tool allowlist");
		return { session, manager, sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile() };
	} catch (error) {
		session.dispose();
		throw error;
	}
}
