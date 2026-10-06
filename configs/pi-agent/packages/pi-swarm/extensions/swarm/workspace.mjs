import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { WorkspaceFiles } from "./workspace-files.mjs";
import { codingDefinitions } from "./session-tools.mjs";
import { WorkspaceScheduler } from "./workspace-scheduler.mjs";
import { requireCondition as check, SwarmError } from "./errors.mjs";

const attached = new WeakSet();
const construction = Symbol("trusted workspace runtime");

/** Trusted, model-free host adapter. Never expose controller/system or runner injection to workers. */
export class WorkspaceRuntime {
	static async attach(controller, { authorize = async () => false, runner, admission } = {}) {
		check(!attached.has(controller), "OWNERSHIP", "Controller already has workspace coordination");
		check(typeof authorize === "function" && (runner === undefined || typeof runner === "function"), "INPUT", "Host authorization and execution functions required");
		controller.assertOwned();
		const state = controller.snapshot();
		check(["paused", "pausing", "stopping", "failing", "stopped", "completed", "failed"].includes(state.status), "STATE", "Attach before resuming work");
		const files = new WorkspaceFiles(state.workspaceRoot);
		attached.add(controller);
		try {
			if (!state.workspace) await controller.owner("workspace.enable", { fingerprint: files.snapshot() });
			return new WorkspaceRuntime(construction, controller, files, authorize, runner, admission);
		} catch (error) {
			attached.delete(controller);
			throw error;
		}
	}

	#controller;
	#files;
	#authorize;
	#runner;
	#tools;
	#admission;
	#scheduler = new WorkspaceScheduler();
	#owners = new Map();
	#reads = new Map();
	#uncertain = new Map();

