import { SwarmHost } from "./host.mjs";
import { randomUUID } from "node:crypto";
import { ModeGate } from "./host-gates.mjs";
import { createFocusBridge } from "./focus.mjs";
import { createProgress } from "./progress.mjs";
import { prepareLayout } from "./store/layout.mjs";
import { requireCondition as check } from "./errors.mjs";
import { createNativeRuntime } from "./native-provider.mjs";
import { createEmergencyInput } from "./emergency-input.mjs";
import { showDashboard } from "./dashboard.mjs";
import { specificationFingerprint } from "./host-approval.mjs";
import { requestLaunchSpecification } from "./launch-input.mjs";
import { registerMainTools, swarmSummary } from "./main-tools.mjs";
import { inspectLease, releaseStaleLease } from "./store/lease.mjs";
import { assertProviderSelection } from "./provider-capability.mjs";
import { registerSwarmRenderers, approvalPacket, statusText } from "./ui.mjs";

const LINK = "swarm-run-v1";

/** Explicit public host injection; no runtime creation, auth lookup, or discovery. */
export async function createNativeSwarmExtension(options) {
	const native = await createNativeRuntime(options);
	return createSwarmExtension({ ...options, ...native });
}

/** Normal Pi entry: register now, bind the current public context only on demand. */
export function createCurrentSwarmExtension() {
	return configureSwarmExtension({}, async (ctx, pi) => {
		check(ctx.model, "MODEL", "Select a physical chat model with /model before starting Swarm");
		return createNativeRuntime({
			modelRegistry: ctx.modelRegistry, mainModel: ctx.model,
			thinkingLevel: pi.getThinkingLevel()
		});
	});
}

/** Explicit injection remains mock-only unless a branded provider capability is supplied. */
export function createSwarmExtension(options = {}) {
	const { modelRuntime, mainModel, thinkingLevel = "off", providerCapability } = options;
	if (providerCapability) assertProviderSelection(providerCapability, { provider: mainModel?.provider, modelId: mainModel?.id, thinkingLevel }, modelRuntime);
	check(providerCapability || (mainModel?.provider === "swarm-mock" && mainModel.api === "swarm-mock" && modelRuntime), "MODEL", "An explicitly injected mock runtime is required");
	return configureSwarmExtension(options);
}

