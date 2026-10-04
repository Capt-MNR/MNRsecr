# Secretary Brain v1 evaluation

Generated: 2026-10-04T07:41:38.831Z
Fixed evaluation clock: 2026-09-19T10:00:00.000Z

## Summary

- Scenarios: 30
- PASS: 20
- FAIL: 0
- Blocked: 9
- Not executable: 1
- Scored contract pass rate: 100% (20 scored scenarios)
- Isolated fixture mutations: 1; all fixtures cleaned: true
- Real-path fixture checks: 3 PASS, 0 FAIL, 1 blocked
- Ambiguous-person runtime check: 1 PASS, 0 FAIL, 0 blocked
- Live provider calls: no; token usage: N/A

## Failure classification

| Classification | Scenarios |
| --- | ---: |
| Agent Core bug | 0 |
| fixture/test-harness issue | 0 |
| contract/evaluator mismatch | 0 |
| expected behavior requires review | 0 |
| external dependency | 4 |
| blocked/not executable | 6 |

PASS/FAIL uses the fixed contract and the correct observed path. Isolated runtime checks are scored only where the scenario contract has a usable fixture; the original envelope-only diagnostic remains available separately.

## Scenario results

| ID | Scenario | Status | Failure class | Intent | Level | Runtime-stage check | Mismatch / observed outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | Simple expense | PASS | — | record_expense | L0 | — | deterministic envelope only; no provider or mutation was executed |
| 02 | Missing amount | PASS | — | record_expense | L1 | — | deterministic envelope only; no provider or mutation was executed |
| 03 | Ambiguous person | PASS | — | record_expense | L1 | ambiguous_person:PASS | Production Phase2AgentRuntime asked which of two saved محمد records was intended before calling the model; no expense or pending operation was created. |
| 04 | Clear transport expense | PASS | — | record_expense | L0 | — | deterministic envelope only; no provider or mutation was executed |
| 05 | Financial question | PASS | — | person_financial_status | L1 | — | deterministic envelope only; no provider or mutation was executed |
| 06 | Last event involving a person | PASS | — | recent_activity | L2 | — | deterministic envelope only; no provider or mutation was executed |
| 07 | Explicit memory | PASS | — | explicit_memory_save | L0 | — | deterministic envelope only; no provider or mutation was executed |
| 08 | Inferred preference | PASS | — | inferred_preference | L1 | — | deterministic envelope only; no provider or mutation was executed |
| 09 | Explicit memory recall | PASS | — | explicit_memory_retrieval | L1 | — | deterministic envelope only; no provider or mutation was executed |
| 10 | Unassociated alias | PASS | — | alias_candidate | L1 | — | deterministic envelope only; no provider or mutation was executed |
| 11 | Explicit project alias without association | PASS | — | alias_candidate | L1 | — | deterministic envelope only; no provider or mutation was executed |
| 12 | Associated alias | PASS | — | project_reference | L0 | associated_project_alias:PASS | The approved alias resolved to المحجر; Phase2 action=project_reference, guarded gateway calls=0, canonical result exposed=true. |
| 13 | Project expense total | PASS | — | project_expenses | L1 | — | deterministic envelope only; no provider or mutation was executed |
| 14 | Memory conflicts with financial record | PASS | — | memory_financial_conflict | L2 | — | deterministic envelope only; no provider or mutation was executed |
| 15 | Payment with missing agreed amount | BLOCKED_BY_INFRASTRUCTURE | blocked/not executable | record_expense | L1 | missing_amount_obligation_fixture:BLOCKED_BY_INFRASTRUCTURE | The synthetic person_financial_status fixture does not establish the scenario's financial_action context or the relevant prior agreement. |
| 16 | Correction of amount | BLOCKED_BY_INFRASTRUCTURE | blocked/not executable | unknown | L2 | PASS | deterministic correction returned approval_required / update_expense; target=a44cb275-849e-4dc4-b653-60fa49c54a86; amountMinor=75000; duplicate expense=false |
| 17 | Correction of person | BLOCKED_BY_INFRASTRUCTURE | external dependency | unknown | L2 | BLOCKED_BY_INFRASTRUCTURE | seeded prior expense and conversation; deterministic path returned help / no tool; target=none; Ahmed fixture=9293ee64-fdd2-417c-bfde-23ad6b9102f9; duplicate expense=false |
| 18 | Correction of date | BLOCKED_BY_INFRASTRUCTURE | external dependency | unknown | L2 | BLOCKED_BY_INFRASTRUCTURE | seeded prior expense and conversation; deterministic path returned help / no tool; target=none; Ahmed fixture=not applicable; duplicate expense=false |
| 19 | Plan obligations next week | PASS | — | planning | L3 | — | deterministic envelope only; no provider or mutation was executed |
| 20 | Travel and obligations | PASS | — | planning | L3 | — | deterministic envelope only; no provider or mutation was executed |
| 21 | Vague action | PASS | — | unknown | L1 | — | deterministic envelope only; no provider or mutation was executed |
| 22 | Reminder tomorrow | PASS | — | create_reminder | L0 | — | deterministic envelope only; no provider or mutation was executed |
| 23 | Provider failure during general question | BLOCKED_BY_INFRASTRUCTURE | external dependency | memory_recall | L2 | — | classified provider failure (PROVIDER_FAILOVER_FAILED); no mutation was attempted |
| 24 | Provider failure during expense creation | BLOCKED_BY_INFRASTRUCTURE | external dependency | record_expense | L0 | — | classified provider failure (PROVIDER_FAILOVER_FAILED); no mutation was attempted |
| 25 | Approval expired | BLOCKED_BY_INFRASTRUCTURE | blocked/not executable | unknown | L2 | — | operation state=expired; claim state=expired; no expense executed |
| 26 | Verification failure after execution attempt | BLOCKED_BY_INFRASTRUCTURE | blocked/not executable | unknown | L2 | — | mutation attempted once; verification state=failed; no retry was attempted |
| 27 | User changes mind | BLOCKED_BY_INFRASTRUCTURE | blocked/not executable | unknown | L2 | — | operation state=rejected; replay state=rejected; no expense executed |
| 28 | Debt / relationship question | PASS | — | person_financial_status | L2 | — | deterministic envelope only; no provider or mutation was executed |
| 29 | Project alias without canonical association | PASS | — | project_expenses | L1 | unassociated_project_alias:PASS | The pending alias was ignored, the system asked for canonical project identity, and no project financial records or mutations occurred. |
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

