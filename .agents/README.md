# Project agent documentation

## Plans

- [Swarm implementation handoff](plans/pi-swarm-implementation-handoff.md) — partial implementation, blockers, remaining phases, and temporary-document cleanup for the native cleanup PR.
- [pi-swarm native cleanup](plans/pi-swarm-native-cleanup.md) — phased plan to replace pi-swarm's custom transport, tools, session handling and storage with native Pi features.

## Scripts

- [swarm-wsl-test.sh](scripts/swarm-wsl-test.sh) — run the pi-swarm suite (and optionally its PTY harness) inside WSL against a worktree's current state; needs the Phase 0B WSL setup.
