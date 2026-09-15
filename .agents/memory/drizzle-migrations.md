---
name: Drizzle migration layout
description: Drizzle custom migrations and relative output paths in this workspace
---

Drizzle Kit requires the migration `out` directory to be workspace-relative when the config is executed from a package; an absolute `path.join(__dirname, ...)` can be resolved as `.//absolute/path` and make `check` or `generate` look for snapshots in the wrong location.

**Why:** The package used a custom SQL expansion against an existing push-managed database. An absolute output path made valid metadata appear missing even though the files existed.

**How to apply:** Keep `out` as `./migrations`, use an additive custom SQL migration for the legacy schema, and run `drizzle-kit check` plus `drizzle-kit migrate` against development before relying on generated clients.

The development database still contains legacy tables that Drizzle may interpret as removals during `drizzle-kit push`; a non-interactive push can stop before applying an unrelated additive change.

**Why:** A people phone column was safe to add, but `push` also proposed deleting `resolver_shadow_log` and its existing rows.

**How to apply:** Never force that broad push for an unrelated field. Apply the narrow additive SQL change, then regenerate API clients and verify the resulting schema.