#!/usr/bin/env node
/**
 * Read a consistent, integrity-checked journal with the repository's pure reducer.
 * Usage: node docs/agents/scripts/swarm-run-observation.mjs /path/to/events.jsonl
 * No model calls, ownership changes, worker dispatch or writes. Keep output local.
 * Recorded state is not live SDK/process settlement evidence or authorization.
 * An actively changing/incompatible journal may fail inspection; never infer idle.
 */
import { inspectJournal } from "../../../packages/pi-swarm/extensions/swarm/store/journal.mjs";
import { reduceEvent } from "../../../packages/pi-swarm/extensions/swarm/state.mjs";

const [journal, ...extra] = process.argv.slice(2);
if (!journal || extra.length) {
	console.error("Usage: node docs/agents/scripts/swarm-run-observation.mjs /path/to/events.jsonl");
	process.exitCode = 1;
} else {
	try {
		const { events } = inspectJournal(journal);
		let state = null;
		for (const event of events) state = reduceEvent(state, event);
		if (!state) throw new Error("Empty journal");
		console.log(JSON.stringify({
			recordedOnly: true, liveSettlementVerified: false,
			status: state.status, revision: state.revision, sampledAtMs: state.lastAtMs,
			elapsedMs: state.elapsedMs, limits: state.limits,
			workers: state.workers.map(worker => worker.id),
			tasks: state.tasks.map(task => ({ id: task.id, status: task.status,
				assignedWorker: task.assignment?.workerId ?? null, failures: task.failures,
				pendingSettlement: Boolean(task.pending), hasBlocker: Boolean(task.blocker) })),
			turns: state.sessions?.turns.length ?? null,
			operations: state.workspace?.operations.length ?? null,
			uncertainOperations: state.workspace?.operations.filter(operation => operation.uncertain).length ?? null,
			messageCount: state.messages.length,
		}, null, 2));
	} catch {
		console.error("Journal observation failed: unreadable, changing or incompatible data. No settlement conclusion is available.");
		process.exitCode = 1;
	}
}
