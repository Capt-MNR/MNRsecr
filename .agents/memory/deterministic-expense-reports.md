---
name: Deterministic expense reports
description: Why broad expense-report requests bypass provider-controlled query limits.
---

Broad, unscoped expense-report phrases should be recognized before the model tool loop and answered with one bounded canonical database read. Scoped requests involving a person, project, category, or time range should continue through entity resolution.

**Why:** The provider can choose different query limits for equivalent Arabic prompts, so the same report may otherwise show different counts and totals without any database change.

**How to apply:** Keep the broad-intent matcher narrow, cap the canonical read, and test equivalent phrases plus repeated requests in one conversation. Do not change stored expenses as a way to normalize report output.

Relative-period totals may bypass the model only for a complete, unscoped phrase that maps to a server-known period such as this week or last month; mentions of people, projects, or arbitrary dates remain on the model path.

**Why:** The server can calculate fixed relative boundaries consistently, but entity names and free-form dates still require resolution and ambiguity handling.

**How to apply:** Use exact full-message matchers and pass only the validated period to the existing bounded expense read. Do not persist new conversation state solely to remember the period.