import {
	SessionManager, SettingsManager, createAgentSession, createExtensionRuntime,
} from "@earendil-works/pi-coding-agent";
import {
	checkedFile, invariant, privateDirectory, readPrivate, syncDirectory, writeAll,
} from "./store/files.mjs";
import { dirname, isAbsolute, resolve } from "node:path";
import { assertProviderSelection } from "./provider-capability.mjs";
import { bindNativeRuntime, isNativeRuntime } from "./native-provider.mjs";
import { closeSync, constants, fsyncSync, lstatSync, openSync, realpathSync } from "node:fs";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const ENTRY_TYPES = new Set([
	"message", "model_change", "thinking_level_change", "compaction", "branch_summary",
	"custom", "custom_message", "context_edit", "label", "session_info",
]);

function canonicalPath(path) {
	invariant(typeof path === "string" && isAbsolute(path) && resolve(path) === path,
		"Session paths must be absolute and canonical");
	invariant(realpathSync(path) === path, "Session paths must not contain aliases or symlinks");
	return path;
}

function validateMessage(message) {
	invariant(message && typeof message === "object" && Number.isFinite(message.timestamp), "Invalid session message");
	const { role, content } = message;
	invariant(["system", "user", "assistant", "toolResult", "bashExecution", "custom", "branchSummary", "compactionSummary"].includes(role),
		"Invalid session message role");
	if (role === "branchSummary" || role === "compactionSummary") {
		invariant(typeof message.summary === "string", "Invalid session summary message");
		return;
	}
	if (role === "bashExecution") {
		invariant(typeof message.command === "string" && typeof message.output === "string", "Invalid shell message");
		return;
	}
	invariant(typeof content === "string" || Array.isArray(content), "Invalid session message content");
	if (Array.isArray(content)) {
		for (const block of content) {
			invariant(block && ["text", "image", "thinking", "toolCall"].includes(block.type), "Invalid session content block");
			if (block.type === "text") invariant(typeof block.text === "string", "Invalid text block");
			if (block.type === "thinking") invariant(typeof block.thinking === "string", "Invalid thinking block");
			if (block.type === "toolCall") {
				invariant(typeof block.id === "string" && typeof block.name === "string" && block.arguments &&
					typeof block.arguments === "object" && !Array.isArray(block.arguments), "Invalid tool call block");
			}
		}
	}
	if (role === "system") {
		invariant(typeof content === "string" || content.every(block => block.type === "text"), "Invalid system content");
		// Installed Pi 1.0 declarations/replay do not implement replace:true,
		// despite its mention in the prose docs. Never reopen it as an ignored reset.
		invariant(message.replace === undefined || message.replace === false, "Unsupported system replacement");
		if (message.sections !== undefined) {
			invariant(message.sections && typeof message.sections === "object" && !Array.isArray(message.sections) &&
				Object.values(message.sections).every(value => value === null || typeof value === "string"), "Invalid system sections");
		}
		if (message.toolsAdded !== undefined) {
			invariant(Array.isArray(message.toolsAdded) && message.toolsAdded.every(tool => tool &&
				typeof tool.name === "string" && typeof tool.description === "string" && tool.parameters &&
				typeof tool.parameters === "object" && !Array.isArray(tool.parameters)), "Invalid system tools");
		}
		if (message.toolsRemoved !== undefined) {
			invariant(Array.isArray(message.toolsRemoved) && message.toolsRemoved.every(tool => tool &&
				typeof tool.name === "string"), "Invalid removed system tools");
		}
	}
	if (role === "assistant") {
		invariant(Array.isArray(content) && typeof message.api === "string" && typeof message.provider === "string" &&
			typeof message.model === "string" && ["stop", "length", "toolUse", "error", "aborted"].includes(message.stopReason) &&
			message.usage && Number.isFinite(message.usage.totalTokens), "Invalid or incomplete assistant message");
	}
	if (role === "toolResult") {
		invariant(Array.isArray(content) && typeof message.toolCallId === "string" && typeof message.toolName === "string" &&
			typeof message.isError === "boolean", "Invalid tool result message");
	}
}

