# Secretary Brain v1 evaluation

Generated: 2026-10-03T21:20:18.521Z
Fixed evaluation clock: 2026-09-19T10:00:00.000Z

## Summary

- Scenarios: 30
- PASS: 9
- FAIL: 12
- Blocked: 8
- Not executable: 1
- Executable envelope pass rate: 42.86% (21 scored scenarios)
- Isolated fixture mutations: 1; all fixtures cleaned: true
- Ambiguous-person runtime check: 1 PASS, 0 FAIL
- Live provider calls: no; token usage: N/A

## Failure classification

| Classification | Scenarios |
| --- | ---: |
| Agent Core bug | 0 |
| fixture/test-harness issue | 4 |
| contract/evaluator mismatch | 5 |
| expected behavior requires review | 3 |
| external dependency | 4 |
| blocked/not executable | 5 |

PASS/FAIL above is the deterministic envelope score only. Isolated runtime, correction, and safety checks are listed separately and do not change that score.

## Scenario results

| ID | Scenario | Status | Failure class | Intent | Level | Runtime-stage check | Mismatch / observed outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | Simple expense | PASS | — | record_expense | L0 | — | deterministic envelope only; no provider or mutation was executed |
| 02 | Missing amount | PASS | — | record_expense | L1 | — | deterministic envelope only; no provider or mutation was executed |
| 03 | Ambiguous person | FAIL | fixture/test-harness issue | record_expense | L0 | PASS | intelligenceLevel observed=L0 expected=L1; approvalRequired observed=true expected=false |
| 04 | Clear transport expense | PASS | — | record_expense | L0 | — | deterministic envelope only; no provider or mutation was executed |
| 05 | Financial question | FAIL | contract/evaluator mismatch | person_financial_status | L1 | — | primaryIntent observed=person_financial_status expected=financial_retrieval |
| 06 | Last event involving a person | FAIL | contract/evaluator mismatch | recent_activity | L2 | — | primaryIntent observed=recent_activity expected=contextual_retrieval |
| 07 | Explicit memory | PASS | — | explicit_memory_save | L0 | — | deterministic envelope only; no provider or mutation was executed |
| 08 | Inferred preference | PASS | — | inferred_preference | L1 | — | deterministic envelope only; no provider or mutation was executed |
| 09 | Explicit memory recall | PASS | — | explicit_memory_retrieval | L1 | — | deterministic envelope only; no provider or mutation was executed |
| 10 | Unassociated alias | PASS | — | alias_candidate | L1 | — | deterministic envelope only; no provider or mutation was executed |
| 11 | Explicit project alias without association | PASS | — | alias_candidate | L1 | — | deterministic envelope only; no provider or mutation was executed |
| 12 | Associated alias | FAIL | fixture/test-harness issue | entity_context | L2 | — | primaryIntent observed=entity_context expected=project_reference; intelligenceLevel observed=L2 expected=L0 |
| 13 | Project expense total | FAIL | contract/evaluator mismatch | project_expenses | L1 | — | primaryIntent observed=project_expenses expected=project_expense_total |
| 14 | Memory conflicts with financial record | FAIL | expected behavior requires review | project_expenses | L3 | — | primaryIntent observed=project_expenses expected=memory_financial_conflict; intelligenceLevel observed=L3 expected=L2 |
| 15 | Payment with missing agreed amount | FAIL | fixture/test-harness issue | person_financial_status | L0 | — | primaryIntent observed=person_financial_status expected=financial_action; intelligenceLevel observed=L0 expected=L2 |
| 16 | Correction of amount | BLOCKED_BY_INFRASTRUCTURE | blocked/not executable | unknown | L2 | PASS | deterministic correction returned approval_required / update_expense; target=a7f0701d-d6b2-41f4-bec0-433b5f395e57; amountMinor=75000; duplicate expense=false |
| 17 | Correction of person | BLOCKED_BY_INFRASTRUCTURE | external dependency | unknown | L2 | BLOCKED_BY_INFRASTRUCTURE | seeded prior expense and conversation; deterministic path returned help / no tool; target=none; Ahmed fixture=85248b1c-53a3-4992-9473-75ba0ab732f8; duplicate expense=false |
| 18 | Correction of date | BLOCKED_BY_INFRASTRUCTURE | external dependency | unknown | L2 | BLOCKED_BY_INFRASTRUCTURE | seeded prior expense and conversation; deterministic path returned help / no tool; target=none; Ahmed fixture=not applicable; duplicate expense=false |
| 19 | Plan obligations next week | FAIL | expected behavior requires review | unknown | L2 | — | primaryIntent observed=unknown expected=planning; intelligenceLevel observed=L2 expected=L3 |
| 20 | Travel and obligations | FAIL | expected behavior requires review | schedule_read | L2 | — | primaryIntent observed=schedule_read expected=planning; intelligenceLevel observed=L2 expected=L3 |
| 21 | Vague action | FAIL | contract/evaluator mismatch | unknown | L1 | — | primaryIntent observed=unknown expected=unclear_action |
| 22 | Reminder tomorrow | PASS | — | create_reminder | L0 | — | deterministic envelope only; no provider or mutation was executed |
| 23 | Provider failure during general question | BLOCKED_BY_INFRASTRUCTURE | external dependency | memory_recall | L2 | — | classified provider failure (PROVIDER_FAILOVER_FAILED); no mutation was attempted |
| 24 | Provider failure during expense creation | BLOCKED_BY_INFRASTRUCTURE | external dependency | record_expense | L0 | — | classified provider failure (PROVIDER_FAILOVER_FAILED); no mutation was attempted |
| 25 | Approval expired | BLOCKED_BY_INFRASTRUCTURE | blocked/not executable | unknown | L2 | — | operation state=expired; claim state=expired; no expense executed |
| 26 | Verification failure after execution attempt | BLOCKED_BY_INFRASTRUCTURE | blocked/not executable | unknown | L2 | — | mutation attempted once; verification state=failed; no retry was attempted |
| 27 | User changes mind | BLOCKED_BY_INFRASTRUCTURE | blocked/not executable | unknown | L2 | — | operation state=rejected; replay state=rejected; no expense executed |
| 28 | Debt / relationship question | FAIL | contract/evaluator mismatch | person_financial_status | L2 | — | primaryIntent observed=person_financial_status expected=financial_relationship_retrieval |
| 29 | Project alias without canonical association | FAIL | fixture/test-harness issue | project_expenses | L0 | — | primaryIntent observed=project_expenses expected=project_expense_total; intelligenceLevel observed=L0 expected=L1\|L2 |
| 30 | Proactive obligation synthesis | NOT_EXECUTABLE | blocked/not executable | unknown | L2 | — | proactive obligation contract represented; scheduler and notification execution are not executable in this runner |

