# Swarm main-chat presentation

## Storage and interaction

Routine Swarm progress creates no status row, transcript entry or model message. Error and stopped/failed transitions retain notifications. Safety and stop/lifecycle handling are unchanged.

Topic/board conversations appear as literal, labeled **MAIN** chat cards. Topics remains inspection-only, with no composer. These mirrors use `pi.appendEntry("swarm-topic-mirror", data)` and `pi.registerEntryRenderer`, not `sendMessage`. They never request a model turn or native input event. Text such as `yes`, `confirm` or policy-like instructions is untrusted conversation data, never approval/policy.

Mirror batches hold up to 30 messages with bounded sanitized previews. Identity is `(runId, messageId)`, rebuilt from `ctx.sessionManager.getBranch()`. Reloading the same branch does not duplicate cards; an abandoned branch does not acknowledge the newly selected branch. Full text remains in existing Swarm history. Context-excluded storage does not prevent an explicit history/status tool result from bringing that text into a later model request.

Real owner-addressed mail uses a hidden, context-bearing `custom_message`, with its existing durable acknowledgement and native wakeup path. A separate `swarm-mail-mirror` custom entry renders the visual card without adding it to model context. Visual cards never acknowledge actionable delivery. Legacy visible mail suppresses duplicate cards. Direct-mail and topic cards use different theme background roles (`customMessageBg` and `toolPendingBg`) and support native expansion/collapse. Main-agent replies are unchanged.

## Steer and read-only mail inspection

The current navigation separates inter-agent mail from native worker chat.
Messages, Agents (including the agent-mail page) and Topics are read-only.
Select **Steer** (`4`), choose a worker and press Enter for its native Pi
user/assistant transcript, tool calls/results and activity. Only Steer has the
bordered multiline composer. Drafts stay associated with the worker in the
same run across navigation; slash commands and `!` drafts transfer to main
without execution. Paused, stopped and unowned runs cannot send.

The historical desktop observations below describe the prior UI. Current Steer
verification is recorded in the following section.
After the coding run settles, use `/reload` or restart Pi to load source changes;
do not reload the active controller during implementation or verification.
Reload does not resume a Swarm, and in-memory drafts do not survive it.

## Agent settings and topic rows (2026-10-08)

Agents and Steer rosters display every worker's effective model and
thinking level from the run's recorded default or worker override. Read-only
agent mail and Steer transcripts also display the selected worker's settings
above the history when the viewport has room. Missing metadata is labeled
unavailable rather than inferred from main-chat settings. Main chat retains its
own model/thinking indicator: a stopped worker can correctly show medium after
the main chat is changed to low.

Provider names are omitted from these labels; the approval agreement retains provider
disclosures. Topics show the topic name first and a status badge at the right edge.
The task title appears as a description underneath when it differs from the name,
followed by message counts and compact participant summaries. The selected topic
keeps its full description and latest-message preview. Very narrow views prioritize
the name, and descriptions for unselected entries are shortened. Routing uses the original topic identity,
not the shortened label. Metadata stays muted beneath prominent headings;
control characters are escaped and generated truncation styling is removed
before the plain-text body is themed.

The name-first/provider-free revision was also checked live after `/reload`:
Topics placed the name left, status right and description underneath; Agents and
Steer showed model/thinking without the provider. The package suite passed 731
tests, the terminal composer/focus check passed across six viewport sizes, and
configuration validation, its 10 fixture tests, 19 shared checks and diff checks
passed. The stopped run remained stopped.

For mixed-model teams, see the package README's independent model settings
section. `pi --list-models` is a reusable availability check without a generation
request. Both Luna and Sol were listed on the verification date. Main-tool guidance
now recommends a Luna/low default for routine work and Sol/low overrides for
complex work and review when cost-conscious planning is requested; proposals
must still disclose exact choices before `start`. No new workers were launched
for this display revision, so this verifies catalog availability and existing
per-worker configuration regressions, not a live mixed-model run.

