---
name: External secretary peers
description: The boundary for connecting remote secretary peers through the mobile chat service.
---

External secretary communication uses an opt-in transport adapter. The adapter owns A2A framing, metadata preservation, response normalization, approval method routing, and conversion of remote failures into the secretary error contract; Main, Quick, and record chat remain transport-agnostic.

**Why:** Peer protocol details and remote failure shapes should not leak into user-facing surfaces or change their existing conversation and approval behavior.

**How to apply:** Preserve conversation, channel, bounded record context, peer identity/capabilities, input ID, and idempotency key in every outbound turn. Keep approvals explicit and server/peer-authoritative, and retain request IDs, categories, and retryability when mapping failures.