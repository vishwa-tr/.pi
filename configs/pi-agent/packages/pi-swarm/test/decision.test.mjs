import test from "node:test";
import assert from "node:assert/strict";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { SwarmDecision, showDecision } from "../extensions/swarm/decision.mjs";
import { requestUserApproval } from "../extensions/swarm/ui.mjs";

function fixture(body, columns = 80, rows = 24) {
	const abort = new AbortController();
	const results = [];
	const tui = { terminal: { rows }, requestRender() {} };
	const component = new SwarmDecision({ title: "LAUNCH (HTTPS provider)", body, choices: ["Cancel", "Edit agreement", "Approve"], signal: abort.signal,
		tui, theme: { fg: (_, text) => text }, keybindings: { matches: (data, action) => action === "tui.select.cancel" && matchesKey(data, "escape") }, done: value => results.push(value) });
	const render = () => {
		const lines = component.render(columns);
		assert.ok(lines.length <= rows - 4);
		for (const line of lines) assert.ok(visibleWidth(line) <= columns, JSON.stringify(line));
		assert.match(lines.join("\n"), /Esc: Cancel/);
		assert.equal(lines.at(-1), `${component.selected === 2 ? ">" : " "} Approve`);
		return lines.join("\n");
	};
	return { component, abort, results, render, tui };
}

for (const [columns, rows] of [[60, 24], [80, 24], [100, 40]]) {
	test(`bounded native decision preserves every packet line at ${columns}x${rows}`, () => {
		const body = Array.from({ length: 300 }, (_, i) => `critical-${i}: objective criterion scope limit dirty ID evidence`).join("\n");
		const f = fixture(body, columns, rows);
		let observed = f.render();
		for (let i = 0; i < 300 && !f.component.readToEnd; i++) {
			f.component.handleInput("\x1b[6~");
			observed += f.render();
		}
		for (let i = 0; i < 300; i++) assert.ok(observed.includes(`critical-${i}:`));
		assert.equal(f.component.readToEnd, true);
		f.component.handleInput("\x1b[H");
		assert.match(f.render(), /critical-0:/);
		f.component.handleInput("\x1b[F");
		assert.match(f.render(), /critical-299:/);
		f.component.handleInput("\x1b[5~");
		assert.doesNotMatch(f.render(), /critical-299:/);
		f.component.dispose();
	});

	test(`Unicode, long URL, huge objective, deep data and terminal injection at ${columns}x${rows}`, () => {
		const hostile = "\x1b[2J\x1b]8;;https://untrusted.invalid\x07\r\u202e\u2066";
		let deep = { exactUnresolvedId: "last-operation-id", evidence: "final-evidence" };
		for (let i = 0; i < 40; i++) deep = { nested: deep };
		const body = `Objective: ${"界🙂é".repeat(3000)}${hostile}\nEndpoint: https://fixture.invalid/${"path".repeat(500)}\n${JSON.stringify(deep, null, 2)}`;
		const f = fixture(body, columns, rows);
		let observed = f.render();
		for (let i = 0; i < 2000 && !f.component.readToEnd; i++) {
			f.component.handleInput("\x1b[6~"); observed += f.render();
		}
		assert.ok(f.component.readToEnd);
		assert.doesNotMatch(observed, /[\x1b\r\u202e\u2066]/);
		assert.match(observed, /\\u001b/);
		assert.match(observed, /last-operation-id/);
		assert.match(observed, /final-evidence/);
		f.component.dispose();
	});
}

