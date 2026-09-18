# Secretary Brain v1 — 30-Scenario Baseline

Run date: 2026-09-19  
Contract: `SECRETARY BRAIN v1 EVALUATION CONTRACT — 30 GROUND-TRUTH SCENARIOS`  
Runner: `test/brain-evaluation/run.ts`  
Machine-readable output: `test/brain-evaluation/results/brain-v1-baseline.json`

## Scope and safety

This is a baseline-only evaluation. The runner invokes the current deterministic
semantic parser and `createBrainDecisionEnvelope` path. It does not call an AI
provider, mutate the database, execute an operation, send a notification, or
change production behavior.

The contract is represented in `contract-v1.ts` with the exact scenario IDs,
Arabic inputs, contexts, expected dimensions, and forbidden behaviors supplied
for Evaluation Contract v1. Expected values were not changed to match the
observed implementation.

`PASS` and `FAIL` are used only for scenarios executable by the isolated
deterministic harness. `BLOCKED_BY_INFRASTRUCTURE` means the current runner
does not have the required isolated failure/operation fixture or injection
seam. `NOT_EXECUTABLE` means the required subsystem is not part of this
harness.

## Counts

| Status | Count |
|---|---:|
| PASS | 0 |
| FAIL | 21 |
| BLOCKED_BY_INFRASTRUCTURE | 8 |
| NOT_EXECUTABLE | 1 |
| Total | 30 |

The executable comparison set is 21 scenarios: 0 passed and 21 failed. This
is a factual count, not a subjective score or ranking.

Instrumentation:

- Logical LLM calls: `0`
- Provider attempts: `0`
- Input/output/total tokens: `N/A` — no provider calls were made
- Database mutations: `0`
- External notifications/payments/contact: `0`

## Scenario matrix

| ID | Scenario | Status | Observed intent | Observed level | Contract comparison or limitation |
|---|---|---|---|---|---|
| 01 | Simple expense | FAIL | `record_expense` | L2 | Expected L0; observed L2 |
| 02 | Missing amount | FAIL | `unknown` | L2 | Expected `record_expense`/L1/low-risk/no approval; observed unknown/L2/medium-risk/approval |
| 03 | Ambiguous person | FAIL | `person_financial_status` | L0 | Expected `record_expense`/L1/low-risk/no approval; observed different intent/L0/high-risk/approval |
| 04 | Clear transport expense | FAIL | `record_expense` | L2 | Expected L0/low-risk; observed L2/medium-risk |
| 05 | Financial question | FAIL | `person_financial_status` | L1 | Expected `financial_retrieval`/low-risk/no approval; observed different intent/medium-risk/approval |
| 06 | Last event involving a person | FAIL | `recent_activity` | L2 | Expected `contextual_retrieval`; observed `recent_activity` |
| 07 | Explicit memory | FAIL | `unknown` | L2 | Expected `explicit_memory_save`/L0; observed unknown/L2 |
| 08 | Inferred preference | FAIL | `expense_report` | L3 | Expected `inferred_preference`/L1; observed different intent/L3/high-risk |
| 09 | Explicit memory recall | FAIL | `memory_recall` | L2 | Expected L1; observed L2 |
| 10 | Unassociated alias | FAIL | `unknown` | L2 | Expected `alias_candidate`/L1; observed unknown/L2 |
| 11 | Explicit project alias without association | FAIL | `unknown` | L2 | Expected `alias_candidate`/L1; observed unknown/L2 |
| 12 | Associated alias | FAIL | `entity_context` | L2 | Expected `project_reference`/L0; observed different intent/L2 |
| 13 | Project expense total | FAIL | `project_expenses` | L3 | Expected `project_expense_total`/L0–L1/low-risk/no approval; observed different intent/L3/high-risk/approval |
| 14 | Memory conflicts with financial record | FAIL | `project_expenses` | L3 | Expected `memory_financial_conflict`/L2; observed different intent/L3/high-risk |
| 15 | Payment with missing agreed amount | FAIL | `person_financial_status` | L0 | Expected `financial_action`/L2/high-risk clarification; observed different intent/L0 |
| 16 | Correction of amount | BLOCKED_BY_INFRASTRUCTURE | `unknown` | L2 | No isolated previous-operation/conversation fixture |
| 17 | Correction of person | BLOCKED_BY_INFRASTRUCTURE | `unknown` | L2 | No isolated previous-operation/conversation fixture |
| 18 | Correction of date | BLOCKED_BY_INFRASTRUCTURE | `unknown` | L2 | No isolated previous-operation/conversation fixture |
| 19 | Plan obligations next week | FAIL | `unknown` | L2 | Expected `planning`/L3; observed unknown/L2 |
| 20 | Travel and obligations | FAIL | `unknown` | L2 | Expected `planning`/L3; observed unknown/L2 |
| 21 | Vague action | FAIL | `unknown` | L2 | Expected `unclear_action`/L1/low-risk/no approval; observed unknown/L2/medium-risk/approval |
| 22 | Reminder tomorrow | FAIL | `create_reminder` | L2 | Expected L0–L1/low-risk and tomorrow 17:00; observed L2/medium-risk and hour 05 |
| 23 | Provider failure during general question | BLOCKED_BY_INFRASTRUCTURE | `memory_recall` | L2 | No isolated provider-failure injection seam |
| 24 | Provider failure during expense creation | BLOCKED_BY_INFRASTRUCTURE | `record_expense` | L2 | No isolated provider/runtime failure injection seam |
| 25 | Approval expired | BLOCKED_BY_INFRASTRUCTURE | `unknown` | L2 | No isolated expired-operation fixture/clock control |
| 26 | Verification failure after execution attempt | BLOCKED_BY_INFRASTRUCTURE | `unknown` | L2 | No isolated post-mutation verification-failure seam |
| 27 | User changes mind | BLOCKED_BY_INFRASTRUCTURE | `unknown` | L2 | No isolated pending-operation fixture |
| 28 | Debt / relationship question | FAIL | `person_financial_status` | L2 | Expected `financial_relationship_retrieval`; observed different intent |
| 29 | Project alias without canonical association | FAIL | `project_expenses` | L0 | Expected L1–L2 clarification/low-risk/no approval; observed different intent/L0/high-risk/approval |
| 30 | Proactive obligation synthesis | NOT_EXECUTABLE | `unknown` | L2 | Event-driven proactive scheduler/notification subsystem is outside this harness |

