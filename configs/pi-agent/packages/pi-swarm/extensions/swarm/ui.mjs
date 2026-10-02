import { requireCondition as check } from "./errors.mjs";

const json = value => JSON.stringify(value, null, 2);

/** Native dialogs own rendering, keyboard handling, and signal-driven dismissal. */
export async function requestUserApproval(ctx, request) {
	check(ctx.mode === "tui" && ctx.hasUI, "UI", "Swarm execution requires interactive TUI approval");
	const { signal } = request;
	const options = { signal };
	let specification = structuredClone(request.specification);
	while (!signal.aborted) {
		const choices = request.action === "launch" ? ["Cancel", "Edit agreement", "Approve"] : ["Cancel", "Approve"];
		const network = request.provider?.transport === "https-chat-completions";
		const disclosure = network ? "HTTPS; declared context sent to the exact endpoint" : "in-memory only; no network";
		const summary = `${request.action.toUpperCase()} (${network ? "HTTPS provider" : "mock only"})\n${json(specification)}${request.provider ? `\nProvider agreement (${disclosure}):\n${json(request.provider)}` : ""}\nExisting changes:\n${json(request.changes)}${request.recovery ? `\nUnresolved execution:\n${json(request.recovery)}` : ""}`;
		const choice = await ctx.ui.select(summary, choices, options);
		if (signal.aborted || !choice || choice === "Cancel") return { approved: false };
		if (choice === "Edit agreement") {
			const field = await ctx.ui.select("Edit agreement field", ["Cancel", ...Object.keys(specification)], options);
			if (signal.aborted || !field || field === "Cancel") continue;
			const value = await ctx.ui.input(`New ${field} as JSON (current: ${JSON.stringify(specification[field])})`, "JSON value", options);
			if (signal.aborted || value === undefined) continue;
			try { specification[field] = JSON.parse(value); }
			catch { ctx.ui.notify("Invalid JSON; agreement unchanged", "warning"); }
			continue;
		}
		if (choice !== "Approve") return { approved: false };
		let existingChanges;
		if (request.requiresExistingWorkDecision) {
			const preservation = await ctx.ui.select("Existing work and index will not be reset, stashed, staged, or committed. Preserve and proceed?", ["Cancel", "Preserve existing work"], options);
			if (signal.aborted || preservation !== "Preserve existing work") return { approved: false };
			existingChanges = "preserve";
		}
		if (request.action === "reconcile") {
			const evidence = await ctx.ui.input("Describe how you independently established ALL listed processes and sessions have stopped. Missing PID, timeout, or absence of output is NOT proof. Unknown effects remain unknown; nothing is replayed.", "Settlement evidence", options);
			if (signal.aborted || !evidence?.trim()) return { approved: false };
			const confirmed = await ctx.ui.confirm("Attest settlement", `I established settlement independently: ${evidence}\nRetire uncertainty without claiming success?`, options);
			return { approved: confirmed && !signal.aborted, specification, existingChanges, attestation: { kind: "user-established-settlement", evidence } };
		}
		let reconciled = false;
		if (request.requiresReconciliation) {
			reconciled = await ctx.ui.confirm("Workspace reconciliation", "I reviewed the current workspace and interrupted work. Continue without replaying uncertain commands? Restart resets allowances; resume does not.", options);
			if (!reconciled || signal.aborted) return { approved: false };
		}
		return { approved: !signal.aborted, specification, existingChanges, reconciled };
	}
	return { approved: false };
}

export function statusText(snapshot) {
	if (!snapshot?.run) return "No Swarm run attached. Controls: start, restore <run-id>.";
	const { run, driver, workspace } = snapshot;
	return json({ runId: run.runId, status: run.status, cycle: run.cycle, elapsedMs: run.elapsedMs,
		limits: run.limits, objective: run.objective, workers: run.workers, tasks: run.tasks,
		active: driver?.active, queued: driver?.queued, claims: workspace?.coordination,
		unresolvedOperations: run.workspace?.operations, unresolvedTurns: run.sessions?.turns,
		usage: "Not yet aggregated; cost unknown", errors: [...snapshot.errors, ...(driver?.errors ?? [])] });
}
