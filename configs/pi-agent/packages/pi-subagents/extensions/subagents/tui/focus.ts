/** Standalone producer for keyboard agent navigation over plain-data events. */
import { buildComponents } from "./viewer.ts";
import type { SubagentsCore } from "../core.ts";
import { isWorking } from "../store/registry.ts";
import { Editor, Key, matchesKey, truncateToWidth, type TUI, type OverlayHandle } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionUIContext, InputEvent, InputEventResult, Theme } from "@earendil-works/pi-coding-agent";

export const ROSTER_EVENT = "agent-focus:roster";
export const ROSTER_REQUEST_EVENT = "agent-focus:roster-request";
export const FOCUS_EVENT = "agent-focus:focus";
const SOURCE = "subagents";
const NOUN = "subagent";

export interface FocusBridge {
 route(event: InputEvent): InputEventResult | undefined;
 dispose(): void;
}

export function createFocusBridge(pi: ExtensionAPI, core: SubagentsCore, ui: ExtensionUIContext, cwd: string): FocusBridge {
 let disposed = false;
 let serial = 0;
 let lastRoster = "";
 let available = new Set<string>();
 let selected: string | null = null;
 let closeView: (() => void) | undefined;
 let tui: TUI | undefined;
 let theme: Theme | undefined;
 const drafts = new Map<string, string>();

 // Obtain the public TUI surface without replacing the host editor or opening a
 // modal prompt. Each view owns its overlay handle, so closing it cannot remove
 // a newer Safety dialog or another extension's overlay.
 ui.setWidget(`${SOURCE}-focus-mount`, (surface, palette) => {
  tui = surface;
  theme = palette;
  return { render: () => [], invalidate() {} };
 });

 async function publish(force = false): Promise<void> {
  const generation = ++serial;
  try {
   const roster = await core.status();
   if (disposed || generation !== serial) return;
   const agents = [...roster].sort((a, b) => a.address.localeCompare(b.address))
    .map(entry => ({ id: entry.address, name: entry.label || entry.address, working: isWorking(entry.state) }));
   available = new Set(agents.map(agent => agent.id));
   if (selected && !available.has(selected)) hide();
   const payload = { source: SOURCE, noun: NOUN, agents };
   const key = JSON.stringify(payload);
   if (force || key !== lastRoster) { lastRoster = key; pi.events.emit(ROSTER_EVENT, payload); }
  } catch (error) {
   if (disposed || generation !== serial) return;
   available.clear();
   hide();
   pi.events.emit(ROSTER_EVENT, { source: SOURCE, noun: NOUN, agents: [] });
   ui.notify(`Cannot refresh ${NOUN} navigation: ${String(error)}`, "error");
  }
 }
 const refresh = () => { void publish(); };
 const offCore = core.onEvent(refresh);
 const timer = setInterval(refresh, 1000);
 timer.unref?.();
 const offRequest = pi.events.on(ROSTER_REQUEST_EVENT, () => { void publish(true); });
 const offFocus = pi.events.on(FOCUS_EVENT, data => {
  hide();
  const target = data as { source?: string; id?: string; position?: number; total?: number } | null;
  if (disposed || target?.source !== SOURCE || !target.id || !available.has(target.id) || !tui || !theme) return;
  selected = target.id;
  closeView = showTranscript(core, tui, theme, ui, target.id, cwd, drafts, route,
   action => pi.events.emit("agent-focus:navigate", { source: SOURCE, id: target.id, action }),
   `[${target.position}/${target.total}]`);
 });
 refresh();

 function hide(): void {
  closeView?.();
  closeView = undefined;
  selected = null;
 }
 function route(event: InputEvent): InputEventResult | undefined {
  if (disposed || !selected || event.source !== "interactive") return;
  const to = selected;
  if (event.images?.length) {
   ui.notify("Agent mail supports text only. Images were not sent; use the main chat for image attachments.", "warning");
   ui.setEditorText(event.text);
   return { action: "handled" };
  }
  const text = event.text.trim();
  if (!text || text.startsWith("/") || text.startsWith("!")) return;
  if (!available.has(to)) { ui.notify("This agent is no longer available.", "error"); return { action: "handled" }; }
  void core.sendAsUser({ to, text }).then(result => {
   if (disposed) return;
   if (result.disposition === "bounced" || result.disposition === "dropped") throw new Error(result.bounceReason || result.disposition);
   ui.notify(`Message ${result.delivery} to ${to}.`, "info");
  }).catch((error: unknown) => {
   drafts.set(to, text);
   if (!disposed) ui.notify(`Could not message ${to}: ${String(error)}. The draft is retained; reopen this agent to retry.`, "error");
  });
  return { action: "handled" };
 }
 return { route, dispose() {
  if (disposed) return;
  disposed = true;
  ++serial;
  offCore(); offRequest(); offFocus(); clearInterval(timer);
  hide();
  ui.setWidget(`${SOURCE}-focus-mount`, undefined);
  pi.events.emit(ROSTER_EVENT, { source: SOURCE, noun: NOUN, agents: [] });
 } };
}

