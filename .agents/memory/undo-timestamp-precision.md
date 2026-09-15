---
name: Undo timestamp precision
description: Safe undo checks must account for PostgreSQL timestamp precision versus JavaScript Date serialization.
---

Use an atomic createdAt predicate for undo deletes, matching the JavaScript millisecond value with a one-millisecond database range rather than exact timestamp equality.

**Why:** PostgreSQL can retain microseconds while JavaScript `Date.toISOString()` exposes milliseconds, so an exact database equality check can reject the same timestamp that passed the application-level version check.

**How to apply:** Keep the ownership and version predicates on the final delete and require a returned row before reporting undo success.