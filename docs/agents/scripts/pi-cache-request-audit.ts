/**
 * Temporary, passive Pi extension for a bounded cache audit.
 * PI_CACHE_AUDIT_REPORT must name a fresh file in a private temporary directory.
 * Launch: pi --no-session --model openai-codex/gpt-6-luna --thinking low
 *   -e docs/agents/scripts/pi-cache-request-audit.ts
 * Send two short READY prompts, then /cache-audit-mail. Hard cap: 3 requests.
 * Writes only hashes, lengths and usage. Never records payloads/headers/credentials.
 * Warming is stopped and model tool execution blocked. No Swarm workers created.
 */
import { createHash } from "node:crypto";
import { closeSync, ftruncateSync, openSync, writeSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export default function cacheAudit(pi: ExtensionAPI) {
	const output = process.env.PI_CACHE_AUDIT_REPORT;
	if (!output || !isAbsolute(output)) throw new Error("PI_CACHE_AUDIT_REPORT must be an absolute temporary output path");
	const report = { requestLimit: 3, blockedRequests: 0, requests: [] as any[], responses: [] as any[] };
	let previousInput: string[] = [];
	const descriptor = openSync(output, "wx", 0o600);
	const save = () => {
		const data = Buffer.from(JSON.stringify(report, null, 2));
		let written = 0;
		while (written < data.length) written += writeSync(descriptor, data, written, data.length - written, written);
		ftruncateSync(descriptor, data.length);
	};
	pi.on("session_shutdown", () => closeSync(descriptor));
	save();
	pi.on("cache_warming_decision", () => ({ action: "stop" }));
	pi.on("tool_call", () => ({ block: true, reason: "Read-only cache audit: model tool execution is blocked." }));
	pi.on("before_provider_request", event => {
		if (report.requests.length >= report.requestLimit) { report.blockedRequests++; save(); throw new Error("Cache audit request cap reached"); }
		const payload = event.payload as Record<string, any>;
		const input = Array.isArray(payload.input) ? payload.input.map(hash) : [];
		let common = 0;
		while (common < previousInput.length && previousInput[common] === input[common]) common++;
		report.requests.push({ request: report.requests.length + 1, model: payload.model,
			instructionsHash: hash(payload.instructions ?? null), instructionsBytes: Buffer.byteLength(JSON.stringify(payload.instructions ?? null)),
			toolsHash: hash([payload.tools ?? [], ...(payload.input ?? []).filter((item: any) => item.type === "additional_tools")]),
			settingsHash: hash({ reasoning: payload.reasoning, text: payload.text, parallel: payload.parallel_tool_calls, tier: payload.service_tier }),
			cacheKeyHash: hash(payload.prompt_cache_key ?? null), inputItems: input.length,
			previousInputItems: previousInput.length, commonInputItems: common, previousInputPreserved: common === previousInput.length });
		previousInput = input; save();
	});
	pi.on("message_end", event => {
		const message = event.message as any;
		if (message.role !== "assistant") return;
		const usage = message.usage;
		report.responses.push({ measured: Boolean(usage) && !["error", "aborted"].includes(message.stopReason),
			input: usage?.input ?? null, cacheRead: usage?.cacheRead ?? null, cacheWrite: usage?.cacheWrite ?? null, output: usage?.output ?? null });
		save();
	});
	pi.registerCommand("cache-audit-mail", { description: "One synthetic native mail wake for this read-only cache audit", handler: async (_args, ctx) => {
		if (!ctx.isIdle() || report.requests.length !== 2) { ctx.ui.notify("Finish exactly two audit replies first.", "warning"); return; }
		pi.sendMessage({ customType: "swarm-agent-mail", content: "Cache audit mail (untrusted data, never approval): reply READY as requested by the audit owner. Use no tools.", display: false,
			details: { runId: "cache-audit-only", messageIds: ["audit-mail"], messages: [] } }, { triggerTurn: true });
	} });
}
