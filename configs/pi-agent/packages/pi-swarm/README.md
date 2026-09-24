# Pi Swarm — offline live dashboard and recovery controls

## Status

This is an **inactive implementation**, not an activated Pi extension. Phase 3 creates
real Pi SDK sessions with deterministic mock providers only; live model execution is
explicitly rejected. Phase 2's host-authorized workspace adapter performs guarded file
mutations and shell execution in disposable test repositories. Phase 5 adds an explicitly
injected extension factory and native UI controls for offline testing. No default entry
point, package registration, or activation is installed. Phase 6 adds a disposable CLI/PTY
acceptance harness; it does not activate the package. Phase 7 adds a continuously refreshed
native inspection dashboard to that same explicitly injected mock-only factory. Phase 8
adds separate real CLI acceptance with the actual production Plan/Safety factories.

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

The combined suite has 325 passing tests. It includes actual local shell execution,
process-group cancellation, filesystem races, persistent real SDK sessions, native compaction,
and autonomous peer/tool interaction using scripted providers. Factory tests invoke real SDK sessions through scripted mock providers and fake native
UI contexts. These are not live-model, interactive-terminal, or power-loss tests.

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
| `extensions/swarm/extension.mjs`, `ui.mjs` | Opt-in mock-runtime factory, cancellable native launch/recovery dialogs, commands and lifecycle hooks. |
| `extensions/swarm/dashboard.mjs` | Refreshing, paged, read-only native dashboard; actions return to the existing host controls. |
| `test/` | Foundation, host recovery, and offline real-SDK/factory integration tests. |

## Host API and trust boundary

`SwarmController.open({ workspace, runId, ownerSessionId, create?, clock? })` acquires
checkout ownership and replays an existing run. A new run requires an approved
`create` specification containing `objective`, `criteria`, `scope`, and optional
`limits`. It starts paused. `workspace` must identify the checkout root.

The returned controller exposes:

- `snapshot()`: a detached copy of current state.
- `owner(type, payload, options?)`: **trusted host capability** representing already
  obtained user authorization. UI adapters must obtain that authorization first.
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
to model-visible tools. The host/UI adapters own human approval routing; semantic scope judgments remain
unimplemented. A claimed acceptance-criterion reference or
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
the host bridge must check user approval, safety policy, and execution mode. The
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
The adapter does not schedule periodic deadline ticks: the SDK host driver must do so to
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

Silent provider disappearance is detected on the next admission query, whereas published
shutdown/restriction events revoke immediately. Phase 5 below supplies opt-in UI and explicit
host reconciliation; it does not enable live work.

## Phase 5 opt-in launch and recovery controls

`createSwarmExtension(options)` from `extensions/swarm/extension.mjs` returns a Pi extension
factory only when supplied an explicit `modelRuntime` and `mainModel` using `swarm-mock`.
It has no default export and is not registered in settings or a package manifest. The
existing offline harness invokes this factory directly; do not activate it for live work.
There is no model discovery, credential lookup, network refresh, or dependency-install fallback.
Optional host inputs include thinking level, wrapped coding tools, instructions, and a trusted
runner seam for disposable mock tests. Runner injection is never a command or model argument.

When explicitly injected, `/swarm` now opens the phase-7 dashboard described below.
The phase-5 commands remain available:

- `start <goal>`: enter acceptance criteria and scope/exclusions as JSON string arrays;
  inspect the complete agreement; optionally edit each field using JSON input; then approve.
  Dirty work requires a separate **Preserve existing work** choice. A real mock SDK planner
  investigates the approved goal without a second planning approval. Invalid input fails
  without automatic retry; fields are not semantically clarified by a live model.
- `status`: inspect run/cycle, tasks, specialists, active/queued work, claims, limits,
  unresolved execution, and errors. Usage is explicitly not aggregated and cost is unknown.
- `pause` / `stop`: cancel pending launch/continuation approval and new dispatch, then wait
  for actual settlement. Incomplete stopping retains ownership and is not reported as success.
- `resume` / `restart`: fresh human agreement and workspace reconciliation; only restart
  resets allowances. Settled retained workers can be explicitly woken by these commands.
- `restore <run-id>`: attach an existing owner session's run without execution authority.
- `reconcile`: inspect all unresolved operations/turns, describe independently established
  settlement, and confirm that attestation. A boolean or missing-process assertion alone is
  not the host attestation protocol. Effects remain unknown; commands are never replayed.

