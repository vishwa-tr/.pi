# Prune command

## Purpose

`pi-prune` adds `/prune` to replace the active Pi session with a fresh session
and remove the previous session file. It is a deterministic local extension; it
makes no model or network calls.

## Lifecycle and failure behavior

The command captures the current session file, then calls Pi's public
`ctx.newSession()` command API. Deletion runs only from the replacement
session's `withSession` callback, after the old runtime has shut down and the new
runtime is active. This ordering lets `session_before_switch` guards cancel the
operation without data loss and avoids using stale session-bound extension
objects.

Deletion follows Pi's session-selector convention:

1. Try the `trash` CLI with a five-second timeout.
2. If trash is unavailable or fails, permanently unlink the session file.
3. If both methods fail, keep the new session active and show the local error.
4. If the original session was in memory, only start the replacement session.

The command accepts no arguments. `/prune anything` is rejected without changing
the session.

## Files

- `configs/pi-agent/packages/pi-prune/extensions/prune/index.ts` — command and
  deletion implementation.
- `configs/pi-agent/packages/pi-prune/test/prune.test.mjs` — unit, isolated RPC
  lifecycle, and runtime-load coverage.
- `configs/pi-agent/packages/pi-prune/README.md` — user-facing behavior.
- Root and agent-dir `settings.json` files — portable and live activation.

## Verification

Verified against Pi 0.81.0:

```text
node --test configs/pi-agent/packages/pi-prune/test/prune.test.mjs
# 9 passed

pi --mode rpc --no-session --offline
# get_commands includes /prune and no extension_error records

git diff --check
# passed
```

The repository-wide configuration validator still reports its pre-existing
`agent/settings.json` schema/theme drift. It also intentionally rejects new
untracked files until they are added to version control; no files were staged as
part of this implementation.

## Disable or rollback

Remove `./configs/pi-agent/packages/pi-prune` from both settings package lists,
then run `/reload` or restart Pi. Removing the package directory is optional once
it is no longer configured.
