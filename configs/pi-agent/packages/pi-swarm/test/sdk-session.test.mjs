import test from "node:test";
import assert from "node:assert/strict";
import {
	chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
	rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { createSdkSession } from "../extensions/swarm/sdk-session.mjs";
import { createMockRuntime } from "./sdk-env.mjs";

async function fixture(t, script = []) {
	const root = mkdtempSync(join(tmpdir(), "swarm-sdk-"));
	const cwd = join(root, "checkout");
	mkdirSync(cwd);
	const mock = await createMockRuntime(script);
	const options = {
		cwd, sessionDir: join(root, "sessions"), modelRuntime: mock.modelRuntime,
		selection: mock.selection, systemPrompt: "Only the explicit swarm prompt.", customTools: [],
	};
	const sessions = [];
	t.after(() => { for (const session of sessions) session.dispose(); rmSync(root, { recursive: true, force: true }); });
	return {
		root, ...mock, options,
		async open(overrides = {}) {
			const result = await createSdkSession({ ...options, ...overrides });
			sessions.push(result.session);
			return result;
		},
	};
}

async function until(predicate) {
	for (let i = 0; i < 300; i++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.fail("Timed out waiting for mock request");
}

test("native session identity persists before first prompt and after idle/reopen", async (t) => {
	const f = await fixture(t, [{ text: "First answer" }, { text: "Second answer" }]);
	const first = await f.open();
	assert.equal(statSync(first.sessionFile).mode & 0o777, 0o600);
	assert.equal(statSync(f.options.sessionDir).mode & 0o777, 0o700);
	const empty = await f.open({ sessionFile: first.sessionFile });
	assert.equal(empty.sessionId, first.sessionId);
	empty.session.dispose();
	const events = [];
	first.session.subscribe((event) => events.push(event.type));
	await first.session.prompt("First request");
	await first.session.agent.waitForIdle();
	first.sync();
	assert.equal(first.session.isStreaming, false);
	assert.ok(events.includes("agent_end"));
	assert.equal(f.calls.length, 1);
	first.session.dispose();
	const reopened = await f.open({ sessionFile: first.sessionFile });
	assert.equal(reopened.sessionId, first.sessionId);
	assert.equal(reopened.sessionFile, first.sessionFile);
	assert.ok(reopened.session.messages.some((message) => message.content?.[0]?.text === "First request"));
	await reopened.session.prompt("Second request");
	reopened.sync();
	assert.ok(f.calls[1].context.messages.some((message) => message.content?.[0]?.text === "First answer"));
	assert.equal(readdirSync(f.options.sessionDir).length, 1);
});

test("explicit custom tools replace builtin names and unknown builtin calls never execute", async (t) => {
	const f = await fixture(t, [
		{ toolCalls: [{ name: "read", arguments: { path: "fake" } }, { name: "bash", arguments: { command: "exit 0" } }] },
		{ text: "Finished" },
	]);
	let reads = 0;
	const read = {
		name: "read", label: "Guarded read", description: "Only the supplied read", parameters: Type.Object({ path: Type.String() }),
		async execute() { reads++; return { content: [{ type: "text", text: "guarded" }], details: {} }; },
	};
	const { session, sync } = await f.open({ customTools: [read] });
	assert.deepEqual(session.getActiveToolNames(), ["read"]);
	assert.deepEqual(session.getAllTools().map((tool) => [tool.name, tool.sourceInfo.source]), [["read", "sdk"]]);
	await session.prompt("Call the tools");
	sync();
	assert.equal(reads, 1);
	assert.deepEqual(f.calls[0].context.tools.map((tool) => tool.name), ["read"]);
	assert.ok(session.messages.some((message) => message.role === "toolResult" && message.toolName === "bash" && message.isError));
	const isolated = await f.open();
	assert.deepEqual(isolated.session.getAllTools(), []);
	assert.deepEqual(isolated.session.getActiveToolNames(), []);
});

test("resource loader ignores project context, extensions, prompts, skills, and settings", async (t) => {
	const f = await fixture(t, [{ text: "No discovery" }]);
	const cwd = f.options.cwd;
	mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
	mkdirSync(join(cwd, ".pi", "prompts"), { recursive: true });
	mkdirSync(join(cwd, ".agents", "skills", "sentinel"), { recursive: true });
	writeFileSync(join(cwd, "AGENTS.md"), "CONTEXT_DISCOVERY_SENTINEL");
	writeFileSync(join(cwd, "SYSTEM.md"), "SYSTEM_DISCOVERY_SENTINEL");
	writeFileSync(join(cwd, ".pi", "extensions", "sentinel.mjs"), 'throw new Error("EXTENSION_DISCOVERY_SENTINEL")');
	writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ compaction: { enabled: true }, defaultTools: ["bash"] }));
	writeFileSync(join(cwd, ".pi", "prompts", "sentinel.md"), "PROMPT_DISCOVERY_SENTINEL");
	writeFileSync(join(cwd, ".agents", "skills", "sentinel", "SKILL.md"), "---\nname: sentinel\ndescription: SKILL_DISCOVERY_SENTINEL\n---\nSentinel");
	const { session } = await f.open();
	await session.prompt("/sentinel");
	assert.match(f.calls[0].context.systemPrompt, /Only the explicit swarm prompt/);
	assert.doesNotMatch(JSON.stringify(f.calls[0].context), /DISCOVERY_SENTINEL/);
	assert.deepEqual(session.getAllTools(), []);
	assert.equal(session.settingsManager.getCompactionEnabled(), false);
	assert.equal(session.settingsManager.getRetryEnabled(), false);
	assert.equal(f.calls[0].options.maxRetries, 0);
});

