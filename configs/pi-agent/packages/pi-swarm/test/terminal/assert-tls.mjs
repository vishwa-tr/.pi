// Combined acceptance evidence: actual receiver, native sessions and durable controller.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { reduceEvent } from "../../extensions/swarm/state.mjs";
import { PROVIDER_DATA_SCOPE } from "../../extensions/swarm/provider-capability.mjs";

const lines = path => readFileSync(path, "utf8").trim().split("\n").map(JSON.parse);
const journal = lines(process.argv[2]).map(record => record.payload);
const observations = lines(process.argv[3]);
const events = type => observations.filter(event => event.type === type);
const state = journal.reduce(reduceEvent, null);
const requests = events("tls-request");
assert.equal(requests.length, 17, "No retries, replay or extra follow-ups");
assert.deepEqual(requests.map(request => request.id), Array.from({ length: 17 }, (_, i) => i + 1));
assert.ok(requests.every(request => request.method === "POST" && request.path === "/v1/chat/completions" && request.model === "terminal-scripted"));
assert.equal(new Set(requests.map(request => request.hash)).size, 17, "No exact request replay");
assert.equal(events("tls-fixture-error").length, 0);
assert.equal(events("tls-response-close").length, 17);
assert.equal(events("tls-server-socket-close").length, 17);
assert.deepEqual(events("tls-settled"), [{ type: "tls-settled", requests: 17, serverSockets: 0, clientSockets: 0 }]);
assert.deepEqual(events("tls-response").map(response => response.id), [2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15, 16]);
assert.deepEqual(events("tls-response-close").filter(event => !event.completed).map(event => event.id), [1, 5, 9, 13, 17]);
for (const [offset, id] of ["approved", "denied", "cancelled", "shutdown"].entries()) {
	const responses = events("tls-response").slice(offset * 3, offset * 3 + 3);
	assert.deepEqual(responses.map(response => response.tools[0].name), ["swarm_task", "swarm_task", "bash"]);
	assert.equal(responses[0].tools[0].arguments.id, id);
	assert.equal(responses[1].tools[0].arguments.taskId, id);
	assert.equal(responses[2].tools[0].arguments.command, `node -e "console.log('phase8-${id}')"`);
}
assert.equal(requests[4].last.role, "tool");
assert.equal(requests[4].last.tool_call_id, "tls-4-0");
assert.match(requests[4].last.content, /phase8-approved/);
assert.equal(requests[8].last.tool_call_id, "tls-8-0");
assert.equal(state.hostApprovals.length, 7);
assert.equal(new Set(state.hostApprovals.map(approval => approval.id)).size, 7, "Every continuation needs fresh approval");
const provider = state.hostApprovals[0].provider;
assert.equal(provider.provider, "terminal-tls");
assert.equal(provider.modelId, "terminal-scripted");
assert.equal(provider.transport, "https-chat-completions");
assert.deepEqual(provider.outboundData, PROVIDER_DATA_SCOPE);
for (const approval of state.hostApprovals) {
	assert.deepEqual(approval.provider, provider, "Reload cannot substitute the endpoint/model");
	assert.equal(approval.existingChanges, "preserve");
}
for (const binding of state.sessions.workers) {
	const history = lines(join(dirname(process.argv[2]), "sessions", binding.sessionFile));
	const assistants = history.filter(entry => entry.type === "message" && entry.message.role === "assistant");
	assert.ok(assistants.length);
	assert.ok(assistants.every(entry => entry.message.provider === "terminal-tls" && entry.message.model === "terminal-scripted"));
}
assert.equal(state.status, "paused");
assert.equal(state.sessions.turns.length, 0);
assert.equal(state.workspace.operations.length, 0);
console.log("PASS: combined TLS receiver exact 17 requests, fenced follow-ups, fresh provider approvals, native HTTPS histories and real client/server socket settlement");
