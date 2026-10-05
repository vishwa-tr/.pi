# Pi Swarm — native Pi workers and recovery controls

## Status

Swarm is **registered and enabled** by this repository's canonical `agent/settings.json`.
Its package manifest loads the native entry through the current public **ModelRegistry**,
model and thinking level. Normal use needs no `-e` flag. Registration does not authorize
execution: every launch and continuation still needs explicit human approval, ready Plan Off
and Safety providers. Loading, reload and session resume never automatically dispatch work.
The injected factories remain available; legacy callers remain mock-only. Offline coverage
uses in-memory fixture authentication and scripted providers; one separately approved bounded
native-model trial is recorded below. Activation does not authorize another live trial.
Historical phases below describe their original boundaries, not the current activation status;
Phase 14 supersedes the earlier
requirement to build a custom HTTP/auth stack for production integration. Phase 2's host-authorized workspace adapter performs guarded file
mutations and shell execution in disposable test repositories. Phase 5 added an explicitly
injected extension factory and native UI controls for offline testing, without an entry point
at that stage. The registered normal entry below now supplements it. Phase 6 adds a disposable CLI/PTY
acceptance harness; it does not activate the package. Phase 7 adds a continuously refreshed
native inspection dashboard to that same explicitly injected mock-only factory. Phase 8
adds separate real CLI acceptance with the actual production Plan/Safety factories.
Phase 9 adds opt-in provider agreement/readiness plumbing. Phase 10 adds a constrained
Chat Completions adapter tested through an explicitly injected offline transport. Phase 11 adds
an explicitly authorized Node HTTPS client, verified only against ephemeral loopback TLS fixtures.
The custom constrained/HTTPS stack is retained as an **optional legacy/experimental path**,
not the production default. **No default remote endpoint or new provider discovery is included.**

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

Requires Node 22.19+, Git, and a local Unix filesystem that supports the synchronization
and no-follow operations used by the storage layer. The complete suite also requires the
installed Pi SDK/CLI **1.0.0 or newer** (1.0.0 is the original verified baseline;
1.0.1 also passes the current suite and dashboard/normal-entry PTY checks). Pi 1.0 requires Node 22.19+. Older Pi releases are no longer supported by
this package; historical phase results below describe their original verification. The test bootstrap resolves public package exports;
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

The current combined suite has **527 passing tests on Pi 1.0.1**. It includes actual local shell execution,
process-group cancellation, filesystem races, persistent real SDK sessions, native compaction,
and autonomous peer/tool interaction using scripted providers. Factory tests invoke real SDK sessions through scripted mock providers and fake native
UI contexts. These are not live-model, interactive-terminal, or power-loss tests.

An opt-in, supervised synthetic exercise is documented in [test/live/README.md](test/live/README.md).
It requires separate outbound approval and inspection of generated source before executing tests;
its default invocation is a dry run with no provider calls.

## Normal Pi usage

With this repository's global configuration, start Pi in your target project folder and use
`/swarm`; the configured package already loads the reviewed native entry. Do not add another
Swarm, Plan, or Safety copy via `-e` or a second checkout.

For a separate configuration without these packages, explicit per-invocation loading remains
available. Load each package only once (omit entries already configured):

```bash
pi -e <configuration-root>/configs/pi-agent/packages/pi-plan/extensions/plan/index.ts \
   -e <configuration-root>/configs/pi-agent/packages/pi-safety/extensions/safety/index.ts \
   -e <configuration-root>/configs/pi-agent/packages/pi-swarm
```

Use a persisted interactive session, an already configured physical chat model (`/model`),
and the desired `/thinking` level. Plan must be ready and **Off**; missing or conflicting policy
providers deny execution. Before asking launch questions or binding a model host, Swarm checks
Git prerequisites. If the folder is not in a repository, it offers a native confirmation to
initialize Git in that exact folder, without staging or committing. For an existing repository,
start Pi at its checkout root (including a worktree root), not a subdirectory; Swarm never
silently initializes a nested repository or modifies a parent checkout.

If runtime records are not excluded, a separate confirmation offers to append `/.swarms/` to
the root `.gitignore`. It preserves existing bytes, newline style and file permissions; it
refuses linked/non-regular or unsupported-encoding ignore files. Git verifies both the runtime
directory and a nested runtime path are ignored and that no runtime records are tracked.
Tracked `.swarms` files require your own review: Swarm never removes, unstages or deletes them.
Git must be installed and accessible; setup errors give local corrective guidance without
printing raw Git errors. Existing source/index work is preserved and still needs an explicit
preservation decision at launch.

Each setup change requires its own positive consent, ready Plan Off and the same current
owner/model context. Declining, Escape, timeout, restriction or context cancellation prevents
further writes. **Previously approved setup changes remain if a later step or launch is
cancelled**; there is no automatic rollback. Setup creates no run or model request and writes
no `.git/info` exclusions. Setup rechecks the root directory's device/inode identity as well
as its canonical path across confirmation and inspection, and before mutation. Ignore updates
use a checked atomic replacement; these are cooperative local-filesystem safeguards, not an
OS sandbox against concurrent external writers.
This guided setup supersedes historical manual-prerequisite instructions below.

- `/swarm start <complete prompt>` preserves the full prompt as the objective and opens
  one editable approval screen, without separate success-criteria or scope questions.
  `/swarm start` without a prompt asks only for the objective first; blank or overlong
  answers re-prompt and Escape cancels. The objective must be non-empty and at most
  32768 characters. Swarm captures the **current** model/thinking for the agreement.
  Criteria default to satisfying the behavior and verification requirements in the approved
  objective; scope defaults to only the requested task, honoring its file and dependency
  constraints. These are automatically seeded, editable references to the full objective,
  not semantic extraction, proof of adequate requirements, or inferred permission to broaden
  the task. No model call is made to prepare them. Review the full objective, criteria,
  scope, provider/context and limits; use **Edit agreement** to change any run field before
  approving (JSON string for objective, JSON string arrays for criteria/scope).
  Workers still receive the full approved objective. Existing-work preservation and any
  necessary Git setup remain separate explicit consent decisions.
  Cancelling the agreement creates no run or model request. Authentication is resolved by Pi only at an
  admitted request; selecting a model is not certification that its credentials will work.
- `/swarm`, `/swarm status`, `/swarm pause` and `/swarm stop` inspect or brake work. Load,
  discovery and inspection never request provider streams, auth resolution or catalog refresh.
