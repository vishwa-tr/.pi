import test from "node:test";
import assert from "node:assert/strict";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
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

test("HTTPS approval labels the dashboard honestly without claiming mock-only execution", () => {
	const f = fixture();
	f.snapshot.run.hostApprovals = [{ provider: { transport: "https-chat-completions" } }];
	f.tick();
	assert.match(f.view.render(100).join("\n"), /HTTPS provider/);
	assert.doesNotMatch(f.view.render(100).join("\n"), /mock only/);
	assert.match(f.view.body(), /cost: unknown/);
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

for (const [key, status, action] of [["p", "running", "pause"], ["s", "running", "stop"], ["r", "paused", "resume"], ["R", "stopped", "restart"], ["c", "pausing", "reconcile"]]) {
	test(`${key} returns ${action} only after timer disposal`, () => {
		const f = fixture(); f.snapshot.run.status = status; f.tick();
		f.view.handleInput(key); f.view.handleInput(key);
		assert.deepEqual(f.results, [action]); assert.equal(f.clears(), 1);
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
