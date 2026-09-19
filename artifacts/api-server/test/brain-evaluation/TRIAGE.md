# Secretary Brain v1 Conditional Baseline Triage

Date: 2026-09-19

This document is the post-fix triage for the unchanged Evaluation Contract v1
scenarios 01–30. It classifies the initial failures, records only fixes
supported by runtime evidence, and keeps blocked or non-executable scenarios
separate from contract failures.

## Decision summary

The initial baseline was:

| Result | Count |
|---|---:|
| PASS | 0 |
| FAIL | 21 |
| BLOCKED_BY_INFRASTRUCTURE | 8 |
| NOT_EXECUTABLE | 1 |

The post-fix isolated run is:

| Result | Count |
|---|---:|
| PASS | 9 |
| FAIL | 12 |
| BLOCKED_BY_INFRASTRUCTURE | 8 |
| NOT_EXECUTABLE | 1 |

The executable-scenario contract pass rate is `42.86%` (`9 / 21`). This is
not a provider-backed quality score: the isolated runner made zero provider
calls and therefore measured no LLM tokens.

The contract was not weakened and no scenario input or expected ground truth
was rewritten to increase the pass count. The remaining executable failures
are retained for review rather than being converted to PASS by label
normalization or fabricated infrastructure fixtures.

## Initial FAIL classification and final disposition

Classification values:

- **REAL_BRAIN_DEFECT** — runtime behavior contradicted the contract and was
  fixed with a narrow production change.
- **REAL_EXISTING_SUBSYSTEM_DEFECT** — a pre-existing subsystem behavior was
  proven wrong, but is outside the Brain-only fix set.
- **EVALUATOR_DEFECT** — the runner judged the wrong runtime path or invented
  an expectation not stated by the contract.
- **CONTRACT/EVALUATOR_MISMATCH** — the runtime result is semantically
  compatible, but the evaluator compares implementation labels or levels too
  literally.
- **FIXTURE/ENVIRONMENT_PROBLEM** — the scenario needs an isolated association,
  resolver, operation, provider, or verification seam that the runner does
  not provide.
- **EXPECTED_BEHAVIOR_REQUIRES_REVIEW** — the current runtime deliberately
  stays conservative, but the contract requires behavior that needs a
  provider-backed or otherwise larger capability review.

