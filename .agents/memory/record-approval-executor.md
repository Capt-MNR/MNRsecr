---
name: Record approval executor
description: Constraint for approval flows started from the structured-records page.
---

Record-page mutations share the deterministic approval executor used by conversational corrections. The stored operation must carry every field the form is allowed to change, not only the primary numeric or relational field.

**Why:** A pending approval can complete successfully while silently preserving an omitted field if the executor only handles the older correction shape.

**How to apply:** When adding or changing record form fields, update the operation arguments, deterministic executor, persistence update input, and approval integration test together.

Approval arguments may contain labels that are also the only usable entity reference when no UUID was resolved. Strip candidate lists before execution, but retain validated person/project names in the stored operation and deterministic executor.

**Why:** Removing those labels as display-only data made approved expense writes lose their recipient/project context even though the approval itself completed.

**How to apply:** Treat labels as operational fallback inputs whenever the executor supports name-based resolution; keep the immutable stored operation authoritative over any client-supplied approval payload.