## Multi-turn correction fixture

Decision-stage results: 1 PASS, 0 FAIL, 2 blocked.

- Scenario 16: **PASS** — A pending update targets the prior expense with the corrected amount; no duplicate expense was created.
  - Decision-stage correction was exercised with seeded conversation provenance; final persisted state was not verified because the approval flow was not executed.
  - Final state: not executed; the update remains subject to the existing approval flow.
- Scenario 17: **BLOCKED_BY_INFRASTRUCTURE** — The deterministic path did not establish the correction; the provider-backed path was not called.
  - The previous expense and a unique أحمد fixture were seeded; provider-backed person correction was not executed.
  - Final state: not executed; provider reasoning and the existing approval flow were not exercised.
- Scenario 18: **BLOCKED_BY_INFRASTRUCTURE** — The deterministic path did not establish the correction; the provider-backed path was not called.
  - The previous expense and conversation were seeded; provider-backed temporal correction was not executed.
  - Final state: not executed; provider reasoning and the existing approval flow were not exercised.

## Ambiguous-person runtime fixture

- Scenario 03: **PASS** — The runtime requested clarification between two distinct same-name records without selecting either or creating a write.
  - Two same-name people were seeded in the isolated tenant and the deterministic Secretary runtime was exercised; this evidence does not measure the standalone Brain envelope or a live provider path.
  - Same-name candidates observed: 2.

## Harness repairs and scope

- The verification-failure fixture now creates and claims a real scoped operation with a database UUID before invoking the approved executor.
- Scenario 03 now seeds two actual same-name people and executes the deterministic Secretary runtime instead of injecting a synthetic relationship clarification.
- Scenarios 16–18 now seed a prior expense and real saved conversation provenance; amount-correction decision evidence is separate from final approved persistence.
- JSON and REPORT.md are generated from the same records and timestamp.
- The fixed 30-scenario contract and expected outcomes were not edited.
- Provider failover and operation lifecycle tests remain safety evidence, not Brain decision-flow passes.
- Full expected and observed objects, mismatch details, fixture IDs, and correlation IDs are in the JSON file.