function validateSession(path, cwd) {
	canonicalPath(path);
	const text = readPrivate(path);
	invariant(text.length > 0 && text.endsWith("\n"), "Incomplete session JSONL");
	const records = text.slice(0, -1).split("\n").map((line) => {
		invariant(line.trim().length > 0, "Blank session JSONL record");
		const entry = JSON.parse(line);
		invariant(entry && typeof entry === "object" && !Array.isArray(entry), "Invalid session record");
		return entry;
	});
	const [header, ...entries] = records;
	invariant(header.type === "session" && header.version === 3 &&
		typeof header.id === "string" && header.id.length > 0 && header.cwd === cwd &&
		typeof header.timestamp === "string" && Number.isFinite(Date.parse(header.timestamp)),
	"Invalid session header or workspace identity");
	const ids = new Set();
	const priorEntries = new Map();
	for (const entry of entries) {
		invariant(ENTRY_TYPES.has(entry.type) && typeof entry.id === "string" && entry.id.length > 0 &&
			!ids.has(entry.id) && (entry.parentId === null || ids.has(entry.parentId)) &&
			typeof entry.timestamp === "string" && Number.isFinite(Date.parse(entry.timestamp)),
		"Invalid session entry or parent chain");
		if (entry.type === "message") validateMessage(entry.message);
		if (entry.type === "compaction") {
			invariant(typeof entry.summary === "string" && Number.isFinite(entry.tokensBefore) &&
				(Array.isArray(entry.retainedTail) || ids.has(entry.firstKeptEntryId) || entry.firstKeptEntryId === entry.id), "Invalid session compaction");
			if (entry.systemMessage !== undefined) {
				invariant(entry.systemMessage?.role === "system", "Invalid compaction system checkpoint");
				validateMessage(entry.systemMessage);
			}
			if (entry.retainedTail !== undefined) {
				invariant(Array.isArray(entry.retainedTail), "Invalid compaction tail");
				entry.retainedTail.forEach(validateMessage);
			}
		}
		if (entry.type === "branch_summary") {
			invariant(typeof entry.summary === "string" && ids.has(entry.fromId), "Invalid branch summary");
		}
		if (entry.type === "custom" || entry.type === "custom_message") {
			invariant(typeof entry.customType === "string", "Invalid custom entry");
		}
		if (entry.type === "custom_message") {
			invariant((typeof entry.content === "string" || Array.isArray(entry.content)) && typeof entry.display === "boolean",
				"Invalid custom message entry");
		}
		if (entry.type === "context_edit") {
			const target = priorEntries.get(entry.targetId);
			const message = target?.type === "custom_message"
				? { role: "custom", content: target.content, timestamp: Date.parse(target.timestamp) }
				: target?.type === "message" ? target.message : undefined;
			invariant(message && ["user", "assistant", "toolResult", "custom"].includes(message.role), "Invalid context edit target");
			if (entry.replacement !== null) {
				invariant(entry.replacement && typeof entry.replacement === "object" && !Array.isArray(entry.replacement), "Invalid context edit replacement");
				let content = entry.replacement.content;
				if (typeof content === "string" && ["assistant", "toolResult"].includes(message.role)) content = [{ type: "text", text: content }];
				validateMessage({ ...message, content });
			}
		}
		if (entry.type === "label") invariant(ids.has(entry.targetId), "Invalid label target");
		if (entry.type === "session_info") invariant(typeof entry.name === "string", "Invalid session name");
		if (entry.type === "model_change") {
			invariant(typeof entry.provider === "string" && typeof entry.modelId === "string", "Invalid model entry");
		}
		if (entry.type === "thinking_level_change") {
			invariant(THINKING_LEVELS.has(entry.thinkingLevel), "Invalid thinking entry");
		}
		ids.add(entry.id);
		priorEntries.set(entry.id, entry);
	}
	return { header, entries };
}

