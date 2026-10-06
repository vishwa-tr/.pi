import test from "node:test";
import assert from "node:assert/strict";
import { ChatApproval } from "../extensions/swarm/chat-approval.mjs";

function fixture(t, timeout = 120000) {
	const messages = [];
	let disposed = 0;
	const vault = new ChatApproval({ sendMessage: (...args) => messages.push(args) });
	t.after(() => vault.revoke());
	const packet = { agreement: { action: "launch", specification: { objective: "Exact goal" } } };
	const proposal = vault.propose(packet, { assertCurrent() {}, dispose() { disposed++; }, timeout });
	const ctx = { mode: "tui", hasUI: true };
	return { vault, messages, packet, proposal, ctx, disposed: () => disposed,
		approve: () => vault.input({ source: "interactive", text: proposal.reply }, ctx),
		consume: () => vault.consume(proposal.proposalId, "launch", "Exact goal", ctx) };
}

test("proposal is detached, non-waking and one use; strings alone cannot grant approval", t => {
	const f = fixture(t);
	f.packet.agreement.specification.objective = "Tampered";
	assert.equal(f.messages[0][1].triggerTurn, false);
	assert.throws(f.consume);
	assert.equal(f.disposed(), 1);
	f.approve();
	assert.throws(f.consume);
});

test("interactive approval grants no automatic action and expires before consumption", async t => {
	const f = fixture(t, 15);
	f.approve();
	await new Promise(resolve => setTimeout(resolve, 25));
	assert.throws(f.consume);
	assert.equal(f.disposed(), 1);
});

test("consumption returns an immutable proposal copy once, never replays authority", t => {
	const f = fixture(t);
	f.approve();
	assert.equal(f.consume().agreement.specification.objective, "Exact goal");
	assert.throws(f.consume);
	assert.equal(f.disposed(), 1);
});

for (const mode of ["rpc", "json", "print", undefined]) {
	test(`interactive source cannot approve in unsupported ${mode} context`, t => {
		const f = fixture(t);
		f.ctx.mode = mode;
		f.approve();
		assert.throws(f.consume);
	});
}