| ID | Initial | Final | Classification | Evidence and disposition |
|---|---|---|---|---|
| 01 | FAIL | PASS | REAL_BRAIN_DEFECT | A clear expense was actually routed as L2 even though deterministic execution was used. Single-scope structured writes now use L0. |
| 02 | FAIL | PASS | REAL_BRAIN_DEFECT | `دفعت لمحمد` was previously `unknown`; it now becomes `record_expense`, L1 clarification, with no approval or mutation. |
| 03 | FAIL | FAIL | FIXTURE/ENVIRONMENT_PROBLEM | The harness injects a `person_financial_status` relationship clarification where the contract requires an isolated ambiguous-person expense resolver case. The observed high-risk approval state is therefore not evidence against the normal expense path. |
| 04 | FAIL | PASS | REAL_BRAIN_DEFECT | `دفعت 120 جنيه أوبر` was clear enough for deterministic execution but remained L2 because its confidence was below the high-confidence gate. It now uses the amount-known single-scope L0 path. |
| 05 | FAIL | FAIL | CONTRACT/EVALUATOR_MISMATCH | `person_financial_status` is the runtime relationship-read label for the contract’s financial retrieval case. The remaining difference is vocabulary; no unsafe write occurred after the semantic-read risk guard. |
| 06 | FAIL | FAIL | CONTRACT/EVALUATOR_MISMATCH | `recent_activity` is the current contextual retrieval label. The failure is a raw enum comparison, not evidence that the runtime attempted a write or returned an unverified financial claim. |
| 07 | FAIL | PASS | REAL_BRAIN_DEFECT | The parser treated the untyped phrase `اسم ميدو هو محمد أحمد` as an alias. It now stores that form as an explicit fact while retaining typed aliases. |
| 08 | FAIL | PASS | EVALUATOR_DEFECT | The old evaluator bypassed the actual Second Brain candidate path and judged the generic envelope. The runner now observes the candidate dispatch as L1 `inferred_preference`, without mutation. |
| 09 | FAIL | PASS | EVALUATOR_DEFECT | The old evaluator bypassed the actual explicit recall path. It now observes deterministic governed recall as L1, without mutation. |
| 10 | FAIL | PASS | REAL_BRAIN_DEFECT | The parser did not recognize the bare alias form `أبو علي هو محمد`. It now produces an unassociated alias candidate at L1. |
| 11 | FAIL | PASS | EVALUATOR_DEFECT | The typed project-alias command already belongs to the Second Brain path; the old envelope-only observation was wrong. The corrected path reports an L1 alias candidate. |
| 12 | FAIL | FAIL | FIXTURE/ENVIRONMENT_PROBLEM | “Associated alias” requires a real same-tenant canonical association. The current envelope fixture only supplies a generic entity context, so it cannot prove the association behavior. |
| 13 | FAIL | FAIL | CONTRACT/EVALUATOR_MISMATCH | The parser ambiguity was real: expense+project reads were incorrectly marked ambiguous and are now L1. The remaining raw `project_expenses` versus `project_expense_total` difference is an implementation-label mismatch. |
| 14 | FAIL | FAIL | EXPECTED_BEHAVIOR_REQUIRES_REVIEW | Financial-memory conflict synthesis needs an explicit conflict-resolution path. The current conservative runtime exposes a project-expense read, not a synthesized conflict claim; no safe deterministic rewrite was justified by this harness. |
| 15 | FAIL | FAIL | FIXTURE/ENVIRONMENT_PROBLEM | The fixture pre-resolves a relationship and observes the resulting clarification as L0, while the contract expects the context-acquisition stage at L2. A provider-backed or staged relationship fixture is required to distinguish those levels. |
| 16 | BLOCKED | BLOCKED_BY_INFRASTRUCTURE | FIXTURE/ENVIRONMENT_PROBLEM | No isolated conversation plus correction operation/state fixture is available. No fake correction or PASS result was created. |
| 17 | BLOCKED | BLOCKED_BY_INFRASTRUCTURE | FIXTURE/ENVIRONMENT_PROBLEM | Same limitation for person correction: the runner cannot safely create the prior operation state needed to test correction semantics. |
| 18 | BLOCKED | BLOCKED_BY_INFRASTRUCTURE | FIXTURE/ENVIRONMENT_PROBLEM | Same limitation for date correction: no isolated operation/state fixture is available. |
| 19 | FAIL | FAIL | EXPECTED_BEHAVIOR_REQUIRES_REVIEW | Planning obligations require provider-backed planning or a dedicated planner. The deterministic runner correctly avoids inventing obligations and remains `unknown` at L2. |
| 20 | FAIL | FAIL | EXPECTED_BEHAVIOR_REQUIRES_REVIEW | Multi-domain travel and obligations synthesis has the same provider/planner boundary. No deterministic guess was introduced. |
| 21 | FAIL | FAIL | CONTRACT/EVALUATOR_MISMATCH | The safety behavior is now correct: vague action language is L1, low risk, and not approval-gated. The remaining `unknown` versus `unclear_action` label is not a mutation defect. |
| 22 | FAIL | PASS | REAL_BRAIN_DEFECT | Both deterministic and Secretary reminder parsing interpreted bare `بكرة الساعة 5` as 05:00. Shared Arabic clock normalization now resolves it to Cairo 17:00 while preserving explicit evening and 17:00 forms. |
| 23 | BLOCKED | BLOCKED_BY_INFRASTRUCTURE | FIXTURE/ENVIRONMENT_PROBLEM | The gateway has no isolated provider-failure injection seam for this runner. No live provider call was attempted. |
| 24 | BLOCKED | BLOCKED_BY_INFRASTRUCTURE | FIXTURE/ENVIRONMENT_PROBLEM | Provider/runtime failure during expense creation cannot be isolated without an injection seam. No expense was created. |
| 25 | BLOCKED | BLOCKED_BY_INFRASTRUCTURE | FIXTURE/ENVIRONMENT_PROBLEM | Approval expiry needs an isolated operation record and controlled clock. Neither is available in the runner. |
| 26 | BLOCKED | BLOCKED_BY_INFRASTRUCTURE | FIXTURE/ENVIRONMENT_PROBLEM | Verification failure after execution needs an injected verification result. The runner has no such seam and executed nothing. |
| 27 | BLOCKED | BLOCKED_BY_INFRASTRUCTURE | FIXTURE/ENVIRONMENT_PROBLEM | User-cancellation behavior needs an isolated pending operation. No operation was fabricated. |
| 28 | FAIL | CONTRACT/EVALUATOR_MISMATCH | `person_financial_status` is the current runtime label for the contract’s financial relationship retrieval. The observed path stayed read-only; only the conceptual label differs. |
| 29 | FAIL | FIXTURE/ENVIRONMENT_PROBLEM | “Project alias without canonical association” requires the unassociated-alias resolver fixture. The current relationship context produces a project-expense result and cannot prove the required candidate/clarification boundary. |
| 30 | NOT_EXECUTABLE | NOT_EXECUTABLE | EXPECTED_BEHAVIOR_REQUIRES_REVIEW | Proactive scheduling and notification infrastructure are explicitly absent. The scenario remains not executable. |

