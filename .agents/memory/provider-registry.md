---
name: Provider registry
description: How new LLM providers should enter the secretary without changing orchestration safety.
---

Treat inference targets as namespaced routes: direct providers use `direct:<id>`, Gateways use `gateway:<id>`, and the model identity is carried separately. MNRsecr selects the endpoint route; a selected Gateway retains ownership of upstream choice, balancing, and failover. Keep legacy provider settings as compatibility aliases and preserve their order when route settings are absent. Normalize usage by protocol format rather than provider name. Capability declarations are exact-model opt-ins; unknown models or overrides without exact entries have no declared capabilities.

**Why:** OpenRouter is a routing Gateway, not a direct model provider. Treating both as the same provider identity blurs who owns fallback decisions and makes provider-specific usage logic leak into shared orchestration. Model capabilities can change independently of provider protocol, so guessing from provider identity or inheriting metadata across model changes can route work to unsupported models.

**How to apply:** Register route kind through the shared service catalog; preserve the Agent-facing request contract and provider-neutral context, approval, and tool identity. Add capabilities only for a verified exact model name, and let capability-required routing fail closed when no declaration matches. The custom catalog currently accepts OpenAI-compatible services only; adding a protocol should extend catalog validation and adapter construction, never the MNRsecr route algorithm. Do not assert Gateway capabilities or upstream policy without verified metadata.