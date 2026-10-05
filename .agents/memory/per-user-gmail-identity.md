---
name: Per-user Google account connections
description: Account ownership and permission boundaries for Gmail and Google Calendar OAuth.
---

The user explicitly resumed Google sign-in, Microsoft sign-in, and Gmail/Google Calendar service connections on 2026-10-05. Keep existing app data tied to the current app account; connecting providers must not silently move or merge records. The user approved Gmail message reading and sending plus Google Calendar event reading, creation, and editing.

**Why:** The user selected Google and Microsoft as sign-in providers, Gmail and Google Calendar as external services, kept existing data in the current account, and chose both read and write scopes for the external services.

**How to apply:** Keep login identity linking separate from Gmail/Calendar service authorization. Bind OAuth state, connection lookup, and token use to the authenticated tenant and user. Request only the user-approved scopes. Never put credentials in action arguments, events, or evidence. Require separate approval for each email and calendar write, and never automatically resend an uncertain result.
