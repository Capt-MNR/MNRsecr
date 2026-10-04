---
name: Global runner test isolation
description: Avoid cross-tenant side effects when stress tests advance the Agent Work clock.
---

In tests that advance simulated time substantially, do not assert that a global Agent Work runner completes a specific number of records unless the database is isolated. The runner can also claim unrelated due work belonging to other tenants.

**Why:** A time-shifted commitment stress test observed unrelated due work from shared fixtures, making a global completion count appear to be a failure in its tenant-scoped trigger behavior.

**How to apply:** Assert persisted Work counts for the test identity after dispatch. Invoke the global runner only when its cross-tenant scope is intentionally isolated or the test is explicitly checking global dispatch behavior.