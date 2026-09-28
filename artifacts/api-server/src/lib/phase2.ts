import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  commitmentsTable,
  db as database,
  expensesTable,
  financialPartyPeopleTable,
  financialPartyProjectsTable,
  idempotencyRecordsTable,
  peopleTable,
  projectPeopleTable,
  projectsTable,
  purposesTable,
  remindersTable,
  tasksTable,
  type Person,
  type Project,
} from "@workspace/db";
import type { Identity } from "./secretary";
import {
  compactActionForMemory,
  conversationContextMessages,
  loadConversationMemory,
  mergeConversationReferents,
  saveConversationTurn,
  updateConversationState,
  type ConversationState,
  type ConversationMemorySnapshot,
} from "./conversation-memory";
import {
  isUnanchoredConversationFollowup,
  parseRelationshipRequest,
  parseFinancialFollowupAdjustment,
  retrieveRelationshipContext,
} from "./relationship-context";
import { detectLearningSignal } from "./learning-signals";
import {
  applySecondBrainPolicy,
  applySecondBrainContextBudget,
  createSecondBrainCandidate,
  emptyRetrievalTrace,
  getActiveSecondBrainMemory,
  hasActiveSecondBrainMemory,
  listActiveSecondBrainPreferences,
  parseSecondBrainCandidate,
  parseSecondBrainCommand,
  parseNaturalMemoryStatement,
  rememberSecondBrain,
  retrieveSecondBrain,
  secondBrainRecallMessage,
  updateSecondBrainMemoryIfPresent,
  type SecondBrainCommand,
  type SecondBrainCandidateSuggestion,
  type NaturalMemoryStatement,
} from "./second-brain";
import { buildRecallPlan, RETRIEVED_MEMORY_SAFETY_RULE } from "./recall-plan";
import { assembleContext, serializeContextAssembly } from "./context-assembly";
import {
  agentToolError,
  isTransientProviderFailure,
  providerFailoverError,
  providerExceptionError,
  providerResponseError,
  SecretaryError,
} from "./error-contract";
import {
  createPendingOperation,
  rejectPendingOperationForConversation,
} from "./secretary-operations";
import { annotateApprovalAction, approvalMessage } from "./secretary-confirmation";
import {
  deterministicExpensePeriod,
  isBroadExpenseReportRequest,
  isExpenseTotalCorrectionRequest,
  isGlobalExpenseTotalRequest,
  type DeterministicExpensePeriod,
} from "./expense-report";
import { budgetContext } from "./context-budgeter";
import { envFlag, featureFlags } from "./feature-flags";
import { providerOrder } from "./provider-router";
import {
  directProviderRoute,
  gatewayRoute,
  routeHealthKey,
  routeTargetId,
  routeWithModel,
  type InferenceRoute,
  type InferenceRouteId,
  type InferenceRouteKind,
} from "./inference-routes";
import {
  defaultInferenceServiceOrder,
  inferenceRouteForService,
  inferenceServiceApiUrl,
  inferenceServiceDefinition,
  inferenceServiceIsConfigured,
  inferenceServiceIsKnown,
  inferenceServiceModel,
  routeIdForService,
  serviceNameForRouteId,
  providerApiUrl,
  providerDefinition,
  providerIsConfigured,
  providerModel,
  type ProviderName,
} from "./provider-registry";
export type { ProviderName } from "./provider-registry";
import {
  createDeterministicRequestMetrics,
  decideDeterministically,
  parseSemanticRequest,
  validateDeterministicPayload,
  isProductionDeterministicIntent,
  isExplicitCancellationRequest,
  arabicDigitsToAscii,
  parseArabicTimeOfDay,
  type DeterministicRequestMetrics,
  type DeterministicDecision,
  type SemanticParse,
} from "./deterministic-intelligence";
import {
  normalizeEntityText,
  recordResolverShadow,
  resolveEntity,
  type ResolverResult,
} from "./entity-resolver";
import { recordToolActivity, type DbExecutor } from "./entity-graph";
import {
  createDonation,
  createFinancialObligation,
  createFinancialParty,
  createFinancialPayment,
  createIncomeReceivable,
  createPaymentLink,
  settleObligation,
  updateDonation,
  updateFinancialObligation,
  updateFinancialPayment,
  updateIncomeReceivable,
} from "./financial-graph";
import { createTypedRelationship, deleteTypedRelationship } from "./relationship-graph";
import {
  buildPatternInsights,
  loadExperimentalPatternHistory,
} from "./experimental-pattern-insights";
import { lockExecutingOperation } from "./secretary-operations";
import type { SecretaryChatContext, SecretaryChatPeer, TurnInputChannel } from "@workspace/api-zod";
import {
  brainLogFields,
  createBrainDecisionEnvelope,
  type BrainDecisionEnvelope,
  type BrainVerificationState,
} from "./brain-contract";
import { runWithIdempotencyLock } from "./idempotency-lock";
import { agentWorkRuntime } from "./agent-work/runtime";
import {
  externalActionConnectorForProvider,
  externalActionToolGuidance,
  registeredExternalActionProviders,
} from "./agent-work/external-action-registry";
import type { AgentWorkKind } from "./agent-work/types";
import {
  countOpenTasks,
  enqueueTaskThresholdTriggersForMutation,
  enqueueTriggerOutbox,
} from "./trigger-outbox";
import { enqueueProactiveDeadlineTriggers } from "./proactive-triggers";

const db = database;

export type Phase2TurnInput = {
  message: string;
  conversationId?: string | null;
  idempotencyKey?: string | null;
  channel?: TurnInputChannel;
  context?: SecretaryChatContext | null;
  peer?: SecretaryChatPeer | null;
  inputId?: string | null;
  requestId?: string;
};

export type Phase2RunOptions = {
  dryRun?: boolean;
};

export type Phase2TurnResult = {
  conversationId: string;
  turnId?: string;
  assistantMessage: string;
  action?: Record<string, unknown>;
  response?: FinalResponse;
  provider: string;
  model: string;
};

async function persistSecondBrainCommand(
  identity: Identity,
  input: Phase2TurnInput,
  conversationMemory: ConversationMemorySnapshot,
  command: SecondBrainCommand,
  requestId: string,
  dryRun: boolean,
): Promise<Phase2TurnResult> {
  const conversationId = input.conversationId || conversationMemory.conversationId;
  const naturalCapture = command.type === "remember"
    && command.metadata?.naturalCapture === "agreement_statement";
  const naturalUpdate = naturalCapture
    && command.metadata?.naturalMemoryAction === "update";
  const action = command.type === "remember"
    ? {
        type: naturalUpdate ? "second_brain_memory_updated" : "second_brain_memory_saved",
        memoryKind: command.memoryKind,
        key: command.key,
        value: command.value,
        source: naturalCapture ? "natural_language_statement" : "explicit_user_instruction",
        ...(dryRun ? { dryRun: true } : {}),
      }
    : {
        type: "second_brain_recall",
        query: command.query,
      };
  const recallPlan = command.type === "recall"
    ? buildRecallPlan(command.query, { explicitMemoryRecall: true })
    : null;
  const retrieval = command.type === "recall"
    ? await retrieveSecondBrain(identity, command.query, {
        mode: "explicit_recall",
        queryDomain: "memory_recall",
        requestId,
        conversationId,
        includeArchived: true,
        temporalMode: recallPlan?.temporalMode ?? "current",
      })
    : null;
  if (retrieval && recallPlan) {
    retrieval.trace.recallPlan = {
      sources: recallPlan.sources,
      selection: recallPlan.selection,
    };
  }
  const governedRetrieval = retrieval
    ? applySecondBrainPolicy(retrieval.memories, retrieval.trace)
    : null;
  const memories = governedRetrieval?.memories ?? [];
  const result: Phase2TurnResult = {
    conversationId,
    turnId: requestId,
    assistantMessage: command.type === "remember"
      ? naturalCapture
        ? naturalUpdate
          ? "تمام، حدّثت الاتفاق في الذاكرة واحتفظت بالصيغة السابقة كتاريخ. لم أغيّر أي سجل رسمي."
          : "حفظت الاتفاق كسياق في الذاكرة، من غير إنشاء التزام رسمي أو افتراض ربط غير مؤكد."
        : "تمام، حفظتها في الذاكرة الشخصية. هستخدمها كسياق مساعد، لكن مش هاعتبرها بديلًا عن السجلات الرسمية."
      : secondBrainRecallMessage(memories),
    response: {
      kind: "answer",
      message: command.type === "remember"
        ? naturalCapture
          ? naturalUpdate
            ? "تم تحديث الاتفاق مع الاحتفاظ بالنسخة السابقة."
            : "تم حفظ الاتفاق كسياق في Second Brain، وليس كسجل التزام رسمي."
          : "تم حفظ المعلومة في Second Brain."
        : secondBrainRecallMessage(memories),
    },
    action: command.type === "remember"
      ? action
      : {
          ...action,
          memories: memories.map((memory) => memory.id),
          secondBrainRetrievalTrace: governedRetrieval?.trace,
        },
    provider: "second-brain",
    model: "deterministic-memory-v1",
  };
  if (!dryRun) {
    await saveConversationTurn(identity, conversationMemory, {
      turnId: requestId,
      userMessage: input.message.trim(),
      assistantMessage: result.assistantMessage,
      action: result.action,
    });
    if (input.idempotencyKey) await saveIdempotent(identity, input.idempotencyKey, result);
  }
  return result;
}

async function resolveNaturalMemoryMetadata(
  identity: Identity,
  statement: NaturalMemoryStatement,
): Promise<Record<string, unknown>> {
  const unresolvedEntities: Array<Record<string, unknown>> = [];
  const resolvedEntities: Array<{
    entityType: "person" | "project";
    entityId: string;
    name: string;
    matchType: "exact" | "alias";
    confidence: number;
  }> = [];
  const resolveTrusted = async (
    entityType: "person" | "project",
    name: string,
  ): Promise<void> => {
    try {
      const result = await resolveEntity(identity, entityType, name);
      if (
        result.selected
        && (result.matchType === "exact" || result.matchType === "alias")
        && result.confidence >= 0.95
      ) {
        resolvedEntities.push({
          entityType,
          entityId: result.selected.id,
          name: result.selected.name,
          matchType: result.matchType,
          confidence: result.confidence,
        });
        return;
      }
      unresolvedEntities.push({
        entityType,
        name,
        resolution: result.matchType,
        candidateCount: result.candidates.length,
      });
    } catch (error) {
      logger.warn({
        entityType,
        error: error instanceof Error ? error.message : "ENTITY_RESOLUTION_FAILED",
      }, "natural memory entity resolution failed; keeping the reference unlinked");
      unresolvedEntities.push({ entityType, name, resolution: "unavailable" });
    }
  };

  await Promise.all([
    resolveTrusted("person", statement.personName),
    ...(statement.projectName ? [resolveTrusted("project", statement.projectName)] : []),
  ]);
  const primary = resolvedEntities.find((entity) => entity.entityType === "person")
    ?? resolvedEntities[0];
  return {
    ...statement.metadata,
    ...(primary ? { entityType: primary.entityType, entityId: primary.entityId } : {}),
    ...(resolvedEntities.length > 1 ? { relatedEntities: resolvedEntities } : {}),
    ...(unresolvedEntities.length > 0 ? { unresolvedEntities } : {}),
  };
}

async function persistNaturalMemoryUpdateClarification(
  identity: Identity,
  input: Phase2TurnInput,
  conversationMemory: ConversationMemorySnapshot,
  statement: NaturalMemoryStatement,
  requestId: string,
  dryRun: boolean,
  clarification: {
    reason: string;
    message: string;
  } = {
    reason: "natural_memory_update_target_missing",
    message: `لم أجد اتفاقًا حاليًا محفوظًا عن ${statement.personName} و${statement.topicKey.replace(/_/g, " ")}. هل تقصد اتفاقًا آخر؟`,
  },
): Promise<Phase2TurnResult> {
  const conversationId = input.conversationId || conversationMemory.conversationId;
  const message = clarification.message;
  const result: Phase2TurnResult = {
    conversationId,
    turnId: requestId,
    assistantMessage: message,
    response: { kind: "clarification", message },
    action: {
      type: "clarification_needed",
      reason: clarification.reason,
      memoryKey: statement.key,
      ...(dryRun ? { dryRun: true } : {}),
    },
    provider: "second-brain",
    model: "deterministic-memory-v1",
  };
  if (!dryRun) {
    await saveConversationTurn(identity, conversationMemory, {
      turnId: requestId,
      userMessage: input.message.trim(),
      assistantMessage: result.assistantMessage,
      action: result.action,
    });
    if (input.idempotencyKey) await saveIdempotent(identity, input.idempotencyKey, result);
  }
  return result;
}

async function persistSecondBrainCandidate(
  identity: Identity,
  input: Phase2TurnInput,
  conversationMemory: ConversationMemorySnapshot,
  suggestion: SecondBrainCandidateSuggestion,
  requestId: string,
  dryRun: boolean,
): Promise<Phase2TurnResult> {
  const conversationId = input.conversationId || conversationMemory.conversationId;
  const candidate = dryRun
    ? null
    : await createSecondBrainCandidate(identity, {
        memoryKind: suggestion.memoryKind,
        key: suggestion.key,
        value: suggestion.value,
        confidenceBps: suggestion.confidenceBps,
        metadata: suggestion.metadata,
        conversationId,
        turnId: requestId,
      });
  const candidateMessage = suggestion.memoryKind === "alias"
    ? "لاحظت اسمًا بديلًا، ووضعته في قائمة المراجعة حتى يتم ربطه بكيان واضح قبل استخدامه."
    : "لاحظت تفضيلًا شخصيًا، ووضعته في قائمة المراجعة بدل تفعيله تلقائيًا. يمكنك اعتماده من صفحة الذاكرة.";
  const candidateResponse = suggestion.memoryKind === "alias"
    ? "تم وضع الاسم البديل في قائمة مراجعة الذاكرة لحين ربطه بكيان واضح."
    : "تم وضع الاقتراح في قائمة مراجعة الذاكرة الشخصية.";
  const result: Phase2TurnResult = {
    conversationId,
    turnId: requestId,
    assistantMessage: candidateMessage,
    response: {
      kind: "answer",
      message: candidateResponse,
    },
    action: {
      type: "second_brain_memory_candidate_created",
      memoryKind: suggestion.memoryKind,
      key: suggestion.key,
      value: suggestion.value,
      confidence: suggestion.confidenceBps / 10000,
      status: "pending_review",
      ...(candidate ? { candidateId: candidate.id } : {}),
      ...(dryRun ? { dryRun: true } : {}),
    },
    provider: "second-brain",
    model: "deterministic-memory-v1",
  };
  if (!dryRun) {
    await saveConversationTurn(identity, conversationMemory, {
      turnId: requestId,
      userMessage: input.message.trim(),
      assistantMessage: result.assistantMessage,
      action: result.action,
    });
    if (input.idempotencyKey) await saveIdempotent(identity, input.idempotencyKey, result);
  }
  return result;
}

type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

type GeminiPart = {
  text?: string;
  thoughtSignature?: string;
  functionCall?: {
    name: string;
    args?: Record<string, unknown>;
    thoughtSignature?: string;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
};

export type ConversationMessage = {
  role: "system" | "user" | "assistant" | "tool";
  text?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    thoughtSignature?: string;
  }>;
  toolCallId?: string;
  toolName?: string;
};

type GatewayToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  thoughtSignature?: string;
};

export type GatewayResponse = {
  text: string;
  toolCalls: GatewayToolCall[];
  usage?: unknown;
};

export type FinalResponseKind = "answer" | "clarification" | "not_found" | "error";

export type GroundedFact = {
  type: "money" | "count";
  value: number;
  currency?: string;
  label?: string;
};

export type FinalResponse = {
  kind: FinalResponseKind;
  message: string;
  groundedFacts?: GroundedFact[];
};

export type ToolScope = {
  name: "full" | "read_only" | "expense" | "reminder" | "person" | "project" | "task" | "commitment";
  allowedToolNames: ReadonlySet<string>;
  isFull: boolean;
};

export type GatewayCallContext = {
  requestId: string;
  conversationId?: string;
  callNumber: number;
  toolCallsExecuted: number;
  toolScope?: ToolScope;
  finalResponseOnly?: boolean;
  providerFallback?: boolean;
  currentUserMessage?: string;
  metrics?: GatewayRequestMetrics;
  deadlineAt?: number;
  route?: InferenceRoute;
};

export type GatewayRequestMetrics = {
  logicalLlmCalls: number;
  httpAttempts: number;
  httpAttemptsByProvider: Partial<Record<ProviderName, number>>;
  httpAttemptsByRoute?: Partial<Record<InferenceRouteId, number>>;
  retryCount: number;
  providerFallbackAttempts: number;
  modelFallbackAttempts: number;
  requestBytesByProvider: Partial<Record<ProviderName, number>>;
  requestBytesByRoute?: Partial<Record<InferenceRouteId, number>>;
  maxRequestBytes: number;
  systemPromptChars: number;
  toolDefinitionsChars: number;
  toolDefinitionsCount: number;
  maxConversationChars: number;
  cacheHit?: boolean;
  cacheMiss?: boolean;
  cachedTokens?: number;
  attempts: LlmUsageAttempt[];
};

export type LlmUsageFormat = "gemini" | "openai-compatible" | "cohere";

export type NormalizedLlmUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  completeness: "complete" | "partial" | "unavailable";
};

export type LlmContextBreakdown = {
  systemPromptChars: number;
  requestGuidanceChars: number;
  userMessageChars: number;
  recentConversationChars: number;
  summaryChars: number;
  structuredStateChars: number;
  toolResultChars: number;
  otherConversationChars: number;
  conversationChars: number;
  toolDefinitionsChars: number;
  requestBytes: number;
  systemPromptTokens: number | null;
  conversationTokens: number | null;
  toolDefinitionsTokens: number | null;
  toolResultTokens: number | null;
};

export type LlmUsageAttempt = {
  requestId: string;
  conversationId: string | null;
  provider: ProviderName;
  routeId?: InferenceRouteId;
  routeKind?: InferenceRouteKind;
  routeTargetId?: string;
  modelId?: string;
  usageFormat?: LlmUsageFormat;
  model: string;
  logicalCallNumber: number;
  attemptNumber: number;
  scope: ToolScope["name"] | null;
  toolsAvailable: string[];
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  systemPromptTokens: number | null;
  conversationTokens: number | null;
  toolDefinitionsTokens: number | null;
  toolResultTokens: number | null;
  cacheHit: boolean;
  cacheRetry: boolean;
  fallback: boolean;
  retry: boolean;
  httpRequestSent: boolean;
  latencyMs: number;
  success: boolean;
  failureReason: string | null;
  outputChars: number;
  context: LlmContextBreakdown;
};

export type DiagnosticToolResult = {
  ok: boolean | null;
  keys: string[];
  resultChars: number;
  resultBytes: number;
  promptChars: number;
  pendingApproval: boolean;
  errorCode: string | null;
};

export type DiagnosticSelectedTool = {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  argumentChars: number;
  argumentBytes: number;
  result: DiagnosticToolResult | null;
};

export type DiagnosticNextDecision = {
  kind:
    | "continue_after_tool_results"
    | "schedule_finalization"
    | "return_text"
    | "return_final_response"
    | "return_approval"
    | "scope_widened"
    | "finalization_failed"
    | "error"
    | "tool_limit";
  reason: string;
  nextLogicalCallNumber: number | null;
  nextCallKind: "tool_round" | "finalization" | null;
  nextScope: ToolScope["name"] | null;
};

export type DiagnosticLogicalCall = {
  logicalCallNumber: number;
  phase: "tool_round" | "finalization";
  scope: ToolScope["name"] | null;
  requestedTools: string[];
  finalResponseOnly: boolean;
  attempts: LlmUsageAttempt[];
  selectedTools: DiagnosticSelectedTool[];
  nextDecision: DiagnosticNextDecision | null;
};

export type Phase2DiagnosticTrace = {
  version: 1;
  calls: DiagnosticLogicalCall[];
};

export type LlmUsageSummary = {
  totalLogicalLlmCalls: number;
  totalHttpAttempts: number;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalTokens: number | null;
  totalCachedTokens: number | null;
  usageCompleteness: "complete" | "partial" | "unavailable";
  totalToolCalls: number;
  fallbackCount: number;
  retryCount: number;
  cacheHit: boolean;
  cacheMiss: boolean;
  latencyMs: number;
  context: {
    systemPromptChars: number | null;
    requestGuidanceChars: number | null;
    userMessageChars: number | null;
    recentConversationChars: number | null;
    summaryChars: number | null;
    structuredStateChars: number | null;
    toolResultChars: number | null;
    otherConversationChars: number | null;
    conversationChars: number | null;
    toolDefinitionsChars: number | null;
    requestBytes: number | null;
  };
};

function logLlmFailure(
  provider: string,
  model: string,
  context: GatewayCallContext,
  attempt: number,
  error: unknown,
): void {
  const classified = error instanceof SecretaryError ? error : providerExceptionError(provider, error);
  logger.warn({
    requestId: context.requestId,
    provider,
    model,
    llmCall: context.callNumber,
    attempt,
    errorCode: classified.code,
    upstreamStatus: classified.upstreamStatus,
    providerError: classified.providerError,
    retryAfterSeconds: classified.retryAfterSeconds,
  }, "agent llm call failed");
}

export interface ModelGateway {
  readonly provider: ProviderName;
  readonly modelName: string;
  readonly routeKind?: InferenceRouteKind;
  readonly usageFormat?: LlmUsageFormat;
  readonly route?: InferenceRoute;
  generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse>;
  getProviderForRequest?(requestId: string): {
    provider: ProviderName;
    model: string;
    routeId?: InferenceRouteId;
    routeKind?: InferenceRouteKind;
  };
  getTrace?(requestId: string): ProviderTrace;
  finishRequest?(requestId: string): void;
}

export type ProviderTrace = {
  primaryProvider: ProviderName;
  fallbackProvider?: ProviderName;
  selectedProvider?: ProviderName;
  providersAttempted: ProviderName[];
  primaryRouteId?: InferenceRouteId;
  fallbackRouteId?: InferenceRouteId;
  selectedRouteId?: InferenceRouteId;
  routesAttempted?: InferenceRouteId[];
  fallbackOccurred: boolean;
  fallbackReason?: string;
  toolCallsExecutedBeforeFailure?: number;
  logicalLlmCalls?: number;
  httpAttempts?: number;
  httpAttemptsByProvider?: Partial<Record<ProviderName, number>>;
  httpAttemptsByRoute?: Partial<Record<InferenceRouteId, number>>;
  retryCount?: number;
  providerFallbackAttempts?: number;
  modelFallbackAttempts?: number;
  requestBytesByProvider?: Partial<Record<ProviderName, number>>;
  requestBytesByRoute?: Partial<Record<InferenceRouteId, number>>;
  maxRequestBytes?: number;
  systemPromptChars?: number;
  toolDefinitionsChars?: number;
  toolDefinitionsCount?: number;
  maxConversationChars?: number;
  cacheHit?: boolean;
  cacheMiss?: boolean;
  cachedTokens?: number;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { role?: string; parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
};

type GeminiCachedContentResponse = {
  name?: string;
};

type ToolResult = {
  ok: boolean;
  [key: string]: unknown;
};

const MAX_TOOL_CALLS = 8;
const MAX_LOGICAL_LLM_CALLS = 4;
const MAX_PROVIDER_HTTP_ATTEMPTS = 6;
const MAX_GROQ_HTTP_ATTEMPTS = 1;
const MODEL_REQUEST_DEADLINE_MS = 45_000;
const MAX_CIRCUIT_COOLDOWN_MS = 15 * 60_000;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3-flash-preview";
const parsedGeminiCacheTtlSeconds = Number.parseInt(
  process.env.GEMINI_CONTEXT_CACHE_TTL_SECONDS ?? "3600",
  10,
);
const GEMINI_CONTEXT_CACHE_TTL_SECONDS = Number.isFinite(parsedGeminiCacheTtlSeconds)
  && parsedGeminiCacheTtlSeconds > 0
  ? parsedGeminiCacheTtlSeconds
  : 3600;
const GEMINI_CONTEXT_CACHE_TTL_MS = GEMINI_CONTEXT_CACHE_TTL_SECONDS * 1000;
const GEMINI_CONTEXT_CACHE_EXPIRY_SAFETY_MS = 10_000;
const GEMINI_CONTEXT_CACHE_FAILURE_COOLDOWN_MS = 60_000;
const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-20b";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const COHERE_MODEL = process.env.COHERE_MODEL ?? "command-r-08-2024";
const COHERE_API_URL = "https://api.cohere.com/v2/chat";
const DEFAULT_TIMEZONE = "Africa/Cairo";

function timeoutForDeadline(deadlineAt: number | undefined, maximumMs: number): number {
  if (deadlineAt === undefined) return maximumMs;
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) {
    throw new SecretaryError("The model request deadline was exceeded.", {
      status: 504,
      category: "provider_unavailable",
      code: "MODEL_REQUEST_DEADLINE_EXCEEDED",
      retryable: false,
    });
  }
  return Math.min(maximumMs, remainingMs);
}

function deadlineExceeded(provider?: ProviderName): SecretaryError {
  return new SecretaryError("The model request deadline was exceeded.", {
    status: 504,
    category: "provider_unavailable",
    code: "MODEL_REQUEST_DEADLINE_EXCEEDED",
    retryable: false,
    ...(provider ? { provider } : {}),
  });
}
const WRITE_TOOLS = new Set([
  "create_person",
  "create_person_and_link_person_to_project",
  "create_financial_party",
  "create_financial_obligation",
  "create_financial_payment",
  "settle_financial_obligation",
  "create_donation",
  "create_income_receivable",
  "create_payment_link",
  "update_financial_obligation",
  "update_financial_payment",
  "update_donation",
  "update_income_receivable",
  "update_person",
  "create_project",
  "update_project",
  "link_person_to_project",
  "update_person_project_relationship",
  "create_typed_relationship",
  "delete_typed_relationship",
  "record_expense",
  "update_expense",
  "create_task",
  "create_agent_work",
  "create_commitment",
  "create_reminder",
  "update_task",
  "update_commitment",
  "update_reminder",
  "delete_person",
  "delete_project",
  "delete_expense",
  "delete_task",
  "delete_commitment",
  "delete_reminder",
]);

function normalize(value: string): string {
  return value
    .trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u064B-\u065F]/g, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ar");
}

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function identityWhere(identity: Identity, table: { tenantId: any; ownerUserId: any }) {
  return and(
    eq(table.tenantId, identity.tenantId),
    eq(table.ownerUserId, identity.userId),
  );
}

function expectedRowVersion(args: Record<string, unknown>): number | undefined {
  const value = Number(args.expectedRowVersion);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

async function enqueueCommitmentDeadlineTrigger(
  identity: Identity,
  commitment: typeof commitmentsTable.$inferSelect,
  executor: DbExecutor,
  writer: typeof enqueueTriggerOutbox,
): Promise<void> {
  if (!commitment.dueAt) return;
  await writer({
    identity,
    eventType: "commitment.deadline",
    aggregateType: "commitment",
    aggregateId: commitment.id,
    occurredAt: commitment.updatedAt,
    availableAt: commitment.dueAt,
    payload: {
      commitmentId: commitment.id,
      dueAt: commitment.dueAt.toISOString(),
      status: commitment.status,
      rowVersion: commitment.rowVersion,
    },
    dedupeKey: [
      "commitment-deadline:v1",
      identity.tenantId,
      identity.userId,
      commitment.id,
      `v${commitment.rowVersion}`,
    ].join(":"),
  }, executor);
}

async function enqueueTaskCountTransition(
  identity: Identity,
  taskId: string,
  previousValue: number,
  currentValue: number,
  mutationKey: string,
  occurredAt: Date,
  executor: DbExecutor,
  writer: typeof enqueueTriggerOutbox,
): Promise<void> {
  await enqueueTaskThresholdTriggersForMutation({
    identity,
    taskId,
    previousValue,
    currentValue,
    mutationKey,
    occurredAt,
    writer,
  }, executor);
}

async function lockTaskOpenCount(
  identity: Identity,
  executor: DbExecutor,
): Promise<void> {
  const lockKey = JSON.stringify([
    identity.tenantId,
    identity.userId,
    "tasks/open_task_count",
  ]);
  await executor.execute(sql`
    select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
  `);
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, current) =>
      typeof current === "bigint" ? Number(current) : current,
    ),
  );
}

type ExpenseCurrencyTotal = {
  currency: string;
  totalMinor: number;
  count: number;
};

const CURRENCY_MINOR_DIGITS: Record<string, number> = {
  AED: 2,
  BHD: 3,
  EGP: 2,
  EUR: 2,
  JPY: 0,
  KWD: 3,
  QAR: 2,
  SAR: 2,
  USD: 2,
};

export type ExpenseUnitAuditRecord = {
  id: string;
  description: string;
  occurredAt: string;
  currency: string;
  stored: {
    value: number;
    unit: "minor";
  };
  expected: {
    unit: "minor";
    minorPerMajor: number | null;
    displayValue: number | null;
  };
  status: "ok" | "review";
  reviewReasons: string[];
};

export type ExpenseUnitAuditReport = {
  expectedStoredUnit: "minor";
  scannedCount: number;
  reviewCount: number;
  truncated: boolean;
  records: ExpenseUnitAuditRecord[];
};

type ExpenseUnitAuditInput = {
  id: string;
  amountMinor: number;
  currency: string;
  description: string;
  occurredAt: Date | string;
};

/**
 * Historical expense rows do not carry a unit-version marker. This audit
 * reports the current contract without rewriting the row, and deliberately
 * treats uncertain values as a human-review queue rather than a correction.
 */
export function buildExpenseUnitAudit(
  rows: ExpenseUnitAuditInput[],
  maxRecords = 100,
): ExpenseUnitAuditReport {
  const safeLimit = Number.isSafeInteger(maxRecords) && maxRecords > 0
    ? Math.min(maxRecords, 200)
    : 100;
  const audited = rows.map((row) => {
    const currency = row.currency.trim().toUpperCase();
    const minorDigits = CURRENCY_MINOR_DIGITS[currency];
    const minorPerMajor = minorDigits === undefined ? null : 10 ** minorDigits;
    const reviewReasons: string[] = [];
    if (minorPerMajor === null) {
      reviewReasons.push("unknown_currency_scale");
    }
    if (!Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0) {
      reviewReasons.push("non_positive_or_invalid_amount");
    } else if (minorPerMajor !== null && row.amountMinor < minorPerMajor) {
      reviewReasons.push("below_one_major_currency_unit");
    }
    const status: ExpenseUnitAuditRecord["status"] = reviewReasons.length > 0 ? "review" : "ok";
    return {
      id: row.id,
      description: row.description,
      occurredAt: row.occurredAt instanceof Date
        ? row.occurredAt.toISOString()
        : row.occurredAt,
      currency,
      stored: {
        value: row.amountMinor,
        unit: "minor" as const,
      },
      expected: {
        unit: "minor" as const,
        minorPerMajor,
        displayValue: minorPerMajor === null ? null : row.amountMinor / minorPerMajor,
      },
      status,
      reviewReasons,
    };
  });
  return {
    expectedStoredUnit: "minor",
    scannedCount: audited.length,
    reviewCount: audited.filter((record) => record.status === "review").length,
    truncated: audited.length > safeLimit,
    records: audited.slice(0, safeLimit),
  };
}

type ExpenseSummary = {
  count: number;
  projectCount: number;
  currencyTotals?: ExpenseCurrencyTotal[];
  totalMinor?: number;
  currency?: string;
};

function expenseSummaryFromCurrencyTotals(
  currencyTotals: ExpenseCurrencyTotal[],
  projectCount = 0,
): ExpenseSummary {
  const summary: ExpenseSummary = {
    count: currencyTotals.reduce((count, item) => count + item.count, 0),
    projectCount,
  };
  if (currencyTotals.length === 1) {
    summary.totalMinor = currencyTotals[0].totalMinor;
    summary.currency = currencyTotals[0].currency;
  } else if (currencyTotals.length > 1) {
    summary.currencyTotals = currencyTotals;
  }
  return summary;
}

function expenseRowsSummary(rows: unknown[]): ExpenseSummary {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  const projects = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const outer = row as Record<string, unknown>;
    const expense = outer.expense && typeof outer.expense === "object"
      ? outer.expense as Record<string, unknown>
      : outer;
    const currency = typeof expense.currency === "string" ? expense.currency : "EGP";
    const amountMinor = typeof expense.amountMinor === "number" ? expense.amountMinor : 0;
    totals.set(currency, (totals.get(currency) ?? 0) + amountMinor);
    counts.set(currency, (counts.get(currency) ?? 0) + 1);
    const projectName = typeof outer.projectName === "string"
      ? outer.projectName
      : typeof expense.projectId === "string" ? expense.projectId : null;
    if (projectName) projects.add(projectName);
  }
  return expenseSummaryFromCurrencyTotals(
    [...totals.entries()].map(([currency, totalMinor]) => ({
      currency,
      totalMinor,
      count: counts.get(currency) ?? 0,
    })),
    projects.size,
  );
}

function broadExpenseReportResponse(
  result: ToolResult,
  period?: DeterministicExpensePeriod,
): FinalResponse {
  const summary: ExpenseSummary = result.summary && typeof result.summary === "object"
    ? result.summary as ExpenseSummary
    : { count: 0, projectCount: 0 };
  const count = typeof summary.count === "number" ? summary.count : 0;
  const currencyTotals = Array.isArray(summary.currencyTotals)
    ? summary.currencyTotals.filter((item): item is ExpenseCurrencyTotal =>
        !!item
        && typeof item === "object"
        && typeof item.currency === "string"
        && Number.isSafeInteger(item.totalMinor)
        && item.totalMinor >= 0
        && Number.isSafeInteger(item.count)
        && item.count >= 0,
      )
    : [];
  if (currencyTotals.length > 1) {
    const parts = currencyTotals.map((item) =>
      `${new Intl.NumberFormat("ar-EG", { style: "currency", currency: item.currency }).format(item.totalMinor / 100)} عبر ${item.count}`,
    );
    return {
      kind: "answer",
      message: `لا يمكن جمع المصروفات في إجمالي واحد لأنها مسجلة بأكثر من عملة: ${parts.join("، ")}. إجمالي عدد المصروفات ${count}.`,
      groundedFacts: [
        ...currencyTotals.map((item) => ({
          type: "money" as const,
          value: item.totalMinor,
          currency: item.currency,
          label: "إجمالي المصروفات",
        })),
        { type: "count", value: count, label: "عدد المصروفات" },
      ],
    };
  }
  const totalMinor = typeof summary.totalMinor === "number" ? summary.totalMinor : 0;
  const currency = typeof summary.currency === "string" ? summary.currency : "EGP";
  const amount = new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency,
  }).format(totalMinor / 100);
  const projectCount = typeof summary.projectCount === "number" ? summary.projectCount : 0;
  const periodLabel = period === "this_week"
    ? "مصروفات الأسبوع الحالي"
    : period === "last_week"
      ? "مصروفات الأسبوع السابق"
      : period === "this_month"
        ? "مصروفات الشهر الحالي"
        : period === "last_month"
          ? "مصروفات الشهر السابق"
          : "تقرير المصروفات";
  const message = count === 0
    ? period ? `لا توجد ${periodLabel.toLocaleLowerCase("ar")} محفوظة.` : "لا توجد مصروفات محفوظة حتى الآن."
    : `${periodLabel}: ${amount} عبر ${count} مصروف${projectCount > 0 ? ` موزعة على ${projectCount} مشروع` : ""}.`;
  return {
    kind: "answer",
    message,
    groundedFacts: [
      { type: "money", value: totalMinor, currency, label: "إجمالي المصروفات" },
      { type: "count", value: count, label: "عدد المصروفات" },
    ],
  };
}

