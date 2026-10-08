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

### Diagnosis: standalone confirmation required

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
