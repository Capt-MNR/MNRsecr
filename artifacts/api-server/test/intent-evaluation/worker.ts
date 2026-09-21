import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, count, eq } from "drizzle-orm";
import {
  commitmentsTable,
  conversationMemoryTable,
  db,
  expensesTable,
  peopleTable,
  projectPeopleTable,
  projectsTable,
  remindersTable,
  tasksTable,
} from "@workspace/db";
import {
  classifySecretaryError,
  type SecretaryError,
} from "../../src/lib/error-contract.ts";
import {
  FailoverModelGateway,
  GeminiModelGateway,
  GroqModelGateway,
  Phase2AgentRuntime,
  type ConversationMessage,
  type GatewayCallContext,
  type GatewayResponse,
  type ModelGateway,
  type ProviderName,
} from "../../src/lib/phase2.ts";
import {
  emptyConversationState,
  loadConversationMemory,
  saveConversationTurn,
  type ConversationState,
} from "../../src/lib/conversation-memory.ts";
import { rememberSecondBrain } from "../../src/lib/second-brain.ts";

type EvaluationCase = {
  id: string;
  category: string;
  message: string;
  contextMode: "none" | "context_required";
  expected: {
    intent: string;
    primaryTool: string;
    acceptableTools: string[];
    clarification: boolean;
    write: boolean;
  };
  fixture?: Fixture;
};

type Dataset = {
  version: number;
  cases: EvaluationCase[];
};

type Fixture = {
  people?: Array<{ name: string; aliases?: string[]; role?: string }>;
  projects?: Array<{ name: string; aliases?: string[]; role?: string }>;
  conversation?: Array<{
    userMessage: string;
    assistantMessage: string;
    people?: number[];
    projects?: number[];
  }>;
  expectations?: Array<{
    entityType: "person" | "project";
    query: string;
    expectedIndex?: number;
    expectedMatchType: "exact" | "alias" | "fuzzy" | "ambiguous" | "none";
  }>;
};

type RowCounts = {
  people: number;
  projects: number;
  expenses: number;
  tasks: number;
  reminders: number;
  commitments: number;
  projectPeople: number;
};

class RecordingGateway implements ModelGateway {
  readonly usage: unknown[] = [];

  constructor(private readonly inner: ModelGateway) {}

  get provider(): ProviderName {
    return this.inner.provider;
  }

  get modelName(): string {
    return this.inner.modelName;
  }

  async generate(
    messages: ConversationMessage[],
    context: GatewayCallContext,
  ): Promise<GatewayResponse> {
    const response = await this.inner.generate(messages, context);
    if (response.usage !== undefined) this.usage.push(response.usage);
    return response;
  }

  getProviderForRequest(requestId: string): { provider: ProviderName; model: string } {
    return this.inner.getProviderForRequest?.(requestId) ?? {
      provider: this.inner.provider,
      model: this.inner.modelName,
    };
  }

  getTrace(requestId: string) {
    return this.inner.getTrace?.(requestId);
  }

