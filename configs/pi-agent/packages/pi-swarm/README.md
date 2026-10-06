# Pi Swarm

Swarm coordinates persistent Pi workers around an approved objective. The main agent
starts and manages the run, workers claim tasks and files, and independent review plus
recorded verification determines completion. Loading, reload, inspection, and restoring
a saved run never authorize worker execution.

## Use through the main agent

Ask the main agent to start Swarm with your complete objective, inspect progress, pause,
restore a run, resume, restart, or reconcile interrupted work. The main agent supplies the
objective and invokes the tools below. You review the full agreement and answer native Pi
dialogs yourself. Tool arguments, model output, and transcript text cannot approve work.

**`/swarm stop` is the only direct user command.** It cancels pending approval and stops
work without an extra model call. Other `/swarm` arguments display guidance without
changing state. Stopping waits for settlement; uncertain operations retain ownership.

| Main-agent tool | Behavior |
|---|---|
| `swarm_start` | Takes the complete objective and opens a native agreement dialog within the tool call. Returns after launch, before worker completion. |
| `swarm_status` | Returns the run ID, bounded progress, workers, tasks and unresolved-operation counts; never wakes workers. |
| `swarm_control` | `pause`, `stop`, `resume`, `restart`, `restore`, `reconcile`, or `view`. `restore` requires `runId`; `reconcile` accepts it for a crashed controller. |
| `swarm_history` | Reads bounded pages of worker history without constructing or waking workers. |

All approval choices default to **Cancel**. Launch agreements disclose the model,
thinking level, outbound context, integrations, scope, criteria, existing files and limits.
The objective is preserved in full, with editable criteria and scope seeded without a
model call. Agreements can be edited before approval. Existing-work preservation and
continuation reconciliation receive separate confirmation. Commands and approvals are
fenced when the session, project, model, thinking level, mode or ownership changes.

Launch, resume, restart and recovery require an interactive TUI. Print, JSON and RPC
contexts cannot supply approval. The default agreement deadline is 120 seconds; worker
confirmation defaults to 30 seconds. A refusal or timeout does not start an automatic retry.

## Requirements and optional integrations

Use managed **Pi 1.0.4** and **Node 22.19+**. Linux is the verified runtime and PTY test
platform. Storage avoids POSIX-only ownership checks and directory fsync on Windows;
Windows terminal/process behavior has not been verified by this test run. Bash must be
available for the native Bash tool. Git is optional: Swarm does not initialize repositories
or edit ignore files. Existing project files and Git changes are disclosed and fingerprinted.

- With **pi-plan**, the current mode must be ready and Off. Without a responding provider,
  a gate that has never observed one treats the mode as Off. A provider appearing later
  revokes existing approval; disappearance, duplicate responses and malformed responses
  fail closed.
- With **pi-safety**, worker writes, edits and commands use its confirmation bridge.
  Without a claimant, Swarm presents the complete operation and asks for **every** edit,
  write and command using a Cancel-default native dialog. Read-only Bash commands also
  require this fallback confirmation. Losing a previously observed Safety provider or
  receiving malformed/duplicate claims denies access.

Swarm imports Pi and Node APIs, with no runtime imports from sibling packages. Normal
package loading uses the current public Pi model registry, physical model and thinking
selection. Pi owns credentials, OAuth and provider routing; the displayed endpoint is
informational. No credentials are copied into run records. Provider context includes the
objective, instructions, workspace content, tool results, history and compaction summaries.

## Workers and safeguards

Workers use Pi's native `read`, `edit`, `write` and `bash` definitions, schemas, rendering,
file queues and cancellation. Swarm wraps execution with current-task and admission checks,
file claims, explicit policy approval, serialized mutations, exclusive Bash access and
durable before/after receipts. Existing files must be read after acquiring their claim
before editing or overwriting; creating a missing claimed file does not require a failing
read first. Mutations recheck the fingerprint after approval. Native read options and Bash
timeouts are preserved. Receipt IDs are returned alongside native tool output.

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

## Read-only dashboard

