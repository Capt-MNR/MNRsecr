---
name: Secretary chat boundary
description: The mobile Main and Quick surfaces share a transport-independent secretary chat service contract.
---

The secretary chat contract belongs outside either UI surface. It carries the message, conversation, channel, bounded record context, optional peer metadata, and stable turn identity through the generated HTTP contract.

**Why:** Main, Quick, and record-context chat must keep one conversation and approval behavior, while future Secretary-to-Secretary/A2A transports need a seam that does not require rewriting the screens.

**How to apply:** Add new providers or peer protocols behind `SecretaryChatTransport`/`SecretaryChatService`; keep Main and Quick consuming the shared service hook rather than importing generated chat mutations directly, and keep server authority for tenant, ownership, and approvals.