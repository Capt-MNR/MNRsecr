import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  db,
  expensesTable,
  projectsTable,
  conversationMemoryTable,
  secretaryOperationsTable,
} from "@workspace/db";
import {
  FailoverModelGateway,
  GeminiModelGateway,
  Phase2AgentRuntime,
  GroqModelGateway,
  MistralModelGateway,
  DeepSeekModelGateway,
  CohereModelGateway,
  MnrInferenceRouter,
  OpenRouterModelGateway,
  configuredRouteOrder,
  classifyToolScope,
  configuredProviderOrder,
  executeStructuredTool,
  toCohereSchema,
  toGeminiSchema,
  toOpenAiSchema,
  type ConversationMessage,
  type GatewayCallContext,
  type GatewayRequestMetrics,
  type GatewayResponse,
  type ModelGateway,
  type ProviderName,
} from "../src/lib/phase2.ts";
import {
  providerResponseError,
  providerTimeoutError,
  SecretaryError,
} from "../src/lib/error-contract.ts";
import type { Identity } from "../src/lib/secretary.ts";
import {
  deterministicExpensePeriod,
  isExpenseTotalCorrectionRequest,
  isGlobalExpenseTotalRequest,
} from "../src/lib/expense-report.ts";

process.env.AI_PROVIDER = "development";
delete process.env.AI_PRIMARY_PROVIDER;
delete process.env.AI_FALLBACK_PROVIDER;
delete process.env.AI_SECONDARY_FALLBACK_PROVIDER;

type GatewayCall = {
  messages: ConversationMessage[];
  context: GatewayCallContext;
};

type Script = (call: GatewayCall, callNumber: number) => Promise<GatewayResponse> | GatewayResponse;

class ScriptedProvider implements ModelGateway {
  readonly modelName: string;
  readonly calls: GatewayCall[] = [];

  constructor(
    readonly provider: ProviderName,
    private readonly script: Script,
  ) {
    this.modelName = `scripted-${provider}`;
  }

  async generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse> {
    const call = { messages, context };
    this.calls.push(call);
    return this.script(call, this.calls.length);
  }
}

function finalResponse(message = "تم تنفيذ الطلب بأمان."): GatewayResponse {
  return {
    text: "",
    toolCalls: [{
      id: "final-response",
      name: "final_response",
      args: { kind: "answer", message },
    }],
  };
}

function toolCall(name: string, args: Record<string, unknown>): GatewayResponse {
  return {
    text: "",
    toolCalls: [{ id: `${name}-call`, name, args }],
  };
}

