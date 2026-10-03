---
name: Per-user Gmail identity
description: Separate mailbox ownership and the current Gmail OAuth implementation direction.
---

Use one independently authenticated mailbox per app user. Gmail OAuth is the current implementation direction, but keep the Email connector/provider interface neutral so another provider does not change the approval lifecycle.

**Why:** The user requires a separate mailbox for each authenticated app user and has not explicitly selected Gmail over Outlook.

**How to apply:** Bind OAuth state, connection lookup, and token use to the authenticated tenant and user. Never put credentials in action arguments, events, or evidence. Require separate approval for each email and never automatically resend an uncertain result.