import { Key, matchesKey } from "@earendil-works/pi-tui";

const COMMAND = "/swarm stop";
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/** Observe typing transparently; consume only the literal emergency submission. */
export function createEmergencyInput({ enabled, canCapture, stop, pendingChanged = () => {} }) {
	let pending = "";
	const update = value => { pending = value; pendingChanged(value); };
	return {
		reset() { update(""); },
		handle(data) {
			if (!enabled()) { if (pending) update(""); return; }
			if (!pending && !canCapture()) return;
			if (pending && matchesKey(data, Key.escape)) { update(""); return; }
			if (pending && matchesKey(data, Key.backspace)) { update(pending.slice(0, -1)); return; }
			if (pending === COMMAND && matchesKey(data, Key.enter)) {
				update("");
				stop();
				return { consume: true };
			}
			// Pasting is not submission. The focused editor still receives its text.
			if (!pending && data === `${PASTE_START}${COMMAND}${PASTE_END}`) { update(COMMAND); return; }
			const nextCharacter = COMMAND[pending.length];
			const text = nextCharacter && matchesKey(data, nextCharacter) ? nextCharacter : data;
			const candidate = pending + text;
			if ([`${COMMAND}\r`, `${COMMAND}\n`, `${COMMAND}\r\n`].includes(candidate)) {
				update("");
				stop();
				return { consume: true };
			}
			// Let '/' open dashboard search immediately, and preserve every ordinary
			// key. Only Enter for the full command bypasses the focused component.
			update(candidate && COMMAND.startsWith(candidate) ? candidate : "");
		},
	};
}
