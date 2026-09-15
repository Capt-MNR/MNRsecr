# Deterministic parser checkpoint

Recorded: 2026-09-15

This file records local parser and decision-boundary coverage for the 36-case
Arabic intent dataset. It is **not** a provider Before/After benchmark and
must not be used as evidence of provider NLU accuracy, latency, token savings,
or production cost reduction.

| Measure | Parser checkpoint |
| --- | ---: |
| Cases | 36 |
| Deterministic cases classified | 20 |
| LLM fallback cases classified | 16 |
| False-positive classifier cases | 0 |
| Deterministic validation failures | 0 |

The real-provider intent harness remains the authoritative source for provider
accuracy, token usage, latency, and fallback measurements. Provider-limited
cases must stay excluded from accuracy calculations, and before/after claims
require equivalent provider runs with equivalent evaluated-case coverage.

The production branch does not emit an `llmCallsAvoided` claim by default.
Decision-level estimates remain experimental and require
`EXPERIMENTAL_PROVIDER_CLAIMS_ENABLED=true`.