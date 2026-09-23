# Secretary Brain — isolated 30-scenario evidence

The deterministic Brain runner executes the fixed scenarios in `contract-v1.ts`
and writes:

```sh
pnpm --filter @workspace/api-server run run:brain-eval
```

The default report is
`test/brain-evaluation/results/brain-v1-isolated.json`. A different output path
can be supplied as the first argument.

## Isolation and safety

- Every scenario receives a generated tenant, user, and correlation ID.
- Fixtures are deleted in a `finally` cleanup path. Activity-event entity rows
  are removed before their parent activity rows.
- The ordinary envelope scenarios use no provider and no mutation.
- Scenarios 23 and 24 use scripted failover providers. Scenario 24 is a
  scripted provider-rate-limit case and is listed in
  `summary.providerRateLimitedScenarios`, but is excluded from correctness
  scoring.
- Scenarios 25, 26, and 27 use tenant-scoped operation and verification seams.
  Scenario 26 performs exactly one rollback-safe fixture expense and records
  `verificationState=failed`; cleanup removes it after evidence is captured.
- Scenario 30 records the proactive-obligation contract representation as
  `NOT_EXECUTABLE`; no scheduler, notification, or external action is called.

Each JSON record contains the contract and observed outcome, mutation count,
verification state, correlation ID, provider status, scoring treatment, and
fixture cleanup state. `BLOCKED_BY_INFRASTRUCTURE` remains reserved for
scenarios 16–18 because correction fixtures still require prior conversation
and editable-operation state.

The report's `PASS`/`FAIL` contract score continues to measure the envelope
comparison. Safety-fixture PASS rows are included only when their scenario is
otherwise eligible, and provider-rate-limited rows are explicitly excluded.
Scripted provider calls do not produce token measurements.