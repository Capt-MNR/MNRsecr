---
name: Token baseline experiments
description: Durable guidance for measuring and reducing real-provider token consumption safely.
---

The first optimization target must be a reproducible real-provider baseline, split by scenario and by logical LLM call, HTTP attempt, token usage, request size, and context component. A context-budget or tool-pruning experiment is not an improvement unless repeated runs show lower measured usage without provider errors, extra retries, or accuracy regressions.

**Why:** In September 2026, a six-case Gemini dry-run measured 20,951 tokens, with the cost concentrated in two cases while four deterministic cases used no provider calls. Enabling the existing context-budget flags produced one provider error in a paired run and a later successful run with more attempts and slightly higher token usage for the expensive case. Provider variance and retry behavior can hide or reverse an apparent prompt-size saving.

**How to apply:** Keep baseline and experiment reports as separate files. Compare the same provider, cases, and context fixture; treat context-required cases separately; never count provider-error runs as evidence of an accuracy win. Prefer one bounded change at a time and require repeated runs before enabling a production flag.

## Contextless correction follow-ups

A correction or reference follow-up that has no saved recent turns, summary, or last expense should return a deterministic clarification instead of spending a provider call. Preserve the model path whenever conversation context exists.

**Why:** Context-required benchmark cases can spend thousands of tokens while no context fixture is available, and the only safe outcome is to ask for the missing operation.

**How to apply:** Gate this shortcut on both narrow correction language patterns and an empty conversation snapshot. It must never create or update a financial record, and it should remain covered by an unreachable-provider test.