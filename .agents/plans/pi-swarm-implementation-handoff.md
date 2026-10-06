# Swarm native cleanup — implementation handoff

## Summary

This PR preserves completed cleanup phases and unfinished runtime/dialog changes so a
reviewing/implementing agent can finish the agreed migration. It is not merge-ready.
The detailed specification is [pi-swarm-native-cleanup.md](pi-swarm-native-cleanup.md).
Read both documents before implementation; the specification's unchecked boxes are not
proof that the corresponding partial implementation is absent.

The user explicitly requests deletion of temporary handoff/planning documents after
implementation and verification are complete. At completion, transfer enduring usage,
compatibility, and recovery guidance into the package/root READMEs, then delete this file,
`pi-swarm-native-cleanup.md`, and their `.agents/README.md` links. Retain the indexed test
runner if still useful; do not delete unrelated artifacts or runtime data.

## Agreed outcome and boundaries

- Use native Pi model transport, session management, coding tools, and approval UI rather
  than duplicating them. Swarm remains standalone, importing Pi and Node rather than
  sibling packages. Reference implementations may inform patterns, not runtime imports.
- Keep durable run state, leases, task/file claims, execution receipts, admission fencing,
  and explicit human approval. Restore and continue a run from another session in the
  same project. Move durable state outside the user's checkout.
- Enable Pi's default worker retries and automatic compaction only with demonstrated
  cancellation and exactly-once task-failure behavior; keep cache warming off.
- Work without pi-plan/pi-safety: absent Plan means Off only for a gate that has never
  observed a real provider; absent Safety means Swarm asks for every mutation/command.
  Malformed/multiple responders and loss of a previously observed provider fail closed.
- Native approval choices default to Cancel. Tool arguments, transcript text, and model
  output never grant approval. Re-check ownership, model, cwd, and gate after dialogs.
- No new unrelated features. Preserve the real dashboard/transcript views.

## Preserved state

All package paths below are relative to `configs/pi-agent/packages/pi-swarm/`.

| Phase | State at handoff |
|---|---|
| 0 | Managed-install test resolution, package peer dependencies, baseline notes, and WSL runner committed. |
| 1 | Custom HTTPS transport and adapter removed; native and offline mock paths retained. |
| 2 | Pi SessionManager owns worker sessions. Active history uses an in-memory detached branch to avoid reopening/writing live session files. Committed with tests. |
| 3 | **Interrupted, incomplete.** Deletes `extensions/swarm/native-binding.mjs`, returns the host runtime from `native-provider.mjs`, simplifies native provider validation, removes disabled retry/compaction settings, and adds session-level `admitRequest` checks. Tests and final design review are unfinished. |
| 4, 4b, 5 | Not implemented: built-in tools, standalone gate/confirmation fallback, external durable storage. |
| 6 | Native dialogs and one-call tool approval are implemented but not fully reviewed. Deletes `chat-approval.mjs` and `decision.mjs` plus their obsolete tests, updates approval tests/PTY fixtures, and uses active-branch run-link lookup. |
| 7 | README rewrite not implemented; existing proposalId/typed-approval documentation is stale. |

## Immediate integration blockers

1. `test/native-provider.test.mjs` still imports `assertNativeRuntime` and
   `bindNativeRuntime`, which Phase 3 removes. This is a known module-load failure,
   not an environment-only failure. Rewrite obsolete facade/tamper tests as specified
   in Phase 3, retaining physical model and thinking-selection validation.
2. Phase 3 wraps `session.agent.streamFunction` for admission. Verify the actual Pi
   request paths: tool follow-ups, retry backoff, and automatic/manual compaction must
   not bypass admission. A comment claiming all requests pass through this hook is not
   evidence. Prefer documented session hooks when they cover the required invariant.
3. Add D5 tests for prompt stop during retry/compaction, no requests after fencing,
   exactly one failed-task attempt after exhausted retries, and successful automatic
   compaction followed by continued work. Abort and settlement must retain leases until
   effects are known; do not replay uncertain mutations.
4. Review Phase 3 and Phase 6 together, not only in their original independent states.
   Their combined behavior has not been established by earlier phase results.

