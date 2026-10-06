import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createFocusBridge } from "../extensions/swarm/focus.mjs";

test("Swarm publishes into Pi agent navigation with an owned read-only three-tab overlay", () => {
	const events = new EventEmitter(); const changes = new Set(); const rosters = []; const navigated = []; const overlays = [];
	const snapshot = { run: { status: "running", revision: 1, workers: [{ id: "builder", specialization: "Implementation", brief: "Build" }], messages: [], tasks: [] }, driver: { active: ["builder"], queued: [] } };
	events.on("agent-focus:roster", roster => rosters.push(roster));
	events.on("agent-focus:navigate", target => navigated.push(target));
	const surface = { terminal: { rows: 24 }, requestRender() {}, showOverlay(component) {
		const record = { component, hidden: false }; overlays.push(record);
		return { hide() { record.hidden = true; } };
	} };
	const ui = { setWidget(_key, factory) { factory?.(surface, { fg: (_color, text) => text }); } };
	const source = { snapshot: () => snapshot, history: () => [], subscribe: fn => { changes.add(fn); return () => changes.delete(fn); } };
	const bridge = createFocusBridge({ events }, source, ui);
	try {
		assert.deepEqual(rosters.at(-1), { source: "swarm", noun: "swarm agent", agents: [{ id: "builder", name: "Implementation", working: true }] });
		events.emit("agent-focus:focus", { source: "swarm", id: "builder" });
		const view = overlays.at(-1).component;
		assert.match(view.render(80).join("\n"), /1 Messages.*2 Agents.*3 Topics/);
		view.handleInput("\t"); assert.match(view.render(80).join("\n"), /Main agent/);
		view.handleInput("p"); view.handleInput("s"); assert.deepEqual(navigated, []);
		view.handleInput("\x1bn"); assert.equal(navigated.at(-1).action, "next");
		view.handleInput("\x1b"); assert.equal(navigated.at(-1).action, "back");
		bridge.hide(); assert.equal(overlays.at(-1).hidden, true);
		events.emit("agent-focus:focus", { source: "swarm", id: "builder" });
		snapshot.run.workers = []; for (const update of changes) update();
		assert.equal(overlays.at(-1).hidden, true);
	} finally { bridge.dispose(); }
	assert.equal(changes.size, 0);
	assert.equal(events.listenerCount("agent-focus:focus"), 0);
	assert.equal(events.listenerCount("agent-focus:roster-request"), 0);
	assert.deepEqual(rosters.at(-1).agents, []);
});


test("selecting main from a focused roster returns to the native main chat", () => {
	const events = new EventEmitter(); const navigation = []; let component;
	events.on("agent-focus:navigate", value => navigation.push(value));
	const source = { snapshot: () => ({ run: { status: "paused", workers: [{ id: "a", specialization: "Worker" }], tasks: [], messages: [] }, driver: { active: [], queued: [] } }), history: () => [], subscribe: () => () => {} };
	const surface = { terminal: { rows: 24 }, requestRender() {}, showOverlay(value) { component = value; return { hide() {} }; } };
	const bridge = createFocusBridge({ events }, source, { setWidget(_key, factory) { factory?.(surface, { fg: (_color, text) => text }); } });
	try {
		events.emit("agent-focus:focus", { source: "swarm", id: "a" });
		component.handleInput("2"); component.handleInput("k"); component.handleInput("\r");
		assert.deepEqual(navigation.at(-1), { source: "swarm", id: "a", action: "back" });
	} finally { bridge.dispose(); }
});
