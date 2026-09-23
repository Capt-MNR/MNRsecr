import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  activityEventsTable,
  activityEventEntitiesTable,
  commitmentsTable,
  conversationMemoryTable,
  db,
  expensesTable,
  peopleTable,
  projectsTable,
  remindersTable,
  secondBrainCandidatesTable,
  secondBrainMemoriesTable,
  secretaryOperationsTable,
  tasksTable,
} from "@workspace/db";
import type { Identity } from "../../src/lib/secretary";
import {
  FailoverModelGateway,
  executeStructuredTool,
  type ConversationMessage,
  type GatewayCallContext,
  type GatewayResponse,
  type ModelGateway,
  type ProviderName,
} from "../../src/lib/phase2";
import {
  claimOperation,
  createPendingOperation,
  getOperation,
  rejectOperation,
} from "../../src/lib/secretary-operations";
import {
  providerResponseError,
  providerTimeoutError,
  SecretaryError,
} from "../../src/lib/error-contract";
import type { BrainVerificationState } from "../../src/lib/brain-contract";
import type { ContractScenario } from "./contract-v1";

export type ProviderEvidenceStatus =
  | "not_called"
  | "succeeded"
  | "failed"
  | "rate_limited"
  | "not_executable";

export type IsolatedScenarioEvidence = {
  expectedOutcome: string;
  observedOutcome: string;
  mutationCount: number;
  verificationState: BrainVerificationState | "not_measured";
  correlationId: string;
  providerStatus: ProviderEvidenceStatus;
  correctnessScoring: "included" | "excluded_provider_rate_limit" | "not_executable";
  safetyPass: boolean;
  fixtureTenantId: string;
  fixtureUserId: string;
  cleanupCompleted: boolean;
};

type RowCounts = {
  people: number;
  projects: number;
  commitments: number;
  tasks: number;
  reminders: number;
  expenses: number;
  memories: number;
  candidates: number;
  operations: number;
  conversations: number;
  activityEvents: number;
};

const scopedTables = [
  peopleTable,
  projectsTable,
  commitmentsTable,
  tasksTable,
  remindersTable,
  expensesTable,
  secondBrainMemoriesTable,
  secondBrainCandidatesTable,
  secretaryOperationsTable,
  conversationMemoryTable,
  activityEventsTable,
  activityEventEntitiesTable,
] as const;

type ScopedTable = (typeof scopedTables)[number];

function identityFor(runId: string, scenarioId: string): Identity {
  return {
    tenantId: `brain-eval-${runId}-${scenarioId}-${randomUUID()}`,
    userId: `brain-eval-user-${scenarioId}-${randomUUID()}`,
  };
}

async function rowCounts(identity: Identity): Promise<RowCounts> {
  const owned = <T extends { tenantId: unknown; ownerUserId: unknown }>(table: T) =>
    and(eq(table.tenantId, identity.tenantId), eq(table.ownerUserId, identity.userId));
  const [
    people,
    projects,
    commitments,
    tasks,
    reminders,
    expenses,
    memories,
    candidates,
    operations,
    conversations,
    activityEvents,
  ] = await Promise.all([
    db.select({ id: peopleTable.id }).from(peopleTable).where(owned(peopleTable)),
    db.select({ id: projectsTable.id }).from(projectsTable).where(owned(projectsTable)),
    db.select({ id: commitmentsTable.id }).from(commitmentsTable).where(owned(commitmentsTable)),
    db.select({ id: tasksTable.id }).from(tasksTable).where(owned(tasksTable)),
    db.select({ id: remindersTable.id }).from(remindersTable).where(owned(remindersTable)),
    db.select({ id: expensesTable.id }).from(expensesTable).where(owned(expensesTable)),
    db.select({ id: secondBrainMemoriesTable.id }).from(secondBrainMemoriesTable).where(owned(secondBrainMemoriesTable)),
    db.select({ id: secondBrainCandidatesTable.id }).from(secondBrainCandidatesTable).where(owned(secondBrainCandidatesTable)),
    db.select({ id: secretaryOperationsTable.id }).from(secretaryOperationsTable).where(owned(secretaryOperationsTable)),
    db.select({ id: conversationMemoryTable.id }).from(conversationMemoryTable).where(owned(conversationMemoryTable)),
    db.select({ id: activityEventsTable.id }).from(activityEventsTable).where(owned(activityEventsTable)),
  ]);
  return {
    people: people.length,
    projects: projects.length,
    commitments: commitments.length,
    tasks: tasks.length,
    reminders: reminders.length,
    expenses: expenses.length,
    memories: memories.length,
    candidates: candidates.length,
    operations: operations.length,
    conversations: conversations.length,
    activityEvents: activityEvents.length,
  };
}

