---
name: Provider registry
description: How new LLM providers should enter the secretary without changing orchestration safety.
---

New providers should be registered by metadata (name, protocol, key/model variables, endpoint, and default model) and selected through the shared gateway/failover boundary. OpenAI-compatible providers should not duplicate request, error, or usage logic.

**Why:** Provider availability, price, and model quality can change independently of the secretary's safety contract. Central metadata lets the project add or remove providers without scattering provider names through routing and configuration.

**How to apply:** Keep deterministic intent handling, approval, tool identity, and failover semantics provider-neutral. Add a provider-specific gateway only when its protocol differs from an existing registered protocol, then add a contract test for tool calls and classified failures.