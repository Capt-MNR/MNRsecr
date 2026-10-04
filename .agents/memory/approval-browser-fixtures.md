---
name: Isolated approval browser fixtures
description: How to exercise the first-request approval flow without touching the shared preview tenant.
---

Use a short-lived API fixture process with `AI_PROVIDER=development`, unique tenant/user IDs, real seeded rows, and tenant-scoped cleanup on shutdown. The API server package does not expose `tsx` through its own package binary; invoke the repository-local `scripts/node_modules/.bin/tsx` path when starting TypeScript test harnesses. A standalone Expo web process must explicitly set `EXPO_PUBLIC_MOBILE_AUTH_MODE=development`; it does not inherit the managed workflow's default.

**Why:** The shared preview database can contain unrelated user data, while the approval flow needs a real pending operation and realistic graph relationships. Running the wrong package command fails before the fixture starts. Without explicit mobile development auth, a fresh browser reaches the app shell but its API requests are unauthorized.

**How to apply:** Set the Expo auth mode in the spawned process environment, route browser API calls to the isolated fixture, and use its fresh browser profile. Compare the first `/turns` response to `GET /approvals/:operationId`, then approve, repeat approval, and reject a separate mutation. Clean up the fixture tenant afterward.