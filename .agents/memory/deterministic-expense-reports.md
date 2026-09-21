---
name: Deterministic expense reports
description: Why broad expense-report requests bypass provider-controlled query limits.
---

Broad, unscoped expense-report phrases should be recognized before the model tool loop and answered with one bounded canonical database read. Scoped requests involving a person, project, category, or time range should continue through entity resolution.

**Why:** The provider can choose different query limits for equivalent Arabic prompts, so the same report may otherwise show different counts and totals without any database change.

**How to apply:** Keep the broad-intent matcher narrow, cap the canonical read, and test equivalent phrases plus repeated requests in one conversation. Do not change stored expenses as a way to normalize report output.

For scoped expense totals, the detail-row limit is only for the returned list; the summary count and total must aggregate all rows matching the same tenant, entity, description, project, and date filters. `amountMinor` remains the API fact unit while user-facing formatters divide by 100 once.

**Why:** Summing a limited result set can undercount a real category total, while treating minor units as major units can inflate the displayed amount by 100×.

**How to apply:** Reuse one filtered predicate for both the limited detail query and an unbounded aggregate query, and preserve the existing raw-minor-unit contract for clients that format money.

When matching expenses contain multiple currencies, never expose a singular total or choose one currency with `min`; return per-currency minor-unit totals and make the response explicitly non-additive. Keep the legacy singular fields for the one-currency case.

**Why:** Adding amounts from different currencies creates a plausible-looking number that has no financial meaning and can be mistaken for a verified total.

**How to apply:** Group database aggregates by currency, omit the singular total when more than one group exists, and format each group separately in deterministic and recovery responses.

Relative-period totals may bypass the model only for a complete, unscoped phrase that maps to a server-known period such as this week or last month; mentions of people, projects, or arbitrary dates remain on the model path.

**Why:** The server can calculate fixed relative boundaries consistently, but entity names and free-form dates still require resolution and ambiguity handling.

**How to apply:** Use exact full-message matchers and pass only the validated period to the existing bounded expense read. Do not persist new conversation state solely to remember the period.