const validText = value => typeof value === "string" && value.trim().length > 0 && value.length <= 32768;

/** Collect required fields before binding a host; every await rechecks command ownership. */
export async function requestLaunchSpecification(ctx, objective, signal, current) {
	objective = await promptField(ctx, "Swarm objective", "Describe the goal", objective || undefined, false, signal, current);
	if (objective === undefined) return;
	const criteria = await promptField(ctx, "Acceptance criteria (one outcome or JSON array)", 'Tests pass, or ["Tests pass", "No regressions"]', undefined, true, signal, current);
	if (criteria === undefined) return;
	const scope = await promptField(ctx, "Scope and exclusions (one description or JSON array)", 'Only src; no deployment, or ["src", "No deployment"]', undefined, true, signal, current);
	if (scope === undefined) return;
	return { objective, criteria, scope };
}

async function promptField(ctx, title, placeholder, initial, list, signal, current) {
	let value = initial;
	while (current()) {
		if (value === undefined) value = await ctx.ui.input(title, placeholder, { signal });
		if (!current() || value === undefined) return;
		const parsed = list ? parseList(value) : value;
		if (list ? Array.isArray(parsed) && parsed.length > 0 && parsed.every(validText) : validText(parsed)) return parsed;
		ctx.ui.notify(list
			? "Enter one non-empty description or a JSON array of non-empty strings (maximum 32768 characters each). Escape cancels."
			: "Enter a non-empty objective (maximum 32768 characters). Escape cancels.", "warning");
		value = undefined;
	}
}

function parseList(value) {
	if (!value.trim()) return;
	try { return JSON.parse(value); }
	catch {
		// Never silently turn a malformed JSON array/object/string into approved scope.
		if (/^[\[{"]/.test(value.trimStart())) return;
		return [value];
	}
}
