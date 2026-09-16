---
name: Quick confirmation boundary
description: The safe boundary for lightweight Quick confirmations versus Main review and editing.
---

Quick may offer direct approval only for simple, unambiguous `record_expense` and `create_reminder` operations. Other pending writes stay review-only and open Main. Full person/project candidate lists and the approval editor belong to Main, not Quick's import path.

**Why:** Quick must remain a low-RAM, low-interaction surface without bypassing the existing server-side approval, ownership, expiry, and idempotency checks.

**How to apply:** Keep `pending_confirmation` and `quickApprove` opt-in at the operation boundary; never move editing, ambiguous entity resolution, or complex financial writes into Quick. Quick should render a small approval summary from a Quick-specific bubble, while Main owns the editor.