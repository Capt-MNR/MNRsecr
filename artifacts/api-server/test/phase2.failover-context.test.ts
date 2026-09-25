import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  activityEventEntitiesTable,
  activityEventsTable,
  agentWorkEvidenceTable,
  agentWorkEventsTable,
  agentWorkRunsTable,
  agentWorksTable,
  commitmentPeopleTable,
  commitmentsTable,
  conversationMemoryTable,
  db,
  notificationOutboxTable,
  peopleTable,
  reminderPeopleTable,
  remindersTable,
  secretaryOperationsTable,
  secondBrainCandidatesTable,
  secondBrainMemoriesTable,
  secondBrainMemoryHistoryTable,
  taskPeopleTable,
  tasksTable,
  triggerOutboxTable,
} from "@workspace/db";
import {
  CohereModelGateway,
  configuredProviderOrder,
  FailoverModelGateway,
  GeminiModelGateway,
  GroqModelGateway,
  Phase2AgentRuntime,
  type ConversationMessage,
  type GatewayCallContext,
  type GatewayRequestMetrics,
  type GatewayResponse,
  type ModelGateway,
  type ProviderName,
} from "../src/lib/phase2.ts";
import type { Identity } from "../src/lib/secretary.ts";

type StructuredRecordEvidence = {
  temporalState: string;
  provenance: { recordId?: string };
  data: Record<string, unknown>;
};

type ParsedContextAssembly = {
  primaryEntity: { id: string; name: string | null } | null;
  evidence: { structuredRecords: StructuredRecordEvidence[] };
};

type ProviderCallObservation = {
  provider: ProviderName;
  fingerprint: string;
  sameContextAsFirst: boolean;
  outcome?: "FAIL" | "SUCCESS";
  reason?: string;
  responseToolNames?: string[];
};

type HttpObservation = {
  provider: ProviderName;
  purpose: "cached_content" | "generation";
  attempt: number;
  status: number;
  reason: string;
};

const scopedMutationTables = {
  people: peopleTable,
  conversationMemory: conversationMemoryTable,
  secondBrainMemories: secondBrainMemoriesTable,
  secondBrainHistory: secondBrainMemoryHistoryTable,
  secondBrainCandidates: secondBrainCandidatesTable,
  commitments: commitmentsTable,
  commitmentPeople: commitmentPeopleTable,
  tasks: tasksTable,
  taskPeople: taskPeopleTable,
  reminders: remindersTable,
  reminderPeople: reminderPeopleTable,
  activities: activityEventsTable,
  activityEventEntities: activityEventEntitiesTable,
  agentWorks: agentWorksTable,
  agentWorkRuns: agentWorkRunsTable,
  agentWorkEvents: agentWorkEventsTable,
  agentWorkEvidence: agentWorkEvidenceTable,
  triggerOutbox: triggerOutboxTable,
  notificationOutbox: notificationOutboxTable,
  approvals: secretaryOperationsTable,
} as const;

const cleanupTables = [
  notificationOutboxTable,
  triggerOutboxTable,
  agentWorkEvidenceTable,
  agentWorkEventsTable,
  agentWorkRunsTable,
  agentWorksTable,
  secretaryOperationsTable,
  secondBrainCandidatesTable,
  secondBrainMemoryHistoryTable,
  secondBrainMemoriesTable,
  conversationMemoryTable,
  activityEventEntitiesTable,
  activityEventsTable,
  commitmentPeopleTable,
  taskPeopleTable,
  reminderPeopleTable,
  remindersTable,
  tasksTable,
  commitmentsTable,
  peopleTable,
] as const;

function createIdentity(): Identity {
  return {
    tenantId: `controlled-failover-${randomUUID()}`,
    userId: "controlled-failover-test",
  };
}

function ownerScope(table: any, identity: Identity) {
  return and(
    eq(table.tenantId, identity.tenantId),
    eq(table.ownerUserId, identity.userId),
  );
}

async function mutationSnapshot(identity: Identity): Promise<Record<string, number>> {
  const tableEntries = Object.entries(scopedMutationTables);
  const counts = await Promise.all(tableEntries.map(async ([, table]) => {
    const scopedTable = table as any;
    const rows = await db.select({ id: scopedTable.id })
      .from(scopedTable)
      .where(ownerScope(scopedTable, identity));
    return rows.length;
  }));
  return Object.fromEntries(tableEntries.map(([name], index) => [name, counts[index]]));
}