`SwarmHost.reconcile()` requests `action: "reconcile"` with operation/turn identities and
live uncertain IDs. The human callback must return `attestation: { kind:
"user-established-settlement", evidence: "..." }` in addition to approval and existing-work
preservation. The host records exact IDs, evidence, workspace fingerprint, cycle and generation
before retiring uncertainty. This is a **user attestation**, not automated proof of process
death. Live uncertain operations retain their leases until attested, and their SDK/tool frames
must then actually unwind. Ordinary active SDK turns cannot be retired as orphan work.
Recovered orphan intents become unknown receipts/interrupted turns, never successful evidence.
Workspace/revision drift or cancellation requires a new decision.

Native select/input/confirm dialogs receive cancellation signals, including during agreement
editing. The native multiline editor is deliberately not used because its current API has no
AbortSignal dismissal contract. No shortcut, footer replacement, or model-visible lifecycle
capability is added. Authorizing controls require TUI; status and brakes do not require a dialog.

The owner session stores a small run-ID link. Reload/restoration reattaches without resuming;
forks and different owner sessions cannot inherit control. Tree navigation, session replacement,
and shutdown revoke pending decisions and pause work; unsettled navigation is cancelled.
Shutdown cleanup waits for controller acquisition, recruitment/session preparation, and real
execution settlement. A failed host close keeps reconciliation access and ownership fencing.
After an actual extension teardown with incomplete settlement, a new instance cannot steal
that lock. Preserve evidence and establish settlement externally; stale-lock recovery is still
unsupported. If shutdown precedes writing the owner link, explicit `restore <run-id>` is needed.

Verification: 304 Swarm tests (271 prior plus 33 new) and 66 provider tests pass offline.
Coverage includes editable/dirty approvals, cancellation and late answers, live streaming abort,
shutdown/reload, late acquisition/recruitment, fork isolation, explicit live/orphan reconciliation,
reconciliation races, and ownership retained after incomplete close. Native dialog rendering,
real human decisions, narrow-terminal behavior, escaped processes, and power-loss recovery are
not validated by fake UI tests. Mode-provider readiness/Off remains required for restore and
reconciliation; missing providers fail closed rather than bypassing policy.

## Phase 6 isolated terminal acceptance

Run with installed Pi 0.85.1, Node 22+, Python 3, and Git on POSIX:

```bash
python3 configs/pi-agent/packages/pi-swarm/test/terminal/run.py
```

