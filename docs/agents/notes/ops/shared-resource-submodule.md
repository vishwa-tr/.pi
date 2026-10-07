# Shared resource submodule

## Summary

Pi extensions and setup belong to the parent repository. Reusable skills, roles,
procedures, plans, documentation, scripts, and MCP examples belong to the `.agents/`
submodule. The parent records a specific shared-resource commit.

## Paths

- `packages/`: extension source and package-local tests.
- `tests/`: common SDK discovery, compiler configuration, and integration runner.
- `docs/`: Pi development documentation, including `docs/subagents/` design records.
- `containers/podman/`: container setup.
- `agent/settings.json`: sole active settings file; packages use `./packages/<name>`.
- `agent/packages`: link to `../packages`.
- `agent/skills`, `agent/subagents`, `agent/procedures`: links into `../.agents/`.
- Root `AGENTS.md`: Pi-specific routing to `.agents/AGENTS.md` shared instructions.

The initial library has 39 skills and four active roles. Three legacy issue-team
definitions are retained in its documentation archive because their peer access
fields are rejected by the current parser. Do not drop those restrictions merely
to reactivate the old definitions.

## Verification

Verified on Linux with the installed Pi 1.0.4 SDK:

- All 110 existing extension and integration test files passed.
- All extension TypeScript sources passed strict checks.
- Native discovery loaded 39 skills without diagnostics and both role loaders
  successfully parsed the four active definitions.
- Recursive-clone validation checks the submodule pointer, package paths, resource
  links, skill metadata, existing guidance contracts, and the local-state boundary.
- Shared automation retained its replacement tests and 19 Shotcut tests.
- Relative Markdown links were checked after relocation.

Use `node tests/run.mjs --integration`, `node tests/typecheck.mjs`,
`node scripts/validate-global-config.mjs`, and
`node --test scripts/validate-global-config.test.mjs` for future changes.
The test runner also includes the new shared-resource discovery checks.

## Publication

Push the shared commit first, then the parent pointer. Install with
`git clone --recurse-submodules` or initialize an existing checkout with
`git submodule update --init --recursive`. Keep the previous installation intact
until the new checkout's resource discovery and offline extension load pass.
