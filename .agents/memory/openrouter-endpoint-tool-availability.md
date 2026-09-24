---
name: OpenRouter endpoint tool availability
description: How to verify usable OpenRouter routes for tool-calling models.
---

Do not treat a model catalog entry advertising `tools` as proof that an inference route can execute tool calls. The live endpoint list can differ: every public route may lack tool support while the only compatible endpoint is BYOK-only, causing a chat request to fail before inference.

**Why:** A catalog-listed Llama model advertised tool support but OpenRouter returned HTTP 404 after routing removed its public endpoints for tool incompatibility. A sibling model had current public endpoints that advertised tools.

**How to apply:** Before evaluation, inspect the live model endpoint list for at least one usable, non-BYOK route with tool support. If completion routing still fails, classify it as provider/API availability—not model quality—and replace it only within the model cap.