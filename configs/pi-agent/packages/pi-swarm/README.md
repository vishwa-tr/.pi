# Pi Swarm — foundation, workspace safeguards, and offline SDK integration

## Status

This is an **inactive implementation**, not an activated Pi extension. Phase 3 creates
real Pi SDK sessions with deterministic mock providers only; live model execution is
explicitly rejected. Phase 2's host-authorized workspace adapter performs guarded file
mutations and shell execution in disposable test repositories. No main-session commands,
UI, extension entry point, or package activation are installed.

Stage 1 implements:

- A pure, versioned run/task state machine with strict event validation.
- Serialized, revision-checked controller commands and durable idempotency receipts.
- A checksummed, sequence-linked journal, acknowledged only after file synchronization.
- Separate durable checkout reservations and exclusive live-controller ownership.
- Bound worker capabilities, cancellation-generation fencing, and explicit settlement.
- Restart cycles that reset allowances without erasing prior progress or usage.
- Default limits: eight agent identities, four active assignments, 100 tasks per cycle,
  three failed/rejected attempts per task, and 60 minutes of active cycle time.
- Candidate/review bookkeeping, shared guidance revisions, and peer-message records.

Native ESM JavaScript is intentional for this foundation: Node's built-in test runner
can exercise foundation logic without an SDK or transpiler. The offline integration suite
uses an already-installed Pi SDK; it never installs dependencies or contacts live providers.

## Verification

Requires Node 22+, Git, and a local Unix filesystem that supports the synchronization
and no-follow operations used by the storage layer. The complete suite also requires the
installed Pi SDK (verified with 0.85.1). The test bootstrap resolves public package exports;
set `PI_SDK_DIR` if automatic discovery does not locate the installation. No install fallback
is provided. `npm run test:foundation` runs the non-SDK tests separately.

From the repository root:

```bash
npm --prefix configs/pi-agent/packages/pi-swarm test
```

Tests use temporary Git repositories, simulated workers, injected clocks, and injected
write failures. They cover state transitions, persistence/replay, exclusive ownership
across processes, corruption rejection, restart accounting, stale capabilities,
independent-review bookkeeping, and preservation of source/index contents.

The combined suite has 271 passing tests. It includes actual local shell execution,
process-group cancellation, filesystem races, persistent real SDK sessions, native compaction,
and autonomous peer/tool interaction using scripted providers. These are not live-model,
UI, or power-loss tests.

## Modules

| Module | Responsibility |
|---|---|
| `extensions/swarm/state.mjs` | Pure event validation and transitions; exports `DEFAULT_LIMITS`, `SwarmError`, and `reduceEvent`. |
| `extensions/swarm/core.mjs` | `SwarmController.open`, queued dispatch, replay, fencing, and persist-before-publish ordering. |
| `extensions/swarm/store/layout.mjs` | Canonical checkout validation and project-local runtime layout. Requires an existing verified Git exclusion boundary; does not modify ignore rules. |
| `extensions/swarm/store/lease.mjs` | Exclusive controller token and durable run reservation. No automatic stale-lock stealing. |
| `extensions/swarm/store/journal.mjs` | Versioned, hash-linked records, synchronization, replay, and uncertain-write fencing. |
| `extensions/swarm/store/files.mjs` | Private directory/file checks and durable writes. |
| `extensions/swarm/workspace.mjs` | Identity-bound workspace adapter, host authorization, execution intent, receipts, and final checks. |
| `extensions/swarm/workspace-state.mjs` | Durable execution accounting, candidate validation, contribution attribution, and reconciliation. |
| `extensions/swarm/workspace-scheduler.mjs` | Atomic claims, mutation scheduling, exclusive leases, cancellation, and actual settlement. |
| `extensions/swarm/workspace-files.mjs` | Guarded reads/writes/edits, path validation, and checkout fingerprints. |
| `extensions/swarm/shell.mjs` | Actual Bash exit status and bounded process-group cancellation. |
| `extensions/swarm/sessions.mjs` | Offline SDK driver, bounded turn scheduling, peer waking, guidance, pause/stop, and compaction. |
| `extensions/swarm/session-state.mjs` | Durable model/tool selection, session bindings, delivery records, and turn settlement. |
| `extensions/swarm/sdk-session.mjs` | Non-discovering SDK factory, mock-only gate, private native JSONL validation and synchronization. |
| `extensions/swarm/session-tools.mjs`, `specializations.mjs` | Uniform model-visible tool definitions and generated specialist/context prompts. |
| `test/` | Foundation and offline real-SDK integration tests. |

## Host API and trust boundary

`SwarmController.open({ workspace, runId, ownerSessionId, create?, clock? })` acquires
checkout ownership and replays an existing run. A new run requires an approved
`create` specification containing `objective`, `criteria`, `scope`, and optional
`limits`. It starts paused. `workspace` must identify the checkout root.

