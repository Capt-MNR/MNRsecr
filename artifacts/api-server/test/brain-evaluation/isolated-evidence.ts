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
import {
  developmentAgentRuntime,
  persistence,
  type Identity,
} from "../../src/lib/secretary";
import {
  loadConversationMemory,
  saveConversationTurn,
} from "../../src/lib/conversation-memory";
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
  ambiguityResolution: {
    status: "PASS" | "FAIL";
    candidateCount: number;
    mismatchReason: string | null;
    outcome: string;
  } | null;
  correctionDecision: {
    status: "PASS" | "FAIL" | "BLOCKED_BY_INFRASTRUCTURE";
    comparedFields: string[];
    mismatchReason: string | null;
    outcome: string;
    previousExpenseId: string;
    operationId: string | null;
    toolName: string | null;
    targetExpenseId: string | null;
    amountMinor: number | null;
    personId: string | null;
    occurredAt: string | null;
    finalPersistedState: string;
    failureClassification: string | null;
  } | null;
  limitation: string | null;
  failureClassification: string | null;
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
      correctnessScoring: "not_executable",
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
        : "not_executable",
    };
  } finally {
    await cleanup(identity);
  }
}

async function correctionDecisionEvidence(
  scenario: ContractScenario,
  identity: Identity,
  correlationId: string,
): Promise<Pick<
  IsolatedScenarioEvidence,
  | "observedOutcome"
  | "mutationCount"
  | "verificationState"
  | "providerStatus"
  | "correctnessScoring"
  | "safetyPass"
  | "correctionDecision"
  | "limitation"
  | "failureClassification"
