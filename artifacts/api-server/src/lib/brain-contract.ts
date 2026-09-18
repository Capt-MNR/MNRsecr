import type { SemanticParse } from "./deterministic-intelligence";
import type { RelationshipContextResult } from "./relationship-context";
import type { SecondBrainRetrievalTrace } from "./second-brain";

export type BrainStrategyLevel = "L0" | "L1" | "L2" | "L3";
export type BrainDecisionState =
  | "understanding"
  | "clarification"
  | "awaiting_approval"
  | "executing"
  | "verifying"
  | "completed"
  | "failed"
  | "rejected"
  | "expired";
export type BrainVerificationState =
  | "not_required"
  | "pending"
  | "verified"
  | "failed"
  | "unknown";
export type BrainRiskLevel = "low" | "medium" | "high" | "critical";

export type BrainDecisionEnvelope = {
  version: 1;
  requestId: string;
  conversationId: string;
  state: BrainDecisionState;
  intent: {
    name: string;
    confidence: number;
    source: "deterministic" | "relationship_context" | "conversation" | "llm" | "unknown";
  };
  strategy: {
    level: BrainStrategyLevel;
    reason: string;
    llmAllowed: boolean;
    deterministicExecution: boolean;
  };
  context: {
    sources: Array<
      "conversation" | "structured_records" | "relationship_graph" | "second_brain" | "user_input"
    >;
    selected: string[];
    excluded: string[];
    ambiguity: string[];
    temporal: {
      mentioned: boolean;
      resolved: boolean;
      dayOffset: number | null;
      hasExactTime: boolean;
    };
  };
  confidence: {
    overall: number;
    intent: number;
    entity: number;
    temporal: number;
    execution: number;
  };
  risk: {
    level: BrainRiskLevel;
    factors: string[];
    requiresApproval: boolean;
  };
  verification: {
    state: BrainVerificationState;
    required: boolean;
    checks: string[];
  };
  trace: {
    retrievalUsed: boolean;
    relationshipContextUsed: boolean;
    toolCalls: number;
    llmCalls: number;
    evaluationScenario: string | null;
  };
};

