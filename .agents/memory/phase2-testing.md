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

For sequential optimization benchmarks, a clean baseline does not establish provider stability for the later branches; each branch must be judged independently, and any later provider error invalidates that branch's aggregate comparison.

**Why:** A Gemini A–E baseline completed without errors, but rate limits appeared when the same dataset was repeated across optimization branches.

**How to apply:** Preserve each raw branch report, stop treating aggregate deltas as comparable after the first provider error, and avoid retrying the whole matrix until capacity is known to persist across the full sequence.

The HTTP integration harness's development provider selects the legacy deterministic runtime rather than `Phase2AgentRuntime`; tests of Phase 2 orchestration need an explicit scripted gateway or a dedicated experimental flag path.

**Why:** A request can return a valid development response while never exercising Phase 2 provider routing or orchestration, making an apparently passing HTTP test prove the wrong layer.

**How to apply:** Keep canonical-data integration assertions on a deterministic, tenant-isolated HTTP path when possible, but do not interpret development-provider responses as Phase 2 coverage without checking the selected runtime.