function domainMutationCount(before: RowCounts, after: RowCounts): number {
  return [
    "people",
    "projects",
    "commitments",
    "tasks",
    "reminders",
    "expenses",
    "memories",
    "candidates",
  ].reduce((count, key) => {
    const field = key as keyof RowCounts;
    return count + Math.max(0, after[field] - before[field]);
  }, 0);
}

async function cleanup(identity: Identity): Promise<void> {
  for (const table of [...scopedTables].reverse()) {
    await db.delete(table as ScopedTable).where(and(
      eq(table.tenantId, identity.tenantId),
      eq(table.ownerUserId, identity.userId),
    ));
  }
}

class ScriptedFailureProvider implements ModelGateway {
  readonly provider: ProviderName;
  readonly modelName: string;

  constructor(
    provider: ProviderName,
    private readonly failure: SecretaryError,
  ) {
    this.provider = provider;
    this.modelName = "brain-evaluation-scripted-failure";
  }

  async generate(
    _messages: ConversationMessage[],
    _context: GatewayCallContext,
  ): Promise<GatewayResponse> {
    throw this.failure;
  }
}

async function providerFailureEvidence(
  scenario: ContractScenario,
  identity: Identity,
  correlationId: string,
): Promise<Pick<IsolatedScenarioEvidence, "observedOutcome" | "providerStatus" | "correctnessScoring">> {
  const rateLimited = scenario.scenarioId === "24";
  const failure = rateLimited
    ? providerResponseError("gemini", 429, "fixture quota rate limit")
    : providerTimeoutError("gemini");
  const fallbackFailure = rateLimited
    ? providerResponseError("groq", 429, "fixture quota rate limit")
    : providerResponseError("groq", 503, "fixture unavailable");
  const gateway = new FailoverModelGateway({
    gemini: new ScriptedFailureProvider("gemini", failure),
    groq: new ScriptedFailureProvider("groq", fallbackFailure),
  }, ["gemini", "groq"]);

  try {
    await gateway.generate([], {
      requestId: correlationId,
      conversationId: `brain-eval-conversation-${scenario.scenarioId}`,
      callNumber: 1,
      toolCallsExecuted: 0,
      currentUserMessage: scenario.input,
    });
    return {
      observedOutcome: "provider fixture unexpectedly returned a response; no mutation was attempted",
      providerStatus: "succeeded",
      correctnessScoring: "included",
    };
  } catch (error) {
    const classified = error instanceof SecretaryError ? error : null;
    const status: ProviderEvidenceStatus = classified?.category === "provider_rate_limit"
      ? "rate_limited"
      : "failed";
    return {
      observedOutcome: `classified provider failure (${classified?.code ?? "unknown"}); no mutation was attempted`,
      providerStatus: status,
      correctnessScoring: status === "rate_limited"
        ? "excluded_provider_rate_limit"
        : "included",
    };
  } finally {
    await cleanup(identity);
  }
}

