# A–E intent evaluation regeneration

Run date: 2026-09-23  
Dataset: `test/intent-evaluation/baseline-scenarios.json`  
Dataset fingerprint: `555cb9acac14285ece870d5b51dd5a7479cedfaa7d24a36a43bdaad1caa4f273`  
Evaluation scope: `tenantId=worker-default-per-case`, `userId=intent-eval-read-only`  
All runs were dry-run evaluations and used the same five cases (`A`, `B`, `C`, `D`, `E`).

## Regenerated provider reports

| Provider mode | Evaluated | Context excluded | Provider errors | Intent accuracy | Tool selection | Clarification | HTTP attempts | Total tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Gemini | 4 | 1 | 0 | 75% | 75% | 100% | 0 | N/A — not measured |
| Groq | 4 | 1 | 0 | 75% | 75% | 100% | 0 | N/A — not measured |
| Failover | 4 | 1 | 0 | 75% | 75% | 100% | 0 | N/A — not measured |

Raw reports:

- `task-116-regenerated-gemini-A-E.json`
- `task-116-regenerated-groq-A-E.json`
- `task-116-regenerated-failover-A-E.json`

The current runtime resolved these cases through deterministic paths, so no
provider HTTP request was sent. Token, request-byte, and cache fields remain
`null` or zero as measured; they are not estimated from older provider runs.

## Corrected intent measurement

The runner now derives intent from the selected tool for the two previously
unmeasured mappings:

- `create_reminder` → `create_reminder` (case A)
- `query_expenses` → `expense_report` (case B)

The regenerated case-level results are:

| Case | Expected intent | Observed intent | Status | Tool-selection match | Clarification match |
|---|---|---|---|---|---|
| A | `create_reminder` | `create_reminder` | evaluated | yes | yes |
| B | `expense_report` | `expense_report` | evaluated | yes | yes |
| C | `context_read` | not classified | evaluated | no | yes |
| D | `expense` | `expense` | evaluated | yes | yes |
| E | `correction` | not scored | context not provided | not scored | not scored |

Therefore the 75% intent score is `3/4` evaluated cases. Case C remains a
separate context-read/tool-selection behavior mismatch; it is not caused by
the A/B measurement correction. Case E is excluded by the existing policy
because no persisted conversation fixture was supplied.

## Historical report handling

The older A–E provider reports remain useful for their original tool,
clarification, latency, and usage evidence, but their old intent percentages
must not be compared directly to this score when they were produced before the
runner correction. In particular:

- `phase1.7-rerun-baseline-gemini.json` recorded 25% intent accuracy because
  A and B had selected the correct tools but `actualIntent` was `null`.
- `phase1.7-rerun-narrow-tool-scope-gemini.json`,
  `phase1.7-rerun-deterministic-weekly-report-gemini.json`, and
  `phase1.7-rerun-budget-aware-finalization-gemini.json` include provider
  errors and are incomplete provider runs. Those errors are excluded from
  accuracy and remain separately reported rather than treated as NLU failures.
- `phase1.7-rerun-narrow-tool-scope-only-gemini.json` already contains the
  corrected A/B mapping, but its provider-backed tool-selection and cost
  measurements are historical. The new reports above are the current matched
  A–E regeneration.

No provider error was observed in the three regenerated runs. If a future
provider run is rate-limited, its affected cases must remain in
`providerErrors` and outside the accuracy denominator.