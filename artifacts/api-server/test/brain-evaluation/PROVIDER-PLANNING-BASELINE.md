# Provider-backed planning baseline

This is a new baseline for planning quality and Brain orchestration. It does
not modify Evaluation Contract v1, the 30-scenario runner, or any result
produced for #69.

## Run

```sh
pnpm --filter @workspace/api-server run run:brain-provider-planning
```

The runner writes:

```text
test/brain-evaluation/results/provider-planning-baseline.json
```

It uses eight scenarios in a unique tenant, with real configured providers in
the existing failover order. Every route runs with `dryRun: true`; the fixture
is deleted after the run.

## Paired routes

Each scenario is run through:

1. **Brain route** — the current `Phase2AgentRuntime`, deterministic routing,
   relationship context, Second Brain policy, structured tools, provider
   gateway, and provider trace.
2. **Direct-LLM control** — one real provider request with a deliberately
   limited, explicitly listed context and only `final_response` available.
   It cannot query or mutate the database.

The control group is not used to select a winner. It shows whether the current
orchestration adds context selection, safety boundaries, correction handling,
or useful routing evidence beyond a direct model response.

## Scenario coverage

- obligations next week and ordering;
- travel plus possible obligation conflicts;
- People + Projects + Financial context;
- conflict between a Second Brain memory and a structured financial record;
- incomplete expense requiring clarification;
- clear deterministic expense that should not call the LLM;
- correction after prior conversation context;
- real person ambiguity.

## Per-request evidence

The JSON report records, for both routes where applicable:

- Brain strategy, intent, confidence, risk, required/selected/excluded context;
- Second Brain retrieval trace and structured-record precedence;
- provider/model, logical calls, HTTP attempts, fallback, token usage;
- request/context/tool-schema size when the gateway reports it;
- final answer and answer-quality criteria;
- safety row counts, write tools, approval/mutation preparation;
- provenance request/conversation/scenario identifiers.

Provider failure or rate limiting is `NOT_MEASURED`; it is not counted as a
planning failure. Real-provider quality is never inferred from a scripted
gateway.

## Interpretation

The report is intentionally a capability matrix, not `PASS = n / 8`.
Interpret the following independently:

- deterministic routing;
- context selection;
- multi-source reasoning;
- planning quality;
- memory/record conflict handling;
- clarification;
- safety;
- LLM calls and token cost;
- fallback behavior.

Each scenario also includes the raw semantic parse produced from the exact
scenario message, plus a paired Brain-versus-control comparison. The
comparison keeps source selection, excluded context, hallucination guards,
structured-record authority, clarification behavior, both raw answers, and
the existing scenario evaluation together.

If a route is blocked by a provider rate limit, its route status is
`NOT_MEASURED_PROVIDER_LIMIT`; it is not scored as PASS or FAIL and its pair is
marked incomplete. Other provider/orchestration failures remain
`NOT_MEASURED` with their raw error code. The runner invokes each route once;
the existing provider failover is bounded by the configured provider order and
there is no runner-level retry loop.

No Brain reasoning change is made by this runner. Any optimization or prompt
change must be a later, separately identified experiment.