function expenseUnitAuditResponse(audit: ExpenseUnitAuditReport): FinalResponse {
  const details = audit.records
    .filter((record) => record.status === "review")
    .slice(0, 8)
    .map((record) => {
      const stored = new Intl.NumberFormat("ar-EG").format(record.stored.value);
      const expected = record.expected.displayValue === null
        ? "غير معروف"
        : new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 3 }).format(record.expected.displayValue);
      return `${record.id}: المخزن ${stored} بوحدة صغرى، المتوقع عرضه ${expected} بالوحدة الرئيسية (${record.reviewReasons.join("، ")})`;
    });
  const truncatedMessage = audit.truncated ? " التقرير محدود بعدد من السجلات، فاطلب متابعة للفحص الكامل." : "";
  return {
    kind: "answer",
    message: `راجعت السجلات قبل حساب الإجمالي، ووجدت ${audit.reviewCount} سجل${audit.reviewCount === 1 ? "" : "ات"} تحتاج مراجعة بشرية. لم أعدّل أي سجل ولن أعرض إجماليًا قد يكون مضللًا.${details.length > 0 ? ` التفاصيل: ${details.join("؛ ")}` : ""}${truncatedMessage}`,
    groundedFacts: [
      { type: "count", value: audit.scannedCount, label: "السجلات المفحوصة" },
      { type: "count", value: audit.reviewCount, label: "السجلات التي تحتاج مراجعة" },
    ],
  };
}

type ToolHistoryEntry = { name: string; result: ToolResult };

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): ToolDefinition {
  return {
    name,
    description,
    parameters: {
      type: "OBJECT",
      properties,
      required,
    },
  };
}

export const phase2Tools: ToolDefinition[] = [
  tool(
    "final_response",
    "Finish the turn with a natural Arabic response. Use this after all required tools. Never invent financial values; include groundedFacts only for values returned by tools.",
    {
      kind: { type: "STRING", enum: ["answer", "clarification", "not_found", "error"] },
      message: { type: "STRING" },
      groundedFacts: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            type: { type: "STRING", enum: ["money", "count"] },
            value: { type: "INTEGER" },
            currency: { type: "STRING" },
            label: { type: "STRING" },
          },
          required: ["type", "value"],
        },
      },
    },
    ["kind", "message"],
  ),
  tool("find_person", "Find accessible people by name. Use this before linking a person to an expense or other record. A failed search does not mean the user asked to create the person.", {
    name: { type: "STRING", description: "The known person name" },
  }, ["name"]),
  tool("create_person", "Create a person only after an explicit request to add or create a person, and only after checking for matches. Do not use this just because a person name appears in a financial sentence such as 'دفعت لمحمد 7500'.", {
    name: { type: "STRING" },
    notes: { type: "STRING" },
    phone: { type: "STRING", description: "Optional phone number" },
  }, ["name"]),
  tool("update_person", "Update only known fields on an accessible person.", {
    personId: { type: "STRING" },
    name: { type: "STRING" },
    notes: { type: "STRING" },
    phone: { type: "STRING", description: "Optional phone number" },
    expectedRowVersion: { type: "INTEGER" },
  }, ["personId"]),
  tool("find_project", "Find accessible projects by name. Always call before using a project.", {
    name: { type: "STRING", description: "The known project name" },
  }, ["name"]),
  tool("create_project", "Create a project only when no suitable match exists.", {
    name: { type: "STRING" },
  }, ["name"]),
  tool("update_project", "Update an accessible project.", {
    projectId: { type: "STRING" },
    name: { type: "STRING" },
    status: { type: "STRING", enum: ["active", "archived"] },
    expectedRowVersion: { type: "INTEGER" },
  }, ["projectId"]),
  tool("link_person_to_project", "Link an accessible person and project with a known relationship.", {
    personId: { type: "STRING" },
    projectId: { type: "STRING" },
    relationship: { type: "STRING" },
  }, ["personId", "projectId"]),
  tool("update_person_project_relationship", "Update a saved person-project relationship.", {
    relationshipId: { type: "STRING" },
    relationship: { type: "STRING" },
  }, ["relationshipId", "relationship"]),
  tool("create_typed_relationship", "Create one tenant-scoped typed relationship between two accessible entities.", {
    relation: { type: "STRING", enum: ["project_people", "task_people", "task_projects", "task_purposes", "reminder_people", "reminder_projects", "reminder_tasks", "commitment_people", "commitment_projects", "commitment_purposes"] },
    leftId: { type: "STRING" },
    rightId: { type: "STRING" },
    relationship: { type: "STRING" },
  }, ["relation", "leftId", "rightId"]),
  tool("delete_typed_relationship", "Delete one exact tenant-scoped typed relationship.", {
    relation: { type: "STRING" },
    relationshipId: { type: "STRING" },
  }, ["relation", "relationshipId"]),
  tool("record_expense", "Record a financial transaction using integer minor units. Use this when the user says they paid, gave, received, or asks to record an amount, even if the word 'expense' is absent. Resolve a mentioned person first; the recipient person and project are optional, and use description for the purpose when no project is confirmed. Never use create_person merely because the recipient name is new or unresolved.", {
    amountMinor: { type: "INTEGER", description: "Money in minor units, e.g. 1150000 for 11500.00" },
    currency: { type: "STRING", description: "ISO currency code" },
    description: { type: "STRING" },
    personId: { type: ["STRING", "NULL"], description: "Optional recipient person ID after resolving a name" },
     projectId: { type: ["STRING", "NULL"], description: "Optional confirmed project ID" },
     purposeId: { type: ["STRING", "NULL"], description: "Optional saved purpose ID" },
    occurredAt: { type: "STRING", description: "ISO timestamp if explicitly known" },
  }, ["amountMinor", "description"]),
  tool("create_financial_party", "Create an explicit party for financial direction. Link it to an accessible person or project when provided.", {
    partyType: { type: "STRING", enum: ["person", "project", "organization", "external"] },
    name: { type: "STRING" },
    personId: { type: "STRING" },
    projectId: { type: "STRING" },
    purposeId: { type: "STRING" },
  }, ["partyType", "name"]),
  tool("create_financial_obligation", "Create an advance or debt with explicit lender and borrower party IDs.", {
    kind: { type: "STRING", enum: ["advance", "debt"] },
    title: { type: "STRING" },
    lenderPartyId: { type: "STRING" },
    borrowerPartyId: { type: "STRING" },
    principalAmountMinor: { type: "INTEGER" },
    currency: { type: "STRING" },
    purposeId: { type: "STRING" },
    projectId: { type: "STRING" },
    dueAt: { type: "STRING" },
  }, ["kind", "title", "lenderPartyId", "borrowerPartyId", "principalAmountMinor", "currency"]),
  tool("create_financial_payment", "Record an actual payment with explicit payer and payee party IDs.", {
    payerPartyId: { type: "STRING" },
    payeePartyId: { type: "STRING" },
    amountMinor: { type: "INTEGER" },
    currency: { type: "STRING" },
    paymentKind: { type: "STRING" },
    description: { type: "STRING" },
    occurredAt: { type: "STRING" },
  }, ["payerPartyId", "payeePartyId", "amountMinor", "currency"]),
  tool("settle_financial_obligation", "Apply part or all of an actual payment to an obligation. Multiple settlements are allowed.", {
    obligationId: { type: "STRING" },
    paymentId: { type: "STRING" },
    amountMinor: { type: "INTEGER" },
    settledAt: { type: "STRING" },
  }, ["obligationId", "paymentId", "amountMinor"]),
  tool("create_donation", "Create a donation pledge or paid donation. A pledge is not a receivable.", {
    donorPartyId: { type: "STRING" },
    recipientPartyId: { type: "STRING" },
    amountMinor: { type: "INTEGER" },
    currency: { type: "STRING" },
    purposeId: { type: "STRING" },
    projectId: { type: "STRING" },
    description: { type: "STRING" },
    status: { type: "STRING", enum: ["pledged", "paid", "cancelled"] },
    pledgedAt: { type: "STRING" },
    paidAt: { type: "STRING" },
  }, ["donorPartyId", "recipientPartyId", "amountMinor", "currency"]),
  tool("create_income_receivable", "Create expected income or a receivable. This is separate from a collected payment.", {
    kind: { type: "STRING", enum: ["income", "receivable"] },
    title: { type: "STRING" },
    creditorPartyId: { type: "STRING" },
    debtorPartyId: { type: "STRING" },
    amountMinor: { type: "INTEGER" },
    currency: { type: "STRING" },
    purposeId: { type: "STRING" },
    projectId: { type: "STRING" },
    dueAt: { type: "STRING" },
  }, ["kind", "title", "creditorPartyId", "debtorPartyId", "amountMinor", "currency"]),
  tool("create_payment_link", "Create a link targeting exactly one payment, receivable, or donation.", {
    token: { type: "STRING" },
    paymentId: { type: "STRING" },
    receivableId: { type: "STRING" },
    donationId: { type: "STRING" },
    provider: { type: "STRING" },
    expiresAt: { type: "STRING" },
  }, ["token"]),
  tool("update_financial_obligation", "Correct an advance or debt without creating a second obligation.", {
    obligationId: { type: "STRING" },
    title: { type: "STRING" },
    status: { type: "STRING", enum: ["open", "settled", "cancelled"] },
    dueAt: { type: "STRING" },
    expectedRowVersion: { type: "INTEGER" },
  }, ["obligationId"]),
  tool("update_financial_payment", "Correct an actual payment without creating a second payment.", {
    paymentId: { type: "STRING" },
    amountMinor: { type: "INTEGER" },
    currency: { type: "STRING" },
    description: { type: "STRING" },
    occurredAt: { type: "STRING" },
    expectedRowVersion: { type: "INTEGER" },
  }, ["paymentId"]),
  tool("update_donation", "Correct a donation pledge or payment.", {
    donationId: { type: "STRING" },
    amountMinor: { type: "INTEGER" },
    status: { type: "STRING", enum: ["pledged", "paid", "cancelled"] },
    description: { type: "STRING" },
    expectedRowVersion: { type: "INTEGER" },
  }, ["donationId"]),
  tool("update_income_receivable", "Correct expected income or a receivable.", {
    receivableId: { type: "STRING" },
    title: { type: "STRING" },
    amountMinor: { type: "INTEGER" },
    status: { type: "STRING", enum: ["open", "settled", "cancelled"] },
    expectedRowVersion: { type: "INTEGER" },
  }, ["receivableId"]),
  tool("update_expense", "Correct an existing saved expense; never create a second expense for a correction.", {
    expenseId: { type: "STRING" },
    amountMinor: { type: "INTEGER" },
    currency: { type: "STRING" },
    description: { type: "STRING" },
    personId: { type: "STRING" },
    projectId: { type: "STRING" },
     purposeId: { type: ["STRING", "NULL"] },
    occurredAt: { type: "STRING", description: "Optional ISO timestamp" },
    expectedRowVersion: { type: "INTEGER" },
  }, ["expenseId", "amountMinor"]),
  tool("query_expenses", "Query saved expenses for a person or project.", {
    personId: { type: "STRING" },
    projectId: { type: "STRING" },
    excludeProjectId: { type: "STRING", description: "Exclude this resolved project from the result" },
    description: { type: "STRING", description: "Optional description/category text to search" },
    period: {
      type: "STRING",
      enum: ["last_month", "this_month", "last_week", "this_week"],
      description: "Use for a relative time phrase; the server resolves the exact Cairo date range",
    },
    fromDate: { type: "STRING", description: "Optional inclusive ISO date/time lower bound" },
    toDate: { type: "STRING", description: "Optional exclusive ISO date/time upper bound" },
    limit: { type: "INTEGER" },
  }),
  tool("audit_expense_units", "Read historical expenses before showing totals. Report each stored amountMinor value as minor currency units, the expected conversion to the major unit, and any row that needs human review. Never change or correct records.", {
    limit: { type: "INTEGER", description: "Maximum number of detailed rows to return, capped by the server" },
  }),
  tool("rank_expense_projects", "Rank saved project spending using database totals. Use for questions asking which project spent the most.", {
    period: {
      type: "STRING",
      enum: ["last_month", "this_month", "last_week", "this_week"],
      description: "Use for a relative time phrase; the server resolves the exact Cairo date range",
    },
    fromDate: { type: "STRING", description: "Optional inclusive ISO date/time lower bound" },
    toDate: { type: "STRING", description: "Optional exclusive ISO date/time upper bound" },
    excludeProjectId: { type: "STRING", description: "Exclude this resolved project from the ranking" },
  }),
  tool("get_person_expense_total", "Get the total saved expense amount for one resolved person.", {
    personId: { type: "STRING" },
  }, ["personId"]),
  tool("get_project_expense_total", "Get the total saved expense amount for one resolved project.", {
    projectId: { type: "STRING" },
  }, ["projectId"]),
  tool("create_task", "Create a low-risk personal task.", {
    title: { type: "STRING" },
    dueAt: { type: "STRING" },
  }, ["title"]),
  tool("create_agent_work", "Create Agent Work only after the user clearly asks for ongoing work or a one-time external action. An external action's setup approval only saves the Work; a separate approval is required before contacting its provider. Do not invent external access or actions.", {
    kind: {
      type: "STRING",
      enum: ["monitor", "reminder", "recurring_task", "external_action", "research", "workflow"],
    },
    title: { type: "STRING" },
    description: { type: "STRING" },
    sourceType: {
      type: "STRING",
      enum: [
        "clock",
        "heartbeat",
        "internal_records",
        "github_repository",
        ...registeredExternalActionProviders().map((provider) => provider.provider),
        "user_defined",
      ],
      description: `Use only registered external action providers and provide their declared action fields. ${externalActionToolGuidance()}`,
    },
    condition: { type: "OBJECT" },
    action: {
      type: "OBJECT",
      description: `External provider actions are one-time external_action Work and require a second approval before provider contact. ${externalActionToolGuidance()}`,
    },
    schedule: { type: "OBJECT" },
    nextRunAt: { type: "STRING", description: "Optional ISO timestamp for the first run." },
  }, ["kind", "title"]),
  tool("create_commitment", "Create a personal commitment with optional person and due date.", {
    title: { type: "STRING" },
    personId: { type: "STRING" },
    dueAt: { type: "STRING" },
  }, ["title"]),
  tool("create_reminder", "Create a personal reminder.", {
    text: { type: "STRING" },
    dueAt: { type: "STRING" },
    timezone: { type: "STRING" },
  }, ["text", "dueAt"]),
  tool("update_task", "Update an accessible task by exact ID.", {
    taskId: { type: "STRING" },
    title: { type: "STRING" },
    dueAt: { type: ["STRING", "NULL"] },
    status: { type: "STRING", enum: ["pending", "in_progress", "completed", "cancelled"] },
    expectedRowVersion: { type: "INTEGER" },
  }, ["taskId"]),
  tool("update_commitment", "Update an accessible commitment by exact ID.", {
    commitmentId: { type: "STRING" },
    title: { type: "STRING" },
    personId: { type: ["STRING", "NULL"] },
    dueAt: { type: ["STRING", "NULL"] },
    status: { type: "STRING", enum: ["open", "completed", "cancelled"] },
    expectedRowVersion: { type: "INTEGER" },
  }, ["commitmentId"]),
  tool("update_reminder", "Update an accessible reminder by exact ID.", {
    reminderId: { type: "STRING" },
    text: { type: "STRING" },
    dueAt: { type: "STRING" },
    timezone: { type: "STRING" },
    status: { type: "STRING", enum: ["scheduled", "completed", "cancelled"] },
    expectedRowVersion: { type: "INTEGER" },
  }, ["reminderId"]),
  tool("delete_expense", "Delete one expense only by an exact resolved expenseId. Never guess or choose between similar expenses.", {
    expenseId: { type: "STRING" },
    expectedCreatedAt: { type: "STRING", description: "Only supplied by a safe undo of a just-created record." },
  }, ["expenseId"]),
  tool("delete_person", "Delete one person only by exact personId when no saved records depend on it. Never guess.", {
    personId: { type: "STRING" },
    expectedCreatedAt: { type: "STRING", description: "Only supplied by a safe undo of a just-created record." },
  }, ["personId"]),
  tool("delete_project", "Delete one project only by exact projectId when no saved records depend on it. Never guess.", {
    projectId: { type: "STRING" },
    expectedCreatedAt: { type: "STRING", description: "Only supplied by a safe undo of a just-created record." },
  }, ["projectId"]),
  tool("delete_task", "Delete one task only by exact taskId. Never guess.", {
    taskId: { type: "STRING" },
    expectedCreatedAt: { type: "STRING", description: "Only supplied by a safe undo of a just-created record." },
  }, ["taskId"]),
  tool("delete_commitment", "Delete one commitment only by exact commitmentId. Never guess.", {
    commitmentId: { type: "STRING" },
    expectedCreatedAt: { type: "STRING", description: "Only supplied by a safe undo of a just-created record." },
  }, ["commitmentId"]),
  tool("delete_reminder", "Delete one reminder only by exact reminderId. Never guess.", {
    reminderId: { type: "STRING" },
    expectedCreatedAt: { type: "STRING", description: "Only supplied by a safe undo of a just-created record." },
  }, ["reminderId"]),
  tool("query_reminders", "Query saved reminders.", {
    status: { type: "STRING", enum: ["scheduled", "completed", "cancelled"] },
  }),
  tool("recall_context", "Read the canonical saved Today context.", {}),
];

const READ_ONLY_TOOL_NAMES = new Set([
  "final_response",
  "find_person",
  "find_project",
  "query_expenses",
  "audit_expense_units",
  "rank_expense_projects",
  "get_person_expense_total",
  "get_project_expense_total",
  "query_reminders",
  "recall_context",
]);

const TOOL_SCOPE_NAMES: Record<Exclude<ToolScope["name"], "full" | "read_only">, ReadonlySet<string>> = {
  expense: new Set([
    ...READ_ONLY_TOOL_NAMES,
    "record_expense",
    "update_expense",
    "delete_expense",
  ]),
  reminder: new Set([
    "final_response",
    "query_reminders",
    "recall_context",
    "create_reminder",
    "update_reminder",
    "delete_reminder",
  ]),
  person: new Set([
    "final_response",
    "find_person",
    "recall_context",
    "create_person",
    "update_person",
    "delete_person",
  ]),
  project: new Set([
    "final_response",
    "find_project",
    "recall_context",
    "create_project",
    "update_project",
    "delete_project",
  ]),
  task: new Set([
    "final_response",
    "recall_context",
    "create_task",
    "update_task",
    "delete_task",
  ]),
  commitment: new Set([
    "final_response",
    "recall_context",
    "create_commitment",
    "update_commitment",
    "delete_commitment",
  ]),
};

const TOOL_SCOPE_PATTERNS: Record<Exclude<ToolScope["name"], "full" | "read_only">, RegExp> = {
  expense: /جنيه|دولار|ريال|مصروف|مصاريف|مبلغ|دفعت|دفع|صرف|فلوس|اخد مني|أخذ مني|اديت|أديت|سجل.*مصروف|expense|spent|paid|money/i,
  reminder: /فكرني|ذكرني|تذكير|تذكّر|موعد|بكره|بكرة|غدا|غدًا|remind|reminder/i,
  person: /شخص|شخصًا|الاسم|بيانات.*شخص|اضف.*شخص|أضف.*شخص|ضيف.*شخص|person|contact/i,
  project: /مشروع|project/i,
  task: /مهم(?:ة|ه)|task|todo/i,
  commitment: /التزام|commitment/i,
};

const WRITE_INTENT_PATTERN = /سجل|سجّل|دفعت|دفع|صرف|اديت|أديت|أضف|اضف|ضيف|أنشئ|انشئ|اعمل|عدّل|عدل|غيّر|غير|احذف|امسح|فكرني|ذكرني|create|add|record|update|edit|change|delete|remove|remind/i;
const READ_INTENT_PATTERN = /إيه|ايه|ما|ماذا|كم|كام|اعرض|أعرض|وريني|هات|عندي|إجمالي|اجمالي|تقرير|قائمة|استعرض|هل يوجد|what|show|list|how much|do i have|total/i;
const AMOUNT_PATTERN = /(?:[0-9٠-٩]|جنيه|دولار|ريال)/i;

function fullToolScope(): ToolScope {
  return {
    name: "full",
    allowedToolNames: new Set(phase2Tools.map((definition) => definition.name)),
    isFull: true,
  };
}

function namedToolScope(name: Exclude<ToolScope["name"], "full">): ToolScope {
  const allowedToolNames = name === "read_only" ? READ_ONLY_TOOL_NAMES : TOOL_SCOPE_NAMES[name];
  return {
    name,
    allowedToolNames,
    isFull: false,
  };
}

export function classifyToolScope(message: string): ToolScope {
  const matchedDomains = (Object.keys(TOOL_SCOPE_PATTERNS) as Array<Exclude<ToolScope["name"], "full" | "read_only">>)
    .filter((domain) => TOOL_SCOPE_PATTERNS[domain].test(message));
  const isReadIntent = READ_INTENT_PATTERN.test(message) && !WRITE_INTENT_PATTERN.test(message);
  const isHistoricalRead = envFlag("BENCHMARK_NARROW_TOOL_SCOPE", false)
    && /(?:آخر|اخر|سجلنا|سجلت|المحفوظ|المحفوظة)/i.test(message)
    && /(?:سجلنا|سجلت|المحفوظ|المحفوظة)/i.test(message)
    && !/(?:سجل|سجّل)\s+(?:إني|اني|ان|لي|لنا)/i.test(message);
  if (isHistoricalRead) return namedToolScope("read_only");
  if (isReadIntent) return namedToolScope("read_only");

  const isLikelyWrite = WRITE_INTENT_PATTERN.test(message)
    || (matchedDomains.includes("expense") && AMOUNT_PATTERN.test(message));
  if (isLikelyWrite && matchedDomains.length === 1) {
    return namedToolScope(matchedDomains[0]);
  }
  return fullToolScope();
}

function scopedToolDefinitions(
  scope: ToolScope | undefined,
  finalResponseOnly = false,
): ToolDefinition[] {
  let definitions: ToolDefinition[];
  if (finalResponseOnly) {
    definitions = phase2Tools.filter((definition) => definition.name === "final_response");
  } else if (!scope || scope.isFull) {
    definitions = phase2Tools;
  } else {
    definitions = phase2Tools.filter((definition) => scope.allowedToolNames.has(definition.name));
  }
  if (!featureFlags.contextBudgeter()) return definitions;
  return budgetContext([], definitions).tools as ToolDefinition[];
}

function budgetMessages(messages: ConversationMessage[]): ConversationMessage[] {
  if (!featureFlags.contextBudgeter()) return messages;
  return budgetContext(messages, []).messages as ConversationMessage[];
}

async function findPeople(identity: Identity, name: string): Promise<Person[]> {
  const exact = escapeLikePattern(normalize(name));
  const rows = await db
    .select()
    .from(peopleTable)
    .where(
      and(
        identityWhere(identity, peopleTable),
        ilike(peopleTable.nameKey, `%${exact}%`),
      ),
    )
    .orderBy(asc(peopleTable.createdAt))
    .limit(10);
  return rows;
}

async function findProjects(identity: Identity, name: string): Promise<Project[]> {
  const exact = escapeLikePattern(normalize(name));
  return db
    .select()
    .from(projectsTable)
    .where(
      and(
        identityWhere(identity, projectsTable),
        ilike(projectsTable.nameKey, `%${exact}%`),
      ),
    )
    .orderBy(asc(projectsTable.createdAt))
    .limit(10);
}

async function listApprovalCandidates(identity: Identity) {
  const [people, projects] = await Promise.all([
    db.select({ id: peopleTable.id, name: peopleTable.name })
      .from(peopleTable)
      .where(identityWhere(identity, peopleTable))
      .orderBy(asc(peopleTable.name)),
    db.select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(identityWhere(identity, projectsTable))
      .orderBy(asc(projectsTable.name)),
  ]);
  return {
    personCandidates: people,
    projectCandidates: projects,
  };
}

type CairoDateParts = { year: number; month: number; day: number };

function cairoDateParts(date: Date): CairoDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

type ScheduleItem = {
  kind: "reminder" | "task";
  id: string;
  title: string;
  dueAt: Date | null;
  status: string;
};

type ScheduleQuery = {
  dayOffset?: 0 | 1;
  searchTokens: string[];
};

const SCHEDULE_STOP_WORDS = new Set([
  "عندنا",
  "ايه",
  "اي",
  "ماذا",
  "متى",
  "امتى",
  "امته",
  "ميعاد",
  "ميعادها",
  "موعد",
  "مواعيد",
  "تذكير",
  "تذكيرات",
  "مهمه",
  "مهام",
  "النهارده",
  "اليوم",
  "بكره",
  "غدا",
  "فيه",
  "في",
  "هو",
  "هي",
  "ام",
  "هل",
  "reminder",
  "task",
]);

function scheduleToken(value: string): string {
  return normalize(value).replace(/^ال(?=\S)/, "");
}

export function isDeterministicScheduleQuestion(message: string): boolean {
  const normalized = normalize(message);
  if (WRITE_INTENT_PATTERN.test(message)) return false;
  const hasScheduleTerm = /موعد|مواعيد|ميعاد|تذكير|مهمه|مهام|دعوه|فرح|reminder|task/i.test(normalized);
  const hasQuestionContext = /عندنا|فيه|النهارده|اليوم|بكره|غدا|امتى|امته|متى|ماذا|ايه|هل|\?/i.test(normalized);
  return hasScheduleTerm && hasQuestionContext;
}

function scheduleQuery(message: string): ScheduleQuery | null {
  if (!isDeterministicScheduleQuestion(message)) return null;
  const normalized = normalize(message);
  const dayOffset = /بكره|غدا|غدا/i.test(normalized)
    ? 1 as const
    : /النهارده|اليوم/i.test(normalized)
      ? 0 as const
      : undefined;
  const searchTokens = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .map(scheduleToken)
    .filter((token) => token.length > 1 && !SCHEDULE_STOP_WORDS.has(token));
  return { dayOffset, searchTokens };
}

function sameCairoDay(value: Date | null, target: CairoDateParts): boolean {
  if (!value) return false;
  const parts = cairoDateParts(value);
  return parts.year === target.year && parts.month === target.month && parts.day === target.day;
}

function formatScheduleDueAt(value: Date | null, dayOffset?: 0 | 1): string {
  if (!value) return "من غير موعد محدد";
  const options: Intl.DateTimeFormatOptions = dayOffset === undefined
    ? { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }
    : { hour: "numeric", minute: "2-digit" };
  return new Intl.DateTimeFormat("ar-EG", {
    ...options,
    timeZone: DEFAULT_TIMEZONE,
  }).format(value);
}

function scheduleItemText(item: ScheduleItem, dayOffset?: 0 | 1): string {
  const prefix = item.kind === "task" ? "مهمة" : "تذكير";
  return `${prefix}: ${item.title} — ${formatScheduleDueAt(item.dueAt, dayOffset)}`;
}

async function deterministicScheduleResponse(
  identity: Identity,
  message: string,
): Promise<{ response: FinalResponse; action: Record<string, unknown> } | null> {
  const query = scheduleQuery(message);
  if (!query) return null;

  const [reminders, tasks] = await Promise.all([
    db.select({
      id: remindersTable.id,
      title: remindersTable.text,
      dueAt: remindersTable.dueAt,
      status: remindersTable.status,
    }).from(remindersTable)
      .where(and(
        identityWhere(identity, remindersTable),
        eq(remindersTable.status, "scheduled"),
      ))
      .orderBy(asc(remindersTable.dueAt))
      .limit(50),
    db.select({
      id: tasksTable.id,
      title: tasksTable.title,
      dueAt: tasksTable.dueAt,
      status: tasksTable.status,
    }).from(tasksTable)
      .where(and(
        identityWhere(identity, tasksTable),
        inArray(tasksTable.status, ["pending", "in_progress"]),
      ))
      .orderBy(asc(tasksTable.dueAt))
      .limit(50),
  ]);

  const items: ScheduleItem[] = [
    ...reminders.map((item) => ({ ...item, kind: "reminder" as const })),
    ...tasks.map((item) => ({ ...item, kind: "task" as const })),
  ].sort((left, right) => {
    if (!left.dueAt) return 1;
    if (!right.dueAt) return -1;
    return left.dueAt.getTime() - right.dueAt.getTime();
  });

  const today = cairoDateParts(new Date());
  const targetDay = query.dayOffset === undefined
    ? undefined
    : shiftLocalDate(today, query.dayOffset);
  const requiredTokenMatches = query.searchTokens.length > 1 ? 2 : 1;
  const matchingItems = items.filter((item) => {
    if (targetDay && !sameCairoDay(item.dueAt, targetDay)) return false;
    if (query.searchTokens.length === 0) return true;
    const haystack = scheduleToken(item.title);
    const matches = query.searchTokens.filter((token) => haystack.includes(token)).length;
    return matches >= requiredTokenMatches;
  }).slice(0, 8);

  const dayLabel = query.dayOffset === 0 ? "النهارده" : query.dayOffset === 1 ? "بكرة" : null;
  const action = {
    type: "schedule_context",
    day: dayLabel,
    count: matchingItems.length,
    items: matchingItems.map((item) => ({
      kind: item.kind,
      id: item.id,
      title: item.title,
      dueAt: item.dueAt?.toISOString() ?? null,
      status: item.status,
    })),
  };

  if (matchingItems.length === 0) {
    const target = dayLabel ? `${dayLabel}` : "المحفوظة";
    return {
      response: {
        kind: "not_found",
        message: query.searchTokens.length > 0
          ? `مش لاقي تذكير أو مهمة باسم قريب من "${query.searchTokens.join(" ")}" في بياناتك ${dayLabel ? `ليوم ${dayLabel}` : "الحالية"}.`
          : `مفيش تذكيرات أو مهام ${target}.`,
      },
      action,
    };
  }

  const heading = query.searchTokens.length > 0
    ? `لقيت لك ${matchingItems.length === 1 ? "ده" : `${matchingItems.length} نتائج`}:`
    : dayLabel
      ? `عندك ${matchingItems.length} ${matchingItems.length === 1 ? "حاجة" : "حاجات"} ${dayLabel}:`
      : `عندك ${matchingItems.length} تذكير أو مهمة محفوظة:`;
  return {
    response: {
      kind: "answer",
      message: `${heading}\n${matchingItems.map((item) => `• ${scheduleItemText(item, query.dayOffset)}`).join("\n")}`,
    },
    action,
  };
}

function cairoOffsetAt(utcGuess: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  ) - utcGuess;
}

function cairoMidnight(parts: CairoDateParts): Date {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day);
  return new Date(utcGuess - cairoOffsetAt(utcGuess));
}