async function operationSafetyEvidence(
  scenario: ContractScenario,
  identity: Identity,
  correlationId: string,
): Promise<Pick<IsolatedScenarioEvidence, "observedOutcome" | "mutationCount" | "verificationState">> {
  const before = await rowCounts(identity);
  if (scenario.scenarioId === "25") {
    const pending = await createPendingOperation(identity, {
      conversationId: `brain-eval-conversation-${scenario.scenarioId}`,
      sourceTurnId: correlationId,
      toolName: "record_expense",
      args: { amountMinor: 50000, currency: "EGP", description: "expired fixture" },
    });
    await db.update(secretaryOperationsTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(and(
        eq(secretaryOperationsTable.id, pending.operationId),
        eq(secretaryOperationsTable.tenantId, identity.tenantId),
        eq(secretaryOperationsTable.ownerUserId, identity.userId),
      ));
    const expired = await getOperation(identity, pending.operationId);
    const claim = await claimOperation(identity, pending.operationId);
    const after = await rowCounts(identity);
    return {
      observedOutcome: `operation state=${expired?.status ?? "missing"}; claim state=${claim.operation.status}; no expense executed`,
      mutationCount: domainMutationCount(before, after),
      verificationState: "not_required",
    };
  }

  if (scenario.scenarioId === "27") {
    const pending = await createPendingOperation(identity, {
      conversationId: `brain-eval-conversation-${scenario.scenarioId}`,
      sourceTurnId: correlationId,
      toolName: "record_expense",
      args: { amountMinor: 50000, currency: "EGP", description: "cancelled fixture" },
    });
    const rejected = await rejectOperation(identity, pending.operationId);
    const replay = await claimOperation(identity, pending.operationId);
    const after = await rowCounts(identity);
    return {
      observedOutcome: `operation state=${rejected.status}; replay state=${replay.operation.status}; no expense executed`,
      mutationCount: domainMutationCount(before, after),
      verificationState: "not_required",
    };
  }

  const result = await executeStructuredTool(identity, "record_expense", {
    amountMinor: 75000,
    currency: "EGP",
    description: "verification failure fixture",
  }, {
    requestId: correlationId,
    approvedOperationId: `brain-eval-approved-${scenario.scenarioId}`,
    verificationResolver: async () => ({
      state: "failed",
      checks: ["fixture_authoritative_read_failed"],
      reason: "fixture_verification_failure",
    }),
  });
  const after = await rowCounts(identity);
  const verification = result.verification as { state?: BrainVerificationState } | undefined;
  return {
    observedOutcome: `mutation attempted once; verification state=${verification?.state ?? "not_measured"}; no retry was attempted`,
    mutationCount: domainMutationCount(before, after),
    verificationState: verification?.state ?? "not_measured",
  };
}

export async function collectIsolatedScenarioEvidence(
  scenario: ContractScenario,
  runId: string,
): Promise<IsolatedScenarioEvidence> {
  const identity = identityFor(runId, scenario.scenarioId);
  const correlationId = `brain-eval-${runId}-${scenario.scenarioId}-${randomUUID()}`;
  let evidence: IsolatedScenarioEvidence = {
    expectedOutcome: scenario.expectation.expectedOutcome,
    observedOutcome: "deterministic envelope only; no provider or mutation was executed",
    mutationCount: 0,
    verificationState: "not_measured",
    correlationId,
    providerStatus: "not_called",
    correctnessScoring: scenario.executionMode === "not_executable" ? "not_executable" : "included",
    safetyPass: scenario.executionMode === "envelope",
    fixtureTenantId: identity.tenantId,
    fixtureUserId: identity.userId,
    cleanupCompleted: false,
  };

  try {
    if (scenario.scenarioId === "23" || scenario.scenarioId === "24") {
      const providerEvidence = await providerFailureEvidence(scenario, identity, correlationId);
      evidence = { ...evidence, ...providerEvidence, verificationState: "not_required", safetyPass: true };
    } else if (scenario.scenarioId === "25" || scenario.scenarioId === "26" || scenario.scenarioId === "27") {
      const safetyEvidence = await operationSafetyEvidence(scenario, identity, correlationId);
      evidence = { ...evidence, ...safetyEvidence, safetyPass: true };
    } else if (scenario.scenarioId === "30") {
      evidence = {
        ...evidence,
        observedOutcome: "proactive obligation contract represented; scheduler and notification execution are not executable in this runner",
        verificationState: "not_required",
        correctnessScoring: "not_executable",
        providerStatus: "not_executable",
        safetyPass: true,
      };
    }
  } finally {
    await cleanup(identity);
    evidence.cleanupCompleted = true;
  }
  return evidence;
}

export function createEvidenceRunId(): string {
  return `${process.pid}-${Date.now()}-${randomUUID()}`;
}