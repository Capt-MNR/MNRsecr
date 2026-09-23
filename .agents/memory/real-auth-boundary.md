---
name: Real authentication boundary
description: The secretary uses database-backed sessions and server-derived tenant ownership across web, mobile, and background work.
---

Every user-facing request must derive tenant and owner identity from a valid database-backed session: web uses HttpOnly cookies, mobile uses bearer access tokens with refresh rotation, and background work uses durable row ownership. The legacy development identity is allowed only outside production behind its explicit flag, and old development data is never silently claimed by a new account.

**Why:** Accepting a bearer placeholder or client-supplied tenant/user headers would let one caller impersonate another owner, while automatic reassignment of existing records would be destructive and unauditable.

**How to apply:** New routes must use the centralized authentication middleware and `getIdentity`; never read tenant/user identity from request body, query, or headers. Keep auth tokens out of logs, activity, and evidence, and preserve tenant/owner predicates through approvals, notifications, Agent Work, and recovery.