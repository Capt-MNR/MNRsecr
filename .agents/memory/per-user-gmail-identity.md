---
name: Deferred Gmail integration
description: Per-user mailbox ownership requirements and the explicit deferral of live Gmail integration.
---

Keep Gmail Live Integration deferred until the user explicitly resumes it. Do not apply its migration, configure OAuth, link a live account, or send/verify a real email in the meantime. When resumed, use one independently authenticated mailbox per app user and keep the Email connector/provider interface neutral.

**Why:** The user explicitly deferred Gmail Live Integration after confirming that the generic External Action architecture is proven through Google Sheets and Fake Email.

**How to apply:** Resume only in the order OAuth configuration → migration → live account linking → real send and verification. Bind OAuth state, connection lookup, and token use to the authenticated tenant and user. Never put credentials in action arguments, events, or evidence. Require separate approval for each email and never automatically resend an uncertain result.
