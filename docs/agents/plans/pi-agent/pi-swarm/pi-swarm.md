# pi-swarm — implementation plan

## Summary

Build `pi-swarm` as a standalone, goal-driven collaboration extension alongside Pi Subagents and Pi Teams.

Agents collectively decompose an objective, recruit specialists, claim tasks, exchange findings, implement changes, and verify results. The main agent supervises rather than relaying every interaction.

Agreed direction:

1. **Generate specializations during the run.** Swarm does not read or depend on `.agents/subagents/` definitions.
2. **Specialization focuses work and context, not tool permissions.** All swarm workers receive the same enabled tool set, regardless of role. Domain-focused assignments help agents accumulate relevant project knowledge.
3. **One shared checkout and branch.** No per-agent worktrees, branches, or merge phase.
4. **Specializations may combine domain and function.** Allow database planner and database builder when useful, without requiring that split. A general database specialist can handle both planning and building for smaller work.
5. **Keep specializations stable throughout a run.** Preserve each agent’s focus and accumulated context across related assignments rather than repurposing it for unrelated work. This guides assignments, not tool permissions or necessary cross-domain investigation.
6. **Use practical specialist briefs.** Include the stable specialization, current task if known, relevant context, and expected outcome rather than an elaborate persona. This does not determine who creates agents or selects their work.
7. **Allow collaboration with any agent in the swarm.** Specialists can discover and contact any peer. Suggested contacts and known dependencies are guidance, never a collaborator allowlist.
8. **Allow autonomous task selection in three ways.** Within the approved objective and their specialization, agents may claim available board tasks, take work requested by peers, or create and claim necessary follow-up work they discover. No main-agent approval is required per task. Record ownership on the shared board to prevent duplicate work. This does not authorize recruiting new agents or expanding scope.

Use a deterministic controller for scheduling, ownership, persistence, limits, and cancellation. Use models for decomposition, implementation, collaboration, and review.

## Details

### Decision status

**Confirmed recruitment policy:** agents can recruit peers independently within user-approved run limits, without main-agent approval for each recruitment. The extension enforces the limits; agents cannot raise them. Exceeding them requires explicit user approval. Defaults are confirmed in section 4.6.

**Confirmed specialist reuse policy:** prefer an existing suitable specialist. Before recruiting another, check current work, queued work, task dependencies, likely file overlap, and whether enough independent work exists to benefit from parallel execution. Require a concrete justification for another specialist. Being busy alone is insufficient; do not use a repeated-busy-check count or arbitrary busy threshold. Another specialist is allowed for useful, independent parallel work within approved limits.

Stages 1–5 (controller/persistence, workspace safeguards, offline SDK integration, host approval/policy integration, and opt-in launch/recovery UI controls) are authorized and implemented; see sections 10–14. SDK execution defaults to deterministic mock providers; the separately injected constrained adapter and HTTPS client are described in sections 19–20. Phase 5 UI is tested through fake native UI contexts; authorized Phase 6 adds isolated automated CLI/PTY acceptance (section 15). Authorized Phase 7 adds a mock-only live dashboard and read-only history navigation (section 16). Authorized Phase 8 adds real CLI acceptance with production Plan/Safety providers (section 17). Phase 9 implements offline provider agreement/readiness plumbing with unsupported real transport failing closed (section 18). Phase 10 implements the offline constrained adapter (section 19); Phase 11 adds explicitly authorized HTTPS tested only against local TLS fixtures (section 20). Live remote model trials and activation remain unauthorized. The agreed direction above supersedes the original proposal to reuse shared subagent definitions. Other implementation details remain proposals unless explicitly confirmed.

**Confirmed architecture simplification (section 23):** production integration should reuse the
host's public native Pi model/provider and credential machinery, not require a bespoke HTTP/auth
stack. Sections 18–20 describe retained optional legacy/experimental work, not requirements for
the preferred production path. Native networking follows trusted host configuration; no exact
egress-pinning, secret-redaction or OS-sandbox promise is made. Live trials and activation remain
separately gated.

Record decisions in this document as discussion proceeds and update affected sections so superseded designs do not remain implementation requirements.

**Confirmed file-claim policy:** provide a file-claim tool and enforce ownership in worker `edit`/`write` wrappers. Reads remain allowed. Conflicting claims identify the owner and related task so agents can coordinate a handoff or work elsewhere. Multi-file claims are all-or-nothing. Release claims when work finishes or cancellation safely settles; never forcibly transfer ownership while the previous agent is still editing. A new owner rereads current contents before editing. Claims coordinate swarm agents, not external editors or arbitrary shell commands. Confirmed for v1: shell commands acquire an exclusive workspace lock after active edits settle and file claims are released. While a command runs, other swarm edits and shell commands wait. This includes tests and apparently read-only commands. Discussion and planning can continue; reads during execution may become stale. External editors and detached processes are not covered.

**Confirmed v1 worker tool set:** provide the same enabled standard Pi coding tools and Swarm collaboration tools to every specialist, subject to host restrictions. Wrap file mutations for claim enforcement and shell execution for exclusive workspace locking. Do not automatically inherit arbitrary main-agent extension tools; additional tools require explicit integration and preservation of their authorization requirements.

**Confirmed visibility and controls:** show a compact live summary of each agent’s specialization, current task, and status. Provide a `/swarm` dashboard for tasks, blockers, file claims, and usage; selecting an agent opens its conversation. Make pause and stop prominent. Notify the user about decisions requiring attention and final results, not every internal peer message. Detailed layout and rendering mechanics remain implementation proposals.

**Confirmed v1 model policy:** all agents inherit the main agent’s model and thinking level as captured at swarm launch, unless the user explicitly selects a swarm-wide override. Use the same approved model and thinking level for every specialization. Agents cannot switch models themselves; later changes to the main agent’s settings do not silently alter the run.

**Future improvement requested:** revisit per-specialist model/thinking selection after v1. Explore user-controlled choices suited to planning, building, and reviewing, with explicit provider authorization and visible cost implications. This is a follow-up design topic, not permission for autonomous model switching or an additional v1 requirement.

**Confirmed agent-limit structure and defaults:** configure separate limits for total agent identities and simultaneously active agents. Default to eight total and four active; allow an explicitly specified different active limit. Waiting agents retain their context without occupying an execution slot. These are ceilings, not recruitment targets or spending caps. File claims and exclusive shell locking still constrain actual parallel work.

**Confirmed persistence and recovery policy:** use project-local, Git-excluded run storage managed by the extension, with a durable event journal and Pi-native agent sessions. Restore previously active runs paused after reopening Pi; preserve stopped, completed, and failed states. Retain tasks, histories, and progress, and require explicit resume or restart with workspace and interrupted-command reconciliation before continuing. Never blindly replay uncertain side effects. Preserve corrupted state and report errors rather than silently resetting it.

**Confirmed remaining guardrails:** default to a configurable ceiling of 100 tasks per execution cycle. Reaching it blocks new task creation and requests user authorization for an increase; existing work may continue. Restart resets the allowance, with carried-over unfinished tasks counting toward the new cycle while completed historical tasks remain recorded without consuming its allowance. Do not impose fixed model-response counts per assignment or across the run; use the approved runtime, task-attempt, and stalled-work policies instead.

**Confirmed launch experience:** clarify ambiguous requests with focused questions, then present one user-approved launch summary containing the objective, acceptance criteria, scope and exclusions, model/thinking selection, and configured limits. Resolve handling of pre-existing uncommitted changes with the user before starting. Allow the user to adjust the summary. After approval, the swarm investigates, decomposes the objective, and proceeds without a second planning checkpoint; the user need not design its task list.

**Confirmed restart eligibility and safeguards:** paused, stopped, completed, and failed runs support explicit user-authorized restart. Restart begins a fresh execution cycle with reset limit allowances while preserving history, agent context, and completed work; resume only continues a paused run with remaining allowances. Keep completed tasks completed unless relevant follow-up work requires reopening them, and confirm scope changes. Restart must refuse to proceed while prior execution remains unsettled, another run owns the checkout, or saved state is corrupted; resolve those conditions first. Restart is not a bypass for ownership, state validation, or cancellation safeguards.

**Confirmed pause/stop policy:** provide both controls. Pause interrupts active work and stops new dispatch while retaining context for discussion, correction, and explicit resume. Stop ends active execution but retains the run for explicit user-authorized restart; queued messages cannot reactivate it. Once execution safely settles, release checkout ownership. Restart must reacquire ownership, reconcile current workspace state and interrupted work, and establish a fresh execution generation before dispatch. Confirmed: explicit restart resets all limit allowances and enforcement counters for a fresh execution cycle, including elapsed running time and per-task attempts, using the configured limit values. Preserve historical usage, attempts, decisions, task progress, and agent contexts for inspection; resetting enforcement counters does not erase history. Retained agent identities count against the total-agent limit; carried-over unfinished tasks count toward the new cycle’s task ceiling, while completed prior-cycle tasks do not. Pause/resume does not reset limits. Neither operation undoes project changes. If active execution cannot stop cleanly, report stop incomplete and block new work until resolved rather than claiming complete termination.

**Confirmed blocker policy:** a local blocker pauses the affected task, not independent work. Record the blocker, ask the relevant peer, and either take another suitable task or wait without occupying an execution slot. Decisions requiring user authorization, such as scope expansion or destructive migration approval, must be escalated rather than guessed. A run-wide blocker pauses the swarm with a clear explanation of the needed decision. Repeated failed attempts escalate instead of retrying indefinitely; the default task-attempt limit is three; other escalation thresholds remain to be decided.

**Confirmed pre-existing-change policy:** if launch preflight finds uncommitted changes, present the situation and ask the user how to proceed before dispatching swarm work. Do not automatically continue on unaffected files or infer that existing changes belong to the objective. Preserve user work and the index; no automatic stash, reset, discard, or commit. The exact choice presentation remains to be designed.

**Confirmed external-edit handling:** reject an agent’s stale edit if the target changed after its read. Have the agent reread and reassess before continuing; incorporate external changes only when safe. If changes conflict or user intent is unclear, block the affected task and ask the user. Never automatically undo user edits to restore an expected version. This is stale-state detection, not an operating-system lock against external writers.

**Confirmed final-report policy:** provide one consolidated report covering delivery against the objective, key changes and decisions, actual verification and independent-review results, and remaining limitations or unresolved issues. Distinguish verified completion from stopped or unfinished work; do not merely concatenate agent reports. Leave project changes in the shared checkout for user inspection, without automatic commit, push, or cleanup of user work.

**Confirmed context-compaction policy:** use Pi-native compaction when a specialist’s context fills rather than silently replacing that agent. Preserve specialization, current task, key decisions and rationale, unresolved questions, and relevant file references in the compaction summary. Reload current shared user guidance and task state afterward, and retain prior history for lookup. Compaction is lossy: durable task state and saved user decisions remain authoritative over conversational recollection. Exact SDK integration and summary verification remain implementation details.

**Confirmed user-redirection policy:** record user corrections as durable, shared run guidance and deliver them to every agent in the swarm, not just apparently affected specialists. Active agents must receive the correction before taking further task actions; waiting agents receive it before resuming, and future recruits receive the current guidance. Update affected tasks and pause conflicting work before proceeding. If the correction changes the approved objective or scope, pause the run and obtain user confirmation of the revised scope. Guidance delivery does not resume paused work or reactivate stopped runs. Already executing actions may need cancellation and reconciliation; do not imply instantaneous interruption or automatic rollback. Exact delivery and acknowledgment mechanics remain to be designed.

**Confirmed checkout ownership:** allow only one running swarm per canonical checkout in v1. A second launch must identify that the workspace is occupied and refuse to silently take ownership. Separate projects can run separate swarms. This coordinates Swarm controllers, not external editors or other tools; external changes still require detection. Confirmed: a paused swarm retains checkout ownership, including when restored paused after reopening Pi. Resume it or explicitly stop it before launching another swarm in that checkout. Stop releases ownership only after active execution safely settles; incomplete stopping must retain ownership fencing.

**Confirmed conversation-progress policy:** assess lack of task progress rather than terminating useful discussion after an arbitrary message count. Waiting for answers does not occupy an execution slot. Agents must identify unresolved questions and blockers; repeating exchanges without advancing work should escalate the blocker rather than loop indefinitely. Useful discussion may continue within approved run limits. Reliable detection remains to be designed; message count alone is not evidence of stalled work. The earlier proposed fixed message/hop cutoffs are superseded.

**Confirmed v1 cost visibility:** provide a cumulative usage/cost indicator, not a monetary ceiling or cost-triggered automatic pause. The user can pause or stop based on that indicator; other approved limits still apply. Label costs as provider-reported or estimated and show unavailable pricing as unknown rather than zero. The indicator is not a billing guarantee and may lag in-flight usage.

**Confirmed runtime limit:** default to 60 minutes of elapsed running time, configurable before launch. Count wall-clock time while the swarm is running, not the sum of agent times; exclude paused time. At the limit, stop dispatching, safely pause, preserve progress, and ask the user whether to extend the run. Only the user may authorize an extension. This is a time guard, not a spending cap.

**Confirmed task-attempt limit:** default to three attempts per task: one initial attempt and up to two correction attempts. Count task executions ending in failure or rejected submissions, not individual commands or test runs. Exhaustion blocks the task and escalates for direction while independent work can continue. Do not create replacement tasks to bypass the limit or blindly replay interrupted commands. The limit is configurable before the run; raising an approved limit requires user approval.

**Confirmed review policy:** a builder’s completion report and test results are a submission, not sufficient by themselves to close source-changing work. Require review by another agent against the task’s requirements, return findings for correction, and verify the combined result before the swarm finishes. Reviewers retain the same tools; a reviewer who edits a candidate becomes a contributor and needs another agent to independently approve that revised candidate. Confirmed evidence policy: the extension records actual verification commands, exit statuses, and the workspace state tested; agents reference those records rather than unsupported success claims. Relevant changes invalidate earlier results. Final checks run with edits blocked. Reviewers assess test relevance and adequacy, not just successful exit status. Exact receipt and fingerprint implementation remains proposed.

**Confirmed initial-planning policy:** after user approval of the objective and scope, the swarm may proceed from its initial task breakdown to implementation without another approval checkpoint. Scope expansion still requires explicit user approval.

**Confirmed context-sharing policy:** share focused handoffs containing relevant decisions, reasons, constraints, findings, and file references rather than automatically copying entire conversations. Agents can ask follow-up questions and inspect another swarm agent’s history when needed. Preserve focused contexts without restricting access to relevant peer history.