The returned controller exposes:

- `snapshot()`: a detached copy of current state.
- `owner(type, payload, options?)`: **trusted host capability** representing already
  obtained user authorization. The future UI must obtain that authorization first.
- `system(type, payload, options?)`: **trusted runtime capability** for actual
  assignment settlement, recovery, and verification completion.
- `worker(id).dispatch(type, payload, options?)`: a worker identity bound to the
  current execution cycle and cancellation generation. Rebind only after authorized
  continuation; callers cannot override that binding through options.
- `close()`: release a safely settled controller. Paused runs retain their checkout
  reservation. Stopped/completed/failed runs release ownership after settlement.

Dispatch options support `operationId` for retries and `expectedRevision` for
optimistic concurrency. Successful commands return `{ operationId, revision }`.
Repeating an operation with the same input returns its original receipt without
executing again, including after replay. Reusing its identifier for different input
fails. Read a new snapshot when current state, rather than the historical receipt,
is needed.

Do not expose owner/system methods, the controller constructor, or raw reducer events
to model-visible tools. Human approval routing, semantic scope judgments, and Pi tool
integration belong to a later adapter. A claimed acceptance-criterion reference or
recruitment justification is bookkeeping, not proof that a model obeyed the scope.

## State and lifecycle contracts

### Tasks and settlement

Tasks reference approved acceptance criteria. Dependencies can only reference existing
tasks, so dependency cycles cannot be introduced. Stage 1 does not edit dependencies.

An agent claims either a build or review assignment. Only one assignment per worker
and one per task may be active, under the configured active limit. Assignment tokens
are never reused. Reports are pending until the trusted runtime records settlement;
reporting alone does not release a slot or mark work complete.

A candidate needs a non-contributing reviewer. Review is represented as a phase of
the task in stage 1, not as a separate task record. Failures and rejected submissions
consume attempts; yielding does not. Exhausted tasks block rather than silently retry.
The task ceiling blocks new task creation without blocking existing task execution.

### Pause, stop, resume, restart

Pause and stop advance the cancellation generation before settlement. Existing worker
capabilities can no longer mutate state. A trusted runtime must explicitly settle
remaining assignments before the lifecycle transition can finish. Unsettled work
prevents ownership release and restart.

Resume continues a paused run after reconciliation without resetting allowances.
Restart is available from paused, stopped, completed, and failed states, with explicit
user authorization and reconciliation. It creates a new budget cycle and cancellation
generation. Completed tasks remain completed; unfinished tasks consume the new task
allowance; retained agents still count against the agent ceiling. Historical attempts
and prior-cycle usage remain available.

A stopped/completed/failed persistent controller closes after its final durable event
and ownership release. Reopen it to request an explicit restart. A paused controller
may close while keeping the durable reservation, blocking another run in that checkout.

### Recovery and time

No model work is resumed by opening storage. Previously executing state enters recovery
settlement and then pauses; pending stop/failure transitions preserve their intended
outcome. Recorded stopped/completed/failed states remain unchanged. Remaining assignments
require reconciliation before the runtime can attest settlement.

The host must drive `system("run.tick")` while running. Stage 1 does not install timers.
Dispatch also checks the deadline before admitting additional work. Time is wall-clock
cycle time, not summed agent time; paused time is excluded. Recovery does not count the
entire offline interval as execution. Time after the final durable checkpoint before a
crash is uncertain; a later runtime needs periodic checkpoints and visible reconciliation.
A backwards clock fails closed rather than silently renewing the allowance.

### Storage failures

Appending or synchronizing a record can fail after some bytes reach disk. Such failure
is not acknowledged and poisons the controller for further work. Preserve ownership
fencing and investigate; do not automatically repeat side effects or reset state.

A lingering live-controller lock, ambiguous reservation, malformed record, checksum
mismatch, or invalid replay transition fails closed. There is intentionally no force
recovery or automatic cleanup API in stage 1. A future user-facing recovery flow must
establish safe settlement before reclaiming ownership. Do not treat a missing process
as proof that all of its commands stopped.

Checksums detect accidental inconsistency, not malicious rewriting by a privileged
filesystem writer. An independently removed complete journal suffix cannot be detected
without another trusted checkpoint. Filesystem protections are not an OS sandbox.

## Phase 2 workspace API

Before resuming a paused controller, call
`WorkspaceRuntime.attach(controller, { authorize, runner? })`. Attachment durably enables
workspace evidence enforcement; old stage 1 mock approvals are not accepted as evidence.
Only one workspace adapter may attach to a controller. `authorize` defaults to denial;
the future host bridge must check user approval, safety policy, and execution mode. The
optional runner is a trusted test/host integration seam, never a model-visible argument.

