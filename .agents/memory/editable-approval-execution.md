---
name: Editable approval execution
description: Expense approvals edited in the card must execute with scoped IDs rather than display labels.
---

Editable expense approvals execute through the scoped structured-tool path because the legacy approval executor resolves people by display name. The approval operation may keep labels transiently for UI compatibility, but persisted and conversation-recorded args must strip display-only names and candidate lists while retaining personId/projectId.

**Why:** Duplicate names make name-based persistence unsafe, while the approval card promises that selected IDs are the authoritative values.

**How to apply:** Preserve this split whenever approval args are extended: labels/candidates are UI metadata; IDs and validated tool fields are the executable and auditable payload.