**Confirmed run-local context:** preserve generated briefs and agent histories as run recovery state, not reusable role-definition files.

**Remaining implementation-design work (not additional agreed product requirements):**

- Specify atomic recruitment/reuse checks and how limit-increase requests are presented. Preserve the agreed workload-based judgment rather than inventing a mandatory role matrix.
- Define progress evidence and escalation that distinguish circular discussions from useful investigation; fixed response/message cutoffs are not approved substitutes.
- Specify file-claim draining, shell-lease scheduling, and slot release to avoid deadlocks. Ensure verification can obtain an independent reviewer within the approved agent/task ceilings; if not, escalate rather than bypassing review or limits.
- Separate execution-cycle budget resets from cancellation-generation changes. Define exact receipt/fingerprint schemas, guidance revision acknowledgments, and state reconciliation tests.
- Verify current SDK contracts for compaction, tool provenance, history retrieval, and safe interruption before implementation. Earlier source references are research anchors, not proof that the new design has been implemented or tested.
- Finalize UI details, runtime-directory exclusion setup, and safe history cleanup. No automatic deletion policy has been approved.

The behavior decisions are recorded. Stages 1–5 implement the foundation, workspace safeguards, offline SDK integration, host approval/safety/mode protocols, and opt-in mock launch/recovery controls. Live-provider support, full live dashboard/terminal acceptance, safe stale-owner recovery, and activation remain gated. Resolve remaining technical gaps without silently changing those decisions. Escalate any gap that requires a user-visible policy change.

### 1. Requirements and scope

#### Included

- User-approved objective, acceptance criteria, and working scope.
- Shared task board with dependencies, ownership, findings, and blockers.
- Dynamically generated specializations without reading `.agents/subagents/`; autonomous recruitment within user-approved run limits.
- Direct peer messaging.
- Parallel work on disjoint files in the same checkout.
- Persistent worker memory and resumable run state.
- Independent review and recorded verification.
- Live activity tree and `/swarm` dashboard.
- Bounded concurrency, task creation, task attempts, and runtime; visible model usage/cost and progress-based conversation escalation without fixed message/response counts.
- Pause and stop controls that prevent queued work from restarting agents.

#### Explicit non-goals

- Replacing or migrating Subagents or Teams.
- Per-role tool allowlists.
- Per-agent Git isolation.
- Automatic commits, pushes, publication, or destructive cleanup.
- Automatically discovering and executing every parent-session extension tool.
- Cross-machine execution, background daemons, or autonomous operation after Pi exits.
- Claiming an operating-system security sandbox.

Visible coordination and reliable stopping are design goals; the implementation does not depend on reproducing a particular reported multi-agent incident.

### 2. Verified findings

Path abbreviations:

- `TEAMS`: `packages/pi-teams/extensions/teams`
- `SUBAGENTS`: `packages/pi-subagents/extensions/subagents`
- `PLAN`: `packages/pi-plan/extensions/plan`
- `SDK`: original research baseline **0.85.1**; current supported/verified baseline is **1.0.0** (section 21).

| Finding | Evidence |
|---|---|
| Active packages and project-specific plans have established locations. | `README.md:210–213` |
| Existing Subagents and Teams share a definition library; Swarm will not consume it. The earlier discovery/adaptation proposal is superseded. | `README.md:69–72` |
| Teams demonstrates persistent SDK sessions, shared cwd, provider inheritance, and explicit child tool construction. | `TEAMS/runtime/in-process.ts:893–959` |
| The SDK supports constructing child sessions from cwd-bound services and custom tools. | `SDK/dist/core/agent-session-services.d.ts:22–85` |
| `getAllTools()` exposes metadata, not executable tool implementations. Parent tools cannot simply be copied into children. | `SDK/docs/extensions.md:1677–1702` |
| Built-in edit/write already use Pi’s per-file mutation queue. | `SDK/dist/core/tools/edit.js:96`, `SDK/dist/core/tools/write.js:34` |
| Shell operations expose actual exit codes and cancellation signals. | `SDK/dist/core/tools/bash.d.ts:31–50` |
| Safety confirmations use a synchronous-claim event-bus protocol. | `TEAMS/sandbox/safety-bridge.ts:53–84` |
| The safety provider currently handles three delegation channels. | `packages/pi-safety/extensions/safety/index.ts:174–217` |
| Mode transitions and restoration are centrally owned by pi-plan. | `PLAN/index.ts:299–341`, `PLAN/index.ts:691–725` |
| Package activation requires updating an exact-count validator. | `scripts/validate-global-config.mjs:12`, `scripts/validate-global-config.mjs:50–58` |

### 3. Implementation design

#### 3.1 Independent package and controller

Create:

`packages/pi-swarm/`

Use the current SDK directly rather than wrapping `team_*` or `subagent_*` tools. Those runtimes enforce different delegation and permission models.

Reuse:

- SDK session creation, model resolution, tool factories, and cancellation.
- Existing atomic-write patterns; no role-definition discovery.
- Existing safety event protocol.
- Existing activity-tree and mock-provider testing patterns.

Keep package code self-contained. Do not introduce runtime imports into another extension’s private implementation or extract a shared framework as part of this change.

One controller owns all swarm state changes. Worker tools call that controller through identity-bound closures; workers do not directly update coordination files.

#### 3.2 Goal-driven collaboration

Starting a run creates a root objective and a planning assignment.

The initial specialist:

1. Inspects the project.
2. Creates bounded tasks tied to acceptance criteria.
3. Adds dependencies and suggested specializations.
4. Recruits help where useful.

All workers can subsequently:

- Create and claim necessary follow-up tasks within the approved objective and their specialization.
- Claim available board tasks within that objective and specialization.
- Take work requested by peers within those same boundaries.
- Recruit another specialist independently within user-approved run limits; request explicit user approval to exceed those limits.
- Ask peers questions.
- Publish findings.
- Submit work for review.
- Yield when blocked.

Confirmed: the three task-selection paths above do not require main-agent approval per task. Record ownership on the shared board before executing work to prevent duplicate claims. Peer requests and discovered tasks do not expand the approved objective or change an agent’s specialization.

The proposed controller validates transitions and schedules ready work. Agents make technical decisions. Recruitment within user-approved limits does not require main-agent approval; exceeding those limits requires explicit user approval. Confirmed: after the user approves the objective and scope, the swarm can act on its initial task breakdown without another main-agent or user approval checkpoint. Planning still happens; changes beyond the approved scope require explicit user approval.

The proposed recruitment topology is **flat**: every recruited agent belongs to the same run, controller, resource pool, and stop mechanism.

Example: a database planner identifies implementation work. If a suitable database builder already exists, it can coordinate with that agent. If none exists, it can recruit a database builder without main-agent approval, provided the request stays within approved run limits. Confirmed: check workload and prefer reuse before recruiting another suitable specialist; require a concrete reason that independent parallel work will help. For example, queue audit-log work with the existing database builder if it depends on the invitation migration. A second builder may help if the audit-log work is substantial and independent. Repeated observations that the first builder is busy do not justify recruitment. Concurrent duplicate-recruitment prevention remains an implementation detail to resolve.

#### 3.3 Dynamically generated specializations

Swarm does not discover, parse, or adapt global or project `.agents/subagents/` definitions. Leave those resources and existing runtimes unchanged.

Specializations are generated for the work at hand. Their purpose is to focus task ownership and accumulated context, not to grant expertise through a label or restrict tools. A database specialist primarily handles database work but can inspect an API handler when needed to understand a query’s use.

Confirmed brief fields:

- Stable specialization and focus, optionally combining domain and function.
- Current task, if known, and expected outcome.
- Relevant project context and prior findings.
- Optional suggested contacts, known dependencies, and handoff context—not a collaborator allowlist.

Use a concise practical brief rather than an elaborate persona. Agents may discover and collaborate with any peer in the swarm, regardless of which contacts appear in their brief. Collaboration with an existing peer is distinct from recruiting a new agent. The brief does not imply managerial assignment: agents can obtain work through the three confirmed task-selection paths in section 3.2. Recruitment is autonomous within user-approved run limits; exceeding those limits requires explicit user approval.

Confirmed: specializations may combine domain and function, such as database planner and database builder, without requiring that split. A general database specialist can plan and build for smaller work. Separate specialists can maintain focused contexts and exchange relevant findings. Do not instantiate a fixed role matrix upfront. Agents may recruit within user-approved run limits. How the swarm decides a split is worthwhile remains open.

Confirmed: keep each agent’s specialization stable throughout the run. An agent can wait between assignments and return for related work; do not repurpose it for an unrelated specialty. Necessary cross-domain investigation remains allowed and tools remain uniform. Prefer routing related follow-ups to an existing suitable specialist. Apply the confirmed workload-check and reuse-first policy before adding another specialist. Confirmed: exchange focused handoffs containing relevant decisions, reasons, constraints, findings, interface contracts, and file references rather than automatically copying entire conversation histories. Recipients can ask follow-up questions and inspect peer history when needed. For example, a database builder receives the planner’s schema decisions and rationale, not every exploratory step by default. History access must remain within the same swarm; pagination and retrieval mechanics remain implementation details.

Persist the generated brief with the worker session for run recovery, without writing reusable role definitions. Use Pi-native compaction to maintain the existing specialist when context fills. Summaries must preserve focus, current work, decision rationale, open questions, and relevant references. Reload durable guidance and task state afterward; retain previous history for lookup and do not treat a lossy summary as coordination truth. Confirmed for v1: capture the main agent’s model and thinking level at launch, with an explicit user-selected swarm-wide override when desired. All specialists use that approved selection; agents cannot switch models themselves. Per-specialist selection is a requested future improvement, not a v1 requirement.

Always load applicable project guidance. Generated briefs cannot override privacy obligations, authorization boundaries, mandatory instructions, or preservation of user work. All specializations receive the same enabled tools.

#### 3.4 Uniform tools

Confirmed for v1: every worker receives the same enabled standard Pi coding tools and Swarm collaboration tools, subject to host restrictions. File mutations and shell execution use the agreed coordination wrappers. Additional extension tools require explicit integration and authorization handling, not automatic inheritance.

For v1:

- Support Pi’s seven existing Unix coding tools.
- Respect the parent’s enabled built-in tools and explicit host restrictions.
- Never derive availability from the generated specialization or assignment brief.
- Do not load arbitrary extensions inside child sessions.

Use tool provenance when constructing the supported coding set. If an enabled built-in name has been replaced by an execution backend Swarm cannot preserve, fail preflight rather than silently substituting unrestricted local execution.

Display the effective worker tool set at launch.

Automatic inheritance of arbitrary extension tools is deferred because Pi’s public metadata API does not expose their executable implementations.

Main-agent lifecycle interfaces are separate from worker specializations: workers cannot start another swarm, raise limits, expand scope, or authorize resume/restart. Lifecycle tool calls cannot substitute for explicit user authorization.

#### 3.5 Shared checkout coordination

Resolve and pin the supplied checkout’s canonical root and current branch/HEAD identity.

Every worker session uses the same cwd. The runtime never creates or switches branches or worktrees.

Before work begins:

- Inspect Git status.
- If uncommitted changes exist, record the baseline, explain the situation, and ask the user what to do before dispatching swarm work. Do not automatically proceed on unaffected files.
- Apply only the user-authorized handling of existing changes; do not infer ownership from the objective.
- Preserve the index and pre-existing user work. Never automatically stash, reset, discard, or commit.
- Reject unsupported repository states with a clear explanation.

Confirmed: use task-owned file claims enforced by the extension’s worker editing tools. Other agents may still read claimed files; conflicts identify the owner and task for coordination. New owners must reread current contents before editing. Never forcibly transfer ownership during an active edit.

File-claim mechanics:

- Claims are atomic and exclusive.
- Multiple disjoint paths can be claimed together.
- Conflicting requests return owners and blockers without taking partial ownership.
- Canonicalize paths and reject traversal and unsafe aliases.
- Claims are released after assignment settlement, not merely after a report tool returns.

For `edit` and `write`:

- Require an appropriate claim.
- Require a fresh read fingerprint for an existing target. Reject stale edits; the agent must reread and reassess external changes. Continue only when safe, otherwise block the task and ask the user. Never undo user edits to restore the expected version.
- Recheck authorization, run generation, claim ownership, and target identity after confirmation.
- Check the fingerprint inside the built-in mutation window using custom operations.
- Preserve Pi’s normal result schemas and mutation queue.
- Do not recursively acquire Pi’s same per-file queue around an already queued built-in.

Confirmed v1 shell-command policy:

- Require an exclusive **workspace lease**.
- Serialize shell execution against all source mutations.
- Do not classify apparently read-only commands as safe for concurrent execution.
- A workspace-lease request relinquishes the requester’s file claims before waiting, preventing lock-upgrade deadlocks.
- Waiting agents yield their execution slot.
- Pending workspace requests receive priority once current claims drain.
- Execute one command per lease, then release it.

After shell work, refresh workspace fingerprints and invalidate stale reads and verification.

This deliberately trades some shell parallelism for coherent shared-checkout changes. It does not make arbitrary shell execution safe against malicious or detached processes.

### 4. Interfaces, state, and lifecycle

#### 4.1 Commands

| Command | Behavior |
|---|---|
| `/swarm` | Open the dashboard. |
| `/swarm start <goal>` | Ask the main agent to prepare a structured launch request. |
| `/swarm pause` | Abort active assignments, stop scheduling, retain resumable state. |
| `/swarm resume` | User-authorized continuation of a paused run after reconciliation, without resetting limits. |
| `/swarm stop` | End execution and retain restartable history; release ownership only after safe settlement. Queued messages cannot restart the run. |
| `/swarm restart <run-id>` | Explicit user-authorized restart of a paused, stopped, completed, or failed run after validating saved state, ensuring prior execution has settled, retaining or reacquiring checkout ownership, and reconciling current files and interrupted work. Reset all limit allowances and enforcement counters using configured values; retain history and task progress. |
| `/swarm <agent-id>` | Open that agent’s transcript and assignment view. |

Do not claim another global shortcut in v1. Put pause and stop controls prominently in the dashboard and widget.

#### 4.2 Main-agent tools

| Tool | Inputs and behavior |
|---|---|
| `swarm_start` | Objective, acceptance criteria, scope paths/exclusions, model/thinking selection, and limits. Clarify ambiguity first; present one editable approval summary and resolve existing-change handling before dispatch. Approval authorizes autonomous investigation, decomposition, and execution within that agreement, without a second planning checkpoint. |
| `swarm_status` | Run summary, task board, generated specializations, workers, claims, limits, or bounded transcript tail. |
| `swarm_await` | Explicit run ID, optional task IDs, bounded timeout. Return completed, attention, paused, stopped, failed, or timeout. |
| `swarm_control` | Pause, stop, or steer within the approved objective. User redirection becomes durable shared guidance for every swarm agent, with affected tasks updated and conflicting work paused. Cannot authorize resume/restart, scope expansion, or raised limits. |