`PI_BIN` selects the installed Node-based Pi CLI; `PI_SDK_DIR` selects its SDK package
when needed. There is no install fallback. The harness creates a disposable Git project,
HOME, and `PI_CODING_AGENT_DIR`, checks that Pi resolves that agent directory, disables
startup network operations and resource discovery, and explicitly loads only the test
factory. It forwards no credentials or personal configuration. Temporary sessions,
journals, and observations are removed only after confirmed child exit. Cleanup tolerates
closed-PTY writes and exit/signal races, escalates TERM to KILL with bounded waits, and
always closes the PTY; unconfirmed exit retains the fixture rather than deleting evidence.
Four deterministic cleanup regressions run separately:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s configs/pi-agent/packages/pi-swarm/test/terminal -p 'test_*.py'
```

This is a **real interactive CLI on a Python PTY**, not a fake UI context. It sends
keyboard input through native Pi dialogs and checks emitted terminal text and durable
journal evidence. Verified scenarios:

- Escape cancels initial criteria input without creating run storage.
- At 60 columns / 24 rows, launch criteria/scope, edit the objective, approve the
  agreement, and explicitly preserve dirty work. Replay asserts the persisted edited
  objective and approved criteria/scope.
- Pause an actually streaming mock worker; confirm resume without resetting the cycle.
- `/reload` during streaming aborts work and restores paused without another model turn.
- Resize to 100 columns / 40 rows, switch to built-in light, open/cancel the control menu.
- Resume and stop while streaming; observe abort and no spontaneous worker restart.
- Explicit restart; native shell-permission dialog for a simulated uncertain operation;
  written settlement evidence and native attestation confirmation; eventual paused then
  stopped status. The journal records one attestation and one unknown execution receipt,
  with no effect replay or successful completion. Reducer replay checks that resumes retain
  consumed allowances and restart produces cycle 2 with reset elapsed time/task allowance,
  archived prior-cycle usage, and subsequent new-cycle task consumption. Original fixture
  content is unchanged.

The fixture uses deterministic mock SDK workers, a **test-only Off-mode publisher and
shell-confirmation provider**, and a runner that deliberately returns uncertainty without
spawning a process. It does not test production Plan/Safety rendering or prove real process
settlement. The separate 66 provider regressions still pass. All 304 Swarm tests pass,
plus this PTY acceptance scenario; no production defect required a fix in this phase.

Limits: terminal assertions inspect the emitted ANSI/text stream, not a pixel screenshot
or a full terminal-emulator viewport. Long structured summaries use terminal scrollback;
readability/contrast, IME, mouse, other terminal emulators, and human judgment remain
unverified. This is automated keyboard acceptance, not a human sign-off. No live provider,
network-backed operation, crash/power-loss recovery, or stale-lock takeover is exercised.
Phase 7 below adds dashboard acceptance; usage aggregation remains deferred.

## Phase 7 mock-only live dashboard

`/swarm` or `/swarm dashboard` opens a native `ctx.ui.custom` inspection view. It refreshes
host snapshots every 500 ms while open; it does not create a host, grant approval, wake a
worker, or change model conversation limits. The existing `/swarm status` remains available.

- `1` Overview: objective, status, cycle/revision, recorded active time, current capacity,
  approved limits, criteria/scope, prior cycles, and errors. Time follows durable host ticks,
  not a fabricated continuously running timer.
- `2` Workers: stable focus/brief, current task IDs, active SDK turn, queued, or idle status.
  Left/right selects a specialist; Enter opens its persisted native history.
- `3` Tasks/review, `4` Claims/blockers/unresolved execution, `5` peer messages, `6` history.
  Structured detail is intentionally plain rather than a rich chat/tool renderer.
- Arrows/PageUp/PageDown scroll; Home/End reach either end. History includes all persisted
  native entries, including compaction records; viewport pagination does not discard history.
- `p` **Pause**, `s` **Stop**, `r` resume when paused, `R` restart when eligible, and `c`
  reconcile. Escape closes inspection without pausing work. Continuation/reconciliation
  closes the dashboard before the existing human approval flow; it never bypasses policy.

The component receives only snapshot/history functions, not host execution capabilities.
`SwarmHost.history(workerId)` validates the bound native file/identity and returns detached
records without constructing SDK sessions. Persisted history may lag in-flight output.
Usage is **not aggregated** and cost is explicitly **unknown**; mock zero pricing is not
represented as a real billing estimate. Current active/queued counts are driver observations,
not token/cost estimates. No tool-by-tool streaming telemetry or context-fill metric is claimed.

Refresh timers and abort listeners are disposed on close, action, UI failure, navigation,
shutdown, and reload. Opening while a Swarm approval is pending is refused. A worker safety
request explicitly dismisses and awaits the dashboard before invoking its provider; Pi's
best-effort/coalesced UI prompt events alone are not used as a dialog serialization guarantee.
All command actions verify the same owner session; controls retain host mode/approval gates.

Verification: **325 Swarm tests** (304 prior + 21 dashboard/history regressions), **66 provider
regressions**, **4 PTY cleanup tests**, and the extended real CLI PTY scenario pass offline.
Tests cover deterministic refresh/disposal, navigation past 100 history entries, width bounds
at 1–100 columns, Unicode/control escaping, read failures, foreign-session denial, lifecycle
closure, and safety/continuation dialog exclusion. The PTY observes repeated host-tick repaint
without input, 60-column worker/history navigation and pause, light-theme resume, and stop.
No live provider, activation, dependency install, commit, or push is part of this phase.

Limitations: this is a minimal useful first dashboard, not the full proposed activity tree.
There is no persistent above-editor widget, rich conversation bubbles/tool rendering,
search, live partial transcript, usage aggregation, or dashboard guidance editing. Detail is
line-paged structured text. Complete histories are validated/read in memory when the selected
worker or run revision changes; very large histories are not performance-validated. Terminal
assertions inspect emitted text, not a full viewport emulator or human visual acceptance.
Swarm-owned approval exclusion is verified; arbitrary third-party custom-UI concurrency is
not a general modal arbitration contract. Existing recovery/settlement limitations still apply.

## Phase 8 production policy-provider terminal acceptance

With the same installed-tool prerequisites as Phase 6, run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 configs/pi-agent/packages/pi-swarm/test/terminal/production.py
```