Previous layout verification on GNOME Wayland/XWayland: recorded worker settings appeared in the
roster and Steer header; the topic status/count/preview rendered correctly; Enter
opened the same discussion and q returned to Topics. Focused regressions also
cover worker overrides, missing metadata, live selection updates, Unicode/narrow
widths, control escaping, and routing with truncated titles. The package suite
passed 731 tests; seven terminal checks, global configuration validation and its
10 fixture tests, 19 shared Shotcut checks, and diff checks passed. This was a UI
change; no workers were dispatched during live inspection.

## Steer verification (2026-10-07)

A bounded three-worker coding Swarm implemented the feature and an independent
worker reviewed it without authoring changes. Review caught two stale fixtures;
repairs also added latest-message following, `Ctrl+End` return-to-follow, and
regressions preserving draft text while navigating history. The final package
suite passed 672 tests; root integration passed 123/123 test files; all six
required terminal checks passed. Validator fixtures (10), Shotcut checks (19),
and `git diff --check` passed. During the initial unstaged verification, the
global inventory validator rejected the preserved untracked login guide and new
transcript files; typechecking was unavailable because `tsc` was absent. Nothing
was staged or installed to conceal those results. The earlier integration timeout
was superseded by the completed final run. On 2026-10-08, after the user authorized
commit and push, staging the new files resolved the inventory check and the global
validator passed. Typechecking remains unavailable without `tsc`.

After a clean stop with no active turns, operations, assignments, or claims,
the extension was reloaded and inspected through the actual GNOME Wayland /
XWayland Ptyxis desktop. Reload initially left Alt+N without a roster; asking
main to open the stopped run via the supported read-only view path restored
inspection. Close that dashboard, then use Alt+N -> 4 -> choose worker -> Return
for the Steer composer; generic tool-opened dashboards remain read-only.

Visually verified in the live UI:

- The fourth tab selects agents and opens native user/assistant/tool transcript
  components at the latest finalized entry, with a visible input border.
- PageUp moves backward and disables follow; Ctrl+End returns to the end and
  resumes follow without modifying the draft.
- Tab returns to the selector. Switching workers shows separate drafts, and
  returning restores the original draft.
- Submitting a test draft while stopped refuses delivery and retains the draft.
  No worker resumed. The temporary draft was then cleared.
- The former Agents/agent-mail page is read-only and has no message composer.

The stopped-run desktop checks did not send a live message to an active worker;
actual guarded delivery is covered by the host integration tests. The transcript
shows finalized messages and tool results, not token streaming or partial tool
output. Images use text placeholders. Other desktop platforms remain unverified.
Large native transcripts can take a redraw to appear: recapture after the view
settles before interpreting an immediately captured old frame as failed input.

## Same-session objectives and start approval (2026-10-08)

Current ordinary approval uses exactly `start`. Older yes/confirm examples below
are historical observations, not the current protocol. Special recovery-evidence
confirmations retain their separate forms.

After a run is stopped/completed/failed and fully settled, ask the main agent for
a new bounded objective in the same chat. It proposes a new agreement; type
`start` to authorize it. The transition keeps previous journals and workspace
work, but uses fresh native worker contexts rather than replaying the old task.
Active/paused or unsettled runs cannot be silently replaced. Do not clear the
chat, delete ownership metadata, or use restart to change an old objective.

### Lower thinking without launching a model turn

Use Pi's built-in `/thinking low` command and verify both the status message and
model/thinking footer. In Pi 1.0.4 this sets the current session selection; it does
not persist a global default. A new Swarm objective copies that selection unless
its proposal explicitly overrides it. Existing runs retain their approved pinned
model/thinking settings and require the supported configuration flow to change.
When an autocomplete acceptance leaves the command visible in the editor, inspect
that state and press Return again to submit it. This procedure was visually
verified on 2026-10-08 without a model request.

### Live acceptance and preservation evidence

