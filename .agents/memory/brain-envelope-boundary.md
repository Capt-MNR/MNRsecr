---
name: Brain envelope boundary
description: Durable safety rules for the Secretary Brain decision envelope and mutation reconciliation.
---

The Brain decision envelope is orchestration and observability metadata only. It must not become conversation memory, database truth, an approval authority, or a replacement for structured tools and existing resolvers.

**Why:** A transient reasoning layer can become an accidental second source of truth if its confidence, context, or model claims are persisted or used to complete a write without authoritative verification.

**How to apply:** Log the envelope with correlation IDs, keep unverified model claims excluded, execute writes through existing approval/operation paths, re-read tenant-scoped records when possible, and only reconcile a completed mutation when the structured result carries verified post-mutation evidence.