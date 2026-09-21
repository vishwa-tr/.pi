import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { SwarmController } from "./core.mjs";
import { DEFAULT_LIMITS, reduceEvent } from "./state.mjs";
import { requireCondition as check, SwarmError } from "./errors.mjs";
import { validId } from "./store/files.mjs";
import { WorkspaceRuntime } from "./workspace.mjs";
import { SwarmSessions } from "./sessions.mjs";
import { readSessionHistory } from "./sdk-session.mjs";
import { ModeGate, requestSafety } from "./host-gates.mjs";
import { inspectCheckout, specificationFingerprint } from "./host-approval.mjs";

function freeze(value) {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

/** Host-only approval orchestration. No UI, extension registration, or live provider support. */
export class SwarmHost {
	#events;
	#sessionId;
	#ask;
	#modelRuntime;
	#defaults;
	#mode;
	#controller;
	#workspace;
	#driver;
	#location;
	#permit;
	#pending;
	#operation;
	#epoch = 0;
	#modePause;
	#lifetime = new AbortController();
	#denied = AbortSignal.abort();
	#approvalTimeout;
	#safetyTimeout;
	#tickInterval;
	#errors = [];
	#closing;
	#runner;
	#beforePrompt;
	#pendingSafety = 0;

	constructor({ events, sessionId, requestApproval, modelRuntime, mainModel, thinkingLevel = "off", codingTools = ["read", "edit", "write", "bash"], instructions = "", approvalTimeoutMs = 120000, safetyTimeoutMs = 30000, tickIntervalMs = 1000, runner, beforePrompt = async () => {} }) {
		check(typeof requestApproval === "function", "INPUT", "Human approval callback required");
		for (const timeout of [approvalTimeoutMs, safetyTimeoutMs]) check(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 600000, "INPUT", "Invalid approval timeout");
		this.#runner = runner;
		this.#beforePrompt = beforePrompt;
		this.#events = events;
		this.#sessionId = sessionId;
		this.#ask = requestApproval;
		this.#modelRuntime = modelRuntime;
		this.#defaults = structuredClone({ model: { provider: mainModel?.provider, modelId: mainModel?.id, thinkingLevel }, codingTools, instructions });
		this.#approvalTimeout = approvalTimeoutMs;
		this.#safetyTimeout = safetyTimeoutMs;
		this.#tickInterval = tickIntervalMs;
		this.#mode = new ModeGate({ events, sessionId, onRevoke: () => {
			this.#invalidate();
			if (!this.#lifetime.signal.aborted) {
				this.#modePause = this.pause().catch(error => this.#errors.push(error.message));
			}
		} });
	}

	snapshot() {
		return { run: this.#controller?.snapshot() ?? null, driver: this.#driver?.snapshot() ?? null, workspace: this.#workspace?.snapshot() ?? null, pendingApproval: Boolean(this.#pending) || this.#pendingSafety > 0, errors: [...this.#errors] };
	}

	/** Detached inspection only; no session construction, dispatch, or owner capabilities. */
	history(workerId) {
		const run = this.#controller?.snapshot();
		check(run?.workers.some(worker => worker.id === workerId), "NOT_FOUND", "Worker does not exist");
		const binding = run.sessions?.workers.find(worker => worker.workerId === workerId);
		if (!binding) return [];
		return readSessionHistory(join(run.workspaceRoot, ".swarms", run.runId, "sessions", binding.sessionFile), run.workspaceRoot, binding.sessionId);
	}

	#invalidate() {
		this.#epoch += 1;
		this.#operation?.cancel.abort();
		this.#pending?.abort();
		this.#permit?.cancel.abort();
		this.#permit = undefined;
	}

	#assertAdmission() {
		check(!this.#closing && !this.#lifetime.signal.aborted && this.#permit && !this.#permit.signal.aborted, "HOST_DENIED", "Explicit current host approval is required");
		this.#mode.assert(this.#permit.grant.token);
	}

	#setPermit(grant, operation) {
		this.#assertOperation(operation);
		this.#mode.assert(grant.token);
		this.#permit?.cancel.abort();
		const cancel = new AbortController();
		this.#permit = { grant, cancel, signal: AbortSignal.any([grant.signal, cancel.signal, this.#lifetime.signal]) };
	}

	#draft(input) {
		return structuredClone({ objective: input.objective, criteria: input.criteria, scope: input.scope, limits: { ...DEFAULT_LIMITS, ...input.limits }, model: input.model ?? this.#defaults.model, codingTools: input.codingTools ?? this.#defaults.codingTools, instructions: input.instructions ?? this.#defaults.instructions });
	}

	#validate(draft, root, runId) {
		check(draft && Object.keys(draft).sort().join() === "codingTools,criteria,instructions,limits,model,objective,scope", "INPUT", "Invalid approval specification");
		reduceEvent(null, { version: 1, operationId: "approval-preflight", actor: "owner", expectedRevision: 0, cycle: 1, generation: 0, atMs: 0, type: "run.create", payload: { runId, ownerSessionId: this.#sessionId, workspaceRoot: root, objective: draft.objective, criteria: draft.criteria, scope: draft.scope, limits: draft.limits } });
		check(draft.model && Object.keys(draft.model).sort().join() === "modelId,provider,thinkingLevel", "MODEL", "Explicit model selection required");
		check(draft.model.provider === "swarm-mock" && this.#modelRuntime?.getModel(draft.model.provider, draft.model.modelId)?.api === "swarm-mock", "MODEL", "Live model execution remains disabled");
		check(["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(draft.model.thinkingLevel), "MODEL", "Invalid thinking level");
		check(Array.isArray(draft.codingTools) && new Set(draft.codingTools).size === draft.codingTools.length && draft.codingTools.every(name => ["read", "edit", "write", "bash"].includes(name)), "INPUT", "Unsupported coding tool selection");
		check(typeof draft.instructions === "string" && draft.instructions.length <= 32768, "INPUT", "Invalid host instructions");
	}

	#assertOperation(operation) {
		check(this.#operation === operation && !operation.cancel.signal.aborted && operation.epoch === this.#epoch && !this.#lifetime.signal.aborted, "CANCELLED", "Host operation was superseded");
	}

	#runOperation(fn) {
		check(!this.#closing && !this.#operation && !this.#lifetime.signal.aborted, "BUSY", "Host operation already pending or closed");
		const operation = { cancel: new AbortController(), epoch: this.#epoch };
		this.#operation = operation;
		operation.promise = Promise.resolve().then(() => fn(operation)).finally(() => {
			if (this.#operation === operation) this.#operation = undefined;
		});
		return operation.promise;
	}

	async #approval(action, inspection, specification, recovery) {
		check(!this.#pending && !this.#lifetime.signal.aborted, "BUSY", "Approval already pending or host closed");
		const grant = this.#mode.capture();
		const pending = new AbortController();
		this.#pending = pending;
		const signal = AbortSignal.any([pending.signal, grant.signal, this.#lifetime.signal]);
		const deadline = performance.now() + this.#approvalTimeout;
		let timer;
		let abort;
		try {
			const cancelled = new Promise((_, reject) => {
				abort = () => reject(new SwarmError("CANCELLED", "Approval was cancelled"));
				signal.addEventListener("abort", abort, { once: true });
				if (signal.aborted) abort();
				timer = setTimeout(() => pending.abort(), this.#approvalTimeout);
			});
			const request = Object.freeze({ action, specification: freeze(structuredClone(specification)), changes: freeze(structuredClone(inspection.changes)), requiresExistingWorkDecision: inspection.changes.length > 0, requiresReconciliation: action !== "launch", recovery: recovery && freeze(structuredClone(recovery)), signal });
			const answer = structuredClone(await Promise.race([Promise.resolve().then(() => {
				check(!signal.aborted, "CANCELLED", "Approval cancelled before presentation");
				return this.#ask(request);
			}), cancelled]));
			check(!signal.aborted && performance.now() < deadline, "CANCELLED", "Approval expired");
			this.#mode.assert(grant.token);
			check(answer?.approved === true, "AUTHORITY", "User did not approve this action");
			check(!inspection.changes.length || answer.existingChanges === "preserve", "DIRTY", "Explicit preservation of existing changes is required");
			check(action === "launch" || action === "reconcile" || answer.reconciled === true, "UNSETTLED", "Explicit workspace reconciliation is required");
			const approved = answer.specification ?? specification;
			if (action !== "launch") check(specificationFingerprint(approved) === specificationFingerprint(specification), "SCOPE", "Continuation cannot silently change the approved scope");
			if (action === "reconcile") check(answer.attestation?.kind === "user-established-settlement" && typeof answer.attestation.evidence === "string" && answer.attestation.evidence.trim().length > 0 && answer.attestation.evidence.length <= 4096, "UNSETTLED", "Describe independently established process/session settlement; a boolean is not evidence");
			return { grant, specification: approved, attestation: answer.attestation, approval: { id: randomUUID(), action, workspaceFingerprint: inspection.fingerprint, specificationFingerprint: specificationFingerprint(approved), existingChanges: inspection.changes.length ? "preserve" : "clean" } };
		} finally {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			if (this.#pending === pending) this.#pending = undefined;
		}
	}

	#unchanged(inspection, grant) {
		this.#mode.assert(grant.token);
		check(inspectCheckout(inspection.root).fingerprint === inspection.fingerprint, "STALE", "Workspace changed while approval was pending; inspect and approve again");
	}

	async #wire() {
		const admission = { assert: () => this.#assertAdmission(), signal: () => this.#permit?.signal ?? this.#denied };
		this.#workspace = await WorkspaceRuntime.attach(this.#controller, { admission, runner: this.#runner, authorize: async request => {
			this.#assertAdmission();
			const permit = this.#permit;
			const signal = AbortSignal.any([request.signal, permit.signal]);
			const shell = ["shell", "final"].includes(request.kind);
			const value = { agent: request.workerId ?? "swarm final verification", tool: shell ? "bash" : request.kind };
			if (shell) value.command = request.command;
			else value.path = resolve(this.#location.workspace, request.paths[0]);
			let result;
			this.#pendingSafety++;
			try {
				await this.#beforePrompt();
				this.#assertAdmission();
				result = await requestSafety({ events: this.#events, request: value, signal, timeoutMs: this.#safetyTimeout });
			} finally { this.#pendingSafety--; }
			this.#assertAdmission();
			check(this.#permit === permit && !signal.aborted, "HOST_DENIED", "Approval belongs to an expired host admission");
			return result.approved === true;
		} });
		this.#driver = await SwarmSessions.attach(this.#controller, { workspace: this.#workspace, modelRuntime: this.#modelRuntime, mainModel: this.#modelRuntime.getModel(this.#specification().model.provider, this.#specification().model.modelId), thinkingLevel: this.#specification().model.thinkingLevel, codingTools: this.#specification().codingTools, instructions: this.#specification().instructions, tickIntervalMs: this.#tickInterval, admission });
	}

	#launchSpecification;
	#specification() {
		const state = this.#controller.snapshot();
		return state.sessions ? { objective: state.objective, criteria: state.criteria, scope: state.scope, limits: state.limits, model: state.sessions.selection, codingTools: state.sessions.codingTools, instructions: state.sessions.instructions } : this.#launchSpecification;
	}

	launch(input) { return this.#runOperation(operation => this.#launch(input, operation)); }
	async #launch({ workspace, runId, specification }, operation) {
		this.#assertOperation(operation);
		check(!this.#controller && !this.#pending, "STATE", "Host already owns a run or approval");
		check(validId(runId), "INPUT", "Invalid run identifier");
		this.#mode.capture();
		const inspection = inspectCheckout(workspace);
		const runPath = join(inspection.root, ".swarms", runId);
		try { lstatSync(runPath); throw new SwarmError("DUPLICATE", "Run already exists; restore it instead"); }
		catch (error) { if (error.code !== "ENOENT") throw error; }
		const draft = this.#draft(specification);
		this.#validate(draft, inspection.root, runId);
		const accepted = await this.#approval("launch", inspection, draft);
		this.#validate(accepted.specification, inspection.root, runId);
		this.#unchanged(inspection, accepted.grant);
		this.#location = { workspace: inspection.root, runId, ownerSessionId: this.#sessionId };
		this.#launchSpecification = accepted.specification;
		try {
			this.#controller = await SwarmController.open({ ...this.#location, create: accepted.specification, createOnly: true });
			this.#assertOperation(operation);
			await this.#wire();
			this.#assertOperation(operation);
			this.#unchanged(inspection, accepted.grant);
			await this.#controller.owner("host.approve", { approval: accepted.approval });
			this.#setPermit(accepted.grant, operation);
			await this.#driver.resume({ reconciled: true });
			return this.snapshot();
		} catch (error) {
			this.#invalidate();
			if (this.#driver) await this.#driver.pause().catch(() => {});
			throw error;
		}
	}

	restore(input) { return this.#runOperation(operation => this.#restore(input, operation)); }
	async #restore({ workspace, runId }, operation) {
		this.#assertOperation(operation);
		check(!this.#controller && !this.#pending, "STATE", "Host already owns a run");
		const grant = this.#mode.capture();
		this.#location = { workspace, runId, ownerSessionId: this.#sessionId };
		this.#controller = await SwarmController.open(this.#location);
		this.#assertOperation(operation);
		check(this.#controller.snapshot().sessions, "STATE", "Only configured SDK runs can be restored");
		await this.#wire();
		this.#assertOperation(operation);
		this.#mode.assert(grant.token);
		return this.snapshot(); // Restoring does not grant execution authority.
	}

	resume(options = {}) { return this.#runOperation(operation => this.#resume(options, operation)); }
	async #resume({ restart = false }, operation) {
		this.#assertOperation(operation);
		check(this.#controller && !this.#pending, "STATE", "No run or approval already pending");
		const state = this.#controller.snapshot();
		check((restart ? ["paused", "stopped", "completed", "failed"] : ["paused"]).includes(state.status), "STATE", "Settle the run before continuation");
		check(!state.sessions.turns.length && !state.workspace.operations.length && !this.#driver?.snapshot().active.length, "UNSETTLED", "Execution remains unsettled");
		const inspection = inspectCheckout(state.workspaceRoot);
		const accepted = await this.#approval(restart ? "restart" : "resume", inspection, this.#specification());
		this.#unchanged(inspection, accepted.grant);
		check(this.#controller.snapshot().revision === state.revision, "STALE", "Run changed during approval");
		if (["stopped", "completed", "failed"].includes(state.status)) {
			await this.#driver?.close();
			this.#driver = undefined;
			this.#workspace = undefined;
			this.#controller = await SwarmController.open(this.#location);
			this.#assertOperation(operation);
			await this.#wire();
		} else if (!this.#driver) await this.#wire();
		this.#assertOperation(operation);
		this.#unchanged(inspection, accepted.grant);
		await this.#controller.owner("host.continue", { restart, reconciled: true, approval: accepted.approval });
		this.#setPermit(accepted.grant, operation);
		return this.snapshot();
	}

	async pause(options = {}) {
		this.#invalidate();
		const pending = this.#operation?.promise;
		const timeoutMs = options.timeoutMs ?? 5000;
		check(Number.isFinite(timeoutMs) && timeoutMs >= 0, "INPUT", "Invalid settlement timeout");
		let timer;
		const settle = (async () => {
			if (pending) await pending.catch(() => {});
			return this.#driver ? this.#driver.pause(options) : { settled: true };
		})();
		try {
			return await Promise.race([settle, new Promise(resolve => { timer = setTimeout(() => resolve({ settled: false }), timeoutMs); })]);
		} finally { clearTimeout(timer); }
	}
	/** Human attestation retires uncertainty, never certifies successful execution. */
	reconcile() { return this.#runOperation(async operation => {
		const state = this.#controller?.snapshot();
		check(state && this.#workspace && this.#driver && ["paused", "pausing", "stopping", "failing"].includes(state.status), "STATE", "Pause before reconciliation");
		const live = this.#workspace.snapshot().uncertain;
		check(this.#driver.snapshot().active.every(workerId => state.workspace.operations.some(item => item.workerId === workerId && live.includes(item.id))), "UNSETTLED", "Live SDK turns must settle normally unless waiting on an identified uncertain operation");
		const recovery = { operations: state.workspace.operations, turns: state.sessions.turns, liveUncertainIds: live };
		check(recovery.operations.length || recovery.turns.length, "STATE", "No interrupted execution to reconcile");
		const inspection = inspectCheckout(state.workspaceRoot);
		const accepted = await this.#approval("reconcile", inspection, this.#specification(), recovery);
		this.#assertOperation(operation);
		this.#unchanged(inspection, accepted.grant);
		check(this.#controller.snapshot().revision === state.revision, "STALE", "Execution changed during reconciliation; inspect again");
		// Record exactly what the user attested before releasing any live lease.
		await this.#controller.owner("host.attest", { evidence: accepted.attestation.evidence, operationIds: recovery.operations.map(item => item.id), turnIds: recovery.turns.map(item => item.id), fingerprint: inspection.fingerprint }, { expectedRevision: state.revision });
		this.#assertOperation(operation);
		for (const id of live) this.#workspace.confirmSettled(id, { settled: true });
		// Live SDK/tool frames must unwind themselves. Never retire them as orphans.
		if (this.#driver.snapshot().active.length || live.length) return { settled: false, awaitingLiveSettlement: true };
		await this.#driver.reconcile({ settled: true });
		const current = this.#controller.snapshot();
		return { settled: ["paused", "stopped", "completed", "failed"].includes(current.status) && !current.workspace.operations.length && !current.sessions.turns.length };
	}); }

	wake(workerId, reason) { this.#assertAdmission(); return this.#driver.wake(workerId, reason); }
	recruit(specification) { return this.#runOperation(async operation => {
		this.#assertAdmission();
		const result = await this.#driver.recruit(specification);
		this.#assertOperation(operation);
		return result;
	}); }
	compact(workerId) { this.#assertAdmission(); return this.#driver.compact(workerId); }
	finalCheck(command) { this.#assertAdmission(); return this.#workspace.finalCheck(command); }
	redirect(text) { this.#pending?.abort(); return this.#driver.redirect(text); }
	async idle() {
		await this.#driver?.idle();
		if (this.#modePause) await this.#modePause;
	}
	close() {
		if (this.#closing) return this.#closing;
		this.#closing = (async () => {
			const result = await this.pause();
			check(result.settled, "UNSETTLED", "Host cannot close before actual execution settlement");
			await this.#driver?.close();
			await this.#controller?.close();
			this.#lifetime.abort();
			this.#mode.dispose();
		})().finally(() => { this.#closing = undefined; });
		return this.#closing;
	}
}
