---
name: Provider registry
description: How new LLM providers should enter the secretary without changing orchestration safety.
---

Treat inference targets as namespaced routes: direct providers use `direct:<id>`, Gateways use `gateway:<id>`, and the model identity is carried separately. MNRsecr selects the endpoint route; a selected Gateway retains ownership of upstream choice, balancing, and failover. Keep legacy provider settings as compatibility aliases and preserve their order when route settings are absent. Normalize usage by protocol format rather than provider name.

**Why:** OpenRouter is a routing Gateway, not a direct model provider. Treating both as the same provider identity blurs who owns fallback decisions and makes provider-specific usage logic leak into shared orchestration.

**How to apply:** Register route kind through the shared service catalog; preserve the Agent-facing request contract and provider-neutral context, approval, and tool identity. Add an adapter only for a distinct wire protocol, and do not assert Gateway capabilities or upstream policy without verified metadata.