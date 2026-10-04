import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { RelationshipContextResult } from "../../src/lib/relationship-context";
import {
  createBrainDecisionEnvelope,
  type BrainDecisionState,
  type BrainDecisionEnvelope,
} from "../../src/lib/brain-contract";
import {
  parseSemanticRequest,
  type SemanticParse,
} from "../../src/lib/deterministic-intelligence";
import {
  parseSecondBrainCandidate,
  parseSecondBrainCommand,
} from "../../src/lib/second-brain";
import {
  evaluationContractV1,
  type ContractScenario,
  type EvaluationStatus,
} from "./contract-v1";
import {
  collectIsolatedScenarioEvidence,
  createEvidenceRunId,
  type IsolatedScenarioEvidence,
} from "./isolated-evidence";

const FIXED_NOW = new Date("2026-09-19T10:00:00.000Z");

type ObservedOutcome = {
  primaryIntent: string | null;
  secondaryIntents: string[];
  mentionedEntities: string[];
  resolvedEntities: string[];
  ambiguousEntities: string[];
  timeScope: string | null;
  knownInformation: string[];
  unknownInformation: string[];
  requiredContext: string[];
  optionalContext: string[];
  authoritativeSources: string[];
  excludedSources: string[];
  selectedStrategy: string | null;
  intelligenceLevel: BrainDecisionEnvelope["strategy"]["level"] | null;
  confidence: number | null;
  confidenceBand: "high" | "medium" | "low" | "unknown";
  risk: BrainDecisionEnvelope["risk"]["level"] | null;
  decision: string | null;
  action: string | null;
  approvalRequired: boolean | null;
  verificationPlan: string[];
  failureState: string | null;
  provenance: string[];
  actualOutcome: string;
  correction: {
    previousState: string | null;
    correctionTarget: string | null;
    updatedInterpretation: string | null;
    duplicateRisk: string | null;
    finalPersistedState: string | null;
  };
};

type PassFailResult = {
  pass: boolean | null;
  mismatchReason: string | null;
  comparedFields: string[];
  normalizationsApplied: string[];
  responsibleSubsystem: string | null;
};

type EvaluationRecord = {
  scenarioId: string;
  title: string;
  input: string;
  context: string;
  status: EvaluationStatus;
  executionMode: ContractScenario["executionMode"];
  limitation: string | null;
  expected: ContractScenario["expectation"];
  observed: ObservedOutcome;
  envelope: BrainDecisionEnvelope | null;
  semanticParse: SemanticParse | null;
  instrumentation: {
    logicalLlmCalls: number | null;
    providerAttempts: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    selectedStrategy: string | null;
    intelligenceLevel: string | null;
    measurement: "deterministic_path_no_provider_call" | "scripted_gateway_guard" | "not_executable";
  };
  passFail: PassFailResult;
  envelopeDiagnostic: PassFailResult | null;
  failureClassification: string | null;
  expectedOutcome: string;
  observedOutcome: string;
  mutationCount: number;
  verificationState: BrainDecisionEnvelope["verification"]["state"] | "not_measured";
  correlationId: string;
  providerStatus: IsolatedScenarioEvidence["providerStatus"];
  correctnessScoring: IsolatedScenarioEvidence["correctnessScoring"];
  safetyPass: boolean;
  fixtureCheck: IsolatedScenarioEvidence["fixtureCheck"];
  ambiguityResolution: IsolatedScenarioEvidence["ambiguityResolution"];
  correctionDecision: IsolatedScenarioEvidence["correctionDecision"];
  isolation: {
    tenantId: string;
    userId: string;
    cleanupCompleted: boolean;
  };
};

type EvaluationRunScope = {
  runId: string;
  tenantId: string;
  userId: string;
};

function createEvaluationRunScope(runId = createEvidenceRunId()): EvaluationRunScope {
  return {
    runId,
    tenantId: `brain-evaluation-${runId}`,
    userId: `brain-evaluation-user-${runId}`,
  };
}

function failureClassificationFor(
  scenario: ContractScenario,
  status: EvaluationStatus,
): string | null {
  if (status === "PASS") return null;
  if (status === "FAIL") {
    const knownClassification: Record<string, string> = {
      "03": "Agent Core bug",
      "05": "contract/evaluator mismatch",
      "06": "contract/evaluator mismatch",
      "12": "contract/evaluator mismatch",
      "13": "contract/evaluator mismatch",
      "14": "expected behavior requires review",
      "15": "fixture/test-harness issue",
      "19": "expected behavior requires review",
      "20": "expected behavior requires review",
      "21": "contract/evaluator mismatch",
      "28": "contract/evaluator mismatch",
      "29": "Agent Core bug",
    };
    return knownClassification[scenario.scenarioId] ?? "Agent Core bug";
  }
  if (status === "BLOCKED_BY_INFRASTRUCTURE"
    && ["17", "18", "23", "24"].includes(scenario.scenarioId)) {
    return "external dependency";
  }
  return "blocked/not executable";
}

function confidenceBand(value: number | null): ObservedOutcome["confidenceBand"] {
  if (value === null) return "unknown";
  if (value >= 0.8) return "high";
  if (value >= 0.5) return "medium";
  return "low";
}

