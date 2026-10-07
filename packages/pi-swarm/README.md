# Pi Swarm

Swarm coordinates persistent Pi workers around an approved objective. The main agent
starts and manages the run, workers claim tasks and files, and independent review plus
recorded verification determines completion. Loading, reload, inspection, and restoring
a saved run never authorize worker execution.

## Use through the main agent

Ask the main agent to start Swarm with your complete objective, inspect progress, pause,
restore a run, resume, restart, or reconcile interrupted work. It chooses sensible settings,
explains the objective and complete configuration in chat, and asks for your explicit
confirmation before starting. Swarm opens no confirmation dialogs.

1. The agent prepares a proposal with `swarm_start`. Inspection returns the full agreement;
   no run starts and no worker is dispatched.
2. Review the objective, criteria, scope/exclusions, selected coding tools and instructions,
   model/thinking level, provider/outbound context, integrations, existing files and limits.
   Ask for changes if needed; the agent must prepare a fresh proposal for revised settings.
3. Reply **`yes`** or **`confirm`** in the owning main chat to confirm the single current
   proposal. Replies are case-insensitive, optionally ending with `.` or `!`. Other input
   cancels the pending proposal rather than guessing your intent.
4. The agent calls `swarm_start` again with **only** the returned `proposalId` (for lifecycle
   controls, only `action` and `proposalId`). This consumes one-shot
   authorization only after rechecking the exact configuration, workspace and host context.
   The tool returns after launch, before worker completion.

Proposal IDs are tool bookkeeping, not a command you must type. Only a real interactive
owner input can confirm; tool arguments, model output, transcript quotations, worker mail,
and extension/RPC input cannot approve work. The agent must wait for your reply, not infer
consent from the original request. While a proposal is pending, it must ask only its explicit
Swarm confirmation question, not unrelated yes/no questions. Native UI prompts cancel pending
confirmation. A plain `yes` cannot semantically distinguish an unrelated normal-chat question;
this question discipline is required.

**`/swarm stop` is the only direct user command.** It immediately fences new work,
cancels pending approvals and worker requests, and aborts native Bash process trees
without an extra model call. It is recognized before focused dialogs and overlays:
type the literal command and press Enter, even while an independent Safety prompt is open.
The captured command appears in the status area; Escape cancels it. Pasting the command
still requires a separate Enter. Other `/swarm` arguments display guidance without
changing state. Immediate notifications distinguish a requested stop from established
settlement. Uncertain operations retain ownership; stopping never invents settlement
or kills the main Pi process or unrelated processes.

| Main-agent tool | Behavior |
|---|---|
| `swarm_start` | Prepares a chat proposal from `objective` and optional `criteria`, `scope`, `limits`, `codingTools` and `instructions`. A later call with `proposalId` consumes actual owner chat confirmation and launches after revalidation. |
| `swarm_status` | Returns the run ID, bounded progress, workers, tasks and unresolved-operation counts; never wakes workers. |
| `swarm_control` | `pause` and `stop` act immediately. `resume`, `restart` and `reconcile` prepare fresh chat proposals, then consume confirmation with `proposalId`. `restore` requires `runId` and attaches paused; `reconcile` accepts `runId` for a crashed controller. `view` inspects; `send` delivers mail within an approved running run. |
| `swarm_history` | Reads bounded pages of worker history without constructing or waking workers. |

Existing work and Swarm changes are **kept by default**, without a disposition question.
Swarm performs no automatic stash, reset, discard, staging, commit or push. Disclosure does not make
unrelated existing changes part of the objective; conflicting or unclear work still needs
clarification. The objective is preserved in full. Defaults seed criteria and scope without
a model call; the main agent can choose settings appropriate to the task.

No affirmative reply means no execution. Proposals expire after 120 seconds. Confirmation
is single-use and bound to the owning session/project, host model and thinking level,
provider, mode, ownership, run revision and inspected workspace. Changes invalidate it;
request a fresh proposal rather than replaying confirmation. Pause, stop, reload and
shutdown cancel pending proposals. Resume preserves allowances; restart explicitly
begins a fresh cycle. Neither undoes changes, and unsettled work blocks continuation.

