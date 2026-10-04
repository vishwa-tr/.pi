const validText = value => typeof value === "string" && value.trim().length > 0 && value.length <= 32768;

/** Seed editable agreement fields without model work or redundant launch questions. */
export async function requestLaunchSpecification(ctx, objective, signal, current) {
	let value = objective.trim() ? objective : undefined;
	while (current()) {
		if (value === undefined) value = await ctx.ui.input("Swarm objective", "Describe the goal", { signal });
		if (!current() || value === undefined) return;
		if (validText(value)) return {
			objective: value,
			criteria: ["Satisfy the behavior and verification requirements in the approved objective."],
			scope: ["Work only on the requested task; honor the objective's file and dependency constraints."],
		};
		ctx.ui.notify("Enter a non-empty objective (maximum 32768 characters). Escape cancels.", "warning");
		value = undefined;
	}
}
