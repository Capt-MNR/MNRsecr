# NLU Evaluation Harness

This is a test-only harness for evaluating the real LLM intent and tool selection. It does not add a production route, parser, classifier, tool, routing layer, retry, or UI behavior.

## Dataset

`dataset.json` contains 36 stable Arabic cases:

- `A`: expense intent and Egyptian-Arabic variations.
- `B`: explicit create-person requests.
- `C`: ambiguous messages that should clarify without context.
- `D`: expense requests containing person, amount, and project.
- `E`: correction/reference messages. These are marked `context_required`; without a persisted conversation fixture they are reported separately and excluded from accuracy.
- `F`: negative guards preventing expense/create-person confusion and accidental person creation.

The dataset is versioned with the code. Do not edit expected results casually; update the version and record the reason when a prompt or tool contract intentionally changes.

## Safety model

The harness calls `Phase2AgentRuntime.run(..., { dryRun: true })` directly from the test worker. It does not call the production HTTP route and does not approve operations.

In dry-run mode:

- write tools return a preview instead of creating an approval operation;
- conversation turns and idempotency responses are not persisted;
- read-only tool calls may still read the configured database;
- every report contains `writeOccurred: false`;
- a no-write violation is reported if the runtime logs an approval/write path.

The runner refuses to make provider calls unless `--confirm-live` is present. It also requires an explicit case selection or an explicit bounded `--all --max-cases N`.

## Manual commands

Run one low-quota smoke case:

```bash
pnpm --filter @workspace/api-server run test:intent-eval -- \
  --provider groq --case A01 --confirm-live
```

Run selected cases against Gemini:

```bash
pnpm --filter @workspace/api-server run test:intent-eval -- \
  --provider gemini --case A01,B01,C01 --confirm-live
```

Run a bounded failover sample. Failover mode uses Groq as primary and Gemini as fallback:

```bash
pnpm --filter @workspace/api-server run test:intent-eval -- \
  --provider failover --all --max-cases 3 --confirm-live
```

Run the full 36-case dataset only when provider capacity is available:

```bash
pnpm --filter @workspace/api-server run test:intent-eval -- \
  --provider groq --all --max-cases 36 --confirm-live
```

Repeat separately with `--provider gemini` and `--provider failover`. The runner never runs all three modes in one command, which prevents accidental quota multiplication.

Optional flags:

- `--out path.json` saves the report to a chosen path.
- `--label before|after` labels the report for comparison.
- `--baseline path.json` prints Before/After accuracy and cost deltas.
- `--dataset path.json` evaluates a compatible dataset file.
- `INTENT_EVAL_TENANT_ID` and `INTENT_EVAL_USER_ID` scope read-only fixtures.
- `INTENT_EVAL_CONVERSATION_ID` marks context-required cases as having an externally prepared conversation fixture. The harness itself never creates that fixture.

## Reported measurements

Each case records:

- expected and actual intent;
- expected primary tool, all observed tools, and tool arguments;
- whether clarification was requested;
- logical LLM calls;
- actual HTTP attempts and attempts by provider;
- provider and model;
- fallback and fallback reason;
- latency, including p50 and p95;
- raw provider usage metadata when returned;
- normalized input/output/total/cached token counts;
- request bytes, prompt/tool/conversation sizes;
- cache hit/miss and cached token metrics;
- approval reached, write occurred, and no-write violation;
- per-case accuracy fields and exclusion status.

The summary reports:

- intent accuracy;
- tool-selection accuracy;
- clarification accuracy;
- provider errors;
- cases excluded because context was not provided;
- total logical calls and HTTP attempts;
- total tokens and request bytes;
- average/p50/p95 latency and conversation size;
- cache hit/miss cases and cached tokens;
- no-write violations.

Provider errors are not counted as NLU failures. A run that never reaches a real LLM reports zero evaluated cases rather than claiming a passing or failing NLU score.