Launch, resume, restart and recovery require the interactive main chat in a TUI. Print,
JSON and RPC contexts cannot supply approval. Checkout inspection and each approval
revalidation run without blocking the host event loop: Git is asynchronous and content
fingerprints run in a cancellable worker.
Git checkouts fingerprint tracked and non-ignored files plus Git control state, not entire
ignored dependency/build/worktree trees. The approval packet discloses this scope. Tracked
files remain covered even if an ignore rule matches them. Without Git, inspection retains
a full-directory fallback off-thread. Each inspection has a separate 120-second deadline and a 64 MiB Git output limit.
File lists are revalidated after hashing. Snapshot paths cannot follow replaced directory
symlinks. Git submodules are inspected with their own tracked/non-ignored file lists,
recursively; direct submodule mutations require a separate workspace.
Workspace attachment and receipt/candidate checks use the same nonblocking inspection.
Explicit edit/write targets are additionally fingerprinted even when ignored; fresh-read,
claim and immediate pre-edit checks remain mandatory. Explicit target observations survive
controller reload through the recorded operation receipts. Ignored files changed indirectly by
shell commands are not globally detected: receipts are observations of this scope, not proof
that ignored content was unchanged. Shell authorization is still required. Stop, shutdown and
reload cancel pending admission inspection without granting authority; scoped changes still
require fresh approval. Post-execution settlement observations remain bounded and are not
aborted merely because execution was cancelled, so receipts can record its effects.
Independent Safety requests remain bounded by their confirmation deadline. A refusal or
timeout does not start an automatic retry.

Failed main-agent tool calls return a constant, safe diagnostic with the failing phase
and an error code. Inspection timeouts and output limits are distinguished from user
cancellation; approval, attachment and storage errors can be identified without disclosing
filesystem paths, credentials, provider responses or raw exception text. Failures never
approve work or start an automatic retry.

## Requirements and optional integrations

Use managed **Pi 1.0.4** and **Node 22.19+**. Linux is the verified runtime and PTY test
platform. Storage avoids POSIX-only ownership checks and directory fsync on Windows;
Windows terminal/process behavior has not been verified by this test run. Journal
paths are checked independently of OS no-follow flags before reading or writing. Native Windows end-to-end behavior remains unverified. Bash must be
available for the native Bash tool. Git is optional: Swarm does not initialize repositories
or edit ignore files. Existing project files and Git changes are disclosed and fingerprinted.

- With **pi-plan**, the current mode must be ready and Off. Without a responding provider,
  a gate that has never observed one treats the mode as Off. A provider appearing later
  revokes existing approval; disappearance, duplicate responses and malformed responses
  fail closed.
- With **pi-safety**, worker writes, edits and commands still use its confirmation bridge.
  Its independently configured policy may display operation dialogs or deny requests;
  chat approval does not bypass it. A fully dialog-free run is therefore incompatible with
  Safety settings that require dialogs; Swarm does not silently change those settings.
- Without a Safety provider, your explicit chat approval authorizes the selected worker
  coding tools under the disclosed bounded run policy, not per-operation Swarm prompts.
  Objective/scope, limits, current-task admission, claims, fresh reads, serialized mutations,
  exclusive Bash access, submodule read-only boundaries and settlement safeguards remain.
  These are cooperative controls, not an OS sandbox. Losing a previously observed Safety
  provider or receiving malformed/duplicate claims denies access rather than falling back.

Swarm imports Pi and Node APIs, with no runtime imports from sibling packages. Normal
package loading uses the current public Pi model registry, physical model and thinking
selection. All workers inherit the approved main-agent model and thinking level; changing
that selection invalidates authorization rather than silently migrating workers. Pi owns
credentials, OAuth and provider routing; the displayed endpoint is informational.
No credentials are copied into run records. Provider context includes the
objective, instructions, workspace content, tool results, history and compaction summaries.

## Submodule workspaces

A parent checkout may contain clean or dirty Git submodules. Inspection recognizes
Git index gitlinks and fingerprints the indexed commits, checked-out HEADs, each
initialized submodule's tracked/non-ignored contents, and Git control state. Nested
submodules use their own Git scopes, up to 32 levels. Dirty-to-dirty file edits are
covered by content hashes, not just status flags. Every repository's file list and
status are revalidated after hashing under the same inspection deadline and cancellation.
Ignored dependency/build trees remain excluded in each repository.

Missing or empty uninitialized submodules are recorded without fetching or initializing
them. A nonempty directory without checkout metadata, aliased checkout, or unexpected
directory in a regular file scope fails closed. Arbitrary nested repositories are not
automatically treated as submodules.

