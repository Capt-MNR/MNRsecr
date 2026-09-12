---
name: Groq GPT-OSS limits
description: Provider-specific reasoning and token-budget behavior for the Groq GPT-OSS model.
---

For Groq GPT-OSS tool-calling, request low hidden reasoning rather than the default reasoning mode, and keep live multi-turn smoke tests short or explicitly tolerant of transient 429 responses.

**Why:** The provider can spend most of the output budget on reasoning before producing a tool call, and the account-level tokens-per-minute limit can reject a later request even when the request shape and model are valid.

**How to apply:** Keep retries inside the same LLM call before executing any returned tool call, log the provider rate-limit classification with the request ID, and use deterministic local gateway tests for long conversational coverage.