# Agent focus navigation — implementation handoff

## Summary

Temporary handoff for the PR implementing keyboard navigation between the main chat,
subagents, and team agents. Finish implementation and verification before treating this
as merge-ready. The user explicitly requests that the implementing/reviewing agent delete
this document and its index link after all acceptance criteria are satisfied; keep lasting
usage guidance in the package READMEs instead.

## Agreed scope

- A status-line indicator counts available subagents and team agents (for example `[5]`).
- A memorable, non-conflicting shortcut cycles to `[1/5] Reviewer`, displays that agent's
  transcript, and lets interactive messages reach the selected agent where supported.
- Alt+S was an example, not a requirement. The implementation chooses **Alt+N**; verify
  actual bindings and terminal behavior before documenting it as conflict-free.
- Escape returns to the main chat. Cycling beyond the last agent also returns to main.
- Packages remain standalone: no cross-package imports; plain-data events coordinate them.
- Do not broaden this into a new worker lifecycle, permission model, or tool API.

## Current implementation

Paths below are relative to `configs/pi-agent/packages/`.

| Owner | Files and responsibility |
|---|---|
| `pi-status-line` | `extensions/status-line/agent-focus.ts`: merges rosters, owns Alt+N/Escape and focus state; `index.ts` integrates it; `segments.ts` renders the indicator on footer row 2-left, keeping the tool monitor on row 1-left. |
| `pi-subagents` | `extensions/subagents/tui/focus.ts`: publishes roster, renders transcript tail as an above-editor widget, and routes interactive text via `core.sendAsUser`; `index.ts` creates/disposes the bridge and routes input before wake-pump handling. |
| `pi-teams` | Equivalent bridge in `extensions/teams/tui/focus.ts` and wiring in `index.ts`. |
| Transcript rendering | Both `tui/viewer.ts` modules export `buildComponents` for their own bridge to reuse. |

Protocol: `agent-focus:roster` carries `{ source, noun, agents: [{ id, name, working }] }`;
`agent-focus:roster-request` requests republication; `agent-focus:focus` carries
`{ source, id }` or `null`. Only interactive, nonempty, non-slash text is routed.
No main turn should start for routed input. Focus changes request status-header pinning.

## Finish and review

1. Verify the Pi SDK/UI contract against the supported installed version, especially
   widget disposal, terminal input interception, and input listener ordering. The current
   widget adds a transcript above the editor; verify whether this actually meets the
   requested chat-switch behavior rather than merely duplicating the visible main chat.
2. Test the presenter and both producers independently and together. Cover deterministic
   ordering, empty/invalid rosters, changing/retired agents, session switch, reload,
   shutdown, repeated focus changes, Escape, and cycling back to main. Check that timers,
   listeners, and transcript components are released and stale focus cannot route input.
3. Verify messages to both persistent and one-shot agents, unavailable/retired targets,
   dormant/busy targets, send failures, and images/attachments. The current route forwards
   only trimmed text; decide explicitly how attachments are handled, with no silent loss.
   Slash commands and non-interactive agent input must retain their existing semantics.
4. Inspect async polling for stale roster/transcript updates and error visibility. Check
   history reads do not alter a live session file. Review small terminal heights, long
   transcripts, narrow widths, Unicode labels, scrolling, and footer truncation.
5. Finish strict typechecks and regression tests for all three packages; add focused
   automated coverage for the new protocol, routing, and lifecycle. Update package READMEs
   and stale header comments with shortcut, routing, layout, and standalone behavior.
6. Run interactive Pi verification with both agent systems loaded, including an active
   main turn and competing overlays. Document actual behavior and any supported limits.

## Evidence and validation gaps

- Original implementation report: pi-teams strict typecheck passed using a temporary SDK
  compatibility shim. Phase 2 harness failed at `type body (layer 3)` on both the change
  and untouched baseline. These are historical reports, not newly reproduced results.
- Original report left pi-subagents/status-line typechecks, remaining harness comparison,
  README/header updates, and interactive verification unfinished.
- Publication checks: `git diff --check` passed. Repository Python utility tests passed
  18 cases, with one FFmpeg-dependent case skipped; those do not validate this feature.
- Global configuration validation was blocked by unresolved Windows worktree resource
  symlinks, and its tests timed out. Package harness startup was blocked by its expected
  nested `jiti` path in the managed SDK. No TypeScript executable was available on PATH.
- Do not install dependencies or change runtime resource mappings just to hide these
  environment failures. Fix the supported harness contract deliberately or use an
  existing compatible environment and record the result.

## Acceptance and cleanup

The counter and focus label reflect the current roster; Alt+N and Escape behave as
agreed; transcript presentation satisfies the chat-switch requirement; messages reach
only the intended agent; main chat and commands are unaffected when unfocused; lifecycle
cleanup is safe; all new tests and supported-package checks pass; usage docs are current.

Then remove this file and its `.agents/README.md` entry in the completion commit.
Do not remove unrelated plans, worktrees, session data, or runtime resources.
