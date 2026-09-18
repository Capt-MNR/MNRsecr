---
name: Explicit Second Brain aliases
description: Safety boundary for using personal aliases in deterministic entity resolution
---

Only an explicit alias instruction may create a Second Brain alias, and the alias may resolve only when its canonical value matches an entity owned by the same tenant and user.

**Why:** An inferred nickname can silently select the wrong person, project, or financial party. Personal memory must assist resolution without changing ownership or turning fuzzy text into a database mutation.

**How to apply:** Keep alias parsing deterministic and conservative, preserve ambiguity handling in the normal resolver, and never let an alias bypass tenant scoping or canonical-name matching.