After claiming a task, `runtime.worker(workerId)` returns assignment-bound operations:

- `claim(paths)` atomically acquires all canonical file claims or reports blockers.
- `read(path)` records a fresh fingerprint; a new claim requires a new read.
- `write(path, content)` and `edit(path, edits)` require claims, current reads, and host
  authorization. Exact edit matches are resolved against the original file before writing.
- `release()` relinquishes idle claims; active mutations prevent release.
- `shell(command)` relinquishes the requester's claims and takes exclusive workspace access.
  Every command uses this path, including tests and apparently read-only commands.
- `submit(summary, executionIds)` requires successful, current receipts from that build
  assignment. `review(approved, summary)` verifies the candidate is still current.

`runtime.settle(taskId)` is a trusted runtime method: claims and operations must settle
before the assignment can finish. `runtime.finalCheck(command)` blocks coordinated edits,
records the real command result, and completes only with current successful evidence and
independently reviewed candidates. A failed final check leaves the verification phase;
pause and explicitly resume before another final-check attempt.

Execution intent is synchronized before side effects. Receipts record command, assignment,
cycle, generation, guidance revision, actual exit code, timestamps, and before/after workspace
fingerprints. Interrupted intent remains unresolved after recovery; it is never replayed.
The adapter does not schedule periodic deadline ticks: the future host driver must do so to
interrupt a long-running command at the deadline, rather than only noticing at settlement.

### Deliberately conservative boundaries

- Verification fingerprints cover the whole checkout, including ordinary untracked and
  ignored files, plus Git HEAD/ref/index state. Coordination state and volatile Git internals
  are excluded. Any observed change invalidates older candidates and verification. This can
  reject checks that generate artifacts; narrower relevance tracking is not implemented.
- Because evidence covers the whole checkout, mutation contributors are tracked across tasks.
  A contributor cannot independently review another task's workspace candidate. A reviewer
  who edits becomes a builder and needs another reviewer. Unknown recovered operations are
  conservatively attributed to their worker, not treated as read-only. If no independent
  reviewer fits the approved limits, the host must escalate rather than bypass independence.
- Paths reject traversal, symlink components, hardlinked targets, and unsupported file types.
  These are cooperative safeguards, not an OS sandbox against external writers. Failed writes
  can leave partial changes; no rollback of user/project content is attempted.
- Queued cancellation prevents execution. Active cancellation requests termination but retains
  ownership until the operation actually settles. Bash uses a separate POSIX process group;
  surviving groups or uncertain probes are not reported as successful settlement. Escaped
  daemonized processes and external effects remain outside that guarantee.
- An uncertain runner result pauses work and retains its lease. Only after independently
  establishing settlement may the trusted host call `confirmSettled(id, { settled: true })`.
  The resulting receipt remains unknown, never successful evidence. After recovery with no
  live adapter operations, `reconcile({ settled: true })` durably retires orphan intent and
  records its conservative provenance. Neither method proves process death itself.
- Claims are in-memory and scoped to one controller; unresolved execution intent is durable.
  Recovery discards old claim/read capabilities, fences execution, and requires reconciliation.
- Scheduler callbacks are non-reentrant. Waiting requests do not create extra assignment
  capacity; Pi session slot yielding remains a future driver concern.
- Phase 2 does not enforce semantic task scope or command filesystem boundaries. Shell
  approval must be supplied by the host; arbitrary shell commands remain powerful.

## Phase 3 offline SDK driver

`SwarmSessions.attach(controller, { workspace, modelRuntime, mainModel, thinkingLevel,
override?, codingTools?, instructions?, tickIntervalMs? })` attaches to a paused,
workspace-enabled controller. Both provider and model API must be `swarm-mock` in this
phase. Model/thinking selection, supported coding tools, and supplied host instructions
are captured durably once; later main-agent changes do not silently alter workers.

The driver exposes trusted host methods:

- `resume({ reconciled: true, restart? })`, then `recruit(specification)` and `wake(workerId)`.
  Recruitment creates a stable generated specialist and native persistent session. No shared
  definition directory, extension, skill, or project context is automatically discovered.
- `send(workerId, text)` and `redirect(text)`. Peer tools can recruit and message without
  main-agent relaying. Busy peers receive mail on their next turn; user redirection aborts
  stale turns and refreshes authoritative guidance before more tools. Paused work stays paused.
- `history(workerId, limit?)` and `compact(workerId)`. Compaction uses the native SDK and
  preserves session identity. Every later prompt reloads shared state. Automatic compaction
  and automatic provider retries remain disabled in this phase.
