# Swarm main-chat presentation

## Storage and interaction

Routine Swarm progress creates no status row, transcript entry or model message. Error and stopped/failed transitions retain notifications. Safety and stop/lifecycle handling are unchanged.

Topic/board conversations appear as literal, labeled **MAIN** chat cards. Topics remains inspection-only, with no composer. These mirrors use `pi.appendEntry("swarm-topic-mirror", data)` and `pi.registerEntryRenderer`, not `sendMessage`. They never request a model turn or native input event. Text such as `yes`, `confirm` or policy-like instructions is untrusted conversation data, never approval/policy.

Mirror batches hold up to 30 messages with bounded sanitized previews. Identity is `(runId, messageId)`, rebuilt from `ctx.sessionManager.getBranch()`. Reloading the same branch does not duplicate cards; an abandoned branch does not acknowledge the newly selected branch. Full text remains in existing Swarm history. Context-excluded storage does not prevent an explicit history/status tool result from bringing that text into a later model request.

Real owner-addressed mail uses a hidden, context-bearing `custom_message`, with its existing durable acknowledgement and native wakeup path. A separate `swarm-mail-mirror` custom entry renders the visual card without adding it to model context. Visual cards never acknowledge actionable delivery. Legacy visible mail suppresses duplicate cards. Direct-mail and topic cards use different theme background roles (`customMessageBg` and `toolPendingBg`) and support native expansion/collapse. Main-agent replies are unchanged.

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