Two read-only objectives were run sequentially in the same Pi process and owning
chat, each with one worker, one task, one attempt, and a 90-second bound. A read
the root README title and returned `FIRST-RUN-OK`; B read the manifest title and
returned `SECOND-RUN-OK`. Both were approved with `start` and ended stopped with
zero active turns, operations, assignments, or coordination claims. There was no
clear, process restart, or session switch between the successful A and B runs.
Both journals were independently checked against the resumed chat identity, and
A's complete SHA-256 fingerprint was unchanged after B.

Use the read-only [journal evidence helper](../scripts/swarm-journal-evidence.py)
to repeat that check without printing message contents or session identifiers:

```bash
python3 docs/agents/scripts/swarm-journal-evidence.py \
  --expect-owner SESSION_ID /path/to/run-a/events.jsonl
# Save the first fingerprint locally, then repeat after the second run:
python3 docs/agents/scripts/swarm-journal-evidence.py \
  --expect-owner SESSION_ID /path/to/run-a/events.jsonl /path/to/run-b/events.jsonl
```

The helper needs Python 3 and read access. It writes nothing, streams each file,
and reports fingerprints, sizes, record counts, and owner-match booleans. It does
not validate the journal hash chain or prove settlement; verify stopped/settled
status separately through Swarm. Verification covered the actual A/B journals,
matching and mismatched owners, and rejection of malformed input. Keep local
fingerprints and runtime paths out of public artifacts.

### Upgrade reload limitation and same-chat restart

The first live attempt after hot reload failed before worker dispatch. A managed
Pi 1.0.4 warm/cold probe established that `/reload` refreshed the caller while
retaining older native storage-module exports. A cold process loaded correctly.
The compatibility guard now reports `RUNTIME_STALE` before approval or storage
mutation, including when the old error formatter remains cached. No SDK files
or module-resolution tricks were used, and ownership guards remain enforced.

When that diagnostic appears, finish/stop active work and verify settlement,
record the current session path locally, exit Pi normally, then reopen the exact
saved chat:

```bash
pi --session /path/to/the-existing-session.jsonl
```

Inside Pi's Bash environment, `PI_SESSION_FILE` identifies that file. Use an exact
file path rather than guessing the newest session. This procedure was live-tested:
the saved chat identity and history survived compaction and a cold process restart
before A; no further restart or clear occurred between A and B. Reload is not a
substitute for that process restart when native dependencies are already cached.
The managed offline regression also verifies the visible stale diagnostic and
cold storage initialization without any worker/model dispatch.

Latest implementation validation: 728 package tests, 123/123 integration files,
seven terminal checks (including managed storage reload), configuration checks,
and diff checks passed. Independent safety review approved the transition and
compatibility guard. Typechecking remained unavailable because `tsc` was absent;
no dependency installation was performed. The live tests verified the normal
consecutive-run path; injected storage/ownership failures are covered offline.

## Offline SDK verification

Use managed Pi **1.0.4**, native Node on the target platform, disposable fixtures and the existing scripted provider. No credentials, live provider calls, saved defaults, existing run state or submodule changes are required.

From the worktree root:

```text
node --experimental-import-meta-resolve --import ./packages/pi-swarm/test/sdk-register.mjs --test packages/pi-swarm/test/main-chat-sdk.test.mjs packages/pi-swarm/test/transcript-cards.test.mjs packages/pi-swarm/test/topic-mirrors.test.mjs packages/pi-swarm/test/main-progress.test.mjs packages/pi-swarm/test/mail.test.mjs
npm --prefix packages/pi-swarm test
node scripts/validate-global-config.mjs
git diff --check -- packages/pi-swarm docs/agents
```

`main-chat-sdk.test.mjs` records the actual host platform and asserts SDK version 1.0.4. Linux results verify Linux; Windows claims require a native Windows run. It loads a real inline extension through `DefaultResourceLoader`, calls the actual extension append/renderer APIs, persists/reopens `SessionManager` branches, and renders stored entries through the installed native `CustomEntryComponent`. Offline captured requests cover ordinary/subsequent/reopened prompts, automatic **default** compaction and default tree-navigation branch summaries. Topic and visual-only mail sentinels must be absent throughout; explicit request counts and input observations reject extra continuations or consent-like mirrored inputs. Owner mail must still wake once, enter context and acknowledge durably without repeat delivery, including reload. Held streaming requests also prove appending a topic does not queue a continuation, while actionable owner mail queues and is handled exactly once.

