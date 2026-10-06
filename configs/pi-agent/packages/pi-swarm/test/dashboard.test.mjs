import test from "node:test";
import assert from "node:assert/strict";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { transcriptText } from "../extensions/swarm/transcript.mjs";
import { SwarmDashboard, displayText, showDashboard } from "../extensions/swarm/dashboard.mjs";

function fixture() {
	let snapshot = { run: { status: "running", revision: 1, cycle: 1, elapsedMs: 12, limits: { active: 4 }, objective: "Goal", workers: [{ id: "one", specialization: "Database", brief: "Investigate" }, { id: "two", specialization: "Review", brief: "Check" }], tasks: [], messages: [] }, driver: { active: ["one"], queued: [], errors: [] }, errors: [] };
	let tick; let clears = 0; let renders = 0;
	const results = []; const historyReads = [];
	const signal = new AbortController();
	const keybindings = { matches: (data, action) => matchesKey(data, ({ "tui.select.cancel": "escape", "tui.select.confirm": "enter", "tui.select.up": "up", "tui.select.down": "down", "tui.select.pageUp": "pageUp", "tui.select.pageDown": "pageDown" })[action]) };
	const options = { source: { snapshot: () => snapshot, history: id => { historyReads.push(id); return Array.from({ length: 130 }, (_, i) => ({ id: String(i), message: { content: `entry-${i}` } })); } }, tui: { terminal: { rows: 24 }, requestRender: () => renders++ }, theme: { fg: (_, text) => text }, keybindings, signal: signal.signal, done: value => results.push(value), schedule: callback => { tick = callback; return 1; }, unschedule: () => clears++ };
	const view = new SwarmDashboard(options);
	return { view, options, signal, results, historyReads, tick: () => tick(), snapshot, setSnapshot: next => { snapshot = next; }, clears: () => clears, renders: () => renders };
}

test("dashboard labels native and unattached selection without claiming mock-only execution", () => {
	const f = fixture();
	f.snapshot.run.hostApprovals = [{ provider: { transport: "pi-native" } }];
	f.tick();
	assert.match(f.view.render(100).join("\n"), /Pi native provider/);
	assert.doesNotMatch(f.view.render(100).join("\n"), /mock only/);
	assert.match(f.view.body(), /cost: unknown/);
	f.setSnapshot(undefined); f.tick();
	assert.match(f.view.render(100).join("\n"), /not selected/);
	assert.doesNotMatch(f.view.render(100).join("\n"), /mock only/);
	f.view.dispose();
});

test("polling refreshes detached inspection, never executes work; dispose is idempotent", () => {
	const f = fixture();
	assert.match(f.view.render(80).join("\n"), /running/);
	f.snapshot.run.status = "paused"; f.tick();
	assert.match(f.view.render(80).join("\n"), /paused/);
	assert.equal(f.renders(), 1);
	assert.deepEqual(f.results, []);
	f.view.handleInput("\x1b"); f.view.dispose(); f.signal.abort();
	assert.equal(f.clears(), 1); assert.deepEqual(f.results, [undefined]);
	f.tick(); assert.equal(f.renders(), 1);
});

test("worker selection and paged native history have no entry-count cutoff", () => {
	const f = fixture();
	f.view.handleInput("2"); assert.match(f.view.render(80).join("\n"), /active SDK turn/);
	f.view.handleInput("\x1b[C"); f.view.handleInput("\r");
	assert.deepEqual(f.historyReads, ["two"]);
	f.view.handleInput("\x1b[F");
	assert.match(f.view.render(80).join("\n"), /entry-129/);
	f.tick(); assert.equal(f.historyReads.length, 1);
	f.snapshot.run.revision++; f.tick(); assert.equal(f.historyReads.length, 2);
	f.view.dispose();
});

