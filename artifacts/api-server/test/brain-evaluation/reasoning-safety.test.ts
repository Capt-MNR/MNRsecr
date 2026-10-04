import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  conversationMemoryTable,
  commitmentsTable,
  db,
  expensesTable,
  projectsTable,
  secondBrainMemoriesTable,
  secretaryOperationsTable,
} from "@workspace/db";
import {
  FailoverModelGateway,
  Phase2AgentRuntime,
  executeStructuredTool,
  type ConversationMessage,
  type GatewayCallContext,
  type GatewayResponse,
  type ModelGateway,
} from "../../src/lib/phase2";
import {
  providerResponseError,
  providerTimeoutError,
  SecretaryError,
} from "../../src/lib/error-contract";
import {
  claimOperation,
  createPendingOperation,
  getOperation,
  rejectOperation,
} from "../../src/lib/secretary-operations";
import { createBrainDecisionEnvelope } from "../../src/lib/brain-contract";
import { parseSemanticRequest } from "../../src/lib/deterministic-intelligence";
import { nextCairoCalendarWeekWindow } from "../../src/lib/relationship-context";
import type { Identity } from "../../src/lib/secretary";

type FixtureIdentity = Identity & { prefix: string };

class ScriptedProvider implements ModelGateway {
  readonly provider = "groq" as const;
  readonly modelName = "brain-evaluation-scripted";
  readonly calls: Array<{ messages: ConversationMessage[]; context: GatewayCallContext }> = [];

  constructor(
    private readonly response: GatewayResponse | ((callNumber: number) => GatewayResponse),
  ) {}

  async generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse> {
    this.calls.push({ messages, context });
    return typeof this.response === "function"
      ? this.response(this.calls.length)
      : this.response;
  }
}

function finalAnswer(
  message: string,
  groundedFacts?: Array<{ type: "money" | "count"; value: number; currency?: string; label?: string }>,
): GatewayResponse {
  return {
    text: "",
    toolCalls: [{
      id: "brain-evaluation-final",
      name: "final_response",
      args: {
        kind: "answer",
        message,
        ...(groundedFacts ? { groundedFacts } : {}),
      },
    }],
  };
}

