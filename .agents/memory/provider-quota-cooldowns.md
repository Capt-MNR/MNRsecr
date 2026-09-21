---
name: Provider quota cooldowns
description: Rules for keeping provider quota failures from causing repeated secretary requests.
---

Any provider response that identifies a rate, quota, or token limit must open the provider circuit immediately, even when the response has no Retry-After header. A provider-level quota applies across that provider's models, so model fallback should stop and the outer failover should choose another provider.

**Why:** Daily token limits commonly arrive as 429 responses without a usable reset header. Retrying another model under the same provider adds latency and can repeat the same failure before the fallback is attempted.

**How to apply:** Keep the cooldown bounded, preserve a provider-neutral assistant response, and test both the first fallback and an immediate subsequent request that skips the limited provider.