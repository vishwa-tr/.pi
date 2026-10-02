import { displayText } from "./dashboard.mjs";
import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/** A read-only decision packet. Editing always happens in a separate native input. */
export class SwarmDecision {
	constructor({ title, body, choices, signal, tui, theme, keybindings, done }) {
		Object.assign(this, { title, body, choices, signal, tui, theme, keybindings, done });
		this.offset = 0;
		this.selected = 0; // Cancel, never an authorizing default.
		this.closed = false;
		this.abort = () => this.finish();
		signal.addEventListener("abort", this.abort, { once: true });
		// Defer completion until the native custom factory has mounted its component.
		if (signal.aborted) queueMicrotask(this.abort);
	}

	finish(value) {
		if (this.closed) return;
		this.dispose();
		this.done(this.signal.aborted ? undefined : value);
	}

	dispose() {
		if (this.closed) return;
		this.closed = true;
		this.signal.removeEventListener("abort", this.abort);
	}

	invalidate() { this.layout = undefined; }

	handleInput(data) {
		if (this.closed) return;
		if (this.keybindings.matches(data, "tui.select.cancel") || matchesKey(data, "escape")) return this.finish();
		if (matchesKey(data, "left")) this.selected = Math.max(0, this.selected - 1);
		else if (matchesKey(data, "right")) this.selected = Math.min(this.choices.length - 1, this.selected + 1);
		else if (matchesKey(data, "up")) this.offset--;
		else if (matchesKey(data, "down")) this.offset++;
		else if (matchesKey(data, "pageUp")) this.offset -= this.pageSize ?? 1;
		else if (matchesKey(data, "pageDown")) this.offset += this.pageSize ?? 1;
		else if (matchesKey(data, "home")) this.offset = 0;
		else if (matchesKey(data, "end")) this.offset = Number.MAX_SAFE_INTEGER;
		else if (matchesKey(data, "return")) {
			if (this.selected === 0 || (this.ready && this.readToEnd)) return this.finish(this.choices[this.selected]);
		}
		this.tui.requestRender();
	}

	render(width) {
		const height = Math.max(1, (this.tui.terminal.rows ?? 24) - 4);
		this.ready = width >= 40 && height >= 12;
		if (!this.ready) {
			this.readToEnd = false;
			return ["Resize to 40 columns / 16 rows. Esc cancels."].map(line => truncateToWidth(line, Math.max(0, width), ""));
		}
		if (!this.layout || this.layout.width !== width) {
			const text = displayText(this.body).replace(/[\u061c\u200e\u200f\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
			this.layout = { width, lines: text.split("\n").flatMap(line => wrapTextWithAnsi(line, width)) };
			this.readToEnd = false;
		}
		const { lines } = this.layout;
		this.pageSize = height - this.choices.length - 4;
		this.offset = Math.max(0, Math.min(this.offset, Math.max(0, lines.length - this.pageSize)));
		if (this.offset + this.pageSize >= lines.length) this.readToEnd = true;
		const body = lines.slice(this.offset, this.offset + this.pageSize);
		while (body.length < this.pageSize) body.push("");
		const footer = [
			`${this.offset + 1}-${Math.min(lines.length, this.offset + this.pageSize)} / ${lines.length} | ${this.readToEnd ? "Decision available" : "Read to end to decide"}`,
			"Up/Down PgUp/PgDn Home/End | Esc: Cancel",
			"Left/Right: select action | Enter: confirm",
			...this.choices.map((choice, index) => `${index === this.selected ? ">" : " "} ${choice}`),
		];
		return [this.title, ...body, ...footer].map((line, index) => this.theme.fg(index === 0 ? "accent" : index > this.pageSize ? "warning" : "text", truncateToWidth(line, width, "")));
	}
}

export async function showDecision(ctx, title, body, choices, signal) {
	if (signal.aborted) return undefined;
	let component;
	try {
		// A focused overlay owns PageUp/PageDown in Pi's fullscreen mode;
		// a replacement editor can leave those keys with transcript scrolling.
		return await ctx.ui.custom((tui, theme, keybindings, done) => {
			component = new SwarmDecision({ title, body, choices, signal, tui, theme, keybindings, done });
			return component;
		}, { overlay: true, overlayOptions: { width: "100%", anchor: "center" } });
	} finally { component?.dispose(); }
}
