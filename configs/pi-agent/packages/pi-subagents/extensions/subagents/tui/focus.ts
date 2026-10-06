/**
 * tui/focus.ts — the producer side of agent focus switching.
 *
 * pi-status-line owns the cycle key, the `[n/N]` footer indicator, and Esc; this
 * file only speaks the plain-data `agent-focus:*` protocol over `pi.events`, so
 * neither package imports the other and each works alone:
 *
 *   agent-focus:roster          producer → presenter  { source, noun, agents: [{ id, name, working }] }
 *   agent-focus:roster-request  presenter → producers  (republish your roster now)
 *   agent-focus:focus           presenter → producers  { source, id } | null
 *
 * While one of our agents is focused, its transcript tail replaces the main chat
 * view in an above-editor widget, and plain text typed into Pi's own editor is
 * mailed to that agent instead of the main agent. Slash commands still reach Pi.
 */

import type { ExtensionAPI, ExtensionUIContext, InputEvent, InputEventResult, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { SubagentsCore } from "../core.ts";
import { isWorking } from "../store/registry.ts";
import { buildComponents } from "./viewer.ts";

export const ROSTER_EVENT = "agent-focus:roster";
export const ROSTER_REQUEST_EVENT = "agent-focus:roster-request";
export const FOCUS_EVENT = "agent-focus:focus";

const SOURCE = "subagents";
const NOUN = "subagent";
const WIDGET_KEY = "subagents-focus";
const PLACEMENT = { placement: "aboveEditor" } as const;
// Rows left for the editor, footer, status row and other widgets below the transcript.
const RESERVED_ROWS = 12;
const MIN_TRANSCRIPT_ROWS = 6;

export interface FocusBridge {
	route(event: InputEvent): InputEventResult | undefined;
	dispose(): void;
}

export function createFocusBridge(pi: ExtensionAPI, core: SubagentsCore, ui: ExtensionUIContext, cwd: string): FocusBridge {
	let focusedAddress: string | null = null;
	let lastRoster = "";
	let disposed = false;

	const publishRoster = async (force: boolean): Promise<void> => {
		const roster = await core.status();
		if (disposed) return;
		const agents = roster
			.sort((a, b) => a.address.localeCompare(b.address))
			.map((entry) => ({ id: entry.address, name: entry.label || entry.address, working: isWorking(entry.state) }));
		const payload = { source: SOURCE, noun: NOUN, agents };
		const key = JSON.stringify(payload);
		if (!force && key === lastRoster) return;
		lastRoster = key;
		pi.events.emit(ROSTER_EVENT, payload);
	};

	const refresh = (): void => {
		void publishRoster(false).catch(() => {});
	};

	const offCore = core.onEvent(refresh);
	const timer = setInterval(refresh, 1000);
	timer.unref?.();
	const offRequest = pi.events.on(ROSTER_REQUEST_EVENT, () => {
		void publishRoster(true).catch(() => {});
	});
	const offFocus = pi.events.on(FOCUS_EVENT, (data) => {
		const target = data as { source?: string; id?: string } | null;
		if (target?.source === SOURCE && target.id) showTranscript(target.id);
		else hideTranscript();
	});
	refresh();

	function showTranscript(address: string): void {
		focusedAddress = address;
		ui.setWidget(WIDGET_KEY, (tui, theme) => createTranscriptWidget(core, tui, theme, address, cwd), PLACEMENT);
		// Keep pi-status-line's project/model row directly above the editor.
		pi.events.emit("status-line:pin-header", undefined);
	}

	function hideTranscript(): void {
		if (!focusedAddress) return;
		focusedAddress = null;
		ui.setWidget(WIDGET_KEY, undefined, PLACEMENT);
	}

	return {
		route(event) {
			const to = focusedAddress;
			if (!to || event.source !== "interactive") return undefined;
			const text = event.text.trim();
			if (!text || text.startsWith("/")) return undefined;
			void core.sendAsUser({ to, text }).catch((error: unknown) => {
				ui.notify(`Could not message ${to}: ${error instanceof Error ? error.message : String(error)}`, "error");
			});
			return { action: "handled" };
		},
		dispose() {
			disposed = true;
			offCore();
			offRequest();
			offFocus();
			clearInterval(timer);
			hideTranscript();
			// Tell the presenter our agents are gone (session switch, reload, shutdown).
			pi.events.emit(ROSTER_EVENT, { source: SOURCE, noun: NOUN, agents: [] });
		},
	};
}

function createTranscriptWidget(core: SubagentsCore, tui: TUI, theme: Theme, address: string, cwd: string) {
	let lines: Array<{ render(width: number): string[] }> = [];
	let header = address;
	let headerMeta = "";
	let closed = false;

	const reload = (): void => {
		void core.peek(address, 500).then((detail) => {
			if (closed || !detail) return;
			lines = buildComponents(detail.sessionFile, tui, cwd);
			const pct = detail.vitals.ctxPercent !== null ? ` · ctx ${Math.round(detail.vitals.ctxPercent)}%` : "";
			header = detail.label ? `${detail.address} “${detail.label}”` : detail.address;
			headerMeta = ` · ${detail.state}${pct} · messages you type go to this agent`;
			tui.requestRender();
		}).catch(() => {});
	};

	const offEvents = core.onEvent(reload);
	const timer = setInterval(reload, 1000);
	timer.unref?.();
	reload();

	return {
		invalidate() {},
		dispose() {
			closed = true;
			offEvents();
			clearInterval(timer);
		},
		render(width: number): string[] {
			const height = Math.max(MIN_TRANSCRIPT_ROWS, tui.terminal.rows - RESERVED_ROWS);
			const title = truncateToWidth(theme.bold(theme.fg("accent", header)) + theme.fg("dim", headerMeta), width, "…");
			const rule = theme.fg("border", "─".repeat(Math.max(0, width)));
			const body = lines.flatMap((component) => component.render(width));
			const visible = body.slice(-(height - 2));
			const padding: string[] = Array.from({ length: Math.max(0, height - 2 - visible.length) }, () => "");
			return [title, rule, ...padding, ...visible];
		},
	};
}