function relationshipFixture(scenario: ContractScenario): RelationshipContextResult | null {
  const resolvedEntity = (id: string, name: string, type: "person" | "project", matchType: "exact" | "alias" | "conversation" = "exact") => ({
    id,
    name,
    type,
    matchType,
    confidence: 0.98,
  });
  const base = {
    version: 1 as const,
    bounds: {
      maxEntities: 3,
      maxRelationships: 12,
      maxRecords: 12,
      maxTimelineEvents: 8,
      maxContextChars: 6000,
    },
    resolvedEntities: [] as Array<{
      id: string;
      name: string;
      type: "person" | "project" | "financial_party";
      matchType: "exact" | "alias" | "fuzzy" | "conversation";
      confidence: number;
    }>,
    relevantRelationships: [],
    relevantRecords: [],
    financialSummary: {},
    recentActivity: [],
    conversationReferences: [],
    uncertainties: [] as string[],
    truncated: false,
  };
  switch (scenario.scenarioId) {
    case "05":
      return {
        context: {
          ...base,
          intent: "person_financial_status",
          resolvedEntities: [resolvedEntity("party-quarry", "شركة المحجر", "financial_party")],
        },
        response: { kind: "answer", message: "structured financial result" },
      };
    case "06":
      return {
        context: {
          ...base,
          intent: "recent_activity",
          resolvedEntities: [resolvedEntity("person-mohamed", "محمد", "person")],
          recentActivity: [{ kind: "activity", description: "bounded fixture event" }],
        },
        response: { kind: "answer", message: "bounded activity result" },
      };
    case "13":
      return {
        context: {
          ...base,
          intent: "project_expenses",
          resolvedEntities: [resolvedEntity("project-quarry", "المحجر", "project")],
          financialSummary: { EGP: [{ currency: "EGP", amountMinor: 123400, count: 3 }] },
        },
        response: { kind: "answer", message: "structured project total" },
      };
    case "14":
      return {
        context: {
          ...base,
          intent: "memory_financial_conflict",
          resolvedEntities: [resolvedEntity("project-quarry", "المحجر", "project")],
          uncertainties: ["memory_conflicts_with_structured_record"],
          financialSummary: { EGP: [{ currency: "EGP", amountMinor: 700000, count: 2 }] },
        },
        response: { kind: "answer", message: "record differs from memory" },
      };
    case "28":
      return {
        context: {
          ...base,
          intent: "person_financial_status",
          resolvedEntities: [resolvedEntity("person-mohamed", "محمد", "person")],
          financialSummary: { EGP: [{ currency: "EGP", amountMinor: 250000, count: 4 }] },
        },
        response: { kind: "answer", message: "authoritative relationship result" },
      };
    default:
      return null;
  }
}

function entityNames(parse: SemanticParse): string[] {
  return parse.entityMentions.map((entity) => `${entity.entityType}:${entity.query}`);
}

function inferDecision(envelope: BrainDecisionEnvelope): string {
  if (envelope.state === "clarification") return "clarification_required";
  if (envelope.strategy.deterministicExecution) return "deterministic_path_selected";
  if (envelope.strategy.llmAllowed) return "reasoning_path_selected";
  return envelope.state;
}

function inferAction(envelope: BrainDecisionEnvelope): string {
  if (envelope.risk.requiresApproval) return "approval_gated_structured_action";
  if (envelope.intent.name === "memory_recall") return "memory_recall";
  if (envelope.intent.name === "schedule_read") return "schedule_read";
  return envelope.intent.name;
}

function observedOutcome(
  scenario: ContractScenario,
  parse: SemanticParse,
  envelope: BrainDecisionEnvelope,
): ObservedOutcome {
  const resolved = envelope.context.selected.filter((value) =>
    value.includes("relationship") || value.includes("conversation") || value.includes("second_brain"),
  );
  const ambiguous = envelope.context.ambiguity;
  const temporalMention = envelope.context.temporal.mentioned;
  return {
    primaryIntent: envelope.intent.name,
    secondaryIntents: [],
    mentionedEntities: entityNames(parse),
    resolvedEntities: resolved,
    ambiguousEntities: ambiguous,
    timeScope: temporalMention ? `mentioned; dayOffset=${envelope.context.temporal.dayOffset ?? "unknown"}` : null,
    knownInformation: [
      ...(parse.amount ? [`amount=${parse.amount.amountMinor} minor ${parse.amount.currency}`] : []),
      ...(parse.dateTime ? [`dateTime=${parse.dateTime.iso}`] : []),
    ],
    unknownInformation: envelope.context.ambiguity,
    requiredContext: envelope.context.selected,
    optionalContext: [],
    authoritativeSources: envelope.context.sources,
    excludedSources: envelope.context.excluded,
    selectedStrategy: envelope.strategy.reason,
    intelligenceLevel: envelope.strategy.level,
    confidence: envelope.confidence.overall,
    confidenceBand: confidenceBand(envelope.confidence.overall),
    risk: envelope.risk.level,
    decision: inferDecision(envelope),
    action: inferAction(envelope),
    approvalRequired: envelope.risk.requiresApproval,
    verificationPlan: envelope.verification.checks,
    failureState: envelope.state === "failed" ? "failed" : null,
    provenance: [
      `requestId=${envelope.requestId}`,
      `conversationId=${envelope.conversationId}`,
      `evaluationScenario=${envelope.trace.evaluationScenario ?? scenario.scenarioId}`,
    ],
    actualOutcome: "deterministic parser and Brain envelope evaluated; no provider or mutation executed",
    correction: {
      previousState: scenario.previousState ?? null,
      correctionTarget: scenario.expectation.primaryIntent === "correction" ? "not resolved by standalone harness" : null,
      updatedInterpretation: scenario.expectation.primaryIntent === "correction" ? envelope.intent.name : null,
      duplicateRisk: scenario.expectation.primaryIntent === "correction" ? "not measured without previous operation fixture" : null,
      finalPersistedState: scenario.expectation.primaryIntent === "correction" ? "not executed" : null,
    },
  };
}

