---
name: Phase 3 typed relationships
description: Durable constraints for additive relationship tables, bounded traversal, and tenant-scoped entity detail.
---

Typed relationships must be stored in explicit additive junction tables with tenant and owner columns, unique endpoint pairs, and bounded reads. Relationship writes must use the same transaction executor as their activity event so approval execution cannot commit a graph edge without its audit event.

**Why:** Drizzle generation against the legacy schema snapshots can produce a destructive full-schema migration; the safe Phase 3 migration is a reviewed additive migration that creates only the new junction tables.

**How to apply:** Review generated migration SQL before applying it, keep relationship endpoint authorization on both sides, and expose entity detail/timeline reads with explicit limits and pagination. Dynamic Drizzle relationship helpers must expose camelCase properties while retaining snake_case SQL column names.

**Why:** Entity graph queries use Drizzle property names; exposing only the database column spelling makes the generated predicate undefined and produces invalid SQL at runtime.

Financial links from people or projects must be included in delete dependency checks, and those checks plus cleanup must run inside the approval transaction. The foreign key is the final race guard when a link insert overlaps deletion.

**Why:** A delete that removes ordinary relationship rows before a concurrent financial link is committed can otherwise fail at the parent delete and leave unrelated links missing.

**How to apply:** Check the financial junction table before deleting the entity, keep all delete statements on the transaction executor, and test both possible winners of the concurrent delete/link race.