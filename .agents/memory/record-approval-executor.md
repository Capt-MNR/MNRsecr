---
name: Record approval executor
description: Constraint for approval flows started from the structured-records page.
---

Record-page mutations share the deterministic approval executor used by conversational corrections. The stored operation must carry every field the form is allowed to change, not only the primary numeric or relational field.

**Why:** A pending approval can complete successfully while silently preserving an omitted field if the executor only handles the older correction shape.

**How to apply:** When adding or changing record form fields, update the operation arguments, deterministic executor, persistence update input, and approval integration test together.