Focused card tests cover light/dark themes, dynamic invalidation, narrow widths, Unicode/control sanitization, literal wrapping, rendering limits and expand/collapse. These are actual SDK component renders, **not physical terminal interaction**.

## Staged checkpoint verification

When imported baseline work remains unstaged, verify the exact commit snapshot with [verify-index-tests.mjs](../scripts/verify-index-tests.mjs):

```text
node docs/agents/scripts/verify-index-tests.mjs packages/pi-swarm tests
```

This native-Windows-only helper copies indexed package/shared-test files into a disposable fixture and runs the package's existing offline SDK tests. It never stages or commits, installs dependencies, or changes working files. Successful fixtures are removed; failed fixtures and their local logs are retained for inspection. Only run it with trusted offline tests. An index-only snapshot and a working tree containing imported changes can have different test counts; report their results separately.

## Verification limits

- Linux SDK and PTY results do not establish native Windows display, keyboard navigation, focus or repaint behavior. Windows verification requires a native Windows run; the existing POSIX terminal harnesses cannot establish that result.
- The original implementation checkpoint had an uninitialized `.agents` submodule and could not run the global validator. The integrated review worktree uses the recorded submodule commit, and global validation passes.
- Passing tests does not establish independent final review or durable task settlement.

## Review verification (2026-10-07)

The offline Swarm suite passes on Linux (553 tests), including the same real-SDK
context-exclusion, compaction, branch and owner-mail checks. The configuration
fixture suite and global validator also pass. Real Pi PTYs verify complete rendered agreement values,
owner chat confirmation, cancellation, native Plan/Safety integration and reload.
Continuation proposals are included in the fixture metadata; the viewport capture
excludes Pi's overlaid jump button before combining overlapping transcript pages.
These Linux results do not establish physical Windows terminal behavior.

## Live desktop smoke test (2026-10-07)

A GNOME Wayland desktop with an XWayland Ptyxis terminal and managed Pi 1.0.4
was used to exercise the real main-chat proposal and confirmation flow. Provider
sign-in and a normal no-tool model request succeeded before testing Swarm.
Desktop wake, focus, input, and capture methods are in the shared
[Linux desktop guide](../../../.agents/docs/guides/linux-desktop-sessions.md).

The bounded proposal requested at most two read-only workers, two tasks, one
attempt, and 120 seconds: inspect repository layout and identify documented test
commands, each reporting one short finding. It prohibited file edits, running
tests, commits, pushes, and installations, and preserved existing changes.
The main chat displayed the proposal, then received explicit confirmation of
that exact configuration.

The subsequent `swarm_start` returned `AUTHORITY` during setup with the message
“Approval was declined, unavailable, or revoked.” `swarm_status` then reported
`unattached`, with no pending approval or restore. No workers started; messaging
and shutdown were not exercised. The main agent reported no edits or other
prohibited operations and did not retry. This is an observed setup failure, not
a passing live Swarm test. Subsequent diagnosis identified a usage error in the
confirmation format, not a verified code bug or provider authentication failure.

For a repeat after diagnosis, keep the same bounded scope, verify the full
proposal and explicit chat confirmation, then check attachment before claiming
worker startup. Preserve the first failure and status observations; do not mask
an authority failure by disabling safeguards or treating topic-mirror text as
approval. Inspect the current installed implementation and policy state before
choosing a fix. Offline suite results above do not establish that this live
approval path works.

### Historical diagnosis: standalone yes/confirm required

The confirmation sent to the interactive editor began with an affirmative phrase
but also restated the scope and limits. `extension.mjs` accepts only a complete
standalone `yes` or `confirm` (case-insensitive, optional final period or exclamation
mark). Any other interactive input clears the pending proposal. The next
`swarm_start` attempted to consume that cleared proposal and correctly failed its
current-confirmation check with `AUTHORITY`. The main agent should not have tried
to consume a proposal after an invalid reply.

