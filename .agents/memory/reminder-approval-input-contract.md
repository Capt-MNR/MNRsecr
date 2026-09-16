---
name: Reminder approval input contract
description: Frontend normalization required before submitting editable reminder approvals.
---

Editable reminder approvals must send only the approved fields, a complete ISO datetime, and a non-empty timezone. Stored provider arguments may contain a local datetime or omit the timezone even though the approval endpoint validates a strict schema.

**Why:** The confirmation card can display a valid-looking local time while the server rejects the raw override with a generic validation error.

**How to apply:** Normalize the reminder arguments at the confirmation boundary, default the local timezone to `Africa/Cairo`, and keep a regression test for local, offset, and invalid datetime values.