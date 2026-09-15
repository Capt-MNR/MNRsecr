---
name: Bounded relationship context
description: Safety rules for deterministic relationship-aware financial answers and follow-up references.
---

Relationship-aware reads must use a compact, typed, tenant-and-owner-scoped contract with hard output bounds. If a referenced entity has no explicit financial-party link, only an exact normalized-name match is acceptable; fuzzy or prefix matches require clarification. A scoped request must never fall back to owner-wide totals.

**Why:** Financial answers become misleading when unrelated global rows are labeled as belonging to a referenced person or project. Combining payer/payee directions or currencies also invents a net position that the stored data does not support.

**How to apply:** Keep obligations, receivables, payments, and donations directional and grouped by currency. Store conversation referents only for short-lived follow-ups. Relative expense approvals must persist an atomic delta and require the approved currency at execution time rather than overwriting with a stale absolute amount.