	constructor(token, controller, files, authorize, runner, admission) {
		check(token === construction, "AUTHORITY", "Use the trusted attachment API");
		this.#controller = controller;
		this.#files = files;
		this.#authorize = authorize;
		this.#tools = new Map(codingDefinitions(controller.snapshot().workspaceRoot).map(tool => [tool.name, tool]));
		this.#runner = runner ?? (async ({ command, signal, call = {} }) => {
			// Native Bash settles its child before resolving or rejecting. A custom test
			// runner must report settlement explicitly, including on cancellation.
			try {
				const result = await this.#tools.get("bash").execute(call.toolCallId ?? randomUUID(), { command, timeout: call.timeout }, signal, call.onUpdate, call.ctx);
				return { nativeResult: result, settled: true, exitCode: result.structuredContent?.exit_code ?? (result.isError ? 1 : 0) };
			} catch (error) { error.settled = true; throw error; }
		});
		this.#admission = admission;
	}

	snapshot() {
		return { uncertain: [...this.#uncertain.keys()], coordination: this.#scheduler.snapshot(), workspace: this.#controller.snapshot().workspace };
	}

	#check(context, signal = context.signal) {
		this.#admission?.assert();
		this.#controller.assertOwned();
		check(!signal.aborted, "FENCED", "Execution was cancelled or redirected");
		const state = this.#controller.snapshot();
		check(state.cycle === context.cycle && state.generation === context.generation && state.guidanceRevision === context.guidanceRevision, "FENCED", "Execution context expired");
		if (context.taskId === null) {
			check(state.status === "verifying", "STATE", "Final verification phase required");
		} else {
			const task = state.tasks.find(task => task.id === context.taskId);
			check(state.status === "running" && task?.assignment?.id === context.assignmentId && !task.pending, "FENCED", "Assignment is no longer accepting work");
			check(state.workers.find(worker => worker.id === context.workerId)?.guidanceRevision === state.guidanceRevision, "GUIDANCE", "Acknowledge current guidance before more work");
		}
		return state;
	}

	#context(binding, final = false) {
		const state = this.#controller.snapshot();
		let task;
		if (!final) {
			check(state.cycle === binding.cycle && state.generation === binding.generation, "FENCED", "Rebind after authorized continuation");
			task = state.tasks.find(task => task.assignment?.workerId === binding.workerId && task.assignment.id === binding.assignmentId);
			check(task, "FENCED", "Assignment no longer belongs to this worker");
		}
		const context = {
			cycle: state.cycle, generation: state.generation, guidanceRevision: state.guidanceRevision,
			taskId: task?.id ?? null, assignmentId: task?.assignment.id ?? null, workerId: binding?.workerId ?? null,
			signal: this.#admission ? AbortSignal.any([this.#controller.executionSignal(), this.#admission.signal()]) : this.#controller.executionSignal(),
		};
		context.owner = `${context.cycle}:${context.generation}:${context.guidanceRevision}:${context.assignmentId ?? "final"}`;
		this.#check(context);
		if (!this.#owners.has(context.owner)) {
			this.#owners.set(context.owner, context);
			this.#reads.set(context.owner, new Map());
			context.signal.addEventListener("abort", () => {
				void this.#scheduler.cancelOwner(context.owner, context.signal.reason);
				this.#reads.delete(context.owner);
			}, { once: true });
		}
		return context;
	}

	worker(workerId) {
		const state = this.#controller.snapshot();
		const task = state.tasks.find(task => task.assignment?.workerId === workerId);
		check(task, "OWNERSHIP", "Claim a task before using the workspace adapter");
		const binding = { workerId, assignmentId: task.assignment.id, cycle: state.cycle, generation: state.generation };
		return Object.freeze({
			read: (path, call = {}, params = {}) => {
				const context = this.#context(binding);
				const canonical = this.#files.path(path);
				const fingerprint = this.#files.fingerprint(path);
				return this.#tools.get("read").execute(call.toolCallId ?? randomUUID(), { ...params, path: canonical }, context.signal, call.onUpdate, call.ctx).then(result => {
					this.#check(context);
					check(this.#files.fingerprint(canonical) === fingerprint, "STALE", "File changed while being read");
					this.#reads.get(context.owner).set(canonical, fingerprint);
					return result;
				});
			},
			claim: paths => {
				const context = this.#context(binding);
				const canonical = paths.map(path => this.#files.path(path));
				const claim = this.#scheduler.acquireClaims(context.owner, canonical);
				// A handoff never inherits the previous owner's read observation.
				for (const path of canonical) this.#reads.get(context.owner).delete(path);
				return claim;
			},
			release: () => {
				const context = this.#context(binding);
				this.#scheduler.releaseClaims(context.owner);
				this.#reads.get(context.owner).clear();
			},
			write: (path, content, call) => this.#mutate(binding, "write", path, { path, content }, call),
			edit: (path, edits, call) => this.#mutate(binding, "edit", path, { path, edits: structuredClone(edits) }, call),
			shell: (command, call) => this.#shell(binding, command, call),
			submit: (summary, receipts) => this.#submit(binding, summary, structuredClone(receipts)),
			review: (approved, summary) => this.#review(binding, approved, summary),
		});
	}

	async #permission(context, kind, paths, command, signal) {
		this.#check(context, signal);
		const allowed = await this.#authorize(Object.freeze({ kind, paths: Object.freeze([...paths]), command, workerId: context.workerId, taskId: context.taskId, signal }));
		check(allowed === true, "AUTHORITY", "Host policy did not authorize this operation");
		this.#check(context, signal);
	}

	async #observe() {
		const fingerprint = this.#files.snapshot();
		if (this.#controller.snapshot().workspace.fingerprint !== fingerprint) {
			await this.#controller.system("workspace.observe", { fingerprint });
		}
		return fingerprint;
	}

	async #mutate(binding, kind, path, params, call = {}) {
		const context = this.#context(binding);
		const canonical = this.#files.path(path);
		const expected = this.#reads.get(context.owner).get(canonical) ?? (kind === "write" && !existsSync(resolve(this.#controller.snapshot().workspaceRoot, canonical)) ? this.#files.fingerprint(canonical) : undefined);
		check(expected, "STALE", "Read the current file after acquiring its claim");
		return this.#scheduler.withMutation(context.owner, [canonical], async signal => {
			await this.#permission(context, kind, [canonical], null, signal);
			const result = await this.#execute(context, kind, [canonical], null, signal, async () => {
				check(this.#files.fingerprint(canonical) === expected, "STALE", "Reread the changed target before editing");
				const nativeResult = await this.#tools.get(kind).execute(call.toolCallId ?? randomUUID(), { ...params, path: canonical }, signal, call.onUpdate, call.ctx);
				return { nativeResult, settled: true, exitCode: null };
			});
			this.#reads.get(context.owner)?.set(canonical, this.#files.fingerprint(canonical));
			return result;
		}, { signal: context.signal });
	}

	async #shell(binding, command, call = {}) {
		check(typeof command === "string" && command.trim(), "INPUT", "Command required");
		const context = this.#context(binding);
		return this.#scheduler.withExclusive(context.owner, async signal => {
			this.#reads.get(context.owner)?.clear();
			await this.#permission(context, "shell", [], command, signal);
			return this.#execute(context, "shell", [], command, signal, () => this.#runner({ command, cwd: this.#controller.snapshot().workspaceRoot, signal, call }));
		}, { signal: context.signal });
	}

	async #execute(context, kind, paths, command, signal, perform) {
		this.#check(context, signal);
		const before = this.#files.snapshot();
		const id = randomUUID();
		await this.#controller.system("workspace.start", { id, taskId: context.taskId, assignmentId: context.assignmentId, kind, command, paths, before }, { cycle: context.cycle, generation: context.generation });
		let result;
		let failure;
		let invoked = false;
		try {
			this.#check(context, signal);
			invoked = true;
			result = await perform();
		} catch (error) {
			failure = error;
			const shell = kind === "shell" || kind === "final";
			result = { settled: !invoked || !shell || error.settled === true, exitCode: null };
		}
		const uncertain = result?.settled !== true;
		if (uncertain) await this.#holdUncertain(id);
		let after = null;
		try { after = this.#files.snapshot(); } catch (error) { failure ??= error; }
		let outcome = uncertain || after === null ? "unknown" : signal.aborted || result.aborted ? "cancelled" : failure || result.exitCode !== null && result.exitCode !== 0 ? "failed" : "succeeded";
		await this.#controller.system("workspace.finish", { id, after, exitCode: result?.exitCode ?? null, outcome });
		if (failure) throw failure;
		check(!uncertain, "UNSETTLED", "Execution required reconciliation and is not verification evidence");
		return {
			...result, executionId: id, ...(result.nativeResult ? {
				nativeResult: {
					...result.nativeResult,
					details: { ...result.nativeResult.details, executionId: id },
					content: [...result.nativeResult.content, { type: "text", text: `Swarm execution receipt: ${id}` }]
				}
			} : {})
		};
	}

	async #holdUncertain(id) {
		let resolve;
		const settled = new Promise(done => { resolve = done; });
		this.#uncertain.set(id, resolve);
		await this.#controller.system("workspace.uncertain", { id });
		if (["running", "verifying"].includes(this.#controller.snapshot().status)) await this.#controller.system("run.pause");
		// Abort is a request, not evidence of settlement. Keep the lease here.
		await settled;
		this.#uncertain.delete(id);
	}

	/** Trusted user-confirmed attestation after independently establishing process settlement. */
	confirmSettled(id, { settled } = {}) {
		check(settled === true && ["pausing", "stopping", "failing"].includes(this.#controller.snapshot().status), "AUTHORITY", "Paused execution and explicit settlement attestation required");
		const resolve = this.#uncertain.get(id);
		check(resolve, "NOT_FOUND", "No live uncertain execution with this identifier");
		resolve();
	}

	async #submit(binding, summary, receipts) {
		const context = this.#context(binding);
		return this.#scheduler.withExclusive(context.owner, async signal => {
			this.#check(context, signal);
			const fingerprint = await this.#observe();
			this.#check(context, signal);
			await this.#controller.system("workspace.candidate", { taskId: context.taskId, assignmentId: context.assignmentId, fingerprint, receipts }, { cycle: context.cycle, generation: context.generation });
			this.#check(context, signal);
			return this.#controller.worker(context.workerId).dispatch("task.submit", { taskId: context.taskId, summary });
		}, { signal: context.signal });
	}

	async #review(binding, approved, summary) {
		const context = this.#context(binding);
		return this.#scheduler.withExclusive(context.owner, async signal => {
			this.#check(context, signal);
			await this.#observe();
			this.#check(context, signal);
			return this.#controller.worker(context.workerId).dispatch("task.review", { taskId: context.taskId, approved, summary });
		}, { signal: context.signal });
	}

	async settle(taskId) {
		const task = this.#controller.snapshot().tasks.find(task => task.id === taskId);
		check(task?.assignment, "NOT_FOUND", "Assignment does not exist");
		for (const [owner, context] of this.#owners) {
			if (context.assignmentId !== task.assignment.id) continue;
			this.#scheduler.releaseClaims(owner);
			this.#scheduler.assertIdle(owner);
		}
		await this.#controller.system("assignment.settle", { taskId, assignmentId: task.assignment.id });
	}

	/** Reconcile journaled orphan executions only after the host proves nothing remains alive. */
	async reconcile({ settled } = {}) {
		check(settled === true, "AUTHORITY", "Explicit interrupted-execution reconciliation required");
		this.#scheduler.assertIdle();
		await this.#controller.owner("workspace.reconcile", { fingerprint: this.#files.snapshot(), settled: true });
	}

	async finalCheck(command) {
		this.#admission?.assert();
		check(typeof command === "string" && command.trim(), "INPUT", "Final verification command required");
		this.#scheduler.assertIdle();
		await this.#observe();
		await this.#controller.system("run.verify");
		const context = this.#context(null, true);
		return this.#scheduler.withExclusive(context.owner, async signal => {
			await this.#permission(context, "final", [], command, signal);
			const result = await this.#execute(context, "final", [], command, signal, () => this.#runner({ command, cwd: this.#controller.snapshot().workspaceRoot, signal }));
			this.#check(context, signal);
			await this.#observe();
			this.#check(context, signal);
			await this.#controller.system("run.complete", { evidence: result.executionId });
			return result;
		}, { signal: context.signal });
	}
}
