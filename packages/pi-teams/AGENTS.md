# pi-teams development instructions

## Keep this an independent, portable Pi extension

This package must install, load and run by itself on a supported Pi installation.
Do not require either of the other coordination extensions, the parent configuration
repository, its shared-resource submodule, or a particular host directory at runtime.
Relative runtime imports must stay inside this package. Use public Pi SDK APIs and
declared package dependencies. Optional integrations must remain optional when absent.
Resolve resources through the package location or Pi's configured agent/project paths;
never assume the user installed the full configuration repository at a fixed location.

The context-fork helper is bundled in `extensions/teams/context/fork.mjs`
with its type declaration. The parent repository's `packages/shared/worker-context.*`
files are development sources only, not runtime dependencies. When working in the full
repository, edit that canonical source, then run
`node scripts/sync-worker-context.mjs --write` and
`node scripts/sync-worker-context.mjs --check` from its root. Do not let the bundled
copies drift.

Before publishing changes, run the relevant package checks and the standalone portability
tests in `packages/shared/portable-extensions.test.mjs` from the full repository. Those
tests copy one package at a time, check import boundaries, load it with Pi's own loader,
and exercise a native forked worker. Preserve the package's manifest, supported runtime
contracts and independent resource discovery. Portability does not justify claiming
support for an operating system or runtime version that has not been verified.
