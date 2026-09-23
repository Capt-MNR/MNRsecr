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

Hand-authored SQL migrations must be added to the Drizzle journal with their exact tags before they are allowed to run; historical entries must not be renumbered or rewritten to make a fresh replay appear cleaner.

**Why:** The database had only the first three migration rows even though later SQL files had already shaped development indirectly. A clean replay exposed the gap without risking a guessed production repair.

**How to apply:** Preserve existing tags, append missing entries and additive ownership migrations, run an isolated replay from the legacy baseline, then reconcile development bookkeeping. Treat any production history repair as a separately reviewed change.