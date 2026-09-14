---
name: Gemini context caching
description: Environment limitation encountered while validating Gemini CachedContent.
---

The current Gemini key/model combination can answer normal generateContent requests but rejects CachedContent creation with `TotalCachedContentStorageTokensPerModelFreeTier limit=0`. The REST payload is accepted when the cached content is large enough; the blocker is provider quota, not the endpoint shape.

**Why:** Live verification of `usageMetadata.cachedContentTokenCount` cannot succeed in this environment until a Gemini project/model with nonzero CachedContent storage is used.

**How to apply:** Keep cache creation non-fatal, add a cooldown after cache quota failures, and verify cached token usage separately in an environment that permits CachedContent storage.