import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { RelationshipContextResult } from "../../src/lib/relationship-context";
import {
  createBrainDecisionEnvelope,
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

const FIXED_NOW = new Date("2026-09-19T10:00:00.000Z");
const FIXED_TENANT = "brain-evaluation-tenant";
const FIXED_USER = "brain-evaluation-user";

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
    measurement: "deterministic_path_no_provider_call" | "not_executable";
  };
  passFail: {
    pass: boolean | null;
    mismatchReason: string | null;
    comparedFields: string[];
    responsibleSubsystem: string | null;
  };
  failureClassification: string | null;
};

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
    case "03":
      return {
        context: { ...base, intent: "person_financial_status", uncertainties: ["person_ambiguous"] },
        response: { kind: "clarification", message: "أي محمد تقصد؟" },
      };
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
    case "12":
      return {
        context: {
          ...base,
          intent: "entity_context",
          resolvedEntities: [resolvedEntity("project-quarry", "المحجر", "project", "alias")],
        },
        response: { kind: "answer", message: "canonical project resolved" },
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
          intent: "project_expenses",
          resolvedEntities: [resolvedEntity("project-quarry", "المحجر", "project")],
          uncertainties: ["memory_conflicts_with_structured_record"],
          financialSummary: { EGP: [{ currency: "EGP", amountMinor: 700000, count: 2 }] },
        },
        response: { kind: "answer", message: "record differs from memory" },
      };
    case "15":
      return {
        context: {
          ...base,
          intent: "person_financial_status",
          resolvedEntities: [resolvedEntity("person-mohamed", "محمد", "person")],
          uncertainties: ["agreed_amount_unknown"],
        },
        response: { kind: "clarification", message: "ما المبلغ المتفق عليه؟" },
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
    case "29":
      return {
        context: {
          ...base,
          intent: "project_expenses",
          uncertainties: ["project_alias_unassociated"],
        },
        response: { kind: "clarification", message: "أي مشروع تقصد؟" },
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
  if (expected.primaryIntent !== "unspecified") {
    comparedFields.push("primaryIntent");
    if (observed.primaryIntent !== expected.primaryIntent) {
      mismatches.push(`primaryIntent observed=${observed.primaryIntent} expected=${expected.primaryIntent}`);
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
    responsibleSubsystem: mismatches.length > 0
      ? "brain-contract.ts / deterministic-intelligence.ts"
      : null,
  };
}

export function evaluateScenario(scenario: ContractScenario): EvaluationRecord {
  const parse = parseSemanticRequest(scenario.input, FIXED_NOW);
  const relationshipContext = relationshipFixture(scenario);
  const envelope = createBrainDecisionEnvelope({
    requestId: `brain-eval-${scenario.scenarioId}`,
    conversationId: `brain-eval-conversation-${scenario.scenarioId}`,
    message: scenario.input,
    semanticParse: parse,
    relationshipContext,
    hasConversationContext: Boolean(scenario.previousState) || scenario.context !== "none",
    state: scenario.scenarioId === "27" ? "rejected" : undefined,
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
          responsibleSubsystem: null,
        },
    failureClassification: status === "FAIL"
      ? comparison.mismatchReason?.includes("intelligenceLevel")
        ? "intelligence-level mismatch"
        : comparison.mismatchReason?.includes("risk")
          ? "confidence/risk mismatch"
          : "intent/decision mismatch"
      : null,
  };
}

export function evaluateAll(): EvaluationRecord[] {
  return evaluationContractV1.map(evaluateScenario);
}

export async function writeEvaluationReport(
  outputPath: string,
  records = evaluateAll(),
): Promise<void> {
  const summary = {
    total: records.length,
    pass: records.filter((record) => record.status === "PASS").length,
    fail: records.filter((record) => record.status === "FAIL").length,
    blockedByInfrastructure: records.filter((record) => record.status === "BLOCKED_BY_INFRASTRUCTURE").length,
    notExecutable: records.filter((record) => record.status === "NOT_EXECUTABLE").length,
    contractPassRateAmongExecutable: (() => {
      const executable = records.filter((record) => record.status === "PASS" || record.status === "FAIL");
      return executable.length === 0
        ? null
        : Math.round((executable.filter((record) => record.status === "PASS").length / executable.length) * 10000) / 100;
    })(),
    logicalLlmCallsMeasured: records.reduce((sum, record) => sum + (record.instrumentation.logicalLlmCalls ?? 0), 0),
    providerAttemptsMeasured: records.reduce((sum, record) => sum + (record.instrumentation.providerAttempts ?? 0), 0),
    tokenMeasurement: "N/A — no provider calls were made by the isolated deterministic harness",
  };
  const report = {
    contract: "SECRETARY BRAIN v1 EVALUATION CONTRACT — 30 GROUND-TRUTH SCENARIOS",
    generatedAt: "2026-09-19T10:00:00.000Z",
    fixedClock: FIXED_NOW.toISOString(),
    fixtureScope: { tenant: FIXED_TENANT, user: FIXED_USER, writesAllowed: false },
    summary,
    scenarios: records,
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export type { EvaluationRecord };