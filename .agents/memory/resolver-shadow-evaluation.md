---
name: Resolver shadow evaluation
description: The safety boundary for measuring entity resolution before activation
---

Entity resolution experiments must run as tenant-scoped shadow telemetry first. Seeded conversation state and labeled fixtures may measure alias hits, accuracy, false positives, and preserved ambiguity, but resolver observations must not alter model messages, tool selection, approvals, or writes.

**Why:** Entity resolution errors can silently redirect financial or operational writes; comparing behavior and row counts against a same-dataset baseline is safer than inferring correctness from candidate scores alone.

**How to apply:** Keep the evaluation dry-run-only, compare before/after with matching dataset and tenant scope, and require explicit evidence before moving resolver output into orchestration.