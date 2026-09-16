import assert from "node:assert/strict";
import test from "node:test";
import { budgetContext } from "../src/lib/context-budgeter.ts";
import { clearDecisionCache, decisionCacheKey, readDecision, writeDecision } from "../src/lib/decision-cache.ts";
import { resolveFromCandidates } from "../src/lib/entity-resolver.ts";
import { buildDeterministicPlan } from "../src/lib/deterministic-plans.ts";
import { routeLocally } from "../src/lib/local-router.ts";
import { routeProvider } from "../src/lib/provider-router.ts";
import {
  isDeterministicScheduleQuestion,
  looksLikeInternalStructuredResponse,
  normalizeProviderUsage,
} from "../src/lib/phase2.ts";

process.env.AI_PROVIDER = "development";
delete process.env.AI_PRIMARY_PROVIDER;
delete process.env.AI_FALLBACK_PROVIDER;
delete process.env.AI_SECONDARY_FALLBACK_PROVIDER;

test("all optimization layers preserve their safe default state", () => {
  delete process.env.CTX_BUDGETER_ENABLED;
  delete process.env.LOCAL_ROUTER_ENABLED;
  delete process.env.DETERMINISTIC_PLANS_ENABLED;
  delete process.env.DECISION_CACHE_ENABLED;
  delete process.env.PROVIDER_ROUTING_ENABLED;

  const budgeted = budgetContext(
    [{ role: "user", text: "رسالة قصيرة" }],
    [{ name: "one" }, { name: "two" }],
  );
  assert.equal(budgeted.truncated, false);
  assert.equal(routeLocally("دفعت لمحمد 7500"), null);
  assert.equal(buildDeterministicPlan("عايز تقرير بالمصروفات"), null);
  assert.equal(readDecision("missing"), undefined);
  assert.equal(routeProvider("دفعت لمحمد 7500").enabled, false);
});

test("provider usage normalization preserves null for unavailable fields", () => {
  assert.deepEqual(
    normalizeProviderUsage("gemini", {
      promptTokenCount: 120,
      candidatesTokenCount: 30,
      totalTokenCount: 150,
      cachedContentTokenCount: 40,
    }),
    {
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cachedTokens: 40,
      completeness: "complete",
    },
  );
  assert.deepEqual(
    normalizeProviderUsage("groq", {
      prompt_tokens: 80,
      completion_tokens: 20,
      total_tokens: 100,
    }),
    {
      inputTokens: 80,
      outputTokens: 20,
      totalTokens: 100,
      cachedTokens: null,
      completeness: "complete",
    },
  );
  assert.deepEqual(
    normalizeProviderUsage("cohere", { billed_units: { input_tokens: 12 } }),
    {
      inputTokens: 12,
      outputTokens: null,
      totalTokens: null,
      cachedTokens: null,
      completeness: "partial",
    },
  );
  assert.deepEqual(
    normalizeProviderUsage("mistral", undefined),
    {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cachedTokens: null,
      completeness: "unavailable",
    },
  );
});

test("context budgeter keeps required messages and caps tool definitions when enabled", () => {
  process.env.CTX_BUDGETER_ENABLED = "true";
  process.env.CTX_BUDGET_MAX_CONVERSATION_CHARS = "100";
  process.env.CTX_BUDGET_MAX_TOOL_DEFINITIONS = "1";
  const result = budgetContext(
    [
      { role: "system", text: "system" },
      { role: "user", text: "user" },
      { role: "tool", text: "x".repeat(300) },
    ],
    [{ name: "one" }, { name: "two" }],
  );
  assert.equal(result.tools.length, 1);
  assert.equal(result.messages.some((message) => message.role === "system"), true);
  assert.equal(result.messages.some((message) => message.role === "user"), true);
  assert.equal(result.truncated, true);
  delete process.env.CTX_BUDGETER_ENABLED;
  delete process.env.CTX_BUDGET_MAX_CONVERSATION_CHARS;
  delete process.env.CTX_BUDGET_MAX_TOOL_DEFINITIONS;
});

test("local router and deterministic plans only act on high-signal requests", () => {
  process.env.LOCAL_ROUTER_ENABLED = "true";
  process.env.DETERMINISTIC_PLANS_ENABLED = "true";
  const expense = routeLocally("دفعت لمحمد 7500");
  assert.equal(expense?.intent, "expense");
  assert.equal(expense?.safeToExecute, true);
  const gulfExpense = routeLocally("عطيت خالد ١٬٢٠٠ ريال");
  assert.equal(gulfExpense?.intent, "expense");
  assert.equal(gulfExpense?.args?.amountMinor, 120_000);
  assert.equal(gulfExpense?.args?.currency, "SAR");
  assert.equal(routeLocally("ما تسجلش مصروف ٥٠٠ لمحمد"), null);
  assert.equal(buildDeterministicPlan("محمد")?.kind, "clarification");
  assert.equal(buildDeterministicPlan("فكرني بالمكالمة")?.kind, "none");
  delete process.env.LOCAL_ROUTER_ENABLED;
  delete process.env.DETERMINISTIC_PLANS_ENABLED;
});

test("resolver returns exact matches and refuses close ties", () => {
  const candidates = [
    { id: "a", name: "محمد علي", nameKey: "محمد علي" },
    { id: "b", name: "محمد عادل", nameKey: "محمد عادل" },
  ];
  const exact = resolveFromCandidates("person", "محمد علي", candidates);
  assert.equal(exact.selected?.id, "a");
  assert.equal(exact.matchType, "exact");
  const ambiguous = resolveFromCandidates("person", "محمد", candidates);
  assert.equal(ambiguous.matchType, "ambiguous");
  assert.equal(ambiguous.selected, undefined);
});

test("decision cache is scoped by flag and never stores writable decisions", () => {
  process.env.DECISION_CACHE_ENABLED = "true";
  clearDecisionCache();
  const key = decisionCacheKey("router", { message: "محمد" }, { tenantId: "t", userId: "u" });
  assert.equal(writeDecision("router", key, { intent: "clarification" }), true);
  assert.deepEqual(readDecision(key), { intent: "clarification" });
  assert.equal(writeDecision("router", "write-key", { intent: "expense" }, { writable: true }), false);
  delete process.env.DECISION_CACHE_ENABLED;
  clearDecisionCache();
});

test("provider router reports a recommendation without changing providers by default", () => {
  delete process.env.PROVIDER_ROUTING_ENABLED;
  const route = routeProvider("دفعت لمحمد 7500");
  assert.equal(route.provider, "gemini");
  assert.equal(route.enabled, false);
});

test("schedule questions are deterministic and write requests are excluded", () => {
  assert.equal(isDeterministicScheduleQuestion("عندنا مواعيد النهارده؟"), true);
  assert.equal(isDeterministicScheduleQuestion("دعوة الفرح ميعادها امته؟"), true);
  assert.equal(isDeterministicScheduleQuestion("فكرني بكرة أكلم محمد"), false);
});

test("internal provider payloads are never accepted as user-facing text", () => {
  assert.equal(
    looksLikeInternalStructuredResponse('{"candidateProjects":[],"toolResult":{"ok":true}}'),
    true,
  );
  assert.equal(
    looksLikeInternalStructuredResponse("تمام، عندك موعد الساعة 5."),
    false,
  );
});