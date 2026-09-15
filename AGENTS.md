# Agent Instructions

Cross-project defaults for agents working on this machine.

## Instruction Precedence

Global privacy and outbound-content rules,
preservation of user work, commit and push authorization, and destructive-operation restrictions
remain authoritative unless the user directly overrides them in the current conversation.

Before editing a repository, read its root `AGENTS.md`, root `README.md`, and project-local
`.agents/README.md` when present, then every applicable nested `AGENTS.md` from the root through
the target file's parent.

## Progressive Discovery

For investigation and lookup tasks, minimize search scope and cost.

- Start from the conversation context and strongest available clues. Inspect the most likely target
  directly before discovering alternatives.
- Before concluding that a referenced path does not exist, check it directly; search tools may omit
  hidden or Git-ignored paths.

## Public And Outbound Content

Keep private, sensitive, or personally identifying information out of content that may be shared,
published, or sent to an external service. This includes commit messages, PR descriptions, issues,
review comments, and documentation. Apply the following rules:

- Do not reveal private filenames or paths, redacted details, or sensitive information through
  descriptions of what was omitted or excluded.
- Use portable, non-identifying paths when useful. Do not include absolute home paths, private
  usernames or account identifiers, private network addresses or hostnames, unrelated project
  details, secrets, tokens, credentials, personal contact details, or other sensitive information.
- Do not put my personal email or contact details into commands, headers, code, config, logs,
  telemetry, User-Agent strings, or external requests. Use a neutral placeholder such as
  `noreply@example.com`, or omit the field.

## Git And GitHub

- Choose base and target branches from the user’s request, project instructions, and established
  repository practice, using the remote default as a fallback. Ask when the choice remains ambiguous.
- Inspect Git status before editing and preserve pre-existing user work. Do not stash, discard,
  restore, unstage, or commit that work unless the user explicitly authorizes it.
- Use an isolated worktree when requested by the user, required by project instructions, or needed
  to protect unrelated changes or isolate parallel or high-risk work. Otherwise, use the current
  checkout. Follow the global `using-git-worktrees` skill for setup, placement, and verification.
- Use the `gh` CLI for GitHub operations.
- Follow project instructions for commit messages; otherwise, match the repository’s recent commit
  subject style.
- Commit only when explicitly requested. Push only when explicitly requested; permission to commit
  does not imply permission to push.
- When I ask to commit staged changes, you may amend the immediately preceding commit without
  separate confirmation when it was created during the current task, has not been pushed or shared,
  and the staged changes belong to the same logical change.
- Do not force-push, skip hooks, or use destructive Git commands unless I explicitly ask for that
  exact operation.
- After a multi-line commit, verify the stored message with `git log -1 --format=%B`.
- Do not add agent attribution, session trailers, generated-by footers, internal model details, or
  tool runtime details to commits, PRs, issues, or review comments.

## Pi Configuration Repository

- When looking for global skills, procedures, MCP definitions, or subagents, check this repository's
  corresponding root directory before other global or installed locations. In supported Pi layouts,
  this may be the portable `~/.pi` tree or the effective `~/.pi/agent` directory.

## Reusable Artifacts

Create or update a reusable plan, skill, procedure, subagent, MCP definition, plugin pattern, or
setup guide only when the user requests it, the artifact is an explicit deliverable, or the task is
specifically maintaining the reusable library. Do not create reusable copies as a side effect of
ordinary implementation work.

Reusable artifacts must be project- and host-agnostic. Replace project names, home paths, hosts,
accounts, credentials, private URLs, and environment-specific state with neutral placeholders.
Store the result in the repository's established location for that artifact type.

## Project Agent Documentation

Follow a project's existing agent-documentation structure. Do not create `.agents/`, modify a root
`AGENTS.md`, or write plans, notes, memories, or setup records merely because code was changed.
Create durable project agent material only when the user requests it or when it is an explicit task
deliverable.

When a project has no convention and an inert project-local documentation artifact is requested,
use lowercase hyphen-case under `.agents/docs/<type>/<domain>/<artifact>/<artifact>.md`, where
`<type>` is `plans`, `skills`, `procedures`, `subagents`, `mcp`, `notes`, or `memories`. Keep
project-specific material inside that project and exclude secrets, credentials, private paths,
personal details, and generated logs.

Keep `.agents/README.md` as a short, always-read overview and documentation router. Link directly
to detailed documents, state when each one should be read, and keep detail out of the README. Start
each detailed document with a brief `Summary`, followed by `Details`; read the summary first and
continue into the details only when relevant. Avoid chains of indexes.

Do not use that documentation layout for active resources. Verify the target runtime's discovery
contract first. In Pi, project skills use `.agents/skills/<skill-name>/SKILL.md`, project subagent
definitions use `.pi/subagents/<type>.md`, and executable saved procedures use
`.pi/procedures/<name>.js`.

## Working Style

- Consult the global `readable-code` skill for non-trivial implementation or refactoring unless more
  specific project guidance takes precedence.
- If something I ask for is technically wrong or impossible, say so and propose a workable
  approach.
- Use multiline syntax for the active shell: Bash heredocs in Bash and PowerShell here-strings in
  PowerShell. For multiline GitHub CLI bodies, use `--body-file -` and read the object back to
  verify what was stored.
- When delegated review findings are expected in the current response, await the anchored report;
  do not claim completion after timeout or cancellation. Put the verdict and findings before
  orchestration or cleanup details.
- When giving me app or server URLs in chat, use this machine's LAN IP instead of `localhost`,
  because I often access local services from other devices.
- When giving me an app URL for a project with any kind of login, include working demo credentials
  when available: email, password, and role. Source them from seed/demo data or fixtures. If they
  require a seed step that may not have run, say so and offer to run it.
