# Pi Repository Instructions

Read `.agents/AGENTS.md`, resolved relative to this file, for the shared working,
privacy, Git, coding, and documentation rules. Read `README.md` and `MANIFEST.md`
before changing this repository's layout or active resources, then relevant package
documentation and nested instructions.

## Repository ownership

- `packages/` contains Pi extensions and their package-local tests.
- `tests/` contains shared Pi test tooling and integration checks.
- `docs/` contains Pi-specific implementation notes, plans, and historical designs.
- `containers/` contains container setup; `scripts/` contains Pi setup and validation.
- `.agents/` is a separate shared-resource Git submodule. Read its README before edits.
- `agent/settings.json` is the sole Pi settings file. Its paths are agent-directory-relative.
- `agent/skills`, `agent/subagents`, and `agent/procedures` link into `.agents/`.
- `agent/packages` links to `packages/`; runtime state remains local to `agent/`.

Pi project artifacts belong in `docs/agents/<category>/`. Reusable cross-project
artifacts belong in the matching `.agents/` category. Do not put Pi project-specific
artifacts inside the shared submodule. Keep Pi Subagents and Pi Teams on the same
`.agents/subagents/` definitions; do not create a second role library.

## Validation and publication

Run `node scripts/validate-global-config.mjs` and the relevant tests described in
the README. Commit shared-resource changes in `.agents` first, then record that
commit in the parent. Push the submodule commit before pushing the parent pointer.
Commit and push only with user authorization. Preserve local work and runtime state.
