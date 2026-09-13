---
name: Phase 2 provider and entity resolution
description: Durable constraints for the secretary's real-provider path and duplicate-name handling.
---

Gemini and Groq are interchangeable server-side `ModelGateway` implementations selected by `AI_PROVIDER`. Each provider must keep its own bounded retry/timeout policy and a safe JSON error at the API boundary. Provider outages must never be presented as a successful write or silently switch to deterministic mode.

**Why:** Gemini model availability and capacity can change independently of the application, and uncaught provider errors previously leaked HTML stack traces or left requests open too long.

**How to apply:** Keep both provider keys server-only, preserve OpenAI-compatible function calling for Groq, log provider/model/tool latency metadata, and use deterministic mode only when explicitly configured for tests.

## Three-level conversation memory

The secretary now separates conversational context into bounded recent turns, canonical Structured Memory, and a persisted compact conversation summary. Recent turns and summaries are scoped by tenant, owner, and conversation ID; summaries are context aids, not business records.

**Why:** Follow-up corrections and references need continuity across requests and restarts without sending an entire transcript or treating ordinary chat as permanent personal data.

**How to apply:** Build each model request from the current message plus recent state and, when present, the summary. Continue using `recall_context` for canonical data and update structured records through tools only.

People and projects intentionally allow duplicate names so ambiguity can be represented. Creation must therefore resolve existing owner-scoped matches in application code before inserting; database `ON CONFLICT` upserts cannot be the duplicate-prevention mechanism.

**Why:** A unique name constraint would make clarification impossible, while an upsert targeting a removed unique constraint fails at runtime.

**How to apply:** Use owner/tenant-scoped lookup results to return clarification for multiple matches and only create when no matching record exists.

## Provider failover

The runtime uses a failover gateway above the independent Gemini and Groq adapters. A request that switches providers stays on the fallback for the rest of that request, and the fallback receives the complete message history including already executed tool results.

**Why:** Retrying a write tool after a provider timeout can duplicate a financial record; provider switching must happen only on the next LLM call and never replay application tools.

**How to apply:** Fail over only classified transient provider failures (429, timeout, unavailable, or transient 5xx/request failures). Preserve non-transient validation, tool, permission, and logical model errors; preserve the original `SecretaryError` classification so HTTP status and retryability remain accurate.

Provider schema conversion must collapse nullable type unions only for the provider that cannot represent them; preserve schema arrays such as `required` unchanged.

**Why:** Groq accepts OpenAI-style `["string", "null"]`, while Gemini rejects a union in `type`; treating every array as a union corrupts valid Gemini schema fields.

**How to apply:** Keep OpenAI conversion recursive and lowercase-compatible. For Gemini, detect arrays made only of schema type names, remove `NULL`, and recursively preserve all other arrays.

The browser timeout for an agent turn must exceed the combined provider failover budget, not just one provider call.

**Why:** A primary provider timeout followed by fallback can legitimately outlive a short client timeout while a write is still being finalized.

**How to apply:** When provider call limits or retry counts change, recalculate the frontend request timeout and make timeout copy warn users not to repeat an unresolved write immediately.