Workers may read ordinary submodule files, including instructions. Parent-workspace
claims, edits and writes into submodules are denied, including missing checkouts and
Windows case aliases. To change submodule files, use a separate Swarm workspace rooted
at that submodule. Bash remains a cooperative, host-authorized operation, not an OS
sandbox: shell commands must not bypass this boundary. Non-ignored submodule effects
are included in before/after receipts; indirect ignored-file effects remain outside
coverage. No submodule commits, resets, updates or cleanup are performed by inspection.

## Workers and safeguards

Workers use Pi's native `read`, `edit`, `write` and `bash` definitions, schemas, rendering,
file queues and cancellation. Swarm wraps execution with current-task and admission checks,
file claims, explicit policy approval, serialized mutations, exclusive Bash access and
durable before/after receipts. Existing files must be read after acquiring their claim
before editing or overwriting; creating a missing claimed file does not require a failing
read first. Claim identities use workspace-relative forward slashes on every platform;
Windows case aliases share a claim without changing the path spelling used for IO.
Traversal, outside-workspace drive/share paths and filesystem aliases remain denied.
Mutations recheck the fingerprint after approval. Native read options and Bash
timeouts are preserved. Receipt IDs are returned alongside native tool output.

Exclusive shell, candidate and review requests fail **before queuing** when another
assignment retains file claims. They never revoke that assignment's ownership or block
its next edit while waiting for those claims. Release idle claims and coordinate a quiet
verification window; do not retry-loop behind a peer who still needs to edit. Admitted
exclusives remain FIFO and block new mutations; own already-admitted mutations drain first.
Main and worker status show bounded claim owners, task IDs, operation purposes and stages
(queued, Safety approval, inspection, execution, settlement or unknown settlement), without
commands or target paths. Cancellation is only a request until the callback/process settles.

A refused or timed-out worker approval fences further writes/edits/shell requests for that
assignment/cycle/generation without reopening Safety. Guidance updates do not clear that
fence; reads, idle claim release and an honest yield/handoff remain available. New authorized
continuation never replays the denied operation. Independent Safety remains authoritative.

Candidate receipt rejection retains `EVIDENCE` with a precise reason: missing receipt,
wrong kind/task/assignment/cycle/generation, changed guidance, unsuccessful outcome/exit,
or stale before/after/current fingerprints. Exit zero does not preserve freshness across a
later creation or edit. Rejected reports do not produce candidates or leak queued locks;
fresh current verification may recover. Investigations/planning use messages and yield,
not fabricated verified candidates. Every later workspace mutation invalidates old evidence.

Pi's default retries and automatic compaction are enabled; cache warming is off. Admission
is checked on initial requests, tool follow-ups, retries and compaction summaries. An
exhausted retry sequence counts as one task failure. Pausing aborts retries/compaction and
waits for Pi to settle. Authoritative run state is supplied each worker turn.

Defaults are eight worker identities, four active assignments, 100 tasks per cycle, three
failed/rejected attempts per task and 60 minutes of active cycle time. Resume preserves
allowances; an approved restart begins a new cycle. Usage/cost are not yet aggregated.
These are cooperative controls, not an OS sandbox or protection against outside writers
and commands that deliberately detach processes. Native Bash owns process cancellation;
unknown custom-runner outcomes require explicit reconciliation and are never replayed.

## Conversations and agent navigation

Swarm uses Pi's existing agent indicator and **Alt+N** navigation when
`pi-status-line` is loaded. It joins the same cycle as Teams and Subagents.
**Escape** returns to the main chat. Independent Safety dialogs dismiss the focused view;
main-agent work continues in the background. Ask the main agent to open the view
(`swarm_control`, action `view`) when the status-line package is not loaded.

**Alt+N initially opens the general Messages overview**, with no message editor.
It does not open the focused worker's conversation or draft. Switch to **Agents**,
select a worker and press **Enter** to open a **separate agent conversation page**,
not the Messages tab. The inspection view has three tabs. The focused worker page has a native multiline
message editor beneath its history, matching Subagents. All three tabs remain inspection-only:

- **Messages:** conversations between agents and with the main agent. Focused
  agent views show their peer mail and assistant messages. Tool calls, tool results,
  reasoning and internal wake/context prompts stay out of the conversation view.
