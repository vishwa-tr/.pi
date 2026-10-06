# pi-swarm native cleanup

## Summary

`pi-swarm` (`configs/pi-agent/packages/pi-swarm`) is a Pi extension, but large parts
of it rebuild things Pi already provides: a model HTTPS transport, the coding tools,
session-file validation, a model-runtime wrapper, and a durable store. This plan
replaces those parts with native Pi features, in phases small enough to land and
verify one at a time.

- **Work branch:** `refactor/pi-swarm-native`, cut from `main` at `5559ff2`. Each
  phase lands on it as its own commit.
- **Baseline:** about 5,700 lines across 32 modules in `extensions/swarm/`, and 28
  test files plus the `test/terminal/` PTY harness. About 2,800 of those lines are
  targeted below.
- **Audit basis:** the managed Pi 1.0.4 install (`docs/extensions.md`, `docs/sdk.md`), and
  `pi-teams` / `pi-subagents` in this repo as reference implementations. Audited
  2026-10-06.

All paths below are relative to `configs/pi-agent/packages/pi-swarm/` unless they
start with `configs/` or `.agents/`. Line numbers are as of `5559ff2` and will drift
as phases land; when one is off, find the code by its name.

## Progress

Update this checklist as each phase lands. Put the commit SHA after the box, as it
appears on `refactor/pi-swarm-native` (after the rebase, not the worktree SHA).

- [x] Phase 0 — target the managed Pi installation, and a Linux baseline — 0A `b585765`, 0B recorded in the baseline table
- [x] Phase 1 — delete the custom HTTPS transport — `7ba5819`
- [ ] Phase 2 — native session files
- [ ] Phase 3 — plain model runtime
- [ ] Phase 4 — built-in coding tools for workers
- [ ] Phase 4b — run without `pi-plan` and `pi-safety`
- [ ] Phase 5 — run storage outside the checkout
- [ ] Phase 6 — native dialogs and approval
- [ ] Phase 7 — README rewrite

## Decisions

| ID | Question | Status | Recommendation |
|---|---|---|---|
| D1 | Phase order | Agreed | 0 → 1 → 2 → 3 → 4 → 4b → 5 → 6 → 7. Phase 1 may run before Phase 0 because it only deletes code; its check is "no new failures" against the Windows baseline. |
| D2 | Import `pi-teams` code, or copy its pattern? | Agreed | Copy, never import. Swarm must stay a standalone package: no imports from `pi-teams`, `pi-subagents` or any other package in this repo, only from Pi itself. |
| D3 | Must a run survive a Pi crash and resume in a different session? | Agreed: yes | A run can be picked up and continued later, from any Pi session in the same project. Keep a durable store, but move it out of the user's checkout into Pi's per-project session directory, so the `git init` / `.gitignore` setup goes away. See Phase 5. |
| D4 | Where does the cleanup land? | Agreed | `refactor/pi-swarm-native` from `main`. `feat/pi-swarm` is already fully merged. |
| D5 | Keep retries and compaction disabled in worker settings? | Agreed: turn both on | Use Pi's defaults for worker sessions. Retries stop a transient provider error (rate limit, overload) from failing a turn and burning one of a task's 3 attempts. Automatic compaction keeps long-running workers going; today nothing ever compacts a worker (`host.compact()` has no caller), so long workers eventually overflow and fail. Swarm re-sends the authoritative run state every turn, which covers what a lossy summary drops. Proven by the Phase 3 tests in step 5; a setting stays off only if its test can't be made to pass, with the reason recorded. |
| D6 | Keep the `swarm-mock` scripted provider for offline tests? | Agreed for Phase 1 | Keep `scripted-memory` for now. Phase 3 may move it to a test-only provider registered through `pi.registerProvider`. |
| D7 | Can runs recorded with an HTTPS provider still be restored after Phase 1? | Agreed | No. That transport was never used outside test fixtures, and an unknown transport already fails closed in `validateProviderDescriptor`. |
| D9 | Which Pi installation do tests, the harness and the docs target? | Agreed | The managed Pi installation (`<agent-dir>/install`, layout `releases-v1`), as Pi recommends. No global-npm fallback; `PI_SDK_DIR` / `PI_BIN` remain explicit overrides. See Phase 0A. |
| D8 | Should Swarm work without `pi-plan` and `pi-safety` installed? | Agreed: yes | Swarm runs standalone. With no Plan provider it runs as mode Off; with no Safety handler it asks for every worker edit and command with its own `ctx.ui.confirm`. When either package is installed it is used as before. A provider that answers wrongly still fails closed. See Phase 4b. |

## How every phase is done

**Workflow**

1. Make a worktree off `refactor/pi-swarm-native`: `.worktrees/<slug>`, branch
   `<slug>`.
2. Do the phase there. Don't commit until the reviewer (the main session) has
   reviewed the diff and the user has approved the commit.
3. Rebase onto `refactor/pi-swarm-native`, fast-forward it, remove the worktree.
4. Tick the box in **Progress** with the commit SHA, and fill in the test counts.

**Rules**

- A phase deletes code, or swaps it for a native call. Add nothing new unless it
  replaces something removed in that same phase.
- Remove the tests for deleted code in the same commit. Never weaken, skip, or
  loosen a test that still covers live behavior just to make it pass.
- Swarm imports only from Pi (`@earendil-works/*`, `typebox`) and Node. Where a
  phase points at `pi-teams` as a reference, copy the pattern into Swarm's own
  files (D2).
- Edit only what the phase lists. If something outside the list must change, stop
  and write it down under that phase's **Found during** heading instead of doing it.