function showTranscript(core: SubagentsCore, tui: TUI, theme: Theme, ui: ExtensionUIContext,
 address: string, cwd: string, drafts: Map<string, string>, route: FocusBridge["route"],
 navigate: (action: "next" | "back") => void, counter: string): () => void {
 let components: Array<{ render(width: number): string[] }> = [];
 let header = address;
 let closed = false;
 let pending = false;
 let offset = 0;
 let height = 1;
 let overlay: OverlayHandle;
 const editor = new Editor(tui, { borderColor: text => theme.fg("border", text),
  selectList: { selectedPrefix: text => text, selectedText: text => text, description: text => text,
   scrollInfo: text => text, noMatch: text => text } });
 editor.setText(drafts.get(address) ?? "");
 editor.onSubmit = text => {
  if (!text.trim()) return;
  if (/^[\s]*[\/!]/.test(text)) {
   editor.setText(""); drafts.delete(address); navigate("back");
   ui.setEditorText(text);
   ui.notify("Command moved to the main editor. Press Enter to run it.", "info");
   return;
  }
  route({ type: "input", source: "interactive", text });
  editor.setText(""); drafts.delete(address);
 };
 const reload = async () => {
  if (closed || pending) return;
  pending = true;
  try {
   const detail = await core.peek(address, 500);
   if (closed) return;
   if (!detail) { navigate("back"); return; }
   components = buildComponents(detail.sessionFile, tui, cwd);
   header = `${detail.label || address} · ${detail.state}`;
   tui.requestRender();
  } catch (error) {
   if (!closed) { header = `History unavailable: ${String(error)}`; tui.requestRender(); }
  } finally { pending = false; }
 };
 const off = core.onEvent(() => { void reload(); });
 const timer = setInterval(() => { void reload(); }, 1000);
 timer.unref?.();
 const component = {
  get focused() { return editor.focused; },
  set focused(value: boolean) { editor.focused = value; },
  invalidate() { editor.invalidate(); },
  handleInput(data: string) {
   if (matchesKey(data, Key.escape)) return navigate("back");
   if (matchesKey(data, "alt+n")) return navigate("next");
   if (matchesKey(data, "ctrl+v")) { ui.notify("Image attachments are unavailable in agent mail. Return to the main chat to attach images.", "warning"); return; }
   if (matchesKey(data, Key.pageUp)) { offset += height; tui.requestRender(); return; }
   if (matchesKey(data, Key.pageDown)) { offset = Math.max(0, offset - height); tui.requestRender(); return; }
   editor.handleInput(data);
  },
  render(width: number): string[] {
   const rows = Math.max(1, tui.terminal.rows);
   const input = editor.render(width).slice(-Math.max(1, Math.min(8, rows - 2)));
   height = Math.max(0, rows - input.length - 2);
   const body = components.flatMap(item => item.render(width));
   offset = Math.min(offset, Math.max(0, body.length - height));
   const end = body.length - offset;
   const visible = height ? body.slice(Math.max(0, end - height), end) : [];
   const title = `${counter} ${header.replace(/[\x00-\x1f\x7f]/g, " ")}`;
   return [truncateToWidth(title, width), ...visible,
    ...Array.from({ length: Math.max(0, height - visible.length) }, () => ""),
    truncateToWidth("alt+n next · esc main · PgUp/PgDn history · text mail", width), ...input].slice(-rows);
  },
 };
 overlay = tui.showOverlay(component, { row: 0, col: 0, width: "100%", maxHeight: "100%" });
 void reload();
 return () => {
  if (closed) return;
  closed = true;
  const draft = editor.getText();
  if (draft) drafts.set(address, draft);
  off(); clearInterval(timer); overlay.hide();
 };
}
