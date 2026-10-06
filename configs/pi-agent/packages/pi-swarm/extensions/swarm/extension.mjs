import { SwarmHost } from "./host.mjs";
import { randomUUID } from "node:crypto";
import { ModeGate } from "./host-gates.mjs";
import { createFocusBridge } from "./focus.mjs";
import { createProgress } from "./progress.mjs";
import { prepareLayout } from "./store/layout.mjs";
import { requireCondition as check } from "./errors.mjs";
import { createNativeRuntime } from "./native-provider.mjs";
import { createEmergencyInput } from "./emergency-input.mjs";
import { displayText, showDashboard } from "./dashboard.mjs";
import { specificationFingerprint } from "./host-approval.mjs";
import { requestLaunchSpecification } from "./launch-input.mjs";
import { registerMainTools, swarmSummary } from "./main-tools.mjs";
import { inspectLease, releaseStaleLease } from "./store/lease.mjs";
import { assertProviderSelection } from "./provider-capability.mjs";
import { registerSwarmRenderers, requestUserApproval, statusText } from "./ui.mjs";

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
		const progressContext = () => !retired && context && (!owner || owner === context.sessionManager.getSessionId()) ? context : undefined;
		let progress = createProgress(pi, progressContext);
		const cancel = () => { contextEpoch++; command?.abort(); };
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
		const ensureHost = async ctx => {
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
			if (resolveSelection && host && !host.snapshot().run) {
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
					confirm: async (title, body, { signal }) => {
						const ctx = context;
						if (ctx?.mode !== "tui" || !ctx.hasUI || signal.aborted) return false;
						const current = contextGuard(ctx, signal);
						// Native notifications render immediately even during a main turn, unlike
						// deferred custom messages. Keep the complete, sanitized command above
						// the short Cancel-default dialog so the user can scroll through it.
						ctx.ui.notify(displayText(`${title}\n${body}`), "warning");
						const choice = await ctx.ui.select("Allow this worker operation? Read the command/path above.", ["Cancel", "Allow once"], { signal });
						return current() && choice === "Allow once";
					},
					beforePrompt: async () => { if (viewing) { cancel(); await dashboard; } }
				});
				progress.bind(host);
				focus?.dispose();
				const currentHost = host;
				focus = createFocusBridge(pi, Object.freeze({ snapshot: () => currentHost.snapshot(), history: id => currentHost.history(id), subscribe: listener => currentHost.subscribe(listener) }), ctx.ui);
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
					&& Boolean(command || restoreLink || host?.snapshot().run),
				canCapture: () => promptDepth > 0 || viewing || focus?.active || !ctx.ui.getEditorText?.(),
				pendingChanged: text => ctx.ui.setStatus?.("swarm-emergency", text || undefined),
				stop: () => {
					if (ctx.ui.getEditorText?.().trim() === "/swarm stop") ctx.ui.setEditorText?.("");
					void stopImmediately(ctx).catch(() => {});
				},
			});
			terminalInput = ctx.ui.onTerminalInput(data => emergencyInput.handle(data));
		};

		// The raw listener runs before dialogs/overlays; a slash handler alone cannot
		// receive /swarm stop when a worker confirmation owns terminal focus.
		pi.on("agent_settled", () => progress.settled());
		pi.on("input", event => { if (event.source !== "extension") progress.input(); });
		pi.on("ui_prompt_start", event => { promptDepth++; focus?.hide(); if (viewing && event.kind !== "custom") cancel(); });
		pi.on("ui_prompt_end", () => { promptDepth = Math.max(0, promptDepth - 1); });

		// `ask` and `present` belong to the main tool call; the public command only stops.
		const control = async (args, ctx, signal, ask, present) => {
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
				check(lease && lease.runId === runId, "OWNERSHIP", "No matching controller lease to reconcile");
				const current = contextGuard(ctx, signal);
				present?.(displayText(`Previous controller: session ${lease.ownerSessionId ?? "unknown"}, PID ${lease.pid ?? "unknown"}. Independently establish that this process AND all its commands have stopped before releasing the lease.`));
				const approved = await ctx.ui.select("Release the controller lease after establishing settlement?", ["Cancel", "Release settled controller lease"], { signal, timeout: approvalTimeoutMs });
				check(current(), "CANCELLED", "Recovery context changed");
				if (approved === "Release settled controller lease") releaseStaleLease(layout, lease, { settled: true });
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
					check(!host?.snapshot().pendingApproval, "BUSY", "A Swarm approval dialog is already active");
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
					const specification = await requestLaunchSpecification(ctx, args.trimStart().replace(/^start(?:\s|$)/, ""), pending.signal, current);
					if (!current() || !specification) return;
					assertCurrent();
					const finishedGate = setupGate;
					setupGate = undefined;
					finishedGate.dispose();
					activeHost = await ensureHost(ctx);
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
		// One tool call: the human decides in native dialogs inside this owning interactive
		// session. Tool arguments and chat text never reach the approval answer.
		const chatControl = async (action, args, ctx, signal, update) => {
			if (action === "send") {
				inspect(ctx);
				check(!signal?.aborted && host?.snapshot().run?.workspaceRoot === ctx.cwd, "OWNERSHIP", "Message context changed");
				check(host && typeof args.to === "string" && typeof args.text === "string" && args.text.trim(), "INPUT", "A recipient and message are required");
				await host.send(args.to, args.text, args.topic);
				return inspect(ctx);
			}
			if (["pause", "stop", "status", "view"].includes(action)) { await control(action === "view" ? "dashboard" : action, ctx, signal); return inspect(ctx); }
			check(!["restore", "reconcile"].includes(action) || args.runId === undefined || /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(args.runId), "INPUT", "Invalid run identifier");
			check(action !== "restore" || args.runId, "INPUT", "Restore requires a run identifier");
			check(ctx.mode === "tui" && ctx.hasUI && typeof update === "function", "UI", "Swarm approval requires interactive CLI mode");
			check(action !== "start" || (typeof args.objective === "string" && args.objective.trim().length > 0 && args.objective.length <= 32768), "INPUT", "A complete objective is required");
			const revoked = new AbortController();
			const current = contextGuard(ctx, signal);
			const model = specificationFingerprint(ctx.model ?? null);
			const thinking = pi.getThinkingLevel?.();
			const registry = ctx.modelRegistry;
			const cwd = ctx.cwd;
			const sessionId = ctx.sessionManager.getSessionId();
			const sessionFile = ctx.sessionManager.getSessionFile();
			const gate = new ModeGate({ events: pi.events, sessionId, onRevoke: () => revoked.abort() });
			try {
				const permission = gate.capture();
				// The human may take a while: re-check the calling context once the dialogs return.
				const assertCurrent = () => {
					check(current() && ctx.mode === "tui" && ctx.hasUI
						&& ctx.sessionManager.getSessionId() === sessionId && ctx.sessionManager.getSessionFile() === sessionFile
						&& ctx.cwd === cwd && ctx.modelRegistry === registry
						&& specificationFingerprint(ctx.model ?? null) === model && pi.getThinkingLevel?.() === thinking, "OWNERSHIP", "Approval context changed");
					gate.assert(permission.token);
				};
				// Mid-turn chat messages are deferred, so the packet streams as this tool's partial result.
				const present = text => update({ content: [{ type: "text", text }], details: {} });
				const ask = async request => {
					const answer = await requestUserApproval(ctx, request, present);
					assertCurrent();
					return answer;
				};
				const stop = AbortSignal.any([revoked.signal, ...(signal ? [signal] : [])]);
				await control(action === "start" ? `start ${args.objective}` : `${action}${args.runId ? ` ${args.runId}` : ""}`, ctx, stop, ask, present);
				return inspect(ctx);
			} finally { gate.dispose(); }
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
			return { ...swarmSummary(host?.snapshot()), restorePending: Boolean(restoreLink) };
		};
		registerMainTools(pi, {
			control, chatControl, inspect, messages: ctx => { inspect(ctx); return host?.snapshot().run?.messages ?? []; }, history: (workerId, ctx) => {
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
				if (result.settled) progress.dispose();
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
