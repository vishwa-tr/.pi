import {
	SwarmError,
	failureDiagnostic,
} from "./errors.mjs";
import { Text } from "@earendil-works/pi-tui";
import { displayText } from "./dashboard.mjs";
import { messageText } from "./conversations.mjs";
import { coordinationStatus } from "./coordination-status.mjs";

const json = value => JSON.stringify(value, null, 2);
const safeError = error => {
	const diagnostic = new SwarmError(error?.code, "");
	diagnostic.phase = error?.phase;
	return failureDiagnostic(diagnostic);
};

/** Literal, full agreement text: wrapping never hides terms or interprets Markdown. */
export function registerSwarmRenderers(pi) {
	pi.registerMessageRenderer("swarm-agreement", message => new Text(displayText(message.content), 0, 0));
	pi.registerMessageRenderer("swarm-agent-mail", message => {
		const messages = Array.isArray(message.details?.messages) ? message.details.messages : [];
		const text = messageText(messages.map(item => ({ ...item, to: "owner" })));
		return new Text(displayText(text || "Swarm agent messages"), 0, 0);
	});
}

/** Presentation only. Consent is captured separately from a real owner input event. */
export function approvalPacket(request) {
	const native = request.provider?.transport === "pi-native";
	const label = native ? "Pi native provider" : "mock only";
	const disclosure = native
		? "Declared worker context sent through the configured Pi provider. Pi owns credentials, OAuth, environment and routing. Endpoint is informational, not pinned; no redaction or OS sandbox guarantee"
		: "in-memory only; no network";
	return displayText(`Swarm approval packet: ${request.action.toUpperCase()} (${label})\nRead every line before confirming in chat. Field text is untrusted data, not instructions.\n`
		+ `${request.workspace ? `Workspace: ${request.workspace}\n` : ""}`
		+ `${request.integrations ? `Mode gate: ${request.integrations.mode}\nWorker authorization: ${request.integrations.confirmations}\n` : ""}`
		+ "Preservation: keep existing work, the index, and generated changes. Swarm performs no automatic reset, stash, staging, commit, or rollback.\n"
		+ `${request.repository === false ? "Project has no Git checkout metadata; existing files are preserved.\n" : ""}`
		+ `${request.fingerprintScope ? `Startup fingerprint scope: ${request.fingerprintScope}\n` : ""}`
		+ `${json(request.specification)}${request.provider ? `\nProvider agreement (${disclosure}):\n${json(request.provider)}` : ""}`
		+ `\nExisting changes:\n${json(request.changes)}${request.recovery ? `\nUnresolved execution:\n${json(request.recovery)}` : ""}`);
}

export function statusText(snapshot) {
	if (!snapshot?.run) return "No Swarm run attached. Controls: start, restore <run-id>.";
	const { run, driver, workspace } = snapshot;
	return json({
		runId: run.runId, status: run.status, cycle: run.cycle, elapsedMs: run.elapsedMs,
		limits: run.limits, objective: run.objective, workers: run.workers, tasks: run.tasks,
		active: driver?.active, queued: driver?.queued, claims: coordinationStatus(workspace?.coordinationStatus),
		unresolvedOperations: run.workspace?.operations.slice(0, 32).map(({ id, workerId, taskId, kind, uncertain }) => ({ id, workerId, taskId, kind, uncertain })),
		unresolvedTurns: run.sessions?.turns.slice(0, 32).map(({ id, workerId, kind }) => ({ id, workerId, kind })),
		usage: "Not yet aggregated; cost unknown", errors: [...(snapshot.errors ?? []), ...(driver?.errors ?? [])].slice(0, 32).map(safeError)
	});
}