function shiftLocalDate(parts: CairoDateParts, days: number): CairoDateParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function parseIsoBound(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function expenseDateRange(args: Record<string, unknown>): { from?: Date; to?: Date } {
  const explicitFrom = parseIsoBound(args.fromDate);
  const explicitTo = parseIsoBound(args.toDate);
  if (explicitFrom || explicitTo) return { from: explicitFrom, to: explicitTo };

  const period = typeof args.period === "string" ? args.period : undefined;
  if (!period) return {};

  const now = cairoDateParts(new Date());
  const today = new Date(Date.UTC(now.year, now.month - 1, now.day));
  const currentMonthStart = { year: now.year, month: now.month, day: 1 };
  const nextMonthStart = new Date(Date.UTC(now.year, now.month, 1));
  const currentWeekStart = shiftLocalDate(now, -((today.getUTCDay() + 6) % 7));

  switch (period) {
    case "last_month": {
      const fromParts = {
        year: now.month === 1 ? now.year - 1 : now.year,
        month: now.month === 1 ? 12 : now.month - 1,
        day: 1,
      };
      return { from: cairoMidnight(fromParts), to: cairoMidnight(currentMonthStart) };
    }
    case "this_month":
      return { from: cairoMidnight(currentMonthStart), to: cairoMidnight({
        year: new Date(nextMonthStart).getUTCFullYear(),
        month: new Date(nextMonthStart).getUTCMonth() + 1,
        day: 1,
      }) };
    case "last_week": {
      const fromParts = shiftLocalDate(currentWeekStart, -7);
      return { from: cairoMidnight(fromParts), to: cairoMidnight(currentWeekStart) };
    }
    case "this_week":
      return { from: cairoMidnight(currentWeekStart), to: cairoMidnight(shiftLocalDate(currentWeekStart, 7)) };
    default:
      return {};
  }
}

type MutationVerification = {
  state: "verified" | "failed" | "unknown";
  checks: string[];
  entityId?: string;
  reason?: string;
};

export type MutationVerificationResolver = (
  identity: Identity,
  toolName: string,
  result: ToolResult,
  executor: DbExecutor,
) => Promise<MutationVerification>;

async function verifyMutationResult(
  identity: Identity,
  toolName: string,
  result: ToolResult,
  executor: DbExecutor,
): Promise<MutationVerification> {
  if (!result.ok || !WRITE_TOOLS.has(toolName)) {
    return { state: "unknown", checks: [] };
  }

  const resourceByTool: Record<string, {
    key: string;
    table: typeof expensesTable | typeof remindersTable | typeof peopleTable | typeof projectsTable | typeof tasksTable | typeof commitmentsTable;
  }> = {
    record_expense: { key: "expense", table: expensesTable },
    update_expense: { key: "expense", table: expensesTable },
    delete_expense: { key: "expense", table: expensesTable },
    create_reminder: { key: "reminder", table: remindersTable },
    update_reminder: { key: "reminder", table: remindersTable },
    delete_reminder: { key: "reminder", table: remindersTable },
    create_person: { key: "person", table: peopleTable },
    update_person: { key: "person", table: peopleTable },
    delete_person: { key: "person", table: peopleTable },
    create_project: { key: "project", table: projectsTable },
    update_project: { key: "project", table: projectsTable },
    delete_project: { key: "project", table: projectsTable },
    create_task: { key: "task", table: tasksTable },
    update_task: { key: "task", table: tasksTable },
    delete_task: { key: "task", table: tasksTable },
    create_commitment: { key: "commitment", table: commitmentsTable },
    update_commitment: { key: "commitment", table: commitmentsTable },
    delete_commitment: { key: "commitment", table: commitmentsTable },
  };
  const resource = resourceByTool[toolName];
  const payload = resource
    ? result[resource.key]
      ?? result[`deleted${resource.key.slice(0, 1).toUpperCase()}${resource.key.slice(1)}`]
    : undefined;
  const entityId = payload && typeof payload === "object" && !Array.isArray(payload)
    && typeof (payload as Record<string, unknown>).id === "string"
    ? (payload as Record<string, unknown>).id as string
    : undefined;

  if (!resource || !entityId) {
    const returnedEntity = Object.values(result).find((value) =>
      value && typeof value === "object" && !Array.isArray(value)
      && typeof (value as Record<string, unknown>).id === "string",
    ) as Record<string, unknown> | undefined;
    if (returnedEntity || result.deleted === true) {
      return {
        state: "verified",
        checks: ["authoritative_write_result"],
        ...(typeof returnedEntity?.id === "string" ? { entityId: returnedEntity.id } : {}),
      };
    }
    return {
      state: "failed",
      checks: ["authoritative_write_result"],
      reason: "write_result_has_no_authoritative_entity",
    };
  }

  let row: { id: string } | undefined;
  switch (toolName) {
    case "record_expense":
    case "update_expense":
    case "delete_expense":
      [row] = await executor.select({ id: expensesTable.id }).from(expensesTable)
        .where(and(identityWhere(identity, expensesTable), eq(expensesTable.id, entityId))).limit(1);
      break;
    case "create_reminder":
    case "update_reminder":
    case "delete_reminder":
      [row] = await executor.select({ id: remindersTable.id }).from(remindersTable)
        .where(and(identityWhere(identity, remindersTable), eq(remindersTable.id, entityId))).limit(1);
      break;
    case "create_person":
    case "update_person":
    case "delete_person":
      [row] = await executor.select({ id: peopleTable.id }).from(peopleTable)
        .where(and(identityWhere(identity, peopleTable), eq(peopleTable.id, entityId))).limit(1);
      break;
    case "create_project":
    case "update_project":
    case "delete_project":
      [row] = await executor.select({ id: projectsTable.id }).from(projectsTable)
        .where(and(identityWhere(identity, projectsTable), eq(projectsTable.id, entityId))).limit(1);
      break;
    case "create_task":
    case "update_task":
    case "delete_task":
      [row] = await executor.select({ id: tasksTable.id }).from(tasksTable)
        .where(and(identityWhere(identity, tasksTable), eq(tasksTable.id, entityId))).limit(1);
      break;
    case "create_commitment":
    case "update_commitment":
    case "delete_commitment":
      [row] = await executor.select({ id: commitmentsTable.id }).from(commitmentsTable)
        .where(and(identityWhere(identity, commitmentsTable), eq(commitmentsTable.id, entityId))).limit(1);
      break;
  }
  if (!row && !toolName.startsWith("delete_")) {
    return {
      state: "failed",
      checks: ["authoritative_write_result", "post_mutation_read"],
      entityId,
      reason: "post_mutation_read_did_not_find_entity",
    };
  }
  return {
    state: toolName.startsWith("delete_")
      ? row ? "failed" : "verified"
      : row ? "verified" : "failed",
    checks: ["authoritative_write_result", "post_mutation_read"],
    entityId,
    ...(toolName.startsWith("delete_") && row
      ? { reason: "deleted_entity_still_exists" }
      : {}),
  };
}

async function captureExpectedRowVersion(
  identity: Identity,
  toolName: string,
  args: Record<string, unknown>,
  executor: DbExecutor,
): Promise<Record<string, unknown>> {
  if (!toolName.startsWith("update_") || args.expectedRowVersion !== undefined) return args;
  const resourceByTool: Record<string, {
    key: string;
    table: typeof expensesTable | typeof remindersTable | typeof peopleTable | typeof projectsTable | typeof tasksTable | typeof commitmentsTable;
  }> = {
    update_expense: { key: "expenseId", table: expensesTable },
    update_reminder: { key: "reminderId", table: remindersTable },
    update_person: { key: "personId", table: peopleTable },
    update_project: { key: "projectId", table: projectsTable },
    update_task: { key: "taskId", table: tasksTable },
    update_commitment: { key: "commitmentId", table: commitmentsTable },
  };
  const resource = resourceByTool[toolName];
  const idValue = resource ? args[resource.key] : undefined;
  const id = typeof idValue === "string" ? idValue : undefined;
  if (!resource || !id) return args;
  let row: { rowVersion: number } | undefined;
  switch (toolName) {
    case "update_expense":
      [row] = await executor.select({ rowVersion: expensesTable.rowVersion }).from(expensesTable)
        .where(and(identityWhere(identity, expensesTable), eq(expensesTable.id, id))).limit(1);
      break;
    case "update_reminder":
      [row] = await executor.select({ rowVersion: remindersTable.rowVersion }).from(remindersTable)
        .where(and(identityWhere(identity, remindersTable), eq(remindersTable.id, id))).limit(1);
      break;
    case "update_person":
      [row] = await executor.select({ rowVersion: peopleTable.rowVersion }).from(peopleTable)
        .where(and(identityWhere(identity, peopleTable), eq(peopleTable.id, id))).limit(1);
      break;
    case "update_project":
      [row] = await executor.select({ rowVersion: projectsTable.rowVersion }).from(projectsTable)
        .where(and(identityWhere(identity, projectsTable), eq(projectsTable.id, id))).limit(1);
      break;
    case "update_task":
      [row] = await executor.select({ rowVersion: tasksTable.rowVersion }).from(tasksTable)
        .where(and(identityWhere(identity, tasksTable), eq(tasksTable.id, id))).limit(1);
      break;
    case "update_commitment":
      [row] = await executor.select({ rowVersion: commitmentsTable.rowVersion }).from(commitmentsTable)
        .where(and(identityWhere(identity, commitmentsTable), eq(commitmentsTable.id, id))).limit(1);
      break;
  }
  return row ? { ...args, expectedRowVersion: row.rowVersion } : args;
}

async function executeTool(
  identity: Identity,
  name: string,
  rawArgs: Record<string, unknown>,
  options: {
    requestId: string;
    callId?: string;
    dryRun?: boolean;
    conversationId?: string | null;
    sourceTurnId?: string | null;
    idempotencyKey?: string | null;
    channel?: TurnInputChannel;
    approvedOperationId?: string;
    transactionExecutor?: DbExecutor;
    activityWriter?: typeof recordToolActivity;
    verificationResolver?: MutationVerificationResolver;
    operationCompletion?: (result: ToolResult, executor: DbExecutor) => Promise<void>;
    triggerOutboxWriter?: typeof enqueueTriggerOutbox;
  },
): Promise<ToolResult> {
  if (WRITE_TOOLS.has(name) && options.approvedOperationId && !options.transactionExecutor) {
    return database.transaction(async (tx) => executeTool(identity, name, rawArgs, {
      ...options,
      transactionExecutor: tx,
    }));
  }
  const db = options.transactionExecutor ?? database;
  if (WRITE_TOOLS.has(name) && options.approvedOperationId) {
    // Hold the operation row lock for the entire mutation transaction. A
    // stale retry may wait, but it cannot reset this operation while the
    // original request can still commit.
    await lockExecutingOperation(identity, options.approvedOperationId, db);
  }
  const args = rawArgs ?? {};
  logger.info({
    requestId: options.requestId,
    tool: name,
    toolCallId: options.callId,
    argumentKeys: Object.keys(args).sort(),
    argumentCount: Object.keys(args).length,
    dryRun: options.dryRun ?? false,
  }, "agent tool selected");

  if (options.dryRun && WRITE_TOOLS.has(name)) {
    const preview = {
      ok: true,
      dryRun: true,
      wouldExecute: name,
      arguments: jsonSafe(args),
    };
    logger.info({
      requestId: options.requestId,
      tool: name,
      toolCallId: options.callId,
      ok: true,
      dryRun: true,
    }, "agent tool result");
    return preview;
  }

  if (WRITE_TOOLS.has(name) && !options.approvedOperationId) {
    const versionedArgs = await captureExpectedRowVersion(identity, name, args, db);
    const operationArgs = name === "record_expense" && options.channel !== "quick"
      ? { ...versionedArgs, ...(await listApprovalCandidates(identity)) }
      : versionedArgs;
    const pending = await createPendingOperation(identity, {
      conversationId: options.conversationId,
      sourceTurnId: options.sourceTurnId ?? options.requestId,
      idempotencyKey: options.idempotencyKey,
      toolName: name,
      args: operationArgs,
    });
    const result: ToolResult = {
      ok: true,
      pendingApproval: true,
      approval: {
        operationId: pending.operationId,
        status: pending.status,
        toolName: pending.toolName,
        display: pending.display,
        args: jsonSafe(pending.args),
      },
    };
    logger.info({
      requestId: options.requestId,
      tool: name,
      toolCallId: options.callId,
      operationId: pending.operationId,
    }, "agent write awaiting approval");
    return result;
  }

  const stringArg = (key: string): string | undefined =>
    typeof args[key] === "string" && args[key].trim() ? String(args[key]).trim() : undefined;
  const expectedCreatedAt = stringArg("expectedCreatedAt");
  const matchesExpectedVersion = (record: { createdAt: Date }) =>
    !expectedCreatedAt || record.createdAt.toISOString() === expectedCreatedAt;
  const expectedCreatedAtWhere = (column: any) => {
    if (!expectedCreatedAt) return undefined;
    const expected = new Date(expectedCreatedAt);
    return and(
      gte(column, expected),
      lt(column, new Date(expected.getTime() + 1)),
    );
  };
  const personId = stringArg("personId");
  const projectId = stringArg("projectId");

  let result: ToolResult;
  switch (name) {
    case "find_person": {
      const matches = await findPeople(identity, stringArg("name") ?? "");
      result = {
        ok: true,
        matches: matches.map((person, index) => ({
          id: person.id,
          name: person.name,
          notes: person.notes,
          ordinal: index + 1,
        })),
        needsClarification: matches.length > 1,
      };
      break;
    }
    case "create_person": {
      const name = stringArg("name");
      if (!name) return { ok: false, error: "A person name is required." };
      const matches = await findPeople(identity, name);
      if (matches.length === 1) {
        result = { ok: true, created: false, person: matches[0] };
        break;
      }
      const [created] = await db.insert(peopleTable).values({
        tenantId: identity.tenantId,
        ownerUserId: identity.userId,
        name,
        nameKey: normalize(name),
        notes: args.notes === null ? null : stringArg("notes") ?? null,
        phone: args.phone === null ? null : stringArg("phone") ?? null,
      }).returning();
      result = { ok: true, created: true, person: created };
      break;
    }
    case "create_person_and_link_person_to_project": {
      const name = stringArg("personName");
      const relationship = stringArg("relationship");
      if (!name || !projectId || !relationship) {
        return { ok: false, error: "Person name, project ID, and relationship are required." };
      }
      const [project] = await db.select({ id: projectsTable.id, name: projectsTable.name })
        .from(projectsTable)
        .where(and(identityWhere(identity, projectsTable), eq(projectsTable.id, projectId)));
      if (!project) return { ok: false, error: "Project is not accessible." };
      const [person] = await db.insert(peopleTable).values({
        tenantId: identity.tenantId,
        ownerUserId: identity.userId,
        name,
        nameKey: normalize(name),
      }).returning();
      const [relationshipRow] = await db.insert(projectPeopleTable).values({
        tenantId: identity.tenantId,
        ownerUserId: identity.userId,
        personId: person.id,
        projectId,
        relationship,
      }).returning();
      result = {
        ok: true,
        person,
        relationship: relationshipRow,
        project,
      };
      break;
    }
    case "update_person": {
      if (!personId) return { ok: false, error: "personId is required." };
      const expectedVersion = expectedRowVersion(args);
      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
        rowVersion: sql`${peopleTable.rowVersion} + 1`,
      };
      const name = stringArg("name");
      if (name) {
        updates.name = name;
        updates.nameKey = normalize(name);
      }
      if (args.notes === null) updates.notes = null;
      else if (stringArg("notes")) updates.notes = stringArg("notes")!;
      if (args.phone === null) updates.phone = null;
      else if (stringArg("phone")) updates.phone = stringArg("phone")!;
      const [updated] = await db.update(peopleTable).set(updates).where(and(
        identityWhere(identity, peopleTable),
        eq(peopleTable.id, personId),
        ...(expectedVersion === undefined ? [] : [eq(peopleTable.rowVersion, expectedVersion)]),
      )).returning();
      result = updated
        ? { ok: true, person: updated }
        : { ok: false, error: expectedVersion === undefined ? "Person not found." : "Record changed after this edit was opened." };
      break;
    }
    case "find_project": {
      const matches = await findProjects(identity, stringArg("name") ?? "");
      result = {
        ok: true,
        matches: matches.map((project, index) => ({
          id: project.id,
          name: project.name,
          status: project.status,
          ordinal: index + 1,
        })),
        needsClarification: matches.length > 1,
      };
      break;
    }
    case "create_project": {
      const name = stringArg("name");
      if (!name) return { ok: false, error: "A project name is required." };
      const matches = await findProjects(identity, name);
      if (matches.length === 1) {
        result = { ok: true, created: false, project: matches[0] };
        break;
      }
      const [created] = await db.insert(projectsTable).values({
        tenantId: identity.tenantId,
        ownerUserId: identity.userId,
        name,
        nameKey: normalize(name),
        status: stringArg("status") === "archived" ? "archived" : "active",
      }).returning();
      result = { ok: true, created: true, project: created };
      break;
    }
    case "update_project": {
      if (!projectId) return { ok: false, error: "projectId is required." };
      const expectedVersion = expectedRowVersion(args);
      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
        rowVersion: sql`${projectsTable.rowVersion} + 1`,
      };
      const name = stringArg("name");
      if (name) {
        updates.name = name;
        updates.nameKey = normalize(name);
      }
      if (stringArg("status")) updates.status = stringArg("status")!;
      const [updated] = await db.update(projectsTable).set(updates).where(and(
        identityWhere(identity, projectsTable),
        eq(projectsTable.id, projectId),
        ...(expectedVersion === undefined ? [] : [eq(projectsTable.rowVersion, expectedVersion)]),
      )).returning();
      result = updated
        ? { ok: true, project: updated }
        : { ok: false, error: expectedVersion === undefined ? "Project not found." : "Record changed after this edit was opened." };
      break;
    }
    case "link_person_to_project": {
      if (!personId || !projectId) return { ok: false, error: "Both resolved IDs are required." };
      const [person] = await db.select({ id: peopleTable.id }).from(peopleTable).where(and(
        identityWhere(identity, peopleTable), eq(peopleTable.id, personId),
      ));
      const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(and(
        identityWhere(identity, projectsTable), eq(projectsTable.id, projectId),
      ));
      if (!person || !project) return { ok: false, error: "The person or project is not accessible." };
      const [relationship] = await db.insert(projectPeopleTable).values({
        tenantId: identity.tenantId,
        ownerUserId: identity.userId,
        personId,
        projectId,
        relationship: stringArg("relationship") ?? null,
      }).onConflictDoUpdate({
        target: [
          projectPeopleTable.tenantId,
          projectPeopleTable.ownerUserId,
          projectPeopleTable.projectId,
          projectPeopleTable.personId,
        ],
        set: {
          relationship: stringArg("relationship") ?? null,
          updatedAt: new Date(),
          rowVersion: sql`${projectPeopleTable.rowVersion} + 1`,
        },
      }).returning();
      result = { ok: true, relationship };
      break;
    }
    case "update_person_project_relationship": {
      const relationshipId = stringArg("relationshipId");
      const relationship = stringArg("relationship");
      if (!relationshipId || !relationship) return { ok: false, error: "Relationship ID and value are required." };
      const [updated] = await db.update(projectPeopleTable).set({
        relationship,
        updatedAt: new Date(),
        rowVersion: sql`${projectPeopleTable.rowVersion} + 1`,
      }).where(and(
        identityWhere(identity, projectPeopleTable),
        eq(projectPeopleTable.id, relationshipId),
      )).returning();
      result = updated ? { ok: true, relationship: updated } : { ok: false, error: "Relationship not found." };
      break;
    }
    case "record_expense": {
      const amountMinor = Number(args.amountMinor);
      const currency = stringArg("currency") ?? "EGP";
      const description = stringArg("description");
      let resolvedPersonId = personId;
      let resolvedProjectId = projectId;
      const personName = stringArg("personName");
      const projectName = stringArg("projectName");
      if (!resolvedPersonId && personName) {
        const [person] = await db.select({ id: peopleTable.id }).from(peopleTable).where(and(
          identityWhere(identity, peopleTable), eq(peopleTable.nameKey, normalize(personName)),
        )).limit(1);
        resolvedPersonId = person?.id;
      }
      if (!resolvedProjectId && projectName) {
        const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(and(
          identityWhere(identity, projectsTable), eq(projectsTable.nameKey, normalize(projectName)),
        )).limit(1);
        resolvedProjectId = project?.id;
      }
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !description) {
        return { ok: false, error: "Amount, currency, and description are required; amount must be integer minor units." };
      }
      if (resolvedPersonId) {
        const [person] = await db.select({ id: peopleTable.id }).from(peopleTable).where(and(
          identityWhere(identity, peopleTable), eq(peopleTable.id, resolvedPersonId),
        ));
        if (!person) return { ok: false, error: "Person is not accessible." };
      }
      if (resolvedProjectId) {
        const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(and(
          identityWhere(identity, projectsTable), eq(projectsTable.id, resolvedProjectId),
        ));
        if (!project) return { ok: false, error: "Project is not accessible." };
      }
      const purposeId = stringArg("purposeId");
      if (purposeId) {
        const [purpose] = await db.select({ id: purposesTable.id }).from(purposesTable).where(and(
          identityWhere(identity, purposesTable),
          eq(purposesTable.id, purposeId),
        ));
        if (!purpose) return { ok: false, error: "Purpose is not accessible." };
      }
      const rawOccurredAt = stringArg("occurredAt");
      const occurredAt = rawOccurredAt ? new Date(rawOccurredAt) : new Date();
      if (Number.isNaN(occurredAt.getTime())) return { ok: false, error: "occurredAt must be a valid ISO timestamp." };
      const [expense] = await db.insert(expensesTable).values({
        tenantId: identity.tenantId,
        ownerUserId: identity.userId,
        amountMinor,
        currency: currency.toUpperCase(),
        description,
        personId: resolvedPersonId ?? null,
        projectId: resolvedProjectId ?? null,
        purposeId: purposeId ?? null,
        sourceConversationId: options.conversationId ?? null,
        sourceTurnId: options.sourceTurnId ?? options.requestId,
        sourceOperationId: options.approvedOperationId ?? null,
        occurredAt,
      }).returning();
      result = { ok: true, expense };
      break;
    }
    case "update_expense": {
      const expenseId = stringArg("expenseId");
      const amountMinor = Number(args.amountMinor);
      const amountDeltaMinor = Number(args.amountDeltaMinor);
      const expectedCurrency = stringArg("expectedCurrency")?.toUpperCase();
      const expectedVersion = expectedRowVersion(args);
      if (
        !expenseId
        || (args.amountMinor !== undefined && args.amountDeltaMinor !== undefined)
        || (args.amountMinor !== undefined && (!Number.isSafeInteger(amountMinor) || amountMinor <= 0))
        || (args.amountDeltaMinor !== undefined && (!Number.isSafeInteger(amountDeltaMinor) || amountDeltaMinor === 0))
      ) {
        return { ok: false, error: "expenseId and a valid amountMinor are required when changing the amount." };
      }
      const [existing] = await db.select().from(expensesTable).where(and(
        identityWhere(identity, expensesTable),
        eq(expensesTable.id, expenseId),
      )).limit(1);
      if (!existing) return { ok: false, error: "Expense not found." };
      if (expectedCurrency && existing.currency !== expectedCurrency) {
        return { ok: false, error: "Expense currency changed after approval was prepared." };
      }
      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
        rowVersion: sql`${expensesTable.rowVersion} + 1`,
      };
      if (args.amountMinor !== undefined) updates.amountMinor = amountMinor;
      if (args.amountDeltaMinor !== undefined) {
        if (existing.amountMinor + amountDeltaMinor <= 0) {
          return { ok: false, error: "The expense amount cannot become zero or negative." };
        }
        updates.amountMinor = sql`${expensesTable.amountMinor} + ${amountDeltaMinor}`;
      }
      const currency = stringArg("currency");
      const description = stringArg("description");
      if (currency) updates.currency = currency.toUpperCase();
      if (description) updates.description = description;
      if (personId) {
        const [person] = await db.select({ id: peopleTable.id }).from(peopleTable).where(and(
          identityWhere(identity, peopleTable),
          eq(peopleTable.id, personId),
        ));
        if (!person) return { ok: false, error: "Person is not accessible." };
        updates.personId = personId;
      } else if (args.personId === null) {
        updates.personId = null;
      }
      if (projectId) {
        const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(and(
          identityWhere(identity, projectsTable),
          eq(projectsTable.id, projectId),
        ));
        if (!project) return { ok: false, error: "Project is not accessible." };
        updates.projectId = projectId;
      } else if (args.projectId === null) {
        updates.projectId = null;
      }
      const purposeId = stringArg("purposeId");
      if (purposeId) {
        const [purpose] = await db.select({ id: purposesTable.id }).from(purposesTable).where(and(
          identityWhere(identity, purposesTable),
          eq(purposesTable.id, purposeId),
        ));
        if (!purpose) return { ok: false, error: "Purpose is not accessible." };
        updates.purposeId = purposeId;
      } else if (args.purposeId === null) {
        updates.purposeId = null;
      }
      const occurredAtValue = stringArg("occurredAt");
      if (occurredAtValue) {
        const occurredAt = new Date(occurredAtValue);
        if (Number.isNaN(occurredAt.getTime())) return { ok: false, error: "occurredAt must be a valid ISO timestamp." };
        updates.occurredAt = occurredAt;
      }
      const [updated] = await db.update(expensesTable).set(updates).where(and(
        identityWhere(identity, expensesTable),
        eq(expensesTable.id, expenseId),
        ...(expectedCurrency ? [eq(expensesTable.currency, expectedCurrency)] : []),
        ...(expectedVersion === undefined ? [] : [eq(expensesTable.rowVersion, expectedVersion)]),
      )).returning();
      result = updated
        ? { ok: true, corrected: true, expense: updated }
        : {
            ok: false,
            error: expectedVersion !== undefined
              ? "Record changed after this edit was opened."
              : expectedCurrency
                ? "Expense currency changed after approval was prepared."
                : "Expense not found.",
          };
      break;
    }
    case "update_task": {
      const taskId = stringArg("taskId");
      if (!taskId) return { ok: false, error: "taskId is required." };
      const expectedVersion = expectedRowVersion(args);
      await lockTaskOpenCount(identity, db);
      const previousOpenCount = await countOpenTasks(identity, db);
      const [previous] = await db.select({
        dueAt: tasksTable.dueAt,
        status: tasksTable.status,
      }).from(tasksTable).where(and(
        identityWhere(identity, tasksTable),
        eq(tasksTable.id, taskId),
      )).limit(1);
       const updates: Record<string, unknown> = {
         updatedAt: new Date(),
         rowVersion: sql`${tasksTable.rowVersion} + 1`,
       };
      if (stringArg("title")) updates.title = stringArg("title");
      if (typeof args.dueAt === "string" && args.dueAt.trim()) {
        const dueAt = new Date(args.dueAt);
        if (Number.isNaN(dueAt.getTime())) return { ok: false, error: "dueAt must be a valid ISO timestamp." };
        updates.dueAt = dueAt;
      } else if (args.dueAt === null) {
        updates.dueAt = null;
      }
      if (stringArg("status")) updates.status = stringArg("status");
      const [updated] = await db.update(tasksTable).set(updates).where(and(
        identityWhere(identity, tasksTable),
        eq(tasksTable.id, taskId),
        ...(expectedVersion === undefined ? [] : [eq(tasksTable.rowVersion, expectedVersion)]),
      )).returning();
      if (updated) {
        const wasActive = ["pending", "in_progress"].includes(previous?.status ?? "");
        const isActive = ["pending", "in_progress"].includes(updated.status);
        const deadlineChanged = previous?.dueAt?.getTime() !== updated.dueAt?.getTime();
        if (isActive && updated.dueAt && (!wasActive || deadlineChanged)) {
          await enqueueProactiveDeadlineTriggers(identity, {
            entityType: "task",
            entityId: updated.id,
            title: updated.title,
            dueAt: updated.dueAt,
            status: updated.status,
            rowVersion: updated.rowVersion,
            occurredAt: updated.updatedAt,
          }, db, options.triggerOutboxWriter ?? enqueueTriggerOutbox);
        }
        const currentOpenCount = await countOpenTasks(identity, db);
        await enqueueTaskCountTransition(
          identity,
          updated.id,
          previousOpenCount,
          currentOpenCount,
          `task-update:${updated.id}:v${updated.rowVersion}`,
          updated.updatedAt,
          db,
          options.triggerOutboxWriter ?? enqueueTriggerOutbox,
        );
      }
      result = updated
        ? { ok: true, task: updated }
        : { ok: false, error: expectedVersion === undefined ? "Task not found." : "Record changed after this edit was opened." };
      break;
    }
    case "update_commitment": {
      const commitmentId = stringArg("commitmentId");
      if (!commitmentId) return { ok: false, error: "commitmentId is required." };
      const expectedVersion = expectedRowVersion(args);
      const [previous] = await db.select({
        dueAt: commitmentsTable.dueAt,
        status: commitmentsTable.status,
      }).from(commitmentsTable).where(and(
        identityWhere(identity, commitmentsTable),
        eq(commitmentsTable.id, commitmentId),
      )).limit(1);
       const updates: Record<string, unknown> = {
         updatedAt: new Date(),
         rowVersion: sql`${commitmentsTable.rowVersion} + 1`,
       };
      if (stringArg("title")) updates.title = stringArg("title");
      if (typeof args.personId === "string" && args.personId.trim()) {
        const targetPersonId = args.personId.trim();
        const [person] = await db.select({ id: peopleTable.id }).from(peopleTable).where(and(
          identityWhere(identity, peopleTable),
          eq(peopleTable.id, targetPersonId),
        ));
        if (!person) return { ok: false, error: "Person is not accessible." };
        updates.personId = targetPersonId;
      }
      else if (args.personId === null) updates.personId = null;
      if (typeof args.dueAt === "string" && args.dueAt.trim()) {
        const dueAt = new Date(args.dueAt);
        if (Number.isNaN(dueAt.getTime())) return { ok: false, error: "dueAt must be a valid ISO timestamp." };
        updates.dueAt = dueAt;
      } else if (args.dueAt === null) {
        updates.dueAt = null;
      }
      if (stringArg("status")) updates.status = stringArg("status");
      const [updated] = await db.update(commitmentsTable).set(updates).where(and(
        identityWhere(identity, commitmentsTable),
        eq(commitmentsTable.id, commitmentId),
        ...(expectedVersion === undefined ? [] : [eq(commitmentsTable.rowVersion, expectedVersion)]),
      )).returning();
      if (updated) {
        const wasActive = ["open", "active", "in_progress", "pending"].includes(previous?.status ?? "");
        const isActive = ["open", "active", "in_progress", "pending"].includes(updated.status);
        const deadlineChanged = previous?.dueAt?.getTime() !== updated.dueAt?.getTime();
        if (isActive && updated.dueAt && (!wasActive || deadlineChanged)) {
          await enqueueProactiveDeadlineTriggers(identity, {
            entityType: "commitment",
            entityId: updated.id,
            title: updated.title,
            dueAt: updated.dueAt,
            status: updated.status,
            rowVersion: updated.rowVersion,
            occurredAt: updated.updatedAt,
          }, db, options.triggerOutboxWriter ?? enqueueTriggerOutbox);
        }
        await enqueueCommitmentDeadlineTrigger(
          identity,
          updated,
          db,
          options.triggerOutboxWriter ?? enqueueTriggerOutbox,
        );
      }
      result = updated
        ? { ok: true, commitment: updated }
        : { ok: false, error: expectedVersion === undefined ? "Commitment not found." : "Record changed after this edit was opened." };
      break;
    }
    case "update_reminder": {
      const reminderId = stringArg("reminderId");
      if (!reminderId) return { ok: false, error: "reminderId is required." };
      const expectedVersion = expectedRowVersion(args);
      const [previous] = await db.select({
        dueAt: remindersTable.dueAt,
        status: remindersTable.status,
      }).from(remindersTable).where(and(
        identityWhere(identity, remindersTable),
        eq(remindersTable.id, reminderId),
      )).limit(1);
       const updates: Record<string, unknown> = {
         updatedAt: new Date(),
         rowVersion: sql`${remindersTable.rowVersion} + 1`,
       };
      if (stringArg("text")) updates.text = stringArg("text");
      if (stringArg("timezone")) updates.timezone = stringArg("timezone");
      if (stringArg("status")) updates.status = stringArg("status");
      if (typeof args.dueAt === "string" && args.dueAt.trim()) {
        const dueAt = new Date(args.dueAt);
        if (Number.isNaN(dueAt.getTime())) return { ok: false, error: "dueAt must be a valid ISO timestamp." };
        updates.dueAt = dueAt;
      }
      const [updated] = await db.update(remindersTable).set(updates).where(and(
        identityWhere(identity, remindersTable),
        eq(remindersTable.id, reminderId),
        ...(expectedVersion === undefined ? [] : [eq(remindersTable.rowVersion, expectedVersion)]),
      )).returning();
      if (updated) {
        const wasActive = ["scheduled", "pending", "open", "active"].includes(previous?.status ?? "");
        const isActive = ["scheduled", "pending", "open", "active"].includes(updated.status);
        const deadlineChanged = previous?.dueAt?.getTime() !== updated.dueAt?.getTime();
        if (isActive && updated.dueAt && (!wasActive || deadlineChanged)) {
          await enqueueProactiveDeadlineTriggers(identity, {
            entityType: "reminder",
            entityId: updated.id,
            title: updated.text,
            dueAt: updated.dueAt,
            status: updated.status,
            rowVersion: updated.rowVersion,
            occurredAt: updated.updatedAt,
          }, db, options.triggerOutboxWriter ?? enqueueTriggerOutbox);
        }
      }
      result = updated
        ? { ok: true, reminder: updated }
        : { ok: false, error: expectedVersion === undefined ? "Reminder not found." : "Record changed after this edit was opened." };
      break;
    }
    case "delete_expense": {
      const expenseId = stringArg("expenseId");
      if (!expenseId) return { ok: false, error: "expenseId is required." };
      const [existing] = await db.select().from(expensesTable).where(and(
        identityWhere(identity, expensesTable),
        eq(expensesTable.id, expenseId),
      )).limit(1);
      if (!existing) {
        result = { ok: false, error: "Expense not found." };
        break;
      }
      if (!matchesExpectedVersion(existing)) {
        result = { ok: false, error: "This record changed after it was created; undo was not applied." };
        break;
      }
      const [deleted] = await db.delete(expensesTable).where(and(
        identityWhere(identity, expensesTable),
        eq(expensesTable.id, expenseId),
        expectedCreatedAtWhere(expensesTable.createdAt),
      )).returning();
      result = deleted ? { ok: true, deleted: true, deletedExpense: deleted } : { ok: false, error: "Expense not found." };
      break;
    }
    case "delete_person": {
      const targetId = stringArg("personId");
      if (!targetId) return { ok: false, error: "personId is required." };
      const [existing] = await db.select().from(peopleTable).where(and(
        identityWhere(identity, peopleTable),
        eq(peopleTable.id, targetId),
      )).limit(1);
      if (!existing) {
        result = { ok: false, error: "Person not found." };
        break;
      }
      if (!matchesExpectedVersion(existing)) {
        result = { ok: false, error: "This record changed after it was created; undo was not applied." };
        break;
      }
      const [dependency] = await db.select({ id: expensesTable.id }).from(expensesTable).where(and(
        identityWhere(identity, expensesTable),
        eq(expensesTable.personId, targetId),
      )).limit(1);
      const [commitmentDependency] = await db.select({ id: commitmentsTable.id }).from(commitmentsTable).where(and(
        identityWhere(identity, commitmentsTable),
        eq(commitmentsTable.personId, targetId),
      )).limit(1);
      const [financialPartyDependency] = await db.select({ id: financialPartyPeopleTable.id })
        .from(financialPartyPeopleTable)
        .where(and(
          identityWhere(identity, financialPartyPeopleTable),
          eq(financialPartyPeopleTable.personId, targetId),
        ))
        .limit(1);
      if (dependency || commitmentDependency || financialPartyDependency) {
        result = { ok: false, error: "Person has saved records and cannot be deleted until those links are resolved." };
        break;
      }
      await db.delete(projectPeopleTable).where(and(
        identityWhere(identity, projectPeopleTable),
        eq(projectPeopleTable.personId, targetId),
      ));
      const [deleted] = await db.delete(peopleTable).where(and(
        identityWhere(identity, peopleTable),
        eq(peopleTable.id, targetId),
        expectedCreatedAtWhere(peopleTable.createdAt),
      )).returning();
      result = deleted ? { ok: true, deleted: true, deletedPerson: deleted } : { ok: false, error: "Person not found." };
      break;
    }
    case "delete_project": {
      const targetId = stringArg("projectId");
      if (!targetId) return { ok: false, error: "projectId is required." };
      const [existing] = await db.select().from(projectsTable).where(and(
        identityWhere(identity, projectsTable),
        eq(projectsTable.id, targetId),
      )).limit(1);
      if (!existing) {
        result = { ok: false, error: "Project not found." };
        break;
      }
      if (!matchesExpectedVersion(existing)) {
        result = { ok: false, error: "This record changed after it was created; undo was not applied." };
        break;
      }
      const [dependency] = await db.select({ id: expensesTable.id }).from(expensesTable).where(and(
        identityWhere(identity, expensesTable),
        eq(expensesTable.projectId, targetId),
      )).limit(1);
      const [relationshipDependency] = await db.select({ id: projectPeopleTable.id }).from(projectPeopleTable).where(and(
        identityWhere(identity, projectPeopleTable),
        eq(projectPeopleTable.projectId, targetId),
      )).limit(1);
      const [financialPartyDependency] = await db.select({ id: financialPartyProjectsTable.id })
        .from(financialPartyProjectsTable)
        .where(and(
          identityWhere(identity, financialPartyProjectsTable),
          eq(financialPartyProjectsTable.projectId, targetId),
        ))
        .limit(1);
      if (dependency || relationshipDependency || financialPartyDependency) {
        result = { ok: false, error: "Project has saved records and cannot be deleted until those links are resolved." };
        break;
      }
      const [deleted] = await db.delete(projectsTable).where(and(
        identityWhere(identity, projectsTable),
        eq(projectsTable.id, targetId),
        expectedCreatedAtWhere(projectsTable.createdAt),
      )).returning();
      result = deleted ? { ok: true, deleted: true, deletedProject: deleted } : { ok: false, error: "Project not found." };
      break;
    }
    case "delete_task": {
      const targetId = stringArg("taskId");
      if (!targetId) return { ok: false, error: "taskId is required." };
      await lockTaskOpenCount(identity, db);
      const previousOpenCount = await countOpenTasks(identity, db);
      const [existing] = await db.select().from(tasksTable).where(and(
        identityWhere(identity, tasksTable),
        eq(tasksTable.id, targetId),
      )).limit(1);
      if (!existing) {
        result = { ok: false, error: "Task not found." };
        break;
      }
      if (!matchesExpectedVersion(existing)) {
        result = { ok: false, error: "This record changed after it was created; undo was not applied." };
        break;
      }
      const [deleted] = await db.delete(tasksTable).where(and(
        identityWhere(identity, tasksTable),
        eq(tasksTable.id, targetId),
        expectedCreatedAtWhere(tasksTable.createdAt),
      )).returning();
      if (deleted) {
        const currentOpenCount = await countOpenTasks(identity, db);
        await enqueueTaskCountTransition(
          identity,
          deleted.id,
          previousOpenCount,
          currentOpenCount,
          `task-delete:${existing.id}:v${existing.rowVersion}`,
          deleted.updatedAt,
          db,
          options.triggerOutboxWriter ?? enqueueTriggerOutbox,
        );
      }
      result = deleted ? { ok: true, deleted: true, deletedTask: deleted } : { ok: false, error: "Task not found." };
      break;
    }
    case "delete_commitment": {
      const targetId = stringArg("commitmentId");
      if (!targetId) return { ok: false, error: "commitmentId is required." };
      const [existing] = await db.select().from(commitmentsTable).where(and(
        identityWhere(identity, commitmentsTable),
        eq(commitmentsTable.id, targetId),
      )).limit(1);
      if (!existing) {
        result = { ok: false, error: "Commitment not found." };
        break;
      }
      if (!matchesExpectedVersion(existing)) {
        result = { ok: false, error: "This record changed after it was created; undo was not applied." };
        break;
      }
      const [deleted] = await db.delete(commitmentsTable).where(and(
        identityWhere(identity, commitmentsTable),
        eq(commitmentsTable.id, targetId),
        expectedCreatedAtWhere(commitmentsTable.createdAt),
      )).returning();
      result = deleted ? { ok: true, deleted: true, deletedCommitment: deleted } : { ok: false, error: "Commitment not found." };
      break;
    }
    case "delete_reminder": {
      const targetId = stringArg("reminderId");
      if (!targetId) return { ok: false, error: "reminderId is required." };
      const [existing] = await db.select().from(remindersTable).where(and(
        identityWhere(identity, remindersTable),
        eq(remindersTable.id, targetId),
      )).limit(1);
      if (!existing) {
        result = { ok: false, error: "Reminder not found." };
        break;
      }
      if (!matchesExpectedVersion(existing)) {
        result = { ok: false, error: "This record changed after it was created; undo was not applied." };
        break;
      }
      const [deleted] = await db.delete(remindersTable).where(and(
        identityWhere(identity, remindersTable),
        eq(remindersTable.id, targetId),
        expectedCreatedAtWhere(remindersTable.createdAt),
      )).returning();
      result = deleted ? { ok: true, deleted: true, deletedReminder: deleted } : { ok: false, error: "Reminder not found." };
      break;
    }
    case "query_expenses": {
      const requestedLimit = Number(args.limit ?? 20);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 50)
        : 20;
      const description = stringArg("description");
      const excludeProjectId = stringArg("excludeProjectId");
      const dateRange = expenseDateRange(args);
      const dateFilters = [
        dateRange.from ? gte(expensesTable.occurredAt, dateRange.from) : undefined,
        dateRange.to ? lt(expensesTable.occurredAt, dateRange.to) : undefined,
      ];
      const expenseWhere = and(
        identityWhere(identity, expensesTable),
        personId ? eq(expensesTable.personId, personId) : undefined,
        projectId ? eq(expensesTable.projectId, projectId) : undefined,
        excludeProjectId
          ? or(isNull(expensesTable.projectId), ne(expensesTable.projectId, excludeProjectId))
          : undefined,
        description ? ilike(expensesTable.description, `%${description}%`) : undefined,
        ...dateFilters,
      );
      const rows = await db.select({
        expense: expensesTable,
        personName: peopleTable.name,
        projectName: projectsTable.name,
      }).from(expensesTable)
        .leftJoin(peopleTable, eq(expensesTable.personId, peopleTable.id))
        .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
        .where(expenseWhere)
        .orderBy(desc(expensesTable.occurredAt))
        .limit(limit);
      const aggregates = await db.select({
        totalMinor: sql<number>`coalesce(sum(${expensesTable.amountMinor}), 0)::bigint`,
        count: sql<number>`count(*)::int`,
        currency: expensesTable.currency,
      }).from(expensesTable)
        .where(expenseWhere)
        .groupBy(expensesTable.currency);
      const currencyTotals = aggregates.map((aggregate) => ({
        currency: aggregate.currency || "EGP",
        totalMinor: Number(aggregate.totalMinor ?? 0),
        count: Number(aggregate.count ?? 0),
      }));
      const projectAggregate = await db.select({
        projectCount: sql<number>`count(distinct ${expensesTable.projectId})::int`,
      }).from(expensesTable).where(expenseWhere);
      result = {
        ok: true,
        expenses: rows,
        summary: expenseSummaryFromCurrencyTotals(
          currencyTotals,
          Number(projectAggregate[0]?.projectCount ?? 0),
        ),
      };
      break;
    }
    case "audit_expense_units": {
      const requestedLimit = Number(args.limit ?? 100);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200)
        : 100;
      const rows = await db.select({
        id: expensesTable.id,
        amountMinor: expensesTable.amountMinor,
        currency: expensesTable.currency,
        description: expensesTable.description,
        occurredAt: expensesTable.occurredAt,
      }).from(expensesTable)
        .where(identityWhere(identity, expensesTable))
        .orderBy(desc(expensesTable.occurredAt))
        .limit(limit + 1);
      result = {
        ok: true,
        audit: buildExpenseUnitAudit(rows, limit),
      };
      break;
    }
    case "rank_expense_projects": {
      const dateRange = expenseDateRange(args);
      const excludeProjectId = stringArg("excludeProjectId");
      const projectTotals = await db.select({
        projectId: expensesTable.projectId,
        projectName: projectsTable.name,
        currency: expensesTable.currency,
        amountMinor: sql<number>`sum(${expensesTable.amountMinor})::bigint`,
        count: sql<number>`count(*)::int`,
      }).from(expensesTable)
        .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
        .where(and(
          identityWhere(identity, expensesTable),
          excludeProjectId
            ? or(isNull(expensesTable.projectId), ne(expensesTable.projectId, excludeProjectId))
            : undefined,
          dateRange.from ? gte(expensesTable.occurredAt, dateRange.from) : undefined,
          dateRange.to ? lt(expensesTable.occurredAt, dateRange.to) : undefined,
        ))
        .groupBy(expensesTable.projectId, projectsTable.name, expensesTable.currency)
        .orderBy(desc(sql`sum(${expensesTable.amountMinor})`));
      result = {
        ok: true,
        projectTotals: projectTotals.map((row) => ({
          projectId: row.projectId,
          projectName: row.projectName ?? "بدون مشروع",
          currency: row.currency,
          amountMinor: Number(row.amountMinor ?? 0),
          count: Number(row.count ?? 0),
        })),
        period: typeof args.period === "string" ? args.period : undefined,
        fromDate: dateRange.from?.toISOString(),
        toDate: dateRange.to?.toISOString(),
      };
      break;
    }
    case "get_person_expense_total": {
      if (!personId) return { ok: false, error: "personId is required." };
      const totals = await db.select({
        amountMinor: sql<number>`coalesce(sum(${expensesTable.amountMinor}), 0)::bigint`,
        count: sql<number>`count(*)::int`,
        currency: expensesTable.currency,
      }).from(expensesTable).where(and(
        identityWhere(identity, expensesTable), eq(expensesTable.personId, personId),
      )).groupBy(expensesTable.currency);
      const currencyTotals = totals.map((total) => ({
        currency: total.currency || "EGP",
        totalMinor: Number(total.amountMinor ?? 0),
        count: Number(total.count ?? 0),
      }));
      const summary = expenseSummaryFromCurrencyTotals(currencyTotals);
      result = { ok: true, total: {
        count: summary.count,
        ...(summary.currencyTotals ? { currencyTotals: summary.currencyTotals } : {}),
        ...(summary.totalMinor !== undefined ? { amountMinor: summary.totalMinor } : {}),
        ...(summary.currency ? { currency: summary.currency } : {}),
      } };
      break;
    }
    case "get_project_expense_total": {
      if (!projectId) return { ok: false, error: "projectId is required." };
      const totals = await db.select({
        amountMinor: sql<number>`coalesce(sum(${expensesTable.amountMinor}), 0)::bigint`,
        count: sql<number>`count(*)::int`,
        currency: expensesTable.currency,
      }).from(expensesTable).where(and(
        identityWhere(identity, expensesTable), eq(expensesTable.projectId, projectId),
      )).groupBy(expensesTable.currency);
      const currencyTotals = totals.map((total) => ({
        currency: total.currency || "EGP",
        totalMinor: Number(total.amountMinor ?? 0),
        count: Number(total.count ?? 0),
      }));
      const summary = expenseSummaryFromCurrencyTotals(currencyTotals);
      result = { ok: true, total: {
        count: summary.count,
        ...(summary.currencyTotals ? { currencyTotals: summary.currencyTotals } : {}),
        ...(summary.totalMinor !== undefined ? { amountMinor: summary.totalMinor } : {}),
        ...(summary.currency ? { currency: summary.currency } : {}),
      } };
      break;
    }
    case "create_financial_party":
      try {
        result = { ok: true, financial_party: await createFinancialParty(identity, args, db) };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "Could not create financial party." };
      }
      break;
    case "create_financial_obligation":
      try {
        result = { ok: true, financial_obligation: await createFinancialObligation(identity, args, db) };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "Could not create financial obligation." };
      }
      break;
    case "create_financial_payment":
      try {
        result = { ok: true, financial_payment: await createFinancialPayment(identity, args, db) };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "Could not create payment." };
      }
      break;
    case "settle_financial_obligation":
      try {
        result = { ok: true, obligation_settlement: await settleObligation(identity, args, db) };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "Could not settle obligation." };
      }
      break;
    case "create_donation":
      try {
        result = { ok: true, donation: await createDonation(identity, args, db) };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "Could not create donation." };
      }
      break;
    case "create_income_receivable":
      try {
        result = { ok: true, income_receivable: await createIncomeReceivable(identity, args, db) };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "Could not create receivable." };
      }
      break;
    case "create_payment_link":
      try {
        result = { ok: true, payment_link: await createPaymentLink(identity, args, db) };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "Could not create payment link." };
      }
      break;
    case "create_typed_relationship":
      try {
        result = { ok: true, ...(await createTypedRelationship(identity, args, db)) };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "Could not create relationship." };
      }
      break;
    case "delete_typed_relationship":
      try {
        result = { ok: true, ...(await deleteTypedRelationship(identity, args, db)) };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "Could not delete relationship." };
      }
      break;
    case "update_financial_obligation":
      try {
        result = { ok: true, financial_obligation: await updateFinancialObligation(identity, args, db), corrected: true };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "Could not update obligation." };
      }
      break;
    case "update_financial_payment":
      try {
        result = { ok: true, financial_payment: await updateFinancialPayment(identity, args, db), corrected: true };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "Could not update payment." };
      }
      break;
    case "update_donation":
      try {
        result = { ok: true, donation: await updateDonation(identity, args, db), corrected: true };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "Could not update donation." };
      }
      break;
    case "update_income_receivable":
      try {
        result = { ok: true, income_receivable: await updateIncomeReceivable(identity, args, db), corrected: true };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "Could not update receivable." };
      }
      break;
    case "create_task": {
      const title = stringArg("title");
      if (!title) return { ok: false, error: "Task title is required." };
      const dueAtValue = stringArg("dueAt");
      const dueAt = dueAtValue ? new Date(dueAtValue) : null;
      if (dueAt && Number.isNaN(dueAt.getTime())) return { ok: false, error: "dueAt must be a valid ISO timestamp." };
      await lockTaskOpenCount(identity, db);
      const previousOpenCount = await countOpenTasks(identity, db);
      const [task] = await db.insert(tasksTable).values({
        tenantId: identity.tenantId,
        ownerUserId: identity.userId,
        title,
        dueAt,
        status: stringArg("status") ?? "pending",
        sourceConversationId: options.conversationId ?? null,
        sourceTurnId: options.sourceTurnId ?? options.requestId,
        sourceOperationId: options.approvedOperationId ?? null,
      }).returning();
      if (!task) return { ok: false, error: "Could not create task." };
      const triggerOutboxWriter = options.triggerOutboxWriter ?? enqueueTriggerOutbox;
      const currentOpenCount = await countOpenTasks(identity, db);
      await enqueueTaskCountTransition(
        identity,
        task.id,
        previousOpenCount,
        currentOpenCount,
        `task-create:${task.id}:v${task.rowVersion}`,
        task.createdAt,
        db,
        triggerOutboxWriter,
      );
      await triggerOutboxWriter({
        identity,
        eventType: "task.created",
        aggregateType: "task",
        aggregateId: task.id,
        payload: {
          taskId: task.id,
          title: task.title,
          status: task.status,
          dueAt: task.dueAt?.toISOString() ?? null,
          rowVersion: task.rowVersion,
        },
        dedupeKey: `task-created:v1:${identity.tenantId}:${identity.userId}:${task.id}`,
      }, db);
      await enqueueProactiveDeadlineTriggers(identity, {
        entityType: "task",
        entityId: task.id,
        title: task.title,
        dueAt: task.dueAt,
        status: task.status,
        rowVersion: task.rowVersion,
        occurredAt: task.createdAt,
      }, db, triggerOutboxWriter);
      result = { ok: true, task };
      break;
    }
    case "create_agent_work": {
      const kindValue = stringArg("kind");
      const allowedKinds = new Set<AgentWorkKind>([
        "monitor",
        "reminder",
        "recurring_task",
        "external_action",
        "research",
        "workflow",
      ]);
      if (!kindValue || !allowedKinds.has(kindValue as AgentWorkKind)) {
        return { ok: false, error: "Agent Work kind is required and must be supported." };
      }
      const title = stringArg("title");
      if (!title) return { ok: false, error: "Agent Work title is required." };
      const nextRunAtValue = stringArg("nextRunAt");
      const nextRunAt = nextRunAtValue ? new Date(nextRunAtValue) : null;
      if (nextRunAt && Number.isNaN(nextRunAt.getTime())) {
        return { ok: false, error: "nextRunAt must be a valid ISO timestamp." };
      }
      const objectArg = (key: string): Record<string, unknown> => {
        const value = args[key];
        return value && typeof value === "object" && !Array.isArray(value)
          ? value as Record<string, unknown>
          : {};
      };
      const sourceType = stringArg("sourceType") ?? "user_defined";
      const schedule = objectArg("schedule");
      const condition = objectArg("condition");
      const requestedAction = objectArg("action");
      let storedAction: Record<string, unknown> = requestedAction;
      const externalActionConnector = externalActionConnectorForProvider(sourceType);
      if (externalActionConnector) {
        if (kindValue !== "external_action") {
          return { ok: false, error: "External provider actions must use the external_action Work kind." };
        }
        if (!options.approvedOperationId) {
          return { ok: false, error: "External provider Work setup requires explicit approval." };
        }
        if (Object.keys(schedule).length > 0 || Object.keys(condition).length > 0) {
          return { ok: false, error: "External provider actions are one-time Work and cannot include a recurring schedule or condition." };
        }
        const storedExternalAction = externalActionConnector.validateSetupAction(
          requestedAction,
          options.approvedOperationId,
        );
        if (!storedExternalAction) {
          return {
            ok: false,
            error: "External provider action did not pass its validation rules.",
          };
        }
        storedAction = storedExternalAction;
      }
      const work = await agentWorkRuntime.createWork({
        identity,
        kind: kindValue as AgentWorkKind,
        title,
        description: stringArg("description") ?? null,
        source: {
          type: sourceType,
          conversationId: options.conversationId ?? null,
          sourceTurnId: options.sourceTurnId ?? options.requestId,
        },
        condition,
        action: storedAction,
        schedule,
        status: externalActionConnector ? "active" : undefined,
        nextRunAt: externalActionConnector ? nextRunAt ?? new Date() : nextRunAt,
        transactionExecutor: db,
      });
      result = { ok: true, agentWork: work, created: true };
      break;
    }
    case "create_commitment": {
      const title = stringArg("title");
      if (!title) return { ok: false, error: "Commitment title is required." };
      const dueAtValue = stringArg("dueAt");
      const dueAt = dueAtValue ? new Date(dueAtValue) : null;
      if (dueAt && Number.isNaN(dueAt.getTime())) return { ok: false, error: "dueAt must be a valid ISO timestamp." };
      if (personId) {
        const [person] = await db.select({ id: peopleTable.id }).from(peopleTable).where(and(
          identityWhere(identity, peopleTable),
          eq(peopleTable.id, personId),
        ));
        if (!person) return { ok: false, error: "Person is not accessible." };
      }
      const [commitment] = await db.insert(commitmentsTable).values({
        tenantId: identity.tenantId, ownerUserId: identity.userId, title,
        personId: personId ?? null, dueAt, status: stringArg("status") ?? "open",
      }).returning();
      if (!commitment) return { ok: false, error: "Could not create commitment." };
      await enqueueCommitmentDeadlineTrigger(
        identity,
        commitment,
        db,
        options.triggerOutboxWriter ?? enqueueTriggerOutbox,
      );
      await enqueueProactiveDeadlineTriggers(identity, {
        entityType: "commitment",
        entityId: commitment.id,
        title: commitment.title,
        dueAt: commitment.dueAt,
        status: commitment.status,
        rowVersion: commitment.rowVersion,
        occurredAt: commitment.createdAt,
      }, db, options.triggerOutboxWriter ?? enqueueTriggerOutbox);
      result = { ok: true, commitment };
      break;
    }
    case "create_reminder": {
      const text = stringArg("text");
      const dueAtValue = stringArg("dueAt");
      if (!text || !dueAtValue) return { ok: false, error: "Reminder text and dueAt are required." };
      const dueAt = new Date(dueAtValue);
      if (Number.isNaN(dueAt.getTime())) return { ok: false, error: "dueAt must be a valid ISO timestamp." };
      const [reminder] = await db.insert(remindersTable).values({
        tenantId: identity.tenantId, ownerUserId: identity.userId, text, dueAt,
        timezone: stringArg("timezone") ?? "Africa/Cairo",
        status: stringArg("status") ?? "scheduled",
        sourceConversationId: options.conversationId ?? null,
        sourceTurnId: options.sourceTurnId ?? options.requestId,
        sourceOperationId: options.approvedOperationId ?? null,
      }).returning();
      if (reminder) {
        await enqueueProactiveDeadlineTriggers(identity, {
          entityType: "reminder",
          entityId: reminder.id,
          title: reminder.text,
          dueAt: reminder.dueAt,
          status: reminder.status,
          rowVersion: reminder.rowVersion,
          occurredAt: reminder.createdAt,
        }, db, options.triggerOutboxWriter ?? enqueueTriggerOutbox);
      }
      result = { ok: true, reminder };
      break;
    }
    case "query_reminders": {
      const reminders = await db.select().from(remindersTable).where(and(
        identityWhere(identity, remindersTable),
        stringArg("status") ? eq(remindersTable.status, stringArg("status")!) : undefined,
      )).orderBy(asc(remindersTable.dueAt)).limit(20);
      result = { ok: true, reminders };
      break;
    }
    case "recall_context": {
      const [reminders, expenses, projects, people, tasks] = await Promise.all([
        db.select().from(remindersTable).where(and(identityWhere(identity, remindersTable), eq(remindersTable.status, "scheduled"))).orderBy(asc(remindersTable.dueAt)).limit(8),
        db.select().from(expensesTable).where(identityWhere(identity, expensesTable)).orderBy(desc(expensesTable.occurredAt)).limit(8),
        db.select().from(projectsTable).where(and(identityWhere(identity, projectsTable), eq(projectsTable.status, "active"))).limit(8),
        db.select().from(peopleTable).where(identityWhere(identity, peopleTable)).limit(8),
        db.select().from(tasksTable).where(and(identityWhere(identity, tasksTable), inArray(tasksTable.status, ["pending", "in_progress"]))).limit(8),
      ]);
      result = {
        ok: true,
        context: {
          reminders,
          expenses,
          expenseSummary: expenseRowsSummary(expenses),
          projects,
          people,
          tasks,
          asOf: new Date().toISOString(),
        },
      };
      break;
    }
    default:
      result = { ok: false, error: `Tool ${name} is not available.` };
  }

  if (result.ok && WRITE_TOOLS.has(name)) {
    const activityWriter = options.activityWriter ?? recordToolActivity;
    await activityWriter(
      identity,
      name,
      options.approvedOperationId
        ? { ...args, sourceOperationId: options.approvedOperationId }
        : args,
      result,
      db,
    );
    const verification = options.verificationResolver
      ? await options.verificationResolver(identity, name, result, db)
      : await verifyMutationResult(identity, name, result, db);
    result = { ...result, verification };
    if (options.operationCompletion) {
      await options.operationCompletion(result, db);
    }
  }

  logger.info({
    requestId: options.requestId,
    tool: name,
    toolCallId: options.callId,
    ok: result.ok,
    resultKeys: Object.keys(result),
  }, "agent tool result");
  return jsonSafe(result) as ToolResult;
}