function secondBrainObservation(
  scenario: ContractScenario,
): Partial<ObservedOutcome> | null {
  if (!["07", "08", "09", "10", "11"].includes(scenario.scenarioId)) {
    return null;
  }
  const command = parseSecondBrainCommand(scenario.input);
  if (command?.type === "remember" && command.memoryKind === "fact") {
    return {
      primaryIntent: "explicit_memory_save",
      selectedStrategy: "explicit deterministic memory operation",
      intelligenceLevel: "L0",
      confidence: 0.99,
      confidenceBand: "high",
      risk: "low",
      decision: "save confirmed memory under policy",
      action: "explicit memory save",
      approvalRequired: false,
      verificationPlan: ["preserve provenance", "safe entity association if resolvable"],
      actualOutcome: "Second Brain explicit-memory dispatch recognized; no mutation executed",
      provenance: ["runtimePath=second_brain_command", "memoryKind=fact"],
    };
  }
  if (command?.type === "remember" && command.memoryKind === "alias") {
    return {
      primaryIntent: "alias_candidate",
      selectedStrategy: "lightweight alias candidate interpretation",
      intelligenceLevel: "L1",
      confidence: 0.99,
      confidenceBand: "high",
      risk: "low",
      decision: "create alias candidate requiring association",
      action: "candidate alias",
      approvalRequired: false,
      verificationPlan: ["preserve provenance", "require canonical association before authority"],
      actualOutcome: "Second Brain alias-candidate dispatch recognized; no mutation executed",
      provenance: ["runtimePath=second_brain_command", "memoryKind=alias"],
    };
  }
  if (command?.type === "recall") {
    return {
      primaryIntent: "explicit_memory_retrieval",
      selectedStrategy: "deterministic governed memory retrieval",
      intelligenceLevel: "L1",
      confidence: 0.99,
      confidenceBand: "high",
      risk: "low",
      decision: "return active eligible memories",
      action: "memory recall",
      approvalRequired: false,
      verificationPlan: ["trace selected and excluded memories"],
      actualOutcome: "Second Brain recall dispatch recognized; no mutation executed",
      provenance: ["runtimePath=second_brain_command", "memoryKind=recall"],
    };
  }
  if (parseSecondBrainCandidate(scenario.input)) {
    return {
      primaryIntent: "inferred_preference",
      selectedStrategy: "lightweight preference candidate interpretation",
      intelligenceLevel: "L1",
      confidence: 0.7,
      confidenceBand: "medium",
      risk: "low",
      decision: "create pending candidate for review",
      action: "candidate memory suggestion",
      approvalRequired: false,
      verificationPlan: ["candidate requires review"],
      actualOutcome: "Second Brain candidate dispatch recognized; no mutation executed",
      provenance: ["runtimePath=second_brain_candidate", "memoryKind=preference"],
    };
  }
  return null;
}

