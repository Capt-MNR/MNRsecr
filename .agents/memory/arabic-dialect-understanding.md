---
name: Arabic dialect understanding
description: Durable rules for expanding Arabic dialect support without weakening write safety.
---

Dialect support should first normalize high-signal vocabulary into the existing intent parser and measure the result with labeled examples. It must not bypass the existing ambiguity, payload validation, or approval gates.

**Why:** Egyptian, Gulf, and Levantine requests can express the same expense or reminder intent with different verbs, time words, number punctuation, and question forms. A shared parser can improve understanding without creating a second unsafe write path.

**How to apply:** Add dialect phrases to the bounded normalization layer, preserve entity text where possible, include Arabic digits and locale separators in parsing, and expand the corpus before enabling new deterministic writes.

The local router must consult the semantic parser's ambiguity result before considering any writable shortcut, and entity extraction must not treat the negation/correction prefix "لا" as the preposition "ل".

**Why:** Mixed expense-and-schedule requests can otherwise look like valid local expense writes, while false person mentions from "لا" can turn a correction into the wrong read intent.

**How to apply:** Keep ambiguity as a hard non-write boundary in every local route and add correction/negation cases to each dialect corpus.

JavaScript `\b` is not a reliable word boundary for Arabic text. Use Unicode letter/number lookarounds or an explicit normalization-aware boundary matcher.

**Why:** Arabic letters do not behave as `\w` characters for ordinary JavaScript word-boundary matching, so `\b` can miss intended phrase boundaries and misroute natural-language requests.

**How to apply:** Avoid `\b` around Arabic tokens; add positive and negative Arabic boundary cases whenever phrase matching changes.