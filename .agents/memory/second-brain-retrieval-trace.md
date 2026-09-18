---
name: Second Brain retrieval trace
description: Retrieval traces correlate decisions to the request and conversation while separating SQL candidates from LLM context.
---

Every retrieval decision should carry request and conversation correlation, bounded selected/excluded entries, and provenance/association metadata for selected memories. `selected` must mean the memories that passed policy and entered context, not every row returned by the database.

**Why:** A trace without correlation or provenance cannot be audited, and treating database candidates as selected would overstate what influenced the secretary.

**How to apply:** Keep no-op traces for non-triggered retrieval, record explicit-recall traces separately, and preserve the distinction between no matches, policy exclusion, structured precedence, and context inclusion.

Apply the context character budget before formatting the LLM payload, and mark any dropped selected memory as `budget` excluded.

**Why:** Truncating after selection makes the trace claim that memories influenced the model when only a prefix actually did.

**How to apply:** Bound the policy-approved list, update `selected` and `llmContextIncluded`, then serialize the bounded list without a second silent truncation.