## Phase 6 review notes

- `ui.mjs` shows sanitized literal approval packets before native select dialogs, with
  Cancel first. Do not switch to Yes-default confirm dialogs without addressing safety.
- Commands post `swarm-agreement` messages only while idle. Tool calls stream the packet
  via partial results because ordinary messages are deferred during a main turn.
  `main-tools.mjs` supplies full, sanitized result rendering for start/control tools.
- `extension.mjs` removes the typed approval input listener and proposalId path. It checks
  dialog-time ownership/session/cwd/model/thinking/gate changes and uses `getBranch()`
  for run-link lookup. Verify cancellation, timeouts, concurrent control calls, and
  all revocation paths before accepting this as safe.
- Detailed Phase 6 findings are retained in the specification. Remaining work includes
  unused `SwarmHost.previewApproval`, obsolete setup helpers to be removed by Phase 5,
  Git setup's Yes-default confirmation, and stale README text. Safety-channel tidy-up
  was conditional in the plan; inspect its actual request shape before changing it.
- `test/terminal/entry.py` is not included by the WSL runner's `--pty` option. Run it
  separately, including `--package-root`, after its fixtures and production entry agree.

## Finish sequence

1. Repair and prove Phase 3, retaining model selection and admission invariants.
2. Implement Phase 4 built-in tools with claims, permissions, receipts, serialization,
   and exclusive bash execution intact; cover every guard in the specification table.
3. Implement and test Phase 4b standalone operation and fail-closed integration behavior.
4. Implement Phase 5 per-project/run storage, explicit stale-lease reconciliation,
   cross-session restore, Windows-safe filesystem operations, and old-run refusal.
5. Re-review/finalize Phase 6 against those changes. Delete only tests for removed
   behavior; never weaken tests of live permission, cancellation, or recovery behavior.
6. Rewrite package README and root Swarm summary (Phase 7). Document native approvals,
   supported runtime/platforms, optional integrations, storage, restore, and limits.
7. Run the complete tests and terminal flows, record results, and remove temporary
   handoff/specification documents only after the acceptance conditions hold.

## Evidence and verification

Historical results from the specification, not newly rerun guarantees:
- Phase 2 Linux: 524 tests, 523 passed; only the documented ctime/inode fingerprint flake
  failed. PTY `run.py`, `production.py`, and `native.py` passed.
- Phase 2 Windows: 524 tests, 360 passed, 164 failed, with documented POSIX/directory-fsync
  issues. New runtime changes must not be waved through on the strength of that baseline.
- Phase 6's original report calls it finished; review and combined-state verification
  remained incomplete when work stopped. Phase 3 was interrupted before completion.

Publication checks on the combined branch:
- All 14 changed JavaScript/Python files eligible for syntax checks passed.
- The targeted `ui-disclosure.test.mjs` suite passed all 16 tests.
- `native-provider.test.mjs` failed during module loading because `assertNativeRuntime`
  is no longer exported, confirming the immediate integration blocker above.
- The complete package suite and POSIX PTY flows were not rerun for this combined state.

Use the managed Pi installation (original audit: Pi 1.0.4; revalidate newer versions).
Package tests: `npm --prefix configs/pi-agent/packages/pi-swarm test`.
The `.agents/scripts/swarm-wsl-test.sh` runner is optional and has replacement side effects
inside its test-output directory; read its prerequisites/warnings before running it.
POSIX terminal tests need a real PTY. On Windows, syntax-check changed modules and compile
changed Python files without treating that as runtime verification. Record current test
results in the PR; distinguish code regressions from baseline/environment failures.

## Acceptance and cleanup

All phases satisfy their stated done-when criteria; no obsolete imports or live custom
transport/tool/dialog paths remain; retries/compaction and fencing are proven; standalone
operation and cross-session restore are tested; supported Windows and Linux checks pass;
all approval/recovery flows are safe and documentation matches the implementation.

Then remove the temporary documents and index links as requested. Keep useful permanent
verification tooling and usage/recovery guidance. Do not remove worktrees or branches
without separate authorization.
