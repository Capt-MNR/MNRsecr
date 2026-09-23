---
name: Task open-count concurrency
description: Why open-task threshold transitions require narrow transaction serialization.
---

Task open-count threshold transitions must serialize create, update, reopen, and delete mutations for the same tenant and owner before reading the previous count.

**Why:** Under PostgreSQL READ COMMITTED, concurrent transactions can each observe their own mutation as a false-to-true transition (for example, both reading `0` before creating an open task), producing duplicate threshold WorkIntents despite outbox and Work dedupe being correct for distinct transition keys.

**How to apply:** Use a narrow transaction-scoped lock keyed by tenant, owner, and the open-task metric. Keep it limited to Task count transitions; do not introduce a denormalized counter or broad tenant lock unless a new audit proves this scope is insufficient.