Starting requires a persisted owner session, supported execution backend, usable safety integration, and a successfully acquired workspace-owner lease.

#### 4.3 Worker collaboration tools

All worker specializations receive these tools:

| Tool | Contract |
|---|---|
| `swarm_task` | List, create, claim, update, or block tasks. Mutations require expected revisions. Child tasks reference an existing task and acceptance criteria. |
| `swarm_recruit` | Request a peer with a generated specialization and task-focused brief. Require a workload check and concrete recruitment justification, preferring an existing suitable specialist unless independent parallel work warrants another. Allow independently within user-approved run limits; require explicit user approval to exceed them. Distinguish approval-pending, registered, and queued outcomes. |
| `swarm_message` | Send a task-linked question, answer, handoff, or finding to another worker or the owner. |
| `swarm_files` | Acquire/release file claims or request a workspace lease. |
| `swarm_report` | Submit a candidate result, verification verdict, blocker, or yield checkpoint. |
| `swarm_status` | Inspect the same bounded coordination views available to the owner. |

Tool identities are bound by the runtime. Inputs cannot select an arbitrary sender or impersonate another worker.

Use TypeBox schemas and reject unsupported fields. Return structured result details alongside concise text. Throw for execution errors.

#### 4.4 Data model

Core records:

- **Run:** owner session, objective and scope revisions, criteria, canonical workspace identity, approved scope, tool snapshot, model choices, configured limits, state, execution-cycle ID, cancellation generation, and current shared-guidance revision.
- **Execution cycle:** cycle ID, restart authorization, running-time usage, per-task attempt counters, task-creation accounting, and references to retained historical usage. Pause/resume preserves these counters; an explicitly authorized restart resets allowances in a new cycle.
- **Task:** ID, parent, criteria, kind, dependencies, revision, owner, attempt, state, findings, candidate, review outcome.
- **Worker:** ID, label, generated specialization and brief, model, current assignment, session reference, activity and usage, and last received shared-guidance revision.
- **Claim:** normalized path or workspace, task, worker, assignment generation.
- **Message:** ID, sender, recipient, task, causal parent, hop count, payload, delivery state.
- **Verification receipt:** execution ID, assignment, command, actual exit code, workspace fingerprints, timestamps.
- **Event:** sequence, operation ID, actor, generation, validated state transition.

Run states:

`running/verifying → pausing → paused → running`

or:

`running/verifying/paused → stopping → stopped`

A paused, stopped, completed, or failed run may transition through user-authorized restart reconciliation back to `running`, using a fresh execution generation. Deny restart while another run owns the checkout, previous execution remains unsettled, or saved state is corrupted. Preserve completed tasks rather than replaying them; create or reopen relevant follow-up work and confirm any scope change. Preserve historical stop events and usage, but reset all limit allowances and enforcement counters for the new cycle, including task attempts and running time. Retained agents count against the agent ceiling, and carried-over unfinished tasks count against the new task allowance; completed historical tasks do not. Cancellation-generation changes alone never reset cycle budgets. Old queued actions and approvals are not replayed automatically.

Successful completion follows:

`running → verifying → completed`

Unrecoverable controller faults produce `failed`; outstanding work is never presented as completed.

Task states:

`ready → assigned → submitted → reviewing → done`

with explicit `blocked`, `interrupted`, `failed`, and `cancelled` outcomes.

Review tasks reference a submitted candidate directly, avoiding dependency cycles with the implementation task they review.

#### 4.5 Persistence

Confirmed: store runtime state in the user-selected project-local runtime directory, with a separate subdirectory for each run, through one layout module. Keep this state out of Git because conversations and coordination records can contain sensitive project information. Before creating state, verify the exclusion boundary and preserve existing ignore rules. The owner session references the run; code changes remain in the shared checkout rather than being restored from the journal.

Use:

- A versioned, append-only event journal as coordination truth.
- Pi-native sessions for worker conversations.
- A small owner-session entry linking to the run.
- Durable run ownership plus a live-controller lease enforcing one running or paused swarm per checkout across Pi sessions. A paused run retains its reservation even when its controller is no longer running. Distinguish the run reservation from controller liveness during recovery; do not treat process exit as permission to start a different run. Report an occupied workspace instead of silently taking over.

Commit each controller transition durably before acknowledging it or scheduling dependent work. Rebuild state by replaying validated events.

Use operation IDs to deduplicate retried controller requests. Do not claim exactly-once filesystem or shell execution.

A malformed journal, unknown schema version, or ambiguous owner lease fails closed. Do not silently reset state or automatically steal a stale lease. Crash recovery must surface the ownership issue for human resolution.

#### 4.6 Scheduling and limits

Confirmed: total agent identities and simultaneously active agents have separate limits. Waiting agents preserve context without occupying execution slots.

The defaults and policies below are confirmed; exact enforcement mechanisms remain implementation details. The active limit can be explicitly configured differently. Agent counts do not imply a spending cap or bypass workspace coordination.

| Limit | Default |
|---|---:|
| Concurrent worker assignments | 4 |
| Worker identities per run | 8 |
| Tasks per execution cycle | 100, including carried-over unfinished tasks; completed prior-cycle history does not consume the new allowance |
| Attempts per task per execution cycle, including the initial attempt | 3 |
| Model responses per assignment or cycle | No fixed count limit |
| Elapsed active time per execution cycle, including verification | 60 minutes |
| Peer-discussion escalation | Lack of task progress, not a fixed message/hop cutoff; detection mechanism pending |
| Monetary ceiling | Not provided in v1; usage/cost indicator only (confirmed) |

The launch confirmation exposes these values. Only the user can increase them.

Reuse idle workers when suitable. Review assignments must avoid workers that contributed to the candidate being reviewed.

Do not occupy execution slots while waiting for peer answers or file ownership. Workers yield and resume on relevant events.

Confirmed: record local blockers and pause only affected tasks while independent work continues. Agents ask relevant peers and can take other suitable tasks or wait without holding execution slots. Escalate decisions requiring user authorization rather than guessing. Run-wide blockers pause the swarm with a clear explanation, and repeated failed attempts escalate rather than retrying indefinitely.

Proposed mechanism, not yet confirmed: when ready work cannot advance, allow one diagnostic planning assignment. Repeated no-progress results pause the run with the concrete blockers instead of creating an unlimited replanning loop. The task-attempt limit is confirmed at three by default. Other escalation thresholds and the diagnostic-assignment mechanism remain proposed.

Confirmed: the 60-minute default duration measures elapsed wall-clock running time, excluding paused time, not summed agent time. At expiry, stop dispatching and use the agreed safe-pause behavior while preserving progress. Ask the user whether to authorize an extension; agents cannot extend their own run.

Non-monetary usage ceilings are checked before scheduling and between responses. Confirmed for v1: display cumulative usage and available provider-reported or estimated cost, but do not implement a monetary ceiling or automatic cost-triggered pause. The user may pause or stop at any time. Clearly mark unavailable pricing and delayed in-flight accounting; never present unknown cost as zero or the indicator as a billing guarantee.

#### 4.7 Messaging and wake behavior

Confirmed: use lack of task progress, not arbitrary message or hop counts, to identify repetitive discussion for escalation. Make unresolved questions and blockers explicit. Useful exchanges remain allowed within approved run limits; waiting recipients do not occupy execution slots. The detection mechanism still requires design and validation against productive discussions.

Persist messages before acknowledging them.

- Busy recipients receive ordinary peer messages at assignment boundaries. User redirection uses the stricter guidance-refresh rule below and must not wait for an entire assignment to finish.
- Waiting recipients become eligible for scheduling.
- Routine informational board updates do not wake every worker.
- User redirections are different: persist and deliver them swarm-wide, including to waiting agents before resumption and new recruits at creation. Ensure active agents receive current guidance before further task actions, pause conflicting work, and preserve pause/stop boundaries. Scope-changing redirections require a paused run and explicit confirmation.
- Messages carry provenance and remain task data, not new user authorization.
- Peer messages cannot change the root objective, tool set, scope, or limits.

Notify the main agent on execution-cycle completion or actionable attention, rather than every peer exchange. Confirmed: synthesize one final report against the objective, with key changes, decisions, recorded checks, independent review, and remaining issues. State clearly whether the run completed verification or stopped unfinished; leave changes for user inspection without automatic commit, push, or cleanup.

Deduplicate notification delivery by event ID. Keep final results queryable through `swarm_status` and `swarm_await`, even if an idle wake fails.

#### 4.8 Completion and verification

Confirmed: require independent review of source-changing work and verify the combined result before completing the swarm. Review findings return work for correction. A reviewer who edits becomes a contributor, requiring another independent reviewer for the revised candidate. Confirmed: record actual commands, exit statuses, and tested workspace state, require agents to reference that evidence, invalidate it after relevant changes, and block edits during final checks. Reviewers judge whether checks are meaningful. Exact receipt schema and fingerprint implementation below remain proposed implementation details.

A worker’s “done” report creates a **candidate**, not completion.

A source-changing task requires:

1. A recorded candidate and changed-file fingerprints.
2. Relevant verification receipts from actual command execution.
3. Review by a worker that did not contribute to that candidate.
4. No unresolved blocking findings.

Capture shell exit codes through `BashOperations.exec`; do not parse textual claims of successful tests.

At run completion:

- Drain active mutations and claims.
- Take an exclusive verification window.
- Run the final required checks against the shared state.
- Obtain an independent acceptance review.
- Confirm the workspace fingerprint remains current.

If verification changes source files, invalidate the candidate and repeat the necessary checks and review. Reviewers retain editing tools, but editing makes them contributors and disqualifies their approval of that revised candidate.

The controller validates evidence provenance and freshness. Reviewers assess whether tests and acceptance evidence are meaningful; an exit code alone is not proof of correctness.

#### 4.9 Pause, stop, reload, and recovery

Confirmed, revised: pause retains resumable context and checkout ownership. Stop ends execution and prevents queued reawakening, but retains history for explicit user-authorized restart. Release ownership only after execution safely settles. Restart is available from paused, stopped, completed, and failed states only after saved-state validation and safe settlement. It retains or reacquires ownership, reconciles current workspace changes and interrupted work, and establishes a fresh execution generation; reset all limit allowances and enforcement counters, including time and task-attempt budgets, using the configured values. Preserve historical usage, attempts, agent context, and completed work; count retained agents against the agent ceiling and carried-over unfinished tasks against the new task allowance, excluding completed historical tasks. Ordinary pause/resume does not reset limits. Old approvals and queued actions cannot authorize new execution. Neither operation undoes project changes. Incomplete termination must be reported and block new work until resolved. Confirmed recovery behavior: restore previously active runs paused, keep stopped/completed/failed states unchanged, and reconcile actual changes and interrupted commands before explicit resume or restart. Never blindly replay uncertain execution. Detailed lifecycle fencing below remains the proposed implementation.

Set the stop/pause latch and advance the generation **before** aborting sessions.

Every queued assignment, pending confirmation, tool wrapper, and callback checks that generation before acting.

- Clear scheduling eligibility immediately.
- Abort active SDK sessions and cancellable shell operations.
- Reject late state mutations from older generations.
- Release claims only after associated execution settles.
- Preserve unfinished outcomes as interrupted or uncertain.
- Never automatically replay an interrupted shell command.

Use a bounded shutdown wait. If execution does not settle, report **stop incomplete**, retain ownership fencing, and prohibit another run. Do not claim all activity stopped.

Reload, session replacement, and Pi exit tear down the controller. Resuming the same owner session restores previously active runs **paused**, never automatically running; stopped, completed, and failed runs retain their recorded states until explicitly restarted.

Forked sessions do not inherit control of the original swarm. Session-tree navigation pauses work; moving the conversation pointer must not rewind real filesystem changes.

### 5. Safety and compatibility

#### Safety integration

Add `swarm:confirm-request` to pi-safety using its existing request shape.

Swarm’s bridge:

- Fails closed when no provider claims.
- Uses a bounded timeout and cancellation.
- Rechecks generation and permissions after approval.
- Never interprets peer or main-agent messages as human confirmation.

Protect controller state and repository control metadata from direct worker file mutation; preserve existing host protections for shared configuration resources.

No automatic network service integration or publication is introduced. Additional providers or destinations require the applicable user authorization.

#### Restricted-mode integration

Add a small, versioned event-bus contract to pi-plan:

- `pi-plan:query-mode`
- `pi-plan:mode-changed`

Report selected mode, enforced mode, and transition status.

Swarm must:

- Reject launch/resume/restart in Discuss, Plan, or Quick.
- Pause immediately when a restricted mode is selected.
- Check mode before dispatch and before tool execution.
- Remain paused when Off is restored until explicitly resumed or restarted; restoration of mode alone does not authorize execution.

Do not add Swarm delegation tools to pi-plan’s restricted allowlists.

#### Compatibility boundaries

- Current minimum target: Pi 1.0.0, Node 22.19+, local Unix checkout with Git and Bash. Only Pi 1.0.0 is currently verified; revalidate newer versions. Earlier phase results below are historical.
- Use public package-root SDK imports only.
- v1 execution requires TUI confirmation; other modes may inspect stored status but fail closed on launch.
- Subagents and Teams retain their current behavior and definitions.
- Swarm coordinates its own members, not arbitrary pre-existing agents or external editors.
- Detect external drift where possible; never automatically undo it.
- Preserve unrelated activation settings and user modifications.

### 6. File changes

Under `packages/pi-swarm/`:

