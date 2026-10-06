import test from "node:test";
import assert from "node:assert/strict";
import { requestUserApproval, statusText } from "../extensions/swarm/ui.mjs";
import { PROVIDER_DATA_SCOPE } from "../extensions/swarm/provider-capability.mjs";

// Scripts native select/input answers and records every packet and dialog in order.
function fixture(answers = {}) {
	const log = [];
	const ctx = { mode: "tui", hasUI: true, ui: {
		select: async (title, choices, options) => {
			log.push({ kind: "select", title, choices, signal: options.signal });
			const answer = answers.select?.shift();
			return typeof answer === "function" ? answer(title, choices, options) : answer;
		},
		input: async (title, _placeholder, options) => {
			log.push({ kind: "input", title, signal: options.signal });
			return answers.input?.shift();
		},
		notify() {},
	} };
	const present = text => log.push({ kind: "packet", text });
	return { ctx, log, present, packets: () => log.filter(item => item.kind === "packet").map(item => item.text) };
}

for (const transport of [undefined, "scripted-memory", "pi-native"]) {
	test(`native agreement discloses ${transport ?? "legacy mock"} without misleading network claims`, async () => {
		const provider = transport ? { transport, provider: "fixture", modelId: "scripted",
			endpoint: "https://fixture.invalid/v1/chat/completions", outboundData: [...PROVIDER_DATA_SCOPE] } : undefined;
		const f = fixture({ select: ["Cancel"] });
		assert.deepEqual(await requestUserApproval(f.ctx, { action: "launch", specification: { objective: "Goal" },
			changes: [], provider, signal: new AbortController().signal }, f.present), { approved: false });
		const [summary] = f.packets();
		if (transport === "pi-native") {
			assert.match(summary, /LAUNCH \(Pi native provider\)/);
			assert.match(summary, /credentials, OAuth, environment and routing/);
			assert.match(summary, /informational, not pinned/);
			assert.doesNotMatch(summary, /exact endpoint|mock only|in-memory only|no network/);
		} else assert.match(summary, /LAUNCH \(mock only\)/);
		if (provider) {
			assert.ok(summary.includes(provider.endpoint));
			assert.ok(summary.includes(provider.modelId));
			for (const category of PROVIDER_DATA_SCOPE) assert.ok(summary.includes(category));
		}
	});
}

test("every packet is shown in full before its dialog; Cancel is first and titles hold no packet text", async () => {
	const hostile = "\x1b[2J\x1b]8;;https://untrusted.invalid\x07\r‮⁦";
	const objective = `${"界🙂é".repeat(3000)}${hostile} last-objective-line`;
	const f = fixture({ select: ["Approve", "Preserve existing work", "Continue"] });
	const result = await requestUserApproval(f.ctx, { action: "resume", specification: { objective }, changes: [{ status: "??", path: `dirty${hostile}.txt` }],
		requiresExistingWorkDecision: true, requiresReconciliation: true, signal: new AbortController().signal }, f.present);
	assert.deepEqual(result, { approved: true, specification: { objective }, existingChanges: "preserve", reconciled: true });
	assert.deepEqual(f.log.map(item => item.kind), ["packet", "select", "packet", "select", "select"]);
	for (const dialog of f.log.filter(item => item.kind === "select")) {
		assert.equal(dialog.choices[0], "Cancel"); // Enter on the default choice never authorizes.
		assert.doesNotMatch(dialog.title, /界|dirty|untrusted|[\x00-\x1f‮⁦]/);
	}
	assert.deepEqual(f.log.filter(item => item.kind === "select").map(item => item.title.split(":")[0]),
		["RESUME (mock only)", "Preserve and proceed?", "Workspace reconciliation"]);
	const [agreement, preservation] = f.packets();
	assert.ok(agreement.includes("界🙂é".repeat(3000)) && agreement.includes("last-objective-line"));
	assert.match(preservation, /dirty.*\.txt/);
	for (const packet of f.packets()) {
		assert.doesNotMatch(packet, /[\x00-\x09\x0b-\x1f\x7f-\x9f‮⁦]/);
		assert.match(packet, /\\u001b/);
	}
});