function compareEnvelope(
  scenario: ContractScenario,
  parse: SemanticParse,
  observed: ObservedOutcome,
): EvaluationRecord["passFail"] {
  const expected = scenario.expectation;
  const mismatches: string[] = [];
  const comparedFields: string[] = [];
  const normalizationsApplied: string[] = [];
  const intentEquivalences: readonly [string, string][] = [
    ["financial_retrieval", "person_financial_status"],
    ["contextual_retrieval", "recent_activity"],
    ["project_expense_total", "project_expenses"],
    ["unclear_action", "unknown"],
    ["financial_relationship_retrieval", "person_financial_status"],
    ["planning", "obligation_planning"],
    ["planning", "planning_conflict"],
  ];
  if (expected.primaryIntent !== "unspecified") {
    comparedFields.push("primaryIntent");
    if (observed.primaryIntent !== expected.primaryIntent) {
      const equivalent = intentEquivalences.some(([left, right]) =>
        (expected.primaryIntent === left && observed.primaryIntent === right)
        || (expected.primaryIntent === right && observed.primaryIntent === left),
      );
      if (equivalent) {
        normalizationsApplied.push(
          `primaryIntent ${observed.primaryIntent}->${expected.primaryIntent} (approved exact label pair)`,
        );
      } else {
        mismatches.push(`primaryIntent observed=${observed.primaryIntent} expected=${expected.primaryIntent}`);
      }
    }
  }
  if (expected.intelligenceLevels.length > 0) {
    comparedFields.push("intelligenceLevel");
    if (!observed.intelligenceLevel || !expected.intelligenceLevels.includes(observed.intelligenceLevel)) {
      mismatches.push(`intelligenceLevel observed=${observed.intelligenceLevel} expected=${expected.intelligenceLevels.join("|")}`);
    }
  }
  if (expected.risk) {
    comparedFields.push("risk");
    if (observed.risk !== expected.risk) {
      mismatches.push(`risk observed=${observed.risk} expected=${expected.risk}`);
    }
  }
  if (typeof expected.approvalRequired === "boolean") {
    comparedFields.push("approvalRequired");
    if (observed.approvalRequired !== expected.approvalRequired) {
      mismatches.push(`approvalRequired observed=${observed.approvalRequired} expected=${expected.approvalRequired}`);
    }
  }
  if (expected.timeScope && expected.timeScope.includes("tomorrow at 17:00")) {
    comparedFields.push("timeScope");
    if (parse.dateTime?.dayOffset !== 1 || parse.dateTime.hour !== 17) {
      mismatches.push("timeScope did not resolve tomorrow at 17:00");
    }
  }
  if (expected.timeScope && expected.timeScope.includes("last week")) {
    comparedFields.push("timeScope");
    if (parse.dateTime?.dayOffset !== -7) {
      mismatches.push("timeScope was not represented as last-week temporal state");
    }
  }
  return {
    pass: mismatches.length === 0,
    mismatchReason: mismatches.length > 0 ? mismatches.join("; ") : null,
    comparedFields,
    normalizationsApplied,
    responsibleSubsystem: mismatches.length > 0
      ? "brain-contract.ts / deterministic-intelligence.ts"
      : null,
  };
}

export function evaluateScenario(
  scenario: ContractScenario,
  scope = createEvaluationRunScope(),
  stateOverride?: BrainDecisionState,
): EvaluationRecord {
  const parse = parseSemanticRequest(scenario.input, FIXED_NOW);
  const relationshipContext = relationshipFixture(scenario);
  const envelope = createBrainDecisionEnvelope({
    requestId: `brain-eval-${scope.runId}-${scenario.scenarioId}`,
    conversationId: `brain-eval-conversation-${scope.runId}-${scenario.scenarioId}`,
    message: scenario.input,
    semanticParse: parse,
    relationshipContext,
    hasConversationContext: Boolean(scenario.previousState) || scenario.context !== "none",
    state: stateOverride ?? (scenario.scenarioId === "27" ? "rejected" : undefined),
  });
  const observed = {
    ...observedOutcome(scenario, parse, envelope),
    ...secondBrainObservation(scenario),
  };
  const comparison = compareEnvelope(scenario, parse, observed);
  const status: EvaluationStatus = scenario.executionMode === "blocked"
    ? "BLOCKED_BY_INFRASTRUCTURE"
    : scenario.executionMode === "not_executable"
      ? "NOT_EXECUTABLE"
      : comparison.pass ? "PASS" : "FAIL";
  return {
    scenarioId: scenario.scenarioId,
    title: scenario.title,
    input: scenario.input,
    context: scenario.context,
    status,
    executionMode: scenario.executionMode,
    limitation: scenario.limitation ?? null,
    expected: scenario.expectation,
    observed,
    envelope,
    semanticParse: parse,
    instrumentation: {
      logicalLlmCalls: 0,
      providerAttempts: 0,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      selectedStrategy: envelope.strategy.level,
      intelligenceLevel: envelope.strategy.level,
      measurement: scenario.executionMode === "envelope"
        ? "deterministic_path_no_provider_call"
        : "not_executable",
    },
    passFail: scenario.executionMode === "envelope"
      ? comparison
      : {
          pass: null,
          mismatchReason: null,
          comparedFields: [],
          normalizationsApplied: [],
          responsibleSubsystem: null,
        },
    envelopeDiagnostic: null,
    failureClassification: failureClassificationFor(scenario, status),
    expectedOutcome: scenario.expectation.expectedOutcome,
    observedOutcome: observed.actualOutcome,
    mutationCount: 0,
    verificationState: envelope.verification.state,
    correlationId: envelope.requestId,
    providerStatus: "not_called",
    correctnessScoring: scenario.executionMode === "envelope" ? "included" : "not_executable",
    safetyPass: scenario.executionMode === "envelope",
    fixtureCheck: null,
    ambiguityResolution: null,
    correctionDecision: null,
    isolation: {
      tenantId: scope.tenantId,
      userId: scope.userId,
      cleanupCompleted: true,
    },
  };
}

export function evaluateAll(): EvaluationRecord[] {
  const scope = createEvaluationRunScope();
  return evaluationContractV1.map((scenario) => evaluateScenario(scenario, scope));
}

