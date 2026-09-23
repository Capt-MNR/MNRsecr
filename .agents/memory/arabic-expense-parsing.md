---
name: Arabic expense parsing
description: Arabic amount and recipient parsing must keep colloquial thousand expressions separate from entity mentions.
---

Arabic expense parsing must treat numeric and word forms such as “11 ألف ونص” and “خمسة آلاف ونصف” as one amount, while purpose text and project phrases must not become person entities.

**Why:** Colloquial Arabic combines units and half-thousands without punctuation, and broad recipient regexes can otherwise misclassify the amount or purpose and block deterministic approval preparation.

**How to apply:** When extending amount or recipient patterns, add both numeric and word-form regression cases, including a purpose containing a named company or project, and preserve ambiguity instead of guessing a person.