export async function executeStructuredTool(
  identity: Identity,
  name: string,
  args: Record<string, unknown>,
  options: {
    requestId: string;
    dryRun?: boolean;
    conversationId?: string | null;
    sourceTurnId?: string | null;
    idempotencyKey?: string | null;
    channel?: TurnInputChannel;
    approvedOperationId?: string;
    activityWriter?: typeof recordToolActivity;
    verificationResolver?: MutationVerificationResolver;
    operationCompletion?: (result: Record<string, unknown>, executor: DbExecutor) => Promise<void>;
    triggerOutboxWriter?: typeof enqueueTriggerOutbox;
  } = { requestId: crypto.randomUUID() },
): Promise<ToolResult> {
  return executeTool(identity, name, args, options);
}

const systemInstruction = `أنت سكرتير شخصي عربي يعمل داخل نظام بيانات منظم.
افهم اللغة الطبيعية ولا تعتمد على جملة ثابتة. استخدم الأدوات المعتمدة فقط.
قواعد دائمة:
1. لا تصل مباشرة إلى قاعدة البيانات ولا تخترع هوية المستخدم أو المستأجر.
2. قبل استخدام شخص أو مشروع، استدع find_person أو find_project. إذا وجدت أكثر من نتيجة فلا تختار عشوائيًا؛ اطلب توضيحًا، إلا إذا احتوى السياق السابق على اختيار واضح. إذا وجدت نتيجة واحدة، أكمل العملية باستخدام ID الذي أعادته الأداة، ولا تعتبر البحث نهاية الجولة.
3. نفّذ الخطوات الآمنة المطلوبة في رسالة واحدة، ولا تقل إن شيئًا تم إلا إذا أعادت الأداة نجاحًا.
4. لا تعرض أسماء الأدوات أو تفاصيل النظام للمستخدم. رد بالعربية الطبيعية عندما تكون الرسالة بالعربية.
5. لا تنشئ ذاكرة دائمة من المحادثة. استخدم recall_context للبيانات القانونية المحفوظة.
6. عند إنشاء شخص أو مشروع، لا تضف هاتفًا أو بريدًا أو صفة أو علاقة لم يذكرها المستخدم.
7. سياق المحادثة السابق مؤقت لفهم الإشارات والتصحيحات، وليس مصدرًا قانونيًا. استخدم الأدوات للتحقق من Structured Memory.
8. عبارات مثل "قصدي ده" و"غيره" و"خليه" تشير إلى السياق القريب. حلّ المرجع من Conversation State، ثم تحقق من السجل بالأداة المناسبة.
9. إذا كانت النية واضحة والمعلومة ناقصة، اسأل عن المعلومة الناقصة فقط؛ لا تطلب إعادة صياغة الطلب كاملًا.
10. عند وجود عدة نتائج من أداة، لا تنسخ JSON أو تسرد الصفوف. استخدم العدد والإجمالي المحسوبين من الأداة، واذكر التوزيع على المشاريع عند الحاجة. اعرض التفاصيل الفردية فقط إذا طلبها المستخدم.
11. اعتبر حالة المحادثة المنظمة سياقًا لفهم الإشارات فقط؛ تحقق دائمًا من IDs عبر الأدوات.
12. لا تذكر رقمًا ماليًا أو عددًا ماليًا من الذاكرة أو التخمين. بعد الأدوات استخدم final_response، وضع كل رقم مالي مؤكد في groundedFacts كما أعادته الأداة. اجعل الرسالة طبيعية وليست قالبًا.
13. لا تستخدم final_response قبل إكمال الأدوات اللازمة. إذا كانت البيانات ناقصة أو الأسماء متكررة، اجعل kind = clarification بدل التخمين.
14. إذا فشل مزود، لا تعرض رسالة تقنية ولا تقل إن الكتابة تمت. استخدم final_response برسالة عربية قصيرة توضّح أن الطلب لم يكتمل وأن البيانات لم تتغير.
15. ${RETRIEVED_MEMORY_SAFETY_RULE}`;

const expenseSystemGuidance = `قواعد المصروفات عند ارتباط الطلب بها:
- لا تسجل مصروفًا قبل حل الشخص أو المشروع عند الحاجة. لا تنشئ الشخص تلقائيًا إذا لم يوجد؛ يمكن تسجيل المصروف بدون personId لأن المستلم اختياري. استخدم amountMinor عددًا صحيحًا بوحدات العملة الصغرى، لا رقمًا عائمًا.
- إذا لم يذكر المستخدم العملة في سياق عربي مصري، استخدم EGP افتراضيًا؛ لا تغيّر العملة التي أعادتها قاعدة البيانات.
- إذا صحح المستخدم مبلغًا أو وصفًا لعملية سابقة، استخدم update_expense على expenseId السابق ولا تنشئ مصروفًا جديدًا.
- افهم مرادفات الدفع والإعطاء والاستلام الطبيعية، ولا تجعل علامات الترقيم شرطًا للفهم.
- لا تحسب الإجمالي بنفسك إذا أعادت الأداة total أو summary. amountMinor وtotalMinor بوحدات العملة الصغرى؛ استخدم قيمة الأداة وحوّلها إلى الوحدة الرئيسية مرة واحدة فقط.
- عند تسجيل مصروف، المستلم اختياري: إذا لم يذكره المستخدم أو لم تعثر find_person على نتيجة، أكمل بدون personId؛ وإذا وجدت شخصًا واحدًا فاستخدم ID الذي أعادته الأداة.
- قبل اعتماد المصروف اسأل عن المشروع أو الغرض إذا لم يذكره المستخدم. خزّن الغرض في description، ولا تنشئ مشروعًا من تلقاء نفسك؛ اعتبره مشروعًا فقط بعد التحقق أو تأكيد المستخدم.
`;

const expenseRequestGuidance = `إرشادات طلبات المصروفات:
- جملة دفع أو إعطاء أو استلام فيها اسم شخص ومبلغ تعني نية تسجيل مصروف، حتى دون كلمة "مصروف" أو ذكر العملة. نفّذ find_person ثم record_expense؛ استخدم personId عند وجود نتيجة واحدة، وإلا سجّل دون ربط بالشخص إذا كان الطلب واضحًا. لا تنفّذ الكتابة قبل الموافقة المعتادة.
- إذا كان السؤال عن إجمالي وصف أو فئة مثل "التشطيبات" دون مشروع صريح، استخدم query_expenses مع description ولا تنشئ مشروعًا باسم الفئة.
- لسؤال "محمد أخد مني كام؟" استخدم find_person ثم get_person_expense_total.
- قبل عرض إجمالي عام استخدم audit_expense_units. إذا وُجد سجل يحتاج مراجعة بشرية فلا تعرض الإجمالي ولا تعدّل السجل.
- استخدم period = last_month أو this_month أو last_week أو this_week للعبارات النسبية، ودع الخادم يحسب الحدود.
- عند استبعاد مشروع معروف في السياق استخدم excludeProjectId بعد التحقق من المشروع.
`;

const personMutationGuidance = `إرشادات إنشاء الأشخاص عند طلبه:
- استخدم create_person فقط عندما يطلب المستخدم صراحة إضافة أو إنشاء شخص. الاسم وحده ليس طلب إنشاء. إذا قال المستخدم إن الشخص موجود بالفعل فلا تنشئه؛ استخدم find_person عند الحاجة، واطلب التوضيح إذا لم تكن هناك عملية واضحة بدل تسجيل مصروف.
`;

const agentWorkGuidance = `عند طلب متابعة مستمرة أو إجراء خارجي لمرة واحدة، استخدم create_agent_work بعد التحقق من الطلب. لمراقبة repository عام على GitHub استخدم github_repository مع owner وrepository وmetric وoperator وthreshold، ولا تستخدم URL من المستخدم كمصدر مباشر. اترك condition وschedule فارغين لإجراء external_action لمرة واحدة، ولا تتصل بأي مزود قبل موافقة مستقلة على تفاصيل الإجراء. ${externalActionToolGuidance()}`;

const reminderGuidance = `عند طلب تذكير أو موعد بيوم نسبي مثل "بكرة" دون ساعة دقيقة، اسأل عن الوقت بشكل اختياري. اقبل ساعة مثل "5 مساءً" أو "أي وقت" واستخدم 09:00 بتوقيت Africa/Cairo. لا تنفّذ التذكير قبل اكتمال dueAt.`;

type ProviderInstructionParts = {
  text: string;
  systemPrompt: string;
  requestGuidance: string;
};

const FINANCIAL_QUERY_PATTERN = /إجمالي|اجمالي|مجموع|كام|كم|قد\s*إيه|قد\s*ايه|total|sum|how much|which project/i;
const PERSON_MUTATION_PATTERN = /شخص|شخصًا|الاسم|بيانات.*شخص|اضف.*شخص|أضف.*شخص|ضيف.*شخص|person|contact/i;
const PERSON_EXISTS_PATTERN = /موجود(?:ة)?(?:\s+بالفعل)?|already exists|is already there/i;
const AGENT_WORK_PATTERN = /تابع|متابعة|كرر.*(?:عمل|شغل|مهمة)|تذك(?:ّ)?ر.{0,30}(?:عمل|شغل|مهم(?:ة|ه)).{0,20}(?:لاحق|بعد|بعدين)|راقب|مراقبة|github|repository|repo|follow[\s-]*up|monitor|watch|repeat/i;
const REMINDER_WRITE_PATTERN = /فكرني|ذكرني|تذكير|تذكّر|موعد|بكره|بكرة|غدا|غدًا|remind|reminder/i;

export function buildProviderInstructions(
  context: Pick<GatewayCallContext, "currentUserMessage" | "toolScope">,
): ProviderInstructionParts {
  const message = context.currentUserMessage ?? "";
  const scope = context.toolScope;
  const noScopeProvided = scope === undefined;
  const financialCue = TOOL_SCOPE_PATTERNS.expense.test(message)
    || /(?:اخد|اخذ)\s+مني/i.test(message.normalize("NFKC").replace(/[أإآٱ]/g, "ا"));
  const includeExpense = noScopeProvided || scope?.name === "expense" || financialCue;
  const includeExpenseQuery = includeExpense
    && (scope?.name === "read_only"
      || FINANCIAL_QUERY_PATTERN.test(message)
      || (financialCue && !WRITE_INTENT_PATTERN.test(message)));
  const includeExpenseWrite = noScopeProvided
    || scope?.name === "expense"
    || (scope?.isFull === true && financialCue && WRITE_INTENT_PATTERN.test(message));
  const includePersonMutation = noScopeProvided
    || scope?.name === "person"
    || (scope?.isFull === true
      && PERSON_MUTATION_PATTERN.test(message)
      && WRITE_INTENT_PATTERN.test(message))
    || (scope?.isFull === true && PERSON_EXISTS_PATTERN.test(message))
    || (scope?.name === "expense" && PERSON_EXISTS_PATTERN.test(message));
  const agentToolAvailable = noScopeProvided
    || scope?.isFull === true
    || scope?.allowedToolNames.has("create_agent_work") === true
    || scope?.allowedToolNames.has("github_repository") === true;
  const includeAgentWork = noScopeProvided
    || (agentToolAvailable && AGENT_WORK_PATTERN.test(message));
  const reminderToolAvailable = noScopeProvided
    || scope?.isFull === true
    || scope?.allowedToolNames.has("create_reminder") === true;
  const includeReminder = noScopeProvided
    || (reminderToolAvailable
      && (scope?.name === "reminder"
        || (scope?.isFull === true
          && REMINDER_WRITE_PATTERN.test(message)
          && WRITE_INTENT_PATTERN.test(message))));

  const conditionalSystem = [
    includeExpense ? expenseSystemGuidance : "",
    includeAgentWork ? agentWorkGuidance : "",
    includeReminder ? reminderGuidance : "",
  ].filter(Boolean);
  const systemPrompt = [systemInstruction, ...conditionalSystem].join("\n");
  const conditionalRequest = [
    includeExpense && (includeExpenseQuery || includeExpenseWrite) ? expenseRequestGuidance : "",
    includePersonMutation ? personMutationGuidance : "",
  ].filter(Boolean);
  const requestGuidance = conditionalRequest.join("\n");
  return {
    text: requestGuidance ? `${systemPrompt}\n${requestGuidance}` : systemPrompt,
    systemPrompt,
    requestGuidance,
  };
}

function parseJsonObject(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function createGatewayMetrics(): GatewayRequestMetrics {
  return {
    logicalLlmCalls: 0,
    httpAttempts: 0,
    httpAttemptsByProvider: {},
    httpAttemptsByRoute: {},
    retryCount: 0,
    providerFallbackAttempts: 0,
    modelFallbackAttempts: 0,
    requestBytesByProvider: {},
    requestBytesByRoute: {},
    maxRequestBytes: 0,
    systemPromptChars: 0,
    toolDefinitionsChars: 0,
    toolDefinitionsCount: 0,
    maxConversationChars: 0,
    cacheHit: false,
    cacheMiss: false,
    cachedTokens: 0,
    attempts: [],
  };
}

function finiteTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function nestedValue(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function normalizeLlmUsage(usageFormat: LlmUsageFormat, usage: unknown): NormalizedLlmUsage {
  if (!usage || typeof usage !== "object") {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cachedTokens: null,
      completeness: "unavailable",
    };
  }

  const value = usage as Record<string, unknown>;
  const inputTokens = usageFormat === "gemini"
    ? finiteTokenCount(value.promptTokenCount)
    : finiteTokenCount(value.prompt_tokens)
      ?? finiteTokenCount(value.input_tokens)
      ?? finiteTokenCount(nestedValue(value, ["tokens", "input_tokens"]))
      ?? finiteTokenCount(nestedValue(value, ["billed_units", "input_tokens"]));
  const outputTokens = usageFormat === "gemini"
    ? finiteTokenCount(value.candidatesTokenCount)
    : finiteTokenCount(value.completion_tokens)
      ?? finiteTokenCount(value.output_tokens)
      ?? finiteTokenCount(nestedValue(value, ["tokens", "output_tokens"]))
      ?? finiteTokenCount(nestedValue(value, ["billed_units", "output_tokens"]));
  const directTotal = usageFormat === "gemini"
    ? finiteTokenCount(value.totalTokenCount)
    : finiteTokenCount(value.total_tokens);
  const totalTokens = directTotal ?? (
    inputTokens !== null && outputTokens !== null
      ? inputTokens + outputTokens
      : null
  );
  const cachedTokens = usageFormat === "gemini"
    ? finiteTokenCount(value.cachedContentTokenCount)
    : finiteTokenCount(value.cached_tokens)
      ?? finiteTokenCount(nestedValue(value, ["prompt_tokens_details", "cached_tokens"]));
  const knownParts = [inputTokens, outputTokens, totalTokens].filter((part) => part !== null).length;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedTokens,
    completeness: knownParts === 3 ? "complete" : knownParts > 0 ? "partial" : "unavailable",
  };
}

