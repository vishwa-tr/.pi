import { requireCondition as check } from "./errors.mjs";

/** The main agent supplies the complete objective; the dialog only edits agreement fields. */
export async function requestLaunchSpecification(_ctx, objective, _signal, current) {
	if (!current()) return;
	check(typeof objective === "string" && objective.trim().length > 0 && objective.length <= 32768,
		"INPUT", "The main agent must supply a complete objective");
	return {
		objective,
		criteria: ["Satisfy the behavior and verification requirements in the approved objective."],
		scope: ["Work only on the requested task; honor the objective's file and dependency constraints."]
	};
}