- Main model/thinking changes revoke active approval and pause; workers retain their approved
  snapshot. Cancellation also fences commands waiting for host preparation or reload restoration:
  they cannot start a late operation or present a fresh agreement after cancellation.
  Resume/restart requires fresh agreement to that **original** selection, not an
  autonomous model switch. To use another selection, stop/settle the old run and start a new
  persisted owner session/run. Existing runs are not migrated between models.
- Reload/shutdown closes the old host. The owner link is rediscovered without binding a model;
  the next explicit control reattaches paused after startup policy providers are ready. Select
  the saved run's model/thinking before restoring. Forks cannot inherit control. Neither reload,
  session resume nor ordinary prompts automatically dispatch Swarm work.

Without a selected model, loading and status still work; starting explains that `/model` is
required. Authorization controls require TUI, not print/JSON/RPC. Approval defaults to a finite
120-second timeout. Native Pi owns credentials, OAuth and routing; the displayed endpoint is
informational, not an egress pin. Review outbound context before approving. There is no cost cap,
OS sandbox, general provider certification or claim of human visual acceptance.

To disable, stop and establish settlement first, then remove the Swarm package entry from
`agent/settings.json` and restart Pi or reload. For per-invocation use, omit its `-e` entry
next time. Preserve run evidence and project changes; removing registration is not settlement
or permission to delete a run.

Fresh-loader acceptance (no SDK resolver preload):

```bash
PYTHONDONTWRITEBYTECODE=1 python3 configs/pi-agent/packages/pi-swarm/test/terminal/entry.py
PYTHONDONTWRITEBYTECODE=1 python3 configs/pi-agent/packages/pi-swarm/test/terminal/entry.py --package-root
```

These exercise both raw-file and package-root loading in isolated offline CLI sessions:
missing-model load/status/reload, then a scripted native
provider registered through Pi alongside actual Plan/Safety entries, current-model selection,
declined initialization with zero changes, separately approved Git/ignore setup, declined
ignore changes, CRLF/permission/source preservation, prompt-first approval, cancelled agreement
with zero auth/dispatch, approved dirty-work launch and paused reload.
The other four PTY scenarios remain separate broader policy/workspace regressions.
Guided-setup verification also passes **68 Plan/Safety tests**, **four PTY cleanup tests**,
and all five PTY scenarios (normal entry checked as both raw file and package root).
Setup regressions cover permission/Git failures, linked ignore files, tracked runtime state,
worktree roots, concurrent user edits, same-path root replacement during either setup consent,
ambient Git routing, and policy/owner/model cancellation without later writes.
These are automated offline checks, not human visual sign-off.

## Dashboard keys and conversations

`/swarm` is a focused, read-only inspection overlay, refreshed every 500 ms. Opening it
never wakes workers or resolves authentication. The existing pause/stop and approval gates
still own execution. Safety requests dismiss inspection before opening their decision UI.

| Key | Action |
|---|---|
| `1`–`6`, `Tab`, `h` / `l` | Choose pane, next pane, previous / next pane |
| `j` / `k`, arrows | Select workers; otherwise scroll text |
| `Enter` on a worker, `c` | Open selected worker's conversation |
| `gg` / `G`, Home / End | First / last page |
| Ctrl-u / Ctrl-d, PageUp / PageDown | Half page / full page |
| `/`, Enter | Local literal, case-insensitive conversation search; one match per source line |
| `n` / `N` | Next / previous matching line, wrapping at either end |
| `f` | Toggle conversation follow-tail; manual scrolling disables it |
| `?` | Scrollable contextual help |
| `q` / Escape | Back from conversation/help; otherwise close without pausing |
| `p` / `s` | Pause / stop (outside search/help) |
| `r` / `R` | Approved resume / restart when eligible |
| `C` | Reconcile through existing approval flow (formerly lowercase `c`) |

Search owns typed/pasted text: action letters cannot brake or approve while entering a
query. Escape cancels the draft; submitting an empty query clears search. Ctrl-c keeps Pi's
global behavior. Approval dialogs start in **Details** with **Cancel** selected. **Tab** or
**Shift+Tab** switches between Details and the vertical **Actions** list. **j/k** or
**Up/Down** scrolls Details or selects Actions, stopping at either end. **Enter** only
confirms in Actions; **Escape** cancels from either area. In Details, **PageUp/PageDown**,
**Home/End** and **gg/G** navigate the packet. Every non-cancel action retains the
read-to-end gate; typing action letters or pasting text never approves a decision.
Global shortcuts still take precedence: with Pi Plan enabled, **Shift+Tab** cycles mode
instead of switching areas and can cancel approval on restriction. Use **Tab** to switch
areas in that configuration; the component also accepts Shift+Tab when delivered.

Conversation entries show roles, timestamps, text, thinking, tool arguments/results,
system section/tool updates, compaction checkpoints and context edits. Earlier entries remain
reachable; there is no arbitrary history-retention cap. This is persisted history, not token
streaming: in-flight output can lag until the native session writes it. Scrolled position and
worker identity survive refresh; follow-tail is opt-in. Terminal/bidi controls are visibly
escaped before theme styling. Full text remains wrapped and paged at 60×24 and 80×24.

Native response token counters are shown only when present; mock/legacy placeholders are
not usage measurements. Run totals remain unaggregated and cost unknown. Provider replay
metadata, private host/session header fields, opaque tool details and raw provider diagnostics
are not dumped into this viewer. Images have a media-type placeholder, not binary rendering.
Custom extension-state entries remain visible as markers without exposing their private data.
No raw-record toggle is provided. Task/review and claims panes retain evidence and settlement
information; a candidate or pending report is not completion.

Limitations: histories/layout are materialized in memory; very large-history performance,
IME editing, mouse and human visual acceptance are not certified. Search supports text,
backspace and paste, not a full editor. Resize can reflow the current line position. Search
and inspection are entirely local, without model or network calls.

**After source updates, fully restart Pi.** `/reload` tears down the old interaction and
restores paused ownership, but native ESM modules may remain cached in the process; it is
not a guarantee that edited source code is reloaded.

