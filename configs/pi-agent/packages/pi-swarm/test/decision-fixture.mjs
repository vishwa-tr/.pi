import { SwarmDecision } from "../extensions/swarm/decision.mjs";

// Existing host tests script human answers; component tests exercise actual keys/rendering.
export function decisionUI(dialog, fallback) {
	return factory => new Promise((resolve, reject) => {
		const component = factory({ terminal: { rows: 24 }, requestRender() {} }, { fg: (_, text) => text }, { matches: () => false }, resolve);
		if (!(component instanceof SwarmDecision)) return fallback?.(component, resolve);
		const confirmation = ["Workspace reconciliation", "Attest settlement"].includes(component.title);
		const kind = confirmation ? "confirm" : "select";
		Promise.resolve(dialog(kind)(component.body, component.choices, { signal: component.signal })).then(answer => {
			component.finish(confirmation ? answer ? component.choices[1] : "Cancel" : answer);
		}, reject);
	});
}