The JSON output contains the complete expected and observed objects for every
scenario, including entities, time scope, context sources, excluded sources,
strategy, confidence, risk, decision, action, approval, verification,
provenance, failure state, correction fields, forbidden behavior, and
responsible subsystem where a comparison failed.

## Failure groups

### Intent and entity understanding

Observed intent mismatches occurred in Scenarios 02, 03, 05, 06, 07, 08, 09,
10, 11, 12, 13, 14, 15, 19, 20, 21, 28, and 29. The report records the exact
observed and expected values; no correction was applied.

### Strategy and intelligence level

The current envelope selected an unexpected intelligence level in Scenarios
01, 02, 03, 04, 07, 08, 09, 10, 11, 12, 13, 14, 15, 19, 20, 21, and 22.
The most direct examples are simple expenses selecting L2 instead of L0 and
planning requests selecting L2 instead of L3.

### Confidence, risk, and approval

The envelope exposed risk/approval mismatches in Scenarios 02, 03, 04, 05,
08, 13, 14, 21, 22, and 29. These are observations only. The runner did not
execute any of the actions.

### Temporal reasoning

Scenario 22 is a reproducible mismatch: the contract expects tomorrow at
17:00, while the current parser produces tomorrow at hour 05 for the supplied
Arabic input. Scenario 18 remains blocked because correction requires an
isolated previous operation.

### Source authority and provenance

The contract requires authoritative structured records for financial answers
and excludes memory as financial truth in Scenarios 05, 13, 14, 28, and 29.
Those cases were evaluated with bounded relationship fixtures at the envelope
boundary; the harness did not claim that a database query or persisted answer
was executed. Provenance in the observations is limited to the deterministic
request/conversation/evaluation trace because no persisted operation ran.

### Approval, verification, and failure handling

Scenarios 16–18 and 25–27 require isolated operation fixtures and persisted
state transitions. Scenarios 23–24 and 26 require controlled provider/runtime
or verification-failure injection. They are classified as
`BLOCKED_BY_INFRASTRUCTURE`, not as passes or implementation failures.

### Proactive behavior

Scenario 30 is `NOT_EXECUTABLE`: the current harness has no event-driven
proactive scheduler/notification execution surface. No notification or
external action was attempted.

## Reproduction

```sh
pnpm --filter @workspace/api-server run test:brain-eval
pnpm --filter @workspace/api-server run run:brain-eval
```

The evaluation test verifies the fixed 01–30 contract, required dimensions,
no-write behavior, and deterministic temporal observation. The runner writes
the JSON report with a fixed clock and fixed evaluation identities.