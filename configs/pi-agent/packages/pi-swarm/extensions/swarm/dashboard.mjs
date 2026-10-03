import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// Escape terminal controls before applying trusted theme styles. Preserve ordinary Unicode.
export function displayText(value) {
	return String(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`).replace(/\t/g, "    ");
}

const sections = ["Overview", "Workers", "Tasks / review", "Claims / blockers", "Messages", "History"];
const json = value => JSON.stringify(value, null, 2);

/** Only receives read capabilities. Actions are returned to the owning command after disposal. */
export class SwarmDashboard {
	constructor({ source, tui, theme, keybindings, done, signal, schedule = setInterval, unschedule = clearInterval }) {
		Object.assign(this, { source, tui, theme, keybindings, done, signal, unschedule });
		this.section = 0;
		this.offset = 0;
		this.workerIndex = 0;
		this.closed = false;
		this.history = [];
		this.refresh();
		this.abort = () => this.finish();
		signal.addEventListener("abort", this.abort, { once: true });
		if (signal.aborted) this.finish();
		else this.timer = schedule(() => {
			if (this.closed) return;
			this.refresh();
			this.tui.requestRender();
		}, 500);
	}

	refresh() {
		if (this.closed) return;
		try {
			this.snapshot = this.source.snapshot();
			this.error = undefined;
			const workers = this.snapshot?.run?.workers ?? [];
			this.workerIndex = Math.max(0, Math.min(this.workerIndex, workers.length - 1));
			if (this.section === 5) {
				const worker = workers[this.workerIndex];
				const key = `${worker?.id}:${this.snapshot?.run?.revision}`;
				if (key !== this.historyKey) {
					this.history = worker ? this.source.history(worker.id) : [];
					this.historyKey = key;
				}
			}
		} catch {
			this.error = "Inspection unavailable; preserved evidence was not changed. Close and inspect status.";
		}
	}

	finish(action) {
		if (this.closed) return;
		this.dispose();
		this.done(action);
	}

	dispose() {
		if (this.closed) return;
		this.closed = true;
		if (this.timer !== undefined) this.unschedule(this.timer);
		this.signal.removeEventListener("abort", this.abort);
	}

	invalidate() {}

	handleInput(data) {
		if (this.closed) return;
		if (this.keybindings.matches(data, "tui.select.cancel")) return this.finish();
		const status = this.snapshot?.run?.status;
		if (data === "p") return this.finish("pause");
		if (data === "s") return this.finish("stop");
		if (data === "c") return this.finish("reconcile");
		if (data === "r" && status === "paused") return this.finish("resume");
		if (data === "R" && ["paused", "stopped", "completed", "failed"].includes(status)) return this.finish("restart");
		if (/^[1-6]$/.test(data)) { this.section = Number(data) - 1; this.offset = 0; }
		else if (this.section === 1 && (matchesKey(data, "left") || matchesKey(data, "right"))) {
			this.workerIndex += matchesKey(data, "left") ? -1 : 1;
			this.offset = 0;
		} else if (this.section === 1 && this.keybindings.matches(data, "tui.select.confirm")) {
			this.section = 5; this.offset = 0;
		} else if (this.keybindings.matches(data, "tui.select.up")) this.offset--;
		else if (this.keybindings.matches(data, "tui.select.down")) this.offset++;
		else if (this.keybindings.matches(data, "tui.select.pageUp")) this.offset -= this.pageSize ?? 1;
		else if (this.keybindings.matches(data, "tui.select.pageDown")) this.offset += this.pageSize ?? 1;
		else if (matchesKey(data, "home")) this.offset = 0;
		else if (matchesKey(data, "end")) this.offset = Number.MAX_SAFE_INTEGER;
		this.refresh();
		this.tui.requestRender();
	}

	body() {
		const { run, driver, workspace, errors = [] } = this.snapshot ?? {};
		if (!run) return "No run attached. Close and use /swarm start <goal> or restore <run-id>.";
		if (this.error) return this.error;
		const worker = run.workers[this.workerIndex];
		switch (this.section) {
			case 0: return `Objective: ${run.objective}\nCycle: ${run.cycle} | revision: ${run.revision}\nRecorded active time: ${run.elapsedMs} ms\nWorkers: ${run.workers.length}/${run.limits.agents} | active: ${driver?.active.length ?? "unknown"}/${run.limits.active}\nTasks this cycle: ${run.tasksCreated}/${run.limits.tasks}\nUsage: not aggregated | cost: unknown\nLimits: ${json(run.limits)}\n${json({ runId: run.runId, criteria: run.criteria, scope: run.scope, priorCycles: run.cycles, pendingApproval: this.snapshot.pendingApproval, errors: [...errors, ...(driver?.errors ?? [])] })}`;
			case 1: return run.workers.length ? run.workers.map((item, index) => {
				const activity = !driver ? "activity unknown" : driver.active.includes(item.id) ? "active SDK turn" : driver.queued.includes(item.id) ? "queued" : "idle / not executing";
				const tasks = run.tasks.filter(task => task.assignment?.workerId === item.id).map(task => task.id);
				return `${index === this.workerIndex ? ">" : " "} ${item.id}: ${activity}\nFocus: ${item.specialization}\nAssigned tasks: ${tasks.join(", ") || "none"}\nBrief: ${item.brief}`;
			}).join("\n\n") + "\nLeft/right selects worker; Enter opens history." : "No specialists recruited.";
			case 2: return run.tasks.length ? json(run.tasks) : "No tasks recorded. A submission is not an independent review.";
			case 3: return json({ coordination: workspace?.coordination, blockedTasks: run.tasks.filter(task => task.status === "blocked"), unresolvedOperations: run.workspace?.operations, unresolvedTurns: run.sessions?.turns });
			case 4: return run.messages?.length ? json(run.messages) : "No peer messages recorded.";
			case 5: return `Worker: ${worker?.id ?? "none"}\nNative persisted history (all entries, including compaction; in-flight text may lag)\n${this.history.length ? this.history.map(entry => json(entry)).join("\n\n") : "No persisted history yet."}`;
		}
	}

	render(width) {
		if (width <= 0) return [""];
		const status = this.snapshot?.run?.status ?? "unattached";
		const continuation = status === "paused" ? "r resume | R restart" : ["stopped", "completed", "failed"].includes(status) ? "R restart" : "";
		const transport = this.snapshot?.run?.hostApprovals?.at(-1)?.provider?.transport;
		const providerLabel = transport === "pi-native" ? "Pi native provider" : transport === "https-chat-completions" ? "HTTPS provider" : "mock only";
		const header = [
			`SWARM live / ${providerLabel} | ${status}`,
			"p PAUSE | s STOP | Esc close",
			`${continuation}${continuation ? " | " : ""}c reconcile (approval required)`,
			"1 Overview  2 Workers  3 Tasks  4 Claims  5 Mail  6 History",
			`${sections[this.section]} | arrows/PgUp/PgDn scroll`,
		];
		const lines = displayText(this.body()).split("\n").flatMap(line => wrapTextWithAnsi(line, width));
		this.pageSize = Math.max(1, Math.min(18, (this.tui.terminal.rows ?? 24) - header.length - 5));
		this.offset = Math.max(0, Math.min(this.offset, Math.max(0, lines.length - this.pageSize)));
		const page = lines.slice(this.offset, this.offset + this.pageSize);
		const footer = `${this.offset + 1}-${Math.min(lines.length, this.offset + this.pageSize)} / ${lines.length} lines`;
		return [...header, ...page, footer].map((line, index) => {
			const bounded = truncateToWidth(displayText(line), width, "");
			return this.theme.fg(index === 1 ? "warning" : index < header.length ? "accent" : "text", bounded);
		});
	}
}

export async function showDashboard(ctx, source, signal, onMount = () => {}) {
	let component;
	try {
		return await ctx.ui.custom((tui, theme, keybindings, done) => {
			onMount();
			component = new SwarmDashboard({ source, tui, theme, keybindings, done, signal });
			return component;
		});
	} finally { component?.dispose(); }
}