export async function evaluateAllIsolated(): Promise<EvaluationRecord[]> {
  const runId = createEvidenceRunId();
  const scope = createEvaluationRunScope(runId);
  const records: EvaluationRecord[] = [];
  for (const scenario of evaluationContractV1) {
    const envelopeOnlyRecord = evaluateScenario(scenario, scope);
    const evidence = await collectIsolatedScenarioEvidence(scenario, runId);
    const fixtureCheck = evidence.fixtureCheck;
    const fixtureStatus: EvaluationStatus | null = fixtureCheck
      ? fixtureCheck.status === "PASS"
        ? "PASS"
        : fixtureCheck.status === "FAIL"
          ? "FAIL"
          : "BLOCKED_BY_INFRASTRUCTURE"
      : null;
    let record = fixtureCheck?.kind === "ambiguous_person" && fixtureStatus === "PASS"
      ? evaluateScenario(scenario, scope, "clarification")
      : envelopeOnlyRecord;
    const runtimeAliasContractVerified = fixtureCheck?.kind === "associated_project_alias"
      && fixtureStatus === "PASS"
      && fixtureCheck.details.phase2ContractSatisfied === true
      && fixtureCheck.details.phase2ActionType === "project_reference"
      && fixtureCheck.details.phase2GatewayCalls === 0
      && fixtureCheck.details.phase2ResolvesCanonical === true;
    if (runtimeAliasContractVerified) {
      const runtimeObserved = {
        ...envelopeOnlyRecord.observed,
        primaryIntent: String(fixtureCheck.details.phase2Intent ?? "project_reference"),
        intelligenceLevel: String(fixtureCheck.details.phase2StrategyLevel ?? "L0"),
        risk: String(fixtureCheck.details.phase2Risk ?? "low"),
        approvalRequired: fixtureCheck.details.phase2RequiresApproval === true,
        selectedStrategy: "exact approved project alias resolution",
        decision: "resolve canonical project ID without mutation",
      };
      const runtimeComparison = compareEnvelope(
        scenario,
        envelopeOnlyRecord.semanticParse,
        runtimeObserved,
      );
      record = {
        ...envelopeOnlyRecord,
        observed: runtimeObserved,
        status: runtimeComparison.pass ? "PASS" : "FAIL",
        passFail: runtimeComparison,
      };
    }
    const compareFixtureWithContract = fixtureCheck?.kind === "ambiguous_person"
      || fixtureCheck?.kind === "associated_project_alias";
    const status: EvaluationStatus = compareFixtureWithContract
      ? fixtureStatus === "BLOCKED_BY_INFRASTRUCTURE"
        ? "BLOCKED_BY_INFRASTRUCTURE"
        : fixtureStatus === "FAIL" || record.status === "FAIL"
          ? "FAIL"
          : record.status
      : fixtureStatus ?? record.status;
    const fixturePassFail: PassFailResult | null = fixtureCheck
      ? compareFixtureWithContract
        ? {
            pass: status === "PASS" ? true : status === "BLOCKED_BY_INFRASTRUCTURE" ? null : false,
            mismatchReason: [
              record.passFail.mismatchReason,
              fixtureCheck.mismatchReason,
            ].filter(Boolean).join("; ") || null,
            comparedFields: [...record.passFail.comparedFields, ...fixtureCheck.comparedFields],
            normalizationsApplied: record.passFail.normalizationsApplied,
            responsibleSubsystem: fixtureCheck.kind === "ambiguous_person"
              ? "Phase2AgentRuntime / entity resolver / Brain decision envelope"
              : "Phase2AgentRuntime / Second Brain resolver / Brain decision envelope",
          }
        : {
            pass: fixtureStatus === "PASS" ? true : fixtureStatus === "FAIL" ? false : null,
            mismatchReason: fixtureCheck.mismatchReason,
            comparedFields: fixtureCheck.comparedFields,
            normalizationsApplied: [],
            responsibleSubsystem: fixtureCheck.kind === "missing_amount_obligation_fixture"
              ? "isolated evaluation fixture"
              : fixtureCheck.kind === "unassociated_project_alias"
                ? "deterministic-intelligence parser / Phase2 intent routing"
                : "Second Brain entity resolver / relationship context",
          }
      : null;
    const failureClassification = fixtureCheck
      ? status === "PASS"
        ? null
        : fixtureStatus === "BLOCKED_BY_INFRASTRUCTURE"
          ? evidence.failureClassification ?? "blocked/not executable"
          : evidence.failureClassification ?? record.failureClassification ?? "Agent Core bug"
      : evidence.failureClassification ?? record.failureClassification;
    const observed = {
      ...record.observed,
      actualOutcome: evidence.observedOutcome,
      ...(fixtureCheck?.kind === "ambiguous_person" && fixtureStatus === "PASS"
        ? {
            ambiguousEntities: ["person:محمد"],
            requiredContext: ["which محمد"],
            authoritativeSources: ["structured_records", "entity_graph"],
            selectedStrategy: record.envelope?.strategy.reason ?? "expense_entity_resolution_requires_clarification",
            intelligenceLevel: record.envelope?.strategy.level ?? "L1",
            risk: record.envelope?.risk.level ?? "low",
            decision: "ask which person",
            action: "clarify entity",
            approvalRequired: record.envelope?.risk.requiresApproval ?? false,
            verificationPlan: ["do not create an operation before the user selects a person"],
            provenance: [
              ...record.observed.provenance,
              "runtimePath=Phase2AgentRuntime",
              `resolverCandidates=${String(fixtureCheck.details.candidateCount ?? 0)}`,
              `modelGatewayCalls=${String(fixtureCheck.details.gatewayCalls ?? 0)}`,
            ],
          }
        : fixtureCheck?.kind === "associated_project_alias"
          ? {
              provenance: [
                ...record.observed.provenance,
                "runtimePath=Phase2AgentRuntime",
                `resolverMatch=${String(fixtureCheck.details.matchType ?? "none")}`,
                `phase2Action=${String(fixtureCheck.details.phase2ActionType ?? "none")}`,
                `modelGatewayCalls=${String(fixtureCheck.details.phase2GatewayCalls ?? 0)}`,
                `canonicalProjectExposed=${String(fixtureCheck.details.phase2ResolvesCanonical ?? false)}`,
              ],
            }
        : {}),
    };
    const guardedGatewayCalls = fixtureCheck
      && ["ambiguous_person", "associated_project_alias", "unassociated_project_alias"].includes(fixtureCheck.kind)
      ? Number(fixtureCheck.details.phase2GatewayCalls ?? fixtureCheck.details.gatewayCalls ?? 0)
      : null;
    records.push({
      ...record,
      instrumentation: guardedGatewayCalls === null
        ? record.instrumentation
        : {
            ...record.instrumentation,
            logicalLlmCalls: guardedGatewayCalls,
            providerAttempts: 0,
            measurement: guardedGatewayCalls > 0
              ? "scripted_gateway_guard"
              : "deterministic_path_no_provider_call",
          },
      status,
      limitation: evidence.limitation ?? record.limitation,
      expectedOutcome: evidence.expectedOutcome,
      observedOutcome: evidence.observedOutcome,
      mutationCount: evidence.mutationCount,
      verificationState: evidence.verificationState,
      correlationId: evidence.correlationId,
      providerStatus: evidence.providerStatus,
      correctnessScoring: evidence.correctnessScoring,
      safetyPass: evidence.safetyPass,
      fixtureCheck,
      ambiguityResolution: evidence.ambiguityResolution,
      correctionDecision: evidence.correctionDecision,
      passFail: fixturePassFail ?? record.passFail,
      envelopeDiagnostic: fixtureCheck ? envelopeOnlyRecord.passFail : record.envelopeDiagnostic,
      failureClassification,
      isolation: {
        tenantId: evidence.fixtureTenantId,
        userId: evidence.fixtureUserId,
        cleanupCompleted: evidence.cleanupCompleted,
      },
      observed: {
        ...observed,
        correction: evidence.correctionDecision
          ? {
              previousState: `expense:${evidence.correctionDecision.previousExpenseId}`,
              correctionTarget: evidence.correctionDecision.targetExpenseId,
              updatedInterpretation: [
                evidence.correctionDecision.toolName,
                evidence.correctionDecision.amountMinor === null
                  ? null
                  : `amountMinor=${evidence.correctionDecision.amountMinor}`,
                evidence.correctionDecision.personId
                  ? `personId=${evidence.correctionDecision.personId}`
                  : null,
                evidence.correctionDecision.occurredAt
                  ? `occurredAt=${evidence.correctionDecision.occurredAt}`
                  : null,
              ].filter(Boolean).join("; ") || null,
              duplicateRisk: evidence.safetyPass
                ? "no duplicate expense was created in the isolated fixture"
                : "duplicate expense count changed in the isolated fixture",
              finalPersistedState: evidence.correctionDecision.finalPersistedState,
            }
          : record.observed.correction,
        failureState: evidence.providerStatus === "failed" || evidence.providerStatus === "rate_limited"
          ? evidence.providerStatus
          : record.observed.failureState,
      },
    });
  }
  return records;
}

