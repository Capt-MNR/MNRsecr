---
name: Optimistic record edits
description: The durable rule for preventing stale record edits from overwriting newer changes.
---

The client must carry the record's current version through the update request and any approval operation; the database update must condition on that version atomically and report a conflict when it no longer matches.

**Why:** Refreshing a list before opening an editor reduces stale data but cannot protect a second window or an approval that waits while another edit completes.

**How to apply:** Add the version to the read contract, preserve it in the approval arguments, and use a conditional update. Treat a failed conditional update as a conflict, not as a successful correction or silent no-op.

The Web records editor should close the stale form, refetch the list, and show the newer record after a conflict; it must not leave the user looking at the rejected snapshot or silently retry it.

**Why:** The database can correctly reject the stale write while the UI still misleads the user if it keeps the old form open.

**How to apply:** Classify the conflict response separately from generic update errors, refresh the affected records query, and show a clear retry-after-review message.

The mobile Main editor follows the same version-safety rule for the six general record kinds, while specialized financial records stay on their separate mutation contract.

**Why:** The general records API and financial graph APIs expose different data shapes and invariants; combining their editors would make stale-write and approval handling harder to verify.

**How to apply:** Refresh the general records query before opening a mobile editor, submit its canonical row version, invalidate records and today-context queries after success, and handle specialized financial editing as a separate scope.