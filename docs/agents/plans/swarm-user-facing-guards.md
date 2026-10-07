# Swarm user-facing guardrail improvements

## Summary

Read-only audit of Pi Swarm at parent commit `926b521`, verified 2026-10-07 against implementation and offline tests. These are simplification candidates, not permission to remove integrity or consent checks.

Selected first: decouple main-chat model/thinking changes from Swarm execution, and support a Swarm default with per-worker model/thinking overrides. Other candidates remain proposals.

### Agreed model/thinking behavior

- At launch, the Swarm default copies the main agent's current model and thinking level. All workers inherit it unless explicitly overridden.
- After launch, changing the main-chat model or thinking level does not change or pause the Swarm. Its approved settings remain pinned.
- Individual workers may use different model/thinking settings, including a different provider, with the destination and context disclosure included in authorization.
- The main agent may change the Swarm default or individual worker overrides when the user requests it.
- The main agent may also recommend a different model/thinking setting when useful, but must ask the user before applying it. Recommendations alone do not authorize changes.
- Apply requested/approved Swarm changes at a settled worker-turn boundary; do not change settings beneath an in-flight edit, command, retry, or compaction.
- Preserve worker identity/history and persisted selections across pause, reload, restore, and continuation. Legacy single-selection journals remain recoverable.
- Implemented: launch/default and per-worker settings, independent main-chat selection, explicit `swarm_control` model configuration, graceful turn-boundary application, and legacy-journal recovery. Other guardrail candidates remain unchanged.

## Candidate table

| Candidate | Current friction | Suggested improvement |
|---|---|---|
| Unrelated chat cancels proposals | Asking a clarification destroys the pending agreement. | Keep it pending unless explicitly rejected or changed. |
| Any UI prompt cancels proposals | Even opening a custom dialog invalidates confirmation. | Cancel only when relevant approval context changes. |
| Main model/thinking changes pause Swarm | Workers pause despite retaining their approved, pinned model. | Let main-chat settings change independently. |
| 30-second Safety deadline | A distracted user times out; the assignment then refuses further mutations. | Separate human-response waiting from technical timeouts; retain explicit-denial protection. |
| 60-minute run ceiling | Automatically pauses; exhausted time requires an approved restart. | Make optional, or allow a straightforward budget extension. |
| Original-session-only crash recovery | Recovery is blocked if the original session is unavailable. | Allow explicit cross-session recovery while retaining settlement checks. |
| Multiple recovery confirmations | Lease recovery, operation reconciliation, and resume require separate steps. | Offer one guided recovery flow with clear execution authorization. |
| Exact confirmation wording | “Yes please” cancels rather than confirms—or simply leaves pending. | Use an explicit Swarm-specific confirmation action. |

Also worth reviewing: only `/swarm stop` is available directly; status, pause, and view require the main agent.

## Evidence and boundaries

- Proposal input, UI cancellation, main-selection events, and recovery ownership: [extension.mjs](../../../packages/pi-swarm/extensions/swarm/extension.mjs).
- Approval orchestration, continuation, and Safety deadlines: [host.mjs](../../../packages/pi-swarm/extensions/swarm/host.mjs), [host-gates.mjs](../../../packages/pi-swarm/extensions/swarm/host-gates.mjs).
- Assignment refusal fencing: [workspace.mjs](../../../packages/pi-swarm/extensions/swarm/workspace.mjs).
- Default cycle limits and exhaustion: [state.mjs](../../../packages/pi-swarm/extensions/swarm/state.mjs).
- Lease identity and settlement protection: [lease.mjs](../../../packages/pi-swarm/extensions/swarm/store/lease.mjs).
- User-facing contracts: [package README](../../../packages/pi-swarm/README.md).

Retain ownership checks, file claims, stale-edit protection, actual process settlement, material agreement revalidation, and protection against model/tool/mail-generated approval. The removed two-minute chat-proposal expiry is not a remaining candidate. Independent technical inspection and host callback deadlines are separate mechanisms.

Audit validation: 226 offline tests passed across extension, current-extension, host, gates, recovery, inspection, and storage tests. No live-provider or physical-terminal verification was performed for this audit.

## Model-settings implementation verification

- Offline package suite: 581 tests passed; the sole failure was the unchanged exact Pi 1.0.4 baseline assertion because this validation environment has Pi 1.0.1. Pi 1.0.4 verification remains outstanding; the supported-version requirement was not relaxed.
- Coverage includes pinned main-chat independence, per-worker and cross-provider overrides, explicit confirmation, rejected/stale changes, graceful active-turn/retry/compaction settlement, queued wakes, cancellation/stop, history preservation, paused configuration, reload/restore, legacy replay, orphan refusal, and settlement-only recovery after provider failure.
- An independent read-only review found no blocking defects; a short-interval timer/slow-approval check verified quiescent revision stability.
- Global configuration validation passed using a disposable index containing the new files; the real index was left untouched. Validator tests and `git diff --check` passed.
- No live provider requests or physical-terminal checks were performed.