| Files | Responsibility and precedent |
|---|---|
| `package.json`, `README.md` | Package registration, commands, boundaries, recovery instructions; follow existing package manifests. |
| `extensions/swarm/index.ts` | Tool/command registration and lifecycle wiring; follow Teams entry structure. |
| `extensions/swarm/types.ts`, `core.ts` | Public contracts and deterministic controller. |
| `extensions/swarm/board.ts`, `scheduler.ts` | Task transitions, dependency validation, fair cancellable scheduling, limits. |
| `extensions/swarm/specializations.ts`, `context.ts` | Generated specialization briefs and focused worker context; no shared-library discovery or legacy role adaptation. |
| `extensions/swarm/runtime.ts` | SDK session construction, assignment driving, native compaction and authoritative-state refresh, telemetry, abort/dispose. |
| `extensions/swarm/mail.ts` | Durable messaging, correlation, bounded delivery, owner notifications. |
| `extensions/swarm/workspace.ts`, `verification.ts` | Claims, workspace leases, fingerprints, execution receipts, completion gates. |
| `extensions/swarm/tools.ts`, `coding-tools.ts` | TypeBox interfaces and identity-bound coding wrappers. |
| `extensions/swarm/store/layout.ts`, `journal.ts`, `lease.ts` | Project-local runtime paths and exclusion checks, durable event storage, ownership fencing. |
| `extensions/swarm/integrations/safety.ts`, `mode.ts` | Event-bus integrations without private cross-package imports. |
| `extensions/swarm/tui/tree.ts`, `dashboard.ts` | Compact activity tree, tasks, messages, claims, worker viewer and controls. |
| `test/e2e/env.mjs`, `run.sh`, `tsconfig.template.json` | Existing jiti/mock-provider harness pattern; no automatic dependency installation. |
| `test/e2e/*.mjs` | Focused state, runtime, concurrency, verification, recovery, integration, and rendering suites. |

Outside the package:

- `settings.json` and `agent/settings.json`: add package activation without normalizing unrelated fields.
- `scripts/validate-global-config.mjs`: update expected package count from 32 to 33 and add Swarm activation assertions.
- `MANIFEST.md`: add Swarm’s surface.
- `README.md`: distinguish Subagents, Teams, and Swarm.
- `packages/pi-safety/extensions/safety/index.ts`: register the new confirmation channel.
- `packages/pi-plan/extensions/plan/index.ts`: publish/query mode state.
- Corresponding safety/mode tests and package documentation.

Do not edit root `AGENTS.md`, production role definitions, or create additional reusable artifacts.

### 7. Risks and chosen tradeoffs

1. **Shared checkout conflicts:** mitigated by claims, fresh-read checks, exclusive shell leases, and final verification—not eliminated against external writers.
2. **Shell access is powerful:** runtime checks are coordination safeguards, not filesystem, credential, or network isolation.
3. **Specialization fragmentation:** overlapping specialists and excessive handoffs can duplicate investigation. Apply the confirmed workload-check and reuse-first policy while preserving focused contexts and enforcing user-approved recruitment limits. Resolve concurrent duplicate-recruitment prevention during implementation design.
4. **Confirmation overhead:** preserve existing safety policy; do not weaken it to make the swarm faster.
5. **Recovery ambiguity:** interrupted side effects and stale ownership require reconciliation, not blind retries.
6. **Provider/tool differences:** unsupported backends fail preflight rather than silently changing execution semantics.
7. **Existing configuration divergence:** capture baseline validation results and preserve unrelated differences. Do not expand implementation into configuration cleanup.

### 8. Verification sequence

#### Step 1 — Preflight

During implementation:

- Read applicable instructions again.
- Inspect Git status and preserve existing work.
- Capture baseline package and repository checks.
- Confirm SDK/tool provenance and supported runtime.
- Do not commit or push.

#### Step 2 — Pure state tests

Prove:

- Atomic claims and task revisions.
- Dependency-cycle rejection.
- Bounded recruitment and retries.
- Identity and generation fencing.
- Peer-message deduplication and causal tracking without arbitrary discussion cutoffs.
- Escalation of repetitive, non-progressing exchanges without misclassifying useful discussion; test the detection mechanism once designed.
- Journal replay and corruption rejection.
- No scope or budget expansion through worker tools.

#### Step 3 — SDK integration tests

Use deterministic mock providers with real sessions and temporary repositories.

Verify:

- Every generated specialization receives identical enabled tools.
- Swarm never discovers or reads global or project `.agents/subagents/` definitions.
- Generated briefs preserve relevant focus and context without changing permissions.
- Model/thinking defaults snapshot the main agent at launch; explicit swarm-wide overrides apply uniformly to all specialists.
- Later main-agent model changes do not silently alter the run, and workers cannot switch models.
- Per-specialist model selection is not enabled in v1.
- Agents create tasks, recruit peers, collaborate, and complete without main-agent relaying.
- All sessions use the same checkout and branch.
- Unsupported tool overrides fail before work starts.

#### Step 4 — Shared-workspace tests

Cover:

- Parallel disjoint edits.
- Conflicting claims and safe handoffs.
- Stale-read rejection.
- Existing user changes and staged content preservation.
- Shell/workspace exclusivity.
- Competing lease upgrades without deadlock.
- Symlink aliases and new-file races.
- External drift causing attention rather than rollback.

#### Step 5 — Completion and lifecycle tests

Cover:

- Native compaction retains the specialist identity and preserves focus, task context, rationale, and unresolved questions; durable task state and latest user guidance are reloaded before further work.
- Earlier peer history remains retrievable after compaction; stale summaries cannot override durable decisions.
- Final reports are not accepted before assignment settlement.
- Fabricated or stale verification IDs are rejected.
- Reviewer edits invalidate independent approval.
- Final shared-state tests and review are required.
- Stop while queued, streaming, confirming, acquiring claims, and finishing.
- Late approvals and messages cannot restart stopped work; only explicit user-authorized restart establishes a new execution generation.
- Explicit restart resets all limit allowances and enforcement counters, including running time and task attempts, while retaining histories, prior usage, agent contexts, and task progress. Retained agents and carried-over unfinished tasks count against their respective ceilings; completed prior-cycle tasks do not consume the new task allowance.
- Pause/resume does not reset limits. Restart works from paused, stopped, completed, and failed states, reconciles workspace changes without blindly replaying commands, and fails if another run owns the checkout, prior execution remains unsettled, or saved state is corrupted.
- Restart preserves completed tasks unless relevant follow-up work requires reopening them; scope expansion requires explicit confirmation.
- Reload restores previously active runs paused; stopped, completed, and failed states remain unchanged.
- Pause and cancellation-generation changes do not reset execution-cycle budgets. Only authorized restart does.
- Task-ceiling exhaustion blocks new tasks, not existing work; runtime expiry safely pauses, and cost alone never triggers a pause.
- User redirection reaches every specialist before further task actions, including busy workers, resumed workers, future recruits, and workers returning from compaction.
- Forks cannot control the original run.
- Interrupted shell execution is not replayed.
- Unsettled cancellation reports stop incomplete.

#### Step 6 — Integration and repository checks

Run, using installed tooling and disabling any harness auto-install fallback:

```bash
bash packages/pi-swarm/test/e2e/run.sh
bash packages/pi-subagents/test/e2e/run.sh
bash packages/pi-teams/test/e2e/run.sh
node scripts/validate-global-config.mjs
git diff --check
git status --short
```

Run the documented pi-plan and pi-safety suites as well.

Require explicit evidence that restricted-mode transitions pause an already-running swarm and that existing delegation confirmation channels remain unchanged.

#### Step 7 — Manual TUI acceptance

In a disposable project:

1. Start one objective.
2. Observe decomposition, recruitment, peer collaboration, and shared-checkout edits.
3. Inspect tasks, claims, messages, activity, tokens, and blockers.
4. Pause and resume after reconciliation.
5. Stop while work and messages are queued.
6. Confirm no queued work restarts.
7. Verify the final outcome includes current tests and independent review.
8. Reload Pi and confirm the package remains usable.

Test narrow terminals and theme changes without replacing the existing footer or editor.

#### Rollback

Pause or stop Swarm and verify settlement, then remove only its activation entries and reload Pi. Preserve project edits and runtime evidence. Do not delete worker output, restore the checkout, or modify Subagents/Teams state.

### 9. End-to-end behavior walkthrough

This example illustrates confirmed behavior, not a fixed team template or an implementation test result.

1. **Launch agreement:** the user requests account invitations. Clarify requirements, ask how to handle any existing uncommitted changes, and approve one summary covering the objective, acceptance criteria, scope, model/thinking, and limits. Defaults are eight total agents, four active, 60 minutes per execution cycle, three attempts per task, and 100 tasks per cycle.
2. **Organize work:** an initial planning agent investigates and creates tasks. It generates focused specialists as needed rather than loading role definitions. A database planner and builder may be separate if justified. Check existing specialists and their workloads before recruiting. Leave room for independent review or escalate capacity needs instead of bypassing limits.
3. **Collaborate:** agents claim board tasks, take peer requests, and discover follow-up work within the approved objective and their stable specializations. They may contact any swarm peer. Handoffs carry relevant decisions and reasons; detailed history remains available on demand.
4. **Change files safely:** all workers share one checkout and branch. Claim files before editing, reread after handoffs, and reject stale edits. Shell commands take exclusive workspace access; other edits and shell commands wait. These mechanisms do not lock out external editors or provide an operating-system sandbox.
5. **Respond to the user:** if the user says to reuse the existing email template, persist that redirection for every agent. Refresh guidance before further task actions, pause conflicting work, and confirm scope expansion if required. An unclear conflict blocks the affected task while unrelated safe work can continue.
6. **Handle interruptions:** pause retains ownership and allowances; resume continues after reconciliation. Stop settles execution and releases ownership while keeping history. Explicit restart from paused, stopped, completed, or failed state validates state and ownership, reconciles changes, and resets allowances without erasing progress or replaying completed work. Old queued messages cannot restart execution.
7. **Verify:** builders submit candidates with recorded check results. Independent reviewers assess correctness; a reviewer who edits needs another independent approval. Relevant changes invalidate prior evidence. Final checks run against a stable combined workspace with swarm edits blocked.
8. **Report:** present one consolidated result tied to the objective, with key decisions, recorded checks, review outcomes, and any remaining issues. Leave project changes for user inspection without automatic commits, pushes, or cleanup. Show usage/cost as an indicator, not a monetary cap.

The example illustrates the intended complete extension, not the current stage 1 implementation. Technical gaps listed in Decision status still require resolution before later stages or activation.

### 10. Stage 1 implementation and verification

The user authorized the deterministic controller, persistence, ownership, restart/budget accounting, and local simulated-agent tests only. Real model sessions, coding-tool execution, UI, activation, commits, and pushes remain outside this stage.

Implemented under `packages/pi-swarm/`:

- Native ESM foundation modules under `extensions/swarm/`, without a Pi registration entry point. This permits dependency-free Node testing; later TypeScript adapters can import the modules.
- A strict pure reducer for runs, worker identities, task ownership, dependencies, submissions, review bookkeeping, guidance revisions, and peer-message records.
- A serialized controller with revision checks, identity-bound worker capabilities, durable operation deduplication, and persist-before-publish ordering.
- Project-local runtime layout with an existing Git exclusion boundary required before state creation; private files/directories and rejection of unsafe aliases.
- Durable checkout reservation separate from the exclusive live-controller lock. Paused runs retain reservations; safely settled stopped/completed/failed controllers release ownership. No automatic stale-owner takeover.
- Sequence-linked checksummed journal records with synchronized writes, validated replay, and fail-closed behavior after uncertain writes or corruption.
- Separate execution-cycle budgets and cancellation generations. Restart resets time and task-attempt allowances while retaining history and completed tasks; pause/resume does not reset them. Carried unfinished tasks and retained identities count against their respective capacities.
- Explicit settlement: a worker report alone never releases an assignment slot or completes the run. Old-generation callbacks cannot mutate new execution. Recovery preserves interrupted stop/failure intent and does not charge the entire offline interval as runtime.

Verification command:

```bash
npm --prefix packages/pi-swarm test
```

Stage 1 has 58 passing deterministic tests, including cross-process ownership exclusion, partial-write and synchronization failures, corrupt replay, stale capabilities, paused reservations, restart accounting, guidance acknowledgments, and source/index preservation in disposable repositories. Syntax and whitespace checks also pass. These tests simulate review and verification inputs; they do not execute models, migrations, or real acceptance checks.

Implementation boundaries:

- `owner` and `system` controller methods are trusted host capabilities, not model-visible tools. User confirmation and actual settlement/verification evidence must be supplied by later adapters.
- Recruitment requires a current workload revision and justification, but semantic suitability and duplicate-specialist judgments remain deferred.
- Reviews are a task phase in the foundation, rather than separate review-task records. Real mutation provenance, verification receipts, and reviewer-edit handling remain deferred.
- Runtime deadlines are checked during dispatch and explicit host ticks. A future driver must schedule ticks and drive cancellation; no background runtime is installed here.
- Missing or corrupt owner state is not automatically repaired, and no force-recovery or history-cleanup command is shipped.
- Filesystem locks coordinate these controllers, not arbitrary shell commands or external editors. File-claim wrappers, shell leasing, SDK sessions, UI, compaction, mode/safety integration, and activation remain for later stages.

See `packages/pi-swarm/README.md` for the foundation API and its trust boundaries.

### 11. Phase 2 implementation and verification

The user selected **shared-workspace safety and verification** for phase 2: file claims, stale-edit checks, exclusive shell scheduling, cancellation/settlement, and verification evidence, tested in disposable repositories without model sessions. Swarm remains inactive. SDK sessions, UI, package activation, commits, and pushes were not authorized by this phase.

Implemented:

- Atomic all-or-nothing path claims with owner/blocker details, disjoint mutation concurrency, and pinned claims during active writes.
- FIFO exclusive workspace leases for every shell command. All queued requesters relinquish their own claims after their mutations settle, avoiding competing-upgrade deadlocks. Pending leases block new mutations/claims while existing work drains.
- Fresh-read fingerprints, exact multi-edit validation, protected path checks, conservative symlink/hardlink rejection, and revalidation on the opened file handle before mutation. No automatic rollback of user changes.
- A trusted-host `WorkspaceRuntime` adapter with assignment-bound worker operations, authorization denied by default, and context/permission checks after waiting or confirmation.
- Durable operation intent before side effects, actual command exit statuses, before/after workspace fingerprints, and evidence identifiers validated against assignment, cycle, generation, guidance, and result.
- Candidate submission and independent review gates. Rejected candidates cannot reuse earlier assignment evidence. Mutating reviewers become contributors and require another reviewer.
- Edit-blocked final checks; source-changing or unsuccessful checks cannot complete the run.
- Cooperative process-group cancellation. Unknown settlement pauses work and retains ownership until explicit trusted reconciliation; interrupted commands are never automatically replayed.

The combined dependency-free suite has **125 passing tests**: the 58 stage 1 tests plus scheduler, filesystem, shell, and integrated workspace coverage. It includes actual local Bash commands in disposable repositories, process-group cancellation, stale-file races, evidence invalidation, late authorization, interrupted mutation provenance, cross-task self-review prevention, and deadline settlement. A focused independent code review identified three contributor/submission issues; all were fixed, regression-tested, and checked in a follow-up review.

Conservative implementation decisions and remaining boundaries:

