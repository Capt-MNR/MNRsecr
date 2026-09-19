import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  conversationMemoryTable,
  db,
  expensesTable,
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

function finalAnswer(message: string): GatewayResponse {
  return {
    text: "",
    toolCalls: [{
      id: "brain-evaluation-final",
      name: "final_response",
      args: { kind: "answer", message },
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
  await db.delete(conversationMemoryTable).where(and(
    eq(conversationMemoryTable.tenantId, identity.tenantId),
    eq(conversationMemoryTable.ownerUserId, identity.userId),
  ));
  await db.delete(secretaryOperationsTable).where(and(
    eq(secretaryOperationsTable.tenantId, identity.tenantId),
    eq(secretaryOperationsTable.ownerUserId, identity.userId),
  ));
  await db.delete(expensesTable).where(and(
    eq(expensesTable.tenantId, identity.tenantId),
    eq(expensesTable.ownerUserId, identity.userId),
  ));
}

test("planning fixture measures read-only provider-backed planning separately from safety", async () => {
  const testIdentity = identity("planning");
  await cleanup(testIdentity);
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

  assert.equal(result.response?.kind, "answer");
  assert.match(result.assistantMessage, /خطة الأسبوع/);
  assert.match(result.assistantMessage, /لا يتم تنفيذ/);
  assert.equal(result.action?.providerTrace?.providersAttempted?.length, 1);
  assert.equal(result.action?.llmCalls, 1);
  assert.deepEqual(await countRows(testIdentity), { expenses: 0, memory: 0, operations: 0 });
  await cleanup(testIdentity);
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
      queryDomain: "structured_record_read",
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
  const result = await executeStructuredTool(testIdentity, "record_expense", {
    amountMinor: 75000,
    currency: "EGP",
    description: "verification failure fixture",
  }, {
    requestId: "brain-verification-failure",
    approvedOperationId: "brain-verification-operation",
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