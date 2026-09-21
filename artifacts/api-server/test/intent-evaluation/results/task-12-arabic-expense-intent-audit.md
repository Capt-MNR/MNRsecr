# Arabic expense-intent real-provider audit

Generated 2026-09-21 from the versioned 12-case slice `A01`–`A08` and
`B01`–`B04` in `dataset.json`. Every case used the evaluation harness in
explicit dry-run mode. No approval endpoint was called and no database row
changed.

## Provider and model

The primary confirmation run used the available Gemini integration:

- Provider: `gemini`
- Model: `gemini-3.1-flash-lite`
- Cases: 12
- Evaluated: 11
- Context excluded: 1 (`A07`, which intentionally requires prior conversation)
- Case-level provider errors: 0
- Logical LLM calls: 24
- HTTP attempts: 25
- Retry/fallback: one recovered `PROVIDER_UNAVAILABLE` attempt on `B02`; no
  configured provider fallback was used
- Approval reached: none
- Writes: none
- No-write violations: 0
- Tenant-scoped row-count changes: 0

The raw reports retain the full trace, provider/model, tool arguments, request
sizes, latency, retry/fallback flags, approval status, and write status:

- `task-12-after-gemini-12.json`
- `task-12-after-groq-12.json`

## Matched Before/After comparison

The historical Before report is Groq's earlier 36-case run, restricted here to
the same first 12 cases. It is included for provider-matched availability
comparison; its quality percentages are not a reliable NLU baseline because
only 3 of 12 cases reached a usable result.

| Metric | Before: Groq, 12-case slice | After: Groq, 12-case rerun |
|---|---:|---:|
| Evaluated cases | 3 | 11 |
| Context excluded | 0 | 1 |
| Case-level provider errors | 9 | 0 |
| Intent accuracy | 100% (3 cases only) | 36.36% |
| Tool-selection accuracy | 100% (3 cases only) | 72.73% |
| Clarification accuracy | 100% (3 cases only) | 72.73% |
| Logical LLM calls | 21 | 17 |
| HTTP attempts | 21 | 17 |
| Provider-attempt rate-limit failures | not separately retained in the old summary | 8 |
| Approval reached | 0 | 0 |
| Writes / row-count changes | 0 / 0 | 0 / 0 |

The Before 100% scores must not be read as an improvement or regression:
provider failures removed 9 cases from scoring. The valid conclusion from this
matched comparison is that the rerun produced useful NLU evidence where the
Before run did not.

For the available-provider confirmation, Gemini produced:

- Intent accuracy: **45.45%** (`5/11`)
- Tool-selection accuracy: **90.91%** (`10/11`)
- Clarification accuracy: **90.91%** (`10/11`)
- Expense-only intent accuracy: **14.29%** (`1/7` scorable expense cases)
- Explicit create-person intent accuracy: **100%** (`4/4`)
- Average / p50 / p95 latency: **4158 / 4332 / 8750 ms**
- Total input / output / total tokens: **73577 / 727 / 74415**
- Total request bytes: **366255**
- Cached tokens reported: **3959**

## Gemini case results

`find_person` is an acceptable intermediate tool for the expense cases, but an
expense intent is only counted when the run reaches `record_expense`.

| Case | Expected | Observed intent/tool | Logical / HTTP | Approval | Write | Classification |
|---|---|---|---:|---|---|---|
| A01 | expense / `record_expense` | no final intent; `find_person` | 2 / 2 | no | no | NLU stopped after person lookup |
| A02 | expense / `record_expense` | no final intent; `find_person` | 2 / 2 | no | no | NLU stopped after person lookup |
| A03 | expense / `record_expense` | expense; `find_person` → `record_expense` | 3 / 3 | no | no | NLU success; dry-run write candidate |
| A04 | expense / `record_expense` | no final intent; `find_person` | 2 / 2 | no | no | NLU stopped after person lookup |
| A05 | expense / `record_expense` | no final intent; `find_person` | 2 / 2 | no | no | NLU stopped after person lookup |
| A06 | expense / `record_expense` | clarification; `text_response` | 0 / 0 | no | no | deterministic clarification, not provider failure |
| A07 | expense / `record_expense` | clarification; `text_response` | 0 / 0 | no | no | context not provided; excluded from scoring |
| A08 | expense / `record_expense` | no final intent; `find_person` | 2 / 2 | no | no | NLU stopped after person lookup |
| B01 | create_person / `create_person` | create_person; `find_person` → `create_person` | 3 / 3 | no | no | NLU success; dry-run write candidate |
| B02 | create_person / `create_person` | create_person; `find_person` → `create_person` | 3 / 4 | no | no | NLU success; one recovered provider attempt |
| B03 | create_person / `create_person` | create_person; `find_person` → `create_person` | 3 / 3 | no | no | NLU success; dry-run write candidate |
| B04 | create_person / `create_person` | create_person; `create_person` | 2 / 2 | no | no | NLU success; dry-run write candidate |

## Conclusion

The audit successfully measured a real provider after the earlier
rate-limited-only runs. Provider availability is no longer the only outcome:
Gemini returned usable decisions for 11 scorable cases, and the report
separates the one recovered provider attempt from the seven expense cases that
did not reach `record_expense`. The prompt/tool-selection change is therefore
confirmed for explicit person creation and intermediate expense lookup, but the
intended Arabic expense completion improvement is **not confirmed**: only one
of seven scorable expense cases reached the expected expense intent/tool.