## Production fixes made

Only runtime defects supported by direct evidence were fixed:

1. **Arabic clock normalization**
   - Shared `normalizeArabicClockHour` behavior is used by deterministic
     intelligence and Secretary reminder parsing.
   - Bare hour `5` in the established Arabic tomorrow-time convention resolves
     to `17`; explicit `مساءً`, `17`, and related forms remain supported.

2. **Incomplete expense recognition**
   - Expense write language without an amount is recognized as
     `record_expense`.
   - It takes the non-mutating L1 clarification path and cannot require
     approval for an operation that has no executable amount.

3. **Deterministic level selection**
   - Clear, amount-known, single-scope expenses use L0.
   - Contextual or multi-entity expense writes retain the existing L2 path.
   - Vague unknown action language uses non-mutating L1 clarification.

4. **Read/write safety**
   - Structured financial reads are no longer made approval-gated solely because
     their Arabic text contains past-tense write-like words.
   - Unknown vague actions cannot become approval-gated writes.

5. **Project expense read ambiguity**
   - Expense-report reads with a compatible project domain are no longer marked
     ambiguous merely because both `expense` and `project` are present.

6. **Second Brain memory and alias parsing**
   - Untyped `اسم ... هو ...` is an explicit fact under the contract.
   - Bare `... هو ...` can produce an alias candidate.
   - Explicitly typed project aliases remain candidates requiring association.

## Evaluator and harness corrections

These changes do not change the Evaluation Contract:

- Unspecified risk expectations are now `null` instead of an invented
  `low` requirement.
- Scenarios 07–11 observe the actual Second Brain command/candidate dispatch
  rather than forcing all inputs through the generic envelope-only path.
- The evaluator test accepts the distinct “no mutation executed” wording for
  those dispatch observations.
- Scenario 22’s reproducibility test now expects the corrected PASS result.

The remaining raw-label mismatches are intentionally visible. They are not
converted to PASS by a broad alias map because doing so would hide whether the
runtime’s conceptual intent taxonomy is complete.

## Blockers and unavailable seams

The following capabilities were not fabricated:

- prior conversation plus editable operation fixtures for scenarios 16–18;
- provider/gateway failure injection for 23–24;
- controlled approval clock and pending-operation fixtures for 25;
- verification-failure injection for 26;
- pending-operation cancellation fixtures for 27;
- proactive scheduling and notification infrastructure for 30.

These are infrastructure or test-seam gaps, not evidence that production
behavior passes or fails.

## Safety, memory, financial, and provider findings

- The isolated evaluation runner performed **zero provider calls**, **zero
  database writes**, **zero reminders**, **zero payments**, **zero
  notifications**, and **zero external contacts**.
- Provider attempts: `0`.
- Logical LLM calls: `0`.
- Input/output/total/cached tokens: `N/A`, not estimated.
- Executable observed strategy distribution:
  - L0: 7
  - L1: 8
  - L2: 5
  - L3: 1
- L0 writes still expose approval requirements; the dry-run harness never
  executes them.
- Missing-amount expenses, vague actions, memory saves, memory recall, and
  alias candidates are non-mutating in the evaluated path.
- Explicit memory and alias parsing remains tenant/policy controlled in the
  existing Second Brain subsystem; the harness only observes parsing and
  dispatch, not persistence.
- No memory was promoted, archived, restored, associated, or used to override
  a financial record during this run.

## Regression checks

Passed after the final changes:

- focused deterministic intelligence, Brain contract, and Second Brain suite:
  **29 passed, 0 failed**;
- Brain evaluation contract tests:
  **4 passed, 0 failed**;
- API server TypeScript typecheck;
- `git diff --check`;
- final 30-scenario runner, producing:
  `results/brain-v1-post-fix.json`.

## Changed files

- `src/lib/deterministic-intelligence.ts`
- `src/lib/brain-contract.ts`
- `src/lib/second-brain.ts`
- `src/lib/secretary.ts`
- `src/lib/phase2.ts`
- `test/deterministic-intelligence.test.ts`
- `test/brain-contract.test.ts`
- `test/second-brain.test.ts`
- `test/brain-evaluation/contract-v1.ts`
- `test/brain-evaluation/evaluator.ts`
- `test/brain-evaluation/evaluation.test.ts`
- `test/brain-evaluation/results/brain-v1-post-fix.json`
- `test/brain-evaluation/reasoning-safety.test.ts`
- `test/brain-evaluation/REASONING-SAFETY.md`

## Isolated reasoning and failure-safety follow-up

The deterministic 30-scenario runner remains intentionally provider-free, so
its `BLOCKED_BY_INFRASTRUCTURE` labels are historical facts about that runner,
not claims that the production failure paths are untested. A separate isolated
fixture suite now covers the missing safety seams without changing
Evaluation Contract v1:

- Planning is measured through a scripted provider in the read-only tool scope.
  The fixture proves ordered-plan response handling and zero writes, but it
  does not claim real-provider planning quality or token usage.
- Memory/financial conflict evidence records structured financial precedence
  and excludes conflicting memory from financial authority.
- Provider timeout recovery and total provider failure preserve provider trace
  evidence and return no-write/error-safe outcomes.
- Expired approvals cannot be claimed; rejected approvals cannot be replayed.
- A post-mutation verification failure is surfaced as `verification.state =
  failed`; the fixture proves there is no verified-success claim or duplicate
  retry.

The detailed axis-by-axis result is in
`test/brain-evaluation/REASONING-SAFETY.md`. These fixture results must remain
separate from the 30-scenario PASS/FAIL count and must not be used to inflate
the contract score.

## Commit provenance

Historical baseline commits:

- `c050257` — fixed contract test suite and harness
- `459b36e` — initial Brain v1 baseline report
- `b8b85e6` — baseline evaluation and memory documentation checkpoint

Post-fix implementation, evaluator corrections, tests, and result artifact:

- `53c85b47ac468442bef31117f475b95e43f81e63`