test("serialized dirty-work and exact-ID/evidence attestation show every packet before deciding", async () => {
	const f = fixture({ select: ["Approve", "Preserve existing work", "Attest settlement"], input: ["Independently verified all listed work stopped"] });
	const result = await requestUserApproval(f.ctx, { action: "reconcile", specification: { objective: "Goal" }, changes: { paths: ["dirty.txt"] },
		recovery: { operations: [{ id: "exact-operation" }], turns: [{ id: "exact-turn" }] }, requiresExistingWorkDecision: true, signal: new AbortController().signal }, f.present);
	assert.equal(result.approved, true); assert.equal(result.existingChanges, "preserve");
	assert.deepEqual(result.attestation, { kind: "user-established-settlement", evidence: "Independently verified all listed work stopped" });
	assert.deepEqual(f.log.map(item => item.kind), ["packet", "select", "packet", "select", "input", "packet", "select"]);
	const packets = f.packets();
	assert.match(packets[0], /exact-operation/); assert.match(packets[0], /exact-turn/);
	assert.match(packets[1], /dirty.txt/);
	assert.match(packets[2], /exact-operation/); assert.match(packets[2], /exact-turn/);
	assert.match(packets[2], /Independently verified/);
	assert.deepEqual(f.log.at(-1).choices, ["Cancel", "Attest settlement"]);
});

for (const [stage, answers] of [["blank evidence", { select: ["Approve"], input: [" "] }], ["declined attestation", { select: ["Approve", "Cancel"], input: ["Checked"] }],
	["escaped attestation", { select: ["Approve", undefined], input: ["Checked"] }]]) {
	test(`reconcile ${stage} is never an attestation`, async () => {
		const f = fixture(answers);
		const result = await requestUserApproval(f.ctx, { action: "reconcile", specification: { objective: "Goal" }, changes: [],
			recovery: { operations: [{ id: "op" }], turns: [] }, signal: new AbortController().signal }, f.present);
		assert.equal(result.approved, false);
	});
}

for (const [stage, select] of [["agreement", []], ["preservation", ["Approve"]], ["reconciliation", ["Approve", "Preserve existing work"]]]) {
	test(`abort while the ${stage} dialog is open closes it and denies a late answer`, async () => {
		const abort = new AbortController();
		const f = fixture({ select: [...select, (_title, _choices, options) => new Promise(resolve => {
			options.signal.addEventListener("abort", () => resolve(undefined), { once: true });
			setTimeout(() => abort.abort(), 1);
		})] });
		const result = await requestUserApproval(f.ctx, { action: "resume", specification: { objective: "Goal" }, changes: ["dirty"],
			requiresExistingWorkDecision: true, requiresReconciliation: true, signal: abort.signal }, f.present);
		assert.deepEqual(result, { approved: false });
		assert.ok(f.log.filter(item => item.kind === "select").every(item => item.signal === abort.signal));
	});
}

test("an already-cancelled request opens no dialog and presents nothing", async () => {
	const abort = new AbortController(); abort.abort();
	const f = fixture({ select: ["Approve"] });
	assert.deepEqual(await requestUserApproval(f.ctx, { action: "launch", specification: { objective: "Goal" }, changes: [], signal: abort.signal }, f.present), { approved: false });
	assert.deepEqual(f.log, []);
});

for (const [name, change] of [["rpc", ctx => { ctx.mode = "rpc"; }], ["no UI", ctx => { ctx.hasUI = false; }], ["no packet display", () => {}]]) {
	test(`${name} context cannot approve and opens no dialog`, async () => {
		const f = fixture({ select: ["Approve"] });
		change(f.ctx);
		const present = name === "no packet display" ? undefined : f.present;
		await assert.rejects(requestUserApproval(f.ctx, { action: "launch", specification: { objective: "Goal" }, changes: [], signal: new AbortController().signal }, present), { code: "UI" });
		assert.deepEqual(f.log, []);
	});
}

test("status never misrepresents usage placeholders as mock-only execution", () => {
	assert.doesNotMatch(statusText({ run: { status: "running" }, errors: [] }), /mock.only/);
	assert.match(statusText({ run: { status: "running" }, errors: [] }), /cost unknown/);
});
