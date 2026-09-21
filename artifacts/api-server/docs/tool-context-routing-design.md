# Safe tool-context routing design

**Status:** Design proposal only. This document does not change production routing.

## Goal and non-goals

Every provider request currently has to consider the whole application tool catalog on
some paths. Sending fewer unrelated definitions should reduce prompt size and tool
confusion, but it must not change what the secretary is allowed to do, lose the
referent in a follow-up such as `ده` or `التاني`, replay a write after failover, or
turn an uncertain approval into a completed write.

This proposal compares three approaches and recommends a staged hybrid:

1. use reviewed tool groups for high-confidence requests;
2. use a small, no-tools route decision only when the message or conversation context
   needs disambiguation;
3. use the full catalog whenever the route is uncertain or a tool falls outside the
   selected group.

The proposal intentionally does not add a new regex/parser classifier, alter provider
selection, or enable a feature flag. The existing `classifyToolScope` behavior is
evidence for the fallback mechanics, not approval to expand its production use.

## Current facts and measurement baseline

The relevant contracts are in:

- `artifacts/api-server/src/lib/phase2.ts`
- `artifacts/api-server/src/lib/conversation-memory.ts`

The conversation memory already exposes bounded recent turns, a compact summary, and
structured referents such as `lastPerson`, `lastProject`, `lastExpense`, candidate
entities, and saved IDs. It explicitly says that these are interpretation aids and
that IDs must be verified through tools. A route must preserve this context; it must
not reduce the current message to an isolated intent label.

The runtime already has useful safety behavior:

- a scope can widen when the model requests an unavailable tool;
- provider failover keeps the same request and already executed tool results;
- application writes run through `executeTool`, where approval, tenant ownership,
  idempotency, and verification are enforced;
- final responses are a separate tool-only finalization path.

The current source contains 43 `tool(...)` definitions, while the task brief says 29
and an existing scope test still expects 29 for `full`. The catalog in
`phase2.ts` is the source of truth for a future implementation. The old number must
not be used for savings or acceptance claims until the test and catalog are reconciled
as a separate change.

Available measurements from the existing intent report are useful but are not a
complete before/after benchmark:

- the 12-tool expense scope serialized about 5,779 tool-definition characters per
  provider attempt;
- the 6-tool person scope serialized about 2,410 tool-definition characters per
  provider attempt;
- a two-call expense case recorded about 15.2 KB at its largest request and a
  median latency of about 447 ms in that run;
- that report mixed provider and cache conditions, so it must not be treated as a
  causal routing result.

For planning only, the current scope sizes imply roughly 72% fewer definitions for a
12-tool financial pack, 86% fewer for a 6-tool pack, and 91% fewer for a 4-tool pack
compared with the current 43-definition catalog. Character and token savings must be
measured from serialized provider payloads because schemas are not equally sized.

## Option A: reviewed grouped tool sets

### Design

Create a registry of overlapping, named packs. Every pack includes
`final_response`, and every route that may need legal saved context includes
`recall_context`. The packs should be defined from the complete live catalog, not
copied from the old expense scope.

Suggested packs:

- **Core read:** `final_response`, `recall_context`, and the safe query/resolution
  tools needed for a read-only answer.
- **Financial:** all expense and financial-graph operations, including
  `record_expense`, financial parties, obligations, payments, settlements, donations,
  receivables, payment links, their correction tools, expense queries/rankings/totals,
  and exact expense deletion.
- **People and projects:** person/project CRUD, person-project links, typed
  relationships, and exact deletion of those records.
- **Planning:** tasks, commitments, reminders, and their queries and corrections.
- **Agent Work:** the ongoing-work creation path, together with the read tools it
  needs. It must not imply that an external source or action is available.

Packs may overlap. For example, a financial request mentioning a person receives
financial tools plus person resolution, not person creation merely because a name
appears. A planning request that names a person or project receives the corresponding
resolver tools. A request spanning two domains receives the union of both packs.

The route must begin with at least the narrowest safe read/resolution set. It must
never hide `find_person` or `find_project` when the current message or retained
conversation state contains a person/project reference that needs verification.