for (const [key, status, action] of [["p", "running", "pause"], ["s", "running", "stop"], ["r", "paused", "resume"], ["R", "stopped", "restart"], ["C", "pausing", "reconcile"]]) {
	test(`${key} cannot ${action} from the read-only dashboard`, () => {
		const f = fixture(); f.snapshot.run.status = status; f.tick();
		f.view.handleInput(key); f.view.handleInput(key);
		assert.deepEqual(f.results, []); assert.equal(f.clears(), 0); f.view.dispose();
	});
}

test("ineligible continuation does nothing and lifecycle abort returns no action", () => {
	const f = fixture(); f.view.handleInput("r"); f.view.handleInput("R");
	assert.deepEqual(f.results, []); f.signal.abort();
	assert.deepEqual(f.results, [undefined]); assert.equal(f.clears(), 1);
});

test("all sections escape controls and bound Unicode/long strings at narrow widths", () => {
	const f = fixture();
	const hostile = "\x1b]52;c;evil\x07\r\u009b2J\u202e" + "界🙂".repeat(500);
	f.snapshot.run.objective = hostile;
	f.snapshot.run.workers[0].brief = hostile;
	f.snapshot.run.tasks = [{ id: hostile, status: "blocked" }];
	f.snapshot.run.messages = [{ text: hostile }];
	for (const section of "123456") {
		f.view.handleInput(section);
		for (const width of [1, 2, 8, 20, 40, 60, 100]) {
			const lines = f.view.render(width);
			assert.ok(lines.length <= 20);
			for (const line of lines) {
				assert.ok(visibleWidth(line) <= width, `${section}: ${width}`);
				assert.doesNotMatch(line.replace(/\x1b\[[0-9;]*m/g, ""), /[\x00-\x1f\x7f-\x9f\u202e]/);
			}
		}
	}
	assert.match(displayText(hostile), /\\u001b/);
	f.view.dispose();
});

test("read errors remain inspection failures, not stale history or automatic retry actions", () => {
	const f = fixture(); f.options.source.history = () => { throw new Error("private data"); };
	f.view.handleInput("6");
	assert.match(f.view.render(80).join("\n"), /Inspection unavailable/);
	assert.doesNotMatch(f.view.render(80).join("\n"), /private data/);
	assert.deepEqual(f.results, []); f.view.dispose();
});

test("custom UI rejection always disposes its component", async () => {
	const f = fixture(); f.view.dispose(); let component;
	await assert.rejects(showDashboard({ ui: { custom: async factory => {
		component = factory(f.options.tui, f.options.theme, f.options.keybindings, () => {});
		throw new Error("UI closed");
	} } }, f.options.source, f.signal.signal));
	assert.equal(component.closed, true);
});

test("Vim navigation owns rows, panes, half pages and both ends", () => {
	const f = fixture();
	f.view.handleInput("\t"); assert.equal(f.view.section, 1);
	f.view.handleInput("j"); assert.equal(f.view.workerId, "two");
	f.view.handleInput("k"); assert.equal(f.view.workerId, "one");
	f.view.handleInput("c"); f.view.render(60); assert.equal(f.view.section, 5);
	f.view.handleInput("G"); f.view.render(60); assert.ok(f.view.offset > 100);
	f.view.handleInput("g"); f.view.handleInput("g"); f.view.render(60); assert.equal(f.view.offset, 0);
	f.view.handleInput("\x04"); assert.equal(f.view.offset, Math.floor(f.view.pageSize / 2));
	f.view.handleInput("\x15"); assert.equal(f.view.offset, 0);
	f.view.handleInput("q"); assert.equal(f.view.section, 1); assert.deepEqual(f.results, []);
	f.view.handleInput("h"); assert.equal(f.view.section, 0);
	f.view.handleInput("l"); assert.equal(f.view.section, 1);
	f.view.handleInput("q"); assert.deepEqual(f.results, [undefined]);
});

test("search is a modal local input, with cancel, reset, no matches and paste isolation", () => {
	const f = fixture(); f.view.handleInput("c"); f.view.render(60);
	f.view.handleInput("/"); f.view.handleInput("p"); f.view.handleInput("s"); f.view.handleInput("C");
	assert.deepEqual(f.results, []); assert.equal(f.view.draft, "psC");
	f.view.handleInput("\x1b"); assert.equal(f.view.query, "");
	f.view.handleInput("/"); f.view.handleInput("entry-12"); f.view.handleInput("\r");
	f.view.render(60); assert.equal(f.view.matchCount, 11); assert.ok(f.view.offset > 0);
	const first = f.view.offset; f.view.handleInput("n"); f.view.render(60); assert.ok(f.view.offset > first);
	f.view.handleInput("N"); f.view.render(60); assert.equal(f.view.offset, first);
	f.view.handleInput("/"); f.view.handleInput("missing"); f.view.handleInput("\r");
	assert.equal(f.view.matchCount, 0); f.view.handleInput("n");
	f.view.handleInput("/"); f.view.handleInput("\r"); assert.equal(f.view.query, "");
	f.view.handleInput("\x1b[200~"); f.view.handleInput("p"); f.view.handleInput("sC\x1b[201~");
	assert.deepEqual(f.results, []);
	f.view.handleInput("/"); f.view.handleInput("\x1b[200~p\x1b[201~"); f.view.handleInput("\r");
	assert.equal(f.view.query, "p"); assert.deepEqual(f.results, []); f.view.dispose();
});

for (const [name, content, query, expectedRow] of [
	["exact boundary", "X".repeat(20) + "MATCH", "MATCH", 1],
	["word wrap", "X".repeat(16) + " MATCH", "MATCH", 1],
	["wide Unicode boundary", "界🙂".repeat(5) + "MATCH", "MATCH", 1],
	["wide Unicode word wrap", "界".repeat(8) + " MATCH", "MATCH", 1],
	["combining graphemes", "e\u0301".repeat(20) + "MATCH", "MATCH", 1],
	["match across wrapped rows", "X".repeat(18) + "MATCH", "MATCH", 0],
	["case expansion before match", "İ".repeat(20) + "MATCH", "match", 1],
]) {
	test(`search maps ${name} to the actual rendered row`, () => {
		const f = fixture();
		f.view.handleInput("c");
		f.view.body = () => content + "\n" + "tail\n".repeat(30);
		f.view.render(20);
		f.view.handleInput("/"); f.view.handleInput(query); f.view.handleInput("\r");
		assert.equal(f.view.matchOffset, expectedRow);
		f.view.render(20);
		assert.equal(f.view.offset, expectedRow);
		assert.match(f.view.lines[expectedRow], expectedRow === 0 ? /MA$/ : /MATCH/);
		f.view.dispose();
	});
}

test("refresh retains worker identity and scroll; follow tail is explicit and cancellable", () => {
	const f = fixture(); f.view.handleInput("2"); f.view.handleInput("j");
	f.snapshot.run.workers.reverse(); f.tick(); assert.equal(f.view.workerId, "two"); assert.equal(f.view.workerIndex, 0);
	f.view.handleInput("c"); f.view.render(80); f.view.handleInput("j"); f.view.render(80);
	const offset = f.view.offset; f.snapshot.run.revision++; f.tick(); f.view.render(80); assert.equal(f.view.offset, offset);
	f.view.handleInput("f"); f.view.render(80); assert.equal(f.view.follow, true); assert.match(f.view.render(80).join("\n"), /entry-129/);
	f.view.handleInput("k"); assert.equal(f.view.follow, false);
	f.signal.abort(); assert.deepEqual(f.results, [undefined]); assert.equal(f.clears(), 1);
});

test("help is scrollable, preserves position and cannot dispatch controls", () => {
	const f = fixture(); f.view.handleInput("c"); f.view.render(60); f.view.handleInput("G"); f.view.render(60);
	const offset = f.view.offset;
	f.view.handleInput("?"); f.view.render(60); f.view.handleInput("p"); f.view.handleInput("C");
	assert.deepEqual(f.results, []); f.view.handleInput("G"); assert.match(f.view.render(60).join("\n"), /Inspection never starts/);
	f.view.handleInput("?"); f.view.render(60); assert.equal(f.view.offset, offset); f.view.dispose();
});

test("focused overlay options and pre-aborted mounting are lifecycle safe", async () => {
	const f = fixture(); f.view.dispose(); let calls = 0;
	const ctx = { ui: { custom: async (factory, options) => {
		calls++; assert.equal(options.overlay, true); assert.equal(options.overlayOptions.width, "100%");
		const view = factory(f.options.tui, f.options.theme, f.options.keybindings, () => {});
		view.finish(); return undefined;
	} } };
	await showDashboard(ctx, f.options.source, f.signal.signal);
	f.signal.abort(); await showDashboard(ctx, f.options.source, f.signal.signal); assert.equal(calls, 1);
});

test("semantic transcript retains roles, context updates and all entries without replay secrets", () => {
	const entries = [
		{ id: "u", timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "Objective" } },
		{ id: "a", message: { role: "assistant", content: [{ type: "text", text: "Answer" }, { type: "toolCall", id: "call", name: "read", arguments: { path: "sample.txt" }, thoughtSignature: "SECRET" }], responseId: "SECRET" } },
		{ message: { role: "toolResult", toolName: "read", toolCallId: "call", isError: false, content: [{ type: "text", text: "Result text" }], details: { credential: "SECRET" } } },
		{ message: { role: "system", sections: { policy: "Be careful" }, toolsRemoved: [{ name: "write" }] } },
		{ type: "compaction", summary: "Earlier work", firstKeptEntryId: "u", systemMessage: { role: "system", content: "Checkpoint" } },
		{ type: "context_edit", targetId: "u", replacement: null },
		{ type: "model_change", provider: "fixture", modelId: "model" },
		{ type: "custom", customType: "private-host", data: "SECRET" },
		{ type: "session", cwd: "SECRET" },
	];
	const text = transcriptText(entries);
	for (const expected of ["user", "assistant", "Result text", "call", "Be careful", "Earlier work", "Checkpoint", "Omitted from future", "fixture/model", "9 · session"]) assert.ok(text.includes(expected), expected);
	assert.doesNotMatch(text, /SECRET/);
});