- Fingerprints currently cover the whole checkout, so any observed workspace change invalidates old evidence. Contribution tracking is correspondingly workspace-wide across tasks. This may require more re-verification and can exhaust independent-review capacity; never bypass review or configured limits to compensate.
- Unknown recovered operations are attributed to their worker even when their actual effects cannot be reconstructed. Reconciliation records uncertainty rather than inventing successful execution.
- The host must establish actual process settlement before attesting it. Neither process-group checks nor filesystem guards cover escaped daemons, hostile external writers, or side effects outside the checkout.
- Source-file I/O failures can leave partial changes. Preserve them for reconciliation; no automatic undo is attempted.
- Claims and scheduler state are in-memory; unresolved execution intent is durable. Old identities and read observations do not survive recovery as execution authority.
- The future Pi driver still owns periodic deadline ticks, session slot yielding, SDK tool result/mutation-queue integration, semantic scope checks, safety/mode bridges, and user confirmation/recovery UI. These are not activated by the standalone workspace adapter.

Run the same package test command shown in section 10. See the package README for the phase 2 API, settlement contract, and deferred work.

### 12. Phase 3 offline SDK integration

The user approved connecting generated specialists, persistent sessions, peer messaging, shared guidance, and lifecycle handling, using real Pi SDK sessions with deterministic mock providers. Live model execution, UI, activation, commits, and pushes remain excluded.

Implemented:

- A public-API SDK factory verified against Pi 0.85.1. A custom resource loader performs no automatic extension, skill, context, or specialist-definition discovery. Tool allowlists contain only the supplied wrappers.
- An explicit mock-provider/model-API gate. Model/thinking selection, supported coding-tool selection, and host-supplied instructions are captured durably and reused across specialists and recovery.
- Generated specialist prompts that retain focus and identity, with authoritative task/guidance/mail context refreshed before every prompt.
- Durable native session identities, validated private session files, synchronized initial headers and settled histories, and read-only history access through loaded session state. Corrupt or missing bound histories do not silently create replacement specialists.
- Uniform board, recruitment, mail, history, file-claim, and reporting tools, alongside guarded read/edit/write/bash wrappers. SDK edits/writes participate in the public native mutation queue; no owner/system lifecycle capability is model-visible.
- Peer-driven recruitment and waking, bounded active prompt/compaction turns, retained task ownership while a specialist is idle, and durable delivery records. Old-generation mail cannot restart a run.
- Native manual compaction without replacing specialist identity. Automatic compaction and automatic provider retries remain disabled in this phase.
- Shared-guidance fencing, periodic deadline ticks, SDK abort/idle handling, and settlement that waits for both session and workspace execution. Timeout returns stop/pause incomplete and retains ownership rather than claiming termination.
- Recovery intent for interrupted session turns, requiring explicit host reconciliation rather than replaying prompts or tool effects automatically.

Verification:

```bash
npm --prefix packages/pi-swarm test
npm --prefix packages/pi-swarm run test:foundation
```

The combined suite has **179 passing tests**. It exercises persistent real SDK sessions, mock tool execution, autonomous peer contact/recruitment, uniform tool sets, model selection stability, native compaction, guarded coding/reporting, retained idle ownership, streaming/tool cancellation, guidance admission races, and failed-turn attempt accounting. The bootstrap resolves installed public package exports and has no dependency-install fallback. No live provider was used.

Read-only review identified a guidance-admission race and a cancellation race during failed-turn accounting. Both were fixed and covered by regression tests. Syntax, whitespace, and inactive-package checks pass; existing repository configuration divergence and untracked additions still prevent a clean global validator result.

At the end of phase 3, remaining gates included host approval and safety/mode bridges; phase 4 below implements those protocols. Live-provider support, dirty-checkout launch UX, dashboard/recovery UX, semantic scope/duplicate-recruitment judgments, non-progress detection, automatic compaction policy, and freeing execution slots during still-running tool waits remain incomplete.

### 13. Phase 4 host approval and policy integration

The user authorized launch approval, explicit handling of existing changes, pi-safety/pi-plan bridges, and authorization checks for continuation and coding operations. Testing remains offline with mock providers. Live models, dashboard UI, Swarm activation, commits, and pushes remain excluded.

Implemented:

- A host approval facade presenting an editable launch specification and existing-change summary before creating run storage. Dirty checkouts require explicit preservation approval; workspace drift while awaiting a decision requires a new decision.
- Create-only launch semantics checked under the exclusive checkout lease, preventing a competing persisted run from substituting its scope for the approved one.
- Durable approval records and atomic approved resume/restart transitions. Continuation requires explicit reconciliation, unchanged scope, settled execution, and fresh mode authorization.
- Operation-wide cancellation across approval, controller acquisition, session wiring, and continuation. Pause/close cannot authorize a late launch or overlook a newly acquired controller.
- Authoritative pi-plan synchronous query and mode-change publication, including readiness, instance identity, context revision, selected mode, and enforced mode. Branch/reload/restriction events revoke admission synchronously; returning Off does not resume execution.
- A cancellable pi-safety Swarm confirmation channel using existing classification, policy, delay, and serialization behavior. Queued cancellation does not let later dialogs overlap; provider lifetime and policy changes invalidate outstanding approval.
- SDK and workspace admission checks at the final dispatch/side-effect boundaries, including after durable execution intent, not only at the beginning of confirmation.

Verification: **271 Swarm tests pass**, plus **66 pi-plan/pi-safety tests**. Coverage includes missing/multiple/malformed providers, restricted-mode transitions and ABA changes, queued/active confirmation cancellation, dirty-work decisions, edited approvals, scope substitution races, late controller acquisition, terminal-restart cleanup, and revocation between durable intent and shell execution. Review findings were fixed and covered by regressions. No actual human dialogs or live model providers were exercised.

The provider packages are modified, but Swarm remains unregistered. Reloading Pi applies provider changes only; it does not enable Swarm. Existing configuration divergence and untracked additions still prevent a clean global validator result; unrelated settings were preserved.

Remaining gates: user-facing approval/dashboard/recovery controls, host exposure of orphan/uncertain-execution reconciliation, live-provider support, semantic scope and duplicate-recruitment judgments, non-progress detection, automatic compaction policy, and active-slot release during live tool waits. Silent provider disappearance is detected on the next admission query; published restriction/shutdown events revoke immediately. These limits must be addressed before unattended live activation.

### 14. Phase 5 user-facing launch and recovery controls

The user authorized editable launch agreements and dirty-work preservation decisions;
status/pause/stop/resume/restart controls; explicit interrupted/uncertain-execution
reconciliation; and shutdown/reload/approval-cancellation tests. Implementation remains
mock-only and unregistered. No activation, dependency installation, live provider use,
commit, push, or parent-checkout modification was performed.

Implemented:

- `createSwarmExtension` is an explicitly injected factory, with no default export or
  activation entry. It rejects absent/live runtimes. Tests invoke the real factory with
  fake Pi UI contexts and real persistent SDK sessions using the existing mock provider.
- Native cancellable select/input/confirm dialogs present and edit the launch agreement,
  model/thinking/tools/instructions/limits, and existing changes. Criteria and scope are
  user-entered JSON arrays; individual agreement fields are editable as JSON. Dirty work
  requires explicit preservation. Nothing stashes, resets, stages, commits, or rolls back.
- The opt-in `/swarm` menu and commands expose start, status, pause, stop, restore,
  resume, restart, and reconcile. A mock SDK planner begins approved decomposition;
  continuation wakes retained specialists only after fresh human approval.
- A session-owned run link supports paused restore after reload, without restoring
  execution authority. Forks cannot inherit control. Tree/switch/fork preflights pause
  work and cancel navigation if settlement is incomplete. Shutdown cancels decisions and
  waits for controller acquisition, recruitment/session preparation, and SDK/tool settlement.
- The host exposes reconciliation without exposing owner/system capabilities to models.
  A human callback must supply a named user-established-settlement attestation and written
  evidence, not a bare boolean. Exact unresolved IDs and workspace fingerprint are recorded
  durably before any lease release. Revision/workspace drift and cancellation deny stale
  decisions. Live uncertain operations must unwind normally after attestation; ordinary
  active turns cannot be treated as orphans. Orphan outcomes remain unknown/interrupted.
- Incomplete close retains ownership and allows host reconciliation/retry rather than
  permanently aborting the host lifetime first. Concurrent closes share cleanup work.
  No stale lock is stolen or cleared automatically.

Verified offline:

- **304 Swarm tests pass**: the prior 271 plus 33 new factory/recovery tests. New cases cover
  edited launch agreement, preservation cancellation, all authorizing non-TUI modes denied,
  approval cancellation/late answers, field-input cancellation, actual streaming SDK abort,
  reload restoration, resume/restart cycle accounting, fork isolation, late controller and
  recruitment acquisition, SDK tool safety-confirmation cancellation, native approval timeouts,
  cancellable agreement editing, live uncertain shell evidence, orphan reconciliation, malformed
  attestations, workspace/revision/cancellation races, and incomplete-close ownership.