- **Agents:** the main agent and worker roster, live activity, focus and assigned
  tasks. Enter opens an agent's messages. Selecting main from the focused agent
  roster returns to Pi's main chat.
- **Topics:** task discussions with their status, plus named conversation
  topics. Enter filters Messages to that discussion; `q` returns to Topics and
  `a` shows all messages again. Selection stays on the same topic during live updates.

Use `1`–`3`, Tab, or `h`/`l` to switch tabs; `j`/`k` or arrows select agents and
topics or scroll messages. PageUp/PageDown scroll, `/` searches literally, `n`/`N`
move between matches, and `f` follows new messages. `q`/Escape closes or returns
from an agent conversation in the inspection dashboard. On the focused worker page,
text and ordinary keys belong to the message editor instead: **Enter sends**, **Tab**
switches panes, **PageUp/PageDown** scroll history, **Escape** returns to main, and
**Alt+N** selects the next agent. Slash commands and `!` drafts move to the main editor
without executing; press Enter there to run them. Agent mail is text-only; image paste
is rejected. Native focus/cursor handling and multiline input are preserved.

Sending uses the same guarded host path as main-agent mail and requires the current
owned, running, approved Swarm. It can wake the recipient within that approved run;
opening or navigating the view never dispatches work. Pending sends cannot be submitted
twice. Drafts survive agent switching and failed/unavailable sends for the same run;
feedback appears beside the editor. Delivery uncertainty is reported without automatic
retry. Drafts are in-memory only and do not survive reload or a new run. The generic
`swarm_control` inspection dashboard remains read-only. Lifecycle controls go through the
main agent, and `/swarm stop` remains the sole direct command.

The main agent sends mail with `swarm_control { action: "send", to, text, topic? }`.
Use a worker ID for a direct message, or `to: "@board"` with a topic for a team
board. Worker `swarm_message` accepts peer IDs, `@main`, or `@board` with a topic.
Board messages reach peers once each, excluding their sender. `main` and `board`
remain convenient aliases when no worker has that name; explicit `@` recipients
always address the coordinator or board and never shadow an existing peer. Worker conversations
inherit their assigned task as a topic when no topic is supplied. Candidate/review
reports also reach the main agent with their task topic; they still require independent
review and final verification before completion. Messages never grant approval.

Messages addressed to main are coalesced into Pi's native message queue and wake it
while Swarm is running. Progress notices remain passive; pausing/stopping does not
request another main-agent turn. Mail is acknowledged only after a complete entry
exists in the main session file. Interrupted deliveries remain available after reload;
durable mail is not repeated. If delivery was interrupted, the next user input
or worker event retries the pending mail without using chat text as approval. `swarm_history { channel: "messages", workerId?, topic?,
offset?, limit? }` reads bounded conversation pages without waking workers. Full
message text remains available in the user view and run journal.

History inspection reads live in-memory branches when available, so it does not
reopen or rewrite active worker session files. Loading a view never starts a worker.

## Storage and recovery

State lives beside Pi's project sessions, keyed by project and run:

```text
<agent-dir>/sessions/<Pi cwd slug>/swarm/
  reservation.json
  controller.lock/owner.json
  <run-id>/events.jsonl
  <run-id>/sessions/<native-Pi-session>.jsonl
```

The append-only journal retains its sequence checks and hash chain to detect corruption
or incomplete writes. A reservation prevents another run from taking the project while a
run is paused. The controller lease records its owning session and PID. Leases never expire
or get stolen automatically. Worker tools are the only Swarm operations that write to the
project itself; run state and recovery metadata remain outside it.

Ask the main agent to restore a known run ID in any later session in the same project.
Restore takes exclusive ownership and attaches **paused**, without worker requests. Select
the saved model first. Resume requires a fresh agreement and workspace reconciliation.
Reload discovers the active-branch run link but never resumes execution automatically.

If a crashed controller's lease blocks restore, reopen its **original owning Pi session**
and ask the main agent there to reconcile that run ID. Lease release is refused from other
sessions or when the recorded owner is missing/unknown, including legacy leases. There is
no automatic takeover; recovery when that session is unavailable remains a user-only/manual
design question, not permission to remove lease metadata or bypass fencing.

