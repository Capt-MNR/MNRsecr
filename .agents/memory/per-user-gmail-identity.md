---
name: Per-user Google account connections
description: Account ownership and permission boundaries for Gmail and Google Calendar OAuth.
---

The user explicitly resumed Google sign-in, Microsoft sign-in, and Gmail/Google Calendar service connections on 2026-10-05. Keep existing app data tied to the current app account; connecting providers must not silently move or merge records.

**Why:** The user selected Google and Microsoft as sign-in providers, Gmail and Google Calendar as external services, and keeping the current data in the existing account.

**How to apply:** Keep login identity linking separate from Gmail/Calendar service authorization. Bind OAuth state, connection lookup, and token use to the authenticated tenant and user. Ask for the required Gmail and Calendar permissions before enabling live operations. Never put credentials in action arguments, events, or evidence. Require separate approval for each email and never automatically resend an uncertain result.