type BrainInput = {
  requestId: string;
  conversationId: string;
  message: string;
  semanticParse?: SemanticParse | null;
  relationshipContext?: RelationshipContextResult | null;
  secondBrainTrace?: SecondBrainRetrievalTrace | null;
  hasConversationContext?: boolean;
  toolCalls?: number;
  llmCalls?: number;
  state?: BrainDecisionState;
  verification?: Partial<BrainDecisionEnvelope["verification"]>;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function evaluationScenario(message: string): string | null {
  const text = message.toLocaleLowerCase("ar");
  if (/مزود|provider|الخدمه|الخدمة/.test(text) && /مصروف|دفعت|دفع|اديت|اعطيت/.test(text)) {
    return "24_provider_failure_during_expense_creation";
  }
  if (/انتهت|منتهيه|منتهية|expired/.test(text) && /موافق|تأكيد|تأكيدات|approval/.test(text)) {
    return "25_approval_expired";
  }
  if (/تحقق|verification|تأكد/.test(text) && /تنفيذ|نفذ|اتنفذ/.test(text)) {
    return "26_verification_failure_after_execution_attempt";
  }
  if (/غيرت رأيي|غيرت رايي|مش عايز|لا خلاص|تراجعت/.test(text)) {
    return "27_user_changes_mind";
  }
  if (/دين|ديون|سلف|علاق|عليه|له عند/.test(text) && /كام|كم|إيه|ايه|تفاصيل|ملخص/.test(text)) {
    return "28_debt_or_relationship_question";
  }
  if (/اسم بديل|لقب|alias|اسم تاني|اسم اخر|اسم آخر/.test(text)) {
    return "29_project_alias_without_canonical_association";
  }
  if (/التزام|التزامات|واجب|مستحق|proactive/.test(text) && /اقترح|استنتج|فكرني|ذكّر/.test(text)) {
    return "30_proactive_obligation_synthesis";
  }
  return null;
}

function intentFrom(
  semanticParse: SemanticParse | null | undefined,
  relationshipContext: RelationshipContextResult | null | undefined,
): { name: string; confidence: number; source: BrainDecisionEnvelope["intent"]["source"] } {
  if (relationshipContext?.context.intent) {
    return {
      name: relationshipContext.context.intent,
      confidence: relationshipContext.context.resolvedEntities.length > 0 ? 0.94 : 0.8,
      source: "relationship_context",
    };
  }
  if (semanticParse) {
    return {
      name: semanticParse.intent,
      confidence: clamp(semanticParse.confidence),
      source: semanticParse.intent === "unknown" ? "unknown" : "deterministic",
    };
  }
  return { name: "unknown", confidence: 0.2, source: "unknown" };
}

function strategyFor(
  semanticParse: SemanticParse | null | undefined,
  relationshipContext: RelationshipContextResult | null | undefined,
  hasConversationContext: boolean,
): BrainDecisionEnvelope["strategy"] {
  if (relationshipContext?.response?.kind === "clarification") {
    return {
      level: "L0",
      reason: "authoritative_context_requires_clarification",
      llmAllowed: false,
      deterministicExecution: false,
    };
  }
  if (semanticParse && !semanticParse.ambiguous && semanticParse.confidence >= 0.9) {
    const isRead = ["expense_report", "person_expense_total", "project_people", "schedule_read", "memory_recall"]
      .includes(semanticParse.intent);
    return {
      level: isRead ? "L1" : "L2",
      reason: isRead ? "high_confidence_scoped_read" : "high_confidence_structured_intent",
      llmAllowed: !isRead,
      deterministicExecution: true,
    };
  }
  if (semanticParse?.ambiguous || !hasConversationContext && /(?:ده|دي|التاني|غيره|خليه|المذكور)/u.test(semanticParse?.normalizedText ?? "")) {
    return {
      level: "L3",
      reason: "contextual_ambiguity_requires_reasoning",
      llmAllowed: true,
      deterministicExecution: false,
    };
  }
  return {
    level: "L2",
    reason: "structured_tools_with_contextual_reasoning",
    llmAllowed: true,
    deterministicExecution: true,
  };
}

function riskFor(
  intent: string,
  semanticParse: SemanticParse | null | undefined,
  relationshipContext: RelationshipContextResult | null | undefined,
): BrainDecisionEnvelope["risk"] {
  const write = [
    "record_expense",
    "create_reminder",
    "create_person",
    "create_project",
  ].includes(intent) || Boolean(semanticParse?.hasWriteLanguage);
  const ambiguity = Boolean(semanticParse?.ambiguous)
    || Boolean(relationshipContext?.context.uncertainties.length);
  const financial = intent.includes("expense") || /financial|debt|obligation|payment/.test(intent);
  const factors = [
    ...(write ? ["state_mutation"] : []),
    ...(financial ? ["financial_data"] : []),
    ...(ambiguity ? ["unresolved_context"] : []),
  ];
  return {
    level: financial && ambiguity ? "high" : write ? "medium" : "low",
    factors,
    requiresApproval: write,
  };
}

export function createBrainDecisionEnvelope(input: BrainInput): BrainDecisionEnvelope {
  const semanticParse = input.semanticParse ?? null;
  const relationshipContext = input.relationshipContext ?? null;
  const intent = intentFrom(semanticParse, relationshipContext);
  const strategy = strategyFor(semanticParse, relationshipContext, input.hasConversationContext ?? false);
  const risk = riskFor(intent.name, semanticParse, relationshipContext);
  const relationshipUsed = Boolean(relationshipContext);
  const retrievalUsed = Boolean(input.secondBrainTrace?.triggered);
  const ambiguity = [
    ...(semanticParse?.ambiguous ? ["multiple_domains"] : []),
    ...(relationshipContext?.context.uncertainties ?? []),
  ];
  const hasTemporalMention = Boolean(semanticParse?.dateTime)
    || /اليوم|امبارح|أمس|بكره|بكرة|بعد بكره|الأسبوع|الشهر|today|tomorrow|yesterday/i.test(input.message);
  const state = input.state
    ?? (relationshipContext?.response?.kind === "clarification" ? "clarification" : "understanding");
  const verification = {
    state: state === "failed"
      ? "failed" as const
      : risk.requiresApproval ? "pending" as const : "not_required" as const,
    required: risk.requiresApproval,
    checks: risk.requiresApproval ? ["authoritative_structured_result"] : [],
    ...input.verification,
  };
  const intentConfidence = clamp(intent.confidence);
  const entityConfidence = relationshipContext
    ? relationshipContext.context.resolvedEntities.length > 0
      ? Math.max(...relationshipContext.context.resolvedEntities.map((entity) => clamp(entity.confidence)))
      : ambiguity.length > 0 ? 0.25 : 0.65
    : semanticParse?.entityMentions.length ? 0.7 : 0.8;
  const temporalConfidence = semanticParse?.dateTime?.confidence ?? (hasTemporalMention ? 0.35 : 1);
  return {
    version: 1,
    requestId: input.requestId,
    conversationId: input.conversationId,
    state,
    intent,
    strategy,
    context: {
      sources: [
        "user_input",
        ...(input.hasConversationContext ? ["conversation" as const] : []),
        ...(relationshipUsed ? ["relationship_graph" as const, "structured_records" as const] : []),
        ...(retrievalUsed ? ["second_brain" as const] : []),
      ],
      selected: [
        ...(relationshipUsed ? ["bounded_relationship_context"] : []),
        ...(retrievalUsed ? ["governed_second_brain_context"] : []),
        ...(input.hasConversationContext ? ["conversation_referents"] : []),
      ],
      excluded: [
        ...(retrievalUsed ? ["unapproved_second_brain_candidates"] : []),
        "unverified_model_claims",
      ],
      ambiguity,
      temporal: {
        mentioned: hasTemporalMention,
        resolved: Boolean(semanticParse?.dateTime),
        dayOffset: semanticParse?.dateTime?.dayOffset ?? null,
        hasExactTime: Boolean(semanticParse?.dateTime),
      },
    },
    confidence: {
      overall: clamp(intentConfidence * 0.45 + entityConfidence * 0.25 + temporalConfidence * 0.15 + (verification.state === "verified" ? 0.15 : 0.05)),
      intent: intentConfidence,
      entity: clamp(entityConfidence),
      temporal: clamp(temporalConfidence),
      execution: verification.state === "verified" ? 1 : verification.state === "failed" ? 0 : 0.5,
    },
    risk,
    verification,
    trace: {
      retrievalUsed,
      relationshipContextUsed: relationshipUsed,
      toolCalls: input.toolCalls ?? 0,
      llmCalls: input.llmCalls ?? 0,
      evaluationScenario: evaluationScenario(input.message),
    },
  };
}

export function brainLogFields(envelope: BrainDecisionEnvelope): Record<string, unknown> {
  return {
    brainVersion: envelope.version,
    brainState: envelope.state,
    brainStrategy: envelope.strategy.level,
    brainIntent: envelope.intent.name,
    brainIntentConfidence: envelope.intent.confidence,
    brainOverallConfidence: envelope.confidence.overall,
    brainRisk: envelope.risk.level,
    brainVerification: envelope.verification.state,
    brainSources: envelope.context.sources,
    brainAmbiguity: envelope.context.ambiguity,
    evaluationScenario: envelope.trace.evaluationScenario,
  };
}