test("typing, paste and default Enter never authorize; unread selected approval stays blocked", () => {
	const f = fixture("critical\n".repeat(100)); f.render();
	for (const key of ["a", "y", "Approve", "\x1b[200~Approve\r\x1b[201~"]) f.component.handleInput(key);
	assert.deepEqual(f.results, []);
	f.component.handleInput("\x1b[C"); f.component.handleInput("\x1b[C"); f.component.handleInput("\r");
	assert.deepEqual(f.results, []);
	f.component.handleInput("\x1b[F"); f.render(); f.component.handleInput("\r");
	assert.deepEqual(f.results, ["Approve"]);
	f.component.handleInput("\r"); assert.equal(f.results.length, 1);
	const safe = fixture("complete packet"); safe.render(); safe.component.handleInput("\r");
	assert.deepEqual(safe.results, ["Cancel"]);
});

test("resize invalidates layout and blocks decision in an unusably small terminal", () => {
	const f = fixture("界".repeat(3000)); f.component.render(100); f.component.handleInput("\x1b[F"); f.component.render(100);
	assert.ok(f.component.readToEnd);
	f.component.offset = 0; f.component.render(60); assert.equal(f.component.readToEnd, false);
	f.component.handleInput("\x1b[C"); f.component.handleInput("\x1b[C");
	f.tui.terminal.rows = 10;
	assert.ok(f.component.render(20).every(line => visibleWidth(line) <= 20));
	f.component.handleInput("\r"); assert.deepEqual(f.results, []);
	f.component.handleInput("\x1b"); assert.deepEqual(f.results, [undefined]);
});

for (const stage of ["before mount", "while reading", "after end", "timeout"]) {
	test(`custom decision cancellation ${stage} settles once and removes listeners`, async () => {
		const abort = new AbortController(); let component; let listeners = 0;
		const add = abort.signal.addEventListener.bind(abort.signal), remove = abort.signal.removeEventListener.bind(abort.signal);
		abort.signal.addEventListener = (...args) => { listeners++; return add(...args); };
		abort.signal.removeEventListener = (...args) => { listeners--; return remove(...args); };
		const ctx = { ui: { custom: factory => new Promise(resolve => {
			component = factory({ terminal: { rows: 24 }, requestRender() {} }, { fg: (_, text) => text }, { matches: () => false }, resolve);
		}) } };
		if (stage === "before mount") abort.abort();
		const result = showDecision(ctx, "Packet", "line\n".repeat(100), ["Cancel", "Approve"], abort.signal);
		if (component) {
			component.render(80);
			if (stage === "after end") { component.handleInput("\x1b[F"); component.render(80); }
			if (stage === "timeout") setTimeout(() => abort.abort(), 1); else abort.abort();
		}
		assert.equal(await result, undefined);
		component?.handleInput("\x1b[C"); component?.handleInput("\r");
		assert.equal(listeners, 0);
	});
}

test("real approval components serialize dirty-work and exact-ID/evidence attestation", async () => {
	let active = 0; const packets = [];
	const signal = new AbortController().signal;
	const ctx = { mode: "tui", hasUI: true, ui: {
		input: async () => { assert.equal(active, 0); return "Independently verified all listed work stopped"; },
		custom: factory => new Promise(resolve => {
			assert.equal(active++, 0);
			const c = factory({ terminal: { rows: 24 }, requestRender() {} }, { fg: (_, text) => text }, { matches: () => false }, value => { active--; resolve(value); });
			packets.push(c.body); c.render(60); c.handleInput("\x1b[F"); c.render(60); c.handleInput("\x1b[C"); c.handleInput("\r");
		}),
	} };
	const result = await requestUserApproval(ctx, { action: "reconcile", specification: { objective: "Goal" }, changes: { paths: ["dirty.txt"] }, recovery: { operations: [{ id: "exact-operation" }], turns: [{ id: "exact-turn" }] }, requiresExistingWorkDecision: true, signal });
	assert.equal(result.approved, true); assert.equal(result.existingChanges, "preserve");
	assert.equal(packets.length, 3);
	assert.match(packets[1], /dirty.txt/);
	assert.match(packets[2], /exact-operation/); assert.match(packets[2], /exact-turn/);
	assert.match(packets[2], /Independently verified/);
	assert.equal(active, 0);
});