async function cleanupIdentity(identity: Identity): Promise<void> {
  for (const table of cleanupTables) {
    const scopedTable = table as any;
    await db.delete(scopedTable).where(ownerScope(scopedTable, identity));
  }
}

function providerIndependentSerialization(
  messages: ConversationMessage[],
  context: GatewayCallContext,
): string {
  return JSON.stringify({
    messages,
    context: {
      requestId: context.requestId,
      conversationId: context.conversationId ?? null,
      callNumber: context.callNumber,
      toolCallsExecuted: context.toolCallsExecuted,
      toolScope: context.toolScope
        ? {
            name: context.toolScope.name,
            allowedToolNames: [...context.toolScope.allowedToolNames].sort(),
            isFull: context.toolScope.isFull,
          }
        : null,
      finalResponseOnly: context.finalResponseOnly ?? false,
      currentUserMessage: context.currentUserMessage ?? null,
      deadlineAt: context.deadlineAt ?? null,
    },
  });
}

function parseContextAssembly(messages: ConversationMessage[]): ParsedContextAssembly | null {
  const message = messages.find((item) => item.text?.startsWith("[Context Assembly v1"));
  if (!message?.text) return null;
  const separator = message.text.indexOf("\n");
  if (separator < 0) return null;
  return JSON.parse(message.text.slice(separator + 1)) as ParsedContextAssembly;
}

function errorReason(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return error instanceof Error ? `${error.name}:${error.message}` : String(error);
}

function providerForUrl(url: string): ProviderName {
  if (url.includes("api.groq.com")) return "groq";
  if (url.includes("generativelanguage.googleapis.com")) return "gemini";
  if (url.includes("api.cohere.com")) return "cohere";
  throw new Error(`Unexpected provider request in controlled test: ${url}`);
}

