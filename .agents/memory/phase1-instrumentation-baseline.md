---
name: Phase 1 instrumentation baseline
description: Rules for measuring provider usage without changing secretary behavior
---

The Phase 1 baseline is observational only: one ledger entry represents one provider generation attempt, while logical LLM calls and HTTP attempts remain separate counters. Provider usage fields that are absent must stay `null`; reports render them as `N/A — not measured`.

**Why:** Token-saving work cannot be evaluated safely if provider retries, fallbacks, missing usage, and deterministic no-LLM paths are collapsed into one number or represented by estimates.

**How to apply:** Keep attempt and request summaries in structured telemetry only. Do not put token ledgers, raw payloads, headers, secrets, or full conversation content into prompts, assistant responses, or persisted conversation memory.