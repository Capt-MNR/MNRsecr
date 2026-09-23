---
name: Push token ownership handoff
description: Security rule for reusing a mobile push token after account logout.
---

Only an explicitly unregistered push token may be reassigned to another authenticated owner. A token disabled because its provider reported it invalid must remain unavailable for cross-account handoff.

**Why:** The database uses one global token identity, so logout on one account must support normal device account switching without allowing a stale or invalid token to be claimed blindly.

**How to apply:** Keep the token row unique globally, record the disable reason, lock the row inside one transaction before checking ownership, and update tenant, owner, enabled state, and reason together. Active foreign tokens and provider-invalid tokens must return the existing ownership conflict.