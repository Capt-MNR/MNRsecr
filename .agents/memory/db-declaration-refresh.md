---
name: Database declaration refresh
description: The API typecheck can resolve stale lib/db declaration output after schema changes.
---

The API package typecheck may report a missing database export even when the symbol exists in the current schema source if `lib/db/dist` declarations are older than the source tree. Refresh the referenced database project declarations with a forced TypeScript build before diagnosing the source barrel.

**Why:** The workspace uses project references and package exports, so API typecheck can consume generated declarations rather than immediately rebuilding the database package.

**How to apply:** When an `@workspace/db` export error contradicts the current schema, refresh `lib/db` declarations, then rerun the API typecheck before changing source exports or migrations.