- **66 pi-plan/pi-safety tests pass**, using the installed SDK resolution preloaders from
  both Swarm and Safety (the Safety-only resolver does not resolve Plan's additional peers).
- The global validator still reports the pre-existing model/thinking default mismatch and
  new untracked phase-5 files; no unrelated defaults were normalized. Changes remain uncommitted.
- Package test command remains the one in section 10. No dependencies were installed and
  no live provider or interactive Pi activation was used.

Verified limitations and remaining gates:

- The current menu/on-demand structured status is not the planned continuously refreshed
  activity tree/dashboard or transcript viewer. Usage is explicitly not aggregated; cost
  is unknown. Native rendering, narrow terminals, theme interaction, and actual human
  dialogs require later interactive acceptance.
- Native multiline editing has no cancellation-signal contract, so this phase uses native
  cancellable field inputs instead. Invalid/ambiguous agreement values fail validation;
  no live model clarification or semantic scope proof is claimed.
- User attestation is an explicit trust boundary, not process-death detection. Escaped
  daemons, external effects, corrupted storage, lost journal tails, power loss, and stale
  controller locks remain outside verified recovery. A teardown after incomplete shutdown
  can leave ownership fenced; a new instance cannot bypass that lock. A shutdown before
  persisting the owner link requires explicit restore by run ID.
- Restore and reconciliation still require the ready authoritative Off-mode provider.
  Silent provider disappearance is detected on the next admission query; published mode
  changes revoke immediately. No mode bypass or inferred settlement was introduced.
- Live provider support, native tool presentation parity, scope revision, semantic
  recruitment/non-progress judgments, automatic compaction policy, yielding during live
  tool waits, and activation remain deferred. Preserve current user files and runtime evidence.

### 15. Phase 6 isolated interactive acceptance

The user authorized explicitly loading the mock-only factory in a disposable Pi terminal
session, exercising native controls and lifecycle/recovery, and fixing any demonstrated
issues. Global activation, live providers, installation, commits, and pushes remain excluded.
Existing uncommitted phase-5 work was preserved.

Implemented `test/terminal/run.py` and `test/terminal/fixture.ts` in the Swarm package.
The Python standard-library PTY launches the installed Node-based CLI with an explicit
extension path, a minimal environment, disposable HOME/config/project, disabled resource
and context discovery, and offline startup. The fixture verifies `getAgentDir()` against
`PI_CODING_AGENT_DIR`. No personal settings or credentials are copied. Cleanup waits for
confirmed child exit and removes only its disposable fixture. Review hardened closed-PTY
and exit/signal races with bounded TERM/KILL waits and guaranteed PTY closure; unconfirmed
exit retains evidence. Four deterministic cleanup regressions pass. There is no installation fallback.

Run from the repository root:

```bash
python3 packages/pi-swarm/test/terminal/run.py
```

Verified against installed Pi 0.85.1 using actual terminal input/output:

- Cancel initial input with Escape: no run storage or worker execution.
- Resize to 60 columns / 24 rows; supply criteria/scope, edit the objective in the native
  input, approve the agreement, and choose preservation of existing dirty work.
- Start an actual streaming deterministic SDK worker, pause and observe abort; authorize
  resume through agreement, preservation, and workspace-reconciliation confirmation.
- Reload during streaming; observe abort and paused restoration without automatic model
  dispatch. Resize to 100 columns / 40 rows, switch to built-in light, open/cancel the menu.
- Explicitly resume and stop during streaming, observing abort and no spontaneous restart.
- Explicit restart and a native shell-permission confirmation for a test runner returning
  uncertainty without spawning a process. Enter settlement evidence and confirm attestation;
  wait for real SDK/tool frames to unwind, then verify paused/stopped status.
- Replay durable journal events through the reducer: assert the edited objective and approved
  criteria/scope, resumes retaining cycle 1 and allowances, and restart producing cycle 2,
  zero elapsed time/task consumption, archived prior usage, and subsequent new-cycle task
  consumption. Also assert one attestation, one unknown receipt, one execution intent with
  no replay, and no completed outcome. Original fixture content remains unchanged.

Verification: **304 Swarm tests and 66 Plan/Safety tests pass**, plus the separate PTY
scenario. No production defect required a fix; production phase-5 modules were not edited.
The repository validator retains its existing model/thinking mismatch and additionally
lists the intentionally untracked implementation/test files; unrelated defaults are untouched.

Limitations: this is automated native-dialog keyboard acceptance, not human sign-off or
pixel/viewport validation. Assertions inspect emitted ANSI/text and durable records; long
summaries still use terminal scrollback. The fixture supplies a **test-only Off-mode publisher
and shell-confirmation provider**, not production Plan/Safety terminal integration. Its
uncertain operation is simulated; written attestation is not proof of real process death.
Human readability/contrast, IME/mouse, other terminal emulators, full live dashboard/usage,
live model quality, network operations, stale-owner takeover, and crash/power-loss recovery
remain unverified/deferred. No claim of full product acceptance or activation is made.

### 16. Phase 7 mock-only live dashboard

The user authorized a continuously refreshed native dashboard and offline verification, not
live providers, global activation, installation, commits, or pushes. Implemented a minimal
useful first version in `extensions/swarm/dashboard.mjs`; richer visualization remains gated.

Implemented:

- `/swarm` and `/swarm dashboard` now open a theme-aware native custom component with
  500 ms snapshot refresh. Overview shows objective/status, cycle/revision, recorded active
  time, actual capacity observations, approved limits, scope/criteria, and prior-cycle records.
- Worker focus/brief and task ownership with active SDK turn/queued/idle states; task/review,
  claims/blockers/unresolved execution, and peer-message pages. Selecting a worker opens
  persisted native history, including compactions. Scrolling reaches all entries, not a
  fixed conversation tail. No model-response/message cap or new execution policy was added.
- Prominent pause/stop keys and status-appropriate resume/restart plus reconciliation.
  Actions return to the existing owner-session command/host gates after dashboard disposal;
  human approval remains mandatory for continuation and reconciliation.
- Read-only snapshot/history capabilities only. Host history validates the bound private
  native session and returns detached entries without constructing a worker session or
  dispatching anything. Opening/closing inspection grants no authority and does not pause.
- Idempotent timer/abort-listener cleanup on close, action, failure, tree/switch/fork, shutdown,
  and reload. Swarm safety requests explicitly await dashboard dismissal before presenting
  approval; opening inspection during pending approval fails closed. This is necessary because
  Pi UI prompt events are asynchronous/best-effort and nested prompts are coalesced.
- Untrusted terminal controls/bidi overrides are visibly escaped; rendered lines are bounded
  through public Pi TUI width/wrap utilities. No private cross-package imports, footer/editor
  replacement, new global shortcut, settings edit, or activation entry was introduced.

Verified against installed Pi 0.85.1:

- **325 Swarm tests pass**: prior 304 plus 21 deterministic component/fake-UI/host tests.
  Added coverage includes timer refresh and disposal, all views at 1–100 columns with long
  Unicode/control strings, full-history navigation past 100 entries, safe read errors,
  native identity corruption, owner-session denial, lifecycle closure, and dialog exclusion.
- **66 Plan/Safety tests** and **4 terminal cleanup regressions** pass unchanged.
- Extended **real CLI PTY acceptance passes**: repeated durable-time repaint without input;
  worker/history navigation and pause at 60 columns; light-theme dashboard resume via native
  approval; stop while streaming. Existing cancellation, reload, restart/cycle accounting,
  dirty-work preservation, and uncertain-operation attestation scenarios still pass.
- Repository validator reports the pre-existing model/thinking mismatch plus the two new
  intentionally untracked source/test files. Unrelated settings remain untouched.

Scope/limitations:

- Usage is explicitly **not aggregated**, cost **unknown**, and persisted history can lag
  in-flight output. No synthetic token/cost total, context-fill claim, or billing guarantee
  is presented. Detailed tool/stream telemetry and reliable cumulative usage remain deferred.
- This is a paged inspection console, not the full activity-tree/rich conversation design:
  no persistent widget, chat bubbles, search, live partial transcript, or guidance editing.
  Task/review/claim/mail/history details use structured text. Host ticks drive recorded time.
- Selected history is fully validated/read in memory on worker/revision changes; very large
  history performance is unverified. Pagination limits the viewport, not retained evidence
  or model discussion. No history deletion/cleanup policy was introduced.
- PTY checks emitted text, not pixel/viewport fidelity or human readability/contrast. Production
  Plan/Safety terminal rendering, IME/mouse, other terminals, and arbitrary third-party custom
  UI concurrency are not validated. Swarm-owned approval exclusion is explicitly tested.
- Prior live-provider, semantic scope/progress, workspace/process settlement, stale-lock,
  crash/power-loss, and activation gates remain unchanged. This phase is not full product
  acceptance; project changes and runtime evidence remain preserved.

### 17. Phase 8 production Plan/Safety terminal integration

The user authorized production policy-provider acceptance together with deterministic mock
Swarm SDK sessions, real terminal dialogs, mode transitions, cancellation, reload, and shutdown.
Live providers, global activation, dependency installation, settings normalization, commits,
pushes, and parent-checkout changes remain excluded. Work began from clean `727559b` on
`feat/pi-swarm`.

Added `test/terminal/production.py`, `production-fixture.ts`, and `assert-production.mjs`.
The test-only composition explicitly calls the actual pi-plan and pi-safety factories beside
Swarm's injected mock-only factory. No synthetic mode publisher or safety provider is used
in this scenario, and production Swarm gains no cross-package private imports. The earlier
Phase 6/7 PTY scenario remains intact. Both reuse its existing bounded TERM/KILL and confirmed
child-exit cleanup guard; no dependency-install fallback is introduced.

Run from the repository root:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 packages/pi-swarm/test/terminal/production.py
```

Verified with installed Pi 0.85.1, Node, Python's standard-library PTY, and disposable Git:

- Production safety serialization of three public-channel requests: cancel the queued second
  request without opening UI, cancel the active first dialog, then deny the third. Repeat
  after native reload to verify exactly one provider claim. These are test-only requesters;
  Swarm's exclusive shell leases deliberately do not generate parallel shell confirmations.
- Select Discuss using production Shift+Tab during launch approval. The native dialog cancels
  without run storage or worker dispatch. Return Off, approve a fresh launch, and explicitly
  preserve the fixture's pre-existing dirty work.
- Actual main CLI mock turns exercise Off→Quick and Quick→Off before settlement. Observations
  show selected/enforced differences and pending transitions. Swarm pauses on restriction,
  denies resume when Off is selected but Quick is still enforced, and never auto-resumes on
  returning Off. Plan denies both resume and restart; its return Off also grants no authority.
- Explicitly resumed real SDK workers create/claim tasks and request benign `node -e` shell
  commands. A held mock response lets the dashboard open first, then verifies dismissal before
  production Safety's custom dialog. Approve one command, deny another, and select Discuss
  during a third confirmation to revoke it without execution.
- Native `/reload` during streaming aborts work, replaces the production mode instance, and
  restores paused without model dispatch. Native CLI SIGTERM shutdown during worker safety
  confirmation dismisses UI and settles SDK frames/assignments before the child exits.
- Replay every durable event through the reducer: five explicit resumes keep cycle 1 and
  consumed allowances; one shell intent/receipt succeeds with actual exit 0 and unchanged
  checkout fingerprint; denied/cancelled commands have no execution records. Native worker
  history records actual approved stdout plus three failed/cancelled tool results. Final
  state is paused, not completed, with no unresolved operation, turn, or assignment.
- Observe native dialog methods without substituting their behavior: open/close records are
  balanced, production Safety opens exactly the expected eight dialogs, and no observed
  dialogs overlap. The cancelled queue position never appears in terminal output.
- Minimal environment, ephemeral HOME/agent/project, no copied credentials, unchanged dirty
  fixture content, empty auth state, and audit argument omission are asserted. The native CLI
  adds only changelog-version bookkeeping to the disposable settings; host settings are untouched.

Verification: **325 Swarm tests**, **66 provider tests**, **4 cleanup regressions**, and
**both real CLI PTY scenarios** pass. No production defect was exposed and no production
implementation fix was needed. The baseline repository validator reported only its existing
model/thinking default mismatch. Final validation also lists the three intentionally untracked
Phase 8 test files; changes remain uncommitted and unrelated defaults remain unchanged.

Limitations and remaining gates:

- This is automated native keyboard/ANSI plus durable-record acceptance, not human visual
  sign-off, pixel/viewport validation, or general third-party modal arbitration. The scripted
  main provider intentionally delays abort completion briefly to expose pending enforcement.
- Public-channel queue probes do not execute commands; actual worker execution is separately
  evidenced by the shell receipt and native history. Dangerous/destructive/network categories
  and their delayed or multi-step dialogs were not terminal-exercised. No live keys/models,
  network commands, or arbitrary side effects are needed for these checks.
- Shutdown settlement does not prove termination of escaped daemons or external processes.
  Crash/power-loss recovery, stale-owner takeover, other terminals, IME/mouse, human contrast
  judgment, semantic scope/progress, usage aggregation, and activation remain deferred.
- Test fixtures are removed only after confirmed CLI exit, as before. No persistent personal
  configuration or global activation is needed to rerun this acceptance.

### 18. Phase 9 offline provider-agreement readiness

Implemented configuration/approval readiness without enabling live execution. The existing
SDK mock gate remains before model lookup; there is no generic trusted-runtime bypass.
Work began from clean `02b5106` on `feat/pi-swarm`; no activation, credentials, network,
installation, settings changes, commits, or pushes are involved.

Implemented boundaries:

- `provider-capability.mjs` defines a strict versioned descriptor binding provider, model,
  API, endpoint, transport, and the complete declared context-data scope. Host construction
  copies/freezes it and brands the capability in a private WeakMap. Serialized descriptors,
  worker data, or approval answers cannot substitute a capability or mint human approval.
- The optional host/factory capability path checks exact mock identity/endpoint and rejects
  model headers, compatibility routing, and sampling payload overrides. Provider and runtime
  method identity are captured; replacement fails on the next admission, revokes the permit,
  and requests pause. This is not a sandbox against arbitrary trusted JavaScript/closures.
- Native approval displays the immutable provider agreement separately from editable scope.
  Every successful launch/resume/restart records it alongside a fresh human approval ID.
  Pure replay rejects removal/replacement. Restore requires a matching host-created capability
  but never restores execution authority. Existing mode/session/lifecycle gates revoke permits;
  returning Off or restoring old metadata does not authorize work.
- `scripted-memory` uses the existing deterministic mock SDK integration only. Its complete
  context scope names objective/guidance, host instructions, workspace content, tool
  definitions/results, histories, peer messages, and compaction summaries. This declaration
  is disclosure, not content filtering/redaction; in this transport it remains in process.
- `https-unsupported` permits pure descriptor validation with a canonical HTTPS endpoint,
  excluding credentials/query/fragment. Host execution rejects with `UNSUPPORTED_TRANSPORT`
  before any runtime method, approval prompt, or run storage. No real transport is shipped.
  Existing callers without a capability retain their legacy mock-only behavior.

Verification with installed SDK and disposable fixtures:

- **335 Swarm tests** (325 prior + 10 new) pass. New tests cover strict/immutable/forged
  descriptors, complete scope, model/API/endpoint/header/routing/sampling substitutions,
  implementation replacement, durable launch/resume/restart approval, cancellation,
  mode revocation, paused recovery, missing restore capability, and unsupported live preflight.
- Real SDK scripted host integration runs under a test-process network guard over fetch,
  sockets, TLS, HTTP(S), and common DNS APIs, asserting zero attempted network calls. It is
  not an OS sandbox and does not certify arbitrary callbacks or external processes.
- **66 Plan/Safety tests**, **4 PTY cleanup regressions**, and **both existing real CLI PTY
  scenarios** pass. PTYs exercise the unchanged legacy mock-only path, not a live transport
  or new capability-specific terminal acceptance.
- `git diff --check` passes. Global validation retains the pre-existing model/thinking default
  mismatch and reports the two intentionally untracked new phase-9 files. Defaults are
  preserved and changes remain unstaged/uncommitted.

Remaining real-transport gate:

The SDK may resolve ambient credentials, OAuth refresh, provider/catalog overrides, proxies,
provider environment, and request sampling fields (including model substitution). A frozen
agreement cannot constrain that machinery. Real integration therefore remains unsupported,
not "ready for live use." A future separately authorized adapter must own explicit auth,
actual destination/payload validation, redirect/fallback policy, cancellation and per-request
fencing across follow-ups/compaction/retries, plus transport-level offline acceptance before
an authorized live trial. No relaxation of the SDK or extension mock gate is justified by
these tests. All prior semantic scope/progress, usage/UI, process-settlement, stale-lock,
crash/power-loss, and activation limitations remain in force.

### 19. Phase 10 constrained transport adapter, offline only

Implemented the separately branded `https-chat-completions` path without enabling any
built-in network client or changing activation. Phase 9 uncommitted work is preserved.
The new async `createConstrainedRuntime` takes an explicit immutable provider capability,
literal in-memory credential, trusted offline transport callback, and bounded request timeout.
No provider destination is selected by default. The exact HTTPS `/chat/completions` URL,
provider/model, `openai-completions` API and complete context disclosure are required inputs.
`https-unsupported` remains fail-closed and cannot silently become supported. Legacy mock
callers remain unchanged.

Implemented contract:

- A frozen SDK-compatible runtime facade avoids `ModelRuntime.create()`, provider registration,
  ambient credentials/environment, OAuth, catalogs, proxy discovery, compatibility routing,
  and request overrides. Only public package exports are used; lazy SDK loading preserves
  the SDK-free pure reducer/foundation suite. Serialized runtimes cannot recover a credential
  or reproduce the private brand. Credential state never enters the approval/journal/model.
- One bounded request builder serves stream, streamSimple, complete and completeSimple.
  It fixes the model and exact URL, POST, JSON/SSE headers and literal Bearer authentication.
  It serializes text context and function calls/results only. SDK payload/header/response
  hooks are inert; auth/environment/header/fetch/sampling/metadata overrides fail closed.
  No retries, fallback, redirects, affinity IDs, attribution or telemetry are forwarded.
- Strict bounded SSE parsing accepts chunked UTF-8, text and fragmented function arguments.
  It requires one choice, a supported finish reason and `[DONE]`, checks declared model,
  validates tool IDs/names/object arguments, and publishes only after complete validation.
  Status errors, redirect responses, malformed/truncated/unsupported responses and arbitrary
  thrown values yield fixed sanitized errors. Error text is safe for native SDK persistence.
- Host/factory/driver/SDK gates accept only the matching branded adapter with thinking Off.
  Launch records the approved provider agreement before configuring non-mock sessions, but
  still grants execution only after wiring and final approval/workspace checks. Pure replay
  requires that recorded agreement for non-mock model selection.
- Each worker SDK receives a separate request-admission binding. Every request durably checks
  elapsed run time, verifies fresh host/mode/turn/cycle/generation/guidance admission directly
  before dispatch, and rechecks before response publication. Signals combine SDK, host/turn,
  and request-deadline cancellation; host ticks abort active requests at the run deadline.
  Native manual compaction uses the same stream path and explicitly aborts compaction as well
  as the session. A transport ignoring abort retains its turn/ownership until actual settlement.

Verification with installed Pi SDK 0.85.1 and disposable fixtures:

- **361 Swarm tests**: 335 previous tests plus **26 new adapter regressions**. New tests run
  under the shared test-process network guard and assert zero fetch/socket/TLS/HTTP(S)/DNS
  attempts. Tests cover immutable exact request construction, all four stream/complete paths,
  forged/substituted bindings, forbidden overrides, UTF-8/SSE/function-call round trips,
  status/redirect/protocol/size/model errors, sanitized persistence, request and run deadlines,
  request-construction/response revocation, mode cancellation and non-renewal of approval.
- Real SDK host tests prove tool follow-up requests, native manual compaction, paused restore
  and fresh approval. Compaction cancellation deliberately uses an uncooperative transport:
  pause reports incomplete settlement and retains the durable turn until release, then stores
  no cancelled summary. Provider errors are not echoed into native history or host state.
- **155 SDK-free foundation tests**, **66 Plan/Safety regressions**, **4 cleanup regressions**,
  and **both real CLI PTY scenarios** pass. PTYs still exercise the unchanged legacy mock path,
  not actual network transport or new-provider terminal acceptance.
- `git diff --check` passes. Global validation retains the pre-existing model/thinking
  default mismatch and reports five intentionally untracked phase-9/10 source/test files.
  No settings are normalized and no files are staged.

Exact limitations and remaining gate:

The injected transport is a trusted offline seam, not a constrained OS process or general
network authorization. It must honor the frozen request, abort/cleanup and actual-settlement
contract. No actual Node HTTPS implementation is included; no HTTP client or live provider
was invoked. A future real client needs separate explicit host egress authorization and
transport-level verification of direct HTTPS, no ambient proxies/credentials, redirects,
retries, fallback or routing before any independently authorized live trial. Arbitrary
injected JavaScript cannot be certified by this adapter's tests.

Supported protocol is text/function-call Chat Completions only: no reasoning, images,
Responses API, WebSockets, deferred work, alternate authentication, provider-specific fields,
usage-only SSE frames or broad compatibility promises. Responses are buffered before SDK
content events. Requests/responses are limited to 4 MiB, 64 calls and 8192 output tokens;
32768 context capacity is fixed conservative metadata. Usage/cost remain unknown; SDK zero
counters/prices are placeholders, not measurements. Existing semantic-scope, UI, process
escape, recovery, stale-lock, crash/power-loss and activation gates remain unchanged.
The package README documents the constructor, callback contract and these limitations.
No credential access, remote transmission, dependency install, settings change, global
activation, commit or push is part of this phase. Changes remain uncommitted for review.

### 20. Phase 11 explicit Node HTTPS transport, loopback acceptance only

Implemented actual HTTPS behind a separate branded host egress authorization. Phase 9/10
pending edits remain preserved and uncommitted. No real-provider trial, external network,
real credentials, dependency installation, settings changes, global activation, commit or push
was authorized or performed. There is still no default remote endpoint or automatic upgrade;
a future trial must explicitly supply an authorized descriptor, endpoint/model and credential.

Implemented boundaries:

- `https-transport.mjs` adds `authorizeHttpsEgress`, `createHttpsTransport`, and a separate
  `authorizeLoopbackHttpsTest` policy. Authorizations bind the exact immutable capability
  identity, HTTPS origin/path and model. Forged/serialized/substituted capabilities and extra
  options fail closed. These host APIs attest separate egress permission; they do not mint
  human run approval or become worker-visible tools. Constructors perform no network work.
- Production dispatch resolves only IPv4 through Node OS lookup, rejects every special-use/
  private/loopback/link-local/documentation/multicast/reserved answer conservatively (including
  mixed answer sets), and pins one permitted address without another lookup or fallback.
  TLS/Host retain the approved hostname. The OS resolver can use hosts files or external DNS;
  this is not DNSSEC, provider identity attestation, or protection against privileged routing.
  IPv6-only and private providers remain unsupported. No real external DNS was used in tests.
- Each request owns an isolated non-pooling Node HTTPS agent with session caching disabled,
  explicit Node built-in roots, strict chain/hostname verification and TLS 1.2 minimum.
  No proxy-environment/global-agent routing, ambient auth/extra trust roots, alternate headers,
  retries, redirects, fallback, model substitution or generic SDK provider composition is used.
  Header/body limits remain explicit; credentials exist only in private runtime memory and
  the transient approved request. Fixed sanitized errors enter SDK histories, never raw errors.
- Every request checks current host/turn admission and combined abort/deadline signal after
  DNS and immediately before dispatch. The adapter now privately recognizes branded request
  settlement records: status/parser failure, cancellation and normal completion all wait for
  actual ClientRequest and socket close before terminal SDK publication. Arbitrary injected
  callback/response properties cannot forge this transport-settlement contract. Final
  admission is rechecked after settlement with no await before publication.
- Loopback policy is explicit and separate: exact localhost/loopback IPv4 URL with explicit
  port, pinned loopback socket, supplied ephemeral self-signed CA only, normal strict TLS and
  hostname verification. It cannot authorize a remote host, silently change trust roots or
  bypass the production public-address gate. Legacy mock/offline paths and `https-unsupported`
  remain unchanged; callback injection does not inherit built-in socket-settlement guarantees.
- `test/tls-fixture.mjs` is a test-only minimal DER generator using Node crypto: fresh RSA-2048
  CA/leaf keys, SHA-256 signatures, random serials, short validity, CA/basic/key-usage constraints,
  serverAuth and localhost/IP SANs. Nothing is written to disk. `X509Certificate` checks
  signatures, CA status, validity, SAN and private-key match; actual TLS validates trusted
  success and rejects wrong-name/untrusted chains. This is not a reusable production PKI API.

Verification with Node 22 and installed Pi SDK 0.85.1:

- Baseline **361/361** Swarm tests passed before implementation. Final **384/384** pass,
  adding **23 HTTPS/DNS/SDK regressions**. **155 SDK-free foundation**, **66 Plan/Safety**,
  **4 cleanup tests**, and **both existing real CLI PTY scenarios** pass. The policy run uses
  Swarm's installed-SDK resolver (the narrower Safety resolver alone does not resolve typebox).
- Actual loopback HTTPS covers exact headers/path/model, fragmented UTF-8/SSE, redirect,
  malformed/model-substituted response, certificate mismatch/untrusted CA, credential-safe
  errors/history, slow headers/body cancellation and deadline, and socket close before result.
  Proxy environment/global-agent routing are exercised without contacting their destinations.
- Real SDK requests prove tool follow-ups, native compaction, mode revocation during prompt
  and compaction, no automatic renewal on returning Off, and paused restore with fresh approval.
  Stubbed production DNS covers private/mixed/empty rejection, final post-lookup admission,
  and unsettled cancellation while an OS-style lookup remains outstanding. All other network
  entry points in the test guard are denied; only the fixture's loopback port is allowed.
  This guard is defense in depth, not an OS firewall. PTYs remain mock-only regressions.
- `git diff --check` passes. The global validator reports the existing model/thinking default
  mismatch and eight intentionally untracked phase-9–11 source/test files. Nothing is staged
  and no defaults were normalized. README documents exact APIs, trust boundaries and limits.

Remaining limits and gate:

Node OS lookup is not cancellable; outstanding resolution retains request/turn ownership until
it returns, at which point cancellation fences connection. Pause timeout cannot fabricate
settlement. Timers require a responsive event loop. Actual local socket closure is not proof
of remote cancellation, rollback, absence of transmitted bytes, external process death or
crash/power-loss safety. Arbitrary trusted JavaScript, OS routing and privileged environment
remain outside this cooperative boundary. Remote TLS/provider compatibility and usefulness
have not been validated, and no human visual acceptance or activation readiness is claimed.
The earlier text/function-call subset, unknown usage/cost, fixed context metadata, scope/progress,
UI, recovery and stale-owner limitations remain. A live trial needs separate explicit user
permission and explicit endpoint/model/credential inputs; none are selected or recovered here.

### 21. Phase 12 combined offline hardening — passed on Pi 1.0.0

The user explicitly authorized migration to the installed Pi 1.0.0 contract, then completion
of combined Node HTTPS/constrained SDK/production Plan/Safety/native terminal acceptance.
Existing phase-12 work was preserved. No external provider, real credential, dependency
installation, activation, settings change, commit or push was performed.

Implemented and verified:

- HTTPS agreement/dashboard labels disclose declared context transmission to the exact
  endpoint rather than claiming in-memory-only mock execution. Usage/cost stay unknown;
  five disclosure regressions cover both transport paths.
- The constrained adapter uses public Pi AI transcript normalization and rendering helpers.
  Structured leading system content/sections and subsequent section changes retain their
  chronological positions and roles. User/tool text is not escalated to system authority.
  Ordered tool additions/removals control request declarations and response-call validation;
  historical tool calls/results remain intact. Unsupported system content fails before I/O.
- Native-session validation now covers structured system messages, compaction checkpoints,
  retain-none boundaries and content-only context edits. Native SessionManager still owns
  active-branch projection; raw history is preserved. The old validator rejected new system
  entries during synchronization, preventing durable turn retirement and appearing to be an
  idle/settlement regression. No abort-equals-settled shortcut or lifecycle weakening was needed.
- Six new Pi1 regressions cover ordered systems/sections/tools, removed-tool response denial,
  unsupported system/reset rejection, native history corruption, branch edits/retain-none
  compaction, and an uncooperative provider that keeps abort/idle promises pending until
  `agent_settled`. Existing real SDK compaction/recovery/settlement tests pass as well.
- `tls.py` composes the real Plan/Safety factories and native controls with a strict ephemeral
  loopback TLS receiver and real HTTPS/constrained adapter. Main CLI responses remain mocked.
  Keys/fixture credentials stay memory-only; the guard allows only the exact loopback port.
  The process-owned endpoint survives reload; quit owns receiver/guard cleanup.
- Combined receiver/journal/history assertions pass with **exactly 17 requests** (unchanged),
  exact model/path, seven fresh provider agreements, no replay/follow-up after revocation,
  actual benign command evidence, and real client/server socket retirement. Native policy
  transitions, safety cancellation, dashboard exclusion, reload and shutdown pass together.
- Pi1 fullscreen output clips long notifications/dialogs and omits unchanged diff lines.
  PTYs now inspect status and unknown cost through the bounded native dashboard instead of
  assuming notification prefixes enter scrollback. Complete HTTPS disclosure uses 120×100;
  the full recovery packet uses 120×160. The 60-column dashboard/control path still passes.

Current verification:

- **395/395 Swarm tests**, **155/155 SDK-free foundation tests**, **66/66 Plan/Safety
  tests**, and **4/4 cleanup regressions** pass on installed Pi 1.0.0. Historical policy counts
  are not substituted for the current command's result.
- **All three real CLI PTYs pass**: `run.py`, `production.py`, and `tls.py`. Request counts,
  receipts, persisted history, authority replacement and dialog/socket cleanup are asserted.
- `git diff --check` passes. Global validation still reports unrelated model/thinking defaults
  and untracked test additions. No configuration normalization or staging was performed.

Compatibility basis: installed `sdk.md`, `message-types.md`, `session-format.md`,
`compaction.md`, `custom-provider.md`, `extensions.md`, `tui.md` and linked public contracts,
checked against actual declarations and implementation. In 1.0.0 the prose mentions
`SystemMessage.replace`, but declarations/replay do not implement it: persisted `replace:true`
and mid-transcript wire replacements fail closed rather than being ignored. Direct leading
wire checkpoints have no prior system state. Minimum supported Pi is now 1.0.0 (Node 22.19+);
newer Pi releases require revalidation. Older SDK support is not claimed.

Remaining limits: automated ANSI/keyboard and durable-record acceptance is not a full
terminal-emulator viewport test or human visual sign-off. Tall agreements do not certify
narrow agreement readability. Native worker compaction is SDK-tested, not exposed as a new
public host/UI command. Remote compatibility/cancellation/rollback, escaped processes, power
loss, semantic scope, cost accuracy and activation remain outside this completed offline phase.

### 22. Phase 13 bounded native terminal decisions

The user selected normal-terminal dialog polish rather than a live-provider trial. Implemented
only in the feature worktree; no external networking, live providers, real credentials,
installation, activation, settings changes, commits, pushes, or parent-checkout edits.

Implemented:

- `decision.mjs` supplies a focused public native custom overlay with a fixed-height reading
  viewport, persistent action controls, position indicator, and active semantic theme styling.
  Full agreement/provider/dirty-work/recovery packets wrap through public Pi TUI helpers.
  No critical packet data is silently truncated. ANSI/control and bidi sequences are visibly
  escaped; ordinary Unicode remains readable. Layout is cached by width and invalidated safely.
- Up/Down, PageUp/PageDown and Home/End navigate. Left/Right explicitly selects a decision;
  Enter confirms. Cancel is always the initial selection and Escape works throughout.
  Non-cancel actions require reaching the packet end. Typing/pasting cannot approve; the
  navigation gate does not establish human comprehension. Too-small terminals refuse approval
  until resized (minimum 40 columns / 16 rows); normal views reserve four terminal rows.
- Existing launch editing selects a field explicitly and uses a separate cancellable native
  JSON input before redisplaying the complete agreement. Current field values no longer swell
  the input title. Immutable provider selection stays outside editable agreement fields.
- Dirty-work preservation, workspace reconciliation and written settlement attestation remain
  explicit separate decisions. The attestation packet includes exact unresolved operation and
  turn IDs together with the full evidence text; unknown effects never become success.
- Completion and listener disposal are idempotent. Abort signals dismiss custom interactions
  using the public completion callback. Host timeout, mode/lifecycle fencing and serialization
  remain unchanged; no execution occurs before human approval. Pi 1.0 fullscreen testing showed
  a focused overlay is needed to own page keys rather than leave them to transcript scrolling.

Verification on installed Pi 1.0.0:

- **408/408 Swarm tests**: prior 395 plus 13 actual component regressions. Deterministic frames
  assert width AND height at **60×24, 80×24 and 100×40**; complete multi-page data access,
  forward/reverse/Home/End navigation, huge objectives, deep data, long URLs, Unicode, hostile
  ANSI/bidi input, persistent controls, typing/paste/default denial, resizing, signal/timeout
  cancellation, listener cleanup and serialized dirty-work/exact-ID/evidence attestation.
- **155 foundation**, **66 Plan/Safety** and **4 cleanup** regressions pass.
- **All three real CLI PTYs pass** without tall-terminal workarounds. `run.py` exercises 60×24
  launch/edit/preservation, 100×40 light-theme continuation, and 80×24 recovery/attestation.
  Recovery and evidence packets show the exact operation ID subsequently checked in the journal.
  `production.py` and `tls.py` run at 80×24, navigating pages before explicit decisions.
  HTTPS disclosure includes the complete exact endpoint and outbound-context declaration.
- Combined TLS evidence remains **exactly 17 requests and seven fresh agreements**, with the
  existing command receipts, native histories, no-replay/follow-up fencing, actual socket
  settlement, production mode transitions, safety exclusion, reload and shutdown assertions.
- `git diff --check` passes. Global validation retains unrelated model/thinking-default errors
  and lists three intentionally untracked source/test additions; nothing staged or normalized.

Contract basis: complete installed Pi 1.0 `extensions.md`, `tui.md`, relevant public UI types,
custom-overlay implementation, overlay/Q&A examples and theme guidance. Only public TUI imports
and `ctx.ui.custom` APIs are used; no new registration or activation entry is added.

Limits: assertions combine deterministic component frames, emitted ANSI/keyboard interaction
and durable records. They are not a full terminal-emulator viewport, screenshot or human visual
acceptance. A lightweight parser was considered, but no incomplete emulator is represented as
visual proof and no dependency was installed. Contrast, IME/mouse, alternate terminals and
regular-mode visual fidelity remain unverified. Very large packet performance is not certified;
full data is kept in memory. Arbitrary third-party modal arbitration, remote compatibility,
escaped processes, power loss, semantic scope, cost accuracy and activation remain deferred.

### 23. Native Pi model/provider integration — architecture decision and offline acceptance

The user questioned custom HTTPS overengineering and approved native Pi integration. The
preferred production architecture now delegates model transport/auth to the host's existing
public Pi **ModelRuntime**, or the public **ModelRegistry** exposed by extension context.
Do not access `ModelRegistry.runtime`: it is private. Do not create a second ambient runtime
or independently discover credentials/catalogs/resources just to start a Swarm worker.
The custom constrained adapter and HTTPS files/tests remain intact as optional legacy and
experimental paths; deletion, automatic migration and production activation are not authorized.

Implemented:

- `native-provider.mjs` provides async host-only `createNativeRuntime`, accepting exactly one
  existing public runtime/registry plus explicit main model/thinking and an optional explicit
  swarm-wide override. Its branded facade is passed to the existing host/session machinery.
  `createNativeSwarmExtension` composes it with the inactive explicitly injected factory.
  A host extension supplies `ctx.modelRegistry`, `ctx.model`, and `pi.getThinkingLevel()` when
  preparing its launch agreement; the run retains the approved snapshot. No worker can switch
  models. Virtual/router models are rejected rather than silently choosing a physical provider.
- Durable `pi-native` descriptors disclose provider/model/API, informational catalog endpoint
  when known, and all potentially outbound context categories. They are distinct from old
  HTTPS descriptors; no silent upgrade is possible. Approval remains human, fresh on every
  launch/resume/restart, and restore opens paused without execution. Capability copies and
  arbitrary runtime objects cannot mint the native brand.
- A small request facade delegates all four stream/complete entry points to public Pi methods,
  preserving native context/options/headers/reasoning/usage rather than serializing HTTP itself.
  SDK pre-compaction auth probing supplies no override; native streaming resolves credentials
  once through the same host provider mechanism. No Swarm credential store or login is added.
- Existing per-request budget ticks, human approval, mode, ownership, turn, cycle/generation,
  guidance and cancellation checks cover SDK tool follow-ups and manual compaction. A native
  header-transform guard rechecks after auth before provider dispatch. Native stream/result
  draining and SDK idle/history synchronization remain required before durable turn retirement;
  abort alone never settles a held SDK stream. Worker cache warming is explicitly off alongside
  existing disabled automatic compaction/retries. No arbitrary extension tools are inherited.
- Full catalog model metadata and public provider/method identity are checked in memory at
  admission. Headers/compatibility metadata are not persisted as agreement data. Provider or
  catalog mutation during approval denies launch; mutation during execution revokes admission.
  Restore compares the durable descriptor and obtains fresh approval under newly trusted host
  configuration; it does not prove that hidden configuration stayed identical across processes.
- Agreement/dashboard labels distinguish native Pi from mock and constrained HTTPS. Native
  disclosure expressly says the endpoint is informational, not pinned, and that Pi owns
  credentials, OAuth, environment and routing. Native provider errors are not promised redacted.

Verification on installed Pi 1.0.0, starting from clean `ab77860`:

- Baseline **408/408** Swarm tests passed. Final **428/428** pass, adding 19 native integration
  regressions and one native disclosure regression. **155/155 foundation**, **66/66 Plan/Safety**,
  **4/4 cleanup**, and **all three CLI PTYs** (`run.py`, `production.py`, `tls.py`) also pass.
- Native tests use real public `ModelRuntime`, `createProvider`, `ModelRegistry`, normal
  `openai-responses` model/API metadata, in-memory fixture credentials and scripted streams.
  A process network guard asserts no network attempts. All four request methods preserve native
  auth/header transformation/options; factory/status paths perform no implicit runtime creation,
  credential lookup or discovery. Tests cover branding, metadata drift, stale approval, explicit
  selection snapshots, virtual-model rejection, tool follow-ups, native manual compaction,
  budget/mode cancellation, held prompt/compaction settlement and paused restore/fresh approvals.
- Existing PTYs remain mock and constrained-loopback regressions; they do not certify a native
  live provider. TLS acceptance still observes exactly **17 requests and seven fresh agreements**.
- `git diff --check` passes. Repository validation retains the unrelated model/thinking default
  mismatch and flags the two new unstaged/untracked source/test files. No settings normalized,
  files staged, real credentials accessed, external network used, dependencies installed, global
  activation performed, commits created, pushes made or parent checkout edited.

Contract basis: complete installed Pi 1.0 SDK, extensions, custom-provider, models/providers,
settings/configuration, message/session/compaction and TUI documentation; complete Pi AI README;
public ModelRuntime/ModelRegistry declarations, actual SDK/session request/auth paths, and
installed full-control/credential examples. Runtime imports use public package roots only.

Trust boundary and remaining authorization:

Native Pi and its configured provider are trusted in-process code. Auth/OAuth refresh, catalogs,
provider environment, proxies, internal retries, network routing and SDK cleanup follow host
configuration; Swarm does not pin every destination, filter/redact context, constrain internal
provider work or implement an OS sandbox. Header/model metadata checks cannot inspect provider
closures, credential/env changes, or mutations that revert between checks. SDK completion is
not proof of socket closure, terminated OAuth work, remote cancellation, or rollback. Deferred
provider work remains unsupported. Externally enforced network/credential policy belongs to
host isolation, not a new custom Swarm HTTP client.

The next real trial should use native Pi under separately explicit human authorization for
its selected provider/model and disclosed context. Remote compatibility/usefulness, actual
OAuth/network cancellation, usage aggregation/cost accuracy, human visual acceptance and
activation are still unverified. No live/default activation is introduced by this decision.
Disable by removing explicit native host injection; preserve histories and user workspace work.

Bounded simplification follow-up: `SwarmSessions.history` now shares the host dashboard's
validated persisted-history reader instead of constructing an SDK session/provider solely for
inspection. Limits, detached raw entries (including compaction), and identity/corruption guards
remain; persisted output may lag in-flight work. A restored/unopened regression proves no model
runtime access or run/file mutation. **429 Swarm, 66 Plan/Safety, and four cleanup tests pass**.
Public `ScrollView` was considered but needs additional child/layout plumbing and still leaves
key handling and decision read-to-end/resize policy local. A shared pager helper would only move
a few branches while joining unlike policies; retain the existing small pagers unchanged.
No workspace/recovery guard, native-provider behavior, activation or authorization gate changed.

### 24. Native provider terminal acceptance

A fourth real CLI/PTY variant, `test/terminal/native.py`, now exercises the native path with
production Plan/Safety factories. It shares the `production.py` workflow, 80×24 terminal and
existing bounded cleanup/isolation guard instead of duplicating a terminal driver. Its host
fixture creates a real public Pi `ModelRuntime` and `ModelRegistry`, registers a native scripted
`createProvider` with normal `openai-responses` model metadata and in-memory credentials, then
passes that registry/model through `createNativeSwarmExtension` / `createNativeRuntime`.
Worker requests never use the mock-runtime or constrained-HTTP path. A separate main CLI mock
turn remains solely for selected/enforced mode-transition timing.

Verified through real keyboard/native UI plus replayed durable evidence:

- Paged launch/provider agreement discloses provider/model/API, full declared context and
  Pi-owned credentials/OAuth/environment/routing, explicitly informational rather than pinned
  endpoint metadata. No worker dispatch precedes approval. Restriction cancels launch; fresh
  approval preserves dirty work.
- Real SDK task create/claim and production Safety approve/deny/cancel; exactly one benign
  shell process executes successfully and its actual stdout reaches native history/provider.
  Dashboard worker/history navigation precedes Safety dialog exclusion. Agreement/recovery
  page controls retain the read-to-end requirement.
- Discuss/Quick/Plan restriction revokes authority; selected-versus-enforced transitions deny
  continuation while the prior restricted mode remains enforced. Off/reload never resumes
  automatically and no post-revocation tool follow-up is dispatched.
- Four aborted native streams deliberately drain after a short delay. Pause/reload/shutdown
  completion requires stream settlement, not merely abort notification. Native `/reload`
  constructs a second real registry binding, restores paused and retains the durable descriptor.
- Fresh resume agreements retain allowances; explicit restart reaches cycle 2. SIGTERM during
  worker Safety confirmation cancels the gate and leaves no active SDK turn/assignment.
- One controlled shell runner returns `settled: false` **without spawning a process**, then
  written human evidence and native attestation retire that exact intent as unknown, not
  successful or replayed. Native provider streams are not falsely labeled uncertain effects.
  Exact operation IDs appear in both decisions. This proves the attestation flow, not arbitrary
  process-death detection or independent establishment of settlement.

The combined assertions require exactly **19 native worker dispatches**, **seven unique fresh
launch/continuation agreements**, **two registry bindings**, matching native provider/API/model
histories, native credential/header resolution, actual tool outcomes, paused settlement and
**zero attempted network calls** under the process guard. No HTTP receiver is involved: the
scripted native provider records invocations only. Guarding is defense-in-depth, not an OS
sandbox. Disposal waits for confirmed CLI exit before removing temporary evidence; no personal
configuration/credentials are copied or used.

Verification on Pi 1.0.0: **429/429 Swarm**, **155/155 foundation**, **66/66 Plan/Safety**, **4/4
cleanup**, and **all four real CLI PTYs** (`run.py`, `production.py`, `tls.py`, `native.py`) pass.
No production bug required a fix or new unit regression. `git diff --check` passes. Validation
still flags unrelated model/thinking defaults and intentionally untracked implementation/test
files; settings remain untouched and nothing is staged or committed.

Run: `PYTHONDONTWRITEBYTECODE=1 python3 packages/pi-swarm/test/terminal/native.py`.
This closes offline native terminal integration coverage only. Dashboard acceptance covers
section/Enter navigation, not all keys: installed Pi's global transcript scrolling can intercept
End/PageUp in the non-overlay dashboard; broader key arbitration remains follow-up.
Native live-provider compatibility,
usefulness/cost, real OAuth/network cancellation and remote effects, human visual acceptance,
richer dashboard/activity UX and activation remain separately authorized trial gates. No live
provider, real credential, external network, install, global activation, commit or push occurred.

### 25. Bounded native trial and reporting repair

The separately authorized synthetic native trial completed core verification: two worker
identities, one independently reviewed build task, no failed/rejected attempts, and a current
successful final-check receipt. A subsequent offline rerun of the inspected, unchanged source
passed all 12 generated tests. This is not authorization for another provider call.

The original harness failed while reporting/closing an already completed controller. The repair
makes terminal stop idempotent and separates execution, reporting and cleanup failures while
preserving unsettled ownership. The recorded result was recovered from retained evidence, not
from another successful live harness run. Baseline `ab3c7cd` contains the repair and supervised
trial harness; its package suite passes **436** offline tests. See the package README and
`test/live/README.md` for the bounded scope, source-review requirement and retained limitations.

### 26. Explicit normal Pi entry preparation

Authorized scope: prepare normal interactive usage via an explicit local `pi -e` entry, without
changing global activation, settings or the enabled-package inventory. No additional live trial,
real credential access, installation, external network, commit or push is included.

Implemented:

- `extensions/index.ts` registers synchronously through `createCurrentSwarmExtension`. It reads
  no current model or credentials at load. Launch lazily binds the public `ctx.modelRegistry`,
  actual current `ctx.model` and `pi.getThinkingLevel()` after criteria/scope input. Cancelled
  approvals do not cache the prior selection for another launch. Existing mock injection stays
  supported and default host execution still requires branded native capability or mock inputs.
- The normal entry reuses bounded human agreements, explicit dirty-work preservation, owner
  fencing, authoritative Plan Off admission and production Safety. Missing model, non-TUI
  authorization, missing policy or provider mismatch deny without worker execution. Authentication
  remains Pi-owned at request time; no availability/auth/catalog refresh is added to inspection.
- Main model/thinking changes cancel pending controls and pause the old approved run; they do
  not migrate workers. Context-epoch, cancellation-signal and owner checks after asynchronous
  setup prevent a cancelled command from starting a late host operation or fresh agreement,
  including while reload restoration is pending. Seven real-host regressions cover same-turn
  model/thinking/pause cancellation, restore waits and owner fencing; the full 448-test suite
  and fresh-loader entry PTY pass after this fix. This was a late-operation race, not an
  approval bypass. Continuation requires fresh approval of the original pinned selection.
  Another selection requires a new owner/run after settling the old one. Automatic routing and
  worker-selected models remain unsupported.
- Reload/shutdown retires the old host and capability. Native session-start only discovers the
  owner link; the next explicit command reattaches paused, so startup provider registration order
  cannot trigger a premature restore failure. No prompt/load/resume/reload auto-dispatch exists.
  Forks do not inherit control. Existing incomplete-settlement fencing remains unchanged.
- Fresh CLI acceptance exposed dynamic bare SDK imports bypassing Pi's normal loader aliases.
  Native construction now uses static public imports; SDK-free capability bookkeeping lives in
  `native-binding.mjs`. No resolver preload, installed dependency, global loader or private SDK
  import is needed for the explicit entry; the 155 SDK-free foundation tests remain intact.

Verification on installed Pi 1.0.0: **448 Swarm tests**, **155 foundation**, **66 Plan/Safety**,
**four cleanup regressions**, and the four existing PTYs pass. The new `test/terminal/entry.py`
adds two real isolated CLI sessions with the entry explicitly loaded and **no SDK resolver
preload**: missing-model discovery/status/reload, then production Plan/Safety plus a public
scripted native provider with in-memory fixture authentication. It verifies current-model
selection, cancel with zero auth/dispatch, approved dirty-work launch, unchanged existing work
and paused reload without another worker request. Tests do not use a live model or real keys.

The README documents the one-invocation command, optional explicit policy-provider paths,
model/thinking snapshot, prerequisites, recovery and disable procedure. Global activation,
broader live compatibility, human visual acceptance, richer UI/usage reporting and all prior
semantic-scope/remote-cancellation/recovery limitations remain separately gated. Changes remain
uncommitted for review; this preparation does not supersede those product acceptance gates.