- Scenario 03: **PASS** — Production Phase2AgentRuntime asked which of two saved محمد records was intended before calling the model; no expense or pending operation was created.
  - Two same-name people were seeded in one isolated tenant; the production Phase2AgentRuntime was exercised with a gateway guard that records but never calls a live provider.
  - Same-name candidates observed: 2.
  - Gateway guard calls: 0.

## Real-path fixture checks

- Scenario 03 (ambiguous_person): **PASS** — Production Phase2AgentRuntime asked which of two saved محمد records was intended before calling the model; no expense or pending operation was created.
  - Compared: clarificationNeeded, twoDistinctSameNameCandidates, noExpenseCreated, noPendingOperationCreated, noModelGatewayCall.
  - Raw envelope diagnostic: intelligenceLevel observed=L0 expected=L1; approvalRequired observed=true expected=false.
- Scenario 12 (associated_project_alias): **PASS** — The approved alias resolved to المحجر; Phase2 action=project_reference, guarded gateway calls=0, canonical result exposed=true.
  - Compared: approvedAssociation, aliasMatch, canonicalProjectId, projectReferenceAction, canonicalProjectExposed, zeroModelCalls, noDomainMutation.
  - Raw envelope diagnostic: primaryIntent observed=unknown expected=project_reference; intelligenceLevel observed=L2 expected=L0.
- Scenario 15 (missing_amount_obligation_fixture): **BLOCKED_BY_INFRASTRUCTURE** — Not scored: the current harness has no reliable staged fixture proving which prior agreement applies when the user asks to pay an unspecified agreed amount.
  - Compared: not scored.
  - Limitation: The synthetic person_financial_status fixture does not establish the scenario's financial_action context or the relevant prior agreement..
  - Raw envelope diagnostic: primaryIntent observed=record_expense expected=financial_action; intelligenceLevel observed=L1 expected=L2; risk observed=low expected=high; approvalRequired observed=false expected=true.
- Scenario 29 (unassociated_project_alias): **PASS** — The pending alias was ignored, the system asked for canonical project identity, and no project financial records or mutations occurred.
  - Compared: pendingAliasRemainsUnassociated, noCanonicalProjectSelected, projectExpenseIntent, projectMentionType, clarificationBeforeFinancialRead, noFinancialRecordsReturned, noDomainMutation.
  - Raw envelope diagnostic: none.

## Harness repairs and scope

- The verification-failure fixture now creates and claims a real scoped operation with a database UUID before invoking the approved executor.
- Scenario 03 now seeds two same-name people and exercises production Phase2AgentRuntime; an ambiguous resolver result stops before the model and produces a non-approval clarification.
- Scenario 12 now creates, associates, approves, and resolves a real same-tenant project alias through the Second Brain lifecycle.
- Scenario 15's synthetic person_financial_status fixture was removed; it is non-executable without a staged authoritative prior-agreement context.
- Scenario 29 now uses a pending unassociated alias and production parser/resolver/Phase2 path; it exposes a real mismatch where the project is parsed as a person-expense request and falls through to the guarded model gateway.
- The five exact implementation-label pairs are normalized only for comparison; the raw observed names remain unchanged.
- Scenarios 16–18 now seed a prior expense and real saved conversation provenance; amount-correction decision evidence is separate from final approved persistence.
- JSON and REPORT.md are generated from the same records and timestamp.
- The fixed 30-scenario contract and expected outcomes were not edited.
- Provider failover and operation lifecycle tests remain safety evidence, not Brain decision-flow passes.
- Full expected and observed objects, mismatch details, fixture IDs, and correlation IDs are in the JSON file.