function identity(prefix: string): FixtureIdentity {
  return {
    prefix,
    tenantId: `brain-reasoning-${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    userId: `brain-reasoning-user-${prefix}`,
  };
}

function cairoDateLabel(date: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year}`;
}

async function countRows(identity: Identity): Promise<{ expenses: number; memory: number; operations: number }> {
  const [expenses, memory, operations] = await Promise.all([
    db.select({ id: expensesTable.id }).from(expensesTable).where(and(
      eq(expensesTable.tenantId, identity.tenantId),
      eq(expensesTable.ownerUserId, identity.userId),
    )),
    db.select({ id: conversationMemoryTable.id }).from(conversationMemoryTable).where(and(
      eq(conversationMemoryTable.tenantId, identity.tenantId),
      eq(conversationMemoryTable.ownerUserId, identity.userId),
    )),
    db.select({ id: secretaryOperationsTable.id }).from(secretaryOperationsTable).where(and(
      eq(secretaryOperationsTable.tenantId, identity.tenantId),
      eq(secretaryOperationsTable.ownerUserId, identity.userId),
    )),
  ]);
  return { expenses: expenses.length, memory: memory.length, operations: operations.length };
}

async function cleanup(identity: Identity): Promise<void> {
  await db.delete(secondBrainMemoriesTable).where(and(
    eq(secondBrainMemoriesTable.tenantId, identity.tenantId),
    eq(secondBrainMemoriesTable.ownerUserId, identity.userId),
  ));
  await db.delete(conversationMemoryTable).where(and(
    eq(conversationMemoryTable.tenantId, identity.tenantId),
    eq(conversationMemoryTable.ownerUserId, identity.userId),
  ));
  await db.delete(secretaryOperationsTable).where(and(
    eq(secretaryOperationsTable.tenantId, identity.tenantId),
    eq(secretaryOperationsTable.ownerUserId, identity.userId),
  ));
  await db.delete(commitmentsTable).where(and(
    eq(commitmentsTable.tenantId, identity.tenantId),
    eq(commitmentsTable.ownerUserId, identity.userId),
  ));
  await db.delete(expensesTable).where(and(
    eq(expensesTable.tenantId, identity.tenantId),
    eq(expensesTable.ownerUserId, identity.userId),
  ));
  await db.delete(projectsTable).where(and(
    eq(projectsTable.tenantId, identity.tenantId),
    eq(projectsTable.ownerUserId, identity.userId),
  ));
}

test("planning fixture measures read-only provider-backed planning separately from safety", async () => {
  const testIdentity = identity("planning");
  await cleanup(testIdentity);
  try {
    const nextWeek = nextCairoCalendarWeekWindow();
    await db.insert(commitmentsTable).values({
      tenantId: testIdentity.tenantId,
      ownerUserId: testIdentity.userId,
      title: "تسليم قائمة المخزون",
      dueAt: new Date(nextWeek.start.getTime() + 24 * 60 * 60 * 1000),
      status: "open",
    });
    const provider = new ScriptedProvider(finalAnswer(
      "خطة الأسبوع: أولًا مراجعة الالتزامات المستحقة، ثم ترتيبها حسب الموعد، وأخيرًا لا يتم تنفيذ أي تغيير تلقائيًا.",
    ));
    const runtime = new Phase2AgentRuntime(new FailoverModelGateway(
      { groq: provider },
      ["groq"],
    ));

    const result = await runtime.run(testIdentity, {
      message: "شوفلي الالتزامات اللي عليا الأسبوع الجاي وقولي أرتبها إزاي",
      requestId: "brain-planning-fixture",
    }, { dryRun: true });
    const prompt = provider.calls.flatMap((call) => call.messages)
      .map((message) => message.text ?? "")
      .join("\n");

    assert.equal(result.response?.kind, "answer");
    assert.match(result.assistantMessage, /خطة الأسبوع/);
    assert.match(result.assistantMessage, /تسليم قائمة المخزون/);
    assert.match(result.assistantMessage, /لم أغيّر أي موعد/);
    assert.ok(prompt.includes("تسليم قائمة المخزون"));
    assert.equal(result.action?.providerTrace?.providersAttempted?.length, 1);
    assert.equal(result.action?.llmCalls, 1);
    assert.deepEqual(await countRows(testIdentity), { expenses: 0, memory: 0, operations: 0 });
  } finally {
    await cleanup(testIdentity);
  }
});

test("dated travel-conflict runtime gives the provider scoped obligations without writing", async () => {
  const testIdentity = identity("dated-travel-runtime");
  await cleanup(testIdentity);
  try {
    const nextWeek = nextCairoCalendarWeekWindow();
    const dayMs = 24 * 60 * 60 * 1000;
    const endDay = new Date(nextWeek.start.getTime() + 2 * dayMs);
    const [commitment] = await db.insert(commitmentsTable).values({
      tenantId: testIdentity.tenantId,
      ownerUserId: testIdentity.userId,
      title: "تسليم أثناء فترة السفر",
      dueAt: new Date(nextWeek.start.getTime() + dayMs),
      status: "open",
    }).returning();
    const provider = new ScriptedProvider({
      text: "",
      toolCalls: [{
        id: "irrelevant-expense-read",
        name: "query_expenses",
        args: { period: "last_month" },
      }],
    });
    const runtime = new Phase2AgentRuntime(new FailoverModelGateway(
      { groq: provider },
      ["groq"],
    ));

    const message = `أنا مسافر من ${cairoDateLabel(nextWeek.start)} إلى ${cairoDateLabel(endDay)}، شوف لو فيه التزامات ممكن تتعارض مع السفر`;
    const result = await runtime.run(testIdentity, {
      message,
      requestId: "brain-dated-travel-runtime",
    }, { dryRun: true });
    const prompt = provider.calls.flatMap((call) => call.messages)
      .map((item) => item.text ?? "")
      .join("\n");
    const recordsAfter = await db.select({
      id: commitmentsTable.id,
      title: commitmentsTable.title,
      dueAt: commitmentsTable.dueAt,
    }).from(commitmentsTable).where(and(
      eq(commitmentsTable.tenantId, testIdentity.tenantId),
      eq(commitmentsTable.ownerUserId, testIdentity.userId),
    ));

    assert.equal(result.response?.kind, "answer");
    assert.equal(provider.calls.length, 1);
    assert.ok(prompt.includes(commitment.title));
    assert.ok(result.assistantMessage.includes(commitment.title));
    assert.match(result.assistantMessage, /لم أغيّر أي موعد/);
    assert.equal(result.action?.type, "out_of_scope_read_only_tool_rejected");
    assert.equal(result.action?.toolName, "query_expenses");
    assert.equal(result.action?.toolCalls, 0);
    assert.equal(result.action?.llmCalls, 1);
    assert.deepEqual(recordsAfter.map(({ id, title, dueAt }) => ({ id, title, dueAt: dueAt?.toISOString() })), [{
      id: commitment.id,
      title: commitment.title,
      dueAt: commitment.dueAt?.toISOString(),
    }]);
    assert.equal((await countRows(testIdentity)).operations, 0);
  } finally {
    await cleanup(testIdentity);
  }
});

test("travel conflict without dates asks for the interval before calling a provider", async () => {
  const testIdentity = identity("undated-travel-runtime");
  await cleanup(testIdentity);
  try {
    const provider = new ScriptedProvider(finalAnswer("هذا الرد يجب ألا يُستخدم."));
    const runtime = new Phase2AgentRuntime(new FailoverModelGateway(
      { groq: provider },
      ["groq"],
    ));
    const result = await runtime.run(testIdentity, {
      message: "أنا مسافر الأسبوع الجاي، شوف لو فيه التزامات ممكن تتعارض مع السفر",
      requestId: "brain-undated-travel-runtime",
    }, { dryRun: true });

    assert.equal(result.response?.kind, "clarification");
    assert.match(result.assistantMessage, /تاريخ بداية السفر ونهايته/);
    assert.equal(provider.calls.length, 0);
    assert.equal(result.action?.llmCalls, 0);
    assert.deepEqual(await countRows(testIdentity), { expenses: 0, memory: 0, operations: 0 });
  } finally {
    await cleanup(testIdentity);
  }
});

test("planning and financial-conflict intents reject mutating model tools without widening scope", async () => {
  const nextWeek = nextCairoCalendarWeekWindow();
  const cases = [
    {
      label: "planning",
      message: "شوفلي الالتزامات اللي عليا الأسبوع الجاي وقولي أرتبها إزاي",
    },
    {
      label: "travel-conflict",
      message: `أنا مسافر من ${cairoDateLabel(nextWeek.start)} إلى ${cairoDateLabel(new Date(nextWeek.start.getTime() + 2 * 24 * 60 * 60 * 1000))}، شوف لو فيه التزامات تتعارض مع السفر`,
    },
    {
      label: "financial-conflict",
      message: "فاكر إن مصروف المحجر كان 5000 جنيه",
    },
  ];
  for (const scenario of cases) {
    const testIdentity = identity(`read-only-${scenario.label}`);
    await cleanup(testIdentity);
    try {
      const provider = new ScriptedProvider({
        text: "",
        toolCalls: [{
          id: `forbidden-write-${scenario.label}`,
          name: "record_expense",
          args: {
            amountMinor: 500_000,
            currency: "EGP",
            description: "يجب ألا يسجل",
          },
        }],
      });
      const runtime = new Phase2AgentRuntime(new FailoverModelGateway(
        { groq: provider },
        ["groq"],
      ));

      const before = await countRows(testIdentity);
      const result = await runtime.run(testIdentity, {
        message: scenario.message,
        requestId: `brain-read-only-${scenario.label}`,
      });
      const after = await countRows(testIdentity);

      assert.equal(provider.calls.length, 1, scenario.label);
      assert.equal(result.response?.kind, "clarification", scenario.label);
      assert.equal(result.action?.type, "out_of_scope_read_only_tool_rejected", scenario.label);
      assert.equal(result.action?.toolName, "record_expense", scenario.label);
      assert.equal(after.expenses, before.expenses, scenario.label);
      assert.equal(after.operations, before.operations, scenario.label);
    } finally {
      await cleanup(testIdentity);
    }
  }
});

test("memory-financial conflict fixture keeps structured records authoritative", () => {
  const message = "فاكر إن مصروف المحجر كان 5000 جنيه";
  const envelope = createBrainDecisionEnvelope({
    requestId: "brain-memory-financial-conflict",
    conversationId: "brain-memory-financial-conflict-conversation",
    message,
    semanticParse: parseSemanticRequest(message),
    secondBrainTrace: {
      traceId: "brain-memory-financial-conflict-trace",
      requestId: "brain-memory-financial-conflict",
      conversationId: "brain-memory-financial-conflict-conversation",
      strategy: "lexical_v1",
      triggered: true,
      queryDomain: "structured_record_comparison",
      consideredCount: 1,
      selected: [],
      excluded: [{
        memoryId: "memory-conflicting-expense",
        reason: "conflict_structured_record",
      }],
      structuredPrecedence: {
        applied: true,
        domain: "financial_record",
        conflicts: ["memory:5000 EGP", "structured_record:authoritative"],
      },
      llmContextIncluded: false,
      llmContextReason: "structured_records_take_precedence",
    },
  });

  assert.equal(envelope.risk.requiresApproval, false);
  assert.ok(envelope.context.selected.includes("governed_second_brain_context"));
  assert.ok(envelope.context.excluded.includes("unverified_model_claims"));
  assert.equal(envelope.trace.retrievalUsed, true);
});

test("memory-financial conflict runtime supplies the authoritative project expense without writing", async () => {
  const testIdentity = identity("memory-financial-runtime");
  await cleanup(testIdentity);
  try {
    const [savedMemory] = await db.insert(secondBrainMemoriesTable).values({
      id: randomUUID(),
      tenantId: testIdentity.tenantId,
      ownerUserId: testIdentity.userId,
      kind: "fact",
      key: "note:quarry_expense",
      value: "مصروف المحجر كان 5000 جنيه",
      normalizedValue: "مصروف المحجر كان 5000 جنيه",
      confidenceBps: 10_000,
      status: "active",
      sourceConversationId: "memory-financial-runtime",
      sourceTurnId: "saved-expense-memory",
      metadata: { source: "explicit_user_instruction" },
    }).returning();
    const [project] = await db.insert(projectsTable).values({
      tenantId: testIdentity.tenantId,
      ownerUserId: testIdentity.userId,
      name: "المحجر",
      nameKey: "المحجر",
    }).returning();
    const [expense] = await db.insert(expensesTable).values({
      tenantId: testIdentity.tenantId,
      ownerUserId: testIdentity.userId,
      projectId: project.id,
      description: "شراء مولد",
      amountMinor: 825_000,
      currency: "EGP",
    }).returning();
    const before = await countRows(testIdentity);
    const provider = new ScriptedProvider(finalAnswer(
      "السجل الرسمي للمحجر يثبت 8250 جنيه، وهو المرجع المعتمد مقارنة بالملاحظة القديمة.",
      [{ type: "money", value: 8250, currency: "EGP", label: "مصروف المحجر" }],
    ));
    const runtime = new Phase2AgentRuntime(new FailoverModelGateway(
      { groq: provider },
      ["groq"],
    ));

    const result = await runtime.run(testIdentity, {
      message: "فاكر إن مصروف المحجر كان 5000 جنيه",
      requestId: "brain-memory-financial-runtime",
    });
    const after = await countRows(testIdentity);
    const prompt = provider.calls.flatMap((call) => call.messages)
      .map((message) => message.text ?? "")
      .join("\n");

    assert.equal(result.response?.kind, "answer");
    assert.equal(provider.calls.length, 1);
    assert.ok(prompt.includes(expense.description));
    assert.ok(prompt.includes(String(expense.amountMinor)));
    assert.ok(prompt.includes(project.name));
    const secondBrainTrace = JSON.stringify(result.action?.secondBrainRetrievalTrace);
    assert.ok(secondBrainTrace.includes(savedMemory.id));
    assert.ok(secondBrainTrace.includes("structured_record_comparison"));
    assert.ok(secondBrainTrace.includes('"llmContextIncluded":true'));
    assert.equal(after.expenses, before.expenses);
    assert.equal(after.operations, before.operations);
  } finally {
    await cleanup(testIdentity);
  }
});

test("provider failure fixture preserves classification, fallback evidence, and zero writes", async () => {
  const fallbackIdentity = identity("provider-fallback");
  await cleanup(fallbackIdentity);
  const primary = new ScriptedProvider(() => {
    throw providerTimeoutError("gemini");
  });
  const fallback = new ScriptedProvider(finalAnswer("تعذر التحليل الأول، وتم تقديم رد آمن من المزود البديل."));
  const runtime = new Phase2AgentRuntime(new FailoverModelGateway(
    { gemini: primary, groq: fallback },
    ["gemini", "groq"],
  ));

  const recovered = await runtime.run(fallbackIdentity, {
    message: "ساعدني أفهم الصورة العامة للالتزامات القادمة",
    requestId: "brain-provider-fallback",
  }, { dryRun: true });
  assert.equal(recovered.provider, "groq");
  assert.deepEqual(recovered.action?.providerTrace?.providersAttempted, ["gemini", "groq"]);
  assert.equal(recovered.action?.providerTrace?.fallbackOccurred, true);
  assert.deepEqual(await countRows(fallbackIdentity), { expenses: 0, memory: 0, operations: 0 });

  const failedIdentity = identity("provider-total-failure");
  await cleanup(failedIdentity);
  const unavailable = new ScriptedProvider(() => {
    throw providerResponseError("gemini", 503, "fixture unavailable");
  });
  const unavailableFallback = new ScriptedProvider(() => {
    throw providerResponseError("groq", 503, "fixture unavailable");
  });
  const failed = await new Phase2AgentRuntime(new FailoverModelGateway(
      { gemini: unavailable, groq: unavailableFallback },
      ["gemini", "groq"],
    )).run(failedIdentity, {
    message: "ساعدني أفهم الصورة العامة للالتزامات القادمة",
    requestId: "brain-provider-total-failure",
  }, { dryRun: true });
  assert.equal(failed.response?.kind, "error");
  assert.match(failed.assistantMessage, /لم يتم تغيير أي بيانات/);
  assert.deepEqual(failed.action?.providerTrace?.providersAttempted, ["gemini", "groq"]);
  assert.deepEqual(await countRows(failedIdentity), { expenses: 0, memory: 0, operations: 0 });
  await cleanup(fallbackIdentity);
  await cleanup(failedIdentity);
});

test("approval expiry and user cancellation fixtures never claim or execute a pending operation", async () => {
  const testIdentity = identity("approval-lifecycle");
  await cleanup(testIdentity);
  const expired = await createPendingOperation(testIdentity, {
    conversationId: "expired-conversation",
    sourceTurnId: "expired-turn",
    toolName: "record_expense",
    args: { amountMinor: 50000, description: "expired fixture" },
  });
  await db.update(secretaryOperationsTable)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(and(
      eq(secretaryOperationsTable.id, expired.operationId),
      eq(secretaryOperationsTable.tenantId, testIdentity.tenantId),
      eq(secretaryOperationsTable.ownerUserId, testIdentity.userId),
    ));

  const expiredRead = await getOperation(testIdentity, expired.operationId);
  assert.equal(expiredRead?.status, "expired");
  const expiredClaim = await claimOperation(testIdentity, expired.operationId);
  assert.equal(expiredClaim.kind, "existing");
  assert.equal(expiredClaim.operation.status, "expired");

  const cancellable = await createPendingOperation(testIdentity, {
    conversationId: "cancel-conversation",
    sourceTurnId: "cancel-turn",
    toolName: "record_expense",
    args: { amountMinor: 50000, description: "cancelled fixture" },
  });
  const rejected = await rejectOperation(testIdentity, cancellable.operationId);
  assert.equal(rejected.status, "rejected");
  const replay = await claimOperation(testIdentity, cancellable.operationId);
  assert.equal(replay.kind, "existing");
  assert.equal(replay.operation.status, "rejected");
  assert.deepEqual(await countRows(testIdentity), { expenses: 0, memory: 0, operations: 2 });
  await cleanup(testIdentity);
});

test("post-mutation verification failure fixture reports uncertainty without creating a retry", async () => {
  const testIdentity = identity("verification-failure");
  await cleanup(testIdentity);
  const operation = await createPendingOperation(testIdentity, {
    conversationId: "verification-failure-conversation",
    sourceTurnId: "brain-verification-failure",
    idempotencyKey: "brain-verification-failure",
    toolName: "record_expense",
    args: {
      amountMinor: 75000,
      currency: "EGP",
      description: "verification failure fixture",
    },
  });
  const claim = await claimOperation(testIdentity, operation.operationId);
  assert.equal(claim.kind, "claimed");
  const result = await executeStructuredTool(testIdentity, "record_expense", {
    amountMinor: 75000,
    currency: "EGP",
    description: "verification failure fixture",
  }, {
    requestId: "brain-verification-failure",
    approvedOperationId: operation.operationId,
    verificationResolver: async () => ({
      state: "failed",
      checks: ["fixture_authoritative_read_failed"],
      reason: "fixture_verification_failure",
    }),
  });

  assert.equal(result.ok, true);
  assert.equal((result.verification as { state?: string })?.state, "failed");
  const expenses = await db.select({ id: expensesTable.id }).from(expensesTable).where(and(
    eq(expensesTable.tenantId, testIdentity.tenantId),
    eq(expensesTable.ownerUserId, testIdentity.userId),
    eq(expensesTable.description, "verification failure fixture"),
  ));
  assert.equal(expenses.length, 1);
  assert.notEqual((result.verification as { state?: string })?.state, "verified");
  await cleanup(testIdentity);
});