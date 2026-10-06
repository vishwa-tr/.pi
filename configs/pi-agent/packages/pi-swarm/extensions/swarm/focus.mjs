import { SwarmDashboard } from "./dashboard.mjs";
import { matchesKey } from "@earendil-works/pi-tui";

const SOURCE = "swarm";

/** Optional Pi agent-navigation producer; it receives read capabilities only. */
export function createFocusBridge(pi, source, ui) {
	let disposed = false;
	let view;
	let overlay;
	let surface;
	let theme;
	let selected;
	let lastRoster;
	const callbacks = [];
	const hide = () => { view?.dispose(); view = undefined; overlay?.hide(); overlay = undefined; selected = undefined; };
	const publish = (force = false) => {
		if (disposed) return;
		const snapshot = source.snapshot();
		const agents = (snapshot?.run?.workers ?? []).map(worker => ({ id: worker.id, name: worker.specialization || worker.id,
			working: snapshot.driver?.active?.includes(worker.id) === true || snapshot.driver?.queued?.includes(worker.id) === true }));
		if (selected && !agents.some(agent => agent.id === selected)) hide();
		const roster = { source: SOURCE, noun: "swarm agent", agents };
		const key = JSON.stringify(roster);
		if (force || key !== lastRoster) { lastRoster = key; pi.events.emit("agent-focus:roster", roster); }
	};
	// The host editor and permission overlays retain their own ownership.
	if (typeof ui?.setWidget === "function") ui.setWidget("swarm-focus-mount", (tui, palette) => {
		surface = tui; theme = palette;
		return { render: () => [], invalidate() {} };
	});
	callbacks.push(source.subscribe(() => publish()));
	const listen = (name, listener) => {
		const off = pi.events.on(name, listener);
		callbacks.push(typeof off === "function" ? off : () => pi.events.off?.(name, listener));
	};
	listen("agent-focus:roster-request", () => publish(true));
	listen("agent-focus:focus", target => {
		hide();
		if (disposed || target?.source !== SOURCE || !surface || !source.snapshot()?.run?.workers.some(worker => worker.id === target.id)) return;
		selected = target.id;
		const signal = new AbortController();
		const navigate = action => pi.events.emit("agent-focus:navigate", { source: SOURCE, id: target.id, action });
		const keybindings = { matches: (data, action) => matchesKey(data, ({ "tui.select.cancel": "escape", "tui.select.confirm": "enter", "tui.select.up": "up", "tui.select.down": "down", "tui.select.pageUp": "pageUp", "tui.select.pageDown": "pageDown" })[action]) };
		view = new SwarmDashboard({ source, tui: surface, theme, keybindings, signal: signal.signal, done: () => navigate("back"), selectAgent: id => {
			if (id === "owner") { navigate("back"); return true; }
			if (id === target.id) return false;
			pi.events.emit("agent-focus:navigate", { source: SOURCE, id: target.id, action: "select", targetId: id });
			return true;
		} });
		view.openConversation(target.id);
		const mounted = view;
		overlay = surface.showOverlay({ focused: false, invalidate: () => mounted.invalidate(), render: width => mounted.render(width), handleInput: data => {
			if (matchesKey(data, "alt+n")) navigate("next");
			else if (matchesKey(data, "escape")) navigate("back");
			else mounted.handleInput(data);
		} }, { width: "100%", anchor: "center" });
		surface.requestRender();
	});
	publish(true);
	return {
		get active() { return Boolean(view); },
		hide,
		refresh: publish,
		dispose() {
			if (disposed) return;
			disposed = true; hide();
			for (const off of callbacks) if (typeof off === "function") off();
			ui?.setWidget?.("swarm-focus-mount", undefined);
			pi.events.emit("agent-focus:roster", { source: SOURCE, noun: "swarm agent", agents: [] });
		}
	};
}
