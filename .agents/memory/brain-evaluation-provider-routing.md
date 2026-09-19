---
name: Brain evaluation provider routing
description: Scripted provider tests must bypass deterministic and Second Brain shortcuts when measuring failover or planning.
---

When an evaluation is intended to measure provider behavior, choose an input that
cannot be completed by deterministic intelligence or an explicit Second Brain
command; otherwise the provider trace may be empty or report a different
provider than the fixture expects.

**Why:** The secretary intentionally short-circuits clear reads, relationship
clarifications, and memory commands before the model gateway. Tests that use
those inputs can falsely report a failover or planning regression.

**How to apply:** Use a deliberately general planning/reasoning utterance for
provider fixtures, and assert both the provider trace and the deterministic
decision path before interpreting the result.