---
name: Phase 2 integration testing
description: Durable testing constraints for the secretary's provider and conversation-state paths.
---

Use a unique tenant and owner identity for each integration-test run. Never use the shared development identity when testing writes, corrections, duplicate entities, or memory isolation.

**Why:** Shared fixtures can make a correct query appear to duplicate data, and repeated test runs can contaminate later assertions without any application bug.

**How to apply:** Inject test identity through the server's identity override only in the test process, and assert all database fixtures through that scoped identity.

Keep real-provider tests as short smoke tests; cover multi-turn behavior with the deterministic runtime and persistence-backed integration tests.

**Why:** Provider capacity and rate limits can fail a later call independently of application behavior, making long real-provider suites flaky while still leaving the deterministic conversation contract untested if it is omitted.

**How to apply:** Use one representative provider request to validate gateway wiring and response compaction, then exercise corrections, restarts, duplicate names, and tenant isolation without consuming provider quota.