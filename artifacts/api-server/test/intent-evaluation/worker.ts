import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, count, eq } from "drizzle-orm";
import {
  commitmentsTable,
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
};

type Dataset = {
  version: number;
  cases: EvaluationCase[];
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
      rowCountsBefore,
      rowCountsAfter: await rowCounts(identity),
    })}\n`);
  }
}

await main();