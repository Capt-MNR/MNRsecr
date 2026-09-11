---
name: Phase 2 provider and entity resolution
description: Durable constraints for the secretary's real-provider path and duplicate-name handling.
---

Gemini and Groq are interchangeable server-side `ModelGateway` implementations selected by `AI_PROVIDER`. Each provider must keep its own bounded retry/timeout policy and a safe JSON error at the API boundary. Provider outages must never be presented as a successful write or silently switch to deterministic mode.

**Why:** Gemini model availability and capacity can change independently of the application, and uncaught provider errors previously leaked HTML stack traces or left requests open too long.

**How to apply:** Keep both provider keys server-only, preserve OpenAI-compatible function calling for Groq, log provider/model/tool latency metadata, and use deterministic mode only when explicitly configured for tests.

People and projects intentionally allow duplicate names so ambiguity can be represented. Creation must therefore resolve existing owner-scoped matches in application code before inserting; database `ON CONFLICT` upserts cannot be the duplicate-prevention mechanism.

**Why:** A unique name constraint would make clarification impossible, while an upsert targeting a removed unique constraint fails at runtime.

**How to apply:** Use owner/tenant-scoped lookup results to return clarification for multiple matches and only create when no matching record exists.