  finishRequest(requestId: string): void {
    this.inner.finishRequest?.(requestId);
  }
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function gatewayForMode(mode: string): RecordingGateway {
  const order: ProviderName[] = mode === "groq"
    ? ["groq"]
    : mode === "gemini"
      ? ["gemini"]
      : ["groq", "gemini"];
  const gateways: Partial<Record<ProviderName, ModelGateway>> = {};
  for (const provider of order) {
    gateways[provider] = provider === "groq"
      ? new GroqModelGateway()
      : new GeminiModelGateway();
  }
  return new RecordingGateway(new FailoverModelGateway(gateways, order));
}

function errorPayload(error: unknown): Record<string, unknown> {
  const classified = classifySecretaryError(error) as SecretaryError;
  return {
    message: classified.message,
    status: classified.status,
    category: classified.category,
    code: classified.code,
    provider: classified.provider,
    retryable: classified.retryable,
    retryAfterSeconds: classified.retryAfterSeconds,
  };
}

async function rowCounts(identity: { tenantId: string; userId: string }): Promise<RowCounts> {
  const ownership = <T extends { tenantId: unknown; ownerUserId: unknown }>(table: T) =>
    and(eq(table.tenantId, identity.tenantId), eq(table.ownerUserId, identity.userId));
  const [
    people,
    projects,
    expenses,
    tasks,
    reminders,
    commitments,
    projectPeople,
  ] = await Promise.all([
    db.select({ count: count() }).from(peopleTable).where(ownership(peopleTable)),
    db.select({ count: count() }).from(projectsTable).where(ownership(projectsTable)),
    db.select({ count: count() }).from(expensesTable).where(ownership(expensesTable)),
    db.select({ count: count() }).from(tasksTable).where(ownership(tasksTable)),
    db.select({ count: count() }).from(remindersTable).where(ownership(remindersTable)),
    db.select({ count: count() }).from(commitmentsTable).where(ownership(commitmentsTable)),
    db.select({ count: count() }).from(projectPeopleTable).where(ownership(projectPeopleTable)),
  ]);
  return {
    people: Number(people[0]?.count ?? 0),
    projects: Number(projects[0]?.count ?? 0),
    expenses: Number(expenses[0]?.count ?? 0),
    tasks: Number(tasks[0]?.count ?? 0),
    reminders: Number(reminders[0]?.count ?? 0),
    commitments: Number(commitments[0]?.count ?? 0),
    projectPeople: Number(projectPeople[0]?.count ?? 0),
  };
}

async function prepareFixture(
  identity: { tenantId: string; userId: string },
  conversationId: string,
  fixture: Fixture | undefined,
): Promise<{ expectations: Array<Record<string, unknown>> }> {
  if (!fixture) return { expectations: [] };

  const people = [];
  for (const person of fixture.people ?? []) {
    const existing = await db.select().from(peopleTable).where(and(
      eq(peopleTable.tenantId, identity.tenantId),
      eq(peopleTable.ownerUserId, identity.userId),
      eq(peopleTable.name, person.name),
    )).limit(1);
    const [row] = existing.length > 0
      ? existing
      : await db.insert(peopleTable).values({
          tenantId: identity.tenantId,
          ownerUserId: identity.userId,
          name: person.name,
          nameKey: person.name.toLocaleLowerCase("ar"),
        }).returning();
    if (!row) throw new Error(`Could not prepare fixture person: ${person.name}`);
    people.push({ id: row.id, name: row.name, type: "person" as const });
    for (const alias of person.aliases ?? []) {
      await rememberSecondBrain(identity, {
        memoryKind: "alias",
        key: `intent-eval:${conversationId}:person:${alias}`,
        value: person.name,
        metadata: {
          alias,
          canonical: person.name,
          entityType: "person",
          entityId: row.id,
        },
      });
    }
  }

  const projects = [];
  for (const project of fixture.projects ?? []) {
    const existing = await db.select().from(projectsTable).where(and(
      eq(projectsTable.tenantId, identity.tenantId),
      eq(projectsTable.ownerUserId, identity.userId),
      eq(projectsTable.name, project.name),
    )).limit(1);
    const [row] = existing.length > 0
      ? existing
      : await db.insert(projectsTable).values({
          tenantId: identity.tenantId,
          ownerUserId: identity.userId,
          name: project.name,
          nameKey: project.name.toLocaleLowerCase("ar"),
        }).returning();
    if (!row) throw new Error(`Could not prepare fixture project: ${project.name}`);
    projects.push({ id: row.id, name: row.name, type: "project" as const });
    for (const alias of project.aliases ?? []) {
      await rememberSecondBrain(identity, {
        memoryKind: "alias",
        key: `intent-eval:${conversationId}:project:${alias}`,
        value: project.name,
        metadata: {
          alias,
          canonical: project.name,
          entityType: "project",
          entityId: row.id,
        },
      });
    }
  }

  if (fixture.conversation?.length) {
    await db.delete(conversationMemoryTable).where(and(
      eq(conversationMemoryTable.tenantId, identity.tenantId),
      eq(conversationMemoryTable.ownerUserId, identity.userId),
      eq(conversationMemoryTable.conversationId, conversationId),
    ));
    let state: ConversationState = emptyConversationState();
    let snapshot = await loadConversationMemory(identity, conversationId);
    for (const turn of fixture.conversation) {
      const selectedPeople = (turn.people ?? [])
        .map((index) => people[index])
        .filter((item): item is (typeof people)[number] => Boolean(item));
      const selectedProjects = (turn.projects ?? [])
        .map((index) => projects[index])
        .filter((item): item is (typeof projects)[number] => Boolean(item));
      state = {
        ...state,
        people: selectedPeople,
        projects: selectedProjects,
        candidatePeople: selectedPeople,
        candidateProjects: selectedProjects,
        ...(selectedPeople.length === 1 ? { lastPerson: selectedPeople[0] } : {}),
        ...(selectedProjects.length === 1 ? { lastProject: selectedProjects[0] } : {}),
      };
      snapshot = await saveConversationTurn(identity, snapshot, {
        userMessage: turn.userMessage,
        assistantMessage: turn.assistantMessage,
        action: { type: "fixture_context", conversationState: state },
      });
    }
  }

  return {
    expectations: (fixture.expectations ?? []).map((expectation) => ({
      entityType: expectation.entityType,
      query: expectation.query,
      expectedMatchType: expectation.expectedMatchType,
      expectedEntityId: expectation.expectedIndex === undefined
        ? null
        : (expectation.entityType === "person"
          ? people[expectation.expectedIndex]?.id
          : projects[expectation.expectedIndex]?.id) ?? null,
    })),
  };
}

async function main(): Promise<void> {
  const caseId = readArg("--case");
  const mode = readArg("--mode") ?? "groq";
  if (!caseId) throw new Error("--case is required");

  const datasetPath = readArg("--dataset");
  const dataset = JSON.parse(
    await readFile(datasetPath ?? new URL("./dataset.json", import.meta.url), "utf8"),
  ) as Dataset;
  const evaluationCase = dataset.cases.find((item) => item.id === caseId);
  if (!evaluationCase) throw new Error(`Unknown evaluation case: ${caseId}`);

  const gateway = gatewayForMode(mode);
  const runtime = new Phase2AgentRuntime(gateway);
  const requestId = `intent-eval-${mode}-${evaluationCase.id}-${randomUUID()}`;
  const identity = {
    tenantId: process.env.INTENT_EVAL_TENANT_ID
      ?? `intent-eval-read-only-${mode}-${evaluationCase.id}`,
    userId: process.env.INTENT_EVAL_USER_ID ?? "intent-eval-read-only",
  };
  const conversationId = process.env.INTENT_EVAL_CONVERSATION_ID
    ?? `intent-eval-${mode}-${evaluationCase.id}`;
  const fixture = await prepareFixture(identity, conversationId, evaluationCase.fixture);
  const startedAt = Date.now();
  const rowCountsBefore = await rowCounts(identity);

  try {
    const result = await runtime.run(identity, {
      message: evaluationCase.message,
      conversationId,
      requestId,
    }, { dryRun: true });
    const action = result.action ?? {};
    process.stdout.write(`EVAL_RESULT ${JSON.stringify({
      ok: true,
      caseId,
      mode,
      dryRun: true,
      elapsedMs: Date.now() - startedAt,
      provider: result.provider,
      model: result.model,
      responseKind: result.response?.kind,
      assistantMessage: result.assistantMessage,
      action: {
        type: action.type,
        lastTool: action.lastTool,
        llmCalls: action.llmCalls,
        toolCalls: action.toolCalls,
        providerTrace: action.providerTrace,
      },
      tokenUsage: gateway.usage,
      fixtureExpectations: fixture.expectations,
      rowCountsBefore,
      rowCountsAfter: await rowCounts(identity),
    })}\n`);
  } catch (error) {
    process.stdout.write(`EVAL_RESULT ${JSON.stringify({
      ok: false,
      caseId,
      mode,
      dryRun: true,
      elapsedMs: Date.now() - startedAt,
      error: errorPayload(error),
      tokenUsage: gateway.usage,
      fixtureExpectations: fixture.expectations,
      rowCountsBefore,
      rowCountsAfter: await rowCounts(identity),
    })}\n`);
  }
}

await main();