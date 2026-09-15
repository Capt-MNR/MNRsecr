---
name: Phase 3 typed relationships
description: Durable constraints for additive relationship tables, bounded traversal, and tenant-scoped entity detail.
---

Typed relationships must be stored in explicit additive junction tables with tenant and owner columns, unique endpoint pairs, and bounded reads. Relationship writes must use the same transaction executor as their activity event so approval execution cannot commit a graph edge without its audit event.

**Why:** Drizzle generation against the legacy schema snapshots can produce a destructive full-schema migration; the safe Phase 3 migration is a reviewed additive migration that creates only the new junction tables.

**How to apply:** Review generated migration SQL before applying it, keep relationship endpoint authorization on both sides, and expose entity detail/timeline reads with explicit limits and pagination.