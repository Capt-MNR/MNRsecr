---
name: Optimistic record edits
description: The durable rule for preventing stale record edits from overwriting newer changes.
---

The client must carry the record's current version through the update request and any approval operation; the database update must condition on that version atomically and report a conflict when it no longer matches.

**Why:** Refreshing a list before opening an editor reduces stale data but cannot protect a second window or an approval that waits while another edit completes.

**How to apply:** Add the version to the read contract, preserve it in the approval arguments, and use a conditional update. Treat a failed conditional update as a conflict, not as a successful correction or silent no-op.