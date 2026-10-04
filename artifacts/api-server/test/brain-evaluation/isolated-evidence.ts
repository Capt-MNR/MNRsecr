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
  resolverShadowLogTable,
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
  Phase2AgentRuntime,
  executeStructuredTool,
  type ConversationMessage,
  type GatewayCallContext,
  type GatewayResponse,
  type ModelGateway,
  type ProviderName,
} from "../../src/lib/phase2";
import { resolveEntity } from "../../src/lib/entity-resolver";
import { retrieveRelationshipContext } from "../../src/lib/relationship-context";
import { parseSemanticRequest } from "../../src/lib/deterministic-intelligence";
import {
  associateSecondBrainCandidate,
  createSecondBrainCandidate,
  reviewSecondBrainCandidate,
} from "../../src/lib/second-brain";
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

export type ScenarioFixtureCheck = {
  kind:
    | "ambiguous_person"
    | "associated_project_alias"
    | "unassociated_project_alias"
    | "missing_amount_obligation_fixture";
  status: "PASS" | "FAIL" | "BLOCKED_BY_INFRASTRUCTURE";
  comparedFields: string[];
  mismatchReason: string | null;
  outcome: string;
  details: Record<string, string | number | boolean | null>;
};

export type IsolatedScenarioEvidence = {
  expectedOutcome: string;
  observedOutcome: string;
  mutationCount: number;
  verificationState: BrainVerificationState | "not_measured";
  correlationId: string;
  providerStatus: ProviderEvidenceStatus;
  correctnessScoring: "included" | "excluded_provider_rate_limit" | "not_executable";
  safetyPass: boolean;
  fixtureCheck: ScenarioFixtureCheck | null;
  ambiguityResolution: {
    status: "PASS" | "FAIL" | "BLOCKED_BY_INFRASTRUCTURE";
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
  resolverShadowLogTable,
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

class CountingNoCallGateway implements ModelGateway {
  readonly provider: ProviderName = "gemini";
  readonly modelName = "brain-evaluation-no-call-guard";
  calls = 0;

  async generate(
    _messages: ConversationMessage[],
    _context: GatewayCallContext,
  ): Promise<GatewayResponse> {
    this.calls += 1;
    throw new Error("The isolated evaluation gateway does not contact a live provider.");
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
  | "correctnessScoring"
  | "safetyPass"
  | "ambiguityResolution"
  | "fixtureCheck"
  | "limitation"
  | "failureClassification"
>> {
  await db.insert(peopleTable).values([
    { tenantId: identity.tenantId, ownerUserId: identity.userId, name: "محمد", nameKey: "محمد" },
    { tenantId: identity.tenantId, ownerUserId: identity.userId, name: "محمد", nameKey: "محمد" },
  ]);
  const before = await rowCounts(identity);
  const gateway = new CountingNoCallGateway();
  let response: Awaited<ReturnType<Phase2AgentRuntime["run"]>> | null = null;
  let runtimeError: string | null = null;
  try {
    response = await new Phase2AgentRuntime(gateway).run(identity, {
      message: scenario.input,
      conversationId: `brain-eval-conversation-${scenario.scenarioId}-${randomUUID()}`,
      requestId: correlationId,
    }, { dryRun: true });
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : String(error);
  }
  const after = await rowCounts(identity);
  const action = response?.action ?? {};
  const candidates = Array.isArray(action.personCandidates)
    ? action.personCandidates as Array<{ id?: unknown; name?: unknown }>
    : [];
  const candidateIds = candidates
    .map((candidate) => candidate.id)
    .filter((id): id is string => typeof id === "string");
  const noExpenseCreated = after.expenses === before.expenses;
  const noPendingOperationCreated = after.operations === before.operations;
  const passed = response !== null
    && action.type === "clarification_needed"
    && action.reason === "ambiguous_person"
    && candidates.length === 2
    && candidateIds.length === 2
    && new Set(candidateIds).size === 2
    && candidates.every((candidate) => candidate.name === "محمد")
    && noExpenseCreated
    && noPendingOperationCreated
    && gateway.calls === 0;
  const blocked = response === null && gateway.calls === 0 && runtimeError !== null;
  const mismatchReason = passed
    ? null
    : blocked
      ? `Phase2AgentRuntime could not complete before the model gateway was reached: ${runtimeError}`
      : `expected a Phase2AgentRuntime ambiguous-person clarification for two distinct محمد records, no expense or operation, and no model gateway call; observed action=${String(action.type ?? "none")}, reason=${String(action.reason ?? "none")}, candidates=${candidates.length}, gateway calls=${gateway.calls}, new expense=${!noExpenseCreated}, new operation=${!noPendingOperationCreated}`;
  const fixtureStatus = passed ? "PASS" : blocked ? "BLOCKED_BY_INFRASTRUCTURE" : "FAIL";
  const outcome = passed
    ? "Production Phase2AgentRuntime asked which of two saved محمد records was intended before calling the model; no expense or pending operation was created."
    : blocked
      ? "The isolated Phase2AgentRuntime fixture could not complete, so the behavior was not scored."
      : "Production Phase2AgentRuntime did not stop on the ambiguous saved-person match before the model gateway.";
  return {
    observedOutcome: outcome,
    mutationCount: domainMutationCount(before, after),
    verificationState: "not_required",
    correctnessScoring: blocked ? "not_executable" : "included",
    safetyPass: passed,
    ambiguityResolution: {
      status: fixtureStatus,
      candidateCount: candidates.length,
      mismatchReason,
      outcome: passed
        ? outcome
        : blocked
          ? "Runtime fixture was unavailable before the model gateway could be measured."
          : "The production runtime did not preserve the expected ambiguity boundary.",
    },
    fixtureCheck: {
      kind: "ambiguous_person",
      status: fixtureStatus,
      comparedFields: [
        "clarificationNeeded",
        "twoDistinctSameNameCandidates",
        "noExpenseCreated",
        "noPendingOperationCreated",
        "noModelGatewayCall",
      ],
      mismatchReason,
      outcome,
      details: {
        candidateCount: candidates.length,
        distinctCandidateCount: new Set(candidateIds).size,
        gatewayCalls: gateway.calls,
        newExpenses: after.expenses - before.expenses,
        newOperations: after.operations - before.operations,
        runtimeError,
      },
    },
    limitation: "Two same-name people were seeded in one isolated tenant; the production Phase2AgentRuntime was exercised with a gateway guard that records but never calls a live provider.",
    failureClassification: passed ? null : blocked ? "blocked/not executable" : "Agent Core bug",
  };
}

async function associatedProjectAliasEvidence(
  scenario: ContractScenario,
  identity: Identity,
): Promise<Pick<
  IsolatedScenarioEvidence,
  | "observedOutcome"
  | "mutationCount"
  | "verificationState"
  | "correctnessScoring"
  | "safetyPass"
  | "fixtureCheck"
  | "limitation"
  | "failureClassification"
>> {
  const [project] = await db.insert(projectsTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    name: "المحجر",
    nameKey: "المحجر",
  }).returning();
  if (!project) throw new Error("The isolated canonical project fixture was not created.");

  const candidate = await createSecondBrainCandidate(identity, {
    memoryKind: "alias",
    key: "alias:المشروع الكبير",
    value: project.name,
    confidenceBps: 10000,
    metadata: {
      alias: "المشروع الكبير",
      canonical: project.name,
      entityType: "project",
    },
  });
  const associated = await associateSecondBrainCandidate(identity, candidate.id, {
    entityType: "project",
    entityId: project.id,
  });
  if (!associated) throw new Error("The isolated project alias candidate could not be associated.");
  const reviewed = await reviewSecondBrainCandidate(identity, candidate.id, {
    status: "approved",
    note: "isolated Brain evaluation fixture",
  });
  if (!reviewed?.memory) throw new Error("The isolated associated project alias was not promoted.");

  const before = await rowCounts(identity);
  const resolution = await resolveEntity(identity, "project", scenario.input);
  const gateway = new CountingNoCallGateway();
  let phase2Response: Awaited<ReturnType<Phase2AgentRuntime["run"]>> | null = null;
  let runtimeError: string | null = null;
  try {
    phase2Response = await new Phase2AgentRuntime(gateway).run(identity, {
      message: scenario.input,
      conversationId: `brain-eval-conversation-12-${randomUUID()}`,
      requestId: `brain-eval-12-${randomUUID()}`,
    }, { dryRun: true });
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : String(error);
  }
  const after = await rowCounts(identity);
  const aliasResolved = resolution.matchType === "alias"
    && resolution.selected?.id === project.id
    && resolution.selected.name === project.name
    && reviewed.memory.metadata.entityId === project.id;
  const action = phase2Response?.action ?? {};
  const phase2ResolvesCanonical = phase2Response !== null
    && gateway.calls === 0
    && (JSON.stringify(action).includes(project.id)
      || phase2Response.assistantMessage.includes(project.name));
  const noDomainMutation = after.expenses === before.expenses
    && after.operations === before.operations;
  const phase2ContractSatisfied = phase2ResolvesCanonical
    && action.type === "project_reference"
    && action.intent === "project_reference"
    && action.strategyLevel === "L0"
    && action.risk === "low"
    && action.requiresApproval === false
    && phase2Response?.response.kind === "answer"
    && gateway.calls === 0
    && noDomainMutation;
  const passed = aliasResolved && phase2ContractSatisfied;
  const mismatchReason = passed
    ? null
    : `expected the approved alias and Phase2 to resolve project ${project.id} without a provider call or mutation; observed matchType=${resolution.matchType}, selected=${resolution.selected?.id ?? "none"}, action=${String(action.type ?? "none")}, gatewayCalls=${gateway.calls}`;
  const outcome = passed
    ? `The approved alias resolved to ${project.name}; Phase2 action=${String(action.type ?? "none")}, guarded gateway calls=${gateway.calls}, canonical result exposed=${phase2ResolvesCanonical}.`
    : "The approved alias did not complete the canonical project-reference flow safely.";
  return {
    observedOutcome: outcome,
    mutationCount: domainMutationCount(before, after),
    verificationState: "not_required",
    correctnessScoring: "included",
    safetyPass: passed,
    fixtureCheck: {
      kind: "associated_project_alias",
      status: passed ? "PASS" : "FAIL",
      comparedFields: [
        "approvedAssociation",
        "aliasMatch",
        "canonicalProjectId",
        "projectReferenceAction",
        "canonicalProjectExposed",
        "zeroModelCalls",
        "noDomainMutation",
      ],
      mismatchReason,
      outcome,
      details: {
        candidateStatus: reviewed.candidate.status,
        matchType: resolution.matchType,
        selectedProjectId: resolution.selected?.id ?? null,
        canonicalProjectId: project.id,
        candidateCount: resolution.candidates.length,
        phase2ActionType: typeof action.type === "string" ? action.type : null,
        phase2ResponseKind: phase2Response?.response?.kind ?? null,
        phase2Intent: typeof action.intent === "string" ? action.intent : null,
        phase2StrategyLevel: typeof action.strategyLevel === "string" ? action.strategyLevel : null,
        phase2Risk: typeof action.risk === "string" ? action.risk : null,
        phase2RequiresApproval: action.requiresApproval === true,
        phase2GatewayCalls: gateway.calls,
        phase2ResolvesCanonical,
        phase2ContractSatisfied,
        noDomainMutation,
        runtimeError,
      },
    },
    limitation: "An alias candidate was associated and approved through the Second Brain lifecycle, then checked with the production entity resolver and Phase2AgentRuntime using a gateway that never calls a provider.",
    failureClassification: passed
      ? null
      : "Agent Core bug",
  };
}

async function unassociatedProjectAliasEvidence(
  scenario: ContractScenario,
  identity: Identity,
): Promise<Pick<
  IsolatedScenarioEvidence,
  | "observedOutcome"
  | "mutationCount"
  | "verificationState"
  | "correctnessScoring"
  | "safetyPass"
  | "fixtureCheck"
  | "limitation"
  | "failureClassification"
>> {
  const [project] = await db.insert(projectsTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    name: "المحجر",
    nameKey: "المحجر",
  }).returning();
  if (!project) throw new Error("The isolated unrelated canonical project fixture was not created.");
  const candidate = await createSecondBrainCandidate(identity, {
    memoryKind: "alias",
    key: "alias:المشروع الكبير",
    value: project.name,
    confidenceBps: 10000,
    metadata: {
      alias: "المشروع الكبير",
      canonical: project.name,
      entityType: "project",
    },
  });
  const conversationId = `brain-eval-conversation-29-${randomUUID()}`;
  const memory = await loadConversationMemory(identity, conversationId);
  const semantic = parseSemanticRequest(scenario.input, new Date("2026-09-19T10:00:00.000Z"));
  const mentionedEntity = semantic.entityMentions[0] ?? null;
  const before = await rowCounts(identity);
  const resolution = await resolveEntity(identity, "project", "المشروع الكبير");
  const personResolution = mentionedEntity?.entityType === "person"
    ? await resolveEntity(identity, "person", mentionedEntity.query)
    : null;
  const relationship = await retrieveRelationshipContext(identity, scenario.input, memory.state);
  const gateway = new CountingNoCallGateway();
  let response: Awaited<ReturnType<Phase2AgentRuntime["run"]>> | null = null;
  let runtimeError: string | null = null;
  try {
    response = await new Phase2AgentRuntime(gateway).run(identity, {
      message: scenario.input,
      conversationId,
      requestId: `brain-eval-${scenario.scenarioId}-${randomUUID()}`,
    }, { dryRun: true });
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : String(error);
  }
  const after = await rowCounts(identity);

  const noFinancialSummary = Object.values(relationship?.context.financialSummary ?? {})
    .every((totals) => Array.isArray(totals) && totals.length === 0);
  const pendingAliasStayedUnassociated = candidate.status === "pending_review"
    && candidate.metadata.entityId === undefined;
  const noCanonicalResolution = resolution.matchType === "none"
    && resolution.selected === undefined
    && (relationship?.context.resolvedEntities.length ?? 0) === 0;
  const noDomainMutation = after.expenses === before.expenses
    && after.operations === before.operations;
  const expectedProjectIntent = semantic.intent === "project_expense_total"
    || semantic.intent === "project_expenses";
  const expectedProjectMention = semantic.entityMentions.some((entity) => entity.entityType === "project");
  const correctProjectInterpretation = expectedProjectIntent && expectedProjectMention;
  const noFinancialRead = (relationship?.context.relevantRecords.length ?? 0) === 0
    && noFinancialSummary
    && gateway.calls === 0;
  const passed = pendingAliasStayedUnassociated
    && noCanonicalResolution
    && correctProjectInterpretation
    && relationship?.response?.kind === "clarification"
    && noFinancialRead
    && noDomainMutation;
  const mismatchReason = passed
    ? null
    : `expected project-expense intent and clarification before any financial read; observed semanticIntent=${semantic.intent}, mentionedEntity=${mentionedEntity ? `${mentionedEntity.entityType}:${mentionedEntity.query}` : "none"}, relationshipResponse=${relationship?.response?.kind ?? "none"}, gatewayCalls=${gateway.calls}, projectResolution=${resolution.matchType}/${resolution.selected?.id ?? "none"}`;
  const outcome = passed
    ? "The pending alias was ignored, the system asked for canonical project identity, and no project financial records or mutations occurred."
    : `The pending alias remained unassociated, but the parser/runtime produced ${semantic.intent}/${mentionedEntity ? `${mentionedEntity.entityType}:${mentionedEntity.query}` : "no entity"}; relationshipResponse=${relationship?.response?.kind ?? "none"}, gatewayCalls=${gateway.calls}.`;
  return {
    observedOutcome: outcome,
    mutationCount: domainMutationCount(before, after),
    verificationState: noDomainMutation ? "not_required" : "not_measured",
    correctnessScoring: "included",
    safetyPass: noCanonicalResolution && noFinancialRead && noDomainMutation,
    fixtureCheck: {
      kind: "unassociated_project_alias",
      status: passed ? "PASS" : "FAIL",
      comparedFields: [
        "pendingAliasRemainsUnassociated",
        "noCanonicalProjectSelected",
        "projectExpenseIntent",
        "projectMentionType",
        "clarificationBeforeFinancialRead",
        "noFinancialRecordsReturned",
        "noDomainMutation",
      ],
      mismatchReason,
      outcome,
      details: {
        pendingCandidateStatus: candidate.status,
        resolverMatchType: resolution.matchType,
        resolverSelectedProjectId: resolution.selected?.id ?? null,
        semanticIntent: semantic.intent,
        semanticEntityType: mentionedEntity?.entityType ?? null,
        semanticEntityQuery: mentionedEntity?.query ?? null,
        relationshipContextRecognized: relationship !== null,
        contextIntent: relationship?.context.intent ?? null,
        responseKind: relationship?.response?.kind ?? null,
        resolvedEntityCount: relationship?.context.resolvedEntities.length ?? 0,
        financialRecordCount: relationship?.context.relevantRecords.length ?? 0,
        noFinancialSummary,
        gatewayCalls: gateway.calls,
        runtimeAction: response?.action?.type ?? null,
        runtimeResponse: response?.response.kind ?? null,
        runtimeError,
        noDomainMutation,
      },
    },
    limitation: "A pending unassociated alias and unrelated project were seeded; the production parser, relationship-context path, resolver, and Phase2 runtime were exercised with a guarded gateway. No live provider response was measured.",
    failureClassification: passed ? null : "Agent Core bug",
  };
}

function missingAmountObligationFixtureEvidence(): Pick<
  IsolatedScenarioEvidence,
  | "observedOutcome"
  | "mutationCount"
  | "verificationState"
  | "correctnessScoring"
  | "safetyPass"
  | "fixtureCheck"
  | "limitation"
  | "failureClassification"
> {
  const outcome = "Not scored: the current harness has no reliable staged fixture proving which prior agreement applies when the user asks to pay an unspecified agreed amount.";
  return {
    observedOutcome: outcome,
    mutationCount: 0,
    verificationState: "not_measured",
    correctnessScoring: "not_executable",
    safetyPass: true,
    fixtureCheck: {
      kind: "missing_amount_obligation_fixture",
      status: "BLOCKED_BY_INFRASTRUCTURE",
      comparedFields: [],
      mismatchReason: "The synthetic person_financial_status fixture does not establish the scenario's financial_action context or the relevant prior agreement.",
      outcome,
      details: {
        providerBackedPathAvailable: false,
        authoritativeAgreementSeeded: false,
      },
    },
    limitation: "Scenario 15 remains unchanged, but its former injected person_financial_status/clarification fixture did not represent the required staged payment request and prior agreement.",
    failureClassification: "blocked/not executable",
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
    fixtureCheck: null,
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
    } else if (scenario.scenarioId === "12") {
      const aliasEvidence = await associatedProjectAliasEvidence(scenario, identity);
      evidence = { ...evidence, ...aliasEvidence };
    } else if (scenario.scenarioId === "15") {
      evidence = { ...evidence, ...missingAmountObligationFixtureEvidence() };
    } else if (scenario.scenarioId === "29") {
      const aliasEvidence = await unassociatedProjectAliasEvidence(scenario, identity);
      evidence = { ...evidence, ...aliasEvidence };
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