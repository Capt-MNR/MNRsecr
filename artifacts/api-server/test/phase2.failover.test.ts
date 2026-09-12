import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  db,
  expensesTable,
  projectsTable,
  conversationMemoryTable,
} from "@workspace/db";
import {
  FailoverModelGateway,
  GeminiModelGateway,
  Phase2AgentRuntime,
  GroqModelGateway,
  configuredProviderOrder,
  type ConversationMessage,
  type GatewayCallContext,
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
    "AI_PROVIDER",
    "AI_PRIMARY_PROVIDER",
    "AI_FALLBACK_PROVIDER",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.GROQ_API_KEY = "test-groq-key";
    delete process.env.AI_PROVIDER;
    delete process.env.AI_PRIMARY_PROVIDER;
    delete process.env.AI_FALLBACK_PROVIDER;
    assert.deepEqual(configuredProviderOrder(), ["gemini", "groq"]);

    process.env.AI_PRIMARY_PROVIDER = "groq";
    process.env.AI_FALLBACK_PROVIDER = "gemini";
    assert.deepEqual(configuredProviderOrder(), ["groq", "gemini"]);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("Gemini and Groq adapters independently normalize provider tool responses", async () => {
  const previousFetch = globalThis.fetch;
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const previousGroqKey = process.env.GROQ_API_KEY;
  try {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.GROQ_API_KEY = "test-groq-key";
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
      return new Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{
              id: "groq-call",
              function: {
                name: "final_response",
                arguments: JSON.stringify({ kind: "answer", message: "رد Groq" }),
              },
            }],
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const context = { requestId: "adapter-request", callNumber: 1, toolCallsExecuted: 0 };
    const gemini = await new GeminiModelGateway().generate([], context);
    const groq = await new GroqModelGateway().generate([], context);
    assert.equal(gemini.toolCalls[0]?.name, "final_response");
    assert.equal(groq.toolCalls[0]?.name, "final_response");
    assert.equal(gemini.toolCalls[0]?.args.message, "رد Gemini");
    assert.equal(groq.toolCalls[0]?.args.message, "رد Groq");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
    if (previousGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousGroqKey;
  }
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

test("a write tool is executed once, then fallback continues without replaying it", async () => {
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
  const fallback = new ScriptedProvider("groq", () => finalResponse("تم تسجيل الدفعة مرة واحدة."));
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
  assert.equal(result.provider, "groq");
  assert.equal(result.action?.toolCalls, 1);
  assert.equal(primary.calls.length, 2);
  assert.equal(fallback.calls.length, 1);
  assert.equal(expenses.length, 1);
  assert.equal(expenses[0]?.amountMinor, 750000);
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

test("circuit breaker skips a repeatedly rate-limited primary for a short window", async () => {
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

  assert.equal(primary.calls.length, 2);
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
