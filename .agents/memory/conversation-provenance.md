---
name: Conversation provenance
description: Durable rule for linking structured records back to the conversation that created them
---

Structured records created through the secretary should retain the originating conversation ID, turn ID, and approving operation ID when applicable. A delayed approval must carry the original turn through the pending operation rather than using the approval response as the record's origin. Manual and legacy records remain explicitly unlinked and the UI must not invent a conversation URL for them.

**Why:** Users need to understand why a record exists and jump back to the exact request, while approval can happen in a later turn and old rows have no trustworthy source.

**How to apply:** Keep provenance nullable and tenant-scoped; populate it at the deterministic write boundary, expose it as a nullable origin object in record APIs, and navigate only when the conversation ID is present.