import { displayText } from "./dashboard.mjs";
import { isBoardMessage } from "./messaging.mjs";

export const TOPIC_MIRROR = "swarm-topic-mirror";

export const cardText = (value, limit = 2000) => Array.from(displayText(String(value ?? "").slice(0, 32768))).slice(0, limit).join("");
export const cardLabel = value => cardText(value, 128).replace(/\n/g, " ");

/** Reconstruct only the active history: abandoned branch cards are not acknowledgements. */
export function persistedMirrorIds(context, runId) {
	const ids = new Set();
	for (const entry of context?.sessionManager?.getBranch?.() ?? []) {
		if (entry.type !== "custom" || entry.customType !== TOPIC_MIRROR || entry.data?.runId !== runId) continue;
		for (const id of entry.data.messageIds ?? []) if (typeof id === "string") ids.add(id);
	}
	return ids;
}

/** Transcript-only projection. Never sends messages, wakes the model, or interprets consent. */
export function createTopicMirrors(pi, getContext) {
	return {
		refresh(snapshot) {
			const context = getContext();
			const run = snapshot?.run;
			if (!context || !run?.runId) return;
			try {
				const seen = persistedMirrorIds(context, run.runId);
				const pending = [];
				for (const message of run.messages ?? []) {
					// Real owner mail has its own context-bearing delivery and acknowledgement path.
					if (message.to === "owner" || typeof message.id !== "string" || seen.has(message.id)
						|| !message.topic && !isBoardMessage(message, run.workers)) continue;
					seen.add(message.id);
					pending.push(message);
				}
				for (let offset = 0; offset < pending.length; offset += 30) {
					const batch = pending.slice(offset, offset + 30);
					pi.appendEntry(TOPIC_MIRROR, {
						runId: run.runId, messageIds: batch.map(message => message.id),
						messages: batch.map(message => ({
							id: message.id, from: cardLabel(message.from),
							to: isBoardMessage(message, run.workers) ? "@board" : cardLabel(message.to),
							topic: cardLabel(message.topic || "Board"), cycle: message.cycle, generation: message.generation,
							text: cardText(message.text), truncated: displayText(String(message.text ?? "")).length > 2000
						}))
					});
				}
			} catch { /* Presentation failure cannot alter host lifecycle or actual mail. */ }
		},
	};
}
