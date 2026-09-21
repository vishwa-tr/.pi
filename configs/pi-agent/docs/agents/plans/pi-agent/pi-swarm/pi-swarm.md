# pi-swarm — implementation plan

## Summary

Build `pi-swarm` as a standalone, goal-driven collaboration extension alongside Pi Subagents and Pi Teams.

Agents collectively decompose an objective, recruit specialists, claim tasks, exchange findings, implement changes, and verify results. The main agent supervises rather than relaying every interaction.

Agreed direction:

1. **Generate specializations during the run.** Swarm does not read or depend on `subagents/` definitions.
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

Stages 1–5 (controller/persistence, workspace safeguards, offline SDK integration, host approval/policy integration, and opt-in launch/recovery UI controls) are authorized and implemented; see sections 10–14. SDK execution remains restricted to deterministic mock providers. Phase 5 UI is tested through fake native UI contexts; authorized Phase 6 adds isolated automated CLI/PTY acceptance (section 15). Authorized Phase 7 adds a mock-only live dashboard and read-only history navigation (section 16). Live model execution and activation remain unauthorized. The agreed direction above supersedes the original proposal to reuse shared subagent definitions. Other implementation details remain proposals unless explicitly confirmed.

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
- Dynamically generated specializations without reading `subagents/`; autonomous recruitment within user-approved run limits.
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

- `TEAMS`: `configs/pi-agent/packages/pi-teams/extensions/teams`
- `SUBAGENTS`: `configs/pi-agent/packages/pi-subagents/extensions/subagents`
- `PLAN`: `configs/pi-agent/packages/pi-plan/extensions/plan`
- `SDK`: the installed Pi package, currently **0.85.1**

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
| The safety provider currently handles three delegation channels. | `configs/pi-agent/packages/pi-safety/extensions/safety/index.ts:174–217` |
| Mode transitions and restoration are centrally owned by pi-plan. | `PLAN/index.ts:299–341`, `PLAN/index.ts:691–725` |
| Package activation requires updating an exact-count validator. | `scripts/validate-global-config.mjs:12`, `scripts/validate-global-config.mjs:50–58` |

### 3. Implementation design

#### 3.1 Independent package and controller

Create:

`configs/pi-agent/packages/pi-swarm/`

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

Swarm does not discover, parse, or adapt global or project `subagents/` definitions. Leave those resources and existing runtimes unchanged.

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

- First supported target: Pi 0.85.1, Node 22+, local Unix checkout with Git and Bash.
- Use public package-root SDK imports only.
- v1 execution requires TUI confirmation; other modes may inspect stored status but fail closed on launch.
- Subagents and Teams retain their current behavior and definitions.
- Swarm coordinates its own members, not arbitrary pre-existing agents or external editors.
- Detect external drift where possible; never automatically undo it.
- Preserve unrelated activation settings and user modifications.

### 6. File changes

Under `configs/pi-agent/packages/pi-swarm/`:

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
- `configs/pi-agent/MANIFEST.md`: add Swarm’s surface.
- `README.md`: distinguish Subagents, Teams, and Swarm.
- `configs/pi-agent/packages/pi-safety/extensions/safety/index.ts`: register the new confirmation channel.
- `configs/pi-agent/packages/pi-plan/extensions/plan/index.ts`: publish/query mode state.
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
- Swarm never discovers or reads global or project `subagents/` definitions.
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
bash configs/pi-agent/packages/pi-swarm/test/e2e/run.sh
bash configs/pi-agent/packages/pi-subagents/test/e2e/run.sh
bash configs/pi-agent/packages/pi-teams/test/e2e/run.sh
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

Implemented under `configs/pi-agent/packages/pi-swarm/`:

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
npm --prefix configs/pi-agent/packages/pi-swarm test
```

Stage 1 has 58 passing deterministic tests, including cross-process ownership exclusion, partial-write and synchronization failures, corrupt replay, stale capabilities, paused reservations, restart accounting, guidance acknowledgments, and source/index preservation in disposable repositories. Syntax and whitespace checks also pass. These tests simulate review and verification inputs; they do not execute models, migrations, or real acceptance checks.

Implementation boundaries:

- `owner` and `system` controller methods are trusted host capabilities, not model-visible tools. User confirmation and actual settlement/verification evidence must be supplied by later adapters.
- Recruitment requires a current workload revision and justification, but semantic suitability and duplicate-specialist judgments remain deferred.
- Reviews are a task phase in the foundation, rather than separate review-task records. Real mutation provenance, verification receipts, and reviewer-edit handling remain deferred.
- Runtime deadlines are checked during dispatch and explicit host ticks. A future driver must schedule ticks and drive cancellation; no background runtime is installed here.
- Missing or corrupt owner state is not automatically repaired, and no force-recovery or history-cleanup command is shipped.
- Filesystem locks coordinate these controllers, not arbitrary shell commands or external editors. File-claim wrappers, shell leasing, SDK sessions, UI, compaction, mode/safety integration, and activation remain for later stages.

See `configs/pi-agent/packages/pi-swarm/README.md` for the foundation API and its trust boundaries.

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
npm --prefix configs/pi-agent/packages/pi-swarm test
npm --prefix configs/pi-agent/packages/pi-swarm run test:foundation
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
python3 configs/pi-agent/packages/pi-swarm/test/terminal/run.py
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
