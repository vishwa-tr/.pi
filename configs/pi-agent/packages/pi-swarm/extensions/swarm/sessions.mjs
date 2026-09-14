import { createHash, randomUUID } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { requireCondition as check } from "./errors.mjs";
import { privateDirectory } from "./store/files.mjs";
import { createSdkSession } from "./sdk-session.mjs";
import { makeSessionTools } from "./session-tools.mjs";
import { buildSpecialistPrompt, buildTurnPrompt } from "./specializations.mjs";
import { pendingMail, sessionWorker } from "./session-state.mjs";

const attached = new WeakSet();
const terminal = new Set(["paused", "stopped", "completed", "failed"]);
const draining = new Set(["pausing", "stopping", "failing"]);

/** Host-only offline SDK integration. There is deliberately no extension entry point. */
export class SwarmSessions {
	static async attach(controller, { workspace, modelRuntime, mainModel, thinkingLevel = "off", override, codingTools = ["read", "edit", "write", "bash"], instructions = "", tickIntervalMs = 1000, admission } = {}) {
		controller.assertOwned();
		check(!attached.has(controller), "OWNERSHIP", "Controller already has an SDK driver");
		const state = controller.snapshot();
		check(state.workspace && workspace && (terminal.has(state.status) || draining.has(state.status)), "STATE", "Attach to a paused, workspace-enabled controller");
		const selected = override?.model ?? mainModel;
		const selection = state.sessions?.selection ?? { provider: selected?.provider, modelId: selected?.id, thinkingLevel: override?.thinkingLevel ?? thinkingLevel };
		const model = modelRuntime?.getModel(selection.provider, selection.modelId);
		check(selection.provider === "swarm-mock" && model?.api === "swarm-mock", "MODEL", "Live model execution is disabled in phase 3");
		check(Number.isSafeInteger(tickIntervalMs) && tickIntervalMs >= 0, "INPUT", "Invalid tick interval");
		makeSessionTools(async () => {}, state.sessions?.codingTools ?? codingTools);
		attached.add(controller);
		try {
			if (!state.sessions) await controller.owner("sessions.configure", { selection, instructions, codingTools });
			return new SwarmSessions(controller, workspace, modelRuntime, tickIntervalMs, admission);
		} catch (error) {
			attached.delete(controller);
			throw error;
		}
	}

	#controller;
	#workspace;
	#modelRuntime;
	#admission;
	#sessionDir;
	#entries = new Map();
	#queue = new Map();
	#active = new Map();
	#errors = [];
	#timer;
	#closed = false;
	#pumpQueued = false;
	#drain = null;