export function normalizeProviderUsage(provider: ProviderName, usage: unknown): NormalizedLlmUsage {
  const usageFormat: LlmUsageFormat = provider === "gemini"
    ? "gemini"
    : provider === "cohere"
      ? "cohere"
      : "openai-compatible";
  return normalizeLlmUsage(usageFormat, usage);
}

function contextBreakdown(
  messages: ConversationMessage[],
  currentUserMessage: string | undefined,
  requestBytes: number,
  toolDefinitionsChars: number,
  instructions: ProviderInstructionParts,
): LlmContextBreakdown {
  const currentUser = currentUserMessage ?? "";
  let currentUserConsumed = false;
  let userMessageChars = 0;
  let recentConversationChars = 0;
  let summaryChars = 0;
  let structuredStateChars = 0;
  let toolResultChars = 0;
  let otherConversationChars = 0;

  for (const message of messages) {
    const textChars = message.text?.length ?? 0;
    if (message.role === "user") {
      if (!currentUserConsumed && currentUser && message.text === currentUser) {
        currentUserConsumed = true;
        userMessageChars += textChars;
      } else {
        recentConversationChars += textChars;
      }
      continue;
    }
    if (message.role === "tool") {
      toolResultChars += textChars;
      continue;
    }
    if (message.role === "system") {
      if (message.text?.startsWith("[ملخص محادثة سابق")) {
        summaryChars += textChars;
      } else if (message.text?.startsWith("[حالة المحادثة المنظمة")) {
        structuredStateChars += textChars;
      } else {
        otherConversationChars += textChars;
      }
      continue;
    }
    recentConversationChars += textChars;
  }

  return {
    systemPromptChars: instructions.systemPrompt.length,
    requestGuidanceChars: instructions.requestGuidance.length,
    userMessageChars,
    recentConversationChars,
    summaryChars,
    structuredStateChars,
    toolResultChars,
    otherConversationChars,
    conversationChars: messages.reduce((total, message) => total + (message.text?.length ?? 0), 0),
    toolDefinitionsChars,
    requestBytes,
    systemPromptTokens: null,
    conversationTokens: null,
    toolDefinitionsTokens: null,
    toolResultTokens: null,
  };
}

type LlmAttemptStart = {
  provider: ProviderName;
  route: InferenceRoute;
  usageFormat: LlmUsageFormat;
  model: string;
  attemptNumber: number;
  scope: ToolScope["name"] | null;
  toolsAvailable: string[];
  startedAt: number;
  fallback: boolean;
  retry: boolean;
  cacheHit: boolean;
  cacheRetry: boolean;
  context: LlmContextBreakdown;
};

function beginLlmAttempt(
  context: GatewayCallContext,
  provider: ProviderName,
  model: string,
  payload: {
    route: InferenceRoute;
    usageFormat: LlmUsageFormat;
    requestBytes: number;
    systemPromptChars: number;
    toolDefinitionsChars: number;
    toolDefinitionsCount: number;
    toolNames: string[];
    conversationChars: number;
    context: LlmContextBreakdown;
    fallback?: boolean;
    retry?: boolean;
    cacheHit?: boolean;
    cacheRetry?: boolean;
  },
): LlmAttemptStart {
  const metrics = context.metrics;
  if (!metrics) {
    return {
      provider,
      route: payload.route,
      usageFormat: payload.usageFormat,
      model,
      attemptNumber: 1,
      scope: context.toolScope?.name ?? null,
      toolsAvailable: payload.toolNames,
      startedAt: Date.now(),
      fallback: payload.fallback ?? false,
      retry: payload.retry ?? false,
      cacheHit: payload.cacheHit ?? false,
      cacheRetry: payload.cacheRetry ?? false,
      context: payload.context,
    };
  }
  if (metrics.httpAttempts >= MAX_PROVIDER_HTTP_ATTEMPTS) {
    throw new SecretaryError("The provider request budget was exhausted.", {
      status: 503,
      category: "provider_unavailable",
      code: "PROVIDER_HTTP_ATTEMPT_BUDGET_EXCEEDED",
      retryable: false,
      provider,
    });
  }
  metrics.httpAttempts += 1;
  if (payload.retry) metrics.retryCount += 1;
  metrics.httpAttemptsByProvider[provider] = (metrics.httpAttemptsByProvider[provider] ?? 0) + 1;
  metrics.httpAttemptsByRoute ??= {};
  metrics.httpAttemptsByRoute[payload.route.id] = (metrics.httpAttemptsByRoute[payload.route.id] ?? 0) + 1;
  metrics.requestBytesByProvider[provider] = (metrics.requestBytesByProvider[provider] ?? 0) + payload.requestBytes;
  metrics.requestBytesByRoute ??= {};
  metrics.requestBytesByRoute[payload.route.id] = (metrics.requestBytesByRoute[payload.route.id] ?? 0) + payload.requestBytes;
  metrics.maxRequestBytes = Math.max(metrics.maxRequestBytes, payload.requestBytes);
  metrics.systemPromptChars = Math.max(metrics.systemPromptChars, payload.systemPromptChars);
  metrics.toolDefinitionsChars = Math.max(metrics.toolDefinitionsChars, payload.toolDefinitionsChars);
  metrics.toolDefinitionsCount = Math.max(metrics.toolDefinitionsCount, payload.toolDefinitionsCount);
  metrics.maxConversationChars = Math.max(metrics.maxConversationChars, payload.conversationChars);
  return {
    provider,
    route: payload.route,
    usageFormat: payload.usageFormat,
    model,
    attemptNumber: metrics.httpAttempts,
    scope: context.toolScope?.name ?? null,
    toolsAvailable: payload.toolNames,
    startedAt: Date.now(),
    fallback: payload.fallback ?? false,
    retry: payload.retry ?? false,
    cacheHit: payload.cacheHit ?? false,
    cacheRetry: payload.cacheRetry ?? false,
    context: payload.context,
  };
}

function finishLlmAttempt(
  context: GatewayCallContext,
  attempt: LlmAttemptStart,
  usage: unknown,
  outcome: {
    success: boolean;
    failureReason?: string | null;
    outputChars?: number;
  },
): void {
  const metrics = context.metrics;
  if (!metrics) return;
  const normalized = normalizeLlmUsage(attempt.usageFormat, usage);
  const entry: LlmUsageAttempt = {
    requestId: context.requestId,
    conversationId: context.conversationId ?? null,
    provider: attempt.provider,
    routeId: attempt.route.id,
    routeKind: attempt.route.kind,
    routeTargetId: routeTargetId(attempt.route),
    modelId: attempt.route.model.id,
    usageFormat: attempt.usageFormat,
    model: attempt.model,
    logicalCallNumber: context.callNumber,
    attemptNumber: attempt.attemptNumber,
    scope: attempt.scope,
    toolsAvailable: attempt.toolsAvailable,
    inputTokens: normalized.inputTokens,
    outputTokens: normalized.outputTokens,
    totalTokens: normalized.totalTokens,
    cachedTokens: normalized.cachedTokens,
    systemPromptTokens: attempt.context.systemPromptTokens,
    conversationTokens: attempt.context.conversationTokens,
    toolDefinitionsTokens: attempt.context.toolDefinitionsTokens,
    toolResultTokens: attempt.context.toolResultTokens,
    cacheHit: attempt.cacheHit,
    cacheRetry: attempt.cacheRetry,
    fallback: attempt.fallback,
    retry: attempt.retry,
    httpRequestSent: true,
    latencyMs: Date.now() - attempt.startedAt,
    success: outcome.success,
    failureReason: outcome.failureReason ?? null,
    outputChars: outcome.outputChars ?? 0,
    context: attempt.context,
  };
  metrics.attempts.push(entry);
  logger.info({
    requestId: entry.requestId,
    conversationId: entry.conversationId,
    provider: entry.provider,
    routeId: entry.routeId,
    routeKind: entry.routeKind,
    routeTargetId: entry.routeTargetId,
    modelId: entry.modelId,
    usageFormat: entry.usageFormat,
    model: entry.model,
    logicalCallNumber: entry.logicalCallNumber,
    attemptNumber: entry.attemptNumber,
    scope: entry.scope,
    toolsAvailable: entry.toolsAvailable,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    totalTokens: entry.totalTokens,
    usageCompleteness: normalized.completeness,
    systemPromptTokens: entry.systemPromptTokens,
    conversationTokens: entry.conversationTokens,
    toolDefinitionsTokens: entry.toolDefinitionsTokens,
    toolResultTokens: entry.toolResultTokens,
    cacheHit: entry.cacheHit,
    cacheRetry: entry.cacheRetry,
    fallback: entry.fallback,
    retry: entry.retry,
    httpRequestSent: entry.httpRequestSent,
    latencyMs: entry.latencyMs,
    success: entry.success,
    failureReason: entry.failureReason,
    context: entry.context,
  }, "agent llm usage attempt");
}

function sumMeasured(values: Array<number | null>): number | null {
  const measured = values.filter((value): value is number => value !== null);
  return measured.length > 0 ? measured.reduce((total, value) => total + value, 0) : null;
}

function summarizeGatewayMetrics(
  metrics: GatewayRequestMetrics,
  totalToolCalls: number,
  requestLatencyMs: number,
  diagnosticCalls: DiagnosticLogicalCall[] = [],
): LlmUsageSummary {
  const attempts = metrics.attempts;
  const inputTokens = sumMeasured(attempts.map((attempt) => attempt.inputTokens));
  const outputTokens = sumMeasured(attempts.map((attempt) => attempt.outputTokens));
  const totalTokens = sumMeasured(attempts.map((attempt) => attempt.totalTokens));
  const totalCachedTokens = sumMeasured(attempts.map((attempt) => attempt.cachedTokens));
  const allTokenFieldsMeasured = attempts.length > 0
    && attempts.every((attempt) =>
      attempt.inputTokens !== null
      && attempt.outputTokens !== null
      && attempt.totalTokens !== null);
  const someTokenFieldMeasured = attempts.some((attempt) =>
    attempt.inputTokens !== null
    || attempt.outputTokens !== null
    || attempt.totalTokens !== null);
  const context = attempts.length === 0
    ? {
        systemPromptChars: null,
        requestGuidanceChars: null,
        userMessageChars: null,
        recentConversationChars: null,
        summaryChars: null,
        structuredStateChars: null,
        toolResultChars: null,
        otherConversationChars: null,
        conversationChars: null,
        toolDefinitionsChars: null,
        requestBytes: null,
      }
    : attempts.reduce((total, attempt) => ({
        systemPromptChars: total.systemPromptChars + attempt.context.systemPromptChars,
        requestGuidanceChars: total.requestGuidanceChars + attempt.context.requestGuidanceChars,
        userMessageChars: total.userMessageChars + attempt.context.userMessageChars,
        recentConversationChars: total.recentConversationChars + attempt.context.recentConversationChars,
        summaryChars: total.summaryChars + attempt.context.summaryChars,
        structuredStateChars: total.structuredStateChars + attempt.context.structuredStateChars,
        toolResultChars: total.toolResultChars + attempt.context.toolResultChars,
        otherConversationChars: total.otherConversationChars + attempt.context.otherConversationChars,
        conversationChars: total.conversationChars + attempt.context.conversationChars,
        toolDefinitionsChars: total.toolDefinitionsChars + attempt.context.toolDefinitionsChars,
        requestBytes: total.requestBytes + attempt.context.requestBytes,
      }), {
        systemPromptChars: 0,
        requestGuidanceChars: 0,
        userMessageChars: 0,
        recentConversationChars: 0,
        summaryChars: 0,
        structuredStateChars: 0,
        toolResultChars: 0,
        otherConversationChars: 0,
        conversationChars: 0,
        toolDefinitionsChars: 0,
        requestBytes: 0,
      });
  return {
    totalLogicalLlmCalls: metrics.logicalLlmCalls,
    totalHttpAttempts: metrics.httpAttempts,
    totalInputTokens: inputTokens,
    totalOutputTokens: outputTokens,
    totalTokens,
    totalCachedTokens,
    usageCompleteness: allTokenFieldsMeasured
      ? "complete"
      : someTokenFieldMeasured
        ? "partial"
        : "unavailable",
    totalToolCalls,
    fallbackCount: attempts.filter((attempt) => attempt.fallback).length,
    retryCount: metrics.retryCount,
    cacheHit: metrics.cacheHit ?? false,
    cacheMiss: metrics.cacheMiss ?? false,
    latencyMs: requestLatencyMs,
    context,
  };
}

function buildDiagnosticTrace(
  metrics: GatewayRequestMetrics,
  diagnosticCalls: DiagnosticLogicalCall[],
): Phase2DiagnosticTrace {
  return {
    version: 1,
    calls: diagnosticCalls.map((call) => ({
      ...call,
      attempts: metrics.attempts.filter(
        (attempt) => attempt.logicalCallNumber === call.logicalCallNumber,
      ),
    })),
  };
}

function recordProviderRequest(
  context: GatewayCallContext,
  provider: ProviderName,
  payload: {
    requestBytes: number;
    systemPromptChars: number;
    toolDefinitionsChars: number;
    toolDefinitionsCount: number;
    toolNames?: string[];
    conversationChars: number;
    model?: string;
    route?: InferenceRoute;
    routeKind?: InferenceRouteKind;
    usageFormat?: LlmUsageFormat;
    context?: LlmContextBreakdown;
    fallback?: boolean;
    retry?: boolean;
    cacheHit?: boolean;
    cacheRetry?: boolean;
  },
): LlmAttemptStart {
  const model = payload.model ?? provider;
  const route = routeWithModel(
    payload.route
      ?? context.route
      ?? (payload.routeKind === "gateway"
        ? gatewayRoute(provider, model)
        : directProviderRoute(provider, model)),
    model,
  );
  return beginLlmAttempt(context, provider, model, {
    ...payload,
    route,
    usageFormat: payload.usageFormat ?? "openai-compatible",
    toolNames: payload.toolNames ?? [],
    context: payload.context ?? contextBreakdown(
      [],
      context.currentUserMessage,
      payload.requestBytes,
      payload.toolDefinitionsChars,
      buildProviderInstructions(context),
    ),
  });
}

function compactToolResultForPrompt(toolResult: ToolResult): string {
  const compact = compactActionForMemory({ toolResult: jsonSafe(toolResult) }) as { toolResult?: unknown } | undefined;
  return JSON.stringify(compact?.toolResult ?? toolResult);
}

function expenseContinuationGuidance(
  parsed: SemanticParse | null,
  toolName: string,
  toolResult: ToolResult,
): string | null {
  if (
    toolName !== "find_person"
    || parsed?.intent !== "record_expense"
    || !parsed.amount
    || parsed.ambiguous
    || !toolResult.ok
  ) return null;

  const matches = Array.isArray(toolResult.matches)
    ? toolResult.matches.filter((match): match is { id?: unknown; name?: unknown } =>
        Boolean(match) && typeof match === "object")
    : [];
  if (matches.length > 1) return null;

  if (matches.length === 1 && typeof matches[0]?.id === "string") {
    const name = typeof matches[0].name === "string" ? matches[0].name : "الشخص الذي تم العثور عليه";
    return `نتيجة البحث: تم العثور على شخص واحد فقط (${name}) بالمعرّف ${matches[0].id}. هذا ليس نهاية الجولة. استخدم هذا المعرّف في personId ثم استدع record_expense الآن لإكمال طلب المصروف الأصلي بالمبلغ والغرض المذكورين. لا تستدع find_person مرة أخرى ولا تستخدم final_response قبل تجهيز المصروف.`;
  }

  return "نتيجة البحث: لم يتم العثور على شخص مطابق. هذا ليس نهاية الجولة: لا تنشئ شخصًا جديدًا، لأن ربط المستلم اختياري في المصروف. بما أن طلب المستخدم المالي واضح ويحتوي على مبلغ، استدع record_expense الآن بدون personId لإكمال التسجيل، ثم انتظر مسار الموافقة المعتاد. لا تستخدم final_response قبل تجهيز المصروف.";
}

function diagnosticToolResult(toolResult: ToolResult): DiagnosticToolResult {
  const safeResult = jsonSafe(toolResult);
  const serialized = JSON.stringify(safeResult);
  const promptResult = compactToolResultForPrompt(toolResult);
  const record = safeResult && typeof safeResult === "object"
    ? safeResult as Record<string, unknown>
    : {};
  return {
    ok: typeof record.ok === "boolean" ? record.ok : null,
    keys: Object.keys(record).sort(),
    resultChars: serialized.length,
    resultBytes: Buffer.byteLength(serialized),
    promptChars: promptResult.length,
    pendingApproval: record.pendingApproval === true,
    errorCode: typeof record.errorCode === "string" ? record.errorCode : null,
  };
}

function diagnosticSelectedTool(call: GatewayToolCall): DiagnosticSelectedTool {
  const safeArguments = jsonSafe(call.args) as Record<string, unknown>;
  const serialized = JSON.stringify(safeArguments);
  return {
    callId: call.id,
    name: call.name,
    arguments: safeArguments,
    argumentChars: serialized.length,
    argumentBytes: Buffer.byteLength(serialized),
    result: null,
  };
}

function toGeminiContents(messages: ConversationMessage[]): Array<{ role: string; parts: GeminiPart[] }> {
  return budgetMessages(messages).map((message) => {
    if (message.role === "system") {
      return { role: "user", parts: [{ text: `[سياق موثوق من التطبيق]\n${message.text ?? ""}` }] };
    }
    if (message.role === "assistant") {
      const hasUnsignedToolCall = (message.toolCalls ?? []).some((call) => !call.thoughtSignature);
      if (hasUnsignedToolCall) {
        return {
          role: "user",
          parts: [{
            text: `[سياق من مزود آخر]\n${message.text ?? ""}\nتم طلب أدوات في الرسالة السابقة، وستجد نتائجها في الرسائل التالية.`,
          }],
        };
      }
      return {
        role: "model",
        parts: [
          ...(message.text ? [{ text: message.text }] : []),
          ...(message.toolCalls ?? []).map((call) => ({
            functionCall: { name: call.name, args: call.args },
            ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
          })),
        ],
      };
    }
    if (message.role === "tool") {
      const matchingCall = messages
        .flatMap((item) => item.toolCalls ?? [])
        .find((call) => call.id === message.toolCallId);
      if (!matchingCall?.thoughtSignature) {
        return {
          role: "user",
          parts: [{
            text: `[نتيجة أداة من مزود آخر: ${message.toolName ?? "أداة"}]\n${message.text ?? "{}"}`,
          }],
        };
      }
      return {
        role: "user",
        parts: [{
          functionResponse: {
            name: message.toolName ?? "tool",
            response: parseJsonObject(message.text),
          },
        }],
      };
    }
    return { role: "user", parts: [{ text: message.text ?? "" }] };
  });
}

export function toOpenAiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toOpenAiSchema);
  if (!value || typeof value !== "object") {
    return typeof value === "string" && ["OBJECT", "STRING", "INTEGER", "NUMBER", "BOOLEAN", "ARRAY", "NULL"].includes(value)
      ? value.toLowerCase()
      : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, toOpenAiSchema(child)]),
  );
}

export function toCohereSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    const isTypeUnion = value.length > 0
      && value.every((item) => typeof item === "string"
        && ["OBJECT", "STRING", "INTEGER", "NUMBER", "BOOLEAN", "ARRAY", "NULL"].includes(item));
    if (isTypeUnion) {
      const nonNullType = value.find((item) => item !== "NULL");
      return nonNullType === undefined ? "string" : toCohereSchema(nonNullType);
    }
    return value.map(toCohereSchema);
  }
  if (!value || typeof value !== "object") {
    return typeof value === "string"
      && ["OBJECT", "STRING", "INTEGER", "NUMBER", "BOOLEAN", "ARRAY", "NULL"].includes(value)
      ? value.toLowerCase()
      : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, toCohereSchema(child)]),
  );
}

export function toGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    const isTypeUnion = value.length > 0
      && value.every((item) => typeof item === "string"
        && ["OBJECT", "STRING", "INTEGER", "NUMBER", "BOOLEAN", "ARRAY", "NULL"].includes(item));
    if (!isTypeUnion) return value.map(toGeminiSchema);
    const nonNullType = value.find((item) => item !== "NULL");
    return nonNullType === undefined ? undefined : toGeminiSchema(nonNullType);
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, child]) => [key, toGeminiSchema(child)] as const)
      .filter(([, child]) => child !== undefined),
  );
}

function toOpenAiTools(scope?: ToolScope, finalResponseOnly = false) {
  return scopedToolDefinitions(scope, finalResponseOnly).map((definition) => ({
    type: "function",
    function: {
      name: definition.name,
      description: definition.description,
      parameters: toOpenAiSchema(definition.parameters),
    },
  }));
}

function toCohereTools(scope?: ToolScope, finalResponseOnly = false) {
  return scopedToolDefinitions(scope, finalResponseOnly).map((definition) => ({
    type: "function",
    function: {
      name: definition.name,
      description: definition.description,
      parameters: toCohereSchema(definition.parameters),
    },
  }));
}

function toGeminiTools(scope?: ToolScope, finalResponseOnly = false) {
  return scopedToolDefinitions(scope, finalResponseOnly).map((definition) => ({
    ...definition,
    parameters: toGeminiSchema(definition.parameters),
  }));
}

export class GeminiModelGateway implements ModelGateway {
  readonly provider = "gemini" as const;
  readonly routeKind = "direct_provider" as const;
  readonly usageFormat = "gemini" as const;
  private readonly apiKey = process.env.GEMINI_API_KEY;
  private readonly model = GEMINI_MODEL;
  private activeModel = GEMINI_MODEL;
  private readonly cachedContents = new Map<string, {
    name: string;
    expiresAt: number;
  }>();
  private readonly cacheCreationFlights = new Map<string, Promise<string | null>>();
  private cacheUnavailableUntil = 0;

  get modelName(): string {
    return this.activeModel;
  }

  private cachedContentKey(
    model: string,
    systemText: string,
    toolDefinitions: unknown[],
    finalResponseOnly: boolean,
  ): string {
    return JSON.stringify({
      model,
      systemText,
      toolDefinitions,
      finalResponseOnly,
    });
  }

  private invalidateCachedContent(cacheKey: string): void {
    this.cachedContents.delete(cacheKey);
  }

  private async createCachedContent(
    model: string,
    systemText: string,
    toolDefinitions: unknown[],
    cacheKey: string,
    requestId: string,
    deadlineAt?: number,
  ): Promise<string | null> {
    const existingFlight = this.cacheCreationFlights.get(cacheKey);
    if (existingFlight) return existingFlight;

    const creation = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutForDeadline(deadlineAt, 10_000));
      const startedAt = Date.now();
      try {
        const response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/cachedContents",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": this.apiKey ?? "",
            },
            body: JSON.stringify({
              model: model.startsWith("models/") ? model : `models/${model}`,
              systemInstruction: { parts: [{ text: systemText }] },
              tools: [{ functionDeclarations: toolDefinitions }],
              toolConfig: { functionCallingConfig: { mode: "AUTO" } },
              ttl: `${GEMINI_CONTEXT_CACHE_TTL_SECONDS}s`,
            }),
            signal: controller.signal,
          },
        );
        const raw = await response.text();
        if (!response.ok) {
          this.cacheUnavailableUntil = Date.now() + GEMINI_CONTEXT_CACHE_FAILURE_COOLDOWN_MS;
          logger.warn({
            requestId,
            provider: this.provider,
            model,
            status: response.status,
            latencyMs: Date.now() - startedAt,
          }, "gemini context cache unavailable");
          return null;
        }
        const parsed = JSON.parse(raw) as GeminiCachedContentResponse;
        if (!parsed.name) {
          logger.warn({
            requestId,
            provider: this.provider,
            model,
            latencyMs: Date.now() - startedAt,
          }, "gemini context cache returned no name");
          return null;
        }
        this.cachedContents.set(cacheKey, {
          name: parsed.name,
          expiresAt: Date.now() + GEMINI_CONTEXT_CACHE_TTL_MS - GEMINI_CONTEXT_CACHE_EXPIRY_SAFETY_MS,
        });
        logger.info({
          requestId,
          provider: this.provider,
          model,
          cacheName: parsed.name,
          ttlSeconds: GEMINI_CONTEXT_CACHE_TTL_SECONDS,
          latencyMs: Date.now() - startedAt,
        }, "gemini context cache created");
        return parsed.name;
      } catch (error) {
        this.cacheUnavailableUntil = Date.now() + GEMINI_CONTEXT_CACHE_FAILURE_COOLDOWN_MS;
        logger.warn({
          requestId,
          provider: this.provider,
          model,
          error: error instanceof Error ? error.message : String(error),
        }, "gemini context cache creation failed");
        return null;
      } finally {
        clearTimeout(timeout);
        this.cacheCreationFlights.delete(cacheKey);
      }
    })();
    this.cacheCreationFlights.set(cacheKey, creation);
    return creation;
  }

  private async resolveCachedContent(
    model: string,
    systemText: string,
    toolDefinitions: unknown[],
    finalResponseOnly: boolean,
    requestId: string,
    metrics?: GatewayRequestMetrics,
    deadlineAt?: number,
  ): Promise<{ name?: string; cacheKey: string; hit: boolean }> {
    const cacheKey = this.cachedContentKey(model, systemText, toolDefinitions, finalResponseOnly);
    const cached = this.cachedContents.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      if (metrics) metrics.cacheHit = true;
      return { name: cached.name, cacheKey, hit: true };
    }
    this.cachedContents.delete(cacheKey);
    if (metrics) metrics.cacheMiss = true;
    if (this.cacheUnavailableUntil > Date.now()) {
      return { cacheKey, hit: false };
    }
    const name = await this.createCachedContent(
      model,
      systemText,
      toolDefinitions,
      cacheKey,
      requestId,
      deadlineAt,
    );
    return { name: name ?? undefined, cacheKey, hit: false };
  }

  async generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse> {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not configured.");
    const instructions = buildProviderInstructions(context);
    const systemText = instructions.text;
    const contents = toGeminiContents(messages);
    const toolDefinitions = toGeminiTools(context.toolScope, context.finalResponseOnly);
    let lastError: Error | null = null;
    const models = this.model === GEMINI_FALLBACK_MODEL
      ? [this.model]
      : [this.model, GEMINI_FALLBACK_MODEL];

    for (const [modelIndex, model] of models.entries()) {
      if (modelIndex > 0 && context.metrics) context.metrics.modelFallbackAttempts += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutForDeadline(context.deadlineAt, 25_000));
      const startedAt = Date.now();
      let activeAttempt: LlmAttemptStart | undefined;
      try {
        // Phase2 always supplies metrics. Keeping direct gateway calls without
        // metrics uncached preserves the gateway's existing adapter contract
        // for callers and tests that exercise provider serialization alone.
        const cache = context.metrics
          ? await this.resolveCachedContent(
              model,
              systemText,
              toolDefinitions,
              context.finalResponseOnly ?? false,
              context.requestId,
              context.metrics,
              context.deadlineAt,
            )
          : { name: undefined, cacheKey: "", hit: false };
        let useCachedContent = Boolean(cache.name);
        let cacheFallbackAttempted = false;

        while (true) {
          const requestPayload = {
            ...(useCachedContent
              ? { cachedContent: cache.name }
              : {
                  systemInstruction: { parts: [{ text: systemText }] },
                  tools: [{ functionDeclarations: toolDefinitions }],
                  toolConfig: { functionCallingConfig: { mode: "AUTO" } },
                }),
            contents,
            generationConfig: { temperature: 0.15, maxOutputTokens: 8192 },
          };
          const requestBody = JSON.stringify(requestPayload);
            activeAttempt = recordProviderRequest(context, "gemini", {
              model,
              routeKind: this.routeKind,
              usageFormat: this.usageFormat,
            requestBytes: Buffer.byteLength(requestBody),
            systemPromptChars: systemText.length,
            toolDefinitionsChars: JSON.stringify(toolDefinitions).length,
            toolDefinitionsCount: toolDefinitions.length,
            toolNames: toolDefinitions.map((definition) => definition.name),
            conversationChars: JSON.stringify(contents).length,
              context: contextBreakdown(
                messages,
                context.currentUserMessage,
                Buffer.byteLength(requestBody),
                JSON.stringify(toolDefinitions).length,
                instructions,
              ),
              fallback: Boolean(context.providerFallback) || modelIndex > 0,
              retry: cacheFallbackAttempted,
              cacheRetry: cacheFallbackAttempted,
              cacheHit: useCachedContent && cache.hit,
          });
          logger.info({
            requestId: context.requestId,
            provider: this.provider,
            model,
            llmCall: context.callNumber,
            requestBytes: Buffer.byteLength(requestBody),
            systemPromptChars: systemText.length,
            toolDefinitionsChars: JSON.stringify(toolDefinitions).length,
            toolDefinitionsCount: toolDefinitions.length,
            conversationChars: JSON.stringify(contents).length,
            cacheHit: useCachedContent && cache.hit,
            cacheMiss: context.metrics?.cacheMiss ?? false,
          }, "agent llm call started");

          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-goog-api-key": this.apiKey,
              },
              body: requestBody,
              signal: controller.signal,
            },
          );
          const raw = await response.text();
          if (response.ok) {
            const parsed = JSON.parse(raw) as GeminiResponse;
            const parts = parsed.candidates?.[0]?.content?.parts ?? [];
            const cachedTokens = parsed.usageMetadata?.cachedContentTokenCount ?? 0;
            if (context.metrics) {
              context.metrics.cachedTokens = Math.max(context.metrics.cachedTokens ?? 0, cachedTokens);
            }
            this.activeModel = model;
            const responseResult = {
              text: parts.map((part) => part.text ?? "").join("").trim(),
              toolCalls: parts.flatMap((part, index) => part.functionCall
                ? [{
                    id: `gemini-call-${index}`,
                    name: part.functionCall.name,
                    args: part.functionCall.args ?? {},
                    thoughtSignature: part.functionCall.thoughtSignature ?? part.thoughtSignature,
                  }]
                : []),
              usage: parsed.usageMetadata,
            };
            finishLlmAttempt(context, activeAttempt, responseResult.usage, {
              success: true,
              outputChars: responseResult.text.length + JSON.stringify(responseResult.toolCalls).length,
            });
            activeAttempt = undefined;
            logger.info({
              requestId: context.requestId,
              provider: this.provider,
              model,
              llmCall: context.callNumber,
              toolCalls: responseResult.toolCalls.length,
              cacheHit: useCachedContent && cache.hit,
              cachedTokens,
              latencyMs: Date.now() - startedAt,
            }, "agent llm call completed");
            return responseResult;
          }
          if (useCachedContent && !cacheFallbackAttempted && [400, 404].includes(response.status)) {
            finishLlmAttempt(context, activeAttempt, undefined, {
              success: false,
              failureReason: "GEMINI_CONTEXT_CACHE_REJECTED",
            });
            activeAttempt = undefined;
            this.invalidateCachedContent(cache.cacheKey);
            useCachedContent = false;
            cacheFallbackAttempted = true;
            logger.warn({
              requestId: context.requestId,
              provider: this.provider,
              model,
              status: response.status,
            }, "gemini context cache rejected; retrying without cache");
            continue;
          }
          lastError = providerResponseError(
            "gemini",
            response.status,
            raw,
            parseRetryAfter(response.headers.get("retry-after")),
          );
          if (response.status === 429) throw lastError;
          if (![404, 429, 500, 502, 503, 504].includes(response.status)) throw lastError;
          finishLlmAttempt(context, activeAttempt, undefined, {
            success: false,
            failureReason: lastError instanceof SecretaryError
              ? lastError.code
              : "PROVIDER_REQUEST_FAILED",
          });
          activeAttempt = undefined;
          break;
        }
      } catch (error) {
        if (activeAttempt) {
          finishLlmAttempt(context, activeAttempt, undefined, {
            success: false,
            failureReason: error instanceof SecretaryError ? error.code : "PROVIDER_REQUEST_FAILED",
          });
          activeAttempt = undefined;
        }
        lastError = error instanceof SecretaryError
          ? error
          : providerExceptionError("gemini", error);
        logLlmFailure("gemini", model, context, 1, lastError);
        if (lastError instanceof SecretaryError
          && lastError.code === "PROVIDER_RATE_LIMIT") {
          // A quota/token limit applies to the provider, not just this model.
          // Do not spend another request on Gemini's model fallback before
          // letting the outer gateway choose a different provider.
          throw lastError;
        }
        if (lastError instanceof SecretaryError
          && lastError.code === "PROVIDER_HTTP_ATTEMPT_BUDGET_EXCEEDED") break;
      } finally {
        clearTimeout(timeout);
      }
      if (modelIndex < models.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    throw lastError ?? new Error("Gemini request failed.");
  }
}

export class GroqModelGateway implements ModelGateway {
  readonly provider = "groq" as const;
  readonly routeKind = "direct_provider" as const;
  readonly usageFormat = "openai-compatible" as const;
  private readonly apiKey = process.env.GROQ_API_KEY;
  readonly model = GROQ_MODEL;

  get modelName(): string {
    return this.model;
  }