Ask the main agent to open the dashboard (`swarm_control`, action `view`). It displays
objective, workers, tasks, claims, messages and native histories. It cannot change run state.
Close it to ask the main agent for changes or to enter `/swarm stop`.

- `1`–`6`, Tab or `h`/`l`: select a pane.
- `j`/`k`, arrows, PageUp/PageDown or Ctrl+U/D: select workers or scroll.
- Enter on a worker, or `c`: inspect its conversation.
- `/`, then Enter: literal history search; `n`/`N`: next/previous match; `f`: follow tail.
- `q` or Escape: return from a conversation or close the dashboard; `?`: help.

History reads use the live in-memory branch when available, so inspection does not reopen
or rewrite a live worker session file. Displayed persisted text can lag streaming output.
Native permission dialogs dismiss the dashboard before opening.

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

If a crashed controller's lease blocks restore, ask the main agent to reconcile that run ID.
The dialog identifies the previous session and PID. Independently establish that the old
process **and its commands** have stopped, then explicitly approve release. A live PID or
changed lease refuses release. The reservation and journal are retained. Restore again,
then reconcile any journaled interrupted operations with an explicit settlement attestation.
Unknown effects remain unknown; reconciliation does not manufacture success or replay them.

Runs from the former project-local `.swarms/` layout cannot be restored by this version.
They receive a specific legacy-run error and are left untouched. No automatic migration
or deletion occurs.

## Implementation map

| Modules | Responsibility |
|---|---|
| `extension.mjs`, `main-tools.mjs` | Main-agent tools, stop-only slash command, context fencing and host lifecycle |
| `host.mjs`, `host-gates.mjs`, `ui.mjs` | Agreements, optional integrations, native confirmation and recovery |
| `core.mjs`, `state.mjs`, `*-state.mjs` | Journaled controller, pure reducers, task/session/workspace state |
| `sessions.mjs`, `sdk-session.mjs`, `native-provider.mjs` | Native Pi sessions, host runtime selection, retries/compaction admission |
| `session-tools.mjs`, `workspace.mjs`, `workspace-scheduler.mjs`, `workspace-files.mjs` | Native tool wrappers, claims, receipts and read-only fingerprints |
| `store/` | External layout, durable files, journal and explicit lease recovery |
| `dashboard.mjs`, `transcript.mjs`, `progress.mjs` | Read-only inspection and event-driven notices |

## Verification

Tests resolve the managed installation automatically. `PI_SDK_DIR` overrides the SDK
package directory; `PI_BIN` overrides the JavaScript CLI entry, **not** the managed shell
launcher. Tests do not install dependencies, read personal credentials, or contact live
providers. Disposable agent directories and projects isolate state.

```bash
npm --prefix configs/pi-agent/packages/pi-swarm test
python3 configs/pi-agent/packages/pi-swarm/test/terminal/run.py
python3 configs/pi-agent/packages/pi-swarm/test/terminal/production.py
python3 configs/pi-agent/packages/pi-swarm/test/terminal/native.py
python3 configs/pi-agent/packages/pi-swarm/test/terminal/entry.py
python3 configs/pi-agent/packages/pi-swarm/test/terminal/entry.py --package-root
```

Unit/integration coverage includes native coding, fresh-read/claim/permission guards,
retries, automatic compaction, fencing, exactly-once task failure, standalone confirmation,
cross-session restore, legacy refusal and explicit lease recovery. POSIX PTYs exercise
native dialogs and real main-agent tool calls with offline scripted models. The fixture-only
`/fixture-swarm` command in some harnesses drives the registered main tools; it is never
registered by the production package. No paid/live-provider trial is part of these checks.

On Windows, `.agents/scripts/swarm-wsl-test.sh --pty` tests the current worktree inside WSL.
Read the script's prerequisites first. It retains a unique test checkout and logs under
`~/swarm-runs/`, without replacing prior runs. This verifies Linux behavior, not Windows.

The separately authorized [bounded live trial](test/live/README.md) remains opt-in;
its default invocation is a dry run. Historical live outcomes are not validation of
this migration, and no live provider request is part of the completion checks.