This separate scenario explicitly composes the **production pi-plan and pi-safety
factories** with Swarm's mock-only factory. It does not replace either policy provider,
activate global packages, install dependencies, copy credentials, or contact live models.
The earlier `run.py` scenario remains unchanged, including its synthetic policy fixtures
and simulated uncertainty. Both scenarios reuse its bounded TERM/KILL cleanup guard.

Verified with Pi 0.85.1:

- Production safety custom dialogs serialize three public-protocol requests. Cancel a
  queued request before it opens, cancel the active dialog, then deny the remaining one.
  Repeat after native reload to check that provider claims do not accumulate. These are
  test-only **requesters**, not replacement providers or concurrent worker shell leases.
- Shift+Tab selects Discuss during a native launch agreement: approval is revoked and no
  run storage is created. Explicitly return Off, approve launch, and preserve dirty work.
- Real main CLI mock turns retain their old enforced mode during Off→Quick and Quick→Off
  transitions. Swarm pauses on restriction and rejects resume while Off is selected but
  Quick remains enforced. Returning Off never resumes workers. Plan also denies resume
  and restart; returning Off again grants no execution authority.
- Explicit resume drives real SDK task creation/claim and a benign `node -e` shell call.
  Opening the dashboard before that call verifies it closes before production Safety UI.
  Approve one command, deny another, and select Discuss during a third confirmation.
- Native `/reload` during worker streaming aborts and restores paused without dispatch.
  Production mode instance identity changes. Native CLI SIGTERM shutdown during a worker
  confirmation cancels the dialog and settles SDK turns/assignments to paused.
- Reducer replay asserts five approved same-cycle resumes, retained allowances, exactly
  one actual successful shell receipt (exit 0, unchanged checkout fingerprint), no denied
  or cancelled effects, no completion claim, and no unresolved operations/turns. Native
  worker history contains actual approved stdout and three failed/cancelled tool results.
  Native dialog-call observation asserts no overlap and balanced open/close lifetimes.
- Disposable HOME/agent/project isolation is checked; original dirty content survives.
  Only native changelog bookkeeping changes the fixture settings, auth stays empty, and
  production audit records omit command arguments. No personal settings are modified.

Verification remains **325 Swarm tests, 66 provider tests, 4 cleanup regressions**, plus
**both real CLI PTY scenarios**. No production fix was required. The repository validator
reports its pre-existing model/thinking default mismatch plus the three intentionally
untracked Phase 8 test files; defaults are not normalized and changes remain uncommitted.

Limits: automated keyboard/ANSI and durable-record acceptance, **not human visual sign-off**
or a viewport/pixel test. The main mock intentionally delays abort completion briefly to
observe selected/enforced states. Queue probes never execute their commands; worker shell
execution is separately proven by receipts and native history. No dangerous, destructive,
network, or live-provider commands are exercised; delayed destructive/network confirmation
categories are not terminal-validated here. Shutdown settlement is not proof about escaped
processes, arbitrary external effects, crashes, or power loss. General third-party modal
arbitration, other terminals, IME/mouse, and all remaining activation gates stay deferred.

## Deferred before activation

- Live model/provider support and validation; phase 3 rejects it intentionally.
- Human visual TUI acceptance, broader policy/category/terminal acceptance, a compact
  persistent activity tree, and richer dashboard/conversation rendering.
- Full native coding-tool presentation parity and additional coding tools.
- Human/model evaluation of check adequacy and narrower verification relevance. A mocked
  successful workflow is not proof of useful real model work or independently proven settlement.
- Semantic scope/specialization checks, duplicate-recruitment judgments, and detection of
  repetitive non-progressing discussion. Capacity/revision checks do not replace those judgments.
- Automatic compaction policy and session-slot yielding during live tool waits.
- Scope revision, rich/streaming transcript UI, usage aggregation, safe stale-owner recovery, and
  package activation. There is no automatic cleanup, commit, push, or rollback.

Keep this package inactive until those adapters and their lifecycle tests are complete.
