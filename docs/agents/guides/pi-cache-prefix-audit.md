# Pi cache prefix audit

## Summary

Verified on 2026-10-08 with managed Pi 1.0.4 on Linux. The mode extension's forced
leading prompt differed between ordinary input and native Swarm mail wakes.
The fix uses the public `context_with_system` hook to project only its owned mode
section consistently, retaining history, other instructions and tool declarations.
Current mode and skill policy remain authoritative; intentional changes can
invalidate caching.

## Evidence

A real-SDK/local-provider reproduction serialized actual Codex payloads without
network access. Before the fix, ordinary-input and mail-wake instruction hashes
differed; an idle Quick-mode mail wake also lacked Quick's model instructions.
Hard tool restrictions still existed. After the fix, two ordinary inputs, two
actual Swarm-progress mail wakes and another ordinary input preserved identical
leading instructions/tool declarations and the exact prior serialized input prefix.
Cold Plan wakes retained explicit skill selection with conservative instructions
when skill metadata had not yet been captured.

A separate ephemeral full-profile session used Luna/low, blocked all model tools,
stopped warming, and capped the audit at three logical provider requests. Reports
contained only hashes, lengths and usage metadata; no prompt, headers or credentials.

| Request | Uncached input | Cached input | Output | Cache-read share |
|---|---:|---:|---:|---:|
| First normal input | 13,471 | 0 | 5 | 0% |
| Second normal input | 695 | 12,800 | 5 | 94.9% |
| Native mail wake | 730 | 12,800 | 5 | 94.6% |

All three requests had identical instruction, tool, request-setting and cache-key
hashes. Both later requests preserved the prior input prefix. No requests exceeded
the cap and no Swarm workers were started. This demonstrates cache reuse after the
fix; there was no charged before-fix A/B run, so it does not quantify billing or
weekly-quota savings or attribute the earlier 17%-to-79% account increase.

The original main-session audit had no recorded `usage` entries for cache warming.
The SDK default warming setting is streaming when unspecified; a default alone
does not establish that refresh requests ran. Warming was stopped for this audit,
and normal passive caching still worked. No cache-key, transport, SDK installation,
retention parameter or global warming setting was changed.

OpenAI documents [exact rendered-prefix matching](https://developers.openai.com/api/docs/guides/prompt-caching):
model, tools, instructions, reasoning settings and changed conversation history
can affect reuse. GPT-6 cache keys need not be changed merely to optimize routing.
API documentation does not establish every legacy ChatGPT-backend option; the
live check used the existing Pi provider settings.

## Reuse the bounded audit

The [temporary diagnostic extension](../scripts/pi-cache-request-audit.ts) writes
only hashes/lengths/token metadata. It blocks model tools, stops warming, and caps
logical provider requests at three. The output is opened exclusively with private
permissions; an existing file is refused. Run it explicitly; never add it to the normal
global package list because its tool blockade is intentional.

From the Pi repository root:

```bash
pi_audit_dir="$(mktemp -d)"
PI_CACHE_AUDIT_REPORT="$pi_audit_dir/report.json" pi --no-session \
  --model openai-codex/gpt-6-luna --thinking low \
  -e docs/agents/scripts/pi-cache-request-audit.ts
```

Send one short instruction to reply READY for audit steps without tools/files,
then a second short READY prompt. Wait for each reply. Run `/cache-audit-mail`
only after exactly two replies, wait for the third, then exit the audit instance.
Inspect the metadata report locally. Transport-level retries are not separately
counted; the live audit had three successful replies. Keep temporary logs local
and remove only the temporary directory created for this audit when no longer needed.

Ordinary model/tool/skill changes and compaction legitimately change prefixes.
Do not freeze obsolete policies or rewrite unrelated historical messages to chase
cache hits. Check the actual serialized provider payload, not timestamp-bearing
SDK messages alone. Missing/aborted usage remains unknown.

## Verification

All 45 mode-extension tests passed, including real-SDK prefix/current-policy checks.
Seventy-five relevant Swarm entry, native main-chat and mail/context-isolation tests
passed. Configuration validation, its 10 fixture tests, 19 shared checks and diff checks
passed; a disposable index verified the new artifacts while leaving actual staging
unchanged. The live audit completed three Luna/low requests. This does not establish
cache rates for other models, speed tiers, regions, long idle periods or Windows.
