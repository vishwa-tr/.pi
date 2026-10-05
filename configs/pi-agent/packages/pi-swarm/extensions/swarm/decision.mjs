import { displayText } from "./dashboard.mjs";
import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/** A read-only decision packet. Editing always happens in a separate native input. */
export class SwarmDecision {
	constructor({ title, body, choices, signal, tui, theme, keybindings, done }) {
		Object.assign(this, { title, body, choices, signal, tui, theme, keybindings, done });
		this.offset = 0;
		this.selected = 0; // Cancel, never an authorizing default.
		this.focus = "details";
		this.pendingG = false;
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
		const firstG = this.pendingG;
		this.pendingG = false;
		if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
			this.focus = this.focus === "details" ? "actions" : "details";
		} else if (this.focus === "actions") {
			if (matchesKey(data, "up") || data === "k") this.selected = Math.max(0, this.selected - 1);
			else if (matchesKey(data, "down") || data === "j") this.selected = Math.min(this.choices.length - 1, this.selected + 1);
			else if (matchesKey(data, "return")) {
				if (this.selected === 0 || (this.ready && this.readToEnd)) return this.finish(this.choices[this.selected]);
			}
		} else {
			if (matchesKey(data, "up") || data === "k") this.offset--;
			else if (matchesKey(data, "down") || data === "j") this.offset++;
			else if (matchesKey(data, "pageUp")) this.offset -= this.pageSize ?? 1;
			else if (matchesKey(data, "pageDown")) this.offset += this.pageSize ?? 1;
			else if (matchesKey(data, "home") || (data === "g" && firstG)) this.offset = 0;
			else if (matchesKey(data, "end") || data === "G") this.offset = Number.MAX_SAFE_INTEGER;
			else if (data === "g") this.pendingG = true;
		}
		this.tui.requestRender();
	}

	render(width) {
		const height = Math.max(1, (this.tui.terminal.rows ?? 24) - 4);
		this.ready = width >= 40 && height >= 12;
		if (!this.ready) {
			this.readToEnd = false;
			this.layout = undefined;
			return ["Resize to 40 columns / 16 rows. Esc cancels."].map(line => truncateToWidth(line, Math.max(0, width), ""));
		}
		if (!this.layout || this.layout.width !== width || this.layout.height !== height) {
			const text = displayText(this.body).replace(/[\u061c\u200e\u200f\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
			this.layout = { width, height, lines: text.split("\n").flatMap(line => wrapTextWithAnsi(line, width)) };
			this.readToEnd = false;
		}
		const { lines } = this.layout;
		// Title, two area headers, position and three help rows stay visible.
		this.pageSize = height - this.choices.length - 7;
		this.offset = Math.max(0, Math.min(this.offset, Math.max(0, lines.length - this.pageSize)));
		if (this.offset + this.pageSize >= lines.length) this.readToEnd = true;
		const body = lines.slice(this.offset, this.offset + this.pageSize);
		while (body.length < this.pageSize) body.push("");
		const styled = (line, color = "text") => this.theme.fg(color, truncateToWidth(line, width, ""));
		const header = (label, area) => styled(`-- ${label}${this.focus === area ? " [focused]" : ""} --`, this.focus === area ? "accent" : "muted");
		return [
			styled(this.title, "accent"),
			header("Details", "details"),
			...body.map(line => styled(line)),
			styled(`${this.offset + 1}-${Math.min(lines.length, this.offset + this.pageSize)} / ${lines.length} | ${this.readToEnd ? "Decision available" : "Read to end to decide"}`, "warning"),
			styled("Tab: switch area | Esc: Cancel", "muted"),
			styled(this.focus === "details" ? "Details: j/k Up/Down scroll" : "Actions: j/k Up/Down select", "muted"),
			styled(this.focus === "details" ? "PgUp/PgDn Home/End gg/G | Enter: none" : "Enter: confirm | Tab: read details", "muted"),
			header("Actions", "actions"),
			...this.choices.map((choice, index) => styled(`${index === this.selected ? ">" : " "} ${choice}`, this.focus === "actions" && index === this.selected ? "accent" : "text")),
		];
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