Offline verification on Pi 1.0.1: **527 Swarm tests**, **68 Plan/Safety tests**,
**four PTY cleanup tests**, and all five CLI scenarios pass. Normal entry was verified
through both file and package loading. The actual CLI exercises search-input isolation, conversation/back navigation and
focused End/Home help paging. Existing safety exclusion and reload tests remain intact;
TLS retains exactly **17 requests** and native registry acceptance **19 dispatches**. These
are scripted-provider checks, not a new live-model trial or human visual sign-off.

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
| `extensions/swarm/sdk-session.mjs` | Non-discovering SDK factory, explicit branded native/legacy or mock gate, private native JSONL validation and synchronization. |
| `extensions/swarm/session-tools.mjs`, `specializations.mjs` | Uniform model-visible tool definitions and generated specialist/context prompts. |
| `extensions/swarm/provider-capability.mjs` | Strict immutable host provider configuration, branded adapter selection and unsupported-transport preflight. |
| `extensions/index.ts`, `extensions/swarm/native-binding.mjs` | Explicit normal-loader entry and SDK-free native capability bookkeeping. |
| `extensions/swarm/native-provider.mjs` | Branded public Pi runtime/registry delegation, model snapshot and per-request host admission; native Pi owns auth and transport. |
| `extensions/swarm/constrained-provider.mjs` | Isolated text Chat Completions request/response adapter with explicit credentials, request fencing and branded transport settlement. |
| `extensions/swarm/https-transport.mjs` | Explicit host egress authorization, pinned public-IPv4 HTTPS client, separate loopback test policy and actual socket settlement. |
| `extensions/swarm/extension.mjs`, `ui.mjs`, `decision.mjs` | Opt-in factory, bounded cancellable native decision packets, commands and lifecycle hooks. |
| `extensions/swarm/launch-setup.mjs`, `launch-input.mjs` | Explicitly consented Git/runtime-exclusion prerequisites, optional objective input and editable objective-referencing defaults, before host binding. |
| `extensions/swarm/dashboard.mjs`, `transcript.mjs` | Focused, refreshing, read-only dashboard and semantic transcript/search; actions return to existing host controls. |
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
- `history(workerId, limit?)` reads validated persisted entries directly, without constructing
  an SDK session or consulting the model runtime. Limits remain 1–100 (default 20); raw
  compaction entries are retained and in-flight output may lag, as in the dashboard.
  `compact(workerId)` uses the native SDK and preserves session identity. Every later prompt reloads shared state. Automatic compaction
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

- `start <goal>`: inspect the complete agreement with the full objective and automatically
  seeded criteria/scope references; optionally edit each field using JSON input; then approve.
  With no goal, only objective input is requested. Blank/invalid objectives re-prompt and
  Escape cancels before host preparation. Malformed JSON edits leave the agreement unchanged.
  Dirty work requires a separate **Preserve existing work** choice. A real mock SDK planner
  investigates the approved goal without a second planning approval; fields are not
  semantically clarified by a live model.
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

Native inputs/selectors receive cancellation signals during agreement editing. Phase 13
replaces the long agreement/confirmation dialogs with bounded cancellable decision overlays. The native multiline editor is deliberately not used because its current API has no
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

Run with installed Pi 1.0.0, Node 22.19+, Python 3, and Git on POSIX:

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

- Escape cancels initial objective input without creating run storage.
- At 60 columns / 24 rows, open the agreement directly, edit objective/criteria/scope, approve the
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

