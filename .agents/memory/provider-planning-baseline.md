---
name: Provider planning baselines
description: Durable constraints for paired Brain versus direct-LLM planning evaluation with real providers.
---

Real-provider planning baselines must treat provider rate limits, fallback exhaustion, and output parsing failures as `NOT_MEASURED`, not as planning failures. Keep the Brain route and direct-LLM control route paired, but score quality only when both answers are available.

**Why:** A provider can fail after a valid request or during failover while the application safety boundary remains correct; combining that event with answer quality hides the difference between orchestration behavior and provider availability.

**How to apply:** Use a unique tenant and dry-run fixture, capture provider/model/attempt/token/context evidence per route, compare before/after row counts, and schedule a later complete paired run before drawing capability conclusions.