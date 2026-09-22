# A–E intent harness comparison

Run date: 2026-09-22  
Dataset: `test/intent-evaluation/baseline-scenarios.json`  
Provider mode: `gemini`  
Raw current report: `phase1.7-rerun-narrow-tool-scope-only-gemini-current.json`

## Harness change

The harness now derives `actualIntent` from the selected tool for the two
intent/tool pairs that were previously left as `null`:

- `create_reminder` → `create_reminder`
- `query_expenses` → `expense_report`

No Agent, routing, production route, or additional LLM call was changed.

## Summary comparison

| Run | Evaluated | Context excluded | Provider errors | Intent accuracy | Tool selection |
|---|---:|---:|---:|---:|---:|
| Previous raw report before the harness correction | 3 | 0 | 2 | 33.33% | 100% |
| Same historical result after the correction was applied | 4 | 1 | 0 | 75% | 100% |
| Current A–E rerun | 4 | 1 | 0 | 75% | 75% |

The historical raw report is not directly baseline-compatible with the current
runner because it predates the dataset fingerprint fields. The comparison above
uses the same five case IDs and the saved case-level evidence.

## Case comparison

| Case | Previous raw actual intent | Previous tool | Current actual intent | Current tool | Current status |
|---|---|---|---|---|---|
| A | `null` | `create_reminder` | `create_reminder` | `create_reminder` | evaluated |
| B | `null` | `query_expenses` | `expense_report` | `query_expenses` | evaluated |
| C | provider error | — | `null` | `text_response` | evaluated |
| D | `expense` | `find_project` + `record_expense` | `expense` | `record_expense` | evaluated |
| E | provider error | `recall_context` | excluded from accuracy | `text_response` | context not provided |

## Interpretation

- The old A/B accuracy drop was a **harness artifact**. The selected tools were
  already correct; only the `actualIntent` mapping was missing.
- The current A/B results confirm that the correction is working.
- Case C is a separate, real current behavior/tool-selection mismatch: the
  current run returned a text response instead of one of the expected context
  tools. It is not caused by the A/B metric correction.
- Case E remains excluded by the existing context policy because no conversation
  fixture was supplied.
- The current run made zero HTTP LLM attempts because the current runtime
  resolved these cases through its existing deterministic paths; the harness did
  not add or suppress an LLM call.