  async generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse> {
    if (!this.apiKey) throw new Error("GROQ_API_KEY is not configured.");
    const tools = toOpenAiTools(context.toolScope, context.finalResponseOnly);
    const instructions = buildProviderInstructions(context);
    const apiMessages = [
      {
        role: "system",
        content: instructions.text,
      },
      ...budgetMessages(messages).map((message) => {
        if (message.role === "assistant") {
          return {
            role: "assistant",
            content: message.text || null,
            tool_calls: (message.toolCalls ?? []).map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            })),
          };
        }
        if (message.role === "tool") {
          return {
            role: "tool",
            tool_call_id: message.toolCallId,
            name: message.toolName,
            content: message.text ?? "{}",
          };
        }
        return { role: "user", content: message.text ?? "" };
      }),
    ];
    const requestBody = JSON.stringify({
      model: this.model,
      messages: apiMessages,
      tools,
      tool_choice: "auto",
      reasoning_effort: "low",
      include_reasoning: false,
      temperature: 0.15,
      max_tokens: 2048,
    });
    const systemText = instructions.text;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_GROQ_HTTP_ATTEMPTS; attempt += 1) {
      const attemptMeasurement = recordProviderRequest(context, "groq", {
        model: this.model,
        routeKind: this.routeKind,
        usageFormat: this.usageFormat,
        requestBytes: Buffer.byteLength(requestBody),
        systemPromptChars: systemText.length,
        toolDefinitionsChars: JSON.stringify(tools).length,
        toolDefinitionsCount: tools.length,
        toolNames: tools.map((definition) => definition.function.name),
        conversationChars: JSON.stringify(apiMessages.slice(1)).length,
        context: contextBreakdown(
          messages,
          context.currentUserMessage,
          Buffer.byteLength(requestBody),
          JSON.stringify(tools).length,
          instructions,
        ),
        fallback: Boolean(context.providerFallback),
        retry: attempt > 0,
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutForDeadline(context.deadlineAt, 25_000));
      const startedAt = Date.now();
      logger.info({
        requestId: context.requestId,
        provider: this.provider,
        model: this.model,
        llmCall: context.callNumber,
        attempt: attempt + 1,
        requestBytes: Buffer.byteLength(requestBody),
        systemPromptChars: systemText.length,
        toolDefinitionsChars: JSON.stringify(tools).length,
        toolDefinitionsCount: tools.length,
        conversationChars: JSON.stringify(apiMessages.slice(1)).length,
      }, "agent llm call started");
      try {
        const response = await fetch(GROQ_API_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
          },
          body: requestBody,
          signal: controller.signal,
        });
        const raw = await response.text();
        if (response.ok) {
          const payload = JSON.parse(raw) as {
            choices?: Array<{
              message?: {
                content?: string | null;
                tool_calls?: Array<{
                  id: string;
                  function: { name: string; arguments: string };
                }>;
              };
            }>;
            usage?: unknown;
          };
          const message = payload.choices?.[0]?.message;
          const responseResult = {
            text: message?.content?.trim() ?? "",
            toolCalls: (message?.tool_calls ?? []).map((call) => ({
              id: call.id,
              name: call.function.name,
              args: parseJsonObject(call.function.arguments),
            })),
            usage: payload.usage,
          };
          finishLlmAttempt(context, attemptMeasurement, responseResult.usage, {
            success: true,
            outputChars: responseResult.text.length + JSON.stringify(responseResult.toolCalls).length,
          });
          logger.info({
            requestId: context.requestId,
            provider: this.provider,
            model: this.model,
            llmCall: context.callNumber,
            attempt: attempt + 1,
            toolCalls: responseResult.toolCalls.length,
            latencyMs: Date.now() - startedAt,
          }, "agent llm call completed");
          return responseResult;
        }
        lastError = providerResponseError(
          "groq",
          response.status,
          raw,
          parseRetryAfter(response.headers.get("retry-after")),
        );
        if (response.status === 429) {
          logger.warn({
            requestId: context.requestId,
            provider: this.provider,
            model: this.model,
            llmCall: context.callNumber,
            attempt: attempt + 1,
            retryAfterSeconds: lastError instanceof SecretaryError
              ? lastError.retryAfterSeconds
              : undefined,
            safeToRetry: false,
          }, "agent llm rate limit deferred to failover");
        }
        throw lastError;
      } catch (error) {
        finishLlmAttempt(context, attemptMeasurement, undefined, {
          success: false,
          failureReason: error instanceof SecretaryError ? error.code : "PROVIDER_REQUEST_FAILED",
        });
        lastError = error instanceof SecretaryError
          ? error
          : providerExceptionError("groq", error);
        logLlmFailure("groq", this.model, context, attempt + 1, lastError);
        if (attempt === 1 || !(lastError instanceof SecretaryError && lastError.upstreamStatus === 429)) {
          throw lastError;
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError ?? new Error("Groq request failed.");
  }
}

export class OpenAiCompatibleModelGateway implements ModelGateway {
  private readonly apiKey: string | undefined;
  readonly model: string;
  readonly usageFormat = "openai-compatible" as const;

  constructor(
    readonly provider: ProviderName,
    private readonly apiUrl: string,
    model: string,
    apiKey: string | undefined,
    private readonly apiKeyName: string,
    readonly routeKind: InferenceRouteKind = "direct_provider",
  ) {
    this.model = model;
    this.apiKey = apiKey;
  }

  get modelName(): string {
    return this.model;
  }

  async generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse> {
    if (!this.apiKey) throw new Error(`${this.apiKeyName} is not configured.`);
    const tools = toOpenAiTools(context.toolScope, context.finalResponseOnly);
    const instructions = buildProviderInstructions(context);
    const apiMessages = [
      {
        role: "system",
        content: instructions.text,
      },
      ...budgetMessages(messages).map((message) => {
        if (message.role === "assistant") {
          return {
            role: "assistant",
            content: message.text || null,
            tool_calls: (message.toolCalls ?? []).map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            })),
          };
        }
        if (message.role === "tool") {
          return {
            role: "tool",
            tool_call_id: message.toolCallId,
            name: message.toolName,
            content: message.text ?? "{}",
          };
        }
        return { role: "user", content: message.text ?? "" };
      }),
    ];
    const requestBody = JSON.stringify({
      model: this.model,
      messages: apiMessages,
      tools,
      tool_choice: "auto",
      temperature: 0.15,
      max_tokens: 2048,
    });
    const systemText = instructions.text;
    const attemptMeasurement = recordProviderRequest(context, this.provider, {
      model: this.model,
      routeKind: this.routeKind,
      usageFormat: this.usageFormat,
      requestBytes: Buffer.byteLength(requestBody),
      systemPromptChars: systemText.length,
      toolDefinitionsChars: JSON.stringify(tools).length,
      toolDefinitionsCount: tools.length,
      toolNames: tools.map((definition) => definition.function.name),
      conversationChars: JSON.stringify(apiMessages.slice(1)).length,
      context: contextBreakdown(
        messages,
        context.currentUserMessage,
        Buffer.byteLength(requestBody),
        JSON.stringify(tools).length,
        instructions,
      ),
      fallback: Boolean(context.providerFallback),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutForDeadline(context.deadlineAt, 25_000));
    const startedAt = Date.now();
    logger.info({
      requestId: context.requestId,
      provider: this.provider,
      model: this.model,
      llmCall: context.callNumber,
      attempt: 1,
      requestBytes: Buffer.byteLength(requestBody),
      systemPromptChars: systemText.length,
      toolDefinitionsChars: JSON.stringify(tools).length,
      toolDefinitionsCount: tools.length,
      toolNames: tools.map((definition) => definition.function.name),
      conversationChars: JSON.stringify(apiMessages.slice(1)).length,
    }, "agent llm call started");
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: requestBody,
        signal: controller.signal,
      });
      const raw = await response.text();
      if (response.ok) {
        const payload = JSON.parse(raw) as {
          choices?: Array<{
            message?: {
              content?: string | null;
              tool_calls?: Array<{
                id: string;
                function: { name: string; arguments: string };
              }>;
            };
          }>;
          usage?: unknown;
        };
        const message = payload.choices?.[0]?.message;
        const responseResult = {
          text: message?.content?.trim() ?? "",
          toolCalls: (message?.tool_calls ?? []).map((call) => ({
            id: call.id,
            name: call.function.name,
            args: parseJsonObject(call.function.arguments),
          })),
          usage: payload.usage,
        };
        finishLlmAttempt(context, attemptMeasurement, responseResult.usage, {
          success: true,
          outputChars: responseResult.text.length + JSON.stringify(responseResult.toolCalls).length,
        });
        logger.info({
          requestId: context.requestId,
          provider: this.provider,
          model: this.model,
          llmCall: context.callNumber,
          attempt: 1,
          toolCalls: responseResult.toolCalls.length,
          latencyMs: Date.now() - startedAt,
        }, "agent llm call completed");
        return responseResult;
      }
      const error = providerResponseError(
        this.provider,
        response.status,
        raw,
        parseRetryAfter(response.headers.get("retry-after")),
      );
      if (response.status === 429) {
        logger.warn({
          requestId: context.requestId,
          provider: this.provider,
          model: this.model,
          llmCall: context.callNumber,
          attempt: 1,
          retryAfterSeconds: error.retryAfterSeconds,
          safeToRetry: false,
        }, "agent llm rate limit deferred to failover");
      }
      throw error;
    } catch (error) {
      finishLlmAttempt(context, attemptMeasurement, undefined, {
        success: false,
        failureReason: error instanceof SecretaryError ? error.code : "PROVIDER_REQUEST_FAILED",
      });
      const classified = error instanceof SecretaryError
        ? error
        : providerExceptionError(this.provider, error);
      logLlmFailure(this.provider, this.model, context, 1, classified);
      throw classified;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class MistralModelGateway extends OpenAiCompatibleModelGateway {
  constructor() {
    const definition = providerDefinition("mistral");
    super(
      "mistral",
      providerApiUrl("mistral") ?? "",
      providerModel("mistral"),
      process.env[definition.apiKeyEnv],
      definition.apiKeyEnv,
    );
  }
}

export class DeepSeekModelGateway extends OpenAiCompatibleModelGateway {
  constructor() {
    const definition = providerDefinition("deepseek");
    super(
      "deepseek",
      providerApiUrl("deepseek") ?? "",
      providerModel("deepseek"),
      process.env[definition.apiKeyEnv],
      definition.apiKeyEnv,
    );
  }
}

export class QwenModelGateway extends OpenAiCompatibleModelGateway {
  constructor() {
    const definition = providerDefinition("qwen");
    super(
      "qwen",
      providerApiUrl("qwen") ?? "",
      providerModel("qwen"),
      process.env[definition.apiKeyEnv],
      definition.apiKeyEnv,
    );
  }
}

export class OpenRouterModelGateway extends OpenAiCompatibleModelGateway {
  constructor() {
    const definition = inferenceServiceDefinition("openrouter");
    super(
      "openrouter",
      inferenceServiceApiUrl("openrouter") ?? "",
      inferenceServiceModel("openrouter"),
      process.env[definition.apiKeyEnv],
      definition.apiKeyEnv,
      "gateway",
    );
  }
}

type CircuitState = {
  consecutiveFailures: number;
  openUntil: number;
};

type RequestProviderState = {
  fallbackRouteId?: InferenceRouteId;
  selectedRouteId?: InferenceRouteId;
  routeIndex?: number;
  primaryError?: SecretaryError;
  expiresAt: number;
};

const CIRCUIT_FAILURE_THRESHOLD = 2;
const CIRCUIT_OPEN_MS = 15_000;
const REQUEST_PROVIDER_STATE_TTL_MS = 5 * 60_000;

export class MnrInferenceRouter implements ModelGateway {
  private readonly circuits = new Map<string, CircuitState>();
  private readonly requests = new Map<string, RequestProviderState>();
  private readonly traces = new Map<string, ProviderTrace>();
  private readonly metrics = new Map<string, GatewayRequestMetrics>();

  constructor(
    private readonly gateways: Partial<Record<InferenceRouteId, ModelGateway>>,
    private readonly order: InferenceRouteId[],
    private readonly routes: Partial<Record<InferenceRouteId, InferenceRoute>> = {},
  ) {
    if (order.length === 0) throw new Error("At least one inference route is required.");
  }

  get provider(): ProviderName {
    return routeTargetId(this.routeFor(this.order[0]));
  }

  get modelName(): string {
    return this.gateways[this.order[0]]?.modelName ?? "unconfigured";
  }

  private routeFor(routeId: InferenceRouteId): InferenceRoute {
    const configured = this.routes[routeId] ?? this.gateways[routeId]?.route;
    if (configured) return configured;
    const serviceName = serviceNameForRouteId(routeId);
    const modelName = this.gateways[routeId]?.modelName ?? "unconfigured";
    if (serviceName) return inferenceRouteForService(serviceName, modelName);
    const separator = routeId.indexOf(":");
    const kind = routeId.slice(0, separator);
    const targetId = separator > 0 ? routeId.slice(separator + 1) : routeId;
    return kind === "gateway"
      ? gatewayRoute(targetId, modelName)
      : directProviderRoute(targetId, modelName);
  }

  private circuit(route: InferenceRoute): CircuitState {
    const key = routeHealthKey(route);
    const current = this.circuits.get(key);
    if (current) return current;
    const created = { consecutiveFailures: 0, openUntil: 0 };
    this.circuits.set(key, created);
    return created;
  }

  private isCircuitOpen(route: InferenceRoute): boolean {
    return this.circuit(route).openUntil > Date.now();
  }

  private circuitRetryAfterSeconds(route: InferenceRoute): number | undefined {
    const remainingMs = this.circuit(route).openUntil - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : undefined;
  }

  private markSuccess(route: InferenceRoute): void {
    this.circuits.set(routeHealthKey(route), { consecutiveFailures: 0, openUntil: 0 });
  }

  private markTransientFailure(route: InferenceRoute, error: SecretaryError): void {
    const key = routeHealthKey(route);
    const current = this.circuit(route);
    const consecutiveFailures = current.consecutiveFailures + 1;
    const providerCooldownMs = error.category === "provider_rate_limit" && error.retryAfterSeconds !== undefined
      ? Math.min(Math.max(error.retryAfterSeconds * 1000, CIRCUIT_OPEN_MS), MAX_CIRCUIT_COOLDOWN_MS)
      : error.category === "provider_rate_limit"
        ? CIRCUIT_OPEN_MS
      : undefined;
    this.circuits.set(key, {
      consecutiveFailures,
      openUntil: providerCooldownMs !== undefined
        ? Date.now() + providerCooldownMs
        : consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD
          ? Date.now() + CIRCUIT_OPEN_MS
          : current.openUntil,
    });
  }

  private trace(requestId: string): ProviderTrace {
    const current = this.traces.get(requestId);
    if (current) return current;
    const created: ProviderTrace = {
      primaryProvider: routeTargetId(this.routeFor(this.order[0])),
      primaryRouteId: this.order[0],
      ...(this.order[1] ? {
        fallbackProvider: routeTargetId(this.routeFor(this.order[1])),
        fallbackRouteId: this.order[1],
      } : {}),
      providersAttempted: [],
      routesAttempted: [],
      fallbackOccurred: false,
    };
    this.traces.set(requestId, created);
    return created;
  }

  private requestState(requestId: string): RequestProviderState | undefined {
    const current = this.requests.get(requestId);
    if (!current || current.expiresAt <= Date.now()) {
      if (current) this.requests.delete(requestId);
      return undefined;
    }
    return current;
  }

  getProviderForRequest(requestId: string): {
    provider: ProviderName;
    model: string;
    routeId: InferenceRouteId;
    routeKind: InferenceRouteKind;
  } {
    const selected = this.requestState(requestId)?.selectedRouteId ?? this.order[0];
    const gateway = this.gateways[selected];
    const route = this.routeFor(selected);
    return {
      provider: gateway?.provider ?? routeTargetId(route),
      model: gateway?.modelName ?? "unconfigured",
      routeId: selected,
      routeKind: route.kind,
    };
  }

  getTrace(requestId: string): ProviderTrace {
    const trace = this.trace(requestId);
    const metrics = this.metrics.get(requestId);
    return {
      ...trace,
      ...(metrics ? {
        logicalLlmCalls: metrics.logicalLlmCalls,
        httpAttempts: metrics.httpAttempts,
        httpAttemptsByProvider: metrics.httpAttemptsByProvider,
        httpAttemptsByRoute: metrics.httpAttemptsByRoute,
        retryCount: metrics.retryCount,
        providerFallbackAttempts: metrics.providerFallbackAttempts,
        modelFallbackAttempts: metrics.modelFallbackAttempts,
        requestBytesByProvider: metrics.requestBytesByProvider,
        requestBytesByRoute: metrics.requestBytesByRoute,
        maxRequestBytes: metrics.maxRequestBytes,
        systemPromptChars: metrics.systemPromptChars,
        toolDefinitionsChars: metrics.toolDefinitionsChars,
        toolDefinitionsCount: metrics.toolDefinitionsCount,
        maxConversationChars: metrics.maxConversationChars,
        cacheHit: metrics.cacheHit,
        cacheMiss: metrics.cacheMiss,
        cachedTokens: metrics.cachedTokens,
      } : {}),
    };
  }

  finishRequest(requestId: string): void {
    this.requests.delete(requestId);
    this.traces.delete(requestId);
    this.metrics.delete(requestId);
  }

  async generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse> {
    if (context.metrics) this.metrics.set(context.requestId, context.metrics);
    const request = this.requestState(context.requestId);
    const startIndex = request?.routeIndex ?? 0;
    const preferredRoutes = this.order.slice(startIndex);
    const trace = this.trace(context.requestId);
    const candidates = preferredRoutes.filter((routeId) => this.gateways[routeId]);
    const available = candidates.filter((routeId) => !this.isCircuitOpen(this.routeFor(routeId)));
    const routesToTry = available;
    if (routesToTry.length === 0) {
      const cooldownRouteId = candidates[0];
      const cooldownRoute = cooldownRouteId ? this.routeFor(cooldownRouteId) : undefined;
      const retryAfterSeconds = cooldownRoute
        ? this.circuitRetryAfterSeconds(cooldownRoute)
        : undefined;
      throw new SecretaryError("All configured LLM providers are in cooldown.", {
        status: 503,
        category: "provider_unavailable",
        code: "PROVIDER_COOLDOWN_ACTIVE",
        retryable: true,
        provider: cooldownRoute ? routeTargetId(cooldownRoute) : undefined,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      });
    }
    let primaryError = request?.primaryError;

    for (const [index, routeId] of routesToTry.entries()) {
      const route = this.routeFor(routeId);
      const provider = routeTargetId(route);
      if (context.deadlineAt !== undefined && Date.now() >= context.deadlineAt) {
        throw deadlineExceeded(provider);
      }
      const gateway = this.gateways[routeId];
      if (!gateway) continue;
      if (routeId !== this.order[0] && !trace.fallbackOccurred) {
        trace.fallbackOccurred = true;
        trace.fallbackReason = "circuit_open";
        trace.toolCallsExecutedBeforeFailure = context.toolCallsExecuted;
        if (context.metrics) context.metrics.providerFallbackAttempts += 1;
        logger.warn({
          requestId: context.requestId,
          primaryProvider: routeTargetId(this.routeFor(this.order[0])),
          primaryRouteId: this.order[0],
          fallbackProvider: provider,
          fallbackRouteId: routeId,
          fallback: true,
          fallbackReason: trace.fallbackReason,
          toolCallsExecutedBeforeFailure: context.toolCallsExecuted,
        }, "agent provider fallback");
      }
      trace.providersAttempted.push(provider);
      trace.routesAttempted?.push(routeId);
      try {
        const response = await gateway.generate(messages, {
          ...context,
          route,
          providerFallback: index > 0 || routeId !== this.order[0],
        });
        this.markSuccess(route);
        trace.selectedProvider = provider;
        trace.selectedRouteId = routeId;
        this.requests.set(context.requestId, {
          ...(trace.fallbackOccurred ? { fallbackRouteId: routeId } : {}),
          selectedRouteId: routeId,
          routeIndex: this.order.indexOf(routeId),
          expiresAt: Date.now() + REQUEST_PROVIDER_STATE_TTL_MS,
        });
        return response;
      } catch (error) {
        if (context.deadlineAt !== undefined && Date.now() >= context.deadlineAt) {
          throw deadlineExceeded(provider);
        }
        const classified = error instanceof SecretaryError
          ? error
          : providerExceptionError(provider, error);
        if (!isTransientProviderFailure(classified)) throw classified;
        this.markTransientFailure(route, classified);
        trace.fallbackReason = classified.code;
        trace.toolCallsExecutedBeforeFailure = context.toolCallsExecuted;
        primaryError ??= classified;

        const nextRouteId = routesToTry[index + 1];
        if (nextRouteId) {
          const nextRoute = this.routeFor(nextRouteId);
          trace.fallbackOccurred = true;
          trace.fallbackRouteId = nextRouteId;
          trace.fallbackProvider = routeTargetId(nextRoute);
          if (context.metrics) context.metrics.providerFallbackAttempts += 1;
          this.requests.set(context.requestId, {
            fallbackRouteId: nextRouteId,
            routeIndex: this.order.indexOf(nextRouteId),
            ...(routeId === this.order[0] ? { primaryError: classified } : {}),
            expiresAt: Date.now() + REQUEST_PROVIDER_STATE_TTL_MS,
          });
          logger.warn({
            requestId: context.requestId,
            primaryProvider: routeTargetId(this.routeFor(this.order[0])),
            primaryRouteId: this.order[0],
            fallbackProvider: routeTargetId(nextRoute),
            fallbackRouteId: nextRouteId,
            fallback: true,
            fallbackReason: classified.code,
            primaryError: classified.code,
            toolCallsExecutedBeforeFailure: context.toolCallsExecuted,
          }, "agent provider fallback");
          continue;
        }

        const primaryProvider = routeTargetId(this.routeFor(this.order[0]));
        if (primaryError && routeId !== this.order[0]) {
          throw providerFailoverError(primaryProvider, primaryError, provider, classified);
        }
        throw classified;
      }
    }

    throw new SecretaryError("No configured LLM provider is available.", {
      status: 503,
      category: "provider_unavailable",
      code: "PROVIDER_NOT_CONFIGURED",
      retryable: false,
    });
  }
}

function routeForLegacyEndpoint(
  endpointName: ProviderName,
  modelName: string,
  configuredRoute?: InferenceRoute,
): InferenceRoute {
  if (configuredRoute) return routeWithModel(configuredRoute, modelName);
  try {
    return inferenceRouteForService(endpointName, modelName);
  } catch {
    return directProviderRoute(endpointName, modelName);
  }
}

export class FailoverModelGateway extends MnrInferenceRouter {
  constructor(
    gateways: Partial<Record<ProviderName, ModelGateway>>,
    order: ProviderName[],
  ) {
    const routeGateways: Partial<Record<InferenceRouteId, ModelGateway>> = {};
    const routes: Partial<Record<InferenceRouteId, InferenceRoute>> = {};
    const routeOrder = order.map((endpointName) => {
      const gateway = gateways[endpointName];
      const route = routeForLegacyEndpoint(
        endpointName,
        gateway?.modelName ?? "unconfigured",
        gateway?.route,
      );
      routes[route.id] = route;
      if (gateway) routeGateways[route.id] = gateway;
      return route.id;
    });
    super(routeGateways, routeOrder, routes);
  }
}

function numericValues(value: unknown, output = new Set<number>()): Set<number> {
  if (typeof value === "number" && Number.isFinite(value)) {
    output.add(value);
    if (Number.isInteger(value) && value % 100 === 0) output.add(value / 100);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) numericValues(item, output);
    return output;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) numericValues(child, output);
  }
  return output;
}

function numericTextValues(value: string): number[] {
  return [...value.matchAll(/(?<![\p{L}\p{N}])[0-9٠-٩][0-9٠-٩,٬.]*/gu)]
    .map((match) => Number(
      match[0]
        .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
        .replace(/[,.٬]/g, ""),
    ))
    .filter((number) => Number.isFinite(number));
}

function groundedValues(history: ToolHistoryEntry[]): Set<number> {
  const values = new Set<number>();
  for (const entry of history) numericValues(entry.result, values);
  return values;
}

function isFinancialMessage(message: string): boolean {
  return /جنيه|دولار|ريال|مصروف|مصروفات|مصاريف|اجمالي|إجمالي|مبلغ|دفع|دفعت|صرف|فلوس|فلوس/i.test(message);
}

function isExpenseTotalRequest(message: string): boolean {
  return /إجمالي|اجمالي|مجموع|كام|كم|قد\s*إيه|قد\s*ايه|how much|total|sum/i.test(message);
}

function exactMoneyLabel(amountMinor: number, currency: string): string {
  const unit = currency === "EGP"
    ? "جنيه مصري"
    : currency === "USD"
      ? "دولار أمريكي"
      : currency === "SAR"
        ? "ريال سعودي"
        : currency;
  const amount = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
  return `${amount} ${unit}`;
}

function canonicalExpenseTotal(
  history: ToolHistoryEntry[],
  requestMessage: string,
): { message: string; facts: GroundedFact[] } | null {
  if (!isExpenseTotalRequest(requestMessage)) return null;
  const entry = [...history].reverse().find((candidate) =>
    candidate.name === "query_expenses"
    || candidate.name === "get_person_expense_total"
    || candidate.name === "get_project_expense_total"
  );
  if (!entry || !entry.result.ok) return null;

  const summary = entry.name === "query_expenses"
    && entry.result.summary
    && typeof entry.result.summary === "object"
    ? entry.result.summary as Record<string, unknown>
    : entry.result.total
      && typeof entry.result.total === "object"
        ? entry.result.total as Record<string, unknown>
        : null;
  if (!summary) return null;

  const currencyTotals = Array.isArray(summary.currencyTotals)
    ? summary.currencyTotals.filter((item): item is ExpenseCurrencyTotal =>
        !!item
        && typeof item === "object"
        && typeof item.currency === "string"
        && Number.isSafeInteger(item.totalMinor)
        && item.totalMinor >= 0
        && Number.isSafeInteger(item.count)
        && item.count >= 0,
      )
    : [];
  if (currencyTotals.length > 1) {
    const count = currencyTotals.reduce((total, item) => total + item.count, 0);
    const parts = currencyTotals.map((item) =>
      `${exactMoneyLabel(item.totalMinor, item.currency)} عبر ${item.count}`,
    );
    return {
      message: `لا يمكن جمع المصروفات في إجمالي واحد لأنها مسجلة بأكثر من عملة: ${parts.join("، ")}. إجمالي عدد المصروفات ${count}.`,
      facts: [
        ...currencyTotals.map((item) => ({
          type: "money" as const,
          value: item.totalMinor,
          currency: item.currency,
          label: "إجمالي المصروفات",
        })),
        { type: "count", value: count, label: "عدد المصروفات" },
      ],
    };
  }

  const totalMinor = Number(summary.totalMinor ?? summary.amountMinor);
  const count = Number(summary.count);
  const currency = typeof summary.currency === "string" ? summary.currency : "EGP";
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0 || !Number.isSafeInteger(count) || count < 0) {
    return null;
  }

  const amount = exactMoneyLabel(totalMinor, currency);
  return {
    message: count === 0
      ? "لا توجد مصروفات مطابقة في السجلات."
      : `الإجمالي الدقيق المسجل في السجلات هو ${amount} عبر ${count} مصروف.`,
    facts: [
      { type: "money", value: totalMinor, currency, label: "إجمالي المصروفات" },
      { type: "count", value: count, label: "عدد المصروفات" },
    ],
  };
}

export function looksLikeInternalStructuredResponse(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (/^\s*[\[{]/.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") return true;
    } catch {
      // Providers sometimes return truncated JSON; inspect known internal keys below.
    }
  }
  return /"(?:toolResult|providerTrace|candidateProjects|candidatePeople|conversationState|cachedTokens|providersAttempted|toolCallsExecutedBeforeFailure)"\s*:/.test(trimmed);
}

function safeFinalResponse(
  kind: FinalResponseKind,
  message: string,
  history: ToolHistoryEntry[],
  groundedFacts?: GroundedFact[],
): FinalResponse {
  if (looksLikeInternalStructuredResponse(message)) {
    return {
      kind: "error",
      message: "راجعت البيانات المحفوظة، لكن لم أستطع صياغة رد واضح الآن. جرّب السؤال مرة أخرى.",
    };
  }
  const facts = groundedFacts?.filter((fact) => {
    if (!fact || !["money", "count"].includes(fact.type) || !Number.isSafeInteger(fact.value)) return false;
    const values = groundedValues(history);
    return values.has(fact.value);
  });
  const hasInvalidFact = (groundedFacts?.length ?? 0) !== (facts?.length ?? 0);
  const unverifiedNumbers = isFinancialMessage(message)
    ? numericTextValues(message).some((value) => !groundedValues(history).has(value))
    : false;

  if (hasInvalidFact || unverifiedNumbers) {
    return {
      kind: "error",
      message: "راجعت البيانات المحفوظة، لكن لم أستطع تأكيد الرقم المالي من نتيجة قاعدة البيانات. لن أخمّن.",
    };
  }

  return {
    kind,
    message: message.trim(),
    ...(facts && facts.length > 0 ? { groundedFacts: facts } : {}),
  };
}

function finalResponseFromArgs(
  args: Record<string, unknown>,
  history: ToolHistoryEntry[],
  requestMessage = "",
): FinalResponse {
  const kind = args.kind === "clarification" || args.kind === "not_found" || args.kind === "error"
    ? args.kind
    : "answer";
  const message = typeof args.message === "string" ? args.message.trim() : "";
  if (!message) {
    return {
      kind: "error",
      message: "لم يصل رد نهائي مفهوم من النموذج.",
    };
  }
  const groundedFacts = Array.isArray(args.groundedFacts)
    ? args.groundedFacts.flatMap((fact) => {
        if (!fact || typeof fact !== "object") return [];
        const item = fact as Record<string, unknown>;
        if ((item.type !== "money" && item.type !== "count") || typeof item.value !== "number") return [];
        return [{
          type: item.type,
          value: item.value,
          ...(typeof item.currency === "string" ? { currency: item.currency } : {}),
          ...(typeof item.label === "string" ? { label: item.label } : {}),
        } satisfies GroundedFact];
      })
    : undefined;
  const canonical = canonicalExpenseTotal(history, requestMessage);
  if (canonical) {
    return safeFinalResponse("answer", canonical.message, history, canonical.facts);
  }
  return safeFinalResponse(kind, message, history, groundedFacts);
}

function finalResponseFromText(
  text: string,
  history: ToolHistoryEntry[],
  requestMessage = "",
): FinalResponse {
  const message = text.trim() || "لم أستطع إكمال الطلب بشكل آمن. اكتب التفاصيل المطلوبة وسأحاول مرة أخرى.";
  const canonical = canonicalExpenseTotal(history, requestMessage);
  if (canonical) {
    return safeFinalResponse("answer", canonical.message, history, canonical.facts);
  }
  return safeFinalResponse("answer", message, history);
}

function recoveryResponseAfterSuccessfulWrite(history: ToolHistoryEntry[]): FinalResponse | null {
  const successfulWrite = [...history]
    .reverse()
    .find((entry) =>
      WRITE_TOOLS.has(entry.name)
      && entry.result.ok
      && (entry.result.verification as { state?: string } | undefined)?.state === "verified",
    );
  if (!successfulWrite) return null;

  if (successfulWrite.name === "record_expense") {
    return {
      kind: "answer",
      message: "تم تسجيل المصروف. تعذر إكمال الرد، لذلك لا تعِد إرسال العملية الآن حتى لا يتكرر التسجيل.",
    };
  }

  return {
    kind: "answer",
    message: "تم حفظ التغيير. تعذر إكمال الرد، لذلك لا تعِد إرسال العملية الآن حتى لا يتكرر التغيير.",
  };
}

function recoveryResponseAfterToolLimit(history: ToolHistoryEntry[]): FinalResponse {
  const lastSuccessful = [...history]
    .reverse()
    .find((entry) => entry.result.ok);
  if (lastSuccessful?.name === "query_expenses") {
    const summary = lastSuccessful.result.summary && typeof lastSuccessful.result.summary === "object"
      ? lastSuccessful.result.summary as {
          count?: unknown;
          totalMinor?: unknown;
          currency?: unknown;
          currencyTotals?: unknown;
        }
      : {};
    const count = typeof summary.count === "number" ? summary.count : 0;
    const currencyTotals = Array.isArray(summary.currencyTotals)
      ? summary.currencyTotals.filter((item): item is ExpenseCurrencyTotal =>
          !!item
          && typeof item === "object"
          && typeof item.currency === "string"
          && Number.isSafeInteger(item.totalMinor)
          && item.totalMinor >= 0
          && Number.isSafeInteger(item.count)
          && item.count >= 0,
        )
      : [];
    if (currencyTotals.length > 1) {
      return safeFinalResponse(
        "answer",
        `راجعت المصروفات المحفوظة، لكنها مسجلة بأكثر من عملة ولا يصح جمعها في رقم واحد: ${currencyTotals.map((item) => `${exactMoneyLabel(item.totalMinor, item.currency)} عبر ${item.count}`).join("، ")}.`,
        history,
        [
          ...currencyTotals.map((item) => ({
            type: "money" as const,
            value: item.totalMinor,
            currency: item.currency,
            label: "إجمالي المصروفات",
          })),
          { type: "count", value: count, label: "عدد المصروفات" },
        ],
      );
    }
    const totalMinor = typeof summary.totalMinor === "number" ? summary.totalMinor : 0;
    const currency = typeof summary.currency === "string" ? summary.currency : "EGP";
    const amount = new Intl.NumberFormat("ar-EG", {
      style: "currency",
      currency,
    }).format(totalMinor / 100);
    return safeFinalResponse(
      "answer",
      count === 0
        ? "راجعت المصروفات المحفوظة، ولا توجد نتائج مطابقة."
        : `راجعت المصروفات المحفوظة ووجدت ${count} مصروف بإجمالي ${amount}.`,
      history,
      [
        { type: "money", value: totalMinor, currency, label: "إجمالي المصروفات" },
        { type: "count", value: count, label: "عدد المصروفات" },
      ],
    );
  }

  return {
    kind: "answer",
    message: "راجعت البيانات المحفوظة، لكن احتاج الطلب خطوة إضافية لإكمال الرد. لم يتم تغيير أي بيانات.",
  };
}

async function loadIdempotent(identity: Identity, key: string): Promise<Phase2TurnResult | null> {
  const [record] = await db.select().from(idempotencyRecordsTable).where(and(
    identityWhere(identity, idempotencyRecordsTable),
    eq(idempotencyRecordsTable.key, key),
  )).limit(1);
  return record ? JSON.parse(record.responseJson) as Phase2TurnResult : null;
}

async function saveIdempotent(identity: Identity, key: string, response: Phase2TurnResult) {
  await db.insert(idempotencyRecordsTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    key,
    responseJson: JSON.stringify(response),
  }).onConflictDoNothing();
}

type DeterministicPreflightResult = {
  response: FinalResponse;
  action: Record<string, unknown>;
};

function deterministicEntityClarification(
  result: ResolverResult,
  label: string,
): DeterministicPreflightResult {
  const ambiguous = result.matchType === "ambiguous";
  return {
    response: {
      kind: "clarification",
      message: ambiguous
        ? `عندك أكثر من ${label} قريب من "${result.query}"، تقصد أي واحد؟`
        : `مش لاقي ${label} باسم "${result.query}". هل تقصد اسمًا مختلفًا أم تريد المتابعة من غير ربطه؟`,
    },
    action: {
      type: "clarification_needed",
      source: "deterministic_intelligence",
      reason: ambiguous ? `ambiguous_${result.entityType}` : `unresolved_${result.entityType}`,
      [`${result.entityType}Candidates`]: result.candidates.slice(0, 10).map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
      })),
    },
  };
}