- Keep the `pi-plan` (`pi-plan:mode-changed`) and `pi-safety`
  (`swarm:confirm-request`) bridges. Other packages in this repo use the same
  pattern; it is not part of the cleanup (until Phase 6's small Safety tidy-up).
- Follow the repo's import ordering (`AGENTS.md`, "JavaScript and React Import
  Ordering"), but only in files the phase already edits.
- Commit subject: an imperative sentence in the style of `git log --oneline`
  (for example "Remove the unused Swarm HTTPS transport"). No attribution
  trailers.

**Running the tests**

Tests run against the **managed Pi installation**, the one Pi's own installer sets
up (Phase 0 explains the layout). A plain `npm test` finds it on its own;
`PI_SDK_DIR` is only an override.

**Linux is the check that counts.** From Git Bash on Windows, run the suite inside
WSL against a worktree's current state, including uncommitted and untracked files:

```bash
.agents/scripts/swarm-wsl-test.sh [--pty] [<worktree>]
```

It clones the worktree's commit into `~/swarm-runs/<worktree-name>` inside WSL,
applies the uncommitted diff, runs `npm test`, and with `--pty` also runs
`run.py`, `production.py` and `native.py`. It prints the totals and every failing
test name, and exits 0 only if everything passed. Everything inside WSL runs with
a Linux-only `PATH`. A phase is green on Linux when the only failure is a known
flake from the Phase 0 table.

On Windows, the suite has known failures from POSIX-only code (see Phase 0). Until
Phase 4 fixes them, a phase's Windows check is: **the set of failing test names is
the previous baseline set minus the deleted tests, with nothing new.** Get the
names with:

```bash
awk '/^✖ failing tests:/{f=1;next} f && /^✖ /' test.log \
  | grep -v "\.test\.mjs (" | sed -E 's/ \([0-9.]+ms\)$//' | sort -u
```

The `test/terminal/*.py` PTY harness needs POSIX and a real terminal, so on
Windows check edited Python files with `python3.10 -m py_compile <file>` and
edited `.mjs`/`.ts` files with `node --check` where it applies.

## Phase 0 — target the managed Pi installation, and a Linux baseline

**Why:** Pi recommends its managed installation over a global npm install, and this
machine already uses it. Swarm's tests and docs still assume a global npm install:

- `test/sdk-register.mjs:7` defaults `PI_SDK_DIR` to
  `/usr/local/lib/node_modules/@earendil-works/pi-coding-agent`.
- The PTY harness (`test/terminal/entry.py:14`, `production.py:17`, and `run.py`)
  finds the CLI with `shutil.which(PI_BIN or "pi")`, then runs
  `node <that path>`. With a managed install, `pi` on `PATH` is a shell wrapper
  (`<agent-dir>/bin/pi`) that calls `pi-launcher.js`, not a JavaScript file, so
  `node <that path>` fails.
- `README.md:44–52` and `:693` describe an "installed Pi SDK/CLI" with no install
  fallback, meaning the npm global one.
- `package.json` has no `peerDependencies`. Pi's `docs/packages.md` says to declare
  the host-provided packages (`@earendil-works/pi-ai`, `pi-agent-core`,
  `pi-coding-agent`, `pi-tui`, `typebox`) as `peerDependencies` with `"*"`, and
  never bundle them. Every sibling package here does that (for example
  `pi-commit/package.json`); Swarm doesn't.

Also, the suite only passes on POSIX today. On Windows, 170 of 572 tests fail
because of `process.getuid` (140), POSIX process groups (9), fsync on a directory
(which Windows rejects with `EPERM`), and a few path cases. Without a Linux run
there is no way to tell whether a change broke something.

**The managed layout** (as read from Pi 1.0.4's launcher,
`<agent-dir>/bin/pi-launcher.js`, and its `dist/package-manager-cli.js`,
`getActiveManagedInstallRoot`):

```
<agent-dir>/                         # ~/.pi/agent, or $PI_CODING_AGENT_DIR
  bin/pi, bin/pi.cmd, bin/pi-launcher.js
  install/                           # the managed install root
    managed-install.json             # { kind: "pi-managed-install", schemaVersion: 1, layout: "releases-v1", ... }
    current-version                  # e.g. "1.0.4"
    releases/<version>/node_modules/@earendil-works/pi-coding-agent/
```

- The launcher reads `current-version`. It rejects a value that doesn't match
  `^[0-9A-Za-z._+-]+$`, or that is `.` or `..`.
- It runs the release's `package.json` `bin.pi` script with the current `node`,
  and sets `PI_MANAGED_INSTALL_ROOT=<agent-dir>/install` for the child.
- Pi only trusts that root if the marker matches exactly.

### 0A — resolve Pi from the managed install

1. **One resolver for tests:** add `test/pi-install.mjs`, exporting
   `resolvePiPackageDir()`. It returns, in this order:
   1. `PI_SDK_DIR`, if set (explicit override; keep it working);
   2. the managed install: root = `PI_MANAGED_INSTALL_ROOT` if set, else
      `<agent-dir>/install`, where `<agent-dir>` is `PI_CODING_AGENT_DIR` or
      `~/.pi/agent`. Then:
      - require `managed-install.json` with `kind === "pi-managed-install"`,
        `schemaVersion === 1` and `layout === "releases-v1"`;
      - read `current-version` and validate it like the launcher does;
      - return `<root>/releases/<version>/node_modules/@earendil-works/pi-coding-agent`,
        and require its `package.json` to exist.
   3. Otherwise throw: "No managed Pi installation found at <root>; install Pi
      with its installer, or set PI_SDK_DIR." **No npm-global fallback.** Remove
      the `/usr/local/lib/node_modules` default.
2. `test/sdk-register.mjs`: use `resolvePiPackageDir()` instead of its own
   `PI_SDK_DIR ?? "/usr/local/…"` line. Everything after it (the
   `import.meta.resolve` mapping) stays.
3. **Terminal harness CLI:** add the same resolution in Python, as one helper in
   `test/terminal/run.py` that `entry.py` and `production.py` import. It returns
   the CLI script path: the package's `package.json` `bin` (a string, or `bin.pi`)
   resolved inside the package directory, rejecting a path that escapes it, like
   the launcher does. The harness keeps running `node <script>`, which is now
   correct.
   - `PI_BIN` stays as an override, but must name the JS CLI script, not the
     wrapper. Say so in the error.
   - Resolve before the harness swaps in its disposable `PI_CODING_AGENT_DIR`
     (`run.py:193`). The child gets the disposable agent dir; the CLI still comes
     from the real managed install.
   - Don't pass `PI_MANAGED_INSTALL_ROOT` to the child. The harness launches the
     release directly, not through the launcher, so the child is not "managed",
     and Pi never looks for update state in the disposable directory.
4. `package.json`: add `peerDependencies` with `"*"` for the host-provided
   packages that `extensions/` actually imports. Check with
   `grep -rhoE "from \"(@earendil-works/[a-z-]+|typebox)\"" extensions | sort -u`.
   Don't add `dependencies`.
5. README (minimal; Phase 7 rewrites it): in **Verification** (`README.md:44–52`)
   and the PTY section (`:693`), say that tests use the managed Pi installation
   automatically, with `PI_SDK_DIR` / `PI_BIN` as overrides.
6. Tests for the resolver (`test/pi-install.test.mjs`), using temp directories:
   - valid layout → package directory;
   - `PI_SDK_DIR` wins;
   - missing marker, or wrong `kind` / `schemaVersion` / `layout` → error;
   - `current-version` of `..`, empty, or containing `/` → error;
   - missing release directory → error naming the expected path.

### 0B — Linux baseline

1. In WSL Ubuntu, install Pi with **Pi's managed installer**
   (`https://pi.dev/install.sh`), not `npm install -g`, so Linux uses the same
   layout as Windows. Approved by the user on 2026-10-06.
   - Node 22.23.3 is already installed at `~/.local/share/pi-node/current` (WSL
     home), SHA256-verified, using the same method as the installer's standalone
     Node step.
   - **Run the installer with a Linux-only `PATH`**, for example
     `PATH="$HOME/.local/share/pi-node/current/bin:/usr/local/bin:/usr/bin:/bin"`,
     and under `setsid` with stdin from `/dev/null`, so it takes its
     no-terminal path. WSL appends the Windows `PATH` by default. On the first
     attempt the installer found the Windows `pi` under `/mnt/c/...` and
     "reinstalled" it, rewriting the Windows `bin/pi` and `managed-install.json`
     (since restored). Before running, check that `command -v pi` finds nothing.
2. Run `npm test` with no `PI_SDK_DIR` (proves 0A), then `test/terminal/run.py`,
   `production.py` and `native.py` with no `PI_BIN`.
3. Fill in the table.

**Baseline**

| Platform | Tests | Pass | Fail | Notes |
|---|---|---|---|---|
| Windows 11, Node 24.17, managed Pi 1.0.4 | 572 | 402 | 170 | 168 unique failing names; all POSIX-only causes |
| Linux (WSL Ubuntu 24.04), Node 22.23.3, managed Pi 1.0.4, at `bdb43b5` | 523 | 522 | 1 | Only failure: "mode, ctime, and inode changes invalidate file fingerprints" (`workspace-files.test.mjs`), a **known flake**: it passed 3 of 5 reruns. A same-content rewrite doesn't always change `ctime` within WSL's timestamp granularity. Phase 4 removes the guarded file IO it covers. PTY `run.py`, `production.py`, `native.py`: all pass. |
| Windows 11 after Phase 0A, at `b585765` | 523 | 360 | 163 | 161 unique failing names, all POSIX-only; this is the Windows baseline for later phases |

**Done when** `npm test` and the PTY harness find the managed install with no
environment variables on both platforms, the resolver tests pass, and Linux is
green (or its failures are listed here as known).

## Phase 1 — delete the custom HTTPS transport

**Why:** `https-transport.mjs` (a pinned-IPv4 TLS client) and
`constrained-provider.mjs` (a Chat Completions adapter) are only reached from their
own tests and the TLS terminal fixture. Production always builds its provider
capability with `transport: "pi-native"` (`native-provider.mjs:28`). Pi owns model
transport and auth, so this code has no reason to exist.

**What stays:** `pi-native` (production) and `scripted-memory` / `swarm-mock`
(offline tests, D6). After this phase, `validateProviderDescriptor` accepts only
those two transports. Anything else, including descriptors persisted by older test
runs, fails with `PROVIDER` "Unknown transport" (D7).

### 1.1 Delete these files

| File | Lines | What it is |
|---|---|---|
| `extensions/swarm/https-transport.mjs` | 138 | Node HTTPS client, egress authorization, loopback test policy |
| `extensions/swarm/constrained-provider.mjs` | 257 | Chat Completions adapter over that transport |
| `test/https-transport.test.mjs` | — | Tests for the transport |
| `test/constrained-provider.test.mjs` | — | Tests for the adapter |
| `test/terminal/tls-worker.mjs` | — | TLS fixture worker for the terminal harness |
| `test/terminal/assert-tls.mjs` | — | TLS journal assertions |
| `test/terminal/tls.py` | — | TLS terminal acceptance entry (`main(tls=True)`) |

### 1.2 Edit extension code

**`extensions/swarm/provider-capability.mjs`**

- Remove the import of `isConstrainedRuntime` (line 3).
- `validateProviderDescriptor`:
  - Allowed transports (line 23) become `["scripted-memory", "pi-native"]`.
  - Remove the final `else` branch (lines ~41–45), the canonical-HTTPS endpoint
    rule that only applies to the deleted transports.
  - Remove the `https-chat-completions` block (lines ~46–49).
  - Keep the `scripted-memory` and `pi-native` branches as they are.
  - `identityPattern` (line 18) can stay: its non-native branch still applies to
    `scripted-memory`.
- `assertProviderSelection`:
  - Remove the `https-unsupported` check (lines 74–75). The
    `UNSUPPORTED_TRANSPORT` code disappears with it.
  - Remove the `https-chat-completions` block (lines 79–82).
  - Keep the `pi-native` early return, and the mock model check that follows it.

**`extensions/swarm/sdk-session.mjs`**

- Remove the import of `bindConstrainedRuntime` / `isConstrainedRuntime`
  (line 10).
- In `createSdkSession`, remove the `constrained` variable (line 202), drop
  `constrained ||` from the two `invariant`s (lines 205 and 209), and remove the
  `if (constrained)` rebind (line 211).
- Update the comment on `createSdkSession` (line 199): it mentions "legacy" branded
  adapters.

**`extensions/swarm/session-state.mjs`** (`selection`, lines 23–25)

- The non-mock clause becomes:
  `provider?.transport === "pi-native" && value.provider === provider.provider && value.modelId === provider.modelId`.
- Drop the `|| value.thinkingLevel === "off"` part; it only applied to the
  constrained transport.

**`extensions/swarm/ui.mjs`** (`requestUserApproval`, lines 14–17)

- Remove the `network` variable and its branches.
- Label: `native ? "Pi native provider" : "mock only"`.
- Disclosure: the `pi-native` text, otherwise `"in-memory only; no network"`.

**`extensions/swarm/dashboard.mjs`** (line 211)

- `providerLabel`: remove the `https-chat-completions` → `"HTTPS provider"` case.

### 1.3 Edit tests

**`test/provider-capability.test.mjs`**

- Remove the cases built on `https-unsupported`, `UNSUPPORTED_TRANSPORT`, or
  canonical-HTTPS endpoint rules (around lines 44–56 and 117–121).
- Keep the `scripted-memory` cases.
- If a loop of invalid patches includes `{ transport: "trusted-runtime" }`
  (line 37), keep it: it still has to be rejected.
- If the test at 117–121 also checks that a non-mock transport is refused before
  any runtime call, keep that check using an unknown transport string, and expect
  `PROVIDER` instead of `UNSUPPORTED_TRANSPORT`.

**`test/native-provider.test.mjs`**

- Remove lines 128–129 (`https-unsupported` → `UNSUPPORTED_TRANSPORT`). Keep the
  rest of that test.

**`test/ui-disclosure.test.mjs`**

- Remove `"https-chat-completions"` from the transport list (line 7) and its
  `else if` branch (lines 20–23).
- Rename the test at line 32 ("status never misrepresents HTTPS usage
  placeholders…") so it doesn't mention HTTPS. Keep its assertions.

**`test/dashboard.test.mjs`** (test at lines 18–29)

- Use `transport: "pi-native"`, and assert `/Pi native provider/` instead of
  `/HTTPS provider/`.
- Rename it to "dashboard labels native and unattached selection…".
- Keep the rest of its assertions.

**`test/network-guard.mjs`**

- Remove the `loopbackPort` option and every branch that uses it (lines 11 and
  28–33). Only the deleted transport test and `tls-worker.mjs` passed it.
- `guardNetwork(t)` must still block `fetch`, `net` / `tls` connect, and
  `http` / `https` request.
- Check first: `grep -rn "loopbackPort" test` must list only the deleted files
  plus this one.

### 1.4 Edit the terminal harness

**`test/terminal/production-fixture.ts`**

- Remove the `createTlsWorker` import (line 4) and the `SWARM_TERMINAL_TLS`
  handling (lines 57, 72, 82, 121).
- Keep the `native` and mock paths exactly as they are.

**`test/terminal/production.py`**

- Remove the `tls` parameter from `main` (line 16), and every `if tls:` block
  (around lines 29–30, 33–34, 97–106, 137–141, 284–296, 315, 321–322).
- The labels on lines 33–34 become native / mock only.

**`test/terminal/assert-production.mjs`**

- Remove the `tls` argument (line 10). Line 30 becomes
  `nativeProvider ? 6 : 5`.

**`test/terminal/assert-native.mjs`**

- Remove line 40 (`events("tls-request").length === 0`). Nothing emits that event
  any more.

### 1.5 README (minimal; Phase 7 rewrites it)

- **Modules** table: remove the `constrained-provider.mjs` and `https-transport.mjs`
  rows (lines 367–368).
- In the `provider-capability.mjs` row, remove "unsupported-transport preflight".
- Replace the **Phase 10** and **Phase 11** sections (lines 915–1099) with one
  short paragraph: the constrained Chat Completions adapter and the Node HTTPS
  transport were removed, because Pi's native provider path (Phase 14) owns model
  transport.
- Remove the `tls.py` command and its mentions (around lines 1141, 1157, 1213 and
  1351). Where a sentence counts "all four CLI PTYs", make it three.
- Don't edit any other README text.

### 1.6 Verify

1. Nothing left behind. Both commands must print nothing:
   ```bash
   grep -rnE "constrained|https-transport|https-chat-completions|https-unsupported|UNSUPPORTED_TRANSPORT|createHttpsTransport|createConstrainedRuntime|tls-worker|assert-tls|SWARM_TERMINAL_TLS|loopbackPort" extensions test
   grep -rn "tls.py" README.md
   ```
   `node:tls` in `test/network-guard.mjs` is fine; it is the guard itself.
2. Syntax: `node --check` on every edited `.mjs`, and `python3.10 -m py_compile` on
   `test/terminal/production.py`.
3. Full suite on Windows. The set of failing test names must equal the baseline set
   minus the deleted tests, with nothing new. Record tests / pass / fail.
4. If Phase 0's Linux environment exists by then: the full suite plus
   `run.py`, `production.py` and `native.py` pass.

**Done when** all four checks pass and the diff touches only the files listed in
1.1–1.5.

### Found during

- `test/tls-fixture.mjs` (ephemeral X.509 builder) was only used by the deleted
  TLS tests. Deleted as well.
- `test/terminal/assert-production.mjs`: `const boundary` also depended on `tls`.
  It is now the constant no-network text.
- `test/terminal/production.py`: `import re` was only used by a TLS block.
  Removed.
- `test/network-guard.mjs`: the loopback allowance ran to line ~50, not 33, and
  fed a `sockets` set that nothing else used. Removed all of it; the guard now
  denies every target.
- `test/provider-capability.test.mjs`, "unsupported live host launch…": an unknown
  transport can't reach the host (`createProviderCapability` rejects it first), so
  the test now uses a `pi-native` capability with an unbranded runtime. It still
  checks: `PROVIDER`, no runtime reads, no approval, no storage.
- README Phase 12/13 prose that only described the TLS scenario was removed with
  the `tls.py` mentions.
- **Gap noted for Phase 3:** the `pi-native` informational-endpoint rule (rejects
  credentials, query, fragment) has no test. The deleted loop only covered the
  HTTPS branch. Cover it, or drop the rule, when Phase 3 reduces
  `provider-capability.mjs`.
- **Left for Phase 7:** HTTPS mentions in historical README prose, the `native/legacy`
  wording in the `sdk-session.mjs` module row, the test name "native capability …
  substituted for legacy HTTPS" (`native-provider.test.mjs`), and the
  `"LAUNCH (HTTPS provider)"` title string used as plain input in
  `decision.test.mjs:11`.

**Result (Windows, Node 24.17, managed Pi 1.0.4):** 518 tests, 355 pass, 163 fail.
No new failing names; the 7 names gone from the baseline all belonged to the
deleted test files. 54 fewer tests: 52 in the two deleted files, plus 2 removed
cases.

## Phase 2 — native session files

**Why:** `sdk-session.mjs` re-validates Pi's own JSONL session format and writes the
session header itself. That breaks every time Pi changes its file format, and it
duplicates `SessionManager`.

**What it does today (`extensions/swarm/sdk-session.mjs`)**

| Function | Lines | What it does |
|---|---|---|
| `canonicalPath` | 19–24 | Rejects non-canonical or symlinked paths |
| `validateMessage` | 26–79 | Re-checks every message role and content block against Pi's schema |
| `validateSession` | 81–151 | Parses the JSONL, checks `version === 3`, every entry type, and the parent chain |
| `readSessionHistory` | 154–158 | Returns validated entries; used by `host.mjs:120` and `sessions.mjs:378` |
| `isolatedLoader` | 161–176 | Resource loader with no discovery — **keep** |
| `openManager` | 178–197 | Writes Pi's session header by hand with `O_EXCL` + fsync, then reopens it |
| `createSdkSession` | 200–266 | Builds the worker `AgentSession`; also runs `sync()`, which re-validates and fsyncs after every turn |

**Reference:** `configs/pi-agent/packages/pi-teams/extensions/teams/runtime/in-process.ts`
around lines 900–960: `SessionManager.open(latest, instanceDir, cwd)` /
`SessionManager.create(...)`, then `createAgentSessionServices` and
`createAgentSessionFromServices`.

**Steps**

1. Remove `validateMessage`, `validateSession`, `ENTRY_TYPES` and the
   `THINKING_LEVELS` copy, if nothing else uses it.
2. `openManager`: open with `SessionManager.open(sessionFile, sessionDir)` or create
   with `SessionManager.create(cwd, sessionDir)`. No hand-written header.
3. Session identity before the first reply: Swarm records the worker's session in
   `session.bind` (`sessions.mjs:103`). Bind with `manager.getSessionId()` and the
   file name Pi will use. If Pi doesn't create the file until the first reply, the
   rebind on reopen has to tolerate a missing file and create a fresh session for
   that worker. Write down which way it went under **Found during**.
4. `readSessionHistory(path, cwd, sessionId)`: open with `SessionManager.open`,
   check `getSessionId() === sessionId`, and return `getBranch()` (the active
   branch, which is what the dashboard and `swarm_history` show).
5. `createSdkSession`: drop the per-turn `sync()` (re-validate and fsync). Pi
   persists its own file. Keep the post-create checks that the model, thinking level
   and tool allowlist are what Swarm asked for. Those guard against Swarm's own
   configuration mistakes, not against Pi.
6. Consider `createAgentSessionServices` / `createAgentSessionFromServices`, as
   `pi-teams` does, if it removes code. Otherwise keep `createAgentSession`.
7. Tests: in `test/sdk-session.test.mjs`, remove the format-validation cases (bad
   roles, blocks, entry types, version). Keep identity, cwd, isolated-loader and
   tool-allowlist cases. Check `test/sdk-driver.test.mjs` and
   `test/host-recovery.test.mjs` for cases that hand-corrupt a session file and
   expect Swarm to reject it. Replace them with whatever `SessionManager` does
   with that file, or remove them.

**Done when** `grep -rn "JSON.parse\|split(\"\\\\n\")" extensions/swarm/sdk-session.mjs`
finds nothing, and nothing in the package reads Pi session JSONL directly.

### Found during

- **When Pi writes the file (step 3).** Pi 1.0.4's `SessionManager` writes a new
  session file once it holds a user or assistant message (`_hasConversation`, then
  `openSync(path, "wx")`), so at the first prompt, before the model request, not at
  the first reply. Until then `getSessionFile()` is only the name Pi will use.
- **A bound session can have no file, and that is normal.** `recruit` binds the
  worker straight away, so a worker recruited and never woken before a pause or Pi
  exit has a binding and no file. `SessionManager.open` on a missing path starts a
  session with a *new random ID* at that path, so it can't restore the identity.
  `SessionManager.create(cwd, dir, { id })` keeps the ID but files it under a new
  timestamped name. A rebind is not possible either: `session.bind` rejects a second
  binding for the worker (`session-state.mjs`), and changing the reducer is outside
  this phase.
  Decision: the binding stays as recorded. Reopen and history use the bound file if
  it exists; otherwise `SessionManager.findById(cwd, sessionId, sessionDir)` (which
  also checks the header `cwd`); otherwise reopen creates the session with the bound
  ID and history returns `[]`. So `binding.sessionFile` can name a file that never
  appears, when the worker was reopened before its first prompt. The PTY assertion
  scripts (`assert-native.mjs`, `assert-production.mjs`) still read
  `binding.sessionFile` directly; they pass because their flows prompt before any
  reload. Phase 5, which moves storage, may want to store only the ID.
- **Session file mode.** Pi creates session files with the default mode (0644 under
  umask 022), not 0600, so the per-file private / single-link checks went with
  `validateSession` and `sync`. The 0700 session directory check (`privateDirectory`)
  and the canonical / no-symlink check on the file (`canonicalPath`) stay.
- **What Pi does with a damaged file.** It skips malformed lines and blank lines,
  repairs a missing final newline, and migrates older versions; Swarm now accepts
  all of those. A non-empty file whose header doesn't parse is rejected by Pi. An
  empty (0-byte) bound file is rewritten by Pi with a fresh header and random ID
  before Swarm's identity check rejects it, so it is rejected but not left unchanged.
  Swarm's own checks after open: session ID and `getCwd()` match the binding.
- **History is now the active branch** (`getBranch()`), not every entry in file order.
- **Step 1:** `THINKING_LEVELS` is still used by `createSdkSession`'s selection check,
  so it stays (Phase 3 reworks model selection).
- **Step 6:** `createAgentSessionServices` builds a `DefaultResourceLoader` from
  options and can't take the isolated loader, so it would not remove code. Kept
  `createAgentSession`.
- `SwarmSessions.close()` also called `entry.sync()`; removed with the per-turn call.
- **Review fix: history of an open session comes from memory.** Pi's
  `loadEntriesFromFile` *writes* to the file when the last line has no final newline
  (it appends `"
"`). That is exactly what a reader sees while a live worker
  session is midway through an append, and the dashboard and `swarm_history` read
  history while other workers run. So `SwarmSessions.liveHistory()` returns a
  detached copy of the open session's `getBranch()` (or `[]` until Pi has written
  the file), and both `SwarmSessions.history` and `SwarmHost.history` use it before
  falling back to the file. The file path is now only used for unopened sessions,
  which have no live writer (the run lease keeps other processes out). New test:
  "history of an open specialist comes from memory and never writes its session
  file"; it fails with the fix disabled.
- `test/host.test.mjs` "read-only host history…": its worker's session is open in
  memory, so a planted wrong-identity file is (correctly) never read. The test now
  checks that history is `[]` and creates no file. Persisted-identity rejection for
  unopened sessions stays covered in `sdk-driver.test.mjs`.

**Result:** Linux 524 tests, 523 pass, only the known `ctime` flake fails; PTY
`run.py`, `production.py`, `native.py` pass. Windows 524 / 360 / 164: the five new or
renamed `sdk-session`, `sdk-driver` and `host` test names fail with the same
directory-fsync `EPERM` as the rest of those files; the four names gone from the
baseline were deleted, replaced or renamed.

## Phase 3 — plain model runtime

**Why:** `native-binding.mjs` (90 lines) and `native-provider.mjs` (45 lines) wrap
Pi's model runtime. Before every request they check that Pi's own methods haven't
been replaced (`source[name] === binding.references[i]`), and deep-compare a model
snapshot. Swarm needs one thing here: stop admitting requests once the run is
paused, stopped, or fenced.

**What does that job today:** `SwarmSessions.#requestGuard` (`sessions.mjs:113–121`)
is the real check. It is passed as `requestAdmission` to `createSdkSession`
(`sessions.mjs:94–98`), which binds it into the facade (`bindNativeRuntime`).

**Steps**

1. Pass the model runtime from `ctx.modelRegistry` (as `createCurrentSwarmExtension`
   already does, `extension.mjs:28`) straight to `createAgentSession`. Don't wrap
   it.
2. Move the admission check to the session boundary:
   - call `#requestGuard` before each `session.prompt` (`sessions.mjs:270`) and
     `session.compact` (`sessions.mjs:264`);
   - on pause, stop or fence, call `session.abort()` (already done at
     `sessions.mjs:256`).
   - If a check is needed *between* model requests inside one agent turn (after a
     tool result, before the follow-up), use a worker-session event such as
     `turn_end` to abort, or have a `tool_call` guard block. Check first which
     events an `AgentSession` with the isolated loader still emits to
     `session.subscribe`.
3. Delete `native-binding.mjs`. Reduce `native-provider.mjs` to choosing the model
   (physical chat model, not `pi-virtual`, supported thinking level), or fold that
   into `extension.mjs`.
4. `provider-capability.mjs`: after Phase 1 it only describes `pi-native` and the
   mock. Reduce it to the model identity shown in the approval dialog (provider,
   model ID, API, outbound data scope), or remove it if the approval can read that
   from the model directly. `approval-state.mjs` validates the persisted descriptor;
   keep the persisted shape readable, or accept that old runs can't be restored
   (as D7).
5. D5 (both on): in `createSdkSession`, remove `retry: { enabled: false … }` and
   `compaction: { enabled: false }` from `SettingsManager.inMemory`, so workers use
   Pi's defaults. Leave `cacheWarming: "off"` as it is; D5 doesn't cover it. Add
   tests that prove:
   - pausing or stopping during a retry back-off ends the turn promptly, with no
     further model request;
   - pausing during an automatic compaction ends the turn promptly
     (`abortCompaction` is already wired in `sessions.mjs`);
   - a turn that still fails after the retries are used up marks the task failed
     exactly once (one attempt used);
   - a worker whose context crosses the threshold compacts and keeps going,
     without failing its task.
   If a test can't be made to pass, keep that one setting off, and record why here
   and in D5.
6. Tests: `test/native-provider.test.mjs` and `test/provider-capability.test.mjs`
   cover the tamper checks; remove those cases. Keep the model-selection cases
   (virtual model rejected, unsupported thinking level rejected).

**Done when** a worker request goes `session.prompt` → Pi's model registry, with only
Swarm's admission check in front of it.

## Phase 4 — built-in coding tools for workers

**Why:** `session-tools.mjs` declares Swarm's own `read`, `edit`, `write` and `bash`,
dispatched in `SwarmSessions.#invoke` (`sessions.mjs:185–195`) to
`WorkspaceRuntime.worker()` (`workspace.mjs:94–125`), which uses `WorkspaceFiles`
and `runShell`. Pi exports `createReadToolDefinition`, `createEditToolDefinition`,
`createWriteToolDefinition` and `createBashToolDefinition`. This phase also makes
Swarm run on Windows: Pi's `bash` handles Git Bash, while `shell.mjs` needs POSIX
process groups.

**What the custom path enforces, and must keep enforcing**

| Guard | Today | After |
|---|---|---|
| Worker has a current task | `currentTask()` in `#invoke` | Same, in the tool wrapper |
| Turn still admitted (not paused or fenced) | `#guard` (`sessions.mjs:123`) | Same, in the tool wrapper |
| File claimed before mutating | `WorkspaceScheduler.withMutation` | Same scheduler call around the built-in `execute` |
| Read the current file before editing it | `#reads` fingerprint map (`workspace.mjs:145`) | Decide: keep, or rely on Pi's `edit` (exact text match) and drop it |
| Human Safety confirmation | `authorize` → `requestSafety` (`host.mjs:251–270`) | Same, called by the wrapper before the built-in `execute` |
| Execution receipt (before/after fingerprint) | `#execute` → `workspace.start` / `workspace.finish` (`workspace.mjs:168`) | Same, around the built-in `execute`; `swarm_report` cites these receipt IDs |
| Serialized file writes | `withFileMutationQueue` (`sessions.mjs:189`) | Same |
| `bash` runs alone | `withExclusive` (`workspace.mjs:161`) | Same |

**Reference:** `configs/pi-agent/packages/pi-teams/extensions/teams/sandbox/tools-filter.ts`
(139 lines): `buildSandboxedTools`, `wrapPathTool`, `wrapBashTool`. It wraps a
built-in definition's `execute` with a deny check plus a Safety confirmation, and
re-checks after the confirmation.

**Steps**

1. In `session-tools.mjs`, build `read` / `edit` / `write` / `bash` from Pi's
   definitions for `state.workspaceRoot`. Wrap each `execute` so it calls a Swarm
   hook (a slimmed `WorkspaceRuntime.worker()`) before and after the built-in
   `execute`. The hook does the guards in the table above.
2. Keep the collaboration tools (`swarm_status`, `swarm_task`, `swarm_recruit`,
   `swarm_message`, `swarm_history`, `swarm_files`, `swarm_report`) as custom
   tools, unchanged.
3. `createSdkSession` checks that every tool's `sourceInfo.source === "sdk"`
   (`sdk-session.mjs:243–245`). Check what source built-in definitions report when
   passed as `customTools`, and adjust that check rather than dropping it.
4. Delete `shell.mjs` and `test/shell.test.mjs`.
5. `workspace-files.mjs`: remove guarded `read`, `write`, `edit`, `applyEdits` and
   the fd-level capture. Keep `snapshot()` and `hash()` if receipts and approvals
   still fingerprint the checkout (`launch-setup.mjs`, `host-approval.mjs`, and
   `WorkspaceRuntime.#observe` use it). Make `snapshot()` work on Windows: no
   `getuid`, no directory fsync.
6. `workspace.mjs`, `workspace-scheduler.mjs`, `workspace-state.mjs`: remove what
   only served the custom tools. Keep claims, receipts, candidate validation, and
   reconciliation of uncertain operations.
7. `store/files.mjs`: on Windows, skip the `syncDirectory` fsync and the
   ownership/permission checks that rely on `process.getuid`, or confine them to
   POSIX. (Phase 5 may delete the store anyway; do the minimum needed for the suite
   to run.)
8. Tests: replace `test/workspace-files.test.mjs` cases for guarded IO with
   wrapper tests: claim required, Safety denied → tool error, receipt recorded,
   fenced turn → tool error. Keep `workspace-scheduler.test.mjs`.

**Done when** the Windows suite has no POSIX-only failures from tool code, a
worker's `bash` / `edit` calls show up in its session as Pi's built-in tools, and
every guard in the table is covered by a test.

## Phase 4b — run without `pi-plan` and `pi-safety`

**Decided by D8:** Swarm must work when neither package is installed, and still use
them when they are. Land this as its own commit, after Phase 4 (Phase 4 rewires the
Safety call this phase extends).

**Today**

- **Plan.** `ModeGate.current()` (`host-gates.mjs`, around lines 112–145) emits
  `pi-plan:query-mode` and requires exactly one `respond`. With no responder,
  `count === 0` and it throws `MODE_DENIED`. Every `capture()` and `assert()` goes
  through it: `host.mjs:87`, `:196`, `:285`, `:319`, and `extension.mjs:178–179`,
  `:279–280`.
- **Safety.** `requestSafety` (`host-gates.mjs`, around lines 198–251) emits
  `swarm:confirm-request` and requires exactly one `claim`. With no claimant,
  `count !== 1` cancels it, and every worker edit and command is denied. Its only
  caller is the `authorize` callback in `host.mjs:251–270`.

**Rule for both:** fall back only when **nobody answered** (`count === 0`). If a
provider answered with something malformed, or more than one answered, keep
failing closed exactly as today. A broken Plan or Safety install must not silently
turn into "no restrictions".

**Steps**

1. **Plan absent means Off.**
   - In `ModeGate.current()`, when `count === 0`, use a synthetic snapshot:
     `{ version: 1, instanceId: "absent", revision: 0, contextRevision: 0, ready: true, sessionId: <this.#sessionId>, selectedMode: "off", enforcedMode: "off", runMode: null, pendingChange: false }`.
     It's honest: with no Plan extension there is no mode restriction to honor.
   - If a real Plan provider shows up later (a reload, or a
     `pi-plan:mode-changed` event), `#accept` sees a new `instanceId`. That has to
     count as a permission change and revoke outstanding tokens, the same as any
     other mode change. Check that the existing retired-instance logic does that,
     and add a test.
   - The reverse: Plan was present, then stops answering. That must keep failing
     closed (`#invalidate`), not fall back to absent. Only a gate that has never
     seen a Plan instance may use the synthetic snapshot.
2. **Safety absent means Swarm asks itself.**
   - Change `requestSafety` to report `{ approved: false, unclaimed: true }` when
     `count === 0`, instead of a plain denial.
   - In `host.mjs`'s `authorize` callback, on `unclaimed`, call a new host option,
     `confirm(title, body, { signal })`. `extension.mjs` supplies it as
     `context.ui.confirm` on the current owning context. When
     `ctx.mode !== "tui" || !ctx.hasUI`, it returns `false` (deny), as everything
     else does with no UI.
   - Title: `"[<worker>] bash"` or `"[<worker>] edit <path>"`. Body: the full
     command or path. There is no risk classifier in the fallback, so it asks for
     **every** edit, write and command. (`pi-safety`'s classifier is what lets it
     skip read-only commands; copying it is out of scope.)
   - Keep the existing bookkeeping around the call: `#pendingSafety`,
     `approval.pending` / `approval.finished`, `#beforePrompt()` (which closes the
     dashboard first), the `safetyTimeoutMs` timeout, and the re-check of
     `#permit` afterwards.
3. **Tell the user which mode they're in.** At launch and resume approval, add one
   line to the agreement: "Mode gate: pi-plan" or "Mode gate: none installed (runs
   as Off)", and "Confirmations: pi-safety" or "Confirmations: Swarm asks for every
   edit and command". Read these from whether the last query or claim was answered,
   not from a list of installed packages.
