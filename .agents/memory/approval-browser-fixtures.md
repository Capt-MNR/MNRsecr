---
name: Isolated approval browser fixtures
description: How to exercise the first-request approval flow without touching the shared preview tenant.
---

Use a short-lived API fixture process with `AI_PROVIDER=development`, unique tenant/user IDs, real seeded rows, and tenant-scoped cleanup on shutdown. The API server package does not expose `tsx` through its own package binary; invoke the repository-local `scripts/node_modules/.bin/tsx` path when starting TypeScript test harnesses.

**Why:** The shared preview database can contain unrelated user data, while the approval flow needs a real pending operation and realistic graph relationships. Running the wrong package command fails before the fixture starts.

**How to apply:** Compare the first `/turns` response to `GET /approvals/:operationId`, then approve, repeat approval, and reject a separate mutation. Route browser API calls to the isolated process if doing browser-level verification; clean up its tenant afterward.