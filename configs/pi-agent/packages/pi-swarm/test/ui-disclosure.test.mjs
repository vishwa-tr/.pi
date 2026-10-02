import test from "node:test";
import { decisionUI } from "./decision-fixture.mjs";
import assert from "node:assert/strict";
import { requestUserApproval, statusText } from "../extensions/swarm/ui.mjs";
import { PROVIDER_DATA_SCOPE } from "../extensions/swarm/provider-capability.mjs";

for (const transport of [undefined, "scripted-memory", "https-chat-completions"]) {
	test(`native agreement discloses ${transport ?? "legacy mock"} without misleading network claims`, async () => {
		const provider = transport ? { transport, provider: "fixture", modelId: "scripted",
			endpoint: "https://fixture.invalid/v1/chat/completions", outboundData: [...PROVIDER_DATA_SCOPE] } : undefined;
		let summary;
		const ctx = { mode: "tui", hasUI: true, ui: { custom: decisionUI(() => async title => { summary = title; return "Cancel"; }) } };
		assert.deepEqual(await requestUserApproval(ctx, { action: "launch", specification: { objective: "Goal" },
			changes: [], provider, signal: new AbortController().signal }), { approved: false });
		if (transport === "https-chat-completions") {
			assert.match(summary, /LAUNCH \(HTTPS provider\)/);
			assert.match(summary, /declared context sent to the exact endpoint/);
			assert.doesNotMatch(summary, /mock only|in-memory only|no network/);
		} else assert.match(summary, /LAUNCH \(mock only\)/);
		if (provider) {
			assert.ok(summary.includes(provider.endpoint));
			assert.ok(summary.includes(provider.modelId));
			for (const category of PROVIDER_DATA_SCOPE) assert.ok(summary.includes(category));
		}
	});
}

test("status never misrepresents HTTPS usage placeholders as mock-only execution", () => {
	assert.doesNotMatch(statusText({ run: { status: "running" }, errors: [] }), /mock.only/);
	assert.match(statusText({ run: { status: "running" }, errors: [] }), /cost unknown/);
});
