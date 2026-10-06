import { transcriptText } from "./transcript.mjs";
import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// Escape terminal controls before applying trusted theme styles. Preserve ordinary Unicode.
export function displayText(value) {
	return String(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`).replace(/\t/g, "    ");
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
		this.query = "";
		this.follow = false;
		this.refresh();
		this.abort = () => this.finish();
		signal.addEventListener("abort", this.abort, { once: true });
		if (signal.aborted) queueMicrotask(this.abort);
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
			const retained = workers.findIndex(worker => worker.id === this.workerId);
			this.workerIndex = retained >= 0 ? retained : Math.max(0, Math.min(this.workerIndex, workers.length - 1));
			this.workerId = workers[this.workerIndex]?.id;
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
		this.done(this.signal.aborted ? undefined : action);
	}

	dispose() {
		if (this.closed) return;
		this.closed = true;
		if (this.timer !== undefined) this.unschedule(this.timer);
		this.signal.removeEventListener("abort", this.abort);
	}

	invalidate() { }

	handleInput(data) {
		if (this.closed) return;
		// Bracketed paste is data, never a command, even when delivered in chunks.
		if (data.includes("\x1b[200~") || this.pasting) {
			this.pasting = !data.includes("\x1b[201~");
			if (this.searching) this.draft += displayText(data.replace(/\x1b\[20[01]~/g, "")).replace(/\n/g, " ");
			this.tui.requestRender();
			return;
		}
		if (this.searching) {
			if (matchesKey(data, "escape")) this.searching = false;
			else if (matchesKey(data, "return")) {
				this.query = this.draft;
				this.searching = false;
				this.seekMatch(1, true);
			} else if (matchesKey(data, "backspace")) this.draft = Array.from(this.draft).slice(0, -1).join("");
			else if (!/[\x00-\x1f\x7f-\x9f]/.test(data)) this.draft += displayText(data);
			this.tui.requestRender();
			return;
		}
		if (data === "?" || (this.help && (data === "q" || matchesKey(data, "escape")))) {
			this.help = !this.help;
			if (this.help) { this.savedOffset = this.offset; this.offset = 0; }
			else this.offset = this.savedOffset;
			this.tui.requestRender();
			return;
		}
		if (this.help) {
			if (data === "j" || matchesKey(data, "down")) this.offset++;
			else if (data === "k" || matchesKey(data, "up")) this.offset--;
			else if (matchesKey(data, "pageDown") || matchesKey(data, "ctrl+d")) this.offset += this.pageSize ?? 1;
			else if (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+u")) this.offset -= this.pageSize ?? 1;
			else if (data === "G" || matchesKey(data, "end")) this.offset = Number.MAX_SAFE_INTEGER;
			else if (data === "g" || matchesKey(data, "home")) this.offset = 0;
			this.tui.requestRender();
			return;
		}
		if (data === "q" || this.keybindings.matches(data, "tui.select.cancel")) {
			if (this.section === 5) this.openSection(1);
			else return this.finish();
		} else if (data === "/" && this.section === 5) {
			this.searching = true; this.draft = "";
		} else if ((data === "n" || data === "N") && this.section === 5) this.seekMatch(data === "n" ? 1 : -1);
		else if (data === "f" && this.section === 5) this.follow = !this.follow;
		if (/^[1-6]$/.test(data)) this.openSection(Number(data) - 1);
		else if (matchesKey(data, "tab") || data === "l") this.openSection((this.section + 1) % sections.length);
		else if (data === "h") this.openSection(this.section === 5 ? 1 : Math.max(0, this.section - 1));
		else if (data === "c" || (this.section === 1 && this.keybindings.matches(data, "tui.select.confirm"))) this.openSection(5);
		else if (this.section === 1 && (data === "j" || data === "k" || matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "up") || matchesKey(data, "down"))) {
			const direction = data === "k" || matchesKey(data, "left") || matchesKey(data, "up") ? -1 : 1;
			this.workerIndex = Math.max(0, Math.min(this.workerIndex + direction, (this.snapshot?.run?.workers.length ?? 1) - 1));
			this.workerId = this.snapshot?.run?.workers[this.workerIndex]?.id;
			this.revealWorker = true;
		} else if (data === "k" || this.keybindings.matches(data, "tui.select.up")) this.scroll(-1);
		else if (data === "j" || this.keybindings.matches(data, "tui.select.down")) this.scroll(1);
		else if (matchesKey(data, "ctrl+u")) this.scroll(-Math.max(1, Math.floor((this.pageSize ?? 2) / 2)));
		else if (matchesKey(data, "ctrl+d")) this.scroll(Math.max(1, Math.floor((this.pageSize ?? 2) / 2)));
		else if (this.keybindings.matches(data, "tui.select.pageUp")) this.scroll(-(this.pageSize ?? 1));
		else if (this.keybindings.matches(data, "tui.select.pageDown")) this.scroll(this.pageSize ?? 1);
		else if (matchesKey(data, "home") || (data === "g" && this.lastKey === "g")) { this.offset = 0; this.follow = false; }
		else if (matchesKey(data, "end") || data === "G") { this.offset = Number.MAX_SAFE_INTEGER; this.follow = false; }
		this.lastKey = data === "g" && this.lastKey !== "g" ? "g" : undefined;
		this.refresh();
		this.tui.requestRender();
	}

	openSection(section) {
		this.section = section;
		this.offset = 0;
		this.query = "";
		this.matchOffset = undefined;
		this.follow = false;
		this.revealWorker = section === 1;
	}

	scroll(amount) { this.offset += amount; this.follow = false; this.matchOffset = undefined; }

	seekMatch(direction, first = false) {
		if (!this.query || !this.lines) return;
		const query = this.query.toLocaleLowerCase();
		const matches = [];
		let row = 0;
		for (const logicalLine of displayText(this.body()).split("\n")) {
			const wrapped = wrapTextWithAnsi(logicalLine, this.width ?? 80);
			const searchable = logicalLine.toLocaleLowerCase();
			const position = searchable.indexOf(query);
			if (position >= 0) {
				// Map the actual wrapped rows back to the sanitized source. Wrapping a
				// prefix loses word-wrap decisions, wide graphemes and exact boundaries.
				let end = 0;
				let matchRow = wrapped.length - 1;
				for (let index = 0; index < wrapped.length; index++) {
					const text = wrapped[index].toLocaleLowerCase();
					end = searchable.indexOf(text, end) + text.length;
					if (position < end) { matchRow = index; break; }
				}
				matches.push(row + matchRow);
			}
			row += wrapped.length;
		}
		this.matchCount = matches.length;
		if (!matches.length) return;
		this.follow = false;
		const anchor = first ? -1 : this.matchOffset ?? this.offset;
		this.offset = first ? matches[0] : direction > 0 ? matches.find(index => index > anchor) ?? matches[0] : matches.findLast(index => index < anchor) ?? matches.at(-1);
		this.matchOffset = this.offset;
	}

	body() {
		const { run, driver, workspace, errors = [] } = this.snapshot ?? {};
		if (!run) return "No run attached. Ask the main agent to start or restore Swarm.";
		if (this.error) return this.error;
		const worker = run.workers[this.workerIndex];
		switch (this.section) {
			case 0: return `Objective: ${run.objective}\nCycle: ${run.cycle} | revision: ${run.revision}\nRecorded active time: ${run.elapsedMs} ms\nRemaining: ${Number.isFinite(run.limits.durationMs) ? Math.max(0, run.limits.durationMs - run.elapsedMs) + " ms" : "unknown"}\nWorkers: ${run.workers.length}/${run.limits.agents} | active: ${driver?.active.length ?? "unknown"}/${run.limits.active}\nTasks this cycle: ${run.tasksCreated}/${run.limits.tasks}\nUsage: not aggregated | cost: unknown\nModel: ${run.sessions?.selection?.provider ?? "unknown"}/${run.sessions?.selection?.modelId ?? "unknown"} · thinking ${run.sessions?.selection?.thinkingLevel ?? "unknown"}\nLimits: ${json(run.limits)}\n${json({ runId: run.runId, criteria: run.criteria, scope: run.scope, priorCycles: run.cycles, pendingApproval: this.snapshot.pendingApproval, errorCount: errors.length + (driver?.errors?.length ?? 0) })}`;
			case 1: return run.workers.length ? run.workers.map((item, index) => {
				const activity = !driver ? "activity unknown" : driver.active.includes(item.id) ? "active SDK turn" : driver.queued.includes(item.id) ? "queued" : "idle / not executing";
				const tasks = run.tasks.filter(task => task.assignment?.workerId === item.id).map(task => task.id);
				return `${index === this.workerIndex ? ">" : " "} ${item.id}: ${activity}\nFocus: ${item.specialization}\nAssigned tasks: ${tasks.join(", ") || "none"}\nBrief: ${item.brief}`;
			}).join("\n\n") + "\nj/k selects worker; Enter or c opens conversation." : "No specialists recruited.";
			case 2: return run.tasks.length ? run.tasks.map(task => taskText(task, run)).join("\n\n") : "No tasks recorded. A submission is not an independent review.";
			case 3: return json({ coordination: workspace?.coordination, blockedTasks: run.tasks.filter(task => task.status === "blocked"), unresolvedOperations: run.workspace?.operations, unresolvedTurns: run.sessions?.turns });
			case 4: return run.messages?.length ? run.messages.map(message => `${message.from} → ${message.to} · cycle ${message.cycle}\n${message.text}`).join("\n\n") : "No peer messages recorded.";
			case 5: return `Worker: ${worker?.id ?? "none"} · ${worker?.specialization ?? ""}\nNative persisted history · in-flight text may lag\n${this.history.length ? transcriptText(this.history, { usageAvailable: run.hostApprovals?.at(-1)?.provider?.transport === "pi-native" }) : "No persisted history yet. Pending output is not a token stream."}`;
		}
	}

	render(width) {
		if (width <= 0) return [""];
		this.width = width;
		if ((this.tui.terminal.rows ?? 24) < 12) return [truncateToWidth("Resize terminal; q/Esc back. /swarm stop is the emergency brake.", width, "")];
		const status = this.snapshot?.run?.status ?? "unattached";
		const transport = this.snapshot?.run?.hostApprovals?.at(-1)?.provider?.transport;
		const providerLabel = !this.snapshot?.run ? "not selected" : transport === "pi-native" ? "Pi native provider" : "mock only";
		const header = [
			`SWARM live / ${providerLabel} | ${status}`,
			this.searching ? "SEARCH · Enter find | Esc cancel" : this.help ? "HELP · j/k scroll | ? back" : `Read-only | q/Esc ${this.section === 5 ? "back" : "close"}`,
			"Ask the main agent for controls; /swarm stop stops immediately",
			"1 Overview  2 Workers  3 Tasks  4 Claims  5 Mail  6 History",
			this.section === 5 ? "Conversation | / search | n/N match | f follow | ? help" : `${sections[this.section]} | ? help | j/k move | Tab pane`,
		];
		const help = "NAVIGATION\nj/k or arrows: workers / scroll\nh/l: previous / next pane; Tab: next pane\ngg/G or Home/End: top / bottom\nCtrl-u/d: half page; PgUp/PgDn: page\nEnter on worker or c: conversation\nq/Esc: conversation back; otherwise close\nCONVERSATION\n/: local literal search; Enter applies; Esc cancels\nEmpty search clears; n/N: next / previous match\nf: toggle follow tail; scrolling stops following\nCONTROL\nAsk the main agent to change Swarm state.\nClose this view and use /swarm stop for an emergency stop.\nCtrl-c: unchanged Pi global control\nInspection never starts a worker. ? closes help.";
		const lines = displayText(this.help ? help : this.body()).split("\n").flatMap(line => wrapTextWithAnsi(line, width));
		this.lines = lines;
		this.pageSize = Math.max(1, Math.min(18, (this.tui.terminal.rows ?? 24) - header.length - 5));
		if (this.section === 1 && this.revealWorker) {
			const selected = lines.findIndex(line => line.startsWith("> "));
			if (selected >= 0) this.offset = selected;
			this.revealWorker = false;
		}
		if (this.follow && this.section === 5 && !this.help) this.offset = lines.length;
		this.offset = Math.max(0, Math.min(this.offset, Math.max(0, lines.length - this.pageSize)));
		const page = lines.slice(this.offset, this.offset + this.pageSize);
		if (this.query && !this.help) {
			this.matchCount = displayText(this.body()).split("\n").filter(line => line.toLocaleLowerCase().includes(this.query.toLocaleLowerCase())).length;
		}
		const footer = this.searching ? `/${this.draft} | Enter find · Esc cancel` : `${this.offset + 1}-${Math.min(lines.length, this.offset + this.pageSize)} / ${lines.length} lines${this.section === 5 ? ` | follow ${this.follow ? "ON" : "off"}` : ""}${this.query ? ` | /${this.query}: ${this.matchCount ?? 0} matches` : ""}`;
		return [...header, ...page, footer].map((line, index) => {
			const bounded = truncateToWidth(displayText(line), width, "");
			const matched = this.query && index >= header.length && index < header.length + page.length && line.toLocaleLowerCase().includes(this.query.toLocaleLowerCase());
			return this.theme.fg(index === 1 || matched ? "warning" : index < header.length ? "accent" : "text", bounded);
		});
	}
}

function taskText(task, run) {
	const dependencies = (task.dependencies ?? []).filter(id => run.tasks.find(item => item.id === id)?.status !== "done");
	const attemptsExhausted = task.failures >= run.limits.attempts;
	const waiting = task.blocker ?? (dependencies.join(", ") || (task.status === "submitted" ? "independent review" : "none recorded"));
	return [
		`${task.id} · ${task.status} · ${task.title ?? ""}`,
		`Acceptance: ${(task.criteria ?? []).map(index => run.criteria?.[index] ?? index).join("; ")}`,
		`Owner: ${task.assignment?.workerId ?? "unassigned"} · ${task.assignment?.kind ?? "no assignment"}`,
		`Waiting for: ${waiting}`,
		attemptsExhausted ? "Action: attempt limit reached; user direction required." : task.status === "interrupted" ? "Action: establish settlement before approved continuation." : "",
		`Attempts failed: ${task.failures ?? 0}/${run.limits.attempts ?? "unknown"}`,
		`Candidate: ${task.candidate ?? "none"}`,
		`Review / pending / evidence:\n${json({ reviews: task.reviews, pending: task.pending, failures: task.failureHistory })}`,
	].join("\n");
}

export async function showDashboard(ctx, source, signal, onMount = () => { }) {
	if (signal.aborted) return undefined;
	let component;
	try {
		return await ctx.ui.custom((tui, theme, keybindings, done) => {
			onMount();
			component = new SwarmDashboard({ source, tui, theme, keybindings, done, signal });
			return component;
		}, { overlay: true, overlayOptions: { width: "100%", anchor: "center" } });
	} finally { component?.dispose(); }
}