This section records the original Phase 7 baseline; the current overlay, conversation and
key behavior supersedes it as described in [Dashboard keys and conversations](#dashboard-keys-and-conversations).

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

## Phase 9 offline provider-agreement readiness

This phase implements **configuration and approval readiness**, not network execution.
The optional `providerCapability` input on `SwarmHost` and `createSwarmExtension` accepts
only an object returned by `createProviderCapability` from `provider-capability.mjs`.
It is a host configuration capability, not human approval or a transport callback. It is
never exposed through worker tools; serialized copies cannot be used as capabilities.
Existing callers without this option remain on the unchanged legacy mock-only path.

An explicitly injected scripted mock host can construct:

```js
const providerCapability = createProviderCapability({
  version: 1,
  provider: "swarm-mock",
  modelId: "scripted",
  api: "swarm-mock",
  endpoint: "https://swarm-mock.invalid",
  transport: "scripted-memory",
  outboundData: [...PROVIDER_DATA_SCOPE],
});
```

Import both names from `extensions/swarm/provider-capability.mjs`, then pass the capability
alongside the existing mock runtime and model. This does not create or activate a runtime.
The descriptor is copied and deeply frozen. Unknown fields, undeclared context categories,
endpoint/API/model substitutions, and model headers, compatibility routing, or sampling
payload overrides fail closed. In-memory identity references also detect provider/runtime
method replacement on the next admission; returning to the old identity does not renew approval.

The complete context declaration includes objective/guidance, host instructions, workspace
content, tool definitions/results, worker histories, peer messages, and compaction summaries.
It describes potential provider-visible context, **not redaction or semantic data filtering**.
For scripted-memory transport all of it remains in the process; no endpoint request occurs.
The native agreement shows the descriptor separately from editable objective fields. Approval
answers cannot replace that host binding. Every approved launch/resume/restart durably stores
it with the fresh approval ID; replay rejects its removal or replacement. Restore requires a
matching newly host-created capability and remains paused pending fresh human approval.
Mode restriction, session/lifecycle cancellation, and detected binding drift invalidate the
existing host execution permit. Restoring Off or old model metadata cannot reactivate it.

A descriptor may instead declare `transport: "https-unsupported"` with an explicit canonical
HTTPS endpoint (no credentials, query, or fragment). This supports pure schema/readiness
inspection only. Host launch returns `UNSUPPORTED_TRANSPORT` **before invoking any supplied
model-runtime method, presenting approval, or creating run storage**. There is no real
transport callback, trusted-runtime bypass, credential discovery, login, refresh, or fallback.
The extension factory and SDK session factory retain their existing live-model rejection.

Why not simply accept an SDK runtime? Its provider composition can discover ambient auth,
OAuth refresh, catalog overrides, proxies and environment; request sampling parameters can
replace the model field. A descriptor alone does not constrain those effects. A future real
adapter must enforce the actual destination and payload, own explicit credential handling,
exclude ambient resolution and redirects/fallbacks, and fence every request (including SDK
follow-ups, compaction and retries). It needs separate authorization and transport-level
acceptance. Phase 10 below supplies an offline-tested constrained adapter, not live-readiness certification.

Verification: **335 Swarm tests**, **66 provider tests**, **4 cleanup regressions**, and
**both existing CLI PTY scenarios** pass offline. Ten new tests cover immutable/forged
capabilities, strict scope/schema, endpoint/payload/implementation substitution, durable fresh
approvals, cancellation, mode revocation, paused restore, missing capability, and explicit
unsupported live preflight. Scripted real SDK integration runs under a test-process guard
blocking fetch, sockets, TLS, HTTP(S), and common DNS entry points; zero network attempts are
asserted. This guard is defense-in-depth for the tests, not an OS sandbox or a guarantee about
arbitrary injected JavaScript. PTY scenarios remain mock-only legacy-path regression checks;
new capability behavior is covered by the Node host/SDK tests, not new terminal acceptance.
The repository validator still reports unrelated model/thinking defaults and the two new
untracked phase-9 files; no settings are changed or files staged.

## Phase 10 constrained provider adapter — offline acceptance only

`createConstrainedRuntime` in `extensions/swarm/constrained-provider.mjs` is an async,
host-only constructor. Supply all four inputs explicitly: a branded `capability`, a literal
in-memory `credential`, a trusted offline `transport(request)` callback, and optionally
`timeoutMs` (default 30 seconds, maximum ten minutes). Construction does not invoke transport.
Phase 10 supplied **no default destination, actual HTTP client, live trial, or automatic upgrade**.
Phase 11 below adds a separately authorized client; the offline callback remains supported.

The capability descriptor must declare `transport: "https-chat-completions"`,
`api: "openai-completions"`, an explicit non-mock provider/model, the full existing outbound
scope, and the **exact canonical HTTPS request URL ending in `/chat/completions`**. It is
not a base URL to which paths are appended. Credentials/query/fragment in the URL remain
forbidden. The same capability and returned runtime must be supplied to `SwarmHost` or
`createSwarmExtension`, with its `getModel(provider, modelId)` result and thinking `off`.
Generic SDK runtimes and serialized/forged adapters are rejected. Existing mock callers
remain unchanged, and `https-unsupported` still rejects before runtime lookup or approval.

The runtime is a minimal frozen SDK-compatible facade, not `ModelRuntime.create()` or a
registered provider. It uses only public package exports. It never consults credential
stores, environment, OAuth, catalogs, proxy configuration or compatibility overrides.
The credential is held only in a private runtime binding and the transient Authorization
header; it is not part of model metadata, approvals, journals or SDK auth results. Runtime
serialization cannot recover it. Restore needs a newly supplied in-memory runtime/capability
and fresh approval, never an automatically recovered secret.

### Request and response contract

The injected callback receives a frozen `{ url, method, headers, body, signal, redirect,
retries }` request: exact approved URL, POST, JSON content type, SSE Accept, literal Bearer
credential, `redirect: "error"`, and `retries: 0`. The JSON body contains only the exact
model, system/user/assistant/tool text messages, function definitions/calls/results,
`stream: true`, and bounded `max_tokens`. SDK payload/header/response callbacks are never
invoked. Auth/header/environment/sampling/fetch/metadata overrides are rejected. No
request IDs, attribution headers, telemetry, cache-routing identifiers or SDK defaults are
forwarded. Every stream/complete entry point uses this one builder.

The callback returns `{ status, contentType, body }`, where `body` is an async iterable of
UTF-8 byte chunks (or text chunks). Only status 200 and `text/event-stream` are accepted;
redirects and other status codes fail without follow-up requests. Parsing handles chunked
UTF-8/SSE and fragmented function arguments, requires a supported finish reason and
`[DONE]`, and validates call IDs/names/object arguments before publishing any content.
Responses declaring another model are rejected. Request and response sizes are capped at
4 MiB; at most 64 tool calls and 8192 output tokens are accepted. Responses are buffered
until fully validated, then emitted through the public SDK text/tool-call event protocol.
Malformed/truncated/unsupported responses and arbitrary transport exceptions produce only
fixed sanitized error strings, including in persisted SDK history. No automatic retry,
fallback, redirect following or model substitution is implemented.

The transport callback is a **trusted offline test seam, not a sandbox or network
permission**. It must honor the exact request and cancellation signal, own and settle all
of its resources, and neither log the credential nor perform secondary requests. The adapter
retires the request signal after completion/error for cleanup. Arbitrary injected JavaScript
can violate that contract; these offline tests do not certify an HTTP client. Phase 11 below
adds a separately authorized branded Node HTTPS implementation and loopback acceptance;
using a callback does not inherit that implementation's socket-settlement guarantee.

### Admission and settlement

The unbound runtime cannot dispatch. The SDK factory creates a worker-local binding whose
admission checks fresh human approval, authoritative mode, execution ownership, active turn,
cycle/generation and guidance revision. Every request first durably ticks the run deadline,
then rechecks immediately before transport dispatch and before publishing a valid response.
The request signal combines SDK cancellation, host/turn cancellation and its own deadline;
normal host ticks cancel active requests at the run deadline. This covers tool follow-ups,
all four stream/complete methods, and native manual compaction. Compaction abort explicitly
calls the public SDK `abortCompaction()` as well as aborting the session.

Cancellation requests termination; it does not fabricate settlement. A transport ignoring
abort keeps the SDK turn and ownership active until it actually unwinds. Pause timeout
therefore reports incomplete settlement rather than releasing ownership. Returning Off,
restoring a session, or restoring metadata never renews approval.

### Verified scope and limitations

**361 Swarm tests** (335 previous + 26 adapter regressions), **155 SDK-free foundation
tests**, **66 Plan/Safety tests**, **4 PTY cleanup regressions**, and **both existing real
CLI PTY scenarios** pass offline. Adapter tests guard fetch, sockets, TLS, HTTP(S), and DNS
and assert zero attempted network calls. They exercise exact construction, forged bindings,
overrides, text/tool round-trips, errors/redaction, response bounds, request/run deadlines,
mode revocation, real SDK follow-ups, native compaction, uncooperative compaction settlement,
and paused restore with fresh approval. PTYs remain legacy mock-only regression checks.
`git diff --check` passes. Global validation still reports the pre-existing model/thinking
default mismatch and five intentionally untracked phase-9/10 source/test files; no defaults
were changed and no files staged.

This is a deliberately small **text/function-call Chat Completions subset**, not general
OpenAI/provider compatibility: no images, reasoning, Responses API, deferred work, WebSocket,
provider-specific fields, alternate auth, remote catalogs, retries or usage-only SSE frames.
Tool schema execution validation remains SDK-owned. Usage and cost are **unknown**; SDK-required
zero-valued counters/prices are placeholders, not billing or token measurements. Context
capacity is a conservative fixed 32768-token metadata value, not discovered model capacity.
No successful remote exchange, network-client security, live-model usefulness, human visual
acceptance, process escape handling, or activation readiness is claimed. Remove the explicit
adapter injection to return to mock-only operation; no settings or global resources change.

## Phase 11 explicit Node HTTPS transport — loopback acceptance only

`extensions/swarm/https-transport.mjs` provides an inert, host-only transport constructor.
There is no automatic callback replacement, selected provider, credential lookup, or default
endpoint. A future independently authorized remote trial must explicitly supply all inputs:

1. Construct the existing immutable `https-chat-completions` provider capability.
2. Call `authorizeHttpsEgress(capability, { allowNetwork: true, endpoint, modelId })` with
   the **exact descriptor endpoint and model**. This branded, non-serializable authorization
   is a trusted host attestation of egress permission, not a human approval dialog or a
   model-visible capability. Do not mint it without separately obtaining that permission.
3. Call `createHttpsTransport({ capability, authorization })`, then supply its branded
   result as `transport` to `createConstrainedRuntime`, alongside the explicit in-memory
   credential. Construction performs no DNS lookup or connection.
4. Supply the matching capability/runtime/model to the existing host. Fresh run approval,
   authoritative mode, owner, turn, generation, guidance and deadline admission still apply
   to **every** request, including tool follow-ups and native manual compaction.

Forged/copied authorizations, mismatched capability identity, endpoint/model substitution,
extra authorization/transport options, and generic runtime injection are rejected. Legacy
mock/offline defaults and the `https-unsupported` preflight gate remain unchanged.

### Destination, TLS and cancellation boundaries

The production policy accepts **IPv4 only**. Each request resolves the exact hostname through
Node's OS lookup, vets every returned IPv4 answer against a conservative special-use/private/
loopback/link-local/documentation/multicast/reserved denylist, then pins one permitted address
in a request-local lookup callback. Mixed public/private answers fail closed. There is no
second lookup, alternate-address fallback, redirect following, retry or proxy-environment
routing. The original approved hostname remains the HTTP Host and TLS verification identity.
Resolution itself may use OS resolver configuration, hosts files and external DNS; it is not
DNSSEC validation, a remote-provider identity attestation, or a guarantee against privileged
OS/network interception. IPv6-only providers and private deployments are unsupported.

Each request uses its own non-pooling HTTPS agent, no global-agent routing or session cache,
explicit built-in Node trust roots, normal hostname verification, `rejectUnauthorized: true`,
and TLS 1.2 or later. Ambient extra CA files, provider auth, environment proxy configuration,
SDK headers/hooks and routing overrides are not used. Only the fixed application headers
plus Node's Host, explicit Content-Length and Connection: close are sent. Response headers
are bounded to 16 KiB; existing body/parser limits remain. No certificate-error bypass exists.

Admission and the combined cancellation/deadline signal are checked after DNS, immediately
before creating the request, and after resource settlement before publishing validated content.
Abort destroys the response/request. The adapter privately recognizes the branded transport's
per-request settlement record and waits for **both ClientRequest and assigned socket close**,
even when status or parsing fails before normal body iteration. Terminal SDK events are emitted
only afterward; merely requesting abort or trusting an arbitrary `close`/`settled` callback
is not treated as settlement. Offline injected callbacks retain their earlier trusted contract.

Node OS DNS lookup is not cancellable: an outstanding lookup keeps the request/turn unsettled
until it returns, and then abort/admission prevents connection. Pause timeout must therefore
retain ownership, not report completion. Timers need a responsive event loop. Local socket
close proves local resource retirement, **not remote work cancellation, server-side rollback,
zero already-transmitted bytes, daemon/process death, power-loss recovery, or an OS sandbox**.
Trusted in-process JavaScript can still tamper with built-ins or perform independent I/O.

### Loopback-only verification

`authorizeLoopbackHttpsTest` is a separate explicit host API accepting the same exact inputs
plus a supplied ephemeral CA. It permits only `localhost` or `127.0.0.1`, an explicit port,
and a pinned `127.0.0.1` connection, with that CA alone and strict hostname verification.
It cannot authorize a remote hostname or make the production public-address policy accept
loopback. It is never selected automatically or by worker/configuration data.

The **test-only** `test/tls-fixture.mjs` generates fresh RSA-2048 CA/server keys per fixture
and a minimal SHA-256-signed X.509 chain with CA/key-usage constraints, serverAuth, localhost
DNS and loopback IP SANs, random serials and short validity. No private keys or generated
certificates are stored. Node `X509Certificate` checks signatures, CA status, key match,
validity and SANs; actual HTTPS tests prove successful strict verification and reject both
wrong-name and untrusted chains. This narrow DER fixture is not a production PKI library.

Verification: **384 Swarm tests** (361 previous + **23 new**), **155 foundation tests**,
**66 Plan/Safety tests**, **4 cleanup tests**, and **both existing CLI PTY scenarios** pass.
New tests cover exact requests, fragmented UTF-8/SSE, redirects, parser/model/certificate
failures, credential-safe errors/history, slow headers/body abort and timeout, actual socket
closure before results, ignored proxy environment/global-agent routing, forged authorization,
request overrides, real SDK follow-ups/compaction/revocation, and paused restore requiring
fresh approval. Stubbed production DNS tests reject private/mixed/empty answers, recheck
revocation after lookup, and retain settlement while lookup is outstanding. No real external
DNS/provider endpoint is contacted. The test-process guard denies other networking and allows
only each fixture's loopback port; it is defense in depth, not an OS firewall. PTYs remain
legacy mock-only regressions, not live-provider or new-transport terminal acceptance.

`git diff --check` passes. Global validation still reports pre-existing model/thinking defaults
and eight intentionally untracked phase-9–11 source/test files. No settings, activation,
installation, real credentials, commits or pushes changed. Remove the explicit HTTPS injection
to retain mock/offline behavior. Remote compatibility, usefulness, cost/usage accuracy and
live-provider acceptance remain unverified and require future explicit authorization.

## Phase 12 combined offline hardening — passed on Pi 1.0.0

The explicitly authorized compatibility migration and combined acceptance are complete.
Swarm remains inactive. The native agreement and dashboard now distinguish constrained
HTTPS from legacy mock execution: declared context is sent to the exact endpoint, not
“in-memory only.” Usage and cost remain unknown. Five regressions cover these disclosures.

### Pi 1.0 compatibility contract

The adapter uses public `normalizeContext`, `getCurrentTools`, `getSystemMessageText`, and
`renderSystemMessageUpdate` exports. Leading structured system content/sections and later
section additions/removals retain their transcript positions and system role; user/tool
content is never promoted to instructions. Tool additions/removals determine the current
request declarations and permitted response calls, without deleting historical calls/results.
Legacy direct `Context` inputs are normalized too. Unsupported non-text system content and
constrained-sampling declarations fail closed before transport.

Native history validation now accepts validated system messages, compaction system
checkpoints, retain-none boundaries, and content-only `context_edit` entries. Pi's native
SessionManager remains authoritative for active-branch projection and compaction; raw
history is not rewritten. Rejecting the new system entries had prevented synchronized
turn retirement and caused the apparent settlement stalls. The driver still awaits public
`waitForIdle()` and any `abort()` promise, workspace settlement, and synchronized history
before durable retirement. Abort requests alone never establish settlement; a new regression
holds a provider after abort and observes idle only after `agent_settled`.

Contract caveat: installed 1.0 prose mentions `SystemMessage.replace`, but its declarations
and replay helpers do not implement it. Persisted `replace: true` and mid-transcript wire
replacements fail closed rather than silently ignoring reset semantics. A leading direct
wire checkpoint has no earlier system state and is safe. No arbitrary new roles or generic
SDK provider routing were enabled. Sources: installed Pi `docs/sdk.md`, `message-types.md`,
`session-format.md`, `compaction.md`, `custom-provider.md`, `extensions.md`, and `tui.md`,
checked against public declarations and transcript/session implementations on 2026-10-01.
Upstream references: [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md),
[message types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/message-types.md),
[session format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md).
These upstream links can change; the verified contract above is the installed 1.0.0 build.

### Combined acceptance

```bash
PYTHONDONTWRITEBYTECODE=1 python3 configs/pi-agent/packages/pi-swarm/test/terminal/tls.py
```

The scenario reuses `production.py`, actual Plan/Safety factories and bounded PTY cleanup.
`tls-worker.mjs` supplies an ephemeral strict-CA-verified loopback receiver, real Node HTTPS
client and constrained SDK adapter; only the main CLI provider is mocked. Fresh keys and
fixture credentials stay in memory. The test guard permits only its exact loopback port;
the process-owned endpoint survives native reload without changing the approved binding.

Verified: **exactly 17 requests**, matching model/path, no replay or follow-up after
revocation, seven fresh agreements, real benign command receipts, native worker histories,
and actual client/server socket closure. Production mode transitions, safety cancellation,
dashboard exclusion, reload and shutdown are exercised together with HTTPS.

Current verification on installed Pi 1.0.0: **395 Swarm tests**, **155 SDK-free foundation
tests**, **66 Plan/Safety tests (including the six classifier tests)**, **4 cleanup regressions**, and **all three
PTYs (`run.py`, `production.py`, `tls.py`) pass**. Six new transcript/history/lifecycle tests
supplement the five disclosure tests. Historical 66-policy-test counts are not reused.
`git diff --check` passes. The repository validator still reports unrelated model/thinking
defaults and untracked test additions; settings and staging remain untouched.

Pi 1.0 defaults to fullscreen rendering: clipped notification prefixes and unchanged diff
lines need not enter scrollback. PTYs now verify status and unknown cost in the bounded
native dashboard rather than assuming emitted JSON prefixes. Complete HTTPS disclosure uses
120×100, and the full recovery packet uses 120×160. The 60-column dashboard/control scenario
still passes, but narrow agreement readability is **not** certified. Assertions inspect ANSI
output and durable evidence, not a terminal-emulator viewport or human visual sign-off.

Native worker compaction remains covered by SDK tests, not the public host/UI scenario
(which has no compaction command). Remote compatibility/cancellation, process escape, power
loss, cost accuracy and activation remain outside this phase. No external networking, live
provider, real credentials, global activation, installation, commit or push was performed.

## Phase 13 bounded terminal decisions — offline acceptance only

Launch/resume/restart agreements, provider disclosure, dirty-work preservation, workspace
reconciliation, and settlement attestation now use focused public `ctx.ui.custom` overlays.
The complete packet is wrapped and paged, not silently shortened or left in scrollback.
Objective, criteria, scope, limits, model/tools/instructions, exact provider endpoint and
outbound-data declaration, dirty paths, unresolved operation/turn IDs, and written evidence
remain accessible. Terminal controls and bidi controls are visibly escaped before styling.

- **Details** starts focused. **j/k**, **Up/Down**, **PageUp/PageDown**, **Home/End** and
  **gg/G** read the packet. A persistent line-range indicator shows the current position;
  reach the end before confirming a non-cancel decision.
- **Tab/Shift+Tab** switches Details / Actions. In the vertical **Actions** list, **j/k** or
  **Up/Down** selects an action and **Enter** confirms it. Enter in Details does nothing.
  **Cancel** is always the default, and **Escape** cancels anywhere. Action letters and
  pasted text never approve an action.
  Reaching the end is a navigation gate, not proof that a person understood the agreement.
- Launch editing remains an explicitly selected field followed by native JSON input, then
  a fresh complete agreement. The immutable host provider binding is not an editable field.
  Current values are in the packet rather than an unbounded input title.
- Dirty-work preservation and exact-ID/evidence attestation remain separate explicit decisions.
  No new execution authority, inferred settlement, replay, or automatic approval is introduced.
- Rendering reserves four terminal rows outside the overlay. Below 40 columns or 16 rows,
  it asks for resize and refuses authorization; cancellation remains available. Layout uses
  public Pi width/wrap helpers and active semantic theme colors, without replacing the footer.
- Signal cancellation dismisses the custom interaction through its completion callback and
  removes listeners idempotently. Existing host timeout, mode, session, reload, and modal
  exclusion gates remain authoritative. A focused overlay is important on Pi 1.0: replacement
  editor components can leave PageUp/PageDown with fullscreen transcript scrolling.

Verification on installed Pi 1.0.0: **408 Swarm tests** (395 previous + 13 new component
regressions), **155 foundation**, **66 Plan/Safety**, **4 cleanup**, and **all three real CLI
PTY scenarios** pass. Component tests assert both width and height at **60×24, 80×24, 100×40**,
all-page access, Home/End/reverse navigation, huge Unicode objectives, long URLs, deep data,
ANSI/bidi escaping, persistent controls, safe defaults/paste handling, resize denial,
cancellation/timeouts, listener disposal, and serialized exact-ID/evidence attestation.

`run.py` navigates launch/edit/preservation at 60×24, continuation with the light theme at
100×40, and recovery/attestation at 80×24; exact operation IDs are checked against the journal.
`production.py` and `tls.py` use 80×24 and actually navigate agreement pages. TLS acceptance
observes the complete endpoint and context declaration before approval, retaining **17 actual
requests and seven fresh agreements**, unchanged durable command/history/socket evidence,
production mode revocation, safety exclusion, reload, and shutdown. The prior phase's 120×100
and 120×160 workarounds are removed.

Limits: deterministic component frames plus automated native keyboard/ANSI and durable-record
checks are **not a full terminal-emulator viewport, pixel screenshot, or human visual sign-off**.
No additional emulator/parser or dependency is installed. Contrast, mouse/IME, other terminal
emulators, and regular-mode visual fidelity remain unverified. Packets are fully materialized
in memory; extremely large-data performance is not certified. General third-party modal
arbitration, live providers, remote cancellation, process escape, and activation remain gated.
Global validation still reports unrelated model/thinking defaults and the three new untracked
source/test files; no settings or staging changes are made. No external network, real
credentials, installs, global activation, commits, or pushes are part of this phase.

## Phase 14 native Pi integration — preferred architecture, offline verified

`createNativeRuntime({ modelRuntime, mainModel, thinkingLevel, override? })` from
`extensions/swarm/native-provider.mjs` reuses an **existing** public Pi `ModelRuntime`.
Alternatively supply `modelRegistry` instead of `modelRuntime`: an extension's public
`ctx.modelRegistry`, `ctx.model`, and `pi.getThinkingLevel()` provide the host inputs.
Never access the registry's private runtime. No new runtime, resource loader discovery,
credential-store read, catalog refresh or provider request occurs during construction.
The helper returns `{ modelRuntime, mainModel, thinkingLevel, providerCapability }` for
`SwarmHost` or `createSwarmExtension`. `createNativeSwarmExtension(options)` combines those
steps for explicit host injection. Neither factory has a default export or activation entry.
The host must capture its selected model/thinking when preparing the launch agreement;
the run then retains that approved snapshot, not a live link to later main-agent selection.
`override: { model?, thinkingLevel? }` is an explicit host/user choice, never worker input.
Virtual/router models are rejected: workers cannot autonomously switch the approved model.

The new durable transport kind is **`pi-native`**. Its human agreement names the provider,
model, API, thinking, full declared worker context, and catalog endpoint when safely known
(otherwise null). Endpoint metadata is **informational, not an egress pin**. Restoring an old
HTTPS agreement does not upgrade it. Restore remains paused and requires a newly host-created
matching capability; resume/restart each requires fresh human approval. Model metadata and
provider/method identity drift are checked during approval and every request admission.
Full model metadata (including headers/compatibility options) is compared privately in memory,
not copied into the journal. Across process restoration only the durable descriptor is compared;
other host configuration is trusted anew and disclosed through the fresh native agreement.
Unobservable changes inside provider closures, credential/environment changes and changes
that occur and revert between checks cannot be certified by these identity checks.

A small worker-local facade delegates `stream`, `streamSimple`, `complete`, and `completeSimple`
to the public native runtime/registry. It preserves native options, header transformation,
message conversion, reasoning, usage and errors rather than duplicating HTTP/auth/serialization.
Native request-time auth owns credentials, OAuth refresh, provider environment, catalogs,
proxies and routing according to host configuration. Swarm does not extract credentials;
its SDK pre-compaction auth probe returns no override so native streaming resolves auth once.
This is an explicit-selection adapter, not an authentication-availability certification.

Every SDK request, tool follow-up and manual compaction checks durable budget, current human
approval, mode, owner, active turn, generation and guidance. Combined cancellation signals
reach Pi; a header-transform guard rechecks after native auth and before provider dispatch.
Automatic compaction/retries and prompt-cache warming remain disabled in worker settings.
No arbitrary extension tools/resources are inherited. Request completion drains the native
stream/result and the driver still waits for SDK idle and synchronized durable history.
A provider that holds its SDK stream after abort keeps the turn unsettled and ownership fenced.
This is **SDK settlement, not proof of socket closure, stopped OAuth refresh, remote cancellation
or rollback**. Pi/provider internals may perform network work within one admitted SDK request;
Swarm does not fence each internal retry/auth/network operation. Deferred work is unsupported.
Native provider errors and history are not promised secret-redacted. Treat the host provider
and its configuration as trusted code; neither path is an OS sandbox or semantic data filter.

Offline verification: **428 Swarm tests** (408 baseline + 20), **155 foundation**, **66
Plan/Safety**, **4 cleanup**, and all three existing CLI PTYs pass. New coverage uses real Pi
1.0 `ModelRuntime`, native `createProvider`, public `ModelRegistry`, normal `openai-responses`
model/API metadata, in-memory credentials, scripted streams and the network guard. It covers
all four methods, native auth/headers/options, factory non-discovery/status, forged capabilities,
metadata/approval drift, explicit snapshots, virtual routing rejection, SDK follow-ups/manual
compaction, budget cancellation, mode revocation, incomplete prompt/compaction settlement,
paused restore, fresh continuation/restart agreements and truthful UI disclosure. At that point,
PTYs remained legacy mock/constrained TLS regressions; native terminal coverage follows below.

The next separately authorized trial should use the host's native Pi integration, not require
another custom HTTPS implementation. Live compatibility/usefulness/cost, real OAuth/network
cancellation, human visual acceptance and activation are still unverified and gated. Disable
native use by removing its explicit host injection; preserve run history and user changes.
No global settings, installation, real credentials, external calls, commits or pushes changed.

### Bounded simplification follow-up

Worker and host history now share the existing validated file reader; inspection no longer
opens a worker session/provider or clones already-detached parsed entries. A restored/unopened
history regression covers runtime independence, identity/corruption rejection, bounds, and
non-mutation; **429 Swarm, 66 Plan/Safety, and four cleanup tests pass**.

The dashboard and decision pagers remain local: public `ScrollView` needs child/layout
integration and does not replace their key handling. A shared helper would mostly move a few
branches while coupling different key policies, refresh and read-to-end/resize behavior.
No viewport changes or new abstraction were needed; all workspace/recovery guards remain.

### Native provider terminal acceptance

Run with the same installed Pi 1.0/POSIX prerequisites (no install fallback):

```bash
PYTHONDONTWRITEBYTECODE=1 python3 configs/pi-agent/packages/pi-swarm/test/terminal/native.py
```

The fourth CLI/PTY variant reuses `production.py` and the actual production Plan/Safety
factories. Its host fixture supplies a real public `ModelRegistry` over `ModelRuntime` to
`createNativeSwarmExtension` (and thus `createNativeRuntime`). A native `createProvider`
registration uses normal `openai-responses` metadata, in-memory fixture credentials and
scripted SDK streams. Worker requests do not use the mock runtime or custom HTTP adapter;
the separate main CLI turn remains scripted mock solely to expose selected/enforced mode
transitions. No real credentials or ambient configuration are forwarded.

At **80 columns / 24 rows**, automated keyboard input verifies:

- Complete paged human provider agreement before any worker dispatch: provider/model/API,
  declared context, and truthful Pi-owned auth/routing with an informational, unpinned URL.
  Launch cancellation on restriction, fresh launch approval and dirty-work preservation.
- Actual SDK task tools and one approved benign shell execution through production Safety;
  denied/cancelled requests produce no effects. Dashboard worker/history navigation works,
  and the dashboard closes before Safety takes input. Agreement/recovery page controls retain
  their read-to-end requirement.
- Off/Quick selected-versus-enforced transitions, Discuss/Plan revocation, no automatic
  Off/reload resumption or post-revocation follow-up. Four aborted open native streams delay
  completion deliberately; pause/reload/shutdown cannot report completion before draining.
- Native `/reload` constructs a fresh registry binding, restores paused with the same durable
  provider descriptor and needs fresh approval. Resume retains allowances; explicit restart
  opens cycle 2. SIGTERM during a real Safety confirmation cancels and settles to paused.
- Recovery through written human attestation for one **controlled shell-runner seam** that
  returns uncertainty without spawning a process. Native model streams are not fabricated as
  uncertain effects. Both recovery decisions show the exact operation ID; the sole uncertain
  intent becomes an unknown receipt, never success or replay. This tests the attestation UI,
  not independent proof that an arbitrary process stopped.

Combined provider observations, replayed journal and native SDK histories assert exactly
**19 worker dispatches**, **seven fresh launch/continuation agreements**, **two registry
bindings**, actual native auth/header resolution, approved stdout and denied tool feedback,
settled turns/assignments and no completion claim. The guard asserts **zero network attempts**;
no HTTP request occurs. Disposable HOME/agent/project isolation, private temporary evidence,
empty auth, unchanged dirty content and bounded child-exit-before-cleanup are retained.

Verification: **429 Swarm tests**, **155 foundation tests**, **66 Plan/Safety tests**, **four
cleanup tests**, and **all four CLI PTYs** (`run.py`, `production.py`, `tls.py`, `native.py`)
pass on Pi 1.0.0. No production fix or new unit regression was needed. The repository validator
still reports the unrelated model/thinking defaults and intentionally untracked new files;
no settings were normalized or files staged.

This is offline scripted-provider acceptance of the native SDK path, **not a live-provider
trial, HTTP compatibility test, human visual sign-off or viewport/pixel test**. Dashboard
coverage at that phase was section/Enter navigation, not all keys: installed Pi's global
transcript scroll handling could intercept End/PageUp in the old non-overlay dashboard.
The current focused overlay fixes that input ownership and adds real CLI search/help and
End/Home navigation checks. Native stream
settlement does not certify network/socket/OAuth cancellation or remote rollback. Real provider
compatibility/usefulness/cost, richer UI, human acceptance and activation remain separately gated.
No external network, real credentials, installation, global activation, commit or push is included.

## Bounded native live trial — core completed, harness reporting repaired offline

One separately approved trial used the **approved native model** and explicitly approved
thinking level, without fallback, activation, or installation. Outbound scope was synthetic
CSV source/tests, task and host instructions, tool definitions/results, worker histories and
peer messages. Existing native authentication stayed SDK-owned. This is not authorization
for another trial or broader outbound data.

Reducer replay confirms two worker identities, one completed build task, zero failed/rejected
attempts, a non-writing independent reviewer approval, a current candidate, and a successful
host final-check receipt (exit 0). There were no pending turns or workspace operations.
The run completed in about two minutes within the five-minute allowance (two identities,
two active workers, five tasks, one failed/rejected attempt per task). Generated source was
separately inspected before execution; its unchanged approved fingerprint was checked before
an offline rerun of all **12 passing tests**. No further model call was made for recovery.

The original harness did **not** write its result summary: after durable `run.complete`
automatically closed the controller, cleanup requested `run.stop` and received `CLOSED`.
Its outer catch misleadingly labeled that reporting/cleanup failure as setup failure.
The session driver now treats stop after completed/failed as already terminal without a new
owner command. The harness separates setup, execution, reporting and cleanup errors, gathers
usage after settlement, and attempts close in `finally` even if history reading or summary
writing fails. Unsettled execution retains ownership; raw histories/errors stay private.
The historical result is recovered from retained journal/history, not a second successful
live harness run. Persisted response/token counts are not HTTP-call or billing measurements;
cost remains unknown.

Verification: **436 offline tests pass**, including the completed-controller regression and
five reporting/cleanup regressions; default harness invocation remains inert. This proves
only the bounded synthetic exercise and offline repair, not general remote compatibility,
remote cancellation, spending control, human visual acceptance, or activation readiness.
See [trial protocol](test/live/README.md) for explicit approval and source-review gates.

## Remaining limitations after activation

- Broader independently authorized **native Pi** remote compatibility validation; the one
  bounded synthetic trial is not general provider certification. Custom HTTPS acceptance
  remains local TLS.
- Human visual TUI acceptance, broader policy/category/terminal acceptance, a compact
  persistent activity tree, and richer dashboard/conversation rendering.
- Full native coding-tool presentation parity and additional coding tools.
- Human/model evaluation of check adequacy and narrower verification relevance. A mocked
  successful workflow is not proof of useful real model work or independently proven settlement.
- Semantic scope/specialization checks, duplicate-recruitment judgments, and detection of
  repetitive non-progressing discussion. Capacity/revision checks do not replace those judgments.
- Automatic compaction policy and session-slot yielding during live tool waits.
- Scope revision, rich/streaming transcript UI, usage aggregation, and safe stale-owner recovery.
  There is no automatic cleanup, commit, push, or rollback.

Approved global registration does not certify these deferred capabilities or authorize another
live trial. Execution remains separately gated by each run's explicit human agreement.