/** Read validated native history without constructing a session or exposing a manager. */
export function readSessionHistory(path, cwd, sessionId) {
	const { header, entries } = validateSession(path, cwd);
	invariant(header.id === sessionId, "Session history identity changed");
	return entries;
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

function openManager(cwd, sessionDir, sessionFile) {
	if (sessionFile !== undefined) {
		invariant(dirname(sessionFile) === sessionDir, "Session file must be inside its private directory");
		const { header } = validateSession(sessionFile, cwd);
		const manager = SessionManager.open(sessionFile, sessionDir);
		invariant(manager.getSessionId() === header.id, "SDK changed session identity");
		return manager;
	}
	const created = SessionManager.create(cwd, sessionDir);
	const path = created.getSessionFile();
	// The SDK defers new-file writes until the first assistant response. Materialize only its
	// native header and reopen it so identity survives a crash before the first prompt.
	const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
	try {
		writeAll(fd, Buffer.from(JSON.stringify(created.getHeader()) + "\n"));
		fsyncSync(fd);
	} finally { closeSync(fd); }
	syncDirectory(sessionDir);
	return SessionManager.open(path, sessionDir);
}

/** Non-discovering SDK factory: offline mocks or the branded per-request-fenced native adapter. */
export async function createSdkSession({ cwd, sessionDir, sessionFile, modelRuntime, selection, systemPrompt, customTools, providerCapability, requestAdmission }) {
	// Gate before directories, sessions, authentication lookup, or fallback selection.
	const native = isNativeRuntime(modelRuntime, providerCapability);
	if (providerCapability) assertProviderSelection(providerCapability, selection, modelRuntime);
	invariant(native || selection?.provider === "swarm-mock", "This phase only supports the swarm-mock provider");
	invariant(typeof selection.modelId === "string" && THINKING_LEVELS.has(selection.thinkingLevel), "Explicit model and thinking selection required");
	invariant(modelRuntime && typeof modelRuntime.getModel === "function", "Model runtime required");
	const model = modelRuntime.getModel(selection.provider, selection.modelId);
	invariant(native || (model?.provider === "swarm-mock" && model.api === "swarm-mock" && model.id === selection.modelId),
		"Selected swarm-mock model/API unavailable; fallback is disabled");
	if (native) modelRuntime = bindNativeRuntime(modelRuntime, providerCapability, requestAdmission);
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
	const manager = openManager(cwd, sessionDir, sessionFile);
	const settingsManager = SettingsManager.inMemory({
		cacheWarming: "off",
		compaction: { enabled: false },
		retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0, maxRetryDelayMs: 0 } },
	});
	const { session, modelFallbackMessage } = await createAgentSession({
		cwd, agentDir: sessionDir, modelRuntime, model, thinkingLevel: selection.thinkingLevel,
		scopedModels: [{ model, thinkingLevel: selection.thinkingLevel }],
		sessionManager: manager, settingsManager, resourceLoader: isolatedLoader(systemPrompt),
		tools: names, customTools,
	});
	try {
		invariant(!modelFallbackMessage && session.model?.id === model.id && session.model?.api === model.api &&
			session.model?.provider === model.provider && session.thinkingLevel === selection.thinkingLevel,
		"SDK changed the approved model/thinking selection");
		const tools = session.getAllTools();
		invariant(tools.length === names.length && tools.every((tool) => names.includes(tool.name) && tool.sourceInfo?.source === "sdk"),
			"SDK exposed a tool outside the custom tool boundary");
		invariant(session.getActiveToolNames().length === names.length &&
			session.getActiveToolNames().every((name) => names.includes(name)), "SDK changed the custom tool allowlist");
		const id = manager.getSessionId();
		const path = manager.getSessionFile();
		const sync = () => {
			canonicalPath(sessionDir);
			privateDirectory(sessionDir);
			invariant(manager.getSessionId() === id && manager.getSessionFile() === path, "Session identity changed");
			invariant(validateSession(path, cwd).header.id === id, "Session file identity changed");
			const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
			try { checkedFile(fd); fsyncSync(fd); } finally { closeSync(fd); }
			syncDirectory(sessionDir);
		};
		sync();
		return { session, manager, sessionId: id, sessionFile: path, sync };
	} catch (error) {
		session.dispose();
		throw error;
	}
}
