# Deterministic intelligence benchmark

Recorded: 2026-09-15

This is the persisted Before/After checkpoint for the 36-case Arabic intent
benchmark. The comparison is intentionally labeled by measurement level:

- **Before:** historical full-LLM baseline from the intent-evaluation work.
- **After:** deterministic parser/decision-level evaluation after the
  deterministic intelligence layer was added.

These are not equivalent provider runs. The After numbers measure the local
classifier and safety decision boundary; they do not claim a new provider NLU
accuracy score.

| Measure | Before | After |
| --- | ---: | ---: |
| Cases | 36 | 36 |
| Deterministic cases solved | — | 20 |
| Deterministic intent successes | — | 20 |
| LLM fallback cases | — | 16 |
| Estimated LLM calls avoided | — | 20 |
| False-positive classifier cases | — | 0 |
| Deterministic validation failures | — | 0 |
| Logical LLM calls | 51 | not applicable to parser-only run |
| Tool-selection accuracy | 44.44% | not applicable to parser-only run |
| No-write violations | 1 | 0 |

The real-provider intent harness remains the authoritative source for provider
accuracy, token usage, latency, and fallback measurements. Provider-limited
cases must stay excluded from accuracy calculations.