The in-app debugging agent traced both checks, compared the documented protocol,
and reported all 13 focused existing approval tests passing, including extended
reply rejection, non-owner input rejection, and single-use authorization. The
source checks were also inspected directly. No code/configuration change or live
retry was made during diagnosis; the subsequent successful retry is recorded below.

Correct procedure: request a fresh identical bounded proposal, review its settings,
then send only `yes` or `confirm` as the entire interactive-editor message. Put
constraints in the proposal request, not in its approval reply. A cleared proposal
cannot be reused. Preserve this strict consent boundary rather than widening it
merely to accommodate explanatory approval text.

### Successful retry with standalone approval (2026-10-07)

A fresh proposal using the same read-only limits was approved with exactly `yes`
in the owning interactive editor. This live retry succeeded without code or
configuration changes:

- Two workers started with the two requested tasks.
- Both returned `SMOKE-ACK` to the main agent's test messages.
- One reported the package/shared-test layout; the other identified documented
  test commands without executing them.
- The main agent stopped the run. Status/history showed `stopped`, both workers
  inactive, and no unsettled turns, operations, or assignments; no errors were
  reported.

The in-app agent reported no edits, test execution, commits, pushes, or
installations and preservation of existing changes. Its final report and the
stopped-state details were visually inspected in a fresh terminal capture.
This verifies proposal/standalone approval, two-worker startup, message
acknowledgement, and stopped-state cleanup for this bounded Linux desktop run.
It does not establish code-producing task settlement, recovery, other platforms,
or behavior beyond the tested limits.

### Inspect the stopped run with Alt+N (historical UI)

Live desktop verification on 2026-10-07: `Alt+N` opened the read-only Swarm
viewer. Number keys `1`, `2`, and `3` select Messages, Agents, and Topics.
Messages showed both acknowledgement replies; Agents showed both workers idle;
Topics showed the two tasks as `ready` while the overall run header said
`stopped`. This smoke test checked reporting and stopped-state cleanup, not
reviewed task settlement, so do not interpret its findings as completed-task
status. The viewer reported usage not aggregated and cost unknown.

The displayed navigation hints include `Alt+N` next, `Esc` main, `PgUp/PgDn`
history, `q` back, and `?` help. Opening the viewer and switching to Agents and
Topics were exercised; the other hints were observed but not tested here.

From Agents (`2`), select a worker and press Return to open its agent-mail page.
This was verified with the planner: the page displayed its main-agent exchange,
acknowledgement, and final yielded-task message. A Message agent composer was
present but labeled `Paused/unavailable` while the run was stopped; no message
was entered or sent. Its hints state `Tab` opens Agents / switches panes and
`Esc` returns to main. Do not treat the presence of that composer as proof that
messaging is available for a stopped run.

## Historical same-session reuse failure (2026-10-08, before the fix)

After the coding run was stopped and reattached for read-only inspection, the
same Pi chat requested a separate two-worker, two-task, 120-second read-only smoke
test. No session reset or prior-objective restart was allowed. A new `swarm_start`
attempt returned `STATE`: “This action is unavailable in the current run state.”
No proposal was created and no workers started; the old run remained stopped
with no active turns, operations, assignments, or claims.

The launch guard in `extensions/swarm/host.mjs` requires the host to have neither
an attached controller nor pending approval, including when the controller is
stopped. The current control API offers resume/restart for the existing objective
and configure for model/thinking selection; it exposes no new-objective or
retire/detach operation. Therefore a fresh agreement alone cannot replace the
objective in the same attached session. This differs from the earlier extended
confirmation-text usage error: the new request fails before approval is possible.

A potential product improvement is an explicit, approval-bound new-objective
transition after settlement, preserving prior history and making worker-context
reuse a deliberate choice. This is a design opportunity, not an implemented or
verified capability. Do not restart the old coding objective, delete metadata,
or silently clear the chat to claim same-session reuse succeeded. No lifecycle
code was changed during this reproduction.