4. **Tests** (in `test/host-gates.test.mjs`, plus one host-level test):
   - no Plan responder → `capture()` succeeds with mode Off;
   - two Plan responders, or a malformed response → still `MODE_DENIED`;
   - Plan appears after an absent start → outstanding tokens revoked;
   - Plan was present, then stops answering → fails closed;
   - no Safety claimant → `confirm` is called; true → approved, false → denied;
   - no Safety claimant and no UI → denied without calling anything;
   - two Safety claimants → denied, `confirm` never called;
   - a full mock run with an empty event bus (no Plan, no Safety) launches, and
     its worker's edit goes through `confirm`.
5. **Package metadata:** if `package.json` or the README lists `pi-plan` /
   `pi-safety` as required, mark them optional. They are integrations, not
   dependencies (D2: Swarm imports nothing from them, and must keep it that way).

**Done when** the tests in step 4 pass, and a Swarm run works end-to-end with only
Swarm loaded.

## Phase 5 — run storage outside the checkout

**Decided by D3:** a run must survive a Pi crash or exit, and any later Pi session
in the same project must be able to pick it up and continue it
(`/swarm restore <run-id>`, `/swarm resume`). So Swarm keeps a durable store, but
moves it out of the user's project.

**Today**

| File | Lines | Job |
|---|---|---|
| `store/files.mjs` | 72 | Private dirs, durable writes, directory fsync, `getuid` ownership checks |
| `store/journal.mjs` | 81 | Hash-linked, versioned, fsynced event log |
| `store/lease.mjs` | 66 | Exclusive controller lock (`controller.lock`) and run reservation (`reservation.json`), no stale stealing |
| `store/layout.mjs` | 27 | `.swarms/<runId>/` inside the user's checkout; insists on a Git root and a Git ignore rule |
| `core.mjs` | 232 | `SwarmController`: replay, fencing, persist-before-publish |
| `state.mjs` | 365 | Pure reducer for run events — **keep** |
| `host-approval.mjs` | `inspectCheckout` | Also insists on a Git root and checks `.swarms/` is ignored and untracked |

