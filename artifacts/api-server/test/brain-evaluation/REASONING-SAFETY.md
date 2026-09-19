# Secretary Brain — reasoning and failure-safety evidence

Run date: 2026-09-19  
Contract: Evaluation Contract v1 remains unchanged  
Test harness: `test/brain-evaluation/reasoning-safety.test.ts`

## Diagnostic result

This report separates planning quality from failure safety. A passing safety
fixture does not claim that a real provider is good at planning, and a planning
fixture does not authorize a write.

| Axis | Result | Evidence |
|---|---|---|
| Planning protocol and no-write boundary | PASS | A scripted provider completed a planning turn in the read-only tool scope; the response contained an ordered plan and an explicit no-automatic-change boundary. The isolated tenant had zero expenses, conversation-memory rows, and operations. |
| Real-provider planning quality | NOT MEASURED | The fixture intentionally uses a scripted gateway. It proves the runtime protocol and safety boundary, not LLM planning quality or token efficiency. |
| Memory/financial conflict safety | PASS | The Brain envelope records structured financial precedence, excludes the conflicting memory as a financial authority, and keeps the path non-approval-gated. |
| Provider failover safety | PASS | A timeout recovered through the fallback provider with trace evidence. When both providers failed, the runtime returned a classified safe error and did not claim a completed action. |
| Approval expiry | PASS | An expired pending operation was returned as `expired`, could not be claimed, and produced no expense. |
| User cancellation | PASS | A pending operation became `rejected`; replay could not claim it and produced no expense. |
| Post-mutation verification failure | PASS | An isolated expense mutation returned `verification.state=failed`; exactly one row existed and the fixture did not retry it. |

## What this proves

- Provider attempts and fallback decisions are observable through
  `action.providerTrace`.
- Provider failure is not converted into a fabricated answer or a successful
  mutation.
- Approval state transitions are authoritative and tenant-scoped.
- Verification failure remains uncertainty. It is not reported as verified and
  is not used as a reason to create a duplicate.
- The memory path cannot override structured financial authority in the Brain
  decision envelope.
- All runtime tests use generated tenant and user identities. They do not use
  production or shared evaluation data.

## What remains open

- Scenarios 19–20 now have a separate real-provider runner in
  `REAL-PLANNING.md`. The first run passed the travel/date-clarification rubric
  for scenario 20; scenario 19 was `NOT_MEASURED` after a provider output
  parsing failure, so no planning-quality claim is made for it.
- The current read-only scope exposes reminders and bounded context but not
  direct commitment/task query tools; the runner records this coverage limit
  instead of pretending that all seeded obligation categories were observed.
- Scenarios 16–18 still need a prior conversation/operation fixture for
  correction reconciliation.
- Scenario 30 remains not executable because proactive scheduling and
  notification infrastructure are outside the current product scope.
- Token measurements remain `N/A` for scripted providers. They must not be
  estimated from fixture text.

## Reproduction

```sh
pnpm --filter @workspace/api-server run test:brain-reasoning-safety
pnpm --filter @workspace/api-server run test:brain-eval
```

The 30-scenario contract runner remains a separate deterministic baseline. Its
PASS/FAIL counts must not be combined with the fixture safety results above.