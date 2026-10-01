import { SwarmHost } from "./host.mjs";
import { randomUUID } from "node:crypto";
import { showDashboard } from "./dashboard.mjs";
import { requireCondition as check } from "./errors.mjs";
import { requestUserApproval, statusText } from "./ui.mjs";
import { assertProviderSelection } from "./provider-capability.mjs";

const LINK = "swarm-run-v1";

/** Explicit injection only: no default export, provider discovery, or activation entry. */
export function createSwarmExtension({ modelRuntime, mainModel, thinkingLevel = "off", codingTools, instructions, runner, tickIntervalMs = 1000, approvalTimeoutMs = 120000, providerCapability } = {}) {
	if (providerCapability) assertProviderSelection(providerCapability, { provider: mainModel?.provider, modelId: mainModel?.id, thinkingLevel }, modelRuntime);
	check(providerCapability || (mainModel?.provider === "swarm-mock" && mainModel.api === "swarm-mock" && modelRuntime), "MODEL", "An explicitly injected mock runtime is required");
	return function swarmExtension(pi) {
		let host;
		let owner;
		let context;
		let command;
		let retired = false;
		let viewing = false;
		let dashboard;
		const cancel = () => command?.abort();
		const notify = (ctx, text, level = "info") => { if (ctx.hasUI) ctx.ui.notify(text, level); };
		const ensureHost = ctx => {
			const sessionId = ctx.sessionManager.getSessionId();
			check(ctx.sessionManager.getSessionFile(), "SESSION", "A persisted owner session is required");
			check(!owner || owner === sessionId, "OWNERSHIP", "Another session owns this host");
			if (!host) {
				owner = sessionId;
				host = new SwarmHost({ events: pi.events, sessionId, modelRuntime, mainModel, thinkingLevel, codingTools, instructions, runner, tickIntervalMs, approvalTimeoutMs, providerCapability,
					requestApproval: request => requestUserApproval(context, request),
					beforePrompt: async () => { if (viewing) { cancel(); await dashboard; } } });
			}
			context = ctx;
			return host;
		};
		const remember = ctx => {
			const run = host?.snapshot().run;
			if (!run || retired) return;
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
			description: "Mock Swarm live dashboard, launch, status, pause, stop, resume, restart, and reconciliation",
			handler: async (args, ctx) => {
				const [action = "", ...rest] = args.trim().split(/\s+/);
				check(!retired && (!owner || owner === ctx.sessionManager.getSessionId()), "OWNERSHIP", "This session cannot control the Swarm host");
				if (action === "pause" || action === "stop") { await brake(ctx, action === "stop"); return; }
				if (action === "status") { notify(ctx, statusText(host?.snapshot())); return; }
				check(!retired && !command, "BUSY", "Swarm control is busy or this extension instance is retired");
				check(ctx.mode === "tui" && ctx.hasUI, "UI", "Swarm controls require interactive TUI");
				const pending = new AbortController();
				command = pending;
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
					const activeHost = ensureHost(ctx);
					if (selected === "start") {
						const objective = rest.join(" ") || await ctx.ui.input("Swarm objective", "Describe the goal", { signal: pending.signal });
						if (pending.signal.aborted || !objective) return;
						const criteria = await ctx.ui.input("Acceptance criteria as a JSON string array", '["Required observable outcome"]', { signal: pending.signal });
						if (pending.signal.aborted || criteria === undefined) return;
						const scope = await ctx.ui.input("Scope and exclusions as a JSON string array", '["Allowed work", "Excluded work"]', { signal: pending.signal });
						if (pending.signal.aborted || scope === undefined) return;
						await activeHost.launch({ workspace: ctx.cwd, runId: randomUUID(), specification: { objective, criteria: JSON.parse(criteria), scope: JSON.parse(scope) } });
						remember(ctx);
						if (pending.signal.aborted || retired) return;
						await activeHost.recruit({ id: "planner", specialization: "Objective decomposition and coordination", brief: "Investigate the approved objective, create criterion-linked tasks, and recruit only useful independent specialists within limits.", reason: "Initial investigation and decomposition of the user-approved objective" });
						if (!pending.signal.aborted && !retired) activeHost.wake("planner");
					} else if (selected === "restore") {
						check(rest.length === 1, "INPUT", "Use restore <run-id>");
						await activeHost.restore({ workspace: ctx.cwd, runId: rest[0] });
					} else if (selected === "resume" || selected === "restart") {
						await activeHost.resume({ restart: selected === "restart" });
						if (!pending.signal.aborted && !retired) for (const worker of activeHost.snapshot().run.workers) activeHost.wake(worker.id);
					} else if (selected === "reconcile") {
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
			try { await ensureHost(ctx).restore({ workspace: ctx.cwd, runId: link.runId }); }
			catch { notify(ctx, "Swarm restore blocked. Storage and ownership were preserved; inspect before recovery. Nothing was resumed.", "warning"); }
		});
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