The chat proposal identifies the previous session and PID. Independently establish that the
old process **and its commands** have stopped, then reply in the owning main chat:
**`I confirm settlement: <how you independently established settlement>`**. A plain `yes`
is insufficient for recovery. Missing PID, timeout or silence alone is not evidence of
settlement. A live PID or changed lease refuses release. The reservation and journal are
retained. Restore again, then reconcile any journaled interrupted operations with the same
explicit evidence-bearing chat attestation. Reconciliation does not resume execution;
request and confirm a fresh resume/restart proposal afterward. Unknown effects remain
unknown; reconciliation does not manufacture success or replay them.

Runs from the former project-local `.swarms/` layout cannot be restored by this version.
They receive a specific legacy-run error and are left untouched. No automatic migration
or deletion occurs.

## Implementation map

| Modules | Responsibility |
|---|---|
| `extension.mjs`, `main-tools.mjs` | Main-agent tools, stop-only slash command, context fencing and host lifecycle |
| `host.mjs`, `host-gates.mjs`, `ui.mjs` | Agreement disclosures, optional integrations, bounded run policy and recovery |
| `core.mjs`, `state.mjs`, `*-state.mjs` | Journaled controller, pure reducers, task/session/workspace state |
| `sessions.mjs`, `sdk-session.mjs`, `native-provider.mjs` | Native Pi sessions, host runtime selection, retries/compaction admission |
| `session-tools.mjs`, `workspace.mjs`, `workspace-scheduler.mjs`, `workspace-files.mjs` | Native tool wrappers, claims, receipts and read-only fingerprints |
| `store/` | External layout, durable files, journal and explicit lease recovery |
| `dashboard.mjs`, `focus.mjs`, `composer.mjs`, `transcript.mjs`, `progress.mjs` | Inspection, focused-agent mail, transcript projection and event-driven notices |

## Verification

Tests resolve the managed installation automatically. `PI_SDK_DIR` overrides the SDK
package directory; `PI_BIN` overrides the JavaScript CLI entry, **not** the managed shell
launcher. Tests do not install dependencies, read personal credentials, or contact live
providers. Disposable agent directories and projects isolate state. The shared PTY
`test/terminal/packet.py` helper reconstructs VT viewport cells from diff redraws, waits
for a fresh no-execution/confirmation footer, pages the fullscreen transcript to the
current proposal header and verifies every original agreement line/value against rendered
pages before owner input. Offline result metadata is only a comparison oracle, never consent.
Pi 1.0.4 uses plain PageUp/PageDown for fullscreen transcript paging, not editor
Ctrl+PageUp/PageDown; Ctrl+End returns to output. Fixture settings explicitly select
fullscreen with `fullscreenScrollbar: "always"` in disposable agent settings only,
so body geometry is deterministic rather than using the default auto-hidden track.
`test/terminal/packet_test.py` provides pure offline capture regressions,
also indexed by `test/terminal-packet.test.mjs`. It discovers Python3 (including Windows
`python3.10`); `SWARM_TEST_PYTHON` selects a test interpreter. No interpreter is installed.

```bash
npm --prefix packages/pi-swarm test
python3 packages/pi-swarm/test/terminal/run.py
python3 packages/pi-swarm/test/terminal/production.py
python3 packages/pi-swarm/test/terminal/native.py
python3 packages/pi-swarm/test/terminal/entry.py
python3 packages/pi-swarm/test/terminal/entry.py --package-root
python3 packages/pi-swarm/test/terminal/focus.py --composer
```

Unit/integration checks cover native coding, fresh-read/claim/permission guards,
retries, automatic compaction, fencing, exactly-once task failure, bounded run policy,
chat proposal/owner-confirmation binding, cross-session restore, legacy refusal and explicit
lease recovery. POSIX PTY checks exercise real main-agent tools and interactive owner
chat confirmation with offline scripted models, plus independent Safety policy dialogs. The fixture-only
`/fixture-swarm` command in some harnesses drives the registered main tools; it is never
registered by the production package. No paid/live-provider trial is part of these checks.

On Windows, `scripts/swarm-wsl-test.sh --pty` tests the current worktree inside WSL.
Read the script's prerequisites first. It retains a unique test checkout and logs under
`~/swarm-runs/`, without replacing prior runs. This verifies Linux behavior, not Windows.

The separately authorized [bounded live trial](test/live/README.md) remains opt-in;
its default invocation is a dry run. Historical live outcomes are not validation of
this migration, and no live provider request is part of the completion checks.