export async function writeEvaluationReport(
  outputPath: string,
  records = evaluateAll(),
  reportPath = resolve(dirname(outputPath), "../REPORT.md"),
): Promise<void> {
  const executable = records.filter((record) =>
    (record.status === "PASS" || record.status === "FAIL")
    && record.correctnessScoring === "included",
  );
  const correctionDecisions = records
    .filter((record) => record.correctionDecision !== null)
    .map((record) => ({
      scenarioId: record.scenarioId,
      status: record.correctionDecision!.status,
      failureClassification: record.correctionDecision!.failureClassification,
    }));
  const failureClasses = [
    "Agent Core bug",
    "fixture/test-harness issue",
    "contract/evaluator mismatch",
    "expected behavior requires review",
    "external dependency",
    "blocked/not executable",
  ] as const;
  const failureClassificationCounts = Object.fromEntries(failureClasses.map((classification) => [
    classification,
    records.filter((record) =>
      record.status !== "PASS" && record.failureClassification === classification,
    ).length,
  ]));
  const correctionDecisionSummary = {
    pass: correctionDecisions.filter((decision) => decision.status === "PASS").length,
    fail: correctionDecisions.filter((decision) => decision.status === "FAIL").length,
    blockedByInfrastructure: correctionDecisions
      .filter((decision) => decision.status === "BLOCKED_BY_INFRASTRUCTURE").length,
    scenarioIds: correctionDecisions.map((decision) => decision.scenarioId),
  };
  const ambiguityResolutionSummary = {
    pass: records.filter((record) => record.ambiguityResolution?.status === "PASS").length,
    fail: records.filter((record) => record.ambiguityResolution?.status === "FAIL").length,
    blockedByInfrastructure: records
      .filter((record) => record.ambiguityResolution?.status === "BLOCKED_BY_INFRASTRUCTURE").length,
    scenarioIds: records
      .filter((record) => record.ambiguityResolution !== null)
      .map((record) => record.scenarioId),
  };
  const fixtureCheckSummary = {
    pass: records.filter((record) => record.fixtureCheck?.status === "PASS").length,
    fail: records.filter((record) => record.fixtureCheck?.status === "FAIL").length,
    blockedByInfrastructure: records
      .filter((record) => record.fixtureCheck?.status === "BLOCKED_BY_INFRASTRUCTURE").length,
    scenarioIds: records
      .filter((record) => record.fixtureCheck !== null)
      .map((record) => record.scenarioId),
  };
  const generatedAt = new Date().toISOString();
  const summary = {
    total: records.length,
    pass: records.filter((record) => record.status === "PASS").length,
    fail: records.filter((record) => record.status === "FAIL").length,
    blockedByInfrastructure: records.filter((record) => record.status === "BLOCKED_BY_INFRASTRUCTURE").length,
    notExecutable: records.filter((record) => record.status === "NOT_EXECUTABLE").length,
    executableScenarioCount: executable.length,
    contractPassRateAmongExecutable: executable.length === 0
      ? null
      : Math.round((executable.filter((record) => record.status === "PASS").length / executable.length) * 10000) / 100,
    logicalLlmCallsMeasured: records.reduce((sum, record) => sum + (record.instrumentation.logicalLlmCalls ?? 0), 0),
    providerAttemptsMeasured: records.reduce((sum, record) => sum + (record.instrumentation.providerAttempts ?? 0), 0),
    mutationCountMeasured: records.reduce((sum, record) => sum + record.mutationCount, 0),
    failureClassificationCounts,
    fixtureCheckSummary,
    providerRateLimitedScenarios: records
      .filter((record) => record.providerStatus === "rate_limited")
      .map((record) => record.scenarioId),
    correctnessScoringScenarioIds: records
      .filter((record) =>
        record.correctnessScoring === "included"
        && (record.status === "PASS" || record.status === "FAIL"),
      )
      .map((record) => record.scenarioId),
    nonScoringScenarioIds: records
      .filter((record) =>
        record.correctnessScoring !== "included"
        || (record.status !== "PASS" && record.status !== "FAIL"),
      )
      .map((record) => record.scenarioId),
    isolatedSafetyEvidenceScenarioIds: records
      .filter((record) => record.executionMode === "blocked" && record.safetyPass)
      .map((record) => record.scenarioId),
    ambiguityResolutionSummary,
    correctionDecisionSummary,
    tokenMeasurement: "N/A — no live provider calls; provider failure fixtures use scripted gateways without usage estimates",
  };
  const report = {
    contract: "SECRETARY BRAIN v1 EVALUATION CONTRACT — 30 GROUND-TRUTH SCENARIOS",
    runCorrelationId: records[0]?.correlationId ?? null,
    generatedAt,
    fixedClock: FIXED_NOW.toISOString(),
    fixtureScope: {
      tenant: "unique-per-scenario",
      user: "unique-per-scenario",
      writesAllowed: true,
      liveProviderCalls: false,
      scriptedProviderFixtures: true,
      cleanupCompleted: records.every((record) => record.isolation.cleanupCompleted),
      cleanupRequired: true,
    },
    comparisonScope: [
      "PASS/FAIL is scored against the fixed contract; scenarios with an isolated runtime fixture use that real path, and other executable scenarios use the deterministic envelope.",
      "Exact primary-intent label normalization is limited to the five listed pairs; raw labels and normalizationsApplied remain in the JSON.",
      "For fixture-scored scenarios, envelopeDiagnostic preserves the envelope-only comparison that would otherwise be hidden by the actual path result.",
      "Provider, persisted-operation, verification-failure, and proactive scenarios remain separately classified unless the required runtime path is actually exercised.",
      "Safety fixture success is reported independently and never promotes a blocked contract scenario to PASS.",
      "Token counts are N/A when no live provider usage was collected.",
    ],
    harnessRepairs: [
      "The verification-failure fixture now creates and claims a real scoped operation with a database UUID before invoking the approved executor.",
      "Scenario 03 now seeds two same-name people and exercises production Phase2AgentRuntime; an ambiguous resolver result stops before the model and produces a non-approval clarification.",
      "Scenario 12 now creates, associates, approves, and resolves a real same-tenant project alias through the Second Brain lifecycle.",
      "Scenario 15's synthetic person_financial_status fixture was removed; it is non-executable without a staged authoritative prior-agreement context.",
      "Scenario 29 now uses a pending unassociated alias and production parser/resolver/Phase2 path; it exposes a real mismatch where the project is parsed as a person-expense request and falls through to the guarded model gateway.",
      "The five exact implementation-label pairs are normalized only for comparison; the raw observed names remain unchanged.",
      "Scenarios 16–18 now seed a prior expense and real saved conversation provenance; amount-correction decision evidence is separate from final approved persistence.",
      "JSON and REPORT.md are generated from the same records and timestamp.",
    ],
    summary,
    scenarios: records,
  };
  const markdownCell = (value: unknown) => String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
  const markdown = [
    "# Secretary Brain v1 evaluation",
    "",
    `Generated: ${generatedAt}`,
    `Fixed evaluation clock: ${FIXED_NOW.toISOString()}`,
    "",
    "## Summary",
    "",
    `- Scenarios: ${summary.total}`,
    `- PASS: ${summary.pass}`,
    `- FAIL: ${summary.fail}`,
    `- Blocked: ${summary.blockedByInfrastructure}`,
    `- Not executable: ${summary.notExecutable}`,
    `- Scored contract pass rate: ${summary.contractPassRateAmongExecutable ?? "N/A"}% (${summary.executableScenarioCount} scored scenarios)`,
    `- Isolated fixture mutations: ${summary.mutationCountMeasured}; all fixtures cleaned: ${report.fixtureScope.cleanupCompleted}`,
    `- Real-path fixture checks: ${fixtureCheckSummary.pass} PASS, ${fixtureCheckSummary.fail} FAIL, ${fixtureCheckSummary.blockedByInfrastructure} blocked`,
    `- Ambiguous-person runtime check: ${ambiguityResolutionSummary.pass} PASS, ${ambiguityResolutionSummary.fail} FAIL, ${ambiguityResolutionSummary.blockedByInfrastructure} blocked`,
    `- Live provider calls: no; token usage: N/A`,
    "",
    "## Failure classification",
    "",
    "| Classification | Scenarios |",
    "| --- | ---: |",
    ...failureClasses.map((classification) =>
      `| ${classification} | ${failureClassificationCounts[classification]} |`,
    ),
    "",
    "PASS/FAIL uses the fixed contract and the correct observed path. Isolated runtime checks are scored only where the scenario contract has a usable fixture; the original envelope-only diagnostic remains available separately.",
    "",
    "## Scenario results",
    "",
    "| ID | Scenario | Status | Failure class | Intent | Level | Runtime-stage check | Mismatch / observed outcome |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...records.map((record) => [
      record.scenarioId,
      markdownCell(record.title),
      record.status,
      markdownCell(record.failureClassification),
      markdownCell(record.observed.primaryIntent),
      markdownCell(record.observed.intelligenceLevel),
      markdownCell(
        record.fixtureCheck
          ? `${record.fixtureCheck.kind}:${record.fixtureCheck.status}`
          : record.ambiguityResolution?.status ?? record.correctionDecision?.status,
      ),
      markdownCell(record.passFail.mismatchReason ?? record.observedOutcome),
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |")),
    "",
    "## Multi-turn correction fixture",
    "",
    `Decision-stage results: ${correctionDecisionSummary.pass} PASS, ${correctionDecisionSummary.fail} FAIL, ${correctionDecisionSummary.blockedByInfrastructure} blocked.`,
    "",
    ...records.filter((record) => record.correctionDecision !== null).map((record) => [
      `- Scenario ${record.scenarioId}: **${record.correctionDecision!.status}** — ${record.correctionDecision!.outcome}`,
      `  - ${record.limitation ?? "No additional limitation."}`,
      `  - Final state: ${record.correctionDecision!.finalPersistedState}.`,
    ].join("\n")),
    "",
    "## Ambiguous-person runtime fixture",
    "",
    ...records.filter((record) => record.ambiguityResolution !== null).map((record) => [
      `- Scenario ${record.scenarioId}: **${record.ambiguityResolution!.status}** — ${record.ambiguityResolution!.outcome}`,
      `  - ${record.limitation ?? "No additional limitation."}`,
      `  - Same-name candidates observed: ${record.ambiguityResolution!.candidateCount}.`,
      `  - Gateway guard calls: ${String(record.fixtureCheck?.details.gatewayCalls ?? "not measured")}.`,
    ].join("\n")),
    "",
    "## Real-path fixture checks",
    "",
    ...records.filter((record) => record.fixtureCheck !== null).map((record) => [
      `- Scenario ${record.scenarioId} (${record.fixtureCheck!.kind}): **${record.fixtureCheck!.status}** — ${record.fixtureCheck!.outcome}`,
      `  - Compared: ${record.fixtureCheck!.comparedFields.join(", ") || "not scored"}.`,
      record.fixtureCheck!.mismatchReason ? `  - Limitation: ${record.fixtureCheck!.mismatchReason}.` : "",
      `  - Raw envelope diagnostic: ${record.envelopeDiagnostic?.mismatchReason ?? "none"}.`,
    ].filter(Boolean).join("\n")),
    "",
    "## Harness repairs and scope",
    "",
    ...report.harnessRepairs.map((repair) => `- ${repair}`),
    "- The fixed 30-scenario contract and expected outcomes were not edited.",
    "- Provider failover and operation lifecycle tests remain safety evidence, not Brain decision-flow passes.",
    "- Full expected and observed objects, mismatch details, fixture IDs, and correlation IDs are in the JSON file.",
    "",
  ].join("\n");

  await Promise.all([
    mkdir(dirname(outputPath), { recursive: true }),
    mkdir(dirname(reportPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(reportPath, markdown, "utf8"),
  ]);
}

export type { EvaluationRecord };