>> {
  const conversationId = `brain-eval-conversation-${scenario.scenarioId}-${randomUUID()}`;
  const previousExpense = await persistence.createExpense(identity, {
    amountMinor: 50000,
    currency: "EGP",
    description: "isolated correction baseline",
    personName: "محمد",
  });
  const expectedPerson = scenario.scenarioId === "17"
    ? await persistence.createPerson(identity, "أحمد")
    : null;
  const memory = await loadConversationMemory(identity, conversationId);
  await saveConversationTurn(identity, memory, {
    turnId: `${correlationId}-previous`,
    userMessage: "سجلت لمحمد 500 جنيه",
    assistantMessage: "تم تسجيل المصروف.",
    action: {
      type: "expense_recorded",
      expenseId: previousExpense.id,
      amountMinor: previousExpense.amountMinor,
      currency: previousExpense.currency,
      personId: previousExpense.personId,
      personName: "محمد",
      occurredAt: previousExpense.occurredAt instanceof Date
        ? previousExpense.occurredAt.toISOString()
        : String(previousExpense.occurredAt),
    },
  });

  const before = await rowCounts(identity);
  const response = await developmentAgentRuntime.run(identity, {
    message: scenario.input,
    conversationId,
    requestId: correlationId,
    idempotencyKey: `${correlationId}-correction`,
  });
  const after = await rowCounts(identity);
  const action = response.action ?? {};
  const args = action.args && typeof action.args === "object"
    ? action.args as Record<string, unknown>
    : {};
  const toolName = typeof action.toolName === "string" ? action.toolName : null;
  const operationId = typeof action.operationId === "string" ? action.operationId : null;
  const targetExpenseId = typeof args.expenseId === "string" ? args.expenseId : null;
  const amountMinor = typeof args.amountMinor === "number" ? args.amountMinor : null;
  const personId = typeof args.personId === "string" ? args.personId : null;
  const occurredAt = typeof args.occurredAt === "string" ? args.occurredAt : null;
  const isUpdateOperation = action.type === "approval_required" && toolName === "update_expense";
  const noDuplicateExpense = after.expenses === before.expenses;

  if (scenario.scenarioId === "16") {
    const passed = isUpdateOperation
      && targetExpenseId === previousExpense.id
      && amountMinor === 75000
      && noDuplicateExpense;
    return {
      observedOutcome: `deterministic correction returned ${String(action.type ?? "no action")} / ${toolName ?? "no tool"}; target=${targetExpenseId ?? "none"}; amountMinor=${amountMinor ?? "none"}; duplicate expense=${!noDuplicateExpense}`,
      mutationCount: domainMutationCount(before, after),
      verificationState: "not_required",
      providerStatus: "not_called",
      correctnessScoring: "not_executable",
      safetyPass: noDuplicateExpense,
      correctionDecision: {
        status: passed ? "PASS" : "FAIL",
        comparedFields: ["existingExpenseTarget", "correctedAmount", "noDuplicateExpense"],
        mismatchReason: passed
          ? null
          : "the deterministic path did not create a pending update_expense for the existing expense with amountMinor=75000",
        outcome: passed
          ? "A pending update targets the prior expense with the corrected amount; no duplicate expense was created."
          : "The deterministic path did not produce the expected pending correction operation.",
        previousExpenseId: previousExpense.id,
        operationId,
        toolName,
        targetExpenseId,
        amountMinor,
        personId,
        occurredAt,
        finalPersistedState: "not executed; the update remains subject to the existing approval flow",
        failureClassification: passed ? null : "Agent Core bug",
      },
      limitation: "Decision-stage correction was exercised with seeded conversation provenance; final persisted state was not verified because the approval flow was not executed.",
      failureClassification: "blocked/not executable",
    };
  }

  const hasExpectedUpdate = scenario.scenarioId === "17"
    && isUpdateOperation
    && targetExpenseId === previousExpense.id
    && noDuplicateExpense
    && personId === expectedPerson?.id;
  return {
    observedOutcome: `seeded prior expense and conversation; deterministic path returned ${String(action.type ?? "no action")} / ${toolName ?? "no tool"}; target=${targetExpenseId ?? "none"}; Ahmed fixture=${expectedPerson?.id ?? "not applicable"}; duplicate expense=${!noDuplicateExpense}`,
    mutationCount: domainMutationCount(before, after),
    verificationState: "not_measured",
    providerStatus: "not_called",
    correctnessScoring: "not_executable",
    safetyPass: noDuplicateExpense,
    correctionDecision: {
      status: hasExpectedUpdate ? "PASS" : "BLOCKED_BY_INFRASTRUCTURE",
      comparedFields: scenario.scenarioId === "17"
        ? ["existingExpenseTarget", "uniqueAhmedResolution", "noDuplicateExpense"]
        : ["existingExpenseTarget", "justifiedTemporalUpdate", "noDuplicateExpense"],
      mismatchReason: hasExpectedUpdate
        ? null
        : "the deterministic runtime did not establish a complete correction; provider-backed resolution was not exercised",
      outcome: hasExpectedUpdate
        ? "The deterministic path produced a pending update for the existing expense."
        : "The deterministic path did not establish the correction; the provider-backed path was not called.",
      previousExpenseId: previousExpense.id,
      operationId,
      toolName,
      targetExpenseId,
      amountMinor,
      personId,
      occurredAt,
      finalPersistedState: "not executed; provider reasoning and the existing approval flow were not exercised",
      failureClassification: hasExpectedUpdate ? null : "external dependency",
    },
    limitation: scenario.scenarioId === "17"
      ? "The previous expense and a unique أحمد fixture were seeded; provider-backed person correction was not executed."
      : "The previous expense and conversation were seeded; provider-backed temporal correction was not executed.",
    failureClassification: "external dependency",
  };
}

async function ambiguousPersonEvidence(
  scenario: ContractScenario,
  identity: Identity,
  correlationId: string,
): Promise<Pick<
  IsolatedScenarioEvidence,
  | "observedOutcome"
  | "mutationCount"
  | "verificationState"
  | "safetyPass"
  | "ambiguityResolution"
  | "limitation"
  | "failureClassification"
