# Pi Repository Instructions

Read `.agents/AGENTS.md`, resolved relative to this file, for the shared working,
privacy, Git, coding, and documentation rules. Read `README.md` and `MANIFEST.md`
before changing this repository's layout or active resources, then relevant package
documentation and nested instructions.

## Repository ownership

- `packages/` contains Pi extensions and their package-local tests.
- `tests/` contains shared Pi test tooling and integration checks.
- `.agents/artifacts/` is ignored local-only storage for necessary Pi project artifacts.
- `scripts/` contains Pi setup and validation.
- `.agents/` is a separate shared-resource Git submodule. Read its README before edits.
- `agent/settings.json` is the sole Pi settings file. Its paths are agent-directory-relative.
- `agent/skills`, `agent/subagents`, and `agent/procedures` link into `.agents/`.
- `agent/packages` links to `packages/`; runtime state remains local to `agent/`.

Necessary project artifacts belong in `.agents/artifacts/<category>/`, ignored by default;
do not commit them. This is an explicit local-only exception inside the shared submodule,
protected by its `.gitignore`, not shared-library content. The path convention does not
require reports or backups for every task. Maintained extension usage and API documentation
belongs with its package under `packages/`.
Reusable cross-project knowledge belongs in `.agents/knowledge/<topic>/README.md`, with
relative links to implementations under `.agents/scripts/`. Remove project-specific, private,
and personal examples or data before saving it. Outside ignored `artifacts/`, do not put
Pi project-specific artifacts inside the shared submodule. Keep Pi Subagents and Pi Teams on the same
`.agents/subagents/` definitions; do not create a second role library.

Pi's project instructions live in this file. Because `.agents/` is the shared submodule, Pi has
no project library of its own: there is no project `RULES.md`, `NOTES.md`, or memory folder.
Pi-specific lessons that must stay local use ignored `.agents/artifacts/knowledge/<topic>/`.

## Validation and publication

Run `node scripts/validate-global-config.mjs` and the relevant tests described in
the README. Commit shared-resource changes in `.agents` first, then record that
commit in the parent. Push the submodule commit before pushing the parent pointer.
Commit and push only with user authorization. Preserve local work and runtime state.
