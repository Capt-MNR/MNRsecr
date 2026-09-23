---
name: Agent Work audit boundaries
description: Runtime audit distinctions between creating, activating, verifying, and delivering Agent Work.
---

Agent Work creation can complete authoritatively while leaving the Work in `draft`; runner evidence begins only after an explicit activation transition. A first read-only baseline may be recorded as a quiet `unchanged` run while its comparison state remains `needs_review`, so audit reports must inspect both fields. Server-side notification acceptance through a durable outbox is not proof of native-device delivery.

**Why:** An end-to-end runtime check showed that request approval, Work persistence, activation, baseline comparison, and device delivery are separate boundaries; collapsing them into one PASS hides lifecycle gaps and environment limits.

**How to apply:** For future audits, record each boundary independently, distinguish current API/workflow evidence from isolated tests, and classify native push as not executable without a native device.