- `pause({ stop?, timeoutMs? })`, `idle()`, `reconcile({ settled: true })`, and `close()`.
  A timeout reports incomplete settlement, not permission to dispose or release ownership.
  SDK idle, workspace execution, and durable turn retirement must all settle first.

Actual prompt/compaction turns consume the active-agent allowance. Idle specialists may
retain task ownership without occupying a model execution slot. Waiting inside a still-live
SDK tool currently retains its slot until that turn settles. The driver checks elapsed time
on periodic host ticks (default one second); tests can disable the timer and drive ticks.

All specialists receive the same selected wrappers for `read`, `edit`, `write`, and `bash`,
plus board, recruitment, mail, history, claims, and report tools. Other coding tools fail
preflight rather than inheriting unwrapped implementations. File mutations participate in
the public SDK mutation queue and phase 2's guards. Results use SDK content/details envelopes;
full native presentation parity is not claimed. No lifecycle/owner/system capability is
model-visible. Reports remain candidates until independent review and final verification.

Turn intent is journaled before prompting. Native session headers are materialized before
binding, and session files are validated and synchronized before turn settlement is recorded.
Corrupt or missing bound histories fail closed; no automatic migration/reset occurs. Delivery
is marked after successful current-generation settlement. Recovery can expose a previously
received message again; message IDs and durable task state remain authoritative, not an
exactly-once model-prompt guarantee. Old-generation mail never starts a new execution cycle.

## Phase 4 host approval and policy integration

`SwarmHost` in `extensions/swarm/host.mjs` orchestrates launch and continuation through a
host-supplied `requestApproval` callback. It is not a registered command or dashboard.
The callback must represent a human decision, never an agent's self-approval.

- `launch({ workspace, runId, specification })` presents the objective, criteria, scope,
  limits, model/tool selection, and existing-change summary before creating run storage.
  The callback may return an edited `specification`. Dirty checkouts require the explicit
  decision `existingChanges: "preserve"`; cancellation and omission deny launch. Neither
  the index nor user changes are reset, stashed, staged, or automatically excluded.
- `resume({ restart? })` requests a fresh approval and `reconciled: true` attestation.
  It refuses unsettled execution or silent scope changes. Approval and continuation are
  recorded together; only restart resets cycle allowances.
- `restore({ workspace, runId })` opens a configured run without granting execution.
  `pause`, `close`, and mode changes cancel the entire pending operation, including
  controller acquisition after an approval. A timeout does not establish settlement.
- Launch is create-only under the checkout lease: a competing run cannot substitute its
  persisted objective for the one the user approved. Workspace drift during approval
  requires a new decision rather than automatic adaptation or rollback.

`host-gates.mjs` consumes authoritative `pi-plan:query-mode` and `pi-plan:mode-changed`
snapshots. Admission requires a ready matching owner session with selected and enforced
modes both Off and no pending transition. Restriction, branch/context replacement, or
provider replacement revokes tokens synchronously before asynchronous pause. Returning
Off never renews old approval. Missing, duplicate, malformed, or stale providers deny.

Workspace and SDK adapters recheck host admission at dispatch and immediately before
side effects, including after a durable execution-start event. Shell commands and final
checks use `swarm:confirm-request`; edit/write requests retain their actual tool category.
The pi-safety provider uses its existing classifier, modes, delays, and confirmation queue.
Cancellation covers queued and active confirmations without allowing overlapping dialogs;
Swarm approvals do not inherit an unrelated main-agent turn's abort signal.

The existing pi-plan and pi-safety packages now provide these channels. Their combined
pure/factory regression suites pass 66 tests. Tests use fake UI contexts and disposable
state, not interactive human dialogs. Reloading Pi loads the provider changes but does
not activate Swarm; its package remains absent from the enabled package list.

Important remaining limits: approval callbacks still need user-facing UI integration;
this host does not expose orphan-execution reconciliation or live uncertain-process
attestation controls. Silent provider disappearance is detected on the next admission
query, whereas published shutdown/restriction events revoke immediately. Do not activate
live work until those recovery and lifecycle controls are complete.

## Deferred before activation

- Live model/provider support and validation; phase 3 rejects it intentionally.
- Human confirmation UI and dashboard wiring for the implemented host approval protocol.
- Full native coding-tool presentation parity and additional coding tools.
- Human/model evaluation of check adequacy, narrower verification relevance, and user-facing
  reconciliation controls. A mocked successful workflow is not proof of useful real model work.
- Semantic scope/specialization checks, duplicate-recruitment judgments, and detection of
  repetitive non-progressing discussion. Capacity/revision checks do not replace those judgments.
- Automatic compaction policy and session-slot yielding during live tool waits.
- Restart UI, scope revision, history cleanup, safe stale-owner recovery, and package activation.

Keep this package inactive until those adapters and their lifecycle tests are complete.