function identity(label: string): Identity {
  return {
    tenantId: `failover-${label}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    userId: "failover-user",
  };
}

test("Gemini-only and Groq-only configurations complete through the same gateway contract", async () => {
  for (const provider of ["gemini", "groq"] as const) {
    const selected = new ScriptedProvider(provider, () => finalResponse());
    const gateway = new FailoverModelGateway({ [provider]: selected }, [provider]);
    const result = await new Phase2AgentRuntime(gateway).run(identity(`single-${provider}`), {
      message: "عايز رد طبيعي بالعربي",
      requestId: `single-${provider}-request`,
    }, { dryRun: true });

    assert.equal(result.provider, provider);
    assert.equal(result.response?.kind, "answer");
    assert.equal(result.action?.providerTrace?.fallbackOccurred, false);
    assert.equal(selected.calls.length, 1);
  }
});

test("provider order is configurable and defaults to Gemini before Groq when both keys exist", () => {
  const keys = [
    "AI_PROVIDER_CATALOG",
    "AI_PROVIDER",
    "AI_PRIMARY_PROVIDER",
    "AI_FALLBACK_PROVIDER",
    "AI_SECONDARY_FALLBACK_PROVIDER",
    "AI_ROUTE_ORDER",
    "AI_PRIMARY_ROUTE",
    "AI_FALLBACK_ROUTE",
    "AI_SECONDARY_FALLBACK_ROUTE",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "MISTRAL_API_KEY",
    "COHERE_API_KEY",
    "DEEPSEEK_API_KEY",
    "QWEN_API_KEY",
    "OPENROUTER_API_KEY",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.MISTRAL_API_KEY = "test-mistral-key";
    process.env.COHERE_API_KEY = "test-cohere-key";
    for (const key of [
      "AI_PROVIDER_CATALOG",
      "AI_ROUTE_ORDER",
      "AI_PRIMARY_ROUTE",
      "AI_FALLBACK_ROUTE",
      "AI_SECONDARY_FALLBACK_ROUTE",
      "DEEPSEEK_API_KEY",
      "QWEN_API_KEY",
      "OPENROUTER_API_KEY",
    ] as const) delete process.env[key];
    delete process.env.AI_PROVIDER;
    delete process.env.AI_PRIMARY_PROVIDER;
    delete process.env.AI_FALLBACK_PROVIDER;
    delete process.env.AI_SECONDARY_FALLBACK_PROVIDER;
    assert.deepEqual(configuredProviderOrder(), ["gemini", "groq", "mistral", "cohere"]);

    process.env.AI_PRIMARY_PROVIDER = "groq";
    process.env.AI_FALLBACK_PROVIDER = "gemini";
    assert.deepEqual(configuredProviderOrder(), ["groq", "gemini", "mistral", "cohere"]);

    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    delete process.env.AI_PRIMARY_PROVIDER;
    delete process.env.AI_FALLBACK_PROVIDER;
    delete process.env.AI_SECONDARY_FALLBACK_PROVIDER;
    assert.deepEqual(
      configuredProviderOrder(),
      ["gemini", "groq", "mistral", "cohere", "openrouter"],
    );

    process.env.AI_PRIMARY_PROVIDER = "gemini";
    process.env.AI_PRIMARY_ROUTE = "direct:groq";
    process.env.AI_FALLBACK_ROUTE = "gateway:openrouter";
    process.env.AI_ROUTE_ORDER = "gateway:openrouter,direct:gemini,direct:groq";
    assert.deepEqual(
      configuredProviderOrder().slice(0, 3),
      ["groq", "openrouter", "gemini"],
    );
    assert.deepEqual(
      configuredRouteOrder().slice(0, 3),
      ["direct:groq", "gateway:openrouter", "direct:gemini"],
    );
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("Gemini, Groq, Mistral, and Cohere adapters independently normalize provider tool responses", async () => {
  const previousFetch = globalThis.fetch;
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const previousGroqKey = process.env.GROQ_API_KEY;
  const previousMistralKey = process.env.MISTRAL_API_KEY;
  const previousCohereKey = process.env.COHERE_API_KEY;
  try {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.MISTRAL_API_KEY = "test-mistral-key";
    process.env.COHERE_API_KEY = "test-cohere-key";
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("generativelanguage.googleapis.com")) {
        return new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                functionCall: {
                  name: "final_response",
                  args: { kind: "answer", message: "رد Gemini" },
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("api.cohere.com")) {
        return new Response(JSON.stringify({
          message: {
            content: [{ type: "text", text: "رد Cohere" }],
            tool_calls: [{
              id: "cohere-call",
              function: {
                name: "final_response",
                arguments: JSON.stringify({
                  kind: "answer",
                  message: "رد Cohere",
                }),
              },
            }],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{
              id: url.includes("api.mistral.ai") ? "mistral-call" : "groq-call",
              function: {
                name: "final_response",
                arguments: JSON.stringify({
                  kind: "answer",
                  message: url.includes("api.mistral.ai") ? "رد Mistral" : "رد Groq",
                }),
              },
            }],
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const context = { requestId: "adapter-request", callNumber: 1, toolCallsExecuted: 0 };
    const gemini = await new GeminiModelGateway().generate([], context);
    const groq = await new GroqModelGateway().generate([], context);
    const mistral = await new MistralModelGateway().generate([], context);
    const cohere = await new CohereModelGateway().generate([], context);
    assert.equal(gemini.toolCalls[0]?.name, "final_response");
    assert.equal(groq.toolCalls[0]?.name, "final_response");
    assert.equal(mistral.toolCalls[0]?.name, "final_response");
    assert.equal(cohere.toolCalls[0]?.name, "final_response");
    assert.equal(gemini.toolCalls[0]?.args.message, "رد Gemini");
    assert.equal(groq.toolCalls[0]?.args.message, "رد Groq");
    assert.equal(mistral.toolCalls[0]?.args.message, "رد Mistral");
    assert.equal(cohere.toolCalls[0]?.args.message, "رد Cohere");
    assert.equal(cohere.text, "رد Cohere");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
    if (previousGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousGroqKey;
    if (previousMistralKey === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = previousMistralKey;
    if (previousCohereKey === undefined) delete process.env.COHERE_API_KEY;
    else process.env.COHERE_API_KEY = previousCohereKey;
  }
});

test("Groq does not repeat a long 429 cooldown and records the real retry-after", async () => {
  const previousFetch = globalThis.fetch;
  const previousGroqKey = process.env.GROQ_API_KEY;
  let requestCount = 0;
  try {
    process.env.GROQ_API_KEY = "test-groq-key";
    globalThis.fetch = async () => {
      requestCount += 1;
      return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "447" },
      });
    };
    const metrics: GatewayRequestMetrics = {
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
    };

    await assert.rejects(
      () => new GroqModelGateway().generate([], {
        requestId: "groq-rate-limit-request",
        callNumber: 1,
        toolCallsExecuted: 0,
        metrics,
      }),
      (error: unknown) => error instanceof SecretaryError
        && error.code === "PROVIDER_RATE_LIMIT"
        && error.retryAfterSeconds === 447,
    );
    assert.equal(requestCount, 1);
    assert.equal(metrics.httpAttempts, 1);
    assert.equal(metrics.retryCount, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousGroqKey;
  }
});

test("Groq accepts nullable update_task and update_commitment schemas", async () => {
  const previousFetch = globalThis.fetch;
  const previousGroqKey = process.env.GROQ_API_KEY;
  const capturedBodies: Array<Record<string, unknown>> = [];
  try {
    process.env.GROQ_API_KEY = "test-groq-key";
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      capturedBodies.push(body);
      return new Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{
              id: "nullable-schema-call",
              function: {
                name: "final_response",
                arguments: JSON.stringify({ kind: "answer", message: "تم" }),
              },
            }],
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const nullableToolArguments = [
      { taskId: "task-1", dueAt: null },
      { commitmentId: "commitment-1", personId: null, dueAt: null },
    ];
    for (const args of nullableToolArguments) {
      await new GroqModelGateway().generate([{
        role: "assistant",
        text: "",
        toolCalls: [{
          id: "previous-call",
          name: Object.hasOwn(args, "taskId") ? "update_task" : "update_commitment",
          args,
        }],
      }, {
        role: "tool",
        toolCallId: "previous-call",
        toolName: Object.hasOwn(args, "taskId") ? "update_task" : "update_commitment",
        text: JSON.stringify({ ok: true }),
      }], { requestId: "nullable-schema-request", callNumber: 1, toolCallsExecuted: 1 });
    }

    assert.equal(capturedBodies.length, 2);
    for (const body of capturedBodies) {
      const tools = body.tools as Array<{ function: { name: string; parameters: Record<string, unknown> } }>;
      const taskSchema = tools.find((tool) => tool.function.name === "update_task")?.function.parameters;
      const commitmentSchema = tools.find((tool) => tool.function.name === "update_commitment")?.function.parameters;
      assert.deepEqual(toOpenAiSchema(["STRING", "NULL"]), ["string", "null"]);
      assert.deepEqual((taskSchema?.properties as Record<string, { type?: unknown }>).dueAt.type, ["string", "null"]);
      assert.deepEqual((commitmentSchema?.properties as Record<string, { type?: unknown }>).personId.type, ["string", "null"]);
      assert.deepEqual((commitmentSchema?.properties as Record<string, { type?: unknown }>).dueAt.type, ["string", "null"]);
        assert.equal(toGeminiSchema(["STRING", "NULL"]), "STRING");
        assert.deepEqual(toGeminiSchema(["kind", "message"]), ["kind", "message"]);
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousGroqKey;
  }
});

test("Cohere removes nullable JSON Schema type arrays", () => {
  assert.equal(toCohereSchema(["STRING", "NULL"]), "string");
  assert.deepEqual(toCohereSchema(["kind", "message"]), ["kind", "message"]);
});

test("tool scope classification keeps common requests bounded and ambiguous requests full", () => {
  assert.equal(classifyToolScope("إيه عندي النهارده؟").name, "read_only");
  assert.equal(classifyToolScope("إيه عندي النهارده؟").allowedToolNames.size, 9);

  const expenseScope = classifyToolScope("دفعت لمحمد 7500");
  assert.equal(expenseScope.name, "expense");
  assert.equal(expenseScope.allowedToolNames.size, 12);

  const ambiguousScope = classifyToolScope("اعمل مشروع جديد وفكرني بكرة أراجعه");
  assert.equal(ambiguousScope.name, "full");
  assert.equal(ambiguousScope.allowedToolNames.size, 29);
});

test("global expense totals and zero corrections use the deterministic report path", () => {
  assert.equal(isGlobalExpenseTotalRequest("اجمالي المصروفات كام؟"), true);
  assert.equal(isGlobalExpenseTotalRequest("إجمالي مصروفات المشروع"), false);
  assert.equal(isExpenseTotalCorrectionRequest("اعتقد فيه صفر زيادة"), true);
  assert.equal(isExpenseTotalCorrectionRequest("عدّل وصف المصروف"), false);
});

test("fixed weekly expense totals bypass the model without changing write behavior", async () => {
  const provider = new ScriptedProvider("gemini", () => {
    throw new Error("the deterministic period path must not call a provider");
  });
  const result = await new Phase2AgentRuntime(
    new FailoverModelGateway({ gemini: provider }, ["gemini"]),
  ).run(identity("deterministic-weekly-total"), {
    message: "أنا صرفت كام الأسبوع ده؟",
    requestId: "deterministic-weekly-total-request",
  }, { dryRun: true });

  assert.equal(deterministicExpensePeriod("أنا صرفت كام الأسبوع ده؟"), "this_week");
  assert.equal(provider.calls.length, 0);
  assert.equal(result.action?.type, "expense_report");
  assert.match(result.assistantMessage, /الأسبوع الحالي|لا توجد/);
});

test("all provider tool builders use the same scoped tool subset", async () => {
  const previousFetch = globalThis.fetch;
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const previousGroqKey = process.env.GROQ_API_KEY;
  const previousMistralKey = process.env.MISTRAL_API_KEY;
  const previousCohereKey = process.env.COHERE_API_KEY;
  const capturedBodies: Array<{ provider: string; body: Record<string, unknown> }> = [];
  try {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.MISTRAL_API_KEY = "test-mistral-key";
    process.env.COHERE_API_KEY = "test-cohere-key";
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (url.includes("generativelanguage.googleapis.com")) {
        capturedBodies.push({ provider: "gemini", body });
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
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("api.cohere.com")) {
        capturedBodies.push({ provider: "cohere", body });
        return new Response(JSON.stringify({
          message: {
            content: [{ type: "text", text: "تم" }],
            tool_calls: [{
              id: "cohere-scope-call",
              function: {
                name: "final_response",
                arguments: JSON.stringify({ kind: "answer", message: "تم" }),
              },
            }],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      capturedBodies.push({ provider: url.includes("api.mistral.ai") ? "mistral" : "groq", body });
      return new Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{
              id: "scope-call",
              function: {
                name: "final_response",
                arguments: JSON.stringify({ kind: "answer", message: "تم" }),
              },
            }],
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const toolScope = classifyToolScope("إيه عندي النهارده؟");
    const context = {
      requestId: "scoped-adapter-request",
      callNumber: 1,
      toolCallsExecuted: 0,
      toolScope,
    };
    await new GeminiModelGateway().generate([], context);
    await new GroqModelGateway().generate([], context);
    await new MistralModelGateway().generate([], context);
    await new CohereModelGateway().generate([], context);

    assert.equal(capturedBodies.length, 4);
    for (const { provider, body } of capturedBodies) {
      const tools = provider === "gemini"
        ? ((body.tools as Array<{ functionDeclarations: unknown[] }>)[0]?.functionDeclarations ?? [])
        : (body.tools as unknown[] ?? []);
      assert.equal(tools.length, 9, `${provider} did not receive the read-only scope`);
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
    if (previousGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousGroqKey;
    if (previousMistralKey === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = previousMistralKey;
    if (previousCohereKey === undefined) delete process.env.COHERE_API_KEY;
    else process.env.COHERE_API_KEY = previousCohereKey;
  }
});

test("an out-of-scope tool call widens the scope for the rest of the request", async () => {
  const provider = new ScriptedProvider("groq", (call, callNumber) => {
    if (callNumber === 1) {
      assert.equal(call.context.toolScope?.name, "read_only");
      return toolCall("create_task", { title: "مهمة اختبار" });
    }
    assert.equal(call.context.toolScope?.name, "full");
    assert.equal(call.context.toolScope?.allowedToolNames.size, 29);
    return finalResponse("اكتمل الطلب بعد توسيع النطاق.");
  });
  const result = await new Phase2AgentRuntime(
    new FailoverModelGateway({ groq: provider }, ["groq"]),
  ).run(identity("scope-fallback"), {
    message: "إيه عندي النهارده؟",
    requestId: "scope-fallback-request",
  }, { dryRun: true });

  assert.equal(result.response?.message, "اكتمل الطلب بعد توسيع النطاق.");
  assert.equal(provider.calls.length, 2);
});

test("finalizes with the collected tool results after the logical call budget", async () => {
  const provider = new ScriptedProvider("gemini", (call, callNumber) => {
    if (callNumber <= 4) {
      return toolCall("create_task", { title: `مهمة مؤقتة ${callNumber}` });
    }
    assert.equal(call.context.finalResponseOnly, true);
    assert.equal(call.context.toolCallsExecuted, 4);
    return finalResponse("راجعت البيانات وأكملت الرد.");
  });
  const result = await new Phase2AgentRuntime(
    new FailoverModelGateway({ gemini: provider }, ["gemini"]),
  ).run(identity("call-limit-finalization"), {
    message: "إيه عندي النهارده؟",
    requestId: "call-limit-finalization-request",
  }, { dryRun: true });

  assert.equal(result.response?.message, "راجعت البيانات وأكملت الرد.");
  assert.equal(result.action?.llmCalls, 5);
  assert.equal(provider.calls.length, 5);
});

test("429, timeout, and unavailable primary providers fail over without changing the request", async () => {
  const cases = [
    ["rate-limit", providerResponseError("gemini", 429, "rate limited")],
    ["timeout", providerTimeoutError("gemini")],
    ["unavailable", providerResponseError("gemini", 503, "unavailable")],
  ] as const;

  for (const [label, failure] of cases) {
    const primary = new ScriptedProvider("gemini", () => { throw failure; });
    const fallback = new ScriptedProvider("groq", () => finalResponse("أكملت الطلب من المزود الاحتياطي."));
    const gateway = new FailoverModelGateway(
      { gemini: primary, groq: fallback },
      ["gemini", "groq"],
    );
    const requestId = `fallback-${label}-${Date.now()}`;
    const result = await new Phase2AgentRuntime(gateway).run(identity(label), {
      message: "إيه عندي النهارده؟",
      requestId,
    }, { dryRun: true });

    assert.equal(result.provider, "groq");
    assert.equal(result.action?.providerTrace?.fallbackOccurred, true);
    assert.equal(result.action?.providerTrace?.fallbackReason, failure.code);
    assert.deepEqual(result.action?.providerTrace?.providersAttempted, ["gemini", "groq"]);
    assert.deepEqual(
      [...primary.calls, ...fallback.calls].map((call) => call.context.requestId),
      [requestId, requestId],
    );
    assert.equal(fallback.calls[0]?.context.toolCallsExecuted, 0);
  }
});

test("a delayed retry shares one failover execution for the same idempotency key", async () => {
  const primary = new ScriptedProvider("gemini", async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    throw providerTimeoutError("gemini");
  });
  const fallback = new ScriptedProvider("groq", async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return finalResponse("تم الحفظ من المزود الاحتياطي.");
  });
  const gateway = new FailoverModelGateway(
    { gemini: primary, groq: fallback },
    ["gemini", "groq"],
  );
  const runtime = new Phase2AgentRuntime(gateway);
  const testIdentity = identity("delayed-retry");
  const request = {
    message: "إيه عندي النهارده؟",
    conversationId: "delayed-retry-conversation",
    idempotencyKey: "delayed-retry-key",
  };

  const [first, retry] = await Promise.all([
    runtime.run(testIdentity, { ...request, requestId: "delayed-first" }, { dryRun: true }),
    runtime.run(testIdentity, { ...request, requestId: "delayed-retry" }, { dryRun: true }),
  ]);

  assert.equal(first.provider, "groq");
  assert.equal(retry.provider, first.provider);
  assert.equal(retry.assistantMessage, first.assistantMessage);
  assert.equal(retry.action?.providerTrace?.fallbackReason, first.action?.providerTrace?.fallbackReason);
  assert.equal(primary.calls.length, 1);
  assert.equal(fallback.calls.length, 1);
});

test("Groq primary can fail over to Gemini", async () => {
  const primary = new ScriptedProvider("groq", () => {
    throw providerResponseError("groq", 429, "rate limited");
  });
  const fallback = new ScriptedProvider("gemini", () => finalResponse("أكملت من Gemini."));
  const gateway = new FailoverModelGateway(
    { groq: primary, gemini: fallback },
    ["groq", "gemini"],
  );
  const result = await new Phase2AgentRuntime(gateway).run(identity("groq-to-gemini"), {
    message: "اعرض الملخص بالعربي",
    requestId: "groq-to-gemini-request",
  }, { dryRun: true });

  assert.equal(result.provider, "gemini");
  assert.equal(result.action?.providerTrace?.fallbackReason, "PROVIDER_RATE_LIMIT");
  assert.deepEqual(result.action?.providerTrace?.providersAttempted, ["groq", "gemini"]);
});

test("a daily token limit opens a cooldown and skips the provider on the next request", async () => {
  const primary = new ScriptedProvider("gemini", () => {
    throw providerResponseError("gemini", 429, "daily token limit reached");
  });
  const fallback = new ScriptedProvider("groq", () => finalResponse("أكملت الطلب من المزود الاحتياطي."));
  const gateway = new FailoverModelGateway(
    { gemini: primary, groq: fallback },
    ["gemini", "groq"],
  );
  const runtime = new Phase2AgentRuntime(gateway);

  const first = await runtime.run(identity("quota-cooldown-first"), {
    message: "اعرض الملخص بالعربي",
    requestId: "quota-cooldown-first-request",
  }, { dryRun: true });
  const second = await runtime.run(identity("quota-cooldown-second"), {
    message: "اعرض الملخص بالعربي",
    requestId: "quota-cooldown-second-request",
  }, { dryRun: true });

  assert.equal(first.provider, "groq");
  assert.equal(second.provider, "groq");
  assert.equal(first.assistantMessage.includes("gemini"), false);
  assert.equal(second.assistantMessage.includes("gemini"), false);
  assert.deepEqual(
    second.action?.providerTrace?.providersAttempted,
    ["groq"],
  );
  assert.equal(second.action?.providerTrace?.fallbackReason, "circuit_open");
  assert.equal(primary.calls.length, 1);
  assert.equal(fallback.calls.length, 2);
});

test("failover advances to a third provider after the selected fallback is rate limited", async () => {
  const primary = new ScriptedProvider("groq", () => {
    throw providerResponseError("groq", 429, "rate limited");
  });
  const secondary = new ScriptedProvider("gemini", (_call, callNumber) => {
    if (callNumber === 1) return toolCall("recall_context", {});
    throw providerResponseError("gemini", 429, "rate limited");
  });
  const tertiary = new ScriptedProvider("cohere", () => finalResponse("اكتمل الرد من المزود الثالث."));
  const gateway = new FailoverModelGateway(
    { groq: primary, gemini: secondary, cohere: tertiary },
    ["groq", "gemini", "cohere"],
  );

  const result = await new Phase2AgentRuntime(gateway).run(identity("three-provider-failover"), {
    message: "إيه المحفوظ عندي؟",
    requestId: "three-provider-failover-request",
  }, { dryRun: true });

  assert.equal(result.provider, "cohere");
  assert.deepEqual(
    result.action?.providerTrace?.providersAttempted,
    ["groq", "gemini", "gemini", "cohere"],
  );
  assert.equal(secondary.calls.length, 2);
  assert.equal(tertiary.calls.length, 1);
});

test("provider fallback attempts do not exhaust the budget before a four-call turn can finish", async () => {
  const envKeys = [
    "GROQ_API_KEY",
    "GEMINI_API_KEY",
    "COHERE_API_KEY",
    "MISTRAL_API_KEY",
    "OPENROUTER_API_KEY",
    "DEEPSEEK_API_KEY",
  ] as const;
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const providerCalls: Record<string, number> = {};
  const previousFetch = globalThis.fetch;
  const findProject = {
    id: "find-project",
    name: "find_project",
    args: { name: "مشروع الاختبار" },
  };
  const final = {
    id: "final-response",
    name: "final_response",
    args: { kind: "answer", message: "اكتمل الرد بعد التحويل بين المزودين." },
  };
  const openAiResponse = (call: typeof findProject | typeof final) => new Response(JSON.stringify({
    choices: [{
      message: {
        tool_calls: [{
          id: call.id,
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        }],
      },
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    for (const key of envKeys) process.env[key] = `test-${key.toLowerCase()}`;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("generativelanguage.googleapis.com") && url.includes("cachedContents")) {
        return new Response("cache unavailable", { status: 403 });
      }
      const provider = url.includes("api.groq.com") ? "groq"
        : url.includes("generativelanguage.googleapis.com") ? "gemini"
          : url.includes("api.cohere.com") ? "cohere"
            : url.includes("api.mistral.ai") ? "mistral"
              : url.includes("openrouter.ai") ? "openrouter"
                : url.includes("api.deepseek.com") ? "deepseek"
                  : "unknown";
      const callNumber = providerCalls[provider] = (providerCalls[provider] ?? 0) + 1;
      if (provider === "groq" || (provider === "gemini" && callNumber === 2)
        || (provider === "cohere" && callNumber === 2)
        || (provider === "mistral" && callNumber === 2)
        || (provider === "openrouter" && callNumber === 2)) {
        return new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "30", "content-type": "text/plain" },
        });
      }
      if (provider === "gemini") {
        return new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{ functionCall: { name: findProject.name, args: findProject.args } }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (provider === "cohere") {
        return new Response(JSON.stringify({
          message: {
            content: [],
            tool_calls: [{
              id: findProject.id,
              function: { name: findProject.name, arguments: JSON.stringify(findProject.args) },
            }],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return openAiResponse(provider === "deepseek" ? final : findProject);
    };

    const gateway = new MnrInferenceRouter({
      "direct:groq": new GroqModelGateway(),
      "direct:gemini": new GeminiModelGateway(),
      "direct:cohere": new CohereModelGateway(),
      "direct:mistral": new MistralModelGateway(),
      "gateway:openrouter": new OpenRouterModelGateway(),
      "direct:deepseek": new DeepSeekModelGateway(),
    }, [
      "direct:groq",
      "direct:gemini",
      "direct:cohere",
      "direct:mistral",
      "gateway:openrouter",
      "direct:deepseek",
    ]);
    const result = await new Phase2AgentRuntime(gateway).run(identity("fallback-budget-four-calls"), {
      message: "وريني المشروع المحجر",
      requestId: "fallback-budget-four-calls-request",
    }, { dryRun: true });

    assert.equal(result.provider, "deepseek");
    assert.equal(result.response?.message, "اكتمل الرد بعد التحويل بين المزودين.");
    assert.equal(result.action?.providerTrace?.httpAttempts, 10);
    assert.deepEqual(result.action?.providerTrace?.providersAttempted, [
      "groq",
      "gemini",
      "gemini",
      "cohere",
      "cohere",
      "mistral",
      "mistral",
      "openrouter",
      "openrouter",
      "deepseek",
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key]!;
    }
  }
});

test("a read tool result is preserved when the primary fails and fallback writes the final response", async () => {
  const primary = new ScriptedProvider("gemini", (_call, callNumber) => {
    if (callNumber === 1) return toolCall("find_project", { name: "المحجر" });
    throw providerTimeoutError("gemini");
  });
  const fallback = new ScriptedProvider("groq", (call) => {
    assert.ok(call.messages.some((message) => message.role === "tool" && message.toolName === "find_project"));
    return finalResponse("راجعت نتيجة البحث وأكملت الرد.");
  });
  const gateway = new FailoverModelGateway(
    { gemini: primary, groq: fallback },
    ["gemini", "groq"],
  );
  const result = await new Phase2AgentRuntime(gateway).run(identity("read-context"), {
    message: "وريني المشروع المحجر",
    requestId: "read-context-request",
  }, { dryRun: true });

  assert.equal(result.provider, "groq");
  assert.equal(result.action?.toolCalls, 1);
  assert.equal(result.action?.providerTrace?.toolCallsExecutedBeforeFailure, 1);
  assert.equal(fallback.calls.length, 1);
});

test("a write tool creates approval without executing or falling back", async () => {
  const testIdentity = identity("write-once");
  const primary = new ScriptedProvider("gemini", (_call, callNumber) => {
    if (callNumber === 1) {
      return toolCall("record_expense", {
        amountMinor: 750000,
        description: "دفعة عربية لاختبار failover",
      });
    }
    throw providerTimeoutError("gemini");
  });
  const fallback = new ScriptedProvider("groq", () => finalResponse("يجب ألا يصل fallback إلى write غير معتمد."));
  const gateway = new FailoverModelGateway(
    { gemini: primary, groq: fallback },
    ["gemini", "groq"],
  );
  const result = await new Phase2AgentRuntime(gateway).run(testIdentity, {
    message: "محمد خد مني 7500",
    requestId: "write-once-request",
  });

  const expenses = await db.select().from(expensesTable).where(and(
    eq(expensesTable.tenantId, testIdentity.tenantId),
    eq(expensesTable.ownerUserId, testIdentity.userId),
  ));
  assert.equal(result.action?.type, "approval_required");
  assert.equal(result.action?.toolCalls, 1);
  assert.equal(primary.calls.length, 1);
  assert.equal(fallback.calls.length, 0);
  assert.equal(expenses.length, 0);
});

test("expense totals use one exact numeric representation instead of model-written number words", async () => {
  const testIdentity = identity("exact-expense-total");
  await db.insert(expensesTable).values({
    tenantId: testIdentity.tenantId,
    ownerUserId: testIdentity.userId,
    description: "تشطيب الشقة",
    amountMinor: 4_800_000,
    currency: "EGP",
  });

  const provider = new ScriptedProvider("gemini", (_call, callNumber) =>
    callNumber === 1
      ? toolCall("query_expenses", { description: "تشطيب الشقة", limit: 50 })
      : {
          text: "",
          toolCalls: [{
            id: "final-response",
            name: "final_response",
            args: {
              kind: "answer",
              message: "الإجمالي ثمانية وأربعون ألف جنيه مصري.",
              groundedFacts: [{ type: "money", value: 4_800_000, currency: "EGP" }],
            },
          }],
        },
  );
  const result = await new Phase2AgentRuntime(
    new FailoverModelGateway({ gemini: provider }, ["gemini"]),
  ).run(testIdentity, {
    message: "إجمالي المصروفات في بند تشطيب الشقة",
    requestId: "exact-expense-total-request",
  });

  assert.equal(
    result.response?.message,
    "الإجمالي الدقيق المسجل في السجلات هو 48,000 جنيه مصري عبر 1 مصروف.",
  );
  assert.deepEqual(result.response?.groundedFacts, [{
    type: "money",
    value: 4_800_000,
    currency: "EGP",
    label: "إجمالي المصروفات",
  }, {
    type: "count",
    value: 1,
    label: "عدد المصروفات",
  }]);
  assert.doesNotMatch(result.response?.message ?? "", /مليون|ثلاثة|ثمانية/);
});

test("expense total summaries include matching rows beyond the detail limit", async () => {
  const testIdentity = identity("expense-summary-limit");
  await db.insert(expensesTable).values(
    Array.from({ length: 3 }, (_, index) => ({
      tenantId: testIdentity.tenantId,
      ownerUserId: testIdentity.userId,
      description: "تشطيب الشقة",
      amountMinor: 1_600_000,
      currency: "EGP",
      occurredAt: new Date(Date.now() - index * 1_000),
    })),
  );

  const result = await executeStructuredTool(
    testIdentity,
    "query_expenses",
    { description: "تشطيب الشقة", limit: 1 },
    { requestId: "expense-summary-limit-request" },
  );

  assert.equal(result.ok, true);
  assert.equal((result.expenses as unknown[]).length, 1);
  assert.deepEqual(result.summary, {
    count: 3,
    totalMinor: 4_800_000,
    currency: "EGP",
    projectCount: 0,
  });
});

test("expense totals keep different currencies separate", async () => {
  const testIdentity = identity("expense-summary-mixed-currency");
  await db.insert(expensesTable).values([
    {
      tenantId: testIdentity.tenantId,
      ownerUserId: testIdentity.userId,
      description: "رحلة عمل",
      amountMinor: 10_000,
      currency: "EGP",
    },
    {
      tenantId: testIdentity.tenantId,
      ownerUserId: testIdentity.userId,
      description: "رحلة عمل",
      amountMinor: 2_000,
      currency: "USD",
    },
  ]);

  const result = await executeStructuredTool(
    testIdentity,
    "query_expenses",
    { description: "رحلة عمل", limit: 50 },
    { requestId: "expense-summary-mixed-currency-request" },
  );

  assert.equal(result.ok, true);
  const summary = result.summary as {
    count: number;
    totalMinor?: number;
    currency?: string;
    currencyTotals?: Array<{ currency: string; totalMinor: number; count: number }>;
  };
  assert.equal(summary.count, 2);
  assert.equal(summary.totalMinor, undefined);
  assert.equal(summary.currency, undefined);
  assert.deepEqual(
    summary.currencyTotals?.slice().sort((left, right) => left.currency.localeCompare(right.currency)),
    [
      { currency: "EGP", totalMinor: 10_000, count: 1 },
      { currency: "USD", totalMinor: 2_000, count: 1 },
    ].sort((left, right) => left.currency.localeCompare(right.currency)),
  );
});

test("multiple write tools remain separate pending approvals", async () => {
  const testIdentity = identity("multiple-writes");
  const primary = new ScriptedProvider("gemini", () => ({
    text: "",
    toolCalls: [
      {
        id: "expense-call",
        name: "record_expense",
        args: { amountMinor: 750000, description: "مصروف أول" },
      },
      {
        id: "reminder-call",
        name: "create_reminder",
        args: {
          text: "اتصل بمحمد",
          dueAt: "2030-01-01T09:00:00.000Z",
          timezone: "Africa/Cairo",
        },
      },
    ],
  }));
  const result = await new Phase2AgentRuntime(
    new FailoverModelGateway({ gemini: primary }, ["gemini"]),
  ).run(testIdentity, {
    message: "سجل مصروفًا واحفظ تذكيرًا",
    requestId: "multiple-writes-request",
  });

  const operations = await db.select().from(secretaryOperationsTable).where(and(
    eq(secretaryOperationsTable.tenantId, testIdentity.tenantId),
    eq(secretaryOperationsTable.ownerUserId, testIdentity.userId),
  ));
  assert.equal(result.action?.type, "approval_required");
  assert.equal(Array.isArray(result.action?.approvals), true);
  assert.equal((result.action?.approvals as unknown[]).length, 2);
  assert.equal(new Set(operations.map((operation) => operation.id)).size, 2);
  assert.deepEqual(operations.map((operation) => operation.status).sort(), ["pending", "pending"]);
});

test("dryRun prevents writes even when failover happens", async () => {
  const testIdentity = identity("dry-run");
  const primary = new ScriptedProvider("gemini", (_call, callNumber) => {
    if (callNumber === 1) {
      return toolCall("create_reminder", {
        text: "اتصل بمحمد",
        dueAt: "2030-01-01T09:00:00.000Z",
      });
    }
    throw providerResponseError("gemini", 429, "rate limited");
  });
  const fallback = new ScriptedProvider("groq", () => finalResponse("عاينت العملية بدون حفظها."));
  const gateway = new FailoverModelGateway(
    { gemini: primary, groq: fallback },
    ["gemini", "groq"],
  );
  await new Phase2AgentRuntime(gateway).run(testIdentity, {
    message: "فكرني أكلم محمد",
    requestId: "dry-run-request",
    conversationId: "dry-run-conversation",
  }, { dryRun: true });

  const [reminderCount] = await db.select({ id: expensesTable.id }).from(expensesTable).where(and(
    eq(expensesTable.tenantId, testIdentity.tenantId),
    eq(expensesTable.ownerUserId, testIdentity.userId),
  ));
  const memory = await db.select().from(conversationMemoryTable).where(and(
    eq(conversationMemoryTable.tenantId, testIdentity.tenantId),
    eq(conversationMemoryTable.ownerUserId, testIdentity.userId),
    eq(conversationMemoryTable.conversationId, "dry-run-conversation"),
  ));
  assert.equal(reminderCount, undefined);
  assert.equal(memory.length, 0);
});

test("Arabic expense lookup continues to record_expense after find_person", async () => {
  const provider = new ScriptedProvider("gemini", (call, callNumber) => {
    if (callNumber === 1) return toolCall("find_person", { name: "محمد" });
    if (callNumber === 2) {
      assert.ok(call.messages.some((message) =>
        message.text?.includes("لم يتم العثور على شخص مطابق")
        && message.text?.includes("استدع record_expense الآن")
      ));
      return toolCall("record_expense", {
        amountMinor: 750000,
        currency: "EGP",
        description: "دفعت لمحمد 7500",
      });
    }
    return finalResponse("جهزت المصروف للموافقة.");
  });
  const result = await new Phase2AgentRuntime(
    new FailoverModelGateway({ gemini: provider }, ["gemini"]),
  ).run(identity("arabic-expense-continuation"), {
    message: "دفعت لمحمد 7500",
    requestId: "arabic-expense-continuation-request",
  }, { dryRun: true });

  assert.equal(result.response?.kind, "answer");
  assert.equal(result.action?.lastTool, "record_expense");
  assert.equal(provider.calls.length, 3);
});

test("conversation state survives a provider transition and the next Arabic turn", async () => {
  const testIdentity = identity("state");
  await db.insert(projectsTable).values({
    tenantId: testIdentity.tenantId,
    ownerUserId: testIdentity.userId,
    name: "المحجر",
    nameKey: "المحجر",
    status: "active",
  });

  const primary = new ScriptedProvider("gemini", (call, callNumber) => {
    if (callNumber === 1) return toolCall("find_project", { name: "المحجر" });
    if (callNumber === 2) throw providerTimeoutError("gemini");
    assert.ok(call.messages.some((message) => message.text?.includes("lastProject")));
    return finalResponse("فاكر المشروع من السياق المحفوظ.");
  });
  const fallback = new ScriptedProvider("groq", () => finalResponse("وجدت المشروع وسأكمل."));
  const gateway = new FailoverModelGateway(
    { gemini: primary, groq: fallback },
    ["gemini", "groq"],
  );
  const runtime = new Phase2AgentRuntime(gateway);
  await runtime.run(testIdentity, {
    message: "وريني مشروع المحجر",
    conversationId: "state-conversation",
    requestId: "state-request-1",
  });
  const second = await runtime.run(testIdentity, {
    message: "فاكر المشروع ده؟",
    conversationId: "state-conversation",
    requestId: "state-request-2",
  });

  assert.equal(second.provider, "gemini");
  assert.equal(fallback.calls.length, 1);
  assert.ok(primary.calls[2]?.messages.some((message) => message.text?.includes("lastProject")));
});

test("non-transient provider, tool, and validation errors do not fail over", async () => {
  const primary = new ScriptedProvider("gemini", () => {
    throw providerResponseError("gemini", 400, "invalid request");
  });
  const fallback = new ScriptedProvider("groq", () => finalResponse());
  const gateway = new FailoverModelGateway(
    { gemini: primary, groq: fallback },
    ["gemini", "groq"],
  );

  await assert.rejects(
    () => new Phase2AgentRuntime(gateway).run(identity("non-transient"), {
      message: "طلب غير صالح",
      requestId: "non-transient-request",
    }, { dryRun: true }),
    (error: unknown) => error instanceof SecretaryError && error.code === "PROVIDER_API_ERROR",
  );
  assert.equal(fallback.calls.length, 0);
});

test("tool execution errors stay in the tool error contract and never fail over", async () => {
  const primary = new ScriptedProvider("gemini", () => toolCall("get_person_expense_total", {
    personId: "not-a-uuid",
  }));
  const fallback = new ScriptedProvider("groq", () => finalResponse());
  const gateway = new FailoverModelGateway(
    { gemini: primary, groq: fallback },
    ["gemini", "groq"],
  );

  await assert.rejects(
    () => new Phase2AgentRuntime(gateway).run(identity("tool-error"), {
      message: "احسب إجمالي شخص",
      requestId: "tool-error-request",
    }, { dryRun: true }),
    (error: unknown) => error instanceof SecretaryError && error.code === "AGENT_TOOL_EXECUTION_FAILED",
  );
  assert.equal(fallback.calls.length, 0);
});

test("circuit breaker skips a rate-limited primary for a short window", async () => {
  const primary = new ScriptedProvider("gemini", () => {
    throw providerResponseError("gemini", 429, "rate limited");
  });
  const fallback = new ScriptedProvider("groq", () => finalResponse("الرد من المزود المتاح."));
  const gateway = new FailoverModelGateway(
    { gemini: primary, groq: fallback },
    ["gemini", "groq"],
  );
  const runtime = new Phase2AgentRuntime(gateway);

  await runtime.run(identity("circuit-1"), {
    message: "ملخص",
    requestId: "circuit-request-1",
  }, { dryRun: true });
  await runtime.run(identity("circuit-2"), {
    message: "ملخص",
    requestId: "circuit-request-2",
  }, { dryRun: true });
  const third = await runtime.run(identity("circuit-3"), {
    message: "ملخص",
    requestId: "circuit-request-3",
  }, { dryRun: true });

  assert.equal(primary.calls.length, 1);
  assert.equal(third.provider, "groq");
  assert.equal(third.action?.providerTrace?.fallbackReason, "circuit_open");
  assert.deepEqual(third.action?.providerTrace?.providersAttempted, ["groq"]);
});

test("both providers failing returns one classified failover error", async () => {
  const primary = new ScriptedProvider("gemini", () => {
    throw providerResponseError("gemini", 429, "rate limited");
  });
  const fallback = new ScriptedProvider("groq", () => {
    throw providerResponseError("groq", 503, "unavailable");
  });
  const gateway = new FailoverModelGateway(
    { gemini: primary, groq: fallback },
    ["gemini", "groq"],
  );

  await assert.rejects(
    () => new Phase2AgentRuntime(gateway).run(identity("both-fail"), {
      message: "اعرض الملخص",
      requestId: "both-fail-request",
    }, { dryRun: true }),
    (error: unknown) => error instanceof SecretaryError
      && error.code === "PROVIDER_FAILOVER_FAILED"
      && error.provider === "groq"
      && error.category === "provider_unavailable",
  );
});