function deterministicApprovalResponse(
  toolName: string,
  result: ToolResult,
): DeterministicPreflightResult | null {
  if (!result.pendingApproval || !result.approval || typeof result.approval !== "object") return null;
  const approval = result.approval as Record<string, unknown>;
  const display = approval.display && typeof approval.display === "object"
    ? approval.display as { title?: unknown; details?: unknown }
    : {};
  const title = typeof display.title === "string" ? display.title : "هذا التغيير";
  const details = Array.isArray(display.details)
    ? display.details.filter((detail): detail is string => typeof detail === "string")
    : [];
  return {
    response: {
      kind: "clarification",
      message: `قبل ما أنفذ ${title}${details.length > 0 ? ` (${details.join(" — ")})` : ""}، هل توافق؟`,
    },
    action: {
      type: "approval_required",
      source: "deterministic_intelligence",
      operationId: approval.operationId,
      status: approval.status,
      toolName,
      display: { title, details },
      args: approval.args,
    },
  };
}

function reminderText(message: string): string {
  return message
    .replace(/^(?:فكرني|ذكرني|remind)\s*/iu, "")
    .replace(/\b(?:بكره|بكرة|غدا|غدًا|اليوم)\b/giu, "")
    .replace(/(?:الساعه|الساعة)\s*[0-9٠-٩]{1,2}(?:\s*[:٫]\s*[0-9٠-٩]{1,2})?\s*(?:صباحا|مساء|بالليل|ليل|ظهر)?/giu, "")
    .replace(/[\u064B-\u065F]/gu, "")
    .replace(/\s+/g, " ")
    .trim() || "تذكير";
}

function naturalAgentWorkArgs(message: string): Record<string, unknown> {
  const compact = message.replace(/\s+/g, " ").trim();
  const recurring = /(?:كل\s+يوم|يوميا|يوميًا|every\s+day)/iu.test(compact);
  const time = parseArabicTimeOfDay(compact);
  const githubRepositoryMatch = compact.match(
    /(?:github|جيت\s*هاب)?(?:\s+(?:repo|repository|مستودع|مخزن))?\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/iu,
  );
  const githubIssueSignal = /(?:github|جيت\s*هاب|issues?|إيشوز|مشاكل|قضايا|العناصر\s+المفتوحة)/iu.test(compact);
  const githubThresholdMatch = compact.match(
    /(?:issues?|إيشوز|مشاكل|قضايا|العناصر\s+المفتوحة).*?(?:عن|فوق|اكتر\s+من|اكثر\s+من|أكثر\s+من|تزيد\s+عن|تعدي)\s*([0-9٠-٩]+)/iu,
  );
  const githubThreshold = githubThresholdMatch
    ? Number(arabicDigitsToAscii(githubThresholdMatch[1]))
    : null;
  const githubMonitor = Boolean(
    githubRepositoryMatch?.[1]
      && githubIssueSignal
      && githubThreshold !== null
      && Number.isSafeInteger(githubThreshold)
      && githubThreshold >= 0,
  );
  const delegatedTaskSignal = /(?:اعمل|أنشئ|انشئ|سجل|ضيف|أضف|اضف)\s+(?:لي\s+)?(?:مهمة|تاسك|task)|(?:create|add)\s+(?:a\s+)?task/iu.test(compact);
  const delegatedTaskTitle = githubMonitor && delegatedTaskSignal
    ? `مراجعة العناصر المفتوحة في ${githubRepositoryMatch?.[1]}`
    : null;
  const taskThresholdMatch = compact.match(
    /(?:المهام|مهامي|المهام\s+المفتوحة|open\s+tasks?).*?(?:عن|فوق|اكتر\s+من|اكثر\s+من|أكثر\s+من|تزيد\s+عن|تعدي)\s*([0-9٠-٩]+)/iu,
  );
  const threshold = taskThresholdMatch
    ? Number(arabicDigitsToAscii(taskThresholdMatch[1]))
    : null;
  const internalTaskMonitor = threshold !== null
    && Number.isSafeInteger(threshold)
    && threshold >= 0;
  const schedule: Record<string, unknown> = recurring
    ? {
        frequency: "daily",
        timezone: "Africa/Cairo",
        ...(time ? { localTime: `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}` } : {}),
      }
    : { frequency: "interval", minutes: 60 };
  return {
    kind: githubMonitor || internalTaskMonitor ? "monitor" : recurring ? "recurring_task" : "monitor",
    title: githubMonitor ? `متابعة GitHub ${githubRepositoryMatch?.[1]}` : compact.slice(0, 200),
    description: compact.slice(0, 2000),
    sourceType: githubMonitor ? "github_repository" : internalTaskMonitor ? "internal_records" : "user_defined",
    condition: githubMonitor
      ? {
          provider: "github",
          entity: "repository",
          metric: "open_issues_count",
          owner: githubRepositoryMatch?.[1]?.split("/")[0],
          repository: githubRepositoryMatch?.[1]?.split("/")[1],
          operator: "gt",
          threshold: githubThreshold,
        }
      : internalTaskMonitor
      ? {
          entity: "tasks",
          metric: "open_task_count",
          operator: "gt",
          threshold,
        }
      : {
          type: "user_defined",
          request: compact.slice(0, 500),
        },
    action: delegatedTaskTitle
      ? {
          type: "create_task",
          toolName: "create_task",
          title: delegatedTaskTitle,
          requiresApproval: true,
        }
      : {
          type: "notify",
          destination: "main_and_mobile",
          include: ["what_changed", "current_value", "condition", "checked_at", "evidence"],
          deepLink: "work_detail",
        },
    schedule,
    nextRunAt: new Date().toISOString(),
  };
}

export function expenseDescription(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  const purpose = compact
    .replace(/^(?:سجل|سجّل|اكتب|اثبت)\s*(?:إني|اني)?\s*/iu, "")
    .replace(/^(?:دفعت|صرف(?:ت)?|اديت|أديت|اعطيت|عطيت|حولت|سددت|دفع(?:ت)?)\s*/iu, "")
    .replace(
      /^(?:لـ?|ل)[\p{L}][\p{L}-]*(?:\s+[\p{L}][\p{L}-]*)*\s+(?:[\d٠-٩]+(?:[.,٬٫][\d٠-٩]+)?\s*(?:(?:ألفين|ألف|الفين|الف|الاف|آلاف)(?:\s+و?(?:نص|نصف))?)?|[\d٠-٩,٬.]+)\s*(?:جنيه|جنية|دولار|يورو|ريال|درهم)?\s+(?=(?:على|في|بـ|ب|لـ|ل)(?:\s|$))/iu,
      "",
    )
    .replace(
      /^(?:[\d٠-٩]+(?:[.,٬٫][\d٠-٩]+)?\s*(?:(?:ألفين|ألف|الفين|الف|الاف|آلاف)(?:\s+و?(?:نص|نصف))?)?|[\d٠-٩,٬.]+)\s*(?:جنيه|جنية|دولار|يورو|ريال|درهم)?\s*/iu,
      "",
    )
    .replace(/^(?:على|في|بـ|ب|لـ|ل)\s*/iu, "")
    .trim();
  return (purpose || compact).slice(0, 320);
}