test("abort reaches mock stream and real SDK becomes idle without retry", async (t) => {
	const f = await fixture(t, [{ waitForAbort: true }]);
	const { session, sync } = await f.open();
	const prompt = session.prompt("Wait");
	await until(() => f.calls.length === 1);
	assert.equal(session.isStreaming, true);
	await session.abort();
	await prompt;
	await session.agent.waitForIdle();
	sync();
	assert.equal(session.isStreaming, false);
	assert.equal(f.calls[0].options.signal.aborted, true);
	assert.equal(f.calls.length, 1);
	assert.equal(session.messages.at(-1).stopReason, "aborted");
});

test("manual native compaction preserves session, summary, and full durable history", async (t) => {
	const f = await fixture(t, [
		{ text: "Remember the original decision" }, { text: "Recent response" },
		{ text: "## Goal\nPreserve the original decision." },
	]);
	const { session, manager, sync, sessionFile, sessionId } = await f.open();
	await session.prompt("We decided to preserve history.");
	await session.prompt("Recent context. ".repeat(7000));
	const before = manager.getEntries().filter((entry) => entry.type === "message").length;
	const result = await session.compact("Keep the decision and current task");
	sync();
	assert.match(result.summary, /original decision/);
	assert.equal(session.sessionId, sessionId);
	assert.equal(manager.getEntries().filter((entry) => entry.type === "message").length, before);
	assert.ok(manager.getEntries().some((entry) => entry.type === "compaction"));
	assert.equal(f.calls.length, 3);
	assert.equal(f.calls[2].options.maxRetries, 0);
	assert.equal(f.calls[2].model.provider, "swarm-mock");
	assert.match(JSON.stringify(f.calls[2].context), /Keep the decision/);
	session.dispose();
	const reopened = await f.open({ sessionFile });
	assert.equal(reopened.sessionId, sessionId);
	assert.ok(reopened.session.messages.some((message) => message.role === "compactionSummary"));
});

test("transient provider failures do not retry or compact automatically", async (t) => {
	const f = await fixture(t, [{ error: "429 rate limit exceeded" }]);
	const { session, manager, sync } = await f.open();
	await session.prompt("Fail once");
	sync();
	assert.equal(f.calls.length, 1);
	assert.equal(session.messages.at(-1).stopReason, "error");
	assert.equal(manager.getEntries().some((entry) => entry.type === "compaction"), false);
});

test("aborted native manual compaction retains original history and identity", async (t) => {
	const f = await fixture(t, [{ text: "Old decision" }, { text: "Recent response" }, { waitForAbort: true }]);
	const { session, manager, sync, sessionId } = await f.open();
	await session.prompt("Old decision");
	await session.prompt("Recent context. ".repeat(7000));
	const before = manager.getEntries();
	const compact = session.compact("Keep the decision");
	const rejected = assert.rejects(compact, /abort|cancel/i);
	await until(() => f.calls.length === 3);
	session.abortCompaction();
	await rejected;
	sync();
	assert.equal(session.sessionId, sessionId);
	assert.deepEqual(manager.getEntries(), before);
	assert.equal(f.calls[2].options.signal.aborted, true);
	assert.equal(f.calls.length, 3);
});

