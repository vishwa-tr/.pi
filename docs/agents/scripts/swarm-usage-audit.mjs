#!/usr/bin/env node
/**
 * Usage: node docs/agents/scripts/swarm-usage-audit.mjs SESSION.jsonl [SESSION.jsonl ...]
 * Metadata-only, read-only usage audit. No model calls or writes. Does not print
 * paths, prompts, responses or account data. Counts recorded assistant responses;
 * copied/forked histories in separate inputs may overlap. Token counts do not map
 * directly to subscription percentages or actual billing. Reasoning is an output subset.
 */
import { readFileSync } from "node:fs";

const paths = process.argv.slice(2);
if (!paths.length) { console.error("Provide one or more native Pi session JSONL files."); process.exitCode = 1; }
else {
	try {
		const results = paths.map((path, index) => {
			const result = { input: index + 1, responses: 0, incompleteUsage: 0, uncachedInput: 0, cachedInput: 0, output: 0, reasoningOutput: 0, largestContext: 0, ownerMailDuplicates: 0 };
			const mail = new Set();
			const lines = readFileSync(path, "utf8").split("\n");
			for (let i = 0; i < lines.length; i++) {
				if (!lines[i].trim()) continue;
				let entry;
				try { entry = JSON.parse(lines[i]); } catch { if (i === lines.length - 1) break; throw new Error("Malformed history"); }
				if (entry.type === "custom_message" && entry.customType === "swarm-agent-mail") {
					for (const id of entry.details?.messageIds ?? []) {
						const key = JSON.stringify([entry.details.runId, id]);
						if (mail.has(key)) result.ownerMailDuplicates++; else mail.add(key);
					}
				}
				const message = entry.message;
				if (message?.role !== "assistant") continue;
				result.responses++;
				const usage = message.usage;
				if (["error", "aborted"].includes(message.stopReason) || !usage || ["input", "cacheRead", "output"].some(key => !Number.isSafeInteger(usage[key]) || usage[key] < 0)) { result.incompleteUsage++; continue; }
				result.uncachedInput += usage.input; result.cachedInput += usage.cacheRead; result.output += usage.output;
				result.reasoningOutput += Number.isSafeInteger(usage.reasoning) && usage.reasoning >= 0 ? usage.reasoning : 0;
				result.largestContext = Math.max(result.largestContext, usage.input + usage.cacheRead + (usage.cacheWrite ?? 0));
			}
			const input = result.uncachedInput + result.cachedInput;
			return { ...result, cacheReadPercent: input ? Math.round(result.cachedInput / input * 1000) / 10 : null };
		});
		console.log(JSON.stringify({ recordedOnly: true, quotaAttributionAvailable: false, sessions: results }, null, 2));
	} catch {
		console.error("Usage audit failed: an input is unreadable or malformed. No usage/quota conclusion is available."); process.exitCode = 1;
	}
}
