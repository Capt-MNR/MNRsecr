import assert from "node:assert/strict";
import test from "node:test";
import { budgetContext } from "../src/lib/context-budgeter.ts";
import { clearDecisionCache, decisionCacheKey, readDecision, writeDecision } from "../src/lib/decision-cache.ts";
import { resolveFromCandidates } from "../src/lib/entity-resolver.ts";
import { buildDeterministicPlan } from "../src/lib/deterministic-plans.ts";
import { routeLocally } from "../src/lib/local-router.ts";
import { routeProvider } from "../src/lib/provider-router.ts";
import {
  GeminiModelGateway,
  classifyToolScope,
  isDeterministicScheduleQuestion,
  looksLikeInternalStructuredResponse,
  normalizeProviderUsage,
  type GatewayRequestMetrics,
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

test("Gemini context cache reuses the same variant and reports cached usage", async () => {
  const previousFetch = globalThis.fetch;
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const cachedContentBodies: Array<Record<string, unknown>> = [];
  const generateBodies: Array<Record<string, unknown>> = [];
  const cachedContentName = "cachedContents/phase2-test-variant";
  const makeMetrics = (): GatewayRequestMetrics => ({
    logicalLlmCalls: 1,
    httpAttempts: 0,
    httpAttemptsByProvider: {},
    retryCount: 0,
    providerFallbackAttempts: 0,
    modelFallbackAttempts: 0,
    requestBytesByProvider: {},
    maxRequestBytes: 0,
    systemPromptChars: 0,
    toolDefinitionsChars: 0,
    toolDefinitionsCount: 0,
    maxConversationChars: 0,
    attempts: [],
  });

  try {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (url.endsWith("/cachedContents")) {
        cachedContentBodies.push(body);
        return new Response(JSON.stringify({ name: cachedContentName }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      generateBodies.push(body);
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              functionCall: {
                name: "final_response",
                args: { kind: "answer", message: "تم" },
              },
            }],
          },
        }],
        usageMetadata: {
          promptTokenCount: 160,
          candidatesTokenCount: 12,
          totalTokenCount: 172,
          cachedContentTokenCount: body.cachedContent ? 128 : 0,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const gateway = new GeminiModelGateway();
    const toolScope = classifyToolScope("إيه عندي النهارده؟");
    const messages = [{ role: "user" as const, text: "اعرض ملخص اليوم" }];
    const firstMetrics = makeMetrics();
    const secondMetrics = makeMetrics();

    await gateway.generate(messages, {
      requestId: "gemini-cache-first",
      callNumber: 1,
      toolCallsExecuted: 0,
      toolScope,
      metrics: firstMetrics,
    });
    await gateway.generate(messages, {
      requestId: "gemini-cache-second",
      callNumber: 1,
      toolCallsExecuted: 0,
      toolScope,
      metrics: secondMetrics,
    });

    assert.equal(cachedContentBodies.length, 1);
    const cachedBody = cachedContentBodies[0];
    assert.equal(typeof (cachedBody.systemInstruction as { parts?: unknown[] }).parts?.[0], "object");
    const cachedTools = (cachedBody.tools as Array<{ functionDeclarations?: unknown[] }>)[0]
      ?.functionDeclarations;
    assert.ok(cachedTools && cachedTools.length > 0);
    assert.equal(generateBodies.length, 2);
    assert.deepEqual(
      generateBodies.map((body) => body.cachedContent),
      [cachedContentName, cachedContentName],
    );
    assert.equal(firstMetrics.cacheMiss, true);
    assert.notEqual(firstMetrics.cacheHit, true);
    assert.equal(secondMetrics.cacheHit, true);
    assert.equal(secondMetrics.cacheMiss, undefined);
    assert.equal(secondMetrics.cachedTokens, 128);
    assert.equal(secondMetrics.attempts[0]?.cachedTokens, 128);
    assert.equal(secondMetrics.attempts[0]?.cacheHit, true);
    assert.ok(
      Number.isFinite(secondMetrics.attempts[0]?.latencyMs)
        && (secondMetrics.attempts[0]?.latencyMs ?? Infinity) < 1_000,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
  }
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