test("failed native manual compaction does not retry or erase original history", async (t) => {
	const f = await fixture(t, [{ text: "Old decision" }, { text: "Recent response" }, { error: "429 rate limit exceeded" }]);
	const { session, manager, sync } = await f.open();
	await session.prompt("Old decision");
	await session.prompt("Recent context. ".repeat(7000));
	const before = manager.getEntries();
	await assert.rejects(session.compact("Keep the decision"), /429|rate limit/);
	sync();
	assert.deepEqual(manager.getEntries(), before);
	assert.equal(f.calls.length, 3);
});

test("selection rejects real providers, missing models, and live APIs before creating storage", async (t) => {
	const f = await fixture(t);
	await assert.rejects(f.open({ selection: { ...f.selection, provider: "anthropic" } }), /only supports/);
	await assert.rejects(f.open({ selection: { ...f.selection, modelId: "missing" } }), /fallback is disabled/);
	await assert.rejects(f.open({ modelRuntime: { getModel: () => ({ ...f.model, api: "openai-completions" }) } }), /fallback is disabled/);
	assert.deepEqual(readdirSync(f.root), ["checkout"]);
	assert.equal(f.calls.length, 0);
});

test("approved thinking is uniform and not restored from a previous selection", async (t) => {
	const f = await fixture(t);
	const first = await f.open({ selection: { ...f.selection, thinkingLevel: "high" } });
	assert.equal(first.session.thinkingLevel, "high");
	const second = await f.open({ sessionFile: first.sessionFile });
	assert.equal(second.session.thinkingLevel, "off");
	assert.equal(second.session.model.id, f.selection.modelId);
});

test("existing malformed JSONL is rejected unchanged, never repaired or reset", async (t) => {
	const f = await fixture(t, [{ text: "Valid response" }]);
	const first = await f.open();
	await first.session.prompt("Valid request");
	first.sync();
	first.session.dispose();
	const original = readFileSync(first.sessionFile, "utf8");
	const lines = original.trimEnd().split("\n");
	const header = JSON.parse(lines[0]);
	const entry = JSON.parse(lines[1]);
	const cases = [
		"", original.slice(0, -1), original + "{broken\n", original + "\n", "not-json\n" + original,
		JSON.stringify({ ...header, version: 1 }) + "\n",
		JSON.stringify({ ...header, cwd: f.root }) + "\n",
		original + JSON.stringify(entry) + "\n",
		original + JSON.stringify({ ...entry, id: "new", parentId: "missing" }) + "\n",
	];
	for (const text of cases) {
		writeFileSync(first.sessionFile, text);
		await assert.rejects(f.open({ sessionFile: first.sessionFile }));
		assert.equal(readFileSync(first.sessionFile, "utf8"), text);
	}
});

test("session paths reject symlinks, hardlinks, traversal, outside files and public permissions", async (t) => {
	const f = await fixture(t);
	const first = await f.open();
	const symlink = join(f.options.sessionDir, "alias.jsonl");
	symlinkSync(first.sessionFile, symlink);
	await assert.rejects(f.open({ sessionFile: symlink }), /aliases|symlinks/);
	const aliasDir = join(f.root, "alias-dir");
	symlinkSync(f.options.sessionDir, aliasDir);
	await assert.rejects(f.open({ sessionDir: aliasDir }));
	await assert.rejects(f.open({ sessionFile: join(f.root, "outside.jsonl") }), /inside/);
	await assert.rejects(f.open({ sessionFile: `${f.options.sessionDir}/../sessions/${first.sessionFile.split("/").at(-1)}` }), /inside|canonical/);
	const hardlink = join(f.options.sessionDir, "hardlink.jsonl");
	linkSync(first.sessionFile, hardlink);
	await assert.rejects(f.open({ sessionFile: first.sessionFile }), /single-link/);
	rmSync(hardlink);
	chmodSync(first.sessionFile, 0o644);
	await assert.rejects(f.open({ sessionFile: first.sessionFile }), /private/);
	chmodSync(first.sessionFile, 0o600);
	chmodSync(f.options.sessionDir, 0o755);
	await assert.rejects(f.open({ sessionFile: first.sessionFile }), /private/);
});