	constructor(controller, workspace, modelRuntime, tickIntervalMs, admission) {
		this.#controller = controller;
		this.#workspace = workspace;
		this.#modelRuntime = modelRuntime;
		this.#admission = admission;
		const state = controller.snapshot();
		this.#sessionDir = join(state.workspaceRoot, ".swarms", state.runId, "sessions");
		privateDirectory(this.#sessionDir);
		if (tickIntervalMs) {
			this.#timer = setInterval(() => {
				if (["running", "verifying"].includes(this.#controller.snapshot().status)) void this.tick().catch(error => this.#recordError(error));
			}, tickIntervalMs);
			this.#timer.unref();
		}
	}

	snapshot() {
		return { queued: [...this.#queue.keys()], active: [...this.#active.keys()], errors: [...this.#errors], sessions: this.#controller.snapshot().sessions };
	}

	#recordError(error) {
		this.#errors.push({ code: error.code ?? "SDK", message: error.message });
	}

	async #entry(workerId) {
		if (this.#entries.has(workerId)) return this.#entries.get(workerId).ready;
		const worker = this.#controller.snapshot().workers.find(worker => worker.id === workerId);
		check(worker, "NOT_FOUND", "Worker does not exist");
		const entry = { workerId, active: null };
		this.#entries.set(workerId, entry);
		entry.ready = (async () => {
			const state = this.#controller.snapshot();
			const binding = sessionWorker(state, workerId);
			const tools = makeSessionTools((name, params, call) => this.#invoke(entry, name, params, call), state.sessions.codingTools);
			const created = await createSdkSession({
				cwd: state.workspaceRoot, sessionDir: this.#sessionDir,
				sessionFile: binding ? join(this.#sessionDir, binding.sessionFile) : undefined,
				modelRuntime: this.#modelRuntime, selection: state.sessions.selection,
				systemPrompt: buildSpecialistPrompt(state, worker), customTools: tools,
			});
			Object.assign(entry, created);
			if (binding) check(created.sessionId === binding.sessionId, "IDENTITY", "Persisted specialist identity changed");
			else await this.#controller.system("session.bind", { workerId, sessionId: created.sessionId, sessionFile: basename(created.sessionFile) });
			return entry;
		})().catch(error => {
			entry.session?.dispose();
			this.#entries.delete(workerId);
			throw error;
		});
		return entry.ready;
	}

	#guard(entry, signal) {
		this.#admission?.assert();
		this.#controller.assertOwned();
		const turn = entry.active;
		const state = this.#controller.snapshot();
		check(turn && !turn.signal.aborted && !signal?.aborted && state.status === "running", "FENCED", "Specialist turn is not active");
		check(turn.cycle === state.cycle && turn.generation === state.generation && turn.guidanceRevision === state.guidanceRevision, "FENCED", "Specialist context changed");
		check(state.sessions.turns.some(item => item.id === turn.id && item.kind === "prompt"), "FENCED", "Prompt turn has not been admitted");
		return state;
	}

	async #invoke(entry, name, params, { toolCallId, signal }) {
		const state = this.#guard(entry, signal);
		const turn = entry.active;
		const operationId = createHash("sha256").update(`${entry.sessionId}:${turn.id}:${toolCallId}:${name}`).digest("hex");
		const dispatch = (type, payload) => turn.worker.dispatch(type, payload, { operationId });
		const currentTask = () => {
			const task = this.#controller.snapshot().tasks.find(task => task.assignment?.workerId === entry.workerId);
			check(task, "OWNERSHIP", "Claim a task before workspace operations");
			return task;
		};
		switch (name) {
			case "swarm_status": return state;
			case "swarm_task": {
				const { action, ...payload } = params;
				if (action === "claim") payload.assignmentId = operationId;
				const types = { create: "task.create", claim: "task.claim", unblock: "task.unblock", yield: "task.yield", fail: "task.fail" };
				check(types[action], "INPUT", "Unsupported task action");
				return dispatch(types[action], payload);
			}
			case "swarm_recruit": {
				const receipt = await dispatch("worker.create", { ...params, workloadRevision: state.revision });
				this.#enqueue(params.id, "Recruited for focused work");
				return receipt;
			}
			case "swarm_message": {
				const receipt = await dispatch("message.send", params);
				if (params.to !== "owner") this.#enqueue(params.to, "New peer message");
				return receipt;
			}
			case "swarm_history": {
				const history = await this.history(params.workerId, params.limit ?? 20);
				this.#guard(entry, signal);
				return history;
			}
			case "swarm_files": {
				currentTask();
				const worker = this.#workspace.worker(entry.workerId);
				if (params.action === "claim") return worker.claim(params.paths);
				worker.release(); return { released: true };
			}
			case "swarm_report": {
				currentTask();
				const worker = this.#workspace.worker(entry.workerId);
				return params.action === "submit" ? worker.submit(params.summary, params.receipts) : worker.review(params.approved, params.summary);
			}
			case "read": currentTask(); return this.#workspace.worker(entry.workerId).read(params.path);
			case "write":
			case "edit": {
				currentTask();
				return withFileMutationQueue(resolve(state.workspaceRoot, params.path), async () => {
					this.#guard(entry, signal);
					const worker = this.#workspace.worker(entry.workerId);
					return name === "write" ? worker.write(params.path, params.content) : worker.edit(params.path, params.edits);
				});
			}
			case "bash": currentTask(); return this.#workspace.worker(entry.workerId).shell(params.command);
			default: check(false, "AUTHORITY", "Tool is not enabled");
		}
	}

	#enqueue(workerId, reason) {
		if (this.#closed || this.#controller.snapshot().status !== "running") return;
		this.#queue.set(workerId, reason);
		if (this.#pumpQueued) return;
		this.#pumpQueued = true;
		queueMicrotask(() => { this.#pumpQueued = false; this.#pump(); });
	}

	#pump() {
		try { this.#admission?.assert(); } catch { this.#queue.clear(); return; }
		const state = this.#controller.snapshot();
		if (this.#closed || state.status !== "running") { this.#queue.clear(); return; }
		for (const [workerId, reason] of this.#queue) {
			if (this.#active.size >= state.limits.active) break;
			if (this.#active.has(workerId)) continue;
			this.#queue.delete(workerId);
			this.#launch(workerId, "prompt", reason);
		}
	}

	#launch(workerId, kind, reason) {
		const promise = this.#execute(workerId, kind, reason).catch(async error => {
			this.#recordError(error);
			if (["running", "verifying"].includes(this.#controller.snapshot().status)) {
				try { await this.#controller.system("run.pause"); } catch (failure) { this.#recordError(failure); }
			}
		}).finally(async () => {
			this.#active.delete(workerId);
			await this.#settleDrain();
			this.#pump();
		});
		this.#active.set(workerId, promise);
		return promise;
	}

	async #execute(workerId, kind, reason) {
		this.#admission?.assert();
		const requested = this.#controller.snapshot();
		const entry = await this.#entry(workerId);
		const state = this.#controller.snapshot();
		if (state.status !== "running" || state.cycle !== requested.cycle || state.generation !== requested.generation) return;
		const messages = kind === "prompt" ? pendingMail(state, workerId) : [];
		const worker = state.workers.find(worker => worker.id === workerId);
		const context = { id: randomUUID(), cycle: state.cycle, generation: state.generation, guidanceRevision: state.guidanceRevision, signal: this.#admission ? AbortSignal.any([this.#controller.executionSignal(), this.#admission.signal()]) : this.#controller.executionSignal(), worker: this.#controller.worker(workerId) };
		try {
			await this.#controller.system("session.turn.start", { id: context.id, workerId, kind, messageIds: messages.map(message => message.id), guidanceRevision: context.guidanceRevision }, { cycle: context.cycle, generation: context.generation });
		} catch (error) {
			const current = this.#controller.snapshot();
			if (["GUIDANCE", "FENCED"].includes(error.code) && context.signal.aborted) {
				if (kind === "prompt" && current.status === "running" && current.cycle === context.cycle && current.generation === context.generation) this.#enqueue(workerId, "Refresh shared guidance before dispatch");
				return;
			}
			throw error;
		}
		entry.active = context;
		let abortPromise;
		const abort = () => { abortPromise ??= entry.session.abort(); void abortPromise.catch(error => this.#recordError(error)); };
		context.signal.addEventListener("abort", abort, { once: true });
		let failure;
		let outcome = "settled";
		try {
			this.#admission?.assert();
			check(!context.signal.aborted, "FENCED", "Execution changed before prompt acceptance");
			const prompt = buildTurnPrompt(state, worker, { messages, reason });
			if (kind === "compaction") await entry.session.compact(`${buildSpecialistPrompt(state, worker)}\n\nPreserve decisions, questions, references, and focus. Authoritative state:\n${prompt}`);
			else {
				// This packet is the only model input admitted for this generation.
				await context.worker.dispatch("worker.ack", { revision: state.guidanceRevision });
				this.#admission?.assert();
				check(!context.signal.aborted, "FENCED", "Guidance changed before dispatch");
				await entry.session.prompt(prompt, { expandPromptTemplates: false });
			}
			await entry.session.waitForIdle();
			const last = entry.session.messages.filter(message => message.role === "assistant").at(-1);
			if (last?.stopReason === "error") outcome = "failed";
			if (last?.stopReason === "aborted" || context.signal.aborted) outcome = "interrupted";
		} catch (error) {
			failure = error;
			outcome = context.signal.aborted ? "interrupted" : "failed";
		} finally {
			// SDK prompt resolution alone is not tool/process settlement.
			await entry.session.waitForIdle();
			if (abortPromise) await abortPromise;
			context.signal.removeEventListener("abort", abort);
			if (kind === "prompt" && outcome === "failed" && !context.signal.aborted) {
				const task = this.#controller.snapshot().tasks.find(task => task.assignment?.workerId === workerId);
				if (task && !task.pending) {
					try {
						await context.worker.dispatch("task.fail", { taskId: task.id, reason: "Specialist execution failed before reporting" });
					} catch (error) {
						if (context.signal.aborted && ["GUIDANCE", "FENCED", "STATE", "TIME_LIMIT"].includes(error.code)) outcome = "interrupted";
						else failure ??= error;
					}
				}
			}
			entry.sync();
			await this.#controller.system("session.turn.end", { id: context.id, outcome });
			entry.active = null;
			const task = this.#controller.snapshot().tasks.find(task => task.assignment?.workerId === workerId);
			if (task && (task.pending || draining.has(this.#controller.snapshot().status))) await this.#workspace.settle(task.id);
		}
		if (failure && !context.signal.aborted) throw failure;
	}

	async #settleDrain() {
		if (this.#drain) return this.#drain;
		const state = this.#controller.snapshot();
		if (!draining.has(state.status) || this.#active.size || state.sessions.turns.length || state.workspace.operations.length) return;
		this.#queue.clear();
		this.#drain = (async () => {
			for (const task of this.#controller.snapshot().tasks.filter(task => task.assignment)) await this.#workspace.settle(task.id);
			await this.#controller.system("run.settle");
		})().catch(error => this.#recordError(error)).finally(() => { this.#drain = null; });
		return this.#drain;
	}

	async recruit(specification) {
		this.#admission?.assert();
		const state = this.#controller.snapshot();
		await this.#controller.owner("worker.create", { ...specification, workloadRevision: state.revision });
		return this.#entry(specification.id).then(entry => ({ workerId: entry.workerId, sessionId: entry.sessionId }));
	}

	wake(workerId, reason = "Continue approved work") {
		this.#admission?.assert();
		check(this.#controller.snapshot().workers.some(worker => worker.id === workerId), "NOT_FOUND", "Worker does not exist");
		check(this.#controller.snapshot().status === "running" && !this.#closed, "STATE", "Resume explicitly before dispatch");
		this.#enqueue(workerId, reason);
	}

	async send(workerId, text) {
		await this.#controller.owner("message.send", { to: workerId, text });
		this.#enqueue(workerId, "New owner message");
	}

	async redirect(text) {
		await this.#controller.owner("run.redirect", { text });
		for (const worker of this.#controller.snapshot().workers) this.#enqueue(worker.id, "New shared user guidance");
	}

	async tick() {
		await this.#controller.system("run.tick");
		await this.#settleDrain();
	}

	async resume({ reconciled = false, restart = false } = {}) {
		this.#admission?.assert();
		check(!this.#active.size && !this.#drain, "UNSETTLED", "Settle session preparation and execution before continuation");
		await this.#controller.owner(restart ? "run.restart" : "run.resume", { reconciled });
	}

	async pause({ timeoutMs = 5000, stop = false } = {}) {
		check(Number.isFinite(timeoutMs) && timeoutMs >= 0, "INPUT", "Invalid settlement timeout");
		this.#queue.clear();
		const status = this.#controller.snapshot().status;
		if (stop && !["stopping", "stopped"].includes(status)) await this.#controller.owner("run.stop");
		else if (!stop && ["running", "verifying"].includes(status)) await this.#controller.owner("run.pause");
		let timer;
		try {
			return await Promise.race([
				this.idle().then(async () => { await this.#settleDrain(); return { settled: terminal.has(this.#controller.snapshot().status) }; }),
				new Promise(resolve => { timer = setTimeout(() => resolve({ settled: false }), timeoutMs); }),
			]);
		} finally { clearTimeout(timer); }
	}

	async compact(workerId) {
		this.#admission?.assert();
		check(!this.#active.has(workerId) && !this.#queue.has(workerId), "BUSY", "Compact only an idle specialist");
		check(this.#active.size < this.#controller.snapshot().limits.active, "ACTIVE_LIMIT", "No compaction slot available");
		return this.#launch(workerId, "compaction", "Compact without replacing specialist identity");
	}

	async history(workerId, limit = 20) {
		check(Number.isInteger(limit) && limit > 0 && limit <= 100, "INPUT", "Invalid history limit");
		if (!sessionWorker(this.#controller.snapshot(), workerId)) return [];
		const entry = await this.#entry(workerId);
		return structuredClone(entry.manager.getEntries().slice(-limit));
	}

	async idle() {
		while (this.#active.size || this.#queue.size || this.#pumpQueued || this.#drain) {
			this.#pump();
			await Promise.allSettled([...this.#active.values()]);
			if (this.#drain) await this.#drain;
			await Promise.resolve();
		}
	}

	async reconcile({ settled = false } = {}) {
		check(settled && !this.#active.size, "UNSETTLED", "Establish session/process settlement before recovery");
		await this.#workspace.reconcile({ settled: true });
		await this.#controller.owner("sessions.reconcile", { settled: true });
		await this.#settleDrain();
	}

	async close() {
		check(!this.#active.size && !this.#queue.size && !this.#drain, "UNSETTLED", "Pause and settle before closing SDK sessions");
		check(terminal.has(this.#controller.snapshot().status), "STATE", "Pause or stop before close");
		for (const entry of this.#entries.values()) {
			await entry.ready;
			check(entry.session.isIdle, "UNSETTLED", "SDK session is not idle");
			entry.sync(); entry.session.dispose();
		}
		clearInterval(this.#timer);
		this.#closed = true;
		await this.#controller.close();
	}
}
