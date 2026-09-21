---
name: Approval draft persistence
description: Rules for preserving edited approval fields across card remounts without changing the server operation.
---

Edited approval fields may be kept locally per operation for a short TTL so reopening a card does not discard user work. The server-side pending operation remains authoritative until the user submits approval; terminal approval or rejection clears the local draft, while failed or expired operations may retain it for review.

**Why:** A remounted mobile or web card can lose in-progress edits, but copying drafts into the durable operation before approval would blur the boundary between review state and an executable mutation.

**How to apply:** Key drafts by operation ID, validate and expire them on read, keep identity-scoped IDs in the draft, and clear drafts when the operation is approved or rejected.