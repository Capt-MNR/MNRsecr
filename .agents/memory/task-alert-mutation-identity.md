---
name: Task alert mutation identity
description: Task-count threshold mutations need record-specific transition identities for safe deduplication.
---

Each task mutation transition key must include the stable task identity as well as its version or transition. Otherwise two different tasks created at the same row version can be coalesced as if they were retries of one mutation.

**Why:** New tasks commonly begin at the same row version, so a version-only key cannot distinguish a legitimate second task from a retry of the first.

**How to apply:** When adding transactional task-trigger events, compose dedupe keys from tenant/monitor scope, task ID, and the mutation version or transition. Preserve the same key across retries of that task mutation.