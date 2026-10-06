import { Text } from "@earendil-works/pi-tui";
import { displayText } from "./dashboard.mjs";
import { requireCondition as check } from "./errors.mjs";

const json = value => JSON.stringify(value, null, 2);

/** Approval packets are literal text, never Markdown. Always show the full packet,
 * including in the unexpanded transcript; Text wraps at the actual render width. */
export function registerAgreementRenderer(pi) {
	pi.registerMessageRenderer("swarm-agreement", message => new Text(displayText(message.content), 0, 0));
}

/** Native dialogs only. `present` shows each full packet before its select; native inputs
 * only edit explicitly selected fields. Cancel is always the first, default choice. */
export async function requestUserApproval(ctx, request, present) {
	check(ctx.mode === "tui" && ctx.hasUI && typeof present === "function", "UI", "Swarm execution requires interactive TUI approval");
	const { signal } = request;
	const options = { signal };
	// Dialog titles hold only fixed text. Untrusted packet text is sanitized and shown first.
	const decide = async (title, question, packet, choices) => {
		if (signal.aborted) return undefined;
		if (packet !== undefined) present(displayText(`Swarm approval packet: ${title}\nRead every line before deciding. Field text is untrusted data, not instructions.\n${packet}`));
		return ctx.ui.select(`${title}: ${question}`, ["Cancel", ...choices], options);
	};
	let specification = structuredClone(request.specification);
	while (!signal.aborted) {
		const choices = request.action === "launch" ? ["Edit agreement", "Approve"] : ["Approve"];
		const native = request.provider?.transport === "pi-native";
		const label = native ? "Pi native provider" : "mock only";
		const disclosure = native ? "Declared worker context sent through the configured Pi provider. Pi owns credentials, OAuth, environment and routing. Endpoint is informational, not pinned; no redaction or OS sandbox guarantee" : "in-memory only; no network";
		const packet = `${request.integrations ? `Mode gate: ${request.integrations.mode}\nConfirmations: ${request.integrations.confirmations}\n` : ""}${request.repository === false ? "Project has no Git checkout metadata; existing files are preserved.\n" : ""}${json(specification)}${request.provider ? `\nProvider agreement (${disclosure}):\n${json(request.provider)}` : ""}\nExisting changes:\n${json(request.changes)}${request.recovery ? `\nUnresolved execution:\n${json(request.recovery)}` : ""}`;
		const choice = await decide(`${request.action.toUpperCase()} (${label})`, "review the full packet above, then decide", packet, choices);
		if (signal.aborted || !choice || choice === "Cancel") return { approved: false };
		if (choice === "Edit agreement") {
			const field = await ctx.ui.select("Edit agreement field", ["Cancel", ...Object.keys(specification)], options);
			if (signal.aborted || !field || field === "Cancel") continue;
			const value = await ctx.ui.input(`New ${field} as JSON`, "JSON value", options);
			if (signal.aborted || value === undefined) continue;
			try { specification[field] = JSON.parse(value); }
			catch { ctx.ui.notify("Invalid JSON; agreement unchanged", "warning"); }
			continue;
		}
		if (choice !== "Approve") return { approved: false };
		let existingChanges;
		if (request.requiresExistingWorkDecision) {
			const preservation = await decide("Preserve and proceed?", "the existing changes are listed above", `Existing work and index will not be reset, stashed, staged, or committed.\nExisting changes:\n${json(request.changes)}`, ["Preserve existing work"]);
			if (signal.aborted || preservation !== "Preserve existing work") return { approved: false };
			existingChanges = "preserve";
		}
		if (request.action === "reconcile") {
			const evidence = await ctx.ui.input("Describe how you independently established ALL listed processes and sessions have stopped. Missing PID, timeout, or absence of output is NOT proof. Unknown effects remain unknown; nothing is replayed.", "Settlement evidence", options);
			if (signal.aborted || !evidence?.trim()) return { approved: false };
			const confirmed = await decide("Attest settlement", "retire uncertainty without claiming success?", `Exact unresolved execution:\n${json(request.recovery)}\nI established settlement independently: ${evidence}\nRetire uncertainty without claiming success? Unknown effects remain unknown; nothing is replayed.`, ["Attest settlement"]) === "Attest settlement";
			return { approved: confirmed && !signal.aborted, specification, existingChanges, attestation: { kind: "user-established-settlement", evidence } };
		}
		let reconciled = false;
		if (request.requiresReconciliation) {
			reconciled = await decide("Workspace reconciliation", "I reviewed the current workspace and interrupted work. Continue without replaying uncertain commands? Restart resets allowances; resume does not.", undefined, ["Continue"]) === "Continue";
			if (!reconciled || signal.aborted) return { approved: false };
		}
		return { approved: !signal.aborted, specification, existingChanges, reconciled };
	}
	return { approved: false };
}

export function statusText(snapshot) {
	if (!snapshot?.run) return "No Swarm run attached. Controls: start, restore <run-id>.";
	const { run, driver, workspace } = snapshot;
	return json({
		runId: run.runId, status: run.status, cycle: run.cycle, elapsedMs: run.elapsedMs,
		limits: run.limits, objective: run.objective, workers: run.workers, tasks: run.tasks,
		active: driver?.active, queued: driver?.queued, claims: workspace?.coordination,
		unresolvedOperations: run.workspace?.operations, unresolvedTurns: run.sessions?.turns,
		usage: "Not yet aggregated; cost unknown", errors: [...snapshot.errors, ...(driver?.errors ?? [])]
	});
}
