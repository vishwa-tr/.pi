# Shared worker context

Canonical development source for Pi Subagents, Teams and Swarm; this is not an
enabled extension or a runtime dependency. Identical helpers are bundled inside each
individual package, so each extension installs and runs independently. Requires the public Pi SDK, verified against Pi 1.0.4. Each extension owns
its worker authority and lifecycle.

`captureWorkerContext` defaults to `auto`: prefer fork strictly below 30% of main's
context window, otherwise focus. Unknown usage prefers focus. Main can explicitly
choose focus/fork at any percentage. Explicit fork fails when canonical history is
unavailable rather than silently changing modes. Capturing makes no model request.

Forks copy the active, compaction-aware conversation after context edits. SDK summary
and custom-message types become historical model messages. System messages, settings,
extension state and live agent resources are excluded. Completed tool pairs remain
historical; unfinished calls and orphan results are omitted. New workers keep their own
identity, system instructions, tools, permissions, limits and assignment.

`seedWorkerSession` initializes once using public SessionManager methods and persisted
markers. Incomplete copies and missing existing fork histories fence reuse.
Existing workers are never silently reseeded.
`workerContextInstructions` adds a system-level boundary for inherited chat.
`workerSessionStats` subtracts copied parent usage while preserving native context
estimates. Swarm's live admitted-request ledger counts only new worker requests.

Snapshot digests bind content and metadata. Approval and status show `contextSummary`,
not another transcript dump. Swarm preserves the inspected snapshot and per-worker
choices across approval, model configuration and recovery. Historical approval text
never authorizes execution. Native model limits and compaction still apply; this is
not a measured token-saving or cache-hit guarantee.

From the repository root, verify shared policy and actual Subagents/Teams spawn tools:

```sh
node --import ./tests/register.mjs --test packages/shared/worker-context.test.mjs packages/shared/worker-context-runtime.test.mjs
```

Swarm's package tests cover native requests and owner approval. Tests use synthetic
chat and local scripted providers without personal credentials or live model calls.


After editing the canonical helper, synchronize the package-local copies and check parity:

```sh
node scripts/sync-worker-context.mjs --write
node scripts/sync-worker-context.mjs --check
```

Standalone portability tests copy one package at a time into an isolated directory,
verify that relative imports remain inside that package, and load its runtime without
any neighboring extensions or the canonical source directory.


Each coordination package has its own `AGENTS.md` with the independence requirement.
Its packaged runtime must never import this canonical directory or a neighboring extension.
