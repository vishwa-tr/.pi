import {
	providerDescriptor,
	assertProviderSelection,
} from "./provider-capability.mjs";
import { lstatSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { validId } from "./store/files.mjs";
import { SwarmController } from "./core.mjs";
import { recipientId } from "./messaging.mjs";
import { SwarmSessions } from "./sessions.mjs";
import { prepareLayout } from "./store/layout.mjs";
import { WorkspaceRuntime } from "./workspace.mjs";
import { readSessionHistory } from "./sdk-session.mjs";
import { DEFAULT_LIMITS, reduceEvent } from "./state.mjs";
import { ModeGate, requestSafety } from "./host-gates.mjs";
import { inPhase, requireCondition as check, SwarmError } from "./errors.mjs";
import { inspectCheckout, specificationFingerprint } from "./host-approval.mjs";

function freeze(value) {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

/** Host-only approval orchestration; provider execution requires explicit capability injection. */
export class SwarmHost {
	#listeners = new Set();
	#unsubscribe;
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
	#safetySeen = false;
	#providerCapability;
	#providerRuntimeBinding;
	#approvedModel;

	constructor({ events, sessionId, requestApproval, modelRuntime, mainModel, thinkingLevel = "off", codingTools = ["read", "edit", "write", "bash"], instructions = "", approvalTimeoutMs = 120000, safetyTimeoutMs = 30000, tickIntervalMs = 1000, runner, beforePrompt = async () => { }, providerCapability }) {
		check(typeof requestApproval === "function", "INPUT", "Human approval callback required");
		for (const timeout of [approvalTimeoutMs, safetyTimeoutMs]) check(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 600000, "INPUT", "Invalid approval timeout");
		if (providerCapability !== undefined) providerDescriptor(providerCapability);
		this.#providerCapability = providerCapability;
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
		this.#mode = new ModeGate({
			events, sessionId, onRevoke: () => {
				this.#invalidate();
				if (!this.#lifetime.signal.aborted) {
					this.#modePause = this.pause().catch(error => this.#errors.push(error.message));
				}
			}
		});
	}

	snapshot() {
		return { run: this.#controller?.snapshot() ?? null, driver: this.#driver?.snapshot() ?? null, workspace: this.#workspace?.snapshot() ?? null, pendingApproval: Boolean(this.#pending) || this.#pendingSafety > 0, errors: [...this.#errors] };
	}

	/** Observation conveys no owner or worker capability. */
	subscribe(listener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#publish(type) {
		for (const listener of this.#listeners) {
			try { listener(type); } catch { /* Presentation cannot affect admission or settlement. */ }
		}
	}

	/** Detached inspection only; no session construction, dispatch, or owner capabilities. */
	history(workerId) {
		const run = this.#controller?.snapshot();
		check(run?.workers.some(worker => worker.id === workerId), "NOT_FOUND", "Worker does not exist");
		const binding = run.sessions?.workers.find(worker => worker.workerId === workerId);
		if (!binding) return [];
		return this.#driver?.liveHistory(workerId) ?? readSessionHistory(join(this.#controller.layout.sessionDir, binding.sessionFile), run.workspaceRoot, binding.sessionId);
	}

	#invalidate() {
		this.#epoch += 1;
		this.#operation?.cancel.abort();
		this.#pending?.abort();
		this.#permit?.cancel.abort();
		this.#permit = undefined;
	}

	#assertProvider(selection) {
		if (!this.#providerCapability) return;
		const model = assertProviderSelection(this.#providerCapability, selection, this.#modelRuntime);
		const fingerprint = specificationFingerprint(model);
		if (this.#approvedModel === undefined) this.#approvedModel = fingerprint;
		check(this.#approvedModel === fingerprint, "PROVIDER", "Model catalog metadata changed; create a new host and approve again");
		const provider = this.#modelRuntime.getProvider?.(model.provider);
		check(provider, "PROVIDER", "Explicit provider implementation required");
		const references = [provider, provider.stream, provider.streamSimple, this.#modelRuntime.getModel,
			this.#modelRuntime.getProvider, this.#modelRuntime.stream, this.#modelRuntime.streamSimple,
			this.#modelRuntime.complete, this.#modelRuntime.completeSimple];
		if (!this.#providerRuntimeBinding) this.#providerRuntimeBinding = references;
		check(references.every((reference, index) => reference === this.#providerRuntimeBinding[index]),
			"PROVIDER", "Provider implementation replacement requires a new host and fresh approval");
	}

	#assertAdmission() {
		check(!this.#closing && !this.#lifetime.signal.aborted && this.#permit && !this.#permit.signal.aborted, "HOST_DENIED", "Explicit current host approval is required");
		this.#mode.assert(this.#permit.grant.token);
		if (this.#providerCapability) {
			try { this.#assertProvider(this.#specification().model); }
			catch (error) {
				this.#invalidate();
				this.#modePause = this.pause().catch(failure => this.#errors.push(failure.message));
				throw error;
			}
		}
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
		this.#assertProvider(draft.model);
		check(this.#providerCapability || (draft.model.provider === "swarm-mock" && this.#modelRuntime?.getModel(draft.model.provider, draft.model.modelId)?.api === "swarm-mock"), "MODEL", "Live model execution remains disabled");
		check(["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(draft.model.thinkingLevel), "MODEL", "Invalid thinking level");
		check(Array.isArray(draft.codingTools) && new Set(draft.codingTools).size === draft.codingTools.length && draft.codingTools.every(name => ["read", "edit", "write", "bash"].includes(name)), "INPUT", "Unsupported coding tool selection");
		check(typeof draft.instructions === "string" && draft.instructions.length <= 32768, "INPUT", "Invalid host instructions");
	}

	#assertOperation(operation) {
		check(this.#operation === operation && !operation.cancel.signal.aborted && operation.epoch === this.#epoch && !this.#lifetime.signal.aborted, "CANCELLED", "Host operation was superseded");
	}

	#runOperation(phase, fn) {
		check(!this.#closing && !this.#operation && !this.#lifetime.signal.aborted, "BUSY", "Host operation already pending or closed");
		const operation = { cancel: new AbortController(), epoch: this.#epoch };
		this.#operation = operation;
		operation.promise = inPhase(phase, () => Promise.resolve().then(() => fn(operation))).finally(() => {
			if (this.#operation === operation) this.#operation = undefined;
		});
		return operation.promise;
	}

	#approval(action, inspection, specification, recovery) {
		return inPhase("approval", () => this.#requestApproval(action, inspection, specification, recovery));
	}

	async #requestApproval(action, inspection, specification, recovery) {
		check(!this.#pending && !this.#lifetime.signal.aborted, "BUSY", "Approval already pending or host closed");
		const grant = this.#mode.capture();
		const pending = new AbortController();
		this.#pending = pending;
		this.#publish("approval.pending");
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
			const provider = this.#providerCapability ? providerDescriptor(this.#providerCapability) : undefined;
			const safety = await requestSafety({ events: this.#events, request: { agent: "swarm", tool: "write", path: "capability probe" }, signal, probe: true });
			check(safety.claimed || safety.unclaimed && !this.#safetySeen, "AUTHORITY", "Safety provider is malformed, duplicated, or disappeared");
			if (safety.claimed) this.#safetySeen = true;
			const integrations = Object.freeze({
				mode: this.#mode.current().instanceId === "absent" ? "none installed (runs as Off)" : "pi-plan",
				confirmations: safety.claimed
					? "pi-safety policy remains enforced and may ask for operation confirmation"
					: "Selected coding tools are authorized within this bounded run; no Swarm operation prompts"
			});
			const request = Object.freeze({ action, provider, integrations, repository: inspection.repository, specification: freeze(structuredClone(specification)), changes: freeze(structuredClone(inspection.changes)), fingerprintScope: inspection.fingerprintScope, workspaceFingerprint: inspection.fingerprint, runRevision: this.#controller?.snapshot().revision ?? null, existingChanges: "preserve", requiresReconciliation: action !== "launch", recovery: recovery && freeze(structuredClone(recovery)), signal });
			const answer = structuredClone(await Promise.race([Promise.resolve().then(() => {
				check(!signal.aborted, "CANCELLED", "Approval cancelled before presentation");
				return this.#ask(request);
			}), cancelled]));
			check(!signal.aborted && performance.now() < deadline, "CANCELLED", "Approval expired");
			this.#mode.assert(grant.token);
			check(answer?.approved === true, "AUTHORITY", "User did not approve this action");
			// Preservation is the only disposition; approval never grants cleanup authority.
			check(action === "launch" || action === "reconcile" || answer.reconciled === true, "UNSETTLED", "Explicit workspace reconciliation is required");
			check(answer.provider === undefined, "PROVIDER", "Approval cannot replace the host provider binding");
			// Settlement attestation grants no model authority and must remain available after provider failure.
			if (action !== "reconcile") this.#assertProvider(specification.model);
			const approved = answer.specification ?? specification;
			if (action !== "launch") check(specificationFingerprint(approved) === specificationFingerprint(specification), "SCOPE", "Continuation cannot silently change the approved scope");
			if (action === "reconcile") check(answer.attestation?.kind === "user-established-settlement" && typeof answer.attestation.evidence === "string" && answer.attestation.evidence.trim().length > 0 && answer.attestation.evidence.length <= 4096, "UNSETTLED", "Describe independently established process/session settlement; a boolean is not evidence");
			return { grant, specification: approved, attestation: answer.attestation, approval: { id: randomUUID(), action, workspaceFingerprint: inspection.fingerprint, specificationFingerprint: specificationFingerprint(approved), existingChanges: inspection.changes.length ? "preserve" : "clean", ...(provider ? { provider } : {}) } };
		} finally {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			if (this.#pending === pending) this.#pending = undefined;
			this.#publish("approval.finished");
		}
	}

	async #inspect(workspace, operation) {
		this.#assertOperation(operation);
		const signal = AbortSignal.any([operation.cancel.signal, this.#lifetime.signal]);
		const inspection = await inspectCheckout(workspace, { signal });
		this.#assertOperation(operation);
		return inspection;
	}

	async #unchanged(inspection, grant, operation) {
		this.#mode.assert(grant.token);
		const current = await this.#inspect(inspection.root, operation);
		this.#mode.assert(grant.token);
		check(current.fingerprint === inspection.fingerprint, "STALE", "Workspace changed while approval was pending; inspect and approve again");
	}

	#wire() { return inPhase("attachment", () => this.#attachRuntimes()); }

	async #attachRuntimes() {
		this.#unsubscribe?.();
		this.#unsubscribe = this.#controller.subscribe(event => this.#publish(event.type));
		const recorded = this.#controller.snapshot().hostApprovals.at(-1)?.provider;
		const configured = this.#providerCapability ? providerDescriptor(this.#providerCapability) : undefined;
		check(!recorded || (configured && specificationFingerprint(recorded) === specificationFingerprint(configured)),
			"PROVIDER", "Restore requires the original host provider capability");
		this.#assertProvider(this.#specification().model);
		const admission = { assert: () => this.#assertAdmission(), signal: () => this.#permit?.signal ?? this.#denied };
		this.#workspace = await WorkspaceRuntime.attach(this.#controller, {
			signal: AbortSignal.any([this.#lifetime.signal, ...(this.#operation ? [this.#operation.cancel.signal] : [])]),
			admission, runner: this.#runner, authorize: async request => {
				this.#assertAdmission();
				const permit = this.#permit;
				const signal = AbortSignal.any([request.signal, permit.signal]);
				const shell = ["shell", "final"].includes(request.kind);
				const value = { agent: request.workerId ?? "swarm final verification", tool: shell ? "bash" : request.kind };
				check(this.#specification().codingTools.includes(value.tool), "AUTHORITY", "Operation requires an approved coding tool");
				if (shell) value.command = request.command;
				else value.path = resolve(this.#location.workspace, request.paths[0]);
				let result;
				this.#pendingSafety++;
				this.#publish("approval.pending");
				try {
					await this.#beforePrompt();
					this.#assertAdmission();
					result = await requestSafety({ events: this.#events, request: value, signal, timeoutMs: this.#safetyTimeout });
					if (result.unclaimed && !this.#safetySeen) {
						// The owner approved the disclosed bounded tool policy for this run.
						// A previously observed or malformed Safety provider never falls back.
						result = { approved: !signal.aborted };
					} else if (!result.unclaimed) this.#safetySeen = true;
				} finally { this.#pendingSafety--; this.#publish("approval.finished"); }
				this.#assertAdmission();
				check(this.#permit === permit && !signal.aborted, "HOST_DENIED", "Approval belongs to an expired host admission");
				return result.approved === true;
			}
		});
		this.#driver = await SwarmSessions.attach(this.#controller, { workspace: this.#workspace, modelRuntime: this.#modelRuntime, mainModel: this.#modelRuntime.getModel(this.#specification().model.provider, this.#specification().model.modelId), thinkingLevel: this.#specification().model.thinkingLevel, codingTools: this.#specification().codingTools, instructions: this.#specification().instructions, tickIntervalMs: this.#tickInterval, admission, providerCapability: this.#providerCapability });
	}

	#launchSpecification;
	#specification() {
		const state = this.#controller.snapshot();
		return state.sessions ? { objective: state.objective, criteria: state.criteria, scope: state.scope, limits: state.limits, model: state.sessions.selection, codingTools: state.sessions.codingTools, instructions: state.sessions.instructions } : this.#launchSpecification;
	}

	launch(input) { return this.#runOperation("launch", operation => this.#launch(input, operation)); }
	async #launch({ workspace, runId, specification }, operation) {
		this.#assertOperation(operation);
		check(!this.#controller && !this.#pending, "STATE", "Host already owns a run or approval");
		check(validId(runId), "INPUT", "Invalid run identifier");
		this.#mode.capture();
		const inspection = await this.#inspect(workspace, operation);
		const runPath = prepareLayout(inspection.root, runId).runRoot;
		try { lstatSync(runPath); throw new SwarmError("DUPLICATE", "Run already exists; restore it instead"); }
		catch (error) { if (error.code !== "ENOENT") throw error; }
		const draft = this.#draft(specification);
		this.#validate(draft, inspection.root, runId);
		const accepted = await this.#approval("launch", inspection, draft);
		this.#validate(accepted.specification, inspection.root, runId);
		await this.#unchanged(inspection, accepted.grant, operation);
		this.#location = { workspace: inspection.root, runId, ownerSessionId: this.#sessionId };
		this.#launchSpecification = accepted.specification;
		try {
			this.#controller = await inPhase("storage", () => SwarmController.open({ ...this.#location, create: accepted.specification, createOnly: true }));
			this.#assertOperation(operation);
			await this.#unchanged(inspection, accepted.grant, operation);
			await this.#controller.owner("host.approve", { approval: accepted.approval });
			await this.#wire();
			this.#assertOperation(operation);
			await this.#unchanged(inspection, accepted.grant, operation);
			this.#setPermit(accepted.grant, operation);
			await this.#driver.resume({ reconciled: true });
			return this.snapshot();
		} catch (error) {
			this.#invalidate();
			if (this.#driver) await this.#driver.pause().catch(() => { });
			throw error;
		}
	}

	restore(input) { return this.#runOperation("restore", operation => this.#restore(input, operation)); }
	async #restore({ workspace, runId }, operation) {
		this.#assertOperation(operation);
		check(!this.#controller && !this.#pending, "STATE", "Host already owns a run");
		const grant = this.#mode.capture();
		this.#location = { workspace, runId, ownerSessionId: this.#sessionId };
		this.#controller = await SwarmController.open({ ...this.#location, adopt: true });
		this.#assertOperation(operation);
		check(this.#controller.snapshot().sessions, "STATE", "Only configured SDK runs can be restored");
		await this.#wire();
		this.#assertOperation(operation);
		this.#mode.assert(grant.token);
		this.#publish("run.restored");
		return this.snapshot(); // Restoring does not grant execution authority.
	}

	resume(options = {}) { return this.#runOperation(options.restart ? "restart" : "resume", operation => this.#resume(options, operation)); }
	async #resume({ restart = false }, operation) {
		this.#assertOperation(operation);
		check(this.#controller && !this.#pending, "STATE", "No run or approval already pending");
		const state = this.#controller.snapshot();
		check((restart ? ["paused", "stopped", "completed", "failed"] : ["paused"]).includes(state.status), "STATE", "Settle the run before continuation");
		check(!state.sessions.turns.length && !state.workspace.operations.length && !this.#driver?.snapshot().active.length, "UNSETTLED", "Execution remains unsettled");
		const inspection = await this.#inspect(state.workspaceRoot, operation);
		const accepted = await this.#approval(restart ? "restart" : "resume", inspection, this.#specification());
		await this.#unchanged(inspection, accepted.grant, operation);
		check(this.#controller.snapshot().revision === state.revision, "STALE", "Run changed during approval");
		if (["stopped", "completed", "failed"].includes(state.status)) {
			await this.#driver?.close();
			this.#driver = undefined;
			this.#workspace = undefined;
			this.#controller = await SwarmController.open({ ...this.#location, adopt: true });
			this.#assertOperation(operation);
			await this.#wire();
		} else if (!this.#driver) await this.#wire();
		this.#assertOperation(operation);
		await this.#unchanged(inspection, accepted.grant, operation);
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
		// Do not let a stalled launch/resume inspection delay the durable stop or
		// native session/process cancellation for an already attached driver.
		const driver = this.#driver;
		const draining = driver?.pause(options);
		const settle = (async () => {
			const result = await draining;
			if (pending) await pending.catch(() => { });
			// Preparation may have attached a driver before observing cancellation.
			if (this.#driver && this.#driver !== driver) return this.#driver.pause(options);
			return result ?? { settled: true };
		})();
		try {
			return await Promise.race([settle, new Promise(resolve => { timer = setTimeout(() => resolve({ settled: false }), timeoutMs); })]);
		} finally { clearTimeout(timer); }
	}
	/** Human attestation retires uncertainty, never certifies successful execution. */
	reconcile() {
		return this.#runOperation("reconcile", async operation => {
			const state = this.#controller?.snapshot();
			check(state && this.#workspace && this.#driver && ["paused", "pausing", "stopping", "failing"].includes(state.status), "STATE", "Pause before reconciliation");
			const live = this.#workspace.snapshot().uncertain;
			check(this.#driver.snapshot().active.every(workerId => state.workspace.operations.some(item => item.workerId === workerId && live.includes(item.id))), "UNSETTLED", "Live SDK turns must settle normally unless waiting on an identified uncertain operation");
			const recovery = { operations: state.workspace.operations, turns: state.sessions.turns, liveUncertainIds: live };
			check(recovery.operations.length || recovery.turns.length, "STATE", "No interrupted execution to reconcile");
			const inspection = await this.#inspect(state.workspaceRoot, operation);
			const accepted = await this.#approval("reconcile", inspection, this.#specification(), recovery);
			this.#assertOperation(operation);
			await this.#unchanged(inspection, accepted.grant, operation);
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
		});
	}

	send(workerId, text, topic) {
		this.#assertAdmission();
		check(recipientId(workerId, this.#controller.snapshot().workers) === "@board" || this.#controller.snapshot().workers.some(worker => worker.id === workerId), "INPUT", "Use a worker or board recipient");
		return this.#driver.send(workerId, text, topic);
	}

	wake(workerId, reason) { this.#assertAdmission(); return this.#driver.wake(workerId, reason); }
	recruit(specification) {
		return this.#runOperation("control", async operation => {
			this.#assertAdmission();
			const result = await this.#driver.recruit(specification);
			this.#assertOperation(operation);
			return result;
		});
	}
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
			this.#unsubscribe?.();
			this.#listeners.clear();
		})().finally(() => { this.#closing = undefined; });
		return this.#closing;
	}
}