for (const [name, replacement, expected] of [
	["string", { content: "Replacement\x1b[2J\u202e", privateData: "SECRET" }, /Replacement\\u001b\[2J\\u202e/],
	["blocks", { content: [{ type: "text", text: "Block\x1b[2J" }, { type: "image", mimeType: "image/png", data: "SECRET" }, { type: "thinking", redacted: true, thinking: "SECRET" }], privateData: "SECRET" }, /Block\\u001b\[2J/],
	["null", null, /Omitted from future model context/],
]) {
	test(`native context edit ${name} renders content without private metadata or controls`, () => {
		const f = fixture();
		f.options.source.history = () => [{ type: "context_edit", targetId: "original", replacement }];
		f.view.handleInput("c");
		const text = displayText(f.view.body());
		assert.match(text, /Context edit → original/);
		assert.match(text, expected);
		assert.doesNotMatch(text, /SECRET|\x1b|\u202e|No text content/);
		f.view.render(60);
		assert.doesNotMatch(f.view.lines.join("\n"), /SECRET|\x1b|\u202e/);
		f.view.dispose();
	});
}

test("frames remain width and height bounded at supported terminal sizes", () => {
	const f = fixture();
	for (const [width, height] of [[60, 24], [80, 24], [100, 40]]) {
		f.options.tui.terminal.rows = height;
		for (const section of "123456") {
			f.view.handleInput(section);
			const lines = f.view.render(width);
			assert.ok(lines.length <= height - 4);
			assert.ok(lines.every(line => visibleWidth(line) <= width));
		}
	}
	f.view.dispose();
});