function configureSwarmExtension({ modelRuntime, mainModel, thinkingLevel = "off", codingTools, instructions, runner, tickIntervalMs = 1000, approvalTimeoutMs = 120000, providerCapability } = {}, resolveSelection) {
	return function swarmExtension(pi) {
		registerSwarmRenderers(pi);
		let host;
		let focus;
		let approve;
		let owner;
		let context;
		let command;
		let retired = false;
		let viewing = false;
		let dashboard;
		let restoreLink;
		let restoring;
		let contextEpoch = 0;
		let terminalInput;
		let emergencyInput;
		let emergencyStop;
		let promptDepth = 0;
		let proposal;
		const clearProposal = () => {
			const previous = proposal;
			proposal = undefined;
			previous?.gate.dispose();
		};
		const progressContext = () => !retired && context && (!owner || owner === context.sessionManager.getSessionId()) ? context : undefined;
		let progress = createProgress(pi, progressContext);
		const cancel = () => { contextEpoch++; clearProposal(); command?.abort(); };
		const notify = (ctx, text, level = "info") => { if (ctx.hasUI) ctx.ui.notify(text, level); };
		const contextGuard = (ctx, signal) => {
			const epoch = contextEpoch;
			const sessionId = ctx.sessionManager.getSessionId();
			const cwd = ctx.cwd;
			const model = specificationFingerprint(ctx.model ?? null);
			const thinking = pi.getThinkingLevel?.();
			return () => !retired && epoch === contextEpoch && !signal?.aborted
				&& ctx.sessionManager.getSessionId() === sessionId && (!owner || owner === sessionId)
				&& ctx.cwd === cwd && specificationFingerprint(ctx.model ?? null) === model && pi.getThinkingLevel?.() === thinking;
		};
		const sendMessage = (args, ctx, signal, expectedHost = host, runId = host?.snapshot().run?.runId) => {
			inspect(ctx);
			const run = host?.snapshot().run;
			check(!signal?.aborted && host === expectedHost && run?.runId === runId && run?.workspaceRoot === ctx.cwd, "OWNERSHIP", "Message context changed");
			check(host && typeof args.to === "string" && typeof args.text === "string" && args.text.trim() && args.text.length <= 32768, "INPUT", "A recipient and message are required");
			return host.send(args.to, args.text, args.topic);
		};
		const ensureHost = async (ctx, { retainPreparation = false } = {}) => {
			const sessionId = ctx.sessionManager.getSessionId();
			check(ctx.sessionManager.getSessionFile(), "SESSION", "A persisted owner session is required");
			check(!owner || owner === sessionId, "OWNERSHIP", "Another session owns this host");
			owner = sessionId;
			context = ctx;
			// Another extension may veto navigation after our before-switch handler.
			// A later explicit control must then regain observation of this same owner.
			if (progress.disposed) {
				progress = createProgress(pi, progressContext);
				if (host) progress.bind(host);
			}
			const current = contextGuard(ctx);
			// Cancelled input/approval must not cache a startup model for the next launch.
			if (resolveSelection && host && !host.snapshot().run && !retainPreparation) {
				await host.close();
				host = undefined;
				check(current(), "OWNERSHIP", "Swarm context changed during preparation");
			}
			if (!host) {
				const selection = resolveSelection ? await resolveSelection(ctx, pi) : { modelRuntime, mainModel, thinkingLevel, providerCapability };
				check(current(), "OWNERSHIP", "Swarm context changed during preparation");
				host = new SwarmHost({
					events: pi.events, sessionId, codingTools, instructions, runner, tickIntervalMs, approvalTimeoutMs, ...selection,
					requestApproval: request => approve ? approve(request) : { approved: false },
					beforePrompt: async () => { if (viewing) { cancel(); await dashboard; } }
				});
				progress.bind(host);
				focus?.dispose();
				const currentHost = host;
				focus = createFocusBridge(pi, Object.freeze({ snapshot: () => currentHost.snapshot(), history: id => currentHost.history(id), subscribe: listener => currentHost.subscribe(listener) }), ctx.ui, {
					send: (to, text, runId) => {
						const currentContext = progressContext();
						check(currentContext?.mode === "tui" && currentContext.hasUI, "OWNERSHIP", "Message context changed");
						return sendMessage({ to, text }, currentContext, undefined, currentHost, runId);
					}
				});
			}
			return host;
		};
		const restorePending = async ctx => {
			if (!restoreLink) return;
			if (!restoring) restoring = (async () => {
				const current = contextGuard(ctx);
				const activeHost = await ensureHost(ctx);
				check(current(), "OWNERSHIP", "Swarm context changed during preparation");
				await activeHost.restore({ workspace: ctx.cwd, runId: restoreLink.runId });
				restoreLink = undefined;
			})();
			try { await restoring; }
			catch (error) {
				// A partial restore may already own storage. Keep status/brakes usable
				// rather than repeatedly attempting to open the same controller.
				if (host?.snapshot().run) restoreLink = undefined;
				throw error;
			} finally { restoring = undefined; }
		};
		const remember = ctx => {
			const run = host?.snapshot().run;
			if (!run || retired || ctx.sessionManager.getSessionId() !== owner) return;
			const last = ctx.sessionManager.getBranch().filter(entry => entry.type === "custom" && entry.customType === LINK).at(-1)?.data;
			if (last?.runId !== run.runId || last?.ownerSessionId !== owner) pi.appendEntry(LINK, { runId: run.runId, ownerSessionId: owner });
		};
		const brake = async (ctx, stop = false) => {
			cancel();
			const result = host ? await host.pause({ stop }) : { settled: true };
			if (!result.settled) notify(ctx, "Stop/pause incomplete. Ownership retained; inspect status and reconcile only after independently establishing settlement.", "warning");
			return result;
		};

		const stopImmediately = ctx => {
			check(!retired && (!owner || owner === ctx.sessionManager.getSessionId()), "OWNERSHIP", "This session cannot control the Swarm host");
			if (emergencyStop) return emergencyStop;
			// Fence admission and dismiss approvals before doing any asynchronous work.
			cancel();
			focus?.hide();
			notify(ctx, "Swarm emergency stop requested. Cancelling approvals, workers and their commands.", "warning");
			emergencyStop = control("stop", ctx).then(result => {
				if (result?.settled) {
					notify(ctx, "Swarm stopped. No workers will restart without fresh approval.");
				}
			}).catch(error => {
				notify(ctx, "Swarm emergency stop could not establish settlement. Execution is fenced; ownership retained. Inspect status before recovery.", "error");
				throw error;
			}).finally(() => { emergencyStop = undefined; });
			return emergencyStop;
		};
		const bindEmergencyInput = ctx => {
			terminalInput?.();
			emergencyInput?.reset();
			if (ctx.mode !== "tui" || !ctx.hasUI || !ctx.ui.onTerminalInput) return;
			emergencyInput = createEmergencyInput({
				enabled: () => !retired && (!owner || owner === ctx.sessionManager.getSessionId())
					&& Boolean(command || proposal || restoreLink || host?.snapshot().run),
				canCapture: () => promptDepth > 0 || viewing || focus?.active || !ctx.ui.getEditorText?.(),
				pendingChanged: text => ctx.ui.setStatus?.("swarm-emergency", text || undefined),
				stop: () => {
					if (ctx.ui.getEditorText?.().trim() === "/swarm stop") ctx.ui.setEditorText?.("");
					void stopImmediately(ctx).catch(() => { });
				},
			});
			terminalInput = ctx.ui.onTerminalInput(data => emergencyInput.handle(data));
		};

		// The raw listener runs before dialogs/overlays; a slash handler alone cannot
		// receive /swarm stop when a worker confirmation owns terminal focus.
		pi.on("agent_settled", () => progress.settled());
		pi.on("input", (event, ctx) => {
			if (event.source !== "extension") progress.input();
			// Only new input from the owning interactive editor can grant consent.
			// Extension/worker messages, RPC input, tool arguments and old transcripts cannot.
			if (event.source !== "interactive" || !proposal) return;
			const pending = proposal;
			try {
				pending.assertCurrent(ctx);
				const text = typeof event.text === "string" ? event.text.trim() : "";
				if (pending.recovery) {
					const match = /^I confirm settlement:\s*([\s\S]+)$/i.exec(text);
					const evidence = match?.[1].trim();
					check(evidence?.length > 0 && evidence.length <= 4096, "UNSETTLED", "Independent settlement evidence is required");
					pending.evidence = evidence;
				} else check(/^(?:yes|confirm)[.!]?$/i.test(text), "AUTHORITY", "Confirm the exact pending proposal");
				pending.confirmed = true;
			} catch { clearProposal(); }
		});
		pi.on("ui_prompt_start", event => { promptDepth++; focus?.hide(); clearProposal(); if (viewing && event.kind !== "custom") cancel(); });
		pi.on("ui_prompt_end", () => { promptDepth = Math.max(0, promptDepth - 1); });

		// `ask` and `present` belong to the main tool call; the public command only stops.
		const control = async (args, ctx, signal, ask, present, launchOptions, retainPreparation = false) => {
			const [action = "", ...rest] = args.trim().split(/\s+/);
			check(!retired && (!owner || owner === ctx.sessionManager.getSessionId()), "OWNERSHIP", "This session cannot control the Swarm host");
			if (action === "pause" || action === "stop") {
				cancel();
				const current = contextGuard(ctx);
				if (restoreLink && !restoring) await restorePending(ctx);
				if (!current()) return;
				return brake(ctx, action === "stop");
			}
			if (action === "reconcile" && !host?.snapshot().run) {
				const runId = rest[0] ?? restoreLink?.runId;
				check(runId, "INPUT", "Ask the main agent to reconcile a crashed controller by run ID");
				check(ctx.mode === "tui" && ctx.hasUI, "AUTHORITY", "Interactive recovery is required");
				const layout = prepareLayout(ctx.cwd, runId);
				const lease = inspectLease(layout);
				check(lease && lease.runId === runId && lease.ownerSessionId === ctx.sessionManager.getSessionId(), "OWNERSHIP", "Reconcile the controller lease from its original owning session");
				const current = contextGuard(ctx, signal);
				check(typeof ask === "function", "AUTHORITY", "Chat settlement attestation is required");
				const answer = await ask({ action: "release-lease", specification: {}, changes: [], recovery: { runId, lease }, signal });
				check(current(), "CANCELLED", "Recovery context changed");
				check(answer?.approved === true && answer.attestation?.evidence?.trim(), "AUTHORITY", "Independent settlement attestation is required");
				releaseStaleLease(layout, lease, { settled: true });
				return;
			}
			// Startup handler order does not establish policy readiness. Native reload
			// reattaches only on explicit control, after all startup providers are bound.
			if (restoreLink) {
				const preparationCurrent = contextGuard(ctx);
				await restorePending(ctx);
				if (!preparationCurrent()) return;
			}
			if (action === "status") { notify(ctx, statusText(host?.snapshot())); return; }
			check(!retired && !command, "BUSY", "Swarm control is busy or this extension instance is retired");
			check(ctx.mode === "tui" && ctx.hasUI, "UI", "Swarm controls require interactive TUI");
			check(!signal?.aborted, "CANCELLED", "Swarm request cancelled");
			const pending = new AbortController();
			command = pending;
			approve = ask ?? (() => ({ approved: false }));
			const abort = () => { pending.abort(); void brake(ctx).catch(() => { }); };
			signal?.addEventListener("abort", abort, { once: true });
			const current = contextGuard(ctx, pending.signal);
			let setupGate;
			try {
				let selected = action;
				if (!selected || selected === "dashboard") {
					const source = Object.freeze({ snapshot: () => host?.snapshot(), history: workerId => host.history(workerId) });
					check(!host?.snapshot().pendingApproval, "BUSY", "A Swarm operation approval is already active");
					try {
						dashboard = showDashboard(ctx, source, pending.signal, () => { viewing = true; });
						selected = await dashboard;
					} finally { viewing = false; dashboard = undefined; }
				}
				if (!selected || selected === "Cancel" || pending.signal.aborted) return;
				if (selected === "status") { notify(ctx, statusText(host?.snapshot())); return; }
				if (["pause", "stop"].includes(selected)) { await brake(ctx, selected === "stop"); return; }
				let activeHost;
				if (selected === "start") {
					if (resolveSelection) check(ctx.model, "MODEL", "Select a physical chat model with /model before starting Swarm");
					check(ctx.sessionManager.getSessionFile(), "SESSION", "A persisted owner session is required");
					setupGate = new ModeGate({ events: pi.events, sessionId: ctx.sessionManager.getSessionId(), onRevoke: () => { if (setupGate) pending.abort(); } });
					const permission = setupGate.capture();
					const assertCurrent = () => {
						check(current(), "OWNERSHIP", "Swarm setup was cancelled or its context changed");
						setupGate.assert(permission.token);
					};
					assertCurrent();
					const specification = await requestLaunchSpecification(ctx, launchOptions ?? { objective: args.trimStart().replace(/^start(?:\s|$)/, "") }, pending.signal, current);
					if (!current() || !specification) return;
					assertCurrent();
					const finishedGate = setupGate;
					setupGate = undefined;
					finishedGate.dispose();
					activeHost = await ensureHost(ctx, { retainPreparation });
					if (!current()) return;
					present?.("Inspecting Swarm workspace before approval. Git checkouts fingerprint tracked and non-ignored files; ignored files remain protected by per-operation checks. Inspection is cancellable and has a 120-second deadline. No worker has started.");
					await activeHost.launch({ workspace: ctx.cwd, runId: randomUUID(), specification });
					if (current()) progress.launched();
					remember(ctx);
					if (pending.signal.aborted || retired) return;
					await activeHost.recruit({ id: "planner", specialization: "Objective decomposition and coordination", brief: "Investigate the approved objective, create criterion-linked tasks, and recruit only useful independent specialists within limits.", reason: "Initial investigation and decomposition of the user-approved objective" });
					if (!pending.signal.aborted && !retired) activeHost.wake("planner");
				} else if (selected === "restore") {
					check(rest.length === 1, "INPUT", "Use restore <run-id>");
					activeHost = await ensureHost(ctx);
					if (!current()) return;
					await activeHost.restore({ workspace: ctx.cwd, runId: rest[0] });
				} else if (selected === "resume" || selected === "restart") {
					activeHost = await ensureHost(ctx);
					if (!current()) return;
					present?.("Inspecting Swarm workspace before continuation approval; no new worker execution is authorized. Inspection is cancellable and bounded.");
					await activeHost.resume({ restart: selected === "restart" });
					if (current()) progress.continued();
					if (!pending.signal.aborted && !retired) for (const worker of activeHost.snapshot().run.workers) activeHost.wake(worker.id);
				} else if (selected === "reconcile") {
					activeHost = await ensureHost(ctx);
					if (!current()) return;
					const result = await activeHost.reconcile();
					if (!result.settled) notify(ctx, "Attestation recorded. Waiting for live SDK/tool frames to settle; execution remains fenced.", "warning");
				} else check(false, "INPUT", "Use start, status, pause, stop, restore <run-id>, resume, restart, or reconcile");
				if (!retired) notify(ctx, statusText(activeHost.snapshot()));
			} catch (error) {
				if (ask) throw error;
				if (error.code === "INPUT") {
					if (current()) notify(ctx, "Invalid Swarm input. Check the command and agreement fields, then try again. No automatic retry or rollback.", "warning");
					return;
				}
				if (!retired) notify(ctx, `Swarm control failed (${error.code ?? "INPUT"}). No automatic retry or rollback. Inspect status before continuing.`, "error");
				throw error;
			} finally {
				signal?.removeEventListener("abort", abort);
				setupGate?.dispose();
				remember(ctx);
				viewing = false;
				if (command === pending) { command = undefined; approve = undefined; }
			}
		};
		// A proposal returns before the human replies. No tool frame waits for chat;
		// only a later owner input event can mint its one-shot execution capability.
		const chatControl = async (action, args, ctx, signal, update) => {
			if (action === "send") {
				await sendMessage(args, ctx, signal);
				return inspect(ctx);
			}
			if (["pause", "stop", "status", "view"].includes(action)) { await control(action === "view" ? "dashboard" : action, ctx, signal); return inspect(ctx); }
			check(!retired && !command && (!owner || owner === ctx.sessionManager.getSessionId()), "OWNERSHIP", "Swarm control context is unavailable");
			check(ctx.mode === "tui" && ctx.hasUI, "UI", "Swarm approval requires interactive owner chat");
			let accepted;
			if (args.proposalId !== undefined) {
				check(Object.keys(args).every(key => ["action", "proposalId"].includes(key)), "INPUT", "Confirmation cannot replace proposal fields");
				check(proposal?.id === args.proposalId && proposal.action === action && proposal.confirmed, "AUTHORITY", "Current explicit owner confirmation is required");
				accepted = proposal;
				// Consume before any await. Errors and cancellation never restore consent.
				proposal = undefined;
				args = accepted.args;
			} else clearProposal();
			check(!["restore", "reconcile"].includes(action) || args.runId === undefined || /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(args.runId), "INPUT", "Invalid run identifier");
			check(action !== "restore" || args.runId, "INPUT", "Restore requires a run identifier");
			const revoked = accepted?.revoked ?? new AbortController();
			const current = contextGuard(ctx, signal);
			const model = specificationFingerprint(ctx.model ?? null);
			const thinking = pi.getThinkingLevel?.();
			const registry = ctx.modelRegistry;
			const cwd = ctx.cwd;
			const sessionId = ctx.sessionManager.getSessionId();
			const sessionFile = ctx.sessionManager.getSessionFile();
			const gate = accepted?.gate ?? new ModeGate({ events: pi.events, sessionId, onRevoke: () => {
				revoked.abort();
				if (proposal?.gate === gate) clearProposal();
			} });
			let created;
			try {
				const permission = gate.capture();
				const assertCurrent = (candidate = ctx) => {
					check(current() && candidate?.mode === "tui" && candidate.hasUI
						&& candidate.sessionManager.getSessionId() === sessionId && candidate.sessionManager.getSessionFile() === sessionFile
						&& candidate.cwd === cwd && candidate.modelRegistry === registry
						&& specificationFingerprint(candidate.model ?? null) === model && pi.getThinkingLevel?.() === thinking, "OWNERSHIP", "Approval context changed");
					gate.assert(permission.token);
				};
				accepted?.assertCurrent(ctx);
				assertCurrent();
				const present = text => update?.({ content: [{ type: "text", text }], details: {} });
				const ask = async request => {
					assertCurrent();
					check(!request.signal?.aborted, "CANCELLED", "Approval cancelled before presentation");
					const { signal: _signal, ...packet } = request;
					const fingerprint = specificationFingerprint(packet);
					if (accepted) {
						accepted.assertCurrent(ctx);
						check(fingerprint === accepted.fingerprint, "STALE", "Proposal workspace, run or provider changed; propose again");
						return { approved: true, specification: request.specification, existingChanges: "preserve", reconciled: true,
							...(accepted.recovery ? { attestation: { kind: "user-established-settlement", evidence: accepted.evidence } } : {}) };
					}
					const expiresAt = Date.now() + approvalTimeoutMs;
					const deadline = performance.now() + approvalTimeoutMs;
					created = { id: randomUUID(), action, args: structuredClone(args), fingerprint, gate, revoked, confirmed: false,
						recovery: ["reconcile", "release-lease"].includes(request.action), expiresAt,
						assertCurrent: candidate => { assertCurrent(candidate); check(performance.now() < deadline, "CANCELLED", "Proposal expired"); } };
					created.agreement = approvalPacket({ ...request, workspace: cwd });
					created.confirmationPrompt = created.recovery
						? "Independently establish that ALL listed execution has stopped, then reply: I confirm settlement: <how you established this>. Missing PID, timeout or no output is not proof. Unknown effects stay unknown; nothing is replayed."
						: "Shall I proceed with this exact Swarm configuration? Reply yes or confirm to approve, or ask for changes. Resume preserves allowances; restart resets them. Existing and generated changes are kept.";
					present(`${created.agreement}\n${created.confirmationPrompt}`);
					return { approved: false }; // Inspection only: no storage or workers.
				};
				const stop = AbortSignal.any([revoked.signal, ...(signal ? [signal] : [])]);
				try {
					await control(action === "start" ? "start" : `${action}${args.runId ? ` ${args.runId}` : ""}`, ctx, stop, ask, present, action === "start" ? args : undefined, Boolean(accepted));
				} catch (error) {
					if (!accepted && created && error.code === "AUTHORITY") {
						created.assertCurrent(ctx);
						proposal = created;
						return { ...inspect(ctx), awaitingConfirmation: true, proposalId: created.id, action, expiresAt: created.expiresAt,
							agreement: created.agreement, confirmationPrompt: created.confirmationPrompt };
					}
					throw error;
				}
				assertCurrent();
				return inspect(ctx);
			} finally { if (proposal?.gate !== gate) gate.dispose(); }
		};
		pi.registerCommand("swarm", {
			description: "Emergency stop only: /swarm stop. Ask the main agent for all other Swarm actions.",
			getArgumentCompletions: prefix => prefix.trim() !== "stop" && "stop".startsWith(prefix.trim()) ? [{ value: "stop", label: "stop" }] : null,
			handler: async (args, ctx) => {
				if (args.trim() !== "stop") {
					notify(ctx, "Use /swarm stop to stop immediately. Ask the main agent to start, inspect, pause, restore, resume, restart, or reconcile Swarm.", "info");
					return;
				}
				return stopImmediately(ctx);
			},
		});
		const inspect = ctx => {
			check(!retired && (!owner || owner === ctx.sessionManager.getSessionId()), "OWNERSHIP", "This session cannot inspect the Swarm host");
			return { ...swarmSummary(host?.snapshot()), restorePending: Boolean(restoreLink),
				...(proposal ? { pendingAuthorization: { proposalId: proposal.id, action: proposal.action, confirmed: proposal.confirmed, expiresAt: proposal.expiresAt } } : {}) };
		};
		registerMainTools(pi, {
			control, chatControl, inspect, revoke: ctx => { inspect(ctx); cancel(); }, messages: ctx => { inspect(ctx); return host?.snapshot().run?.messages ?? []; }, history: (workerId, ctx) => {
				inspect(ctx);
				check(host, "STATE", "No attached Swarm run");
				return host.history(workerId);
			}
		});

		pi.on("session_start", async (event, ctx) => {
			context = ctx;
			bindEmergencyInput(ctx);
			if (event.reason === "fork" || retired) return;
			const link = ctx.sessionManager.getBranch().filter(entry => entry.type === "custom" && entry.customType === LINK).at(-1)?.data;
			if (!link || link.ownerSessionId !== ctx.sessionManager.getSessionId()) return;
			if (resolveSelection) { restoreLink = link; return; }
			const current = contextGuard(ctx);
			try {
				const activeHost = await ensureHost(ctx);
				if (!current()) return;
				await activeHost.restore({ workspace: ctx.cwd, runId: link.runId });
			}
			catch { notify(ctx, "Swarm restore blocked. Storage and ownership were preserved; inspect before recovery. Nothing was resumed.", "warning"); }
		});
		// Main selection never rewrites a run's durable model. Revoke, then require
		// fresh approval of the pinned selection before any continuation.
		if (resolveSelection) for (const event of ["model_select", "thinking_level_select"]) {
			pi.on(event, async (_event, ctx) => { await brake(ctx); });
		}
		for (const event of ["session_before_switch", "session_before_fork", "session_before_tree"]) {
			pi.on(event, async (_event, ctx) => {
				const result = await brake(ctx);
				if (result.settled) {
					progress.dispose();
					// Preparation without durable ownership must not strand the next session.
					if (host && !host.snapshot().run) {
						await host.close();
						host = undefined;
						owner = undefined;
						focus?.dispose();
						focus = undefined;
					}
				}
				return { cancel: !result.settled };
			});
		}
		pi.on("session_tree", (_event, ctx) => {
			context = ctx;
			progress.dispose();
			progress = createProgress(pi, progressContext);
			if (host) progress.bind(host);
		});
		pi.on("session_shutdown", async (_event, ctx) => {
			retired = true;
			terminalInput?.();
			emergencyInput?.reset();
			focus?.dispose();
			progress.dispose();
			cancel();
			try { await host?.close(); }
			catch { notify(ctx, "Swarm shutdown incomplete. Ownership remains fenced; no stale-lock takeover is supported.", "error"); }
		});
	};
}
