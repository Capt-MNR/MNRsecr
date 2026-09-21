---
name: Delegated action approvals
description: The boundary between Agent Work condition detection and existing secretary approvals.
---

Agent Work must treat a satisfied external condition as a decision point, not permission to mutate. For the current delegated-action path, it reserves the existing secretary operation with an idempotency key tied to the Work, condition snapshot, and run, then moves the Work to waiting. The existing approval executor performs the mutation and authoritative verification; only after that result is recorded may the Work resume.

**Why:** Reusing the established operation lifecycle keeps tenant authorization, editable approval behavior, duplicate prevention, and mutation verification in one path instead of creating a second approval system.

**How to apply:** Keep condition-cycle dedupe outside the LLM, record approval/request/execution/verification evidence on the Work, and allow a new action only after the condition has cleared and later re-entered.