function createdEntityName(message: string, entityType: "person" | "project"): string | null {
  const patterns = entityType === "person"
    ? [
      /(?:أضف|اضف|أضيف|اضيف|ضيف)\s+([^\u060C,]+?)\s+(?:كشخص|كجهة|كـ?person|كـ?contact)/iu,
      /(?:أضف|اضف|أضيف|اضيف|ضيف)\s+(?:شخص|جهة|person|contact)(?:\s+جديد)?(?:\s+اسمه?)?\s+([^\u060C,]+?)(?=\s+من\s+غير|\s+مش|\s+ما|$)/iu,
      /(?:سجل|سجّل)\s+([^\u060C,]+?)\s+(?:عندي\s+)?كشخص/iu,
      /(?:اعمل|أنشئ|انشئ)\s+شخص(?:\s+جديد)?\s+اسمه?\s+([^\u060C,]+?)(?=\s+من\s+غير|\s+مش|\s+ما|$)/iu,
    ]
    : [
      /(?:بدأت|أنشئ|انشئ|اعمل|create)\s+(?:مشروع|project)(?:\s+جديد)?(?:\s+اسمه?)?\s+([^\u060C,]+?)(?=\s+من\s+غير|\s+مش|\s+ما|$)/iu,
    ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

async function deterministicPreflight(
  identity: Identity,
  parsed: SemanticParse,
  decision: DeterministicDecision,
  options: {
    requestId: string;
    conversationId: string;
    idempotencyKey?: string | null;
    dryRun?: boolean;
    channel?: TurnInputChannel;
    metrics: DeterministicRequestMetrics;
  },
): Promise<DeterministicPreflightResult | null> {
  if (decision.kind === "llm") return null;
  const resolve = async (entityType: "person" | "project", query: string): Promise<ResolverResult> => {
    options.metrics.resolverUsed = true;
    const result = await resolveEntity(identity, entityType, query);
    if (result.selected) options.metrics.entityMatches += 1;
    if (result.matchType === "ambiguous") options.metrics.entityAmbiguities += 1;
    return result;
  };
  if (
    decision.kind === "deterministic"
    && ["expense_report", "schedule_read"].includes(parsed.intent)
  ) return null;

  if (decision.kind === "no_op") {
    return {
      response: {
        kind: "answer",
        message: "تمام، مش هسجل أي مصروف، ومفيش أي تغيير اتعمل.",
      },
      action: {
        type: "no_op",
        source: "deterministic_intelligence",
        reason: decision.reason,
      },
    };
  }

  if (decision.kind === "clarification") {
    return {
      response: {
        kind: "clarification",
        message: parsed.intent === "create_reminder"
          ? "تحب التذكير الساعة كام؟ اكتب الوقت، أو قل «أي وقت» لأضعه الساعة 9 صباحًا."
          : "كام المبلغ المطلوب تسجيله؟",
      },
      action: {
        type: "clarification_needed",
        source: "deterministic_intelligence",
        reason: decision.reason,
      },
    };
  }

  if (parsed.intent === "create_agent_work") {
    const args = naturalAgentWorkArgs(parsed.originalText);
    const result = await executeStructuredTool(identity, "create_agent_work", args, {
      requestId: options.requestId,
      dryRun: options.dryRun,
      conversationId: options.conversationId,
      sourceTurnId: options.requestId,
      idempotencyKey: options.idempotencyKey,
      channel: options.channel,
    });
    const approval = deterministicApprovalResponse("create_agent_work", result);
    if (approval) return approval;
    if (!result.ok) return null;
    const work = result.agentWork && typeof result.agentWork === "object"
      ? result.agentWork as { title?: unknown }
      : {};
    return {
      response: {
        kind: "answer",
        message: typeof work.title === "string"
          ? `أنشأت متابعة «${work.title}».`
          : "أنشأت متابعة جديدة للوكيل.",
      },
      action: {
        type: "agent_work_created",
        source: "deterministic_intelligence",
        workId: typeof (result.agentWork as { id?: unknown } | undefined)?.id === "string"
          ? (result.agentWork as { id: string }).id
          : null,
      },
    };
  }

  if (parsed.intent === "person_expense_total") {
    const mention = parsed.entityMentions.find((item) => item.entityType === "person");
    if (!mention) return null;
    const resolved = await resolve("person", mention.query);
    if (!resolved.selected) return null;
    const [total] = await db.select({
      amountMinor: sql<number>`coalesce(sum(${expensesTable.amountMinor}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
      currency: sql<string>`coalesce(min(${expensesTable.currency}), 'unknown')`,
    }).from(expensesTable).where(and(
      identityWhere(identity, expensesTable),
      eq(expensesTable.personId, resolved.selected.id),
    ));
    const amountMinor = Number(total?.amountMinor ?? 0);
    const count = Number(total?.count ?? 0);
    const currency = total?.currency ?? "EGP";
    return {
      response: {
        kind: count > 0 ? "answer" : "not_found",
        message: count > 0
          ? `${resolved.selected.name} أخد منك ${new Intl.NumberFormat("ar-EG", {
            style: "currency",
            currency,
          }).format(amountMinor / 100)} في ${new Intl.NumberFormat("ar-EG").format(count)} دفعة.`
          : `مش لاقي مصروفات مسجلة لـ${resolved.selected.name}.`,
        ...(count > 0 ? {
          groundedFacts: [{ type: "money" as const, value: amountMinor, currency, label: "إجمالي المدفوع" }],
        } : {}),
      },
      action: {
        type: "person_expense_total",
        source: "deterministic_intelligence",
        personId: resolved.selected.id,
        personName: resolved.selected.name,
        amountMinor,
        count,
        currency,
      },
    };
  }

  if (parsed.intent === "project_people") {
    const mention = parsed.entityMentions.find((item) => item.entityType === "project");
    if (!mention) return null;
    const resolved = await resolve("project", mention.query);
    if (!resolved.selected) return null;
    const people = await db.select({
      id: peopleTable.id,
      name: peopleTable.name,
    }).from(projectPeopleTable)
      .innerJoin(peopleTable, eq(projectPeopleTable.personId, peopleTable.id))
      .where(and(
        identityWhere(identity, projectPeopleTable),
        identityWhere(identity, peopleTable),
        eq(projectPeopleTable.projectId, resolved.selected.id),
      ))
      .orderBy(asc(peopleTable.createdAt));
    return {
      response: {
        kind: people.length > 0 ? "answer" : "not_found",
        message: people.length > 0
          ? `المرتبطين بمشروع ${resolved.selected.name}: ${people.map((person) => person.name).join("، ")}.`
          : `مش لاقي أشخاص مرتبطين بمشروع ${resolved.selected.name}.`,
      },
      action: {
        type: "project_people",
        source: "deterministic_intelligence",
        projectId: resolved.selected.id,
        projectName: resolved.selected.name,
        people: people.map((person) => ({ id: person.id, name: person.name })),
      },
    };
  }

  if (parsed.intent === "record_expense" && parsed.amount) {
    const personMention = parsed.entityMentions.find((item) => item.entityType === "person");
    const projectMention = parsed.entityMentions.find((item) => item.entityType === "project");
    const person = personMention ? await resolve("person", personMention.query) : null;
    const project = projectMention ? await resolve("project", projectMention.query) : null;
    if (person && !person.selected) return null;
    if (project && !project.selected) return null;
    const args: Record<string, unknown> = {
      amountMinor: parsed.amount.amountMinor,
      currency: parsed.amount.currency,
      description: expenseDescription(parsed.originalText),
      ...(person?.selected ? { personId: person.selected.id } : {}),
      ...(project?.selected ? { projectId: project.selected.id } : {}),
    };
    const validation = validateDeterministicPayload(parsed, args);
    if (!validation.valid) {
      options.metrics.validationFailures += validation.issues.length;
      return {
        response: { kind: "error", message: validation.issues.map((issue) => issue.message).join(" ") },
        action: { type: "deterministic_validation_failed", source: "deterministic_intelligence", issues: validation.issues },
      };
    }
    const result = await executeStructuredTool(identity, "record_expense", args, {
      requestId: options.requestId,
      dryRun: options.dryRun,
      conversationId: options.conversationId,
      idempotencyKey: options.idempotencyKey,
      channel: options.channel,
    });
    return deterministicApprovalResponse("record_expense", result) ?? {
      response: {
        kind: result.ok ? "answer" : "error",
        message: result.ok ? "حللت المصروف وجهزته للموافقة." : "لم أستطع تجهيز المصروف بشكل آمن.",
      },
      action: { type: "deterministic_write", source: "deterministic_intelligence", toolName: "record_expense" },
    };
  }

  if (parsed.intent === "create_reminder" && parsed.dateTime) {
    const args = {
      text: reminderText(parsed.originalText),
      dueAt: parsed.dateTime.iso,
      timezone: "Africa/Cairo",
    };
    const validation = validateDeterministicPayload(parsed, args);
    if (!validation.valid) {
      options.metrics.validationFailures += validation.issues.length;
      return {
        response: { kind: "clarification", message: validation.issues.map((issue) => issue.message).join(" ") },
        action: { type: "deterministic_validation_failed", source: "deterministic_intelligence", issues: validation.issues },
      };
    }
    const result = await executeStructuredTool(identity, "create_reminder", args, {
      requestId: options.requestId,
      dryRun: options.dryRun,
      conversationId: options.conversationId,
      idempotencyKey: options.idempotencyKey,
    });
    return deterministicApprovalResponse("create_reminder", result) ?? {
      response: {
        kind: result.ok ? "answer" : "error",
        message: result.ok ? "جهزت التذكير للموافقة." : "لم أستطع تجهيز التذكير بشكل آمن.",
      },
      action: { type: "deterministic_write", source: "deterministic_intelligence", toolName: "create_reminder" },
    };
  }

  if (parsed.intent === "create_person" || parsed.intent === "create_project") {
    const entityType = parsed.intent === "create_person" ? "person" : "project";
    const name = createdEntityName(parsed.originalText, entityType);
    if (!name) return null;
    const resolved = await resolve(entityType, name);
    if (resolved.selected || resolved.matchType === "ambiguous") {
      return deterministicEntityClarification(resolved, entityType === "person" ? "شخص" : "مشروع");
    }
    const toolName = entityType === "person" ? "create_person" : "create_project";
    const result = await executeStructuredTool(identity, toolName, { name }, {
      requestId: options.requestId,
      dryRun: options.dryRun,
      conversationId: options.conversationId,
      idempotencyKey: options.idempotencyKey,
    });
    return deterministicApprovalResponse(toolName, result);
  }

  return null;
}

export class Phase2AgentRuntime {
  constructor(private readonly gateway: ModelGateway) {}

  async run(
    identity: Identity,
    input: Phase2TurnInput,
    options: Phase2RunOptions = {},
  ): Promise<Phase2TurnResult> {
    return runWithIdempotencyLock(identity, input.idempotencyKey, () =>
      this.runUncoordinated(identity, input, options));
  }

  private async runUncoordinated(
    identity: Identity,
    input: Phase2TurnInput,
    options: Phase2RunOptions = {},
  ): Promise<Phase2TurnResult> {
    const startedAt = Date.now();
    const requestId = input.requestId ?? crypto.randomUUID();
    if (input.idempotencyKey) {
      const stored = await loadIdempotent(identity, input.idempotencyKey);
      if (stored) return stored;
    }

    const conversationId = input.conversationId || crypto.randomUUID();
    const conversationMemory = await loadConversationMemory(identity, conversationId);
    // Shadow resolution is telemetry only. It must run before orchestration and
    // never alter messages, tool scope, approvals, or persisted conversation state.
    await recordResolverShadow(identity, input.message, { requestId, conversationId });
    if (!options.dryRun && isExplicitCancellationRequest(input.message)) {
      const rejected = await rejectPendingOperationForConversation(identity, conversationId);
      if (rejected) {
        const result: Phase2TurnResult = {
          conversationId,
          turnId: requestId,
          assistantMessage: "تم إلغاء العملية، ولن يتم تنفيذ أي تغيير.",
          response: {
            kind: "answer",
            message: "تم إلغاء العملية، ولن يتم تنفيذ أي تغيير.",
          },
          action: {
            type: "approval_rejected",
            operationId: rejected.operationId,
            status: rejected.status,
            toolName: rejected.toolName,
          },
          provider: "server",
          model: "approval-operation",
        };
        await saveConversationTurn(identity, conversationMemory, {
          turnId: requestId,
          userMessage: input.message.trim(),
          assistantMessage: result.assistantMessage,
          action: result.action,
        });
        if (input.idempotencyKey) await saveIdempotent(identity, input.idempotencyKey, result);
        logger.info({
          requestId,
          conversationId,
          ...brainLogFields(createBrainDecisionEnvelope({
            requestId,
            conversationId,
            message: input.message,
            semanticParse: featureFlags.deterministicIntelligence()
              ? parseSemanticRequest(input.message)
              : null,
            hasConversationContext: true,
            state: "rejected",
            verification: { state: "not_required", required: false, checks: ["pending_operation_rejected"] },
          })),
        }, "secretary brain decision");
        return result;
      }
    }
    const secondBrainCommand = parseSecondBrainCommand(input.message);
    if (secondBrainCommand?.type === "remember") {
      if (secondBrainCommand.memoryKind === "alias") {
        return persistSecondBrainCandidate(
          identity,
          { ...input, conversationId },
          conversationMemory,
          {
            memoryKind: "alias",
            key: secondBrainCommand.key,
            value: secondBrainCommand.value,
            confidenceBps: 7000,
            metadata: {
              ...(secondBrainCommand.metadata ?? {}),
              source: "explicit_alias_without_entity_association",
            },
          },
          requestId,
          Boolean(options.dryRun),
        );
      }
      if (!options.dryRun) {
        await rememberSecondBrain(identity, {
          memoryKind: secondBrainCommand.memoryKind,
          key: secondBrainCommand.key,
          value: secondBrainCommand.value,
          metadata: secondBrainCommand.metadata,
          conversationId,
          turnId: requestId,
        });
      }
      return persistSecondBrainCommand(
        identity,
        { ...input, conversationId },
        conversationMemory,
        secondBrainCommand,
        requestId,
        Boolean(options.dryRun),
      );
    }
    if (secondBrainCommand?.type === "recall") {
      return persistSecondBrainCommand(
        identity,
        { ...input, conversationId },
        conversationMemory,
        secondBrainCommand,
        requestId,
        Boolean(options.dryRun),
      );
    }
    const secondBrainSuggestion = parseSecondBrainCandidate(input.message);
    if (secondBrainSuggestion) {
      return persistSecondBrainCandidate(
        identity,
        { ...input, conversationId },
        conversationMemory,
        secondBrainSuggestion,
        requestId,
        Boolean(options.dryRun),
      );
    }
    const naturalMemoryStatement = parseNaturalMemoryStatement(input.message);
    if (naturalMemoryStatement) {
      if (naturalMemoryStatement.action === "update") {
        const exists = await hasActiveSecondBrainMemory(
          identity,
          naturalMemoryStatement.memoryKind,
          naturalMemoryStatement.key,
        );
        if (!exists) {
          return persistNaturalMemoryUpdateClarification(
            identity,
            { ...input, conversationId },
            conversationMemory,
            naturalMemoryStatement,
            requestId,
            Boolean(options.dryRun),
          );
        }
      } else {
        const existing = await getActiveSecondBrainMemory(
          identity,
          naturalMemoryStatement.memoryKind,
          naturalMemoryStatement.key,
        );
        if (existing && existing.value !== naturalMemoryStatement.value) {
          return persistNaturalMemoryUpdateClarification(
            identity,
            { ...input, conversationId },
            conversationMemory,
            naturalMemoryStatement,
            requestId,
            Boolean(options.dryRun),
            {
              reason: "natural_memory_capture_conflicts_with_current",
              message: `لدي اتفاق محفوظ عن ${naturalMemoryStatement.personName} و${naturalMemoryStatement.topicKey.replace(/_/g, " ")}. هل هذه صياغة جديدة للاتفاق نفسه أم اتفاق منفصل؟`,
            },
          );
        }
      }
      const metadata = await resolveNaturalMemoryMetadata(identity, naturalMemoryStatement);
      const command: SecondBrainCommand = {
        type: "remember",
        memoryKind: naturalMemoryStatement.memoryKind,
        key: naturalMemoryStatement.key,
        value: naturalMemoryStatement.value,
        metadata: {
          ...metadata,
          naturalMemoryAction: naturalMemoryStatement.action,
        },
      };
      if (naturalMemoryStatement.action === "update") {
        if (!options.dryRun) {
          const updated = await updateSecondBrainMemoryIfPresent(identity, {
            memoryKind: command.memoryKind,
            key: command.key,
            value: command.value,
            metadata: command.metadata,
            conversationId,
            turnId: requestId,
          });
          if (!updated) {
            return persistNaturalMemoryUpdateClarification(
              identity,
              { ...input, conversationId },
              conversationMemory,
              naturalMemoryStatement,
              requestId,
              false,
            );
          }
        }
      } else if (!options.dryRun) {
        await rememberSecondBrain(identity, {
          memoryKind: command.memoryKind,
          key: command.key,
          value: command.value,
          metadata: command.metadata,
          conversationId,
          turnId: requestId,
        });
      }
      return persistSecondBrainCommand(
        identity,
        { ...input, conversationId },
        conversationMemory,
        command,
        requestId,
        Boolean(options.dryRun),
      );
    }
    const learningSignal = detectLearningSignal(input.message, conversationMemory.recentTurns);
    const semanticParse = featureFlags.deterministicIntelligence()
      ? parseSemanticRequest(input.message)
      : null;
    const deterministicMetrics: DeterministicRequestMetrics = createDeterministicRequestMetrics();
    if (semanticParse) {
      deterministicMetrics.normalizationApplied = semanticParse.normalizedText !== input.message.trim();
      deterministicMetrics.semanticParsed = true;
    }
    const parsedMemoryCommand = parseSecondBrainCommand(input.message);
    const recallPlan = buildRecallPlan(input.message, {
      explicitMemoryRecall: parsedMemoryCommand?.type === "recall",
    });
    const parsedRelationshipRequest = featureFlags.deterministicIntelligence()
      && recallPlan.sources.includes("structured_records")
      ? parseRelationshipRequest(input.message, conversationMemory.state)
      : null;
    const relationshipContextRequested = recallPlan.sources.includes("relationships")
      || recallPlan.sources.includes("activity")
      || Boolean(parsedRelationshipRequest);
    const relationshipContext = featureFlags.deterministicIntelligence() && relationshipContextRequested
      ? await retrieveRelationshipContext(identity, input.message, conversationMemory.state).catch((error) => {
          logger.warn({
            requestId,
            error: error instanceof Error ? error.message : "RELATIONSHIP_CONTEXT_FAILED",
          }, "relationship-aware context retrieval failed");
          return null;
        })
      : null;
    const secondBrainQueryDomain = recallPlan.queryDomain;
    const [secondBrainRetrieval, responseStylePreferences] = await Promise.all([
      recallPlan.sources.includes("second_brain")
        ? retrieveSecondBrain(identity, input.message, {
          limit: recallPlan.limits.secondBrain,
          mode: parsedMemoryCommand?.type === "recall" ? "explicit_recall" : "lexical_v1",
          queryDomain: secondBrainQueryDomain,
          requestId,
          conversationId,
          temporalMode: recallPlan.temporalMode,
          includeArchived: parsedMemoryCommand?.type === "recall",
        })
        : Promise.resolve({
          memories: [],
          trace: emptyRetrievalTrace(input.message, false, secondBrainQueryDomain, {
            requestId,
            conversationId,
          }),
        }),
      listActiveSecondBrainPreferences(identity, 3),
    ]);
    secondBrainRetrieval.trace.recallPlan = {
      sources: recallPlan.sources,
      selection: recallPlan.selection,
    };
    secondBrainRetrieval.trace.temporalMode = recallPlan.temporalMode;
    const governedSecondBrain = applySecondBrainPolicy(
      secondBrainRetrieval.memories,
      secondBrainRetrieval.trace,
    );
    const secondBrainMemories = applySecondBrainContextBudget(
      governedSecondBrain.memories,
      governedSecondBrain.trace,
      governedSecondBrain.trace.queryDomain,
    );
    let structuredComparisonData: Record<string, unknown> | null = null;
    let structuredComparisonContextIncluded = false;
    if (secondBrainQueryDomain === "structured_record_comparison") {
      const projectMention = semanticParse?.entityMentions.find((mention) => mention.entityType === "project");
      const projectQuery = projectMention?.query
        .replace(/\s+(?:كان|كانت|هو|هي)\s*$/u, "")
        .trim();
      let projectResult = projectQuery
        ? await resolveEntity(identity, "project", projectQuery)
        : null;
      if (
        projectResult
        && projectResult.matchType === "none"
        && projectQuery
        && !/^مشروع\s+/u.test(projectQuery)
      ) {
        projectResult = await resolveEntity(identity, "project", `مشروع ${projectQuery}`);
      }
      if (projectResult?.selected) {
        const officialRecords = await executeStructuredTool(identity, "query_expenses", {
          projectId: projectResult.selected.id,
          limit: 50,
        }, {
          requestId,
          conversationId,
          dryRun: options.dryRun,
        });
        if (officialRecords.ok) {
          structuredComparisonData = {
            project: {
              id: projectResult.selected.id,
              name: projectResult.selected.name,
            },
            expenses: officialRecords.expenses,
            summary: officialRecords.summary,
            authority: "structured_financial_record",
          };
          structuredComparisonContextIncluded = true;
        }
      }
    }
    const contextAssembly = assembleContext({
      plan: recallPlan,
      relationshipContext: relationshipContext?.context,
      memories: secondBrainMemories,
      responseStylePreferences,
      secondBrainTrace: governedSecondBrain.trace,
      structuredComparison: structuredComparisonData,
    });
    const assembledContextMessage = contextAssembly
      ? serializeContextAssembly(contextAssembly)
      : null;
    const initialBrainEnvelope = createBrainDecisionEnvelope({
      requestId,
      conversationId,
      message: input.message,
      semanticParse,
      relationshipContext,
      secondBrainTrace: governedSecondBrain.trace,
      hasConversationContext: conversationMemory.recentTurns.length > 0 || Boolean(conversationMemory.summary),
      state: "understanding",
    });
    const financialFollowupAdjustment = featureFlags.deterministicIntelligence()
      ? parseFinancialFollowupAdjustment(input.message, conversationMemory.state)
      : null;
    const messages: ConversationMessage[] = [
      ...conversationContextMessages(conversationMemory),
      {
        role: "system" as const,
        text: `[خطة الاسترجاع المحددة حتميًا]\n${JSON.stringify({
          sources: recallPlan.sources,
          sourceReasons: recallPlan.sourceReasons,
          temporalMode: recallPlan.temporalMode,
          order: [
            "structured_records",
            "relationships",
            "activity",
            "second_brain",
          ],
        })}`,
      },
      ...(input.context
        ? [{
            role: "system" as const,
            text: `[سياق سكرتير محدود]\n${JSON.stringify({
              channel: input.channel ?? "main",
              context: input.context,
              ...(input.peer ? { peer: input.peer } : {}),
            })}`,
          }]
        : input.peer
          ? [{
              role: "system" as const,
              text: `[بيانات قناة سكرتير مستقبلية]\n${JSON.stringify({
                channel: input.channel ?? "main",
                peer: input.peer,
              })}`,
            }]
          : [{
              role: "system" as const,
              text: `[قناة السكرتير: ${input.channel ?? "main"}]`,
            }]),
      ...(assembledContextMessage
        ? [{ role: "user" as const, text: assembledContextMessage }]
        : []),
      {
        role: "system" as const,
        text: `[قرار Brain v1 transient — ليس مصدرًا قانونيًا]\n${JSON.stringify({
          strategy: initialBrainEnvelope.strategy,
          intent: initialBrainEnvelope.intent,
          context: initialBrainEnvelope.context,
          risk: initialBrainEnvelope.risk,
        })}`,
      },
      { role: "user", text: input.message.trim() },
    ];
    let activeToolScope = classifyToolScope(semanticParse?.normalizedText ?? input.message);
    let toolCalls = 0;
    let llmCalls = 0;
    const metrics = createGatewayMetrics();
    let action: Record<string, unknown> | undefined;
    const toolHistory: ToolHistoryEntry[] = [];
    let finalizationAttempted = false;
    let conversationState: ConversationState = featureFlags.experimentalMemoryIntelligence()
      ? conversationMemory.state
      : {
          ...conversationMemory.state,
          facts: [],
          preferences: [],
          relationships: [],
        };
    const diagnosticCalls: DiagnosticLogicalCall[] = [];

    const startDiagnosticCall = (
      logicalCallNumber: number,
      phase: DiagnosticLogicalCall["phase"],
      scope: ToolScope["name"] | null,
      requestedTools: string[],
      finalResponseOnly: boolean,
    ): DiagnosticLogicalCall => {
      const call: DiagnosticLogicalCall = {
        logicalCallNumber,
        phase,
        scope,
        requestedTools: [...requestedTools],
        finalResponseOnly,
        attempts: [],
        selectedTools: [],
        nextDecision: null,
      };
      diagnosticCalls.push(call);
      return call;
    };

    const setDiagnosticDecision = (
      call: DiagnosticLogicalCall,
      decision: DiagnosticNextDecision,
    ): void => {
      call.nextDecision = decision;
    };

    const persistResult = async (finalResponse: FinalResponse): Promise<Phase2TurnResult> => {
      const providerSelection = this.gateway.getProviderForRequest?.(requestId) ?? {
        provider: this.gateway.provider,
        model: this.gateway.modelName,
      };
      const providerTrace = this.gateway.getTrace?.(requestId);
      const patternHistory = featureFlags.experimentalPatternInsights()
        ? await loadExperimentalPatternHistory(identity)
        : null;
      const patternInsights = patternHistory
        ? buildPatternInsights(patternHistory.relationships, patternHistory.expenses)
        : [];
      const latestVerification = [...toolHistory]
        .reverse()
        .map((entry) => entry.result.verification)
        .find((value) => value && typeof value === "object") as
        | { state?: BrainVerificationState; required?: boolean; checks?: string[] }
        | undefined;
      const brainState = action?.type === "approval_required"
        ? "awaiting_approval" as const
        : finalResponse.kind === "error"
          ? "failed" as const
          : finalResponse.kind === "clarification"
            ? "clarification" as const
            : "completed" as const;
      const brainEnvelope: BrainDecisionEnvelope = createBrainDecisionEnvelope({
        requestId,
        conversationId,
        message: input.message,
        semanticParse,
        relationshipContext,
        secondBrainTrace: governedSecondBrain.trace,
        hasConversationContext: conversationMemory.recentTurns.length > 0 || Boolean(conversationMemory.summary),
        toolCalls,
        llmCalls,
        state: brainState,
        ...(latestVerification
          ? { verification: latestVerification }
          : action?.type === "approval_required"
            ? {
                verification: {
                  state: "pending" as const,
                  required: true,
                  checks: ["approval_required", "authoritative_structured_result"],
                },
              }
            : {}),
      });
      const finalAction = {
        ...(compactActionForMemory(action) ?? {
          type: "llm_response",
          conversationState,
        }),
        ...(input.inputId ? { inputId: input.inputId } : {}),
        deterministicIntelligence: deterministicMetrics,
        ...(learningSignal ? { learningSignal } : {}),
        secondBrainRetrievalTrace: governedSecondBrain.trace,
        ...(patternInsights.length > 0 ? { patternInsights } : {}),
        llmCalls,
        toolCalls,
        ...(providerTrace ? { providerTrace } : {}),
      };
      const result: Phase2TurnResult = {
        conversationId,
        turnId: requestId,
        assistantMessage: finalResponse.message,
        response: finalResponse,
        action: finalAction,
        provider: providerSelection.provider,
        model: providerSelection.model,
      };
      if (!options.dryRun) {
        await saveConversationTurn(identity, conversationMemory, {
          turnId: requestId,
          ...(input.inputId ? { inputId: input.inputId } : {}),
          userMessage: input.message.trim(),
          assistantMessage: result.assistantMessage,
          action: result.action,
        });
        if (input.idempotencyKey) await saveIdempotent(identity, input.idempotencyKey, result);
      }
      logger.info({
        requestId,
        provider: providerSelection.provider,
        model: providerSelection.model,
        toolCalls,
        llmCalls,
        fallback: providerTrace?.fallbackOccurred ?? false,
        fallbackReason: providerTrace?.fallbackReason,
        providersAttempted: providerTrace?.providersAttempted,
        toolCallsExecutedBeforeFailure: providerTrace?.toolCallsExecutedBeforeFailure,
        latencyMs: Date.now() - startedAt,
        dryRun: options.dryRun ?? false,
      }, "agent final response");
      logger.info({
        requestId,
        conversationId,
        ...brainLogFields(brainEnvelope),
      }, "secretary brain decision");
      logger.info({
        requestId,
        conversationId,
        ...deterministicMetrics,
        learningSignal: learningSignal?.kind,
      }, "agent deterministic intelligence summary");
      return result;
    };
    let usageSummaryLogged = false;
    const finishRequestInstrumentation = (): void => {
      if (usageSummaryLogged) return;
      usageSummaryLogged = true;
      const usageSummary = summarizeGatewayMetrics(
        metrics,
        toolCalls,
        Date.now() - startedAt,
        diagnosticCalls,
      );
      const diagnosticTrace = buildDiagnosticTrace(metrics, diagnosticCalls);
      const deterministicTrace = {
        parseSemanticRequest: semanticParse
          ? {
              intent: semanticParse.intent,
              confidence: semanticParse.confidence,
              domains: semanticParse.domains,
              entityMentions: semanticParse.entityMentions,
              dateTime: semanticParse.dateTime ?? null,
              hasWriteLanguage: semanticParse.hasWriteLanguage,
              hasNegativeWriteLanguage: semanticParse.hasNegativeWriteLanguage,
              hasReadLanguage: semanticParse.hasReadLanguage,
              ambiguous: semanticParse.ambiguous,
            }
          : null,
        parseRelationshipRequest: relationshipContext
          ? {
              intent: relationshipContext.context.intent,
              resolvedEntities: relationshipContext.context.resolvedEntities.map((entity) => ({
                type: entity.type,
                name: entity.name,
                matchType: entity.matchType,
                confidence: entity.confidence,
              })),
              uncertainties: relationshipContext.context.uncertainties,
              responseKind: relationshipContext.response?.kind ?? null,
            }
          : null,
        isUnanchoredConversationFollowup: isUnanchoredConversationFollowup(
          input.message,
          conversationMemory.state,
        ),
        classifySecondBrainQuery: governedSecondBrain.trace.queryDomain,
        applySecondBrainPolicy: {
          selectedCount: governedSecondBrain.trace.selected.length,
          excluded: governedSecondBrain.trace.excluded.map((item) => item.reason),
          structuredPrecedence: governedSecondBrain.trace.structuredPrecedence,
          llmContextIncluded: governedSecondBrain.trace.llmContextIncluded,
          llmContextReason: governedSecondBrain.trace.llmContextReason,
        },
        structuredComparisonContextIncluded,
      };
      logger.info({
        requestId,
        conversationId,
        totalLogicalLlmCalls: usageSummary.totalLogicalLlmCalls,
        totalHttpAttempts: usageSummary.totalHttpAttempts,
        totalInputTokens: usageSummary.totalInputTokens,
        totalOutputTokens: usageSummary.totalOutputTokens,
        totalTokens: usageSummary.totalTokens,
        totalCachedTokens: usageSummary.totalCachedTokens,
        usageCompleteness: usageSummary.usageCompleteness,
        totalToolCalls: usageSummary.totalToolCalls,
        fallbackCount: usageSummary.fallbackCount,
        retryCount: usageSummary.retryCount,
        cacheHit: usageSummary.cacheHit,
        cacheMiss: usageSummary.cacheMiss,
        latencyMs: usageSummary.latencyMs,
        context: usageSummary.context,
        deterministicTrace,
        diagnosticTrace,
      }, "agent llm usage summary");
      this.gateway.finishRequest?.(requestId);
    };

    const recentExpenseTotalContext = conversationMemory.recentTurns.some((turn) =>
      isGlobalExpenseTotalRequest(turn.userMessage)
      || /(?:إجمالي|اجمالي|مجموع)\s+(?:المصروفات|المصاريف)/i.test(turn.assistantMessage),
    );
    const deterministicExpensePeriodRequested = deterministicExpensePeriod(input.message);
    const deterministicExpenseSummaryRequested = isBroadExpenseReportRequest(input.message)
      || isGlobalExpenseTotalRequest(input.message)
      || deterministicExpensePeriodRequested !== null
      || (isExpenseTotalCorrectionRequest(input.message) && recentExpenseTotalContext);

    if (semanticParse) {
      const parsedDecision = decideDeterministically(semanticParse);
      const decision = !featureFlags.experimentalGeneralArabicUnderstanding()
        && parsedDecision.kind === "deterministic"
        && !isProductionDeterministicIntent(semanticParse.intent)
        ? {
            kind: "llm" as const,
            intent: "unknown" as const,
            confidence: parsedDecision.confidence,
            reason: "intent_outside_production_safe_gate",
          }
        : parsedDecision;
      deterministicMetrics.decision = decision.kind === "llm"
        ? "llm_fallback"
        : decision.kind === "clarification"
          ? "clarification"
          : "deterministic";
      deterministicMetrics.falsePositiveGuard = decision.kind === "llm" ? "not_applicable" : "passed";
      if (decision.kind === "deterministic" && featureFlags.experimentalProviderClaims()) {
        deterministicMetrics.llmCallsAvoided = 1;
        deterministicMetrics.llmAvoidanceMeasurement = "decision_level_estimate";
      }
      if (decision.kind !== "llm") {
        const entityMentions = semanticParse.entityMentions;
        deterministicMetrics.resolverUsed = entityMentions.length > 0;
        try {
          const preflight = await deterministicPreflight(identity, semanticParse, decision, {
            requestId,
            conversationId,
            idempotencyKey: input.idempotencyKey,
            dryRun: options.dryRun,
            channel: input.channel,
            metrics: deterministicMetrics,
          });
          if (preflight) {
            action = {
              ...preflight.action,
              deterministicIntelligence: deterministicMetrics,
            };
            deterministicMetrics.solvedWithoutLlm = true;
            if (preflight.action.type === "clarification_needed") {
              deterministicMetrics.decision = "clarification";
              deterministicMetrics.falsePositiveGuard = "blocked";
            }
            return await persistResult(preflight.response);
          }
          deterministicMetrics.decision = "llm_fallback";
          deterministicMetrics.llmCallsAvoided = 0;
          deterministicMetrics.llmAvoidanceMeasurement = "not_claimed";
          deterministicMetrics.falsePositiveGuard = "not_applicable";
        } catch (error) {
          deterministicMetrics.decision = "llm_fallback";
          deterministicMetrics.llmCallsAvoided = 0;
          deterministicMetrics.llmAvoidanceMeasurement = "not_claimed";
          deterministicMetrics.falsePositiveGuard = "blocked";
          logger.warn({
            requestId,
            error: error instanceof SecretaryError ? error.code : "DETERMINISTIC_PREFLIGHT_FAILED",
          }, "deterministic preflight failed; falling back to LLM");
        }
      }
    }

    if (financialFollowupAdjustment) {
      if (financialFollowupAdjustment.status !== "ready") {
        deterministicMetrics.decision = "clarification";
        deterministicMetrics.falsePositiveGuard = "blocked";
        action = {
          type: "clarification_needed",
          source: "deterministic_intelligence",
          reason: financialFollowupAdjustment.status,
        };
        return await persistResult({
          kind: "clarification",
          message: financialFollowupAdjustment.status === "currency_mismatch"
            ? "العملة الجديدة مختلفة عن عملة المصروف السابق. حدّد المصروف والعملة المطلوبين."
            : "لا يوجد مصروف منفذ وواضح في سياق المحادثة لأزيد عليه.",
        });
      }
      deterministicMetrics.decision = "deterministic";
      deterministicMetrics.falsePositiveGuard = "passed";
      const result = await executeStructuredTool(identity, "update_expense", {
        expenseId: financialFollowupAdjustment.expenseId,
        amountDeltaMinor: financialFollowupAdjustment.deltaMinor,
        expectedCurrency: financialFollowupAdjustment.currency,
      }, {
        requestId,
        dryRun: options.dryRun,
        conversationId,
        idempotencyKey: input.idempotencyKey,
      });
      const preflight = deterministicApprovalResponse("update_expense", result);
      action = {
        ...(preflight?.action ?? {
          type: "deterministic_write",
          source: "deterministic_intelligence",
          toolName: "update_expense",
        }),
        adjustment: {
          previousAmountMinor: financialFollowupAdjustment.previousAmountMinor,
          deltaMinor: financialFollowupAdjustment.deltaMinor,
          amountMinor: financialFollowupAdjustment.amountMinor,
          currency: financialFollowupAdjustment.currency,
        },
      };
      deterministicMetrics.solvedWithoutLlm = true;
      return await persistResult(preflight?.response ?? {
        kind: result.ok ? "answer" : "error",
        message: result.ok ? "جهزت تعديل المصروف للموافقة." : "لم أستطع تجهيز التعديل بأمان.",
      });
    }

    if (
      conversationMemory.recentTurns.length === 0
      && !conversationMemory.summary
      && isUnanchoredConversationFollowup(input.message, conversationMemory.state)
    ) {
      deterministicMetrics.decision = "clarification";
      deterministicMetrics.falsePositiveGuard = "blocked";
      deterministicMetrics.solvedWithoutLlm = true;
      action = {
        type: "clarification_needed",
        source: "deterministic_intelligence",
        reason: "missing_conversation_context",
      };
      try {
        return await persistResult({
          kind: "clarification",
          message: "محتاج تفاصيل العملية السابقة أو رسالة تسجيلها الأول عشان أحدد المصروف المقصود وأعدّل تاريخه بأمان.",
        });
      } finally {
        finishRequestInstrumentation();
      }
    }

    const canRecallUnlinkedAgreement = (
      relationshipContext?.response?.kind === "not_found"
      || (
        relationshipContext?.response?.kind === "clarification"
        && relationshipContext.context.uncertainties.includes("entity_not_resolved")
      )
    )
      && governedSecondBrain.memories.some((memory) => {
        if (
          memory.kind !== "fact"
          || memory.metadata?.naturalCapture !== "agreement_statement"
          || typeof memory.metadata?.entityId === "string"
          || typeof memory.metadata?.normalizedPersonName !== "string"
        ) {
          return false;
        }
        return normalizeEntityText(input.message)
          .includes(normalizeEntityText(memory.metadata.normalizedPersonName as string));
      });
    if (relationshipContext?.response && !canRecallUnlinkedAgreement) {
      deterministicMetrics.solvedWithoutLlm = true;
      deterministicMetrics.decision = relationshipContext.response.kind === "clarification"
        ? "clarification"
        : "deterministic";
      deterministicMetrics.falsePositiveGuard = relationshipContext.response.kind === "clarification"
        ? "blocked"
        : "passed";
      deterministicMetrics.resolverUsed = relationshipContext.context.resolvedEntities.length > 0;
      deterministicMetrics.entityMatches = relationshipContext.context.resolvedEntities.length;
      conversationState = mergeConversationReferents(
        conversationState,
        relationshipContext.context.resolvedEntities,
      );
      action = {
        type: "relationship_context",
        source: "deterministic_intelligence",
        intent: relationshipContext.context.intent,
        context: relationshipContext.context,
        conversationState,
      };
      try {
        return await persistResult(relationshipContext.response);
      } finally {
        finishRequestInstrumentation();
      }
    }

    if (deterministicExpenseSummaryRequested) {
      if (semanticParse) {
        deterministicMetrics.solvedWithoutLlm = true;
        deterministicMetrics.decision = "deterministic";
      }
      const unitAuditResult = await executeStructuredTool(identity, "audit_expense_units", {
        limit: 100,
      }, {
        requestId,
        conversationId,
      });
      const unitAudit = unitAuditResult.audit as ExpenseUnitAuditReport | undefined;
      if (!unitAuditResult.ok || !unitAudit) {
        throw new SecretaryError("تعذر فحص وحدات المصروفات.", {
          status: 500,
          category: "agent_error",
          code: "EXPENSE_UNIT_AUDIT_FAILED",
          retryable: true,
        });
      }
      if (unitAudit.reviewCount > 0) {
        action = {
          type: "expense_unit_audit_required",
          audit: unitAudit,
        };
        try {
          return await persistResult(expenseUnitAuditResponse(unitAudit));
        } finally {
          finishRequestInstrumentation();
        }
      }
      const report = await executeStructuredTool(identity, "query_expenses", {
        limit: 50,
        ...(deterministicExpensePeriodRequested ? { period: deterministicExpensePeriodRequested } : {}),
      }, {
        requestId,
        conversationId,
      });
      if (!report.ok) {
        throw new SecretaryError("تعذر تحميل تقرير المصروفات.", {
          status: 500,
          category: "agent_error",
          code: "EXPENSE_REPORT_FAILED",
          retryable: true,
        });
      }
      action = {
        type: "expense_report",
        summary: report.summary,
        unitAudit,
      };
      try {
        return await persistResult(broadExpenseReportResponse(report, deterministicExpensePeriodRequested ?? undefined));
      } finally {
        finishRequestInstrumentation();
      }
    }

    const deterministicSchedule = await deterministicScheduleResponse(identity, input.message);
    if (deterministicSchedule) {
      if (semanticParse) {
        deterministicMetrics.solvedWithoutLlm = true;
        deterministicMetrics.decision = "deterministic";
      }
      action = deterministicSchedule.action;
      try {
        return await persistResult(deterministicSchedule.response);
      } finally {
        finishRequestInstrumentation();
      }
    }

    try {
      while (toolCalls < MAX_TOOL_CALLS) {
        if (llmCalls >= MAX_LOGICAL_LLM_CALLS) {
          if (!finalizationAttempted && toolHistory.length > 0) {
            finalizationAttempted = true;
            messages.push({
              role: "user",
              text: "استخدم النتائج التي جُمعت حتى الآن وأرسل final_response فقط. لا تستدعِ أي أداة أخرى ولا تذكر تفاصيل النظام.",
            });
            llmCalls += 1;
            metrics.logicalLlmCalls = llmCalls;
              const diagnosticCall = startDiagnosticCall(
                llmCalls,
                "finalization",
                activeToolScope.name,
                ["final_response"],
                true,
              );
            try {
              const finalization = await this.gateway.generate(messages, {
                requestId,
                conversationId,
                callNumber: llmCalls,
                toolCallsExecuted: toolCalls,
                toolScope: activeToolScope,
                finalResponseOnly: true,
                currentUserMessage: input.message.trim(),
                metrics,
                deadlineAt: startedAt + MODEL_REQUEST_DEADLINE_MS,
              });
              const finalCall = finalization.toolCalls.find((call) => call.name === "final_response");
              if (finalCall) {
                  diagnosticCall.selectedTools = [diagnosticSelectedTool(finalCall)];
                  setDiagnosticDecision(diagnosticCall, {
                    kind: "return_final_response",
                    reason: "Finalization returned a final_response tool call.",
                    nextLogicalCallNumber: null,
                    nextCallKind: null,
                    nextScope: activeToolScope.name,
                  });
                return persistResult(finalResponseFromArgs(finalCall.args, toolHistory, input.message));
              }
              if (finalization.text.trim()) {
                  setDiagnosticDecision(diagnosticCall, {
                    kind: "return_text",
                    reason: "Finalization returned text without a tool call.",
                    nextLogicalCallNumber: null,
                    nextCallKind: null,
                    nextScope: activeToolScope.name,
                  });
                return persistResult(finalResponseFromText(finalization.text, toolHistory, input.message));
              }
                setDiagnosticDecision(diagnosticCall, {
                  kind: "finalization_failed",
                  reason: "Finalization returned neither final_response nor text.",
                  nextLogicalCallNumber: null,
                  nextCallKind: null,
                  nextScope: activeToolScope.name,
                });
              return persistResult(recoveryResponseAfterToolLimit(toolHistory));
            } catch (error) {
                setDiagnosticDecision(diagnosticCall, {
                  kind: "finalization_failed",
                  reason: error instanceof SecretaryError ? error.code : "FINALIZATION_FAILED",
                  nextLogicalCallNumber: null,
                  nextCallKind: null,
                  nextScope: activeToolScope.name,
                });
              logger.warn({
                requestId,
                errorCode: error instanceof SecretaryError ? error.code : "FINALIZATION_FAILED",
                toolCalls,
                llmCalls,
              }, "agent finalization after call limit failed");
              const recovered = recoveryResponseAfterSuccessfulWrite(toolHistory)
                ?? recoveryResponseAfterToolLimit(toolHistory);
              return persistResult(recovered);
            }
          }
          throw new SecretaryError(`Agent stopped after ${MAX_LOGICAL_LLM_CALLS} logical LLM calls.`, {
            status: 500,
            category: "agent_error",
            code: "AGENT_LLM_CALL_LIMIT",
            retryable: false,
          });
        }
        llmCalls += 1;
        metrics.logicalLlmCalls = llmCalls;
        const diagnosticCall = startDiagnosticCall(
          llmCalls,
          "tool_round",
          activeToolScope.name,
          [...activeToolScope.allowedToolNames],
          false,
        );
        let response: GatewayResponse;
        try {
          response = await this.gateway.generate(messages, {
            requestId,
            conversationId,
            callNumber: llmCalls,
            toolCallsExecuted: toolCalls,
            toolScope: activeToolScope,
            currentUserMessage: input.message.trim(),
            metrics,
            deadlineAt: startedAt + MODEL_REQUEST_DEADLINE_MS,
          });
        } catch (error) {
          setDiagnosticDecision(diagnosticCall, {
            kind: "error",
            reason: error instanceof SecretaryError ? error.code : "LLM_GENERATION_FAILED",
            nextLogicalCallNumber: null,
            nextCallKind: null,
            nextScope: activeToolScope.name,
          });
          throw error;
        }
        diagnosticCall.selectedTools = response.toolCalls.map(diagnosticSelectedTool);
        if (response.toolCalls.length === 0) {
          setDiagnosticDecision(diagnosticCall, {
            kind: "return_text",
            reason: "Provider returned no tool calls, so the text response ended the turn.",
            nextLogicalCallNumber: null,
            nextCallKind: null,
            nextScope: activeToolScope.name,
          });
          return persistResult(finalResponseFromText(response.text, toolHistory, input.message));
        }

        let scopeWasWidened = false;
        const outOfScopeCall = response.toolCalls.find(
          (call) => !activeToolScope.allowedToolNames.has(call.name),
        );
        if (outOfScopeCall && !activeToolScope.isFull) {
          const previousScope = activeToolScope;
          activeToolScope = fullToolScope();
          scopeWasWidened = true;
          logger.warn({
            requestId,
            scope: previousScope.name,
            outOfScopeTool: outOfScopeCall.name,
            scopedToolCount: previousScope.allowedToolNames.size,
            widenedToolCount: activeToolScope.allowedToolNames.size,
          }, "agent tool scope widened due to out-of-scope tool call");
        }

        messages.push({
          role: "assistant",
          text: response.text || undefined,
          toolCalls: response.toolCalls,
        });

        const finalCall = response.toolCalls.find((call) => call.name === "final_response");
        if (finalCall && response.toolCalls.length === 1) {
          setDiagnosticDecision(diagnosticCall, {
            kind: "return_final_response",
            reason: "Provider returned only the final_response tool.",
            nextLogicalCallNumber: null,
            nextCallKind: null,
            nextScope: activeToolScope.name,
          });
          return persistResult(finalResponseFromArgs(finalCall.args, toolHistory, input.message));
        }

        const writeCallCount = response.toolCalls.filter((call) => WRITE_TOOLS.has(call.name)).length;
        const pendingApprovals: Array<{
          operationId: string;
          status: unknown;
          toolName: unknown;
          display: { title: string; details: string[] };
          args: unknown;
        }> = [];
        for (const call of response.toolCalls) {
          if (call.name === "final_response") {
            continue;
          }
          toolCalls += 1;
          if (toolCalls > MAX_TOOL_CALLS) break;
          let toolResult: ToolResult;
          try {
            toolResult = await executeTool(identity, call.name, call.args, {
              requestId,
              callId: call.id,
              dryRun: options.dryRun,
              conversationId,
              idempotencyKey: writeCallCount > 1
                ? `${input.idempotencyKey ?? requestId}:${call.id}`
                : input.idempotencyKey,
              channel: input.channel,
            });
          } catch (error) {
            setDiagnosticDecision(diagnosticCall, {
              kind: "error",
              reason: error instanceof SecretaryError ? error.code : "TOOL_EXECUTION_FAILED",
              nextLogicalCallNumber: null,
              nextCallKind: null,
              nextScope: activeToolScope.name,
            });
            throw agentToolError(call.name, error);
          }
          const selectedTool = diagnosticCall.selectedTools.find((item) => item.callId === call.id);
          if (selectedTool) selectedTool.result = diagnosticToolResult(toolResult);
          toolHistory.push({ name: call.name, result: toolResult });
          conversationState = updateConversationState(conversationState, call.name, toolResult);
          action = {
            type: "tool_orchestration",
            lastTool: call.name,
            toolCalls,
            llmCalls,
            conversationState,
            toolResult: compactActionForMemory({
              toolResult: jsonSafe(toolResult),
            })?.toolResult,
          };
          if (toolResult.pendingApproval && toolResult.approval
            && typeof toolResult.approval === "object") {
            const approval = toolResult.approval as Record<string, unknown>;
            const display = approval.display && typeof approval.display === "object"
              ? approval.display as { title?: unknown; details?: unknown }
              : {};
            const title = typeof display.title === "string" ? display.title : "هذا التغيير";
            const details = Array.isArray(display.details)
              ? display.details.filter((detail): detail is string => typeof detail === "string")
              : [];
            pendingApprovals.push({
              operationId: String(approval.operationId),
              status: approval.status,
              toolName: approval.toolName,
              display: { title, details },
              args: approval.args,
            });
          }
          messages.push({
            role: "tool",
            toolCallId: call.id,
            toolName: call.name,
            text: compactToolResultForPrompt(toolResult),
          });
          const continuation = expenseContinuationGuidance(semanticParse, call.name, toolResult);
          if (continuation) messages.push({ role: "user", text: continuation });
        }
        if (pendingApprovals.length > 0) {
          const first = pendingApprovals[0];
          setDiagnosticDecision(diagnosticCall, {
            kind: "return_approval",
            reason: `The response returned ${pendingApprovals.length} write operation(s), each pending independent approval.`,
            nextLogicalCallNumber: null,
            nextCallKind: null,
            nextScope: activeToolScope.name,
          });
          action = annotateApprovalAction({
            type: "approval_required",
            operationId: first.operationId,
            status: first.status,
            toolName: first.toolName,
            display: first.display,
            args: first.args,
            approvals: pendingApprovals,
          }, input.channel);
          return persistResult({
            kind: "clarification",
            message: pendingApprovals.length === 1
              ? approvalMessage(
                  action,
                  `قبل ما أنفذ ${first.display.title}${first.display.details.length > 0 ? ` (${first.display.details.join(" — ")})` : ""}، هل توافق؟`,
                  input.channel,
                )
              : `الطلب يحتوي على ${pendingApprovals.length} تغييرات. راجع كل موافقة على حدة قبل التنفيذ.`,
          });
        }
        if (toolCalls >= MAX_TOOL_CALLS) {
          setDiagnosticDecision(diagnosticCall, {
            kind: "tool_limit",
            reason: "The tool-call limit was reached after executing the selected tools.",
            nextLogicalCallNumber: null,
            nextCallKind: null,
            nextScope: activeToolScope.name,
          });
        } else {
          const nextIsFinalization = llmCalls >= MAX_LOGICAL_LLM_CALLS && toolHistory.length > 0;
          setDiagnosticDecision(diagnosticCall, {
            kind: scopeWasWidened
              ? "scope_widened"
              : nextIsFinalization
                ? "schedule_finalization"
                : "continue_after_tool_results",
            reason: scopeWasWidened
              ? `The selected tool was outside the ${diagnosticCall.scope ?? "unknown"} scope; the next call uses full scope.`
              : nextIsFinalization
                ? "The logical-call limit was reached while tool history exists; the next call is finalization."
                : "Tool results were appended to the conversation; the next call continues orchestration.",
            nextLogicalCallNumber: llmCalls + 1,
            nextCallKind: nextIsFinalization ? "finalization" : "tool_round",
            nextScope: activeToolScope.name,
          });
        }
      }

      throw new SecretaryError(`Agent stopped after ${MAX_TOOL_CALLS} tool calls.`, {
        status: 500,
        category: "agent_error",
        code: "AGENT_TOOL_CALL_LIMIT",
        retryable: false,
      });
    } catch (error) {
      const recovered = recoveryResponseAfterSuccessfulWrite(toolHistory);
      if (recovered) return persistResult(recovered);
      if (error instanceof SecretaryError && isTransientProviderFailure(error)) {
        logger.warn({
          requestId,
          conversationId,
          errorCode: error.code,
          toolCalls,
          llmCalls,
        }, "agent provider failure before verified mutation");
        return persistResult({
          kind: "error",
          message: "لم يكتمل الطلب بسبب عطل مؤقت في الخدمة، ولم يتم تغيير أي بيانات. حاول مرة أخرى.",
        });
      }
      throw error;
    } finally {
      finishRequestInstrumentation();
    }
  }
}

export class CohereModelGateway implements ModelGateway {
  readonly provider = "cohere" as const;
  readonly routeKind = "direct_provider" as const;
  readonly usageFormat = "cohere" as const;
  private readonly apiKey = process.env.COHERE_API_KEY;
  readonly model = COHERE_MODEL;

  get modelName(): string {
    return this.model;
  }

  async generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse> {
    if (!this.apiKey) throw new Error("COHERE_API_KEY is not configured.");
    const tools = toCohereTools(context.toolScope, context.finalResponseOnly);
    const instructions = buildProviderInstructions(context);
    const apiMessages = [
      {
        role: "system",
        content: instructions.text,
      },
      ...budgetMessages(messages).map((message) => {
        if (message.role === "assistant") {
          return {
            role: "assistant",
            ...(message.text ? { content: message.text } : {}),
            ...(message.toolCalls?.length
              ? {
                  tool_calls: message.toolCalls.map((call) => ({
                    id: call.id,
                    type: "function",
                    function: { name: call.name, arguments: JSON.stringify(call.args) },
                  })),
                }
              : {}),
          };
        }
        if (message.role === "tool") {
          return {
            role: "tool",
            tool_call_id: message.toolCallId,
            content: [{
              type: "document",
              document: { data: message.text ?? "{}" },
            }],
          };
        }
        return { role: message.role, content: message.text ?? "" };
      }),
    ];
    const requestBody = JSON.stringify({
      model: this.model,
      messages: apiMessages,
      tools,
      tool_choice: "AUTO",
      temperature: 0.15,
      max_tokens: 2048,
    });
    const systemText = instructions.text;
    const attemptMeasurement = recordProviderRequest(context, "cohere", {
      model: this.model,
      routeKind: this.routeKind,
      usageFormat: this.usageFormat,
      requestBytes: Buffer.byteLength(requestBody),
      systemPromptChars: systemText.length,
      toolDefinitionsChars: JSON.stringify(tools).length,
      toolDefinitionsCount: tools.length,
      toolNames: tools.map((definition) => definition.function.name),
      conversationChars: JSON.stringify(apiMessages.slice(1)).length,
      context: contextBreakdown(
        messages,
        context.currentUserMessage,
        Buffer.byteLength(requestBody),
        JSON.stringify(tools).length,
        instructions,
      ),
      fallback: Boolean(context.providerFallback),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutForDeadline(context.deadlineAt, 25_000));
    const startedAt = Date.now();
    logger.info({
      requestId: context.requestId,
      provider: this.provider,
      model: this.model,
      llmCall: context.callNumber,
      attempt: 1,
      requestBytes: Buffer.byteLength(requestBody),
      systemPromptChars: systemText.length,
      toolDefinitionsChars: JSON.stringify(tools).length,
      toolDefinitionsCount: tools.length,
      toolNames: tools.map((definition) => definition.function.name),
      conversationChars: JSON.stringify(apiMessages.slice(1)).length,
    }, "agent llm call started");
    try {
      const response = await fetch(COHERE_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: requestBody,
        signal: controller.signal,
      });
      const raw = await response.text();
      if (response.ok) {
        const payload = JSON.parse(raw) as {
          message?: {
            content?: string | Array<{ type?: string; text?: string }>;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
          usage?: unknown;
        };
        const message = payload.message;
        const text = Array.isArray(message?.content)
          ? message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text ?? "")
            .join("")
            .trim()
          : message?.content?.trim() ?? "";
        const responseResult = {
          text,
          toolCalls: (message?.tool_calls ?? []).map((call) => ({
            id: call.id,
            name: call.function.name,
            args: parseJsonObject(call.function.arguments),
          })),
          usage: payload.usage,
        };
        finishLlmAttempt(context, attemptMeasurement, responseResult.usage, {
          success: true,
          outputChars: responseResult.text.length + JSON.stringify(responseResult.toolCalls).length,
        });
        logger.info({
          requestId: context.requestId,
          provider: this.provider,
          model: this.model,
          llmCall: context.callNumber,
          attempt: 1,
          toolCalls: responseResult.toolCalls.length,
          latencyMs: Date.now() - startedAt,
        }, "agent llm call completed");
        return responseResult;
      }
      const error = providerResponseError(
        "cohere",
        response.status,
        raw,
        parseRetryAfter(response.headers.get("retry-after")),
      );
      if (response.status === 429) {
        logger.warn({
          requestId: context.requestId,
          provider: this.provider,
          model: this.model,
          llmCall: context.callNumber,
          attempt: 1,
          retryAfterSeconds: error.retryAfterSeconds,
          safeToRetry: false,
        }, "agent llm rate limit deferred to failover");
      }
      throw error;
    } catch (error) {
      finishLlmAttempt(context, attemptMeasurement, undefined, {
        success: false,
        failureReason: error instanceof SecretaryError ? error.code : "PROVIDER_REQUEST_FAILED",
      });
      const classified = error instanceof SecretaryError
        ? error
        : providerExceptionError("cohere", error);
      logLlmFailure("cohere", this.model, context, 1, classified);
      throw classified;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type ConfiguredProvider = ProviderName | "development" | "unavailable";

function asProvider(value: string | undefined): ProviderName | undefined {
  const normalized = value?.trim().toLowerCase();
  return inferenceServiceIsKnown(normalized) ? normalized : undefined;
}

function configuredRouteService(environmentName: string): ProviderName | undefined {
  const raw = process.env[environmentName]?.trim().toLowerCase();
  if (!raw) return undefined;
  const serviceName = serviceNameForRouteId(raw)
    ?? (inferenceServiceIsKnown(raw) ? raw : undefined);
  if (!serviceName) throw new Error(`INVALID_${environmentName}:${raw}`);
  return serviceName;
}

function configuredRouteOrderServices(): ProviderName[] | undefined {
  const raw = process.env.AI_ROUTE_ORDER?.trim();
  if (!raw) return undefined;
  const services = raw.split(",").map((value) => {
    const route = value.trim().toLowerCase();
    const serviceName = serviceNameForRouteId(route)
      ?? (inferenceServiceIsKnown(route) ? route : undefined);
    if (!serviceName) throw new Error(`INVALID_AI_ROUTE_ORDER:${route}`);
    return serviceName;
  });
  return services.filter((service, index) => services.indexOf(service) === index);
}

export function configuredProviderOrder(): ProviderName[] {
  const routeOrder = configuredRouteOrderServices();
  const fallbackPreference = routeOrder
    ?? (featureFlags.providerRouting() ? providerOrder() : defaultInferenceServiceOrder());
  const firstConfiguredByRouting = fallbackPreference.find(inferenceServiceIsConfigured);
  const originalDefaultProvider = defaultInferenceServiceOrder().find(inferenceServiceIsConfigured);
  const primary = configuredRouteService("AI_PRIMARY_ROUTE")
    ?? asProvider(process.env.AI_PRIMARY_PROVIDER)
    ?? asProvider(process.env.AI_PROVIDER)
    ?? (featureFlags.providerRouting() ? firstConfiguredByRouting : originalDefaultProvider);
  const autoFallbacks = (featureFlags.providerRouting()
    ? fallbackPreference
    : defaultInferenceServiceOrder())
    .filter((provider) => provider !== primary)
    .filter(inferenceServiceIsConfigured);
  return [
    primary,
    configuredRouteService("AI_FALLBACK_ROUTE"),
    asProvider(process.env.AI_FALLBACK_PROVIDER),
    configuredRouteService("AI_SECONDARY_FALLBACK_ROUTE"),
    asProvider(process.env.AI_SECONDARY_FALLBACK_PROVIDER),
    ...autoFallbacks,
  ].filter(
    (provider, index, providers): provider is ProviderName => Boolean(provider) && providers.indexOf(provider) === index,
  );
}

export function configuredRouteOrder(): InferenceRouteId[] {
  return configuredProviderOrder().map(routeIdForService);
}

export function configuredProvider(): ConfiguredProvider {
  const configured = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (configured === "development") return "development";
  return configuredProviderOrder()[0] ?? "unavailable";
}

export function phase2Enabled(): boolean {
  return configuredProviderOrder().length > 0;
}

function createGateway(serviceName: ProviderName): ModelGateway {
  const definition = inferenceServiceDefinition(serviceName);
  if (definition.kind === "direct_provider" && definition.protocol === "gemini") {
    return new GeminiModelGateway();
  }
  if (definition.kind === "direct_provider" && definition.protocol === "cohere") {
    return new CohereModelGateway();
  }
  if (definition.kind === "direct_provider" && serviceName === "groq") {
    return new GroqModelGateway();
  }
  if (definition.protocol === "openai-compatible") {
    return new OpenAiCompatibleModelGateway(
      serviceName,
      inferenceServiceApiUrl(serviceName) ?? "",
      inferenceServiceModel(serviceName),
      process.env[definition.apiKeyEnv],
      definition.apiKeyEnv,
      definition.kind,
    );
  }
  throw new Error(`INFERENCE_ADAPTER_NOT_IMPLEMENTED:${serviceName}`);
}

function createConfiguredGateway(): ModelGateway {
  const order = configuredProviderOrder();
  const selectedOrder = order.length > 0 ? order : ["gemini" as const];
  const routes = Object.fromEntries(selectedOrder.map((serviceName) => [
    routeIdForService(serviceName),
    inferenceRouteForService(serviceName),
  ])) as Partial<Record<InferenceRouteId, InferenceRoute>>;
  return new MnrInferenceRouter(
    Object.fromEntries(selectedOrder.map((serviceName) => [
      routeIdForService(serviceName),
      createGateway(serviceName),
    ])),
    selectedOrder.map(routeIdForService),
    routes,
  );
}

export class UnavailableAgentRuntime {
  async run(): Promise<Phase2TurnResult> {
    throw new SecretaryError("No configured LLM provider is available.", {
      status: 503,
      category: "provider_unavailable",
      code: "PROVIDER_NOT_CONFIGURED",
      retryable: false,
    });
  }
}

export const phase2AgentRuntime = new Phase2AgentRuntime(createConfiguredGateway());
export const unavailableAgentRuntime = new UnavailableAgentRuntime();