Because state lives under `.swarms/` in the project, launch first has to `git init`
and append `/.swarms/` to `.gitignore` (`launch-setup.mjs`: `prepareLaunchCheckout`,
`inspectLaunchSetup`, `applyLaunchSetup`). The run link stored in the main session
(`pi.appendEntry("swarm-run-v1", { runId, ownerSessionId })`, `extension.mjs:117–118`)
is how a later session finds the run; that part stays.

**Reference (copy the pattern, don't import, per D2):**
`configs/pi-agent/packages/pi-teams/extensions/teams/store/layout.ts`. It is a pure
path module that puts Teams state beside Pi's own sessions for the project, at
`<agent-dir>/sessions/<cwd-slug>/teams/<sessionId>/`, using `getAgentDir()` from
`@earendil-works/pi-coding-agent` and Pi's exact cwd → directory-name encoding.
Also see its `host-lease.ts` and `atomic.ts`.

**Target layout**

```
<agent-dir>/sessions/<cwd-slug>/swarm/
  reservation.json            # which run currently owns this project
  controller.lock             # live controller lease
  <runId>/
    events.jsonl              # run journal
    sessions/                 # worker Pi sessions (real Pi session files)
```

Key it by **project and run**, not by the owning session as Teams does. A run must be
restorable from a different session.

**Steps**

1. **Layout:** rewrite `store/layout.mjs` as a pure path module like Teams'
   `layout.ts`: `getAgentDir()`, the cwd slug, and the target layout above. Remove
   every `git` call and the `.swarms` checks. Keep `validId(runId)`. Add an
   override (`agentDir` option) for tests, like Teams has.
2. **Journal:** keep `store/journal.mjs` append-only with fsync per record. Decide
   whether the hash chain stays. It detects truncation or a torn last write, which
   matters for crash recovery. Recommendation: keep the per-record checksum, and
   drop anything that only exists to resist a hostile local editor. Write the
   choice down under **Found during**.
3. **Files and permissions:** in `store/files.mjs`, confine the `getuid` ownership
   checks and the directory fsync to POSIX (`process.platform !== "win32"`). On
   Windows, rely on the per-user profile directory. Pi's agent directory is already
   private to the user.
4. **Lease:** keep `store/lease.mjs`, and keep "no automatic stale stealing". Add
   one explicit path: `/swarm reconcile` can release a lease after the user
   confirms the previous Pi process is gone. Show the lease's owner session ID, and
   its PID if recorded, in that confirmation.
5. **Worker sessions:** `sessions.mjs` takes `sessionDir` from the layout (today
   `.swarms/<runId>/sessions`), and `host.mjs:120` reads history from it. Point both
   at `<runId>/sessions/`.
6. **Git is no longer required:**
   - `host-approval.mjs` `inspectCheckout`: drop the Git-root and `.swarms` checks.
     Keep the "existing changes" list when the project is a Git repo; when it
     isn't, say so in the approval instead of failing. The workspace fingerprint
     (`WorkspaceFiles.snapshot`) stays; it covers files, not Git.
   - Delete `prepareLaunchCheckout`, `inspectLaunchSetup`, `applyLaunchSetup` and
     the rest of `launch-setup.mjs`, plus `test/launch-setup.test.mjs`.
   - Remove `setup`, `setupConsent` and the setup checks from the approval packet
     (`extension.mjs` `chatControl`, `chat-approval.mjs`). Phase 6 may delete those
     anyway; do Phase 5's part either way.
7. **Old runs:** runs stored under an old `.swarms/` directory aren't migrated.
   On `/swarm restore` of a run ID that isn't in the new location, if
   `<cwd>/.swarms/<runId>` exists, say that it was made by an older Swarm version
   and can't be restored. Don't move files automatically.
8. **Restore from another session:** add (or extend) a test where session A
   launches and pauses a run, a new host for session B restores it by run ID, and
   resumes it. This is the requirement behind D3, so it must be covered directly.
9. **Tests:** update `test/storage.test.mjs`, `test/core.test.mjs` and
   `test/regressions.test.mjs` for the new layout, using the `agentDir` override and
   a temp directory. Drop cases that only checked Git ignore rules.

**Done when**

- a run launches in a project with no Git repository and no `.gitignore` change;
- nothing is written inside the project directory except by workers' own tools;
- the cross-session restore test passes;
- `grep -rn "\.swarms" extensions` only finds the old-run message from step 7.

## Phase 6 — native dialogs and approval

**Steps**

1. **Approval dialog** (`ui.mjs` `requestUserApproval`, `decision.mjs`
   `SwarmDecision` / `showDecision`, 105 lines): today it draws its own scrollable
   screen with `ctx.ui.custom`. Replace it with:
   - `ctx.ui.select(title, ["Cancel", "Edit agreement", "Approve"])`, with the
     summary in the title or a preceding `ctx.ui.notify`;
   - `ctx.ui.input` to edit a field (already used);
   - `ctx.ui.confirm` for "preserve existing work", "reconciliation" and "attest
     settlement" (`ui.mjs:33`, `:40`, `:45`).
   If a long agreement doesn't fit a native select, show it as a `display: true`
   custom message (as `chat-approval.mjs` does) and then ask with `select`. Delete
   `decision.mjs` and `test/decision.test.mjs`. Keep `test/decision-fixture.mjs`
   only if other tests still use it.
2. **Chat approval** (`chat-approval.mjs`, 71 lines, and the proposal half of
   `chatControl` in `extension.mjs:241–298`): the model calls `swarm_start`, Swarm
   posts a proposal, the user types `Approve swarm <uuid>` within 120 s, and the
   model calls again with `proposalId`. Replace that with one tool call that shows
   the agreement and calls `ctx.ui.confirm` from inside the tool. The tool runs in
   the owning interactive session, so the human answers the dialog directly; the
   model cannot answer it. Keep the checks that the context hasn't changed
   (session, cwd, model, Plan gate). Delete the `input` listener, `proposalId`,
   and `test/chat-approval.test.mjs`. Update the `swarm_start` and `swarm_control`
   descriptions in `main-tools.mjs`.
3. **Run link lookup** (`extension.mjs`, the `getEntries().filter(... LINK)` line in
   `ensureHost`): use `ctx.sessionManager.getBranch()`, so the link follows the
   active branch.
4. **Safety handler:** `configs/pi-agent/packages/pi-safety/extensions/safety/index.ts:241`
   has a dedicated `swarm:confirm-request` handler. If Swarm's request is now the
   same shape as teams/subagents (`agent`, `tool`, `command` or `path`), register
   the channel on the shared `handleConfirmRequest` (lines 236–238), and update
   `pi-safety/test/provider.test.mjs`.
5. **Keep** `dashboard.mjs` and `transcript.mjs`. The dashboard is a real custom
   view.

**Done when** no Swarm approval needs a custom TUI component or a typed reply.

## Phase 7 — README rewrite

`README.md` is about 1,400 lines, mostly phase-by-phase history (Phases 2–14, the
transport phases, the live trial). Rewrite it to describe the package as it is
after the cleanup:

1. What Swarm does, in a paragraph.
2. Requirements (platforms, Pi version), and `pi-plan` / `pi-safety` as optional integrations: what each adds, and what Swarm does without it.
3. Usage: `/swarm` commands and the dashboard keys.
4. Main-agent tools and the approval model.
5. Module map.
6. State and recovery: where runs are stored, and how to restore and continue a run from a later session.
7. How to run the tests.

History stays in git. Also update the root `README.md` line about Swarm, if its
wording no longer matches.

## Out of scope

- New Swarm features.
- Changes to `pi-teams`, `pi-subagents` or `pi-plan`, except the Phase 6 Safety
  handler cleanup.
- Pushing or opening pull requests. Those happen only on request.
