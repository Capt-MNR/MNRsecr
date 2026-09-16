---
name: Arabic dialect understanding
description: Durable rules for expanding Arabic dialect support without weakening write safety.
---

Dialect support should first normalize high-signal vocabulary into the existing intent parser and measure the result with labeled examples. It must not bypass the existing ambiguity, payload validation, or approval gates.

**Why:** Egyptian, Gulf, and Levantine requests can express the same expense or reminder intent with different verbs, time words, number punctuation, and question forms. A shared parser can improve understanding without creating a second unsafe write path.

**How to apply:** Add dialect phrases to the bounded normalization layer, preserve entity text where possible, include Arabic digits and locale separators in parsing, and expand the corpus before enabling new deterministic writes.