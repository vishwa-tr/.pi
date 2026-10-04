// Scripted public native provider only; the normal entry is loaded separately with -e.
import { appendFileSync } from "node:fs";
import { guardNetwork } from "../network-guard.mjs";
import { createAssistantMessageEventStream, createProvider } from "@earendil-works/pi-ai";

export default function (pi) {
	if (process.env.PI_OFFLINE !== "1" || !process.env.SWARM_TERMINAL_FIXTURE) throw new Error("Offline fixture required");
	const cleanup = [];
	guardNetwork({ after: fn => cleanup.push(fn) });
	pi.on("session_shutdown", () => { for (const fn of cleanup) fn(); });
	const record = value => appendFileSync(process.env.SWARM_TERMINAL_FIXTURE, JSON.stringify(value) + "\n", { mode: 0o600 });
	const model = { id: "first", name: "Entry scripted", provider: "entry-fixture", api: "openai-responses",
		baseUrl: "https://entry.invalid/v1", reasoning: true, input: ["text"], contextWindow: 128000, maxTokens: 8192,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
	const stream = (selected, _context, options) => {
		if (options.apiKey !== "memory-only-fixture") throw new Error("Fixture auth missing");
		record({ type: "dispatch", model: selected.id });
		const output = createAssistantMessageEventStream();
		void (async () => {
			if (!options.signal.aborted) await new Promise(resolve => options.signal.addEventListener("abort", resolve, { once: true }));
			const error = { role: "assistant", content: [], api: selected.api, provider: selected.provider, model: selected.id,
				stopReason: "aborted", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
			output.push({ type: "error", reason: "aborted", error }); output.end(); record({ type: "settled" });
		})();
		return output;
	};
	pi.registerProvider(createProvider({ id: model.provider, models: [model, { ...model, id: "second" }],
		auth: { apiKey: { name: "Fixture", check: async () => ({ type: "api_key" }),
			resolve: async () => { record({ type: "auth" }); return { auth: { apiKey: "memory-only-fixture" } }; } } },
		api: { stream, streamSimple: stream } }));
	pi.on("session_start", (_event, ctx) => { record({ type: "ready" }); ctx.ui.notify("Entry fixture ready", "info"); });
	pi.registerCommand("fixture-model", { handler: async (_args, ctx) => {
		await pi.setModel(ctx.modelRegistry.find("entry-fixture", "second"));
		ctx.ui.notify("Entry model changed", "info");
	} });
}
