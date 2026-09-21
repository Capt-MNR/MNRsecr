---
name: Agent Work migrations
description: Development schema application for Agent Work when legacy Drizzle metadata is invalid
---

The legacy Drizzle migration journal may be invalid or out of sync enough that `drizzle-kit generate` and non-interactive `push` cannot be used safely. Keep the Agent Work schema additive and reviewed, apply it to development with the repository's database tooling, and repair or reconcile the journal before generating future production migrations.

**Why:** The existing journal contained invalid trailing-comma JSON and schema-name conflicts caused Drizzle to require an interactive prompt; treating that as a schema failure or forcing a migration would risk unrelated tables.

**How to apply:** Before adding another Agent Work table or migration, inspect the journal and database state first. Do not use a destructive reset or silently alter production; use a reviewed additive SQL migration for development until the migration history is repaired.