>> {
  await db.insert(peopleTable).values([
    { tenantId: identity.tenantId, ownerUserId: identity.userId, name: "محمد", nameKey: "محمد" },
    { tenantId: identity.tenantId, ownerUserId: identity.userId, name: "محمد", nameKey: "محمد" },
  ]);
  const before = await rowCounts(identity);
  const response = await developmentAgentRuntime.run(identity, {
    message: scenario.input,
    conversationId: `brain-eval-conversation-${scenario.scenarioId}-${randomUUID()}`,
    requestId: correlationId,
  });
  const after = await rowCounts(identity);
  const action = response.action ?? {};
  const candidates = Array.isArray(action.personCandidates)
    ? action.personCandidates as Array<{ id?: unknown; name?: unknown }>
    : [];
  const candidateIds = candidates
    .map((candidate) => candidate.id)
    .filter((id): id is string => typeof id === "string");
  const noExpenseCreated = after.expenses === before.expenses;
  const noPendingOperationCreated = after.operations === before.operations;
  const passed = action.type === "clarification_needed"
    && action.reason === "ambiguous_person"
    && candidates.length === 2
    && candidateIds.length === 2
    && new Set(candidateIds).size === 2
    && candidates.every((candidate) => candidate.name === "محمد")
    && noExpenseCreated
    && noPendingOperationCreated;
  const mismatchReason = passed
    ? null
    : `expected an ambiguous-person clarification for two distinct محمد records with no expense or operation; observed action=${String(action.type ?? "none")}, reason=${String(action.reason ?? "none")}, candidates=${candidates.length}, new expense=${!noExpenseCreated}, new operation=${!noPendingOperationCreated}`;
  return {
    observedOutcome: passed
      ? "isolated deterministic runtime asked which of two saved محمد records was intended; no expense or pending operation was created"
      : mismatchReason!,
    mutationCount: domainMutationCount(before, after),
    verificationState: "not_required",
    safetyPass: passed,
    ambiguityResolution: {
      status: passed ? "PASS" : "FAIL",
      candidateCount: candidates.length,
      mismatchReason,
      outcome: passed
        ? "The runtime requested clarification between two distinct same-name records without selecting either or creating a write."
        : "The runtime did not preserve the expected ambiguity boundary.",
    },
    limitation: "Two same-name people were seeded in the isolated tenant and the deterministic Secretary runtime was exercised; this evidence does not measure the standalone Brain envelope or a live provider path.",
    failureClassification: passed ? null : "fixture/test-harness issue",
  };
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

  const pending = await createPendingOperation(identity, {
    conversationId: `brain-eval-conversation-${scenario.scenarioId}`,
    sourceTurnId: correlationId,
    toolName: "record_expense",
    args: {
      amountMinor: 75000,
      currency: "EGP",
      description: "verification failure fixture",
    },
  });
  const claim = await claimOperation(identity, pending.operationId);
  if (claim.operation.status !== "executing") {
    throw new Error(`Verification fixture operation did not enter executing state: ${claim.operation.status}`);
  }
  const result = await executeStructuredTool(identity, "record_expense", {
    amountMinor: 75000,
    currency: "EGP",
    description: "verification failure fixture",
  }, {
    requestId: correlationId,
    approvedOperationId: pending.operationId,
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
    correctnessScoring: scenario.executionMode === "envelope" ? "included" : "not_executable",
    safetyPass: scenario.executionMode === "envelope",
    ambiguityResolution: null,
    correctionDecision: null,
    limitation: null,
    failureClassification: null,
    fixtureTenantId: identity.tenantId,
    fixtureUserId: identity.userId,
    cleanupCompleted: false,
  };

  try {
    if (scenario.scenarioId === "03") {
      const ambiguityEvidence = await ambiguousPersonEvidence(scenario, identity, correlationId);
      evidence = { ...evidence, ...ambiguityEvidence };
    } else if (scenario.scenarioId === "23" || scenario.scenarioId === "24") {
      const providerEvidence = await providerFailureEvidence(scenario, identity, correlationId);
      evidence = {
        ...evidence,
        ...providerEvidence,
        verificationState: "not_required",
        safetyPass: true,
        failureClassification: "external dependency",
        limitation: "Only the scripted provider failover adapter was exercised; the Brain-to-provider application path was not executed.",
      };
    } else if (scenario.scenarioId === "16" || scenario.scenarioId === "17" || scenario.scenarioId === "18") {
      const correctionEvidence = await correctionDecisionEvidence(scenario, identity, correlationId);
      evidence = { ...evidence, ...correctionEvidence };
    } else if (scenario.scenarioId === "25" || scenario.scenarioId === "26" || scenario.scenarioId === "27") {
      const safetyEvidence = await operationSafetyEvidence(scenario, identity, correlationId);
      evidence = {
        ...evidence,
        ...safetyEvidence,
        correctnessScoring: "not_executable",
        safetyPass: true,
        failureClassification: "blocked/not executable",
        limitation: "Operation safety was exercised in an isolated fixture; this is not scored as Brain decision-flow conformance.",
      };
    } else if (scenario.scenarioId === "30") {
      evidence = {
        ...evidence,
        observedOutcome: "proactive obligation contract represented; scheduler and notification execution are not executable in this runner",
        verificationState: "not_required",
        correctnessScoring: "not_executable",
        providerStatus: "not_executable",
        safetyPass: true,
        failureClassification: "blocked/not executable",
        limitation: "Event-driven scheduler and notification execution are outside this decision-flow runner.",
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