### Strengths

- No extra model call on clear requests.
- Predictable definition and payload savings.
- Simple to inspect, benchmark, and cache by `(provider, model, pack-set,
  finalResponseOnly)`.
- Compatible with the existing out-of-scope widening behavior.

### Risks

- A hard-coded message classifier can fail on Arabic dialects, negation, implicit
  financial language, or a follow-up with no repeated noun.
- The existing lexical scope patterns are not safe as the sole route: they do not
  represent all newer financial tools, and a message can contain multiple domains.
- Adding a new tool without adding it to every applicable pack creates a hidden
  capability gap.

### Safety position

Use grouped sets only when the route has a high-confidence domain and no unresolved
reference or multi-domain ambiguity. A missing tool must widen to full before the
next model call; it must not be treated as evidence that the user's request is
invalid.

## Option B: lightweight LLM-mediated route

### Design

Before the normal tool-enabled call, ask a small, bounded routing model for a strict
JSON decision. The router receives the current message plus the same bounded
conversation context needed to understand references. It receives no application
tools and cannot write data.

The output should contain only:

```json
{
  "mode": "grouped" | "full",
  "domains": ["financial", "people_projects", "planning", "agent_work"],
  "referenceDependent": true,
  "ambiguous": false,
  "confidence": 0.0
}
```

The server validates the enum, domain list, and confidence range, then maps domains
to server-owned packs. The router never returns a tool name, an ID, tool arguments, a
permission decision, or an approval decision. A malformed, timed-out, unavailable,
low-confidence, ambiguous, reference-dependent, or multi-interpretation result maps
to `full`; it does not retry routing indefinitely.

The router may use existing structured semantic information as an input, but it must
not become a second source of truth for intent execution. The normal provider still
chooses tools, and the server still validates and executes them.

### Strengths

- Handles Arabic synonyms, dialect variation, and implied intent better than a new
  regex-only route.
- Can see that `ده`, `التاني`, `خليه`, or `الفلوس دي` depends on the previous turn.
- Keeps application tools and write decisions out of the routing call.

### Risks

- Adds one model call, latency, cost, and another provider failure point.
- A wrong but confident route can omit a needed tool unless ambiguity and widening
  rules are strict.
- A router call itself can fail over. If its fallback has a different answer, the
  route must still be treated as one request-scoped decision and logged.

### Safety position

Use this only as an advisory pack selector. It is not safe to let the router directly
produce an executable plan or to trust its domain label when the message relies on
an unresolved referent. Reference-dependent decisions go directly to full scope
unless the required prior entity and domain are unambiguous and verified.

## Option C: full-tool fallback

### Design

Keep the current full catalog as the correctness path. Start with a group only when
the route is safe, then widen to full when:

- the router is unavailable or below its confidence threshold;
- the message spans domains or includes an unresolved pronoun/reference;
- the selected model requests a tool outside the pack;
- a tool result reveals a second domain is required;
- the selected pack is stale, invalid, or missing a newly registered tool.

Widening is monotonic for the request. Once widened, subsequent calls use full scope.
The tool call that caused widening is not executed until the next model response is
generated with the full definitions. This preserves the existing server-side
allowlist rather than silently executing an out-of-scope call.

### Strengths

- Preserves a correctness escape hatch.
- Makes failures explicit and observable.
- Works with new tools while their pack membership is being reviewed.

### Risks

- Ambiguous requests still pay the full context cost.
- If the initial group is too aggressive, the request needs an additional model
  round, which can cost more latency than it saves.
- A weak implementation could widen after executing a write; that is prohibited.

### Safety position

This is mandatory even if Option A or B is adopted. Full scope is the fallback for
uncertainty, not a last-resort error response.

## Recommended staged flow

1. Load the existing conversation snapshot and build the same
   `conversationContextMessages` used by the normal request. Do not strip the
   summary, structured state, recent assistant tool results, or IDs.
2. Handle an approval confirmation/rejection by its operation ID through the existing
   approval route. Do not send approval actions through the context router.
3. For a normal turn, run the bounded advisory route:
   - use a reviewed grouped pack only for one clear domain with no ambiguity;
   - add resolver/read packs when a named entity or retained referent needs checking;
   - choose full scope for references that cannot be resolved from existing state,
     cross-domain language, negation/uncertainty, or any router failure.
4. Call the normal provider with the selected pack and the complete bounded message
   history.
5. If the provider requests an unavailable tool, widen before executing that call.
   Log the old pack, requested tool, and new pack.
6. Keep the pack decision request-scoped. Provider failover receives the same
   messages, tool results, and effective scope. It must not rerun routing or replay a
   completed tool call.
7. Preserve the current `executeTool` path for every write. A narrow pack never
   grants permission; a full pack never bypasses approval.

## Required safety cases

### Ambiguous requests

Messages such as “اعمل مشروع جديد وفكرني بكرة أراجعه” select full scope or a
clarification path because they contain two write domains. The model must still ask
for missing details and resolve names. The router must not choose one domain based
on the first matching word.

### Follow-up references

For “قصدي ده”, “عدّل التاني”, or “خليه من غير اسم”, the route must carry recent
turns, summary, structured state, and the last tool result. It must require an exact
ID from verified state or a lookup tool before a write. If there are multiple
candidate people/projects/expenses, use full scope and ask for clarification rather
than selecting by ordinal or recency alone.

### Provider failover

The fallback provider receives the same effective tool set and all prior assistant
tool calls and tool results. A transient provider failure may move the next LLM call
to a later provider, but it must never re-execute the application tool that already
ran. If the first provider failed before any usable response, the fallback may use
the same pack. If a pack widened, the widened pack is the one sent to the fallback.

### Approval writes

Routing cannot mark an operation approved. Write tools remain behind the existing
pending-operation and approval executor path, with tenant ownership, idempotency,
row-version, and verification checks unchanged. The route must never classify a
write as safe merely because the tool was included. An approval response must
persist its post-approval result separately so a later correction sees committed
state.

## Savings and latency plan

These are planning estimates, not promises:

| Route | Current catalog comparison | Expected definition reduction | Latency effect |
| --- | ---: | ---: | --- |
| Full fallback | 43 of 43 | 0% | baseline |
| Read/core pack | 9 of 43 | about 79% by count | no routing overhead |
| Financial pack | 12 of 43 in the existing baseline | about 72% by count; expand for newer financial tools | likely lower provider payload time |
| 6-tool domain pack | 6 of 43 | about 86% by count | no routing overhead |
| 4-tool domain pack | 4 of 43 | about 91% by count | no routing overhead |
| LLM-mediated route | depends on chosen pack | same as selected pack | adds one bounded model call |

The financial row is intentionally conservative: the existing 12-tool scope is not
complete for the current financial catalog. An implementation must measure the
complete financial pack, not claim savings from omitting supported financial tools.

Before enabling routing, collect separate per-attempt measurements for full, grouped,
and router-plus-grouped branches on the same isolated tenant and deterministic
conversation fixtures. Record tool-definition characters/count, request bytes,
input/output tokens when available, logical calls, HTTP attempts, route widening,
provider fallback, p50/p95 latency, tool-selection accuracy, clarification accuracy,
and write/no-write violations. Provider-rate-limited branches are `NOT_MEASURED`,
not zero-cost or zero-latency successes.

The first rollout should be shadow-only: compute and log the proposed route while
still sending the approved full catalog. Then compare a narrow canary for read-only
and single-domain dry-run cases. Do not narrow approval-bearing writes until
reference, failover, and idempotency tests pass.

## Implementation gate

No production routing change should be made from this document alone. Approval
requires:

1. reconciling the 29-versus-43 catalog discrepancy;
2. reviewing the complete pack membership, especially financial and relationship
   tools;
3. adding tests for ambiguous Arabic follow-ups, missing references, widening before
   execution, provider failover after tool results, and approval idempotency;
4. running isolated before/after measurements with the existing attempt-level
   instrumentation;
5. explicitly accepting the latency/cost tradeoff of an LLM-mediated route if that
   option is selected.
