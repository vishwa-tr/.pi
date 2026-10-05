import { swarmSummary } from "./main-tools.mjs";

const terminal = status => ["completed", "failed", "stopped"].includes(status);

/** Event-driven chat observations only: no model calls, polling or execution authority. */
export function createProgress(pi, getContext) {
	let source;
	let unsubscribe;
	let timer;
	let epoch = 0;
	let disposed = false;
	let enabled = false;
	let previous;
	const notices = new Set();

	const flush = () => {
		clearTimeout(timer);
		timer = undefined;
		if (disposed || !getContext() || !enabled || !notices.size || source?.snapshot().pendingApproval) return;
		const summary = swarmSummary(source.snapshot());
		const content = `Swarm extension update: ${[...notices].join("; ")}. ` +
			`Run ${summary.status}; tasks ${summary.progress.done}/${summary.progress.total} done, ${summary.progress.blocked} blocked. ` +
			"This is a recorded Swarm observation, not independent main-agent verification or authorization.";
		notices.clear();
		// Failed presentation must never interrupt launch, cancellation or settlement.
		try { pi.sendMessage({ customType: "swarm-progress", content, display: true }, { triggerTurn: false }); }
		catch { /* No raw diagnostics in chat. */ }
	};
	const schedule = () => {
		if (timer || !notices.size || source?.snapshot().pendingApproval) return;
		const current = epoch;
		timer = setTimeout(() => { if (current === epoch) flush(); }, 750);
	};
	const refresh = () => {
		if (disposed || !getContext() || !source) return;
		const next = swarmSummary(source.snapshot());
		if (!next.progress) return;
		if (enabled && previous) {
			if (next.pendingApproval && !previous.pendingApproval) notices.add("human approval requested");
			if (next.status !== previous.status) notices.add(`run ${next.status}`);
			if (!terminal(next.status)) {
				if (next.progress.done > previous.progress.done) notices.add("task completion recorded");
				if (next.progress.blocked !== previous.progress.blocked) notices.add("task blockers changed");
			}
		}
		previous = next;
		schedule();
	};
	return {
		get disposed() { return disposed; },
		bind(host) {
			unsubscribe?.();
			epoch++;
			clearTimeout(timer);
			timer = undefined;
			notices.clear();
			previous = undefined;
			enabled = false;
			source = host;
			unsubscribe = host.subscribe(refresh);
			refresh();
		},
		launched() {
			enabled = true;
			refresh();
			// Only invoked after the approved host launch has actually returned.
			notices.add("approved launch started");
			flush();
		},
		continued() { enabled = true; notices.add("approved continuation started"); refresh(); },
		dispose() {
			disposed = true;
			epoch++;
			clearTimeout(timer);
			unsubscribe?.();
			notices.clear();
		},
	};
}
