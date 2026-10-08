#!/usr/bin/env node
/**
 * Usage: node docs/agents/scripts/swarm-watch.mjs /path/to/events.jsonl [--timeout SECONDS]
 * Local read-only transition monitor. No model calls, worker dispatch or writes.
 * Prints initial state and material task/lifecycle/blocker/uncertain-operation changes.
 * Ignores clock ticks and routine token-counter changes. Recorded state never proves
 * live settlement or grants consent. Requires Node and this repository's reducer.
 */
import { watch } from "node:fs";
import { inspectJournal } from "../../../packages/pi-swarm/extensions/swarm/store/journal.mjs";
import { reduceEvent } from "../../../packages/pi-swarm/extensions/swarm/state.mjs";
import { usageLimitReason } from "../../../packages/pi-swarm/extensions/swarm/usage.mjs";

const [path, flag, seconds, ...extra] = process.argv.slice(2);
const timeout = seconds === undefined ? 1800 : Number(seconds);
if (!path || extra.length || flag !== undefined && flag !== "--timeout" || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 3600) {
	console.error("Usage: node docs/agents/scripts/swarm-watch.mjs /path/to/events.jsonl [--timeout 1..3600]");
	process.exitCode = 1;
} else {
	let previous;
	let taskKeys = new Map();
	let debounce;
	const observe = () => {
		try {
			let state = null;
			for (const event of inspectJournal(path).events) state = reduceEvent(state, event);
			if (!state) throw new Error("Empty journal");
			const transition = {
				recordedOnly: true, status: state.status, guidanceRevision: state.guidanceRevision, usageBlocker: usageLimitReason(state),
				tasks: state.tasks.map(task => ({ id: task.id, status: task.status, pendingSettlement: Boolean(task.pending), blocked: Boolean(task.blocker) })),
				uncertainOperations: state.workspace?.operations.filter(operation => operation.uncertain).length ?? null,
			};
			const keys = new Map(transition.tasks.map((task, index) => [task.id, JSON.stringify([task, state.tasks[index].blocker])]));
			const signature = JSON.stringify([transition, [...keys]]);
			if (signature !== previous) {
				const changes = transition.tasks.filter(task => keys.get(task.id) !== taskKeys.get(task.id));
				console.log(JSON.stringify({ ...transition, tasks: undefined, taskChanges: changes.slice(0, 10), taskChangesTruncated: changes.length > 10, taskCount: transition.tasks.length }));
				previous = signature; taskKeys = keys;
			}
			return true;
		} catch {
			console.error("Observation unavailable; journal may be changing or incompatible. No idle/settlement conclusion.");
			return false;
		}
	};
	if (!observe()) { process.exitCode = 1; }
	else {
	const watcher = watch(path, () => {
		clearTimeout(debounce);
		debounce = setTimeout(observe, 100);
	});
	watcher.on("error", () => { console.error("Journal watch failed; no settlement conclusion."); process.exitCode = 1; watcher.close(); });
	const deadline = setTimeout(() => { clearTimeout(debounce); watcher.close(); }, timeout * 1000);
	const finish = () => { clearTimeout(deadline); clearTimeout(debounce); watcher.close(); };
	process.once("SIGINT", finish);
	process.once("SIGTERM", finish);
	}
}