function restoreEnvironment(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("controlled Groq → Gemini → Cohere failover preserves Ahmad's assembled context without side effects", async () => {
  const identity = createIdentity();
  const previousFetch = globalThis.fetch;
  const envKeys = [
    "AI_PROVIDER",
    "AI_PROVIDER_CATALOG",
    "AI_PRIMARY_PROVIDER",
    "AI_FALLBACK_PROVIDER",
    "AI_SECONDARY_FALLBACK_PROVIDER",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "MISTRAL_API_KEY",
    "COHERE_API_KEY",
    "DEEPSEEK_API_KEY",
    "QWEN_API_KEY",
    "OPENROUTER_API_KEY",
  ] as const;
  const previousEnvironment = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );
  const originalCounts = await mutationSnapshot(identity);
  const providerCalls: ProviderCallObservation[] = [];
  const httpCalls: HttpObservation[] = [];
  const httpCounts: Partial<Record<ProviderName, number>> = {};
  let firstProviderIndependentSerialization: string | undefined;
  let firstFingerprint: string | undefined;
  let assembledContextSeen: ParsedContextAssembly | null = null;
  let metrics: GatewayRequestMetrics | undefined;

  try {
    process.env.AI_PROVIDER = "development";
    delete process.env.AI_PROVIDER_CATALOG;
    process.env.AI_PRIMARY_PROVIDER = "groq";
    process.env.AI_FALLBACK_PROVIDER = "gemini";
    process.env.AI_SECONDARY_FALLBACK_PROVIDER = "cohere";
    process.env.GROQ_API_KEY = "test-only-groq-key";
    process.env.GEMINI_API_KEY = "test-only-gemini-key";
    process.env.COHERE_API_KEY = "test-only-cohere-key";
    delete process.env.MISTRAL_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.QWEN_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    const order = configuredProviderOrder();
    assert.deepEqual(order, ["groq", "gemini", "cohere"]);

    const [ahmad] = await db.insert(peopleTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      name: "أحمد",
      nameKey: "احمد",
    }).returning();
    assert.ok(ahmad);

    const dueAt = new Date("2026-09-25T09:00:00.000Z");
    const [commitment] = await db.insert(commitmentsTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      title: "تسليم التقرير",
      personId: ahmad.id,
      dueAt,
      status: "open",
    }).returning();
    assert.ok(commitment);
    await db.insert(commitmentPeopleTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      commitmentId: commitment.id,
      personId: ahmad.id,
      relationship: "responsible",
    });

    const [task] = await db.insert(tasksTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      title: "إرسال العرض",
      dueAt,
      status: "pending",
    }).returning();
    assert.ok(task);
    await db.insert(taskPeopleTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      taskId: task.id,
      personId: ahmad.id,
      relationship: "assignee",
    });

    const [reminder] = await db.insert(remindersTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      text: "مراجعة التقرير",
      dueAt,
      timezone: "Africa/Cairo",
      status: "scheduled",
    }).returning();
    assert.ok(reminder);
    await db.insert(reminderPeopleTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      reminderId: reminder.id,
      personId: ahmad.id,
      relationship: "about",
    });

    const beforeRun = await mutationSnapshot(identity);
    const expectedIds = new Set([commitment.id, task.id, reminder.id]);
    const acceptedAnswer = "أحمد عليه تسليم التقرير وإرسال العرض ومراجعة التقرير.";

    globalThis.fetch = async (input, init) => {
      const url = input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : String(input);
      const provider = providerForUrl(url);
      const purpose: HttpObservation["purpose"] = provider === "gemini" && url.includes("cachedContents")
        ? "cached_content"
        : "generation";
      const attempt = (httpCounts[provider] ?? 0) + 1;
      httpCounts[provider] = attempt;

      if (provider !== "cohere") {
        httpCalls.push({
          provider,
          purpose,
          attempt,
          status: 503,
          reason: "TEST_INJECTED_TEMPORARY_503",
        });
        return new Response(JSON.stringify({
          error: { message: "TEST_INJECTED_TEMPORARY_503" },
        }), { status: 503, headers: { "content-type": "application/json" } });
      }

      const responseBody = {
        message: {
          content: [{ type: "text", text: acceptedAnswer }],
          tool_calls: [{
            id: "controlled-cohere-final-response",
            function: {
              name: "final_response",
              arguments: JSON.stringify({ kind: "answer", message: acceptedAnswer }),
            },
          }],
        },
        usage: {
          tokens: { input_tokens: 84, output_tokens: 15, total_tokens: 99 },
          billed_units: { input_tokens: 84, output_tokens: 15 },
        },
      };
      httpCalls.push({
        provider,
        purpose,
        attempt,
        status: 200,
        reason: "COHERE_VALID_FINAL_RESPONSE_TOOL_CALL",
      });
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const observe = (inner: ModelGateway): ModelGateway => ({
      provider: inner.provider,
      modelName: inner.modelName,
      async generate(messages, context) {
        const serialized = providerIndependentSerialization(messages, context);
        const fingerprint = createHash("sha256").update(serialized).digest("hex");
        const sameContextAsFirst = firstProviderIndependentSerialization === undefined
          || firstProviderIndependentSerialization === serialized;
        if (firstProviderIndependentSerialization === undefined) {
          firstProviderIndependentSerialization = serialized;
          firstFingerprint = fingerprint;
          assembledContextSeen = parseContextAssembly(messages);
        }
        if (context.metrics) metrics = context.metrics;
        const observation: ProviderCallObservation = {
          provider: inner.provider,
          fingerprint,
          sameContextAsFirst,
        };
        providerCalls.push(observation);
        try {
          const response = await inner.generate(messages, context);
          observation.outcome = "SUCCESS";
          observation.responseToolNames = response.toolCalls.map((call) => call.name);
          observation.reason = response.toolCalls.some((call) => call.name === "final_response")
            ? "ADAPTER_RETURNED_FINAL_RESPONSE_TOOL_CALL"
            : "ADAPTER_RETURNED_RESPONSE";
          return response;
        } catch (error) {
          observation.outcome = "FAIL";
          observation.reason = errorReason(error);
          throw error;
        }
      },
    });

    const gateway = new FailoverModelGateway({
      groq: observe(new GroqModelGateway()),
      gemini: observe(new GeminiModelGateway()),
      cohere: observe(new CohereModelGateway()),
    }, order);
    const requestId = `controlled-failover-${randomUUID()}`;
    const result = await new Phase2AgentRuntime(gateway).run(identity, {
      message: "أحمد كان المفروض يعمل إيه؟",
      conversationId: `controlled-failover-conversation-${randomUUID()}`,
      requestId,
    }, { dryRun: true });

    const observedProviderOrder = providerCalls.map((call) => call.provider);
    assert.deepEqual(observedProviderOrder, ["groq", "gemini", "cohere"]);
    assert.deepEqual(
      result.action?.providerTrace?.providersAttempted,
      ["groq", "gemini", "cohere"],
    );
    assert.deepEqual(
      result.action?.providerTrace?.routesAttempted,
      ["direct:groq", "direct:gemini", "direct:cohere"],
    );
    assert.deepEqual(providerCalls.map((call) => call.outcome), ["FAIL", "FAIL", "SUCCESS"]);
    assert.ok(providerCalls[0]?.reason);
    assert.ok(providerCalls[1]?.reason);
    assert.equal(providerCalls[2]?.reason, "ADAPTER_RETURNED_FINAL_RESPONSE_TOOL_CALL");

    assert.ok(firstProviderIndependentSerialization);
    assert.ok(firstFingerprint);
    assert.ok(providerCalls.every((call) => call.sameContextAsFirst));
    assert.equal(new Set(providerCalls.map((call) => call.fingerprint)).size, 1);
    assert.ok(assembledContextSeen);
    assert.equal(assembledContextSeen.primaryEntity?.id, ahmad.id);
    assert.equal(assembledContextSeen.primaryEntity?.name, "أحمد");
    const assembledRecords = assembledContextSeen.evidence.structuredRecords;
    for (const id of expectedIds) {
      const evidence = assembledRecords.find((record) => record.provenance.recordId === id);
      assert.ok(evidence, `missing structured record ${id}`);
      assert.equal(evidence.temporalState, "current");
    }
    assert.deepEqual(
      assembledRecords
        .filter((record) => expectedIds.has(record.provenance.recordId ?? ""))
        .map((record) => record.data.type)
        .sort(),
      ["commitment", "reminder", "task"],
    );

    assert.equal(result.provider, "cohere");
    assert.equal(result.response?.kind, "answer");
    assert.equal(result.response?.message, acceptedAnswer);
    assert.deepEqual(providerCalls[2]?.responseToolNames, ["final_response"]);

    const generationCalls = httpCalls.filter((call) => call.purpose === "generation");
    assert.equal(httpCalls.filter((call) => call.provider === "groq").length, 1);
    assert.ok(httpCalls.some((call) => call.provider === "gemini" && call.purpose === "cached_content"));
    assert.ok(generationCalls.some((call) => call.provider === "gemini"));
    assert.equal(httpCalls.filter((call) => call.provider === "cohere").length, 1);
    assert.ok(httpCalls.filter((call) => call.provider !== "cohere").every((call) => call.status === 503));
    assert.equal(httpCalls.find((call) => call.provider === "cohere")?.status, 200);
    assert.deepEqual(
      httpCalls
        .map((call) => call.provider)
        .filter((provider, index, providers) => index === 0 || provider !== providers[index - 1]),
      ["groq", "gemini", "cohere"],
    );

    const afterRun = await mutationSnapshot(identity);
    assert.deepEqual(afterRun, beforeRun);
    assert.ok(metrics);
    const usageByProvider = metrics.attempts.map((attempt) => ({
      provider: attempt.provider,
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
      success: attempt.success,
      failureReason: attempt.failureReason,
    }));
    const cohereUsage = metrics.attempts.find((attempt) => attempt.provider === "cohere");
    assert.equal(cohereUsage?.inputTokens, 84);
    assert.equal(cohereUsage?.outputTokens, 15);

    console.log("CONTROLLED_FAILOVER_EVIDENCE", JSON.stringify({
      observedProviderOrder,
      providerCalls: providerCalls.map(({ provider, outcome, reason, fingerprint }) => ({
        provider,
        outcome,
        reason,
        fingerprint,
      })),
      providerIndependentFingerprint: firstFingerprint,
      httpCalls,
      metricsHttpAttemptsByProvider: result.action?.providerTrace?.httpAttemptsByProvider,
      usageByProvider,
      response: result.response,
      mutationCountsBefore: beforeRun,
      mutationCountsAfter: afterRun,
    }));
  } finally {
    globalThis.fetch = previousFetch;
    await cleanupIdentity(identity);
    restoreEnvironment(previousEnvironment);
  }

  const afterCleanup = await mutationSnapshot(identity);
  assert.deepEqual(afterCleanup, originalCounts);
});