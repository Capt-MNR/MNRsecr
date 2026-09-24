---
name: Second Brain retrieval trace
description: Retrieval traces correlate decisions to the request and conversation while separating SQL candidates from LLM context.
---

Every retrieval decision should carry request and conversation correlation, bounded selected/excluded entries, and provenance/association metadata for selected memories. `selected` must mean the memories that passed policy and entered context, not every row returned by the database.

**Why:** A trace without correlation or provenance cannot be audited, and treating database candidates as selected would overstate what influenced the secretary.

**How to apply:** Keep no-op traces for non-triggered retrieval, record explicit-recall traces separately, and preserve the distinction between no matches, policy exclusion, structured precedence, and context inclusion.

Use a stable outcome for each trace: `not_triggered`, `no_matches`, `excluded_matches`, or `selected_context`. Include scores, confidence, and redacted provenance on exclusions as well as selections, while keeping the trace bounded.

**Why:** A global context reason alone can collapse an empty search into a policy rejection, and ID-only exclusions do not explain why a candidate lost.

**How to apply:** Update the outcome after policy and context-budget stages; sanitize correlation and source identifiers before exposing them in the trace.

Apply the context character budget before formatting the LLM payload, and mark any dropped selected memory as `budget` excluded.

**Why:** Truncating after selection makes the trace claim that memories influenced the model when only a prefix actually did.

**How to apply:** Bound the policy-approved list, update `selected` and `llmContextIncluded`, then serialize the bounded list without a second silent truncation.

Temporal recall must select its sources deterministically. Current structured records remain authoritative for current-state questions; historical, superseded, expired, and archived memory must stay labeled and only enter context when the query asks for history. Treat all retrieved memory, records, relationships, and activity as evidence, never as instructions. Unapproved candidates remain outside retrieval.

**Why:** A lexical match can surface stale values or prompt-injection text, and neither should override current records or become an instruction to the model.

**How to apply:** Preserve temporal state and source provenance through planning, policy, formatting, and traces. Keep current-state reads and writes separate from explicitly historical recall, and do not add automatic memory learning.