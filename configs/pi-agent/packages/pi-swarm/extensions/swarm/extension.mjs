import { SwarmHost } from "./host.mjs";
import { randomUUID } from "node:crypto";
import { showDashboard } from "./dashboard.mjs";
import { requireCondition as check } from "./errors.mjs";
import { requestUserApproval, statusText } from "./ui.mjs";
import { createNativeRuntime } from "./native-provider.mjs";
import { assertProviderSelection } from "./provider-capability.mjs";

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
		return createNativeRuntime({ modelRegistry: ctx.modelRegistry, mainModel: ctx.model,
			thinkingLevel: pi.getThinkingLevel() });
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
		let host;
		let owner;
		let context;
		let command;
		let retired = false;
		let viewing = false;
		let dashboard;
		let restoreLink;
		let restoring;
		let contextEpoch = 0;
		const cancel = () => { contextEpoch++; command?.abort(); };
		const notify = (ctx, text, level = "info") => { if (ctx.hasUI) ctx.ui.notify(text, level); };
		const contextGuard = (ctx, signal) => {
			const epoch = contextEpoch;
			const sessionId = ctx.sessionManager.getSessionId();
			return () => !retired && epoch === contextEpoch && !signal?.aborted
				&& ctx.sessionManager.getSessionId() === sessionId && (!owner || owner === sessionId);
		};
		const ensureHost = async ctx => {
			const sessionId = ctx.sessionManager.getSessionId();
			check(ctx.sessionManager.getSessionFile(), "SESSION", "A persisted owner session is required");
			check(!owner || owner === sessionId, "OWNERSHIP", "Another session owns this host");
			owner = sessionId;
			context = ctx;
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
				host = new SwarmHost({ events: pi.events, sessionId, codingTools, instructions, runner, tickIntervalMs, approvalTimeoutMs, ...selection,
					requestApproval: request => requestUserApproval(context, request),
					beforePrompt: async () => { if (viewing) { cancel(); await dashboard; } } });
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
			const last = ctx.sessionManager.getEntries().filter(entry => entry.type === "custom" && entry.customType === LINK).at(-1)?.data;
			if (last?.runId !== run.runId || last?.ownerSessionId !== owner) pi.appendEntry(LINK, { runId: run.runId, ownerSessionId: owner });
		};
		const brake = async (ctx, stop = false) => {
			cancel();
			const result = host ? await host.pause({ stop }) : { settled: true };
			if (!result.settled) notify(ctx, "Stop/pause incomplete. Ownership retained; inspect status and reconcile only after independently establishing settlement.", "warning");
			return result;
		};

		// Yield the inspection view before a worker's native safety dialog is presented.
		pi.on("ui_prompt_start", event => { if (viewing && event.kind !== "custom") cancel(); });

		pi.registerCommand("swarm", {
			description: "Swarm dashboard, launch, status, pause, stop, resume, restart, and reconciliation",
			handler: async (args, ctx) => {
				const [action = "", ...rest] = args.trim().split(/\s+/);
				check(!retired && (!owner || owner === ctx.sessionManager.getSessionId()), "OWNERSHIP", "This session cannot control the Swarm host");
				if (action === "pause" || action === "stop") {
					cancel();
					const current = contextGuard(ctx);
					if (restoreLink && !restoring) await restorePending(ctx);
					if (!current()) return;
					await brake(ctx, action === "stop");
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
				const pending = new AbortController();
				command = pending;
				const current = contextGuard(ctx, pending.signal);
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
						const objective = rest.join(" ") || await ctx.ui.input("Swarm objective", "Describe the goal", { signal: pending.signal });
						if (pending.signal.aborted || !objective) return;
						const criteria = await ctx.ui.input("Acceptance criteria as a JSON string array", '["Required observable outcome"]', { signal: pending.signal });
						if (pending.signal.aborted || criteria === undefined) return;
						const scope = await ctx.ui.input("Scope and exclusions as a JSON string array", '["Allowed work", "Excluded work"]', { signal: pending.signal });
						if (pending.signal.aborted || scope === undefined) return;
						activeHost = await ensureHost(ctx);
						if (!current()) return;
						await activeHost.launch({ workspace: ctx.cwd, runId: randomUUID(), specification: { objective, criteria: JSON.parse(criteria), scope: JSON.parse(scope) } });
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
						await activeHost.resume({ restart: selected === "restart" });
						if (!pending.signal.aborted && !retired) for (const worker of activeHost.snapshot().run.workers) activeHost.wake(worker.id);
					} else if (selected === "reconcile") {
						activeHost = await ensureHost(ctx);
						if (!current()) return;
						const result = await activeHost.reconcile();
						if (!result.settled) notify(ctx, "Attestation recorded. Waiting for live SDK/tool frames to settle; execution remains fenced.", "warning");
					} else check(false, "INPUT", "Use start, status, pause, stop, restore <run-id>, resume, restart, or reconcile");
					if (!retired) notify(ctx, statusText(activeHost.snapshot()));
				} catch (error) {
					if (!retired) notify(ctx, `Swarm control failed (${error.code ?? "INPUT"}). No automatic retry or rollback. Inspect status before continuing.`, "error");
					throw error;
				} finally {
					remember(ctx);
					viewing = false;
					if (command === pending) command = undefined;
				}
			},
		});

		pi.on("session_start", async (event, ctx) => {
			if (event.reason === "fork" || retired) return;
			const link = ctx.sessionManager.getEntries().filter(entry => entry.type === "custom" && entry.customType === LINK).at(-1)?.data;
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
			pi.on(event, async (_event, ctx) => ({ cancel: !(await brake(ctx)).settled }));
		}
		pi.on("session_shutdown", async (_event, ctx) => {
			retired = true;
			cancel();
			try { await host?.close(); }
			catch { notify(ctx, "Swarm shutdown incomplete. Ownership remains fenced; no stale-lock takeover is supported.", "error"); }
		});
	};
}
