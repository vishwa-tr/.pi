# Pi runtime and extension compatibility

## Summary

The managed Pi installer uses a Node.js package tree selected by its `current-version` marker.
Dependency packages may be hoisted beside the Pi SDK. Extension code must use public package
imports; tests must resolve the active installation instead of assuming a global npm layout.
Pi 1.0.4 was verified on Linux on 2026-10-06 with Node 22.23.1. Older standalone history remains
below for its distinct compiled-executable constraints.

## Managed Pi 1.0.4

- `configs/pi-agent/test/runtime.mjs` follows managed `current-version`, honors `PI_SDK_DIR`,
  supports explicit `PI_MANAGED_INSTALL_ROOT`, and keeps npm/Windows discovery as a fallback.
  Dependency resolution handles both hoisted and nested layouts without adding links to the SDK.
- Scripted-provider fixtures inspect system-message sections as well as the legacy prompt field;
  ignoring sections loses worker identity in Pi 1.0 even when production prompting is correct.
- Queue widgets use the supported `aboveEditor` placement. Image-content types come from Pi AI;
  context token counts may be null. TUI page keys use `pageUp` and `pageDown`.
- Void Agent's exact version allowlist includes 1.0.4 after tests against the actual exported
  tool/working components and trust-warning renderer, including shutdown restoration.
- Child process launchers retain the running Node entrypoint; they do not assume an npm binary.
- Managed installation state remains outside the tracked configuration.

Verification commands, from the repository root:

```bash
node configs/pi-agent/test/run.mjs --integration
node configs/pi-agent/test/typecheck.mjs
```

The first command runs all enabled-package tests, lifecycle harnesses, and isolated RPC load
checks. It uses mock providers and temporary configuration, retains per-file logs, and never
requires a live model call. The typecheck uses an already installed compiler (`PI_TSC` overrides
its executable); it does not install tools. Existing package lifecycle runners honor `TSC` or
`PI_TSC` and now share the same managed SDK discovery.

Observed results: all 32 configured packages load together, 106 test files pass, and all extension
TypeScript sources pass strict checks. The Teams, Subagents, and Procedure scopes also pass their
additional strict compiler options. Renderer component tests are not a full interactive-terminal
acceptance test; live provider access, Windows/macOS runtime behavior, and future Pi versions
were not established by this run.

Authoritative contract references, checked against the installed 1.0.4 distribution on 2026-10-06:

- [Pi extension API](https://pi.dev/docs/latest/extensions), with version-specific declarations in
  `dist/core/extensions/types.d.ts`: widget placement, lifecycle and component contracts.
- [Pi SDK](https://pi.dev/docs/latest/sdk), with `dist/core/sdk.d.ts`: session construction and
  explicit tool selection.
- [Pi packages](https://pi.dev/docs/latest/packages): public host-provided package imports.
- Pi AI's installed `dist/types.d.ts` and `dist/utils/text.d.ts`: structured system messages.

These are concise contract summaries, not archived copies. Recheck the installed declarations
and rerun the suite before extending a private-renderer version allowlist.

## Historical standalone scope

Pi 0.80.10 and 0.81.0 standalone Bun executables load extension dependencies
through a fixed virtual-module table. Package-root imports for Pi, Pi TUI, Pi AI, and
TypeBox work without an npm module tree. Arbitrary file-URL imports of private Pi
implementation files do not.

## Changes

Void Agent no longer derives private renderer module paths from the CLI entry
file. Its presentation shims now use class objects reachable from Pi's bundled
package-root export:

- The tool separator patches the root-exported `ToolExecutionComponent`.
- The working background intercepts the root-exported `InteractiveMode` host and
  decorates each working-indicator instance as Pi installs it.

This preserves the existing native status-container placement, tool rendering,
spacing, dividers, animated background, and Matrix layer in both npm and
standalone distributions. The private render shapes remain intentionally pinned
to the verified Pi versions, fail open, warn when unavailable, and restore on
shutdown. The config-alias trust-warning shim now follows the same restoration
lifecycle.

Child Pi launchers in the changes, commit, and merge packages now classify the
runtime from `process.execPath` before considering `process.argv[1]`. A compiled
executable therefore reinvokes itself directly regardless of Bun's virtual entry
path spelling; Node and Bun script runtimes continue to pass their real script
path.

## Pi 0.81.0 verification

Before extending the version allowlists, the v0.81.0 source was checked for the
same contracts: root exports for `InteractiveMode` and `ToolExecutionComponent`,
the host methods used by the guarded shims, the tool renderer's completion and
shell state, the working-indicator render contract, and the standalone loader's
package-root virtual module. The container digests were cross-checked against the
release's `SHA256SUMS` asset.

## Pi 0.83.0 renderer allowlist

Void Agent 1.0.3 adds Pi 0.83.0 to the exact allowlist for the tool-separator
and working-background renderer patches. The patches still verify their target
methods at runtime, fail open when a target is unavailable, and restore only the
functions they installed.

The regression suite exercises the shared renderer contracts against Pi 0.81.0
and simulates the 0.83.0 version gate. Pi 0.83.0 source was not independently
checked for this allowlist-only update; a live 0.83.0 `/reload` remains the final
compatibility check.

## Verification

Run:

```bash
node configs/pi-agent/packages/void-agent/test/working-background.test.mjs
node configs/pi-agent/packages/void-agent/test/tool-separator.test.mjs
node configs/pi-agent/packages/void-agent/test/config-alias-guard.test.mjs
node configs/pi-agent/test/standalone-invocation.test.mjs
```

Then test the configured TUI with the official standalone Pi 0.81.0 release.
The static tests prove shared root-export class identity and restoration; only a
real standalone TUI run verifies bundled-runtime behavior end to end.
