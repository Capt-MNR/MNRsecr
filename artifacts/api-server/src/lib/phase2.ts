import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  commitmentsTable,
  db as database,
  expensesTable,
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
  isUnanchoredRelativeDateFollowup,
  parseFinancialFollowupAdjustment,
  retrieveRelationshipContext,
  serializeRelationshipContext,
} from "./relationship-context";
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
} from "./secretary-operations";
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
  createDeterministicRequestMetrics,
  decideDeterministically,
  parseSemanticRequest,
  validateDeterministicPayload,
  isProductionDeterministicIntent,
  type DeterministicRequestMetrics,
  type DeterministicDecision,
  type SemanticParse,
} from "./deterministic-intelligence";
import { resolveEntity, type ResolverResult } from "./entity-resolver";
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

const db = database;

export type Phase2TurnInput = {
  message: string;
  conversationId?: string | null;
  idempotencyKey?: string | null;
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

export type ProviderName = "gemini" | "groq" | "mistral" | "cohere";

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
};

export type GatewayRequestMetrics = {
  logicalLlmCalls: number;
  httpAttempts: number;
  httpAttemptsByProvider: Partial<Record<ProviderName, number>>;
  retryCount: number;
  providerFallbackAttempts: number;
  modelFallbackAttempts: number;
  requestBytesByProvider: Partial<Record<ProviderName, number>>;
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
  generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse>;
  getProviderForRequest?(requestId: string): { provider: ProviderName; model: string };
  getTrace?(requestId: string): ProviderTrace;
  finishRequest?(requestId: string): void;
}

export type ProviderTrace = {
  primaryProvider: ProviderName;
  fallbackProvider?: ProviderName;
  selectedProvider?: ProviderName;
  providersAttempted: ProviderName[];
  fallbackOccurred: boolean;
  fallbackReason?: string;
  toolCallsExecutedBeforeFailure?: number;
  logicalLlmCalls?: number;
  httpAttempts?: number;
  httpAttemptsByProvider?: Partial<Record<ProviderName, number>>;
  retryCount?: number;
  providerFallbackAttempts?: number;
  modelFallbackAttempts?: number;
  requestBytesByProvider?: Partial<Record<ProviderName, number>>;
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
const MISTRAL_MODEL = process.env.MISTRAL_MODEL ?? "mistral-small-latest";
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const COHERE_MODEL = process.env.COHERE_MODEL ?? "command-r-08-2024";
const COHERE_API_URL = "https://api.cohere.com/v2/chat";
const DEFAULT_TIMEZONE = "Africa/Cairo";
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

function identityWhere(identity: Identity, table: { tenantId: any; ownerUserId: any }) {
  return and(
    eq(table.tenantId, identity.tenantId),
    eq(table.ownerUserId, identity.userId),
  );
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, current) =>
      typeof current === "bigint" ? Number(current) : current,
    ),
  );
}

function expenseRowsSummary(rows: unknown[]): {
  count: number;
  totalMinor: number;
  currency: string;
  projectCount: number;
} {
  const totals = new Map<string, number>();
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
    const projectName = typeof outer.projectName === "string"
      ? outer.projectName
      : typeof expense.projectId === "string" ? expense.projectId : null;
    if (projectName) projects.add(projectName);
  }
  const [currency, totalMinor] = [...totals.entries()][0] ?? ["EGP", 0];
  return { count: rows.length, totalMinor, currency, projectCount: projects.size };
}

function broadExpenseReportResponse(
  result: ToolResult,
  period?: DeterministicExpensePeriod,
): FinalResponse {
  const summary = result.summary && typeof result.summary === "object"
    ? result.summary as { count?: unknown; totalMinor?: unknown; currency?: unknown; projectCount?: unknown }
    : {};
  const count = typeof summary.count === "number" ? summary.count : 0;
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
  }, ["taskId"]),
  tool("update_commitment", "Update an accessible commitment by exact ID.", {
    commitmentId: { type: "STRING" },
    title: { type: "STRING" },
    personId: { type: ["STRING", "NULL"] },
    dueAt: { type: ["STRING", "NULL"] },
    status: { type: "STRING", enum: ["open", "completed", "cancelled"] },
  }, ["commitmentId"]),
  tool("update_reminder", "Update an accessible reminder by exact ID.", {
    reminderId: { type: "STRING" },
    text: { type: "STRING" },
    dueAt: { type: "STRING" },
    timezone: { type: "STRING" },
    status: { type: "STRING", enum: ["scheduled", "completed", "cancelled"] },
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
  const exact = normalize(name);
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
  const exact = normalize(name);
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
    approvedOperationId?: string;
    transactionExecutor?: DbExecutor;
    activityWriter?: typeof recordToolActivity;
  },
): Promise<ToolResult> {
  if (WRITE_TOOLS.has(name) && options.approvedOperationId && !options.transactionExecutor) {
    return database.transaction(async (tx) => executeTool(identity, name, rawArgs, {
      ...options,
      transactionExecutor: tx,
    }));
  }
  const db = options.transactionExecutor ?? database;
  const args = rawArgs ?? {};
  logger.info({
    requestId: options.requestId,
    tool: name,
    toolCallId: options.callId,
    arguments: jsonSafe(args),
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
    const pending = await createPendingOperation(identity, {
      conversationId: options.conversationId,
      sourceTurnId: options.sourceTurnId ?? options.requestId,
      idempotencyKey: options.idempotencyKey,
      toolName: name,
      args,
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
      )).returning();
      result = updated ? { ok: true, person: updated } : { ok: false, error: "Person not found." };
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
      )).returning();
      result = updated ? { ok: true, project: updated } : { ok: false, error: "Project not found." };
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
      )).returning();
      result = updated
        ? { ok: true, corrected: true, expense: updated }
        : { ok: false, error: expectedCurrency ? "Expense currency changed after approval was prepared." : "Expense not found." };
      break;
    }
    case "update_task": {
      const taskId = stringArg("taskId");
      if (!taskId) return { ok: false, error: "taskId is required." };
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
      )).returning();
      result = updated ? { ok: true, task: updated } : { ok: false, error: "Task not found." };
      break;
    }
    case "update_commitment": {
      const commitmentId = stringArg("commitmentId");
      if (!commitmentId) return { ok: false, error: "commitmentId is required." };
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
      )).returning();
      result = updated ? { ok: true, commitment: updated } : { ok: false, error: "Commitment not found." };
      break;
    }
    case "update_reminder": {
      const reminderId = stringArg("reminderId");
      if (!reminderId) return { ok: false, error: "reminderId is required." };
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
      )).returning();
      result = updated ? { ok: true, reminder: updated } : { ok: false, error: "Reminder not found." };
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
      if (dependency || commitmentDependency) {
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
      if (dependency || relationshipDependency) {
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
      const rows = await db.select({
        expense: expensesTable,
        personName: peopleTable.name,
        projectName: projectsTable.name,
      }).from(expensesTable)
        .leftJoin(peopleTable, eq(expensesTable.personId, peopleTable.id))
        .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
        .where(and(
          identityWhere(identity, expensesTable),
          personId ? eq(expensesTable.personId, personId) : undefined,
          projectId ? eq(expensesTable.projectId, projectId) : undefined,
          excludeProjectId
            ? or(isNull(expensesTable.projectId), ne(expensesTable.projectId, excludeProjectId))
            : undefined,
          description ? ilike(expensesTable.description, `%${description}%`) : undefined,
          ...dateFilters,
        ))
        .orderBy(desc(expensesTable.occurredAt))
        .limit(limit);
      result = {
        ok: true,
        expenses: rows,
        summary: expenseRowsSummary(rows.map((row) => ({
          ...row.expense,
          projectName: row.projectName,
        }))),
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
      const [total] = await db.select({
        amountMinor: sql<number>`coalesce(sum(${expensesTable.amountMinor}), 0)::bigint`,
        count: sql<number>`count(*)::int`,
        currency: sql<string>`coalesce(min(${expensesTable.currency}), 'unknown')`,
      }).from(expensesTable).where(and(
        identityWhere(identity, expensesTable), eq(expensesTable.personId, personId),
      ));
      result = { ok: true, total: { amountMinor: Number(total?.amountMinor ?? 0), count: Number(total?.count ?? 0), currency: total?.currency ?? "unknown" } };
      break;
    }
    case "get_project_expense_total": {
      if (!projectId) return { ok: false, error: "projectId is required." };
      const [total] = await db.select({
        amountMinor: sql<number>`coalesce(sum(${expensesTable.amountMinor}), 0)::bigint`,
        count: sql<number>`count(*)::int`,
        currency: sql<string>`coalesce(min(${expensesTable.currency}), 'unknown')`,
      }).from(expensesTable).where(and(
        identityWhere(identity, expensesTable), eq(expensesTable.projectId, projectId),
      ));
      result = { ok: true, total: { amountMinor: Number(total?.amountMinor ?? 0), count: Number(total?.count ?? 0), currency: total?.currency ?? "unknown" } };
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
      result = { ok: true, task };
      break;
    }
    case "create_commitment": {
      const title = stringArg("title");
      if (!title) return { ok: false, error: "Commitment title is required." };
      const dueAtValue = stringArg("dueAt");
      const dueAt = dueAtValue ? new Date(dueAtValue) : null;
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
    await activityWriter(identity, name, args, result, db);
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
    approvedOperationId?: string;
    activityWriter?: typeof recordToolActivity;
  } = { requestId: crypto.randomUUID() },
): Promise<ToolResult> {
  return executeTool(identity, name, args, options);
}

const systemInstruction = `أنت سكرتير شخصي عربي يعمل داخل نظام بيانات منظم.
افهم اللغة الطبيعية ولا تعتمد على جملة ثابتة. استخدم الأدوات المعتمدة فقط.
قواعد إلزامية:
1. لا تصل مباشرة إلى قاعدة البيانات ولا تخترع هوية المستخدم أو المستأجر.
2. قبل استخدام شخص أو مشروع، استدع find_person أو find_project. إذا وجدت أكثر من نتيجة لا تختار عشوائيًا؛ اطلب توضيحًا. إذا لم تجد نتيجة وأنشأ المستخدم كيانًا جديدًا بوضوح، استدع أداة الإنشاء.
3. لا تسجل مصروفًا قبل حل الشخص والمشروع عندما يذكرهما المستخدم. استخدم amountMinor كعدد صحيح بوحدات العملة الصغرى، ولا تستخدم أرقامًا عائمة.
4. إذا لم يذكر المستخدم العملة في سياق عربي مصري، استخدم EGP كافتراضي محلي؛ لا تغيّر العملة التي أعادتها قاعدة البيانات.
5. نفّذ الخطوات الآمنة المطلوبة في رسالة واحدة، ولا تقل إن شيئًا تم إلا إذا أعادت الأداة نجاحًا.
6. لا تعرض أسماء الأدوات أو تفاصيل النظام للمستخدم. رد بالعربية الطبيعية عندما تكون الرسالة بالعربية.
7. لا تنشئ ذاكرة دائمة من المحادثة. استخدم recall_context للبيانات القانونية المحفوظة.
 8. عند إنشاء شخص أو مشروع، لا تضف هاتفًا أو بريدًا أو صفة أو علاقة لم يذكرها المستخدم.
 9. سياق المحادثة السابق مؤقت للمساعدة على فهم الإشارات والتصحيحات، وليس مصدرًا قانونيًا. استخدم الأدوات للتحقق من Structured Memory.
 10. إذا صحح المستخدم مبلغًا أو وصفًا لعملية سابقة، استخدم update_expense على expenseId السابق ولا تنشئ مصروفًا جديدًا.
11. عبارات مثل "قصدي ده" و"غيره" و"خليه" و"لا، المبلغ كان" تشير إلى السياق القريب. حلّ المرجع من Conversation State، ثم تحقق من السجل بالأداة المناسبة.
12. إذا كانت النية واضحة والمعلومة ناقصة، اسأل عن المعلومة الناقصة فقط؛ لا تطلب إعادة صياغة الطلب كاملًا. مثال: "عايز أسجل مصروف لمحمد" يتبعه سؤال عن المبلغ، والرد "7500" يكمل الطلب.
13. افهم المرادفات الطبيعية مثل دفع، ادى، أعطى، خد مني، سجل مصروف، ولا تجعل علامات الترقيم شرطًا للفهم.
14. عند وجود عدة نتائج من أداة، لا تنسخ JSON أو تسرد الصفوف واحدًا تلو الآخر. استخدم العدد والإجمالي المحسوبين من الأداة، واذكر التوزيع على المشاريع عند الحاجة. اعرض التفاصيل الفردية فقط إذا طلبها المستخدم صراحة.
15. لا تحسب إجماليًا ماليًا بنفسك إذا أعادت الأداة total أو summary؛ استخدم القيم المحسوبة من قاعدة البيانات كما هي.
16. اعتبر حالة المحادثة المنظمة سياقًا لفهم "ده" و"التاني" و"له" و"الفلوس دي" فقط؛ تحقق دائمًا من IDs عبر الأدوات.
17. لا تذكر رقمًا ماليًا أو عددًا ماليًا من الذاكرة أو التخمين. بعد الأدوات استخدم final_response، وضع كل رقم مالي مؤكد في groundedFacts كما أعادته الأداة. الرسالة نفسها يجب أن تكون طبيعية وليست قالبًا.
18. لا تستخدم final_response قبل إكمال الأدوات اللازمة. إذا كانت البيانات ناقصة أو الأسماء متكررة، اجعل kind = clarification بدل التخمين.
19. عند تسجيل مصروف، اسم الشخص المستلم اختياري. إذا لم يذكره المستخدم لا توقف التسجيل بسببه؛ اسأل مرة واحدة إن كان يريد إضافته، واقبل "بدون اسم" ثم أكمل.
20. قبل اعتماد المصروف اسأل عن اسم المشروع أو الغرض إذا لم يذكره المستخدم. إذا ذكر غرضًا وليس مشروعًا، خزّنه في description ولا تنشئ مشروعًا جديدًا من تلقاء نفسك. لا تعتبر الغرض مشروعًا إلا بعد التحقق من وجوده أو تأكيد المستخدم.
21. عند طلب تذكير أو موعد بيوم نسبي مثل "بكرة" دون ساعة دقيقة، اسأل عن الوقت بشكل اختياري. اقبل ساعة مثل "5 مساءً"، أو "أي وقت" واستخدم 09:00 بتوقيت Africa/Cairo. لا تنفذ التذكير قبل اكتمال dueAt.
22. إذا فشل مزود، لا تعرض رسالة تقنية ولا تقل إن الكتابة تمت. استخدم final_response برسالة عربية قصيرة توضّح أن الطلب لم يكتمل وأن البيانات لم تتغير.`;

const requestGuidance = `إرشادات تنفيذ إضافية:
- جملة الدفع أو الإعطاء أو الاستلام التي تحتوي على اسم شخص ومبلغ هي نية تسجيل مصروف، حتى لو لم تُذكر كلمة "مصروف" أو العملة. أمثلة: "دفعت لمحمد 7500"، "محمد خد مني 7500"، "اديت محمد 7500". نفّذ find_person ثم record_expense مباشرة، ولا تستخدم create_person لمجرد ذكر الاسم.
- استخدم create_person فقط عندما يطلب المستخدم صراحة إضافة أو إنشاء شخص، مثل "أضف محمد كشخص" أو "عايز أضيف شخص اسمه محمد". إذا كانت النية مالية والشخص غير موجود، لا تنشئه تلقائيًا؛ اطلب توضيحًا بين تسجيل المصروف بدون ربط بالشخص أو إضافة الشخص أولًا.
- إذا قال المستخدم إن الشخص موجود بالفعل، لا تنشئه. استخدم find_person عند الحاجة للتحقق، وإذا لم توجد عملية واضحة فاطلب التوضيح بدل تسجيل مصروف.
- لا تجعل وجود اسم شخص وحده نية إنشاء. الفعل المالي + المبلغ يتغلب على مجرد ذكر الاسم، مع بقاء قرار الكتابة خاضعًا للموافقة.
- إذا كانت الرسالة تسأل عن إجمالي ما صُرف على وصف أو فئة مثل "التشطيبات" من دون ذكر مشروع صريح، استخدم query_expenses مع description ثم احسب الناتج من الصفوف. لا تخترع مشروعًا اسمه الفئة.
- إذا كانت الرسالة تسأل "محمد أخد مني كام؟"، نفّذ find_person ثم get_person_expense_total.
- إذا كان اسم المشروع أو الشخص يطابق أكثر من كيان، لا تختار أي نتيجة عشوائيًا؛ اسأل المستخدم، إلا إذا كان السياق السابق يحتوي على اختيار واضح.
- استخدم period = last_month أو this_month أو last_week أو this_week للعبارات الزمنية النسبية، ودع الخادم يحسب الحدود الزمنية.
- استخدم rank_expense_projects لسؤال "أنهي مشروع صرفت فيه أكتر؟"، ولا تجمع أرقام الصفوف بنفسك.
- إذا قال المستخدم "من غير" أو "بدون" مشروع معروف في السياق، استخدم excludeProjectId بعد التحقق من المشروع.
- لا تذكر أسماء الأدوات ولا تنسخ نتائجها الخام في الرد النهائي.
- في نهاية الجولة استدع final_response برسالة عربية طبيعية.`;

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
    retryCount: 0,
    providerFallbackAttempts: 0,
    modelFallbackAttempts: 0,
    requestBytesByProvider: {},
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

export function normalizeProviderUsage(provider: ProviderName, usage: unknown): NormalizedLlmUsage {
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
  const inputTokens = provider === "gemini"
    ? finiteTokenCount(value.promptTokenCount)
    : finiteTokenCount(value.prompt_tokens)
      ?? finiteTokenCount(value.input_tokens)
      ?? finiteTokenCount(nestedValue(value, ["tokens", "input_tokens"]))
      ?? finiteTokenCount(nestedValue(value, ["billed_units", "input_tokens"]));
  const outputTokens = provider === "gemini"
    ? finiteTokenCount(value.candidatesTokenCount)
    : finiteTokenCount(value.completion_tokens)
      ?? finiteTokenCount(value.output_tokens)
      ?? finiteTokenCount(nestedValue(value, ["tokens", "output_tokens"]))
      ?? finiteTokenCount(nestedValue(value, ["billed_units", "output_tokens"]));
  const directTotal = provider === "gemini"
    ? finiteTokenCount(value.totalTokenCount)
    : finiteTokenCount(value.total_tokens);
  const totalTokens = directTotal ?? (
    inputTokens !== null && outputTokens !== null
      ? inputTokens + outputTokens
      : null
  );
  const cachedTokens = provider === "gemini"
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

function contextBreakdown(
  messages: ConversationMessage[],
  currentUserMessage: string | undefined,
  requestBytes: number,
  toolDefinitionsChars: number,
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
    systemPromptChars: systemInstruction.length,
    requestGuidanceChars: requestGuidance.length,
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
  metrics.requestBytesByProvider[provider] = (metrics.requestBytesByProvider[provider] ?? 0) + payload.requestBytes;
  metrics.maxRequestBytes = Math.max(metrics.maxRequestBytes, payload.requestBytes);
  metrics.systemPromptChars = Math.max(metrics.systemPromptChars, payload.systemPromptChars);
  metrics.toolDefinitionsChars = Math.max(metrics.toolDefinitionsChars, payload.toolDefinitionsChars);
  metrics.toolDefinitionsCount = Math.max(metrics.toolDefinitionsCount, payload.toolDefinitionsCount);
  metrics.maxConversationChars = Math.max(metrics.maxConversationChars, payload.conversationChars);
  return {
    provider,
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
  const normalized = normalizeProviderUsage(attempt.provider, usage);
  const entry: LlmUsageAttempt = {
    requestId: context.requestId,
    conversationId: context.conversationId ?? null,
    provider: attempt.provider,
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
    context?: LlmContextBreakdown;
    fallback?: boolean;
    retry?: boolean;
    cacheHit?: boolean;
    cacheRetry?: boolean;
  },
): LlmAttemptStart {
  return beginLlmAttempt(context, provider, payload.model ?? provider, {
    ...payload,
    toolNames: payload.toolNames ?? [],
    context: payload.context ?? contextBreakdown(
      [],
      context.currentUserMessage,
      payload.requestBytes,
      payload.toolDefinitionsChars,
    ),
  });
}

function compactToolResultForPrompt(toolResult: ToolResult): string {
  const compact = compactActionForMemory({ toolResult: jsonSafe(toolResult) }) as { toolResult?: unknown } | undefined;
  return JSON.stringify(compact?.toolResult ?? toolResult);
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
  ): Promise<string | null> {
    const existingFlight = this.cacheCreationFlights.get(cacheKey);
    if (existingFlight) return existingFlight;

    const creation = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const startedAt = Date.now();
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${encodeURIComponent(this.apiKey ?? "")}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
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
    );
    return { name: name ?? undefined, cacheKey, hit: false };
  }

  async generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse> {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not configured.");
    const systemText = `${systemInstruction}\n${requestGuidance}`;
    const contents = toGeminiContents(messages);
    const toolDefinitions = toGeminiTools(context.toolScope, context.finalResponseOnly);
    let lastError: Error | null = null;
    const models = this.model === GEMINI_FALLBACK_MODEL
      ? [this.model]
      : [this.model, GEMINI_FALLBACK_MODEL];

    for (const [modelIndex, model] of models.entries()) {
      if (modelIndex > 0 && context.metrics) context.metrics.modelFallbackAttempts += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);
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
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
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
          && (lastError.code === "PROVIDER_RATE_LIMIT"
            || lastError.code === "PROVIDER_HTTP_ATTEMPT_BUDGET_EXCEEDED")) break;
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
  private readonly apiKey = process.env.GROQ_API_KEY;
  readonly model = GROQ_MODEL;

  get modelName(): string {
    return this.model;
  }

  async generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse> {
    if (!this.apiKey) throw new Error("GROQ_API_KEY is not configured.");
    const tools = toOpenAiTools(context.toolScope, context.finalResponseOnly);
    const apiMessages = [
      {
        role: "system",
        content: `${systemInstruction}\n${requestGuidance}`,
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
    const systemText = `${systemInstruction}\n${requestGuidance}`;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_GROQ_HTTP_ATTEMPTS; attempt += 1) {
      const attemptMeasurement = recordProviderRequest(context, "groq", {
        model: this.model,
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
        ),
        fallback: Boolean(context.providerFallback),
        retry: attempt > 0,
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);
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

export class MistralModelGateway implements ModelGateway {
  readonly provider = "mistral" as const;
  private readonly apiKey = process.env.MISTRAL_API_KEY;
  readonly model = MISTRAL_MODEL;

  get modelName(): string {
    return this.model;
  }

  async generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse> {
    if (!this.apiKey) throw new Error("MISTRAL_API_KEY is not configured.");
    const tools = toOpenAiTools(context.toolScope, context.finalResponseOnly);
    const apiMessages = [
      {
        role: "system",
        content: `${systemInstruction}\n${requestGuidance}`,
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
    const systemText = `${systemInstruction}\n${requestGuidance}`;
    const attemptMeasurement = recordProviderRequest(context, "mistral", {
      model: this.model,
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
      ),
      fallback: Boolean(context.providerFallback),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
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
      const response = await fetch(MISTRAL_API_URL, {
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
        "mistral",
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
        : providerExceptionError("mistral", error);
      logLlmFailure("mistral", this.model, context, 1, classified);
      throw classified;
    } finally {
      clearTimeout(timeout);
    }
  }
}

type CircuitState = {
  consecutiveFailures: number;
  openUntil: number;
};

type RequestProviderState = {
  fallbackProvider?: ProviderName;
  selectedProvider?: ProviderName;
  providerIndex?: number;
  primaryError?: SecretaryError;
  expiresAt: number;
};

const CIRCUIT_FAILURE_THRESHOLD = 2;
const CIRCUIT_OPEN_MS = 15_000;
const REQUEST_PROVIDER_STATE_TTL_MS = 5 * 60_000;

export class FailoverModelGateway implements ModelGateway {
  private readonly circuits = new Map<ProviderName, CircuitState>();
  private readonly requests = new Map<string, RequestProviderState>();
  private readonly traces = new Map<string, ProviderTrace>();
  private readonly metrics = new Map<string, GatewayRequestMetrics>();

  constructor(
    private readonly gateways: Partial<Record<ProviderName, ModelGateway>>,
    private readonly order: ProviderName[],
  ) {
    if (order.length === 0) throw new Error("At least one LLM provider is required.");
  }

  get provider(): ProviderName {
    return this.order[0];
  }

  get modelName(): string {
    return this.gateways[this.order[0]]?.modelName ?? "unconfigured";
  }

  private circuit(provider: ProviderName): CircuitState {
    const current = this.circuits.get(provider);
    if (current) return current;
    const created = { consecutiveFailures: 0, openUntil: 0 };
    this.circuits.set(provider, created);
    return created;
  }

  private isCircuitOpen(provider: ProviderName): boolean {
    return this.circuit(provider).openUntil > Date.now();
  }

  private circuitRetryAfterSeconds(provider: ProviderName): number | undefined {
    const remainingMs = this.circuit(provider).openUntil - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : undefined;
  }

  private markSuccess(provider: ProviderName): void {
    this.circuits.set(provider, { consecutiveFailures: 0, openUntil: 0 });
  }

  private markTransientFailure(provider: ProviderName, error: SecretaryError): void {
    const current = this.circuit(provider);
    const consecutiveFailures = current.consecutiveFailures + 1;
    const providerCooldownMs = error.category === "provider_rate_limit" && error.retryAfterSeconds !== undefined
      ? Math.min(Math.max(error.retryAfterSeconds * 1000, CIRCUIT_OPEN_MS), MAX_CIRCUIT_COOLDOWN_MS)
      : undefined;
    this.circuits.set(provider, {
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
      primaryProvider: this.order[0],
      ...(this.order[1] ? { fallbackProvider: this.order[1] } : {}),
      providersAttempted: [],
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

  getProviderForRequest(requestId: string): { provider: ProviderName; model: string } {
    const selected = this.requestState(requestId)?.selectedProvider ?? this.order[0];
    const gateway = this.gateways[selected];
    return {
      provider: selected,
      model: gateway?.modelName ?? "unconfigured",
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
        retryCount: metrics.retryCount,
        providerFallbackAttempts: metrics.providerFallbackAttempts,
        modelFallbackAttempts: metrics.modelFallbackAttempts,
        requestBytesByProvider: metrics.requestBytesByProvider,
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
    const startIndex = request?.providerIndex ?? 0;
    const preferredProviders = this.order.slice(startIndex);
    const trace = this.trace(context.requestId);
    const candidates = preferredProviders.filter((provider) => this.gateways[provider]);
    const available = candidates.filter((provider) => !this.isCircuitOpen(provider));
    const providersToTry = available;
    if (providersToTry.length === 0) {
      const cooldownProvider = candidates[0];
      const retryAfterSeconds = cooldownProvider
        ? this.circuitRetryAfterSeconds(cooldownProvider)
        : undefined;
      throw new SecretaryError("All configured LLM providers are in cooldown.", {
        status: 503,
        category: "provider_unavailable",
        code: "PROVIDER_COOLDOWN_ACTIVE",
        retryable: true,
        provider: cooldownProvider,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      });
    }
    let primaryError = request?.primaryError;

    for (const [index, provider] of providersToTry.entries()) {
      const gateway = this.gateways[provider];
      if (!gateway) continue;
      if (provider !== this.order[0] && !trace.fallbackOccurred) {
        trace.fallbackOccurred = true;
        trace.fallbackReason = "circuit_open";
        trace.toolCallsExecutedBeforeFailure = context.toolCallsExecuted;
        if (context.metrics) context.metrics.providerFallbackAttempts += 1;
        logger.warn({
          requestId: context.requestId,
          primaryProvider: this.order[0],
          fallbackProvider: provider,
          fallback: true,
          fallbackReason: trace.fallbackReason,
          toolCallsExecutedBeforeFailure: context.toolCallsExecuted,
        }, "agent provider fallback");
      }
      trace.providersAttempted.push(provider);
      try {
        const response = await gateway.generate(messages, {
          ...context,
          providerFallback: index > 0 || provider !== this.order[0],
        });
        this.markSuccess(provider);
        trace.selectedProvider = provider;
        this.requests.set(context.requestId, {
          ...(trace.fallbackOccurred ? { fallbackProvider: provider } : {}),
          selectedProvider: provider,
          providerIndex: this.order.indexOf(provider),
          expiresAt: Date.now() + REQUEST_PROVIDER_STATE_TTL_MS,
        });
        return response;
      } catch (error) {
        const classified = error instanceof SecretaryError
          ? error
          : providerExceptionError(provider, error);
        if (!isTransientProviderFailure(classified)) throw classified;
        this.markTransientFailure(provider, classified);
        trace.fallbackReason = classified.code;
        trace.toolCallsExecutedBeforeFailure = context.toolCallsExecuted;
        primaryError ??= classified;

        const nextProvider = providersToTry[index + 1];
        if (nextProvider) {
          trace.fallbackOccurred = true;
          if (context.metrics) context.metrics.providerFallbackAttempts += 1;
          this.requests.set(context.requestId, {
            fallbackProvider: nextProvider,
            providerIndex: this.order.indexOf(nextProvider),
            ...(provider === this.order[0] ? { primaryError: classified } : {}),
            expiresAt: Date.now() + REQUEST_PROVIDER_STATE_TTL_MS,
          });
          logger.warn({
            requestId: context.requestId,
            primaryProvider: this.order[0],
            fallbackProvider: nextProvider,
            fallback: true,
            fallbackReason: classified.code,
            primaryError: classified.code,
            toolCallsExecutedBeforeFailure: context.toolCallsExecuted,
          }, "agent provider fallback");
          continue;
        }

        if (primaryError && provider !== this.order[0]) {
          throw providerFailoverError(this.order[0], primaryError, provider, classified);
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

function finalResponseFromArgs(args: Record<string, unknown>, history: ToolHistoryEntry[]): FinalResponse {
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
  return safeFinalResponse(kind, message, history, groundedFacts);
}

function finalResponseFromText(text: string, history: ToolHistoryEntry[]): FinalResponse {
  const message = text.trim() || "لم أستطع إكمال الطلب بشكل آمن. اكتب التفاصيل المطلوبة وسأحاول مرة أخرى.";
  return safeFinalResponse("answer", message, history);
}

function recoveryResponseAfterSuccessfulWrite(history: ToolHistoryEntry[]): FinalResponse | null {
  const successfulWrite = [...history]
    .reverse()
    .find((entry) => WRITE_TOOLS.has(entry.name) && entry.result.ok);
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
        }
      : {};
    const count = typeof summary.count === "number" ? summary.count : 0;
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
    if (!project?.selected) return null;
    const args: Record<string, unknown> = {
      amountMinor: parsed.amount.amountMinor,
      currency: parsed.amount.currency,
      description: "مصروف مسجل من طلب المستخدم",
      ...(person?.selected ? { personId: person.selected.id } : {}),
      projectId: project.selected.id,
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
    const startedAt = Date.now();
    const requestId = input.requestId ?? crypto.randomUUID();
    if (input.idempotencyKey) {
      const stored = await loadIdempotent(identity, input.idempotencyKey);
      if (stored) return stored;
    }

    const conversationId = input.conversationId || crypto.randomUUID();
    const conversationMemory = await loadConversationMemory(identity, conversationId);
    const semanticParse = featureFlags.deterministicIntelligence()
      ? parseSemanticRequest(input.message)
      : null;
    const deterministicMetrics: DeterministicRequestMetrics = createDeterministicRequestMetrics();
    if (semanticParse) {
      deterministicMetrics.normalizationApplied = semanticParse.normalizedText !== input.message.trim();
      deterministicMetrics.semanticParsed = true;
    }
    const relationshipContext = featureFlags.deterministicIntelligence()
      ? await retrieveRelationshipContext(identity, input.message, conversationMemory.state).catch((error) => {
          logger.warn({
            requestId,
            error: error instanceof Error ? error.message : "RELATIONSHIP_CONTEXT_FAILED",
          }, "relationship-aware context retrieval failed");
          return null;
        })
      : null;
    const financialFollowupAdjustment = featureFlags.deterministicIntelligence()
      ? parseFinancialFollowupAdjustment(input.message, conversationMemory.state)
      : null;
    const messages: ConversationMessage[] = [
      ...conversationContextMessages(conversationMemory),
      ...(relationshipContext && !relationshipContext.response
        ? [{
            role: "system" as const,
            text: `[سياق علاقات منظم من البيانات القانونية، محدود بالسؤال]\n${serializeRelationshipContext(relationshipContext.context)}`,
          }]
        : []),
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
      const patternExpenses = toolHistory.flatMap((entry) => {
        const expense = entry.result.expense;
        if (!expense || typeof expense !== "object") return [];
        const item = expense as Record<string, unknown>;
        if (
          typeof item.id !== "string"
          || typeof item.amountMinor !== "number"
          || typeof item.currency !== "string"
          || typeof item.occurredAt !== "string"
        ) return [];
        return [{
          id: item.id,
          amountMinor: item.amountMinor,
          currency: item.currency,
          occurredAt: item.occurredAt,
          personId: typeof item.personId === "string" ? item.personId : null,
          projectId: typeof item.projectId === "string" ? item.projectId : null,
        }];
      });
      const patternInsights = featureFlags.experimentalPatternInsights()
        ? (await import("./experimental-pattern-insights")).buildPatternInsights(
            conversationState.relationships,
            patternExpenses,
          )
        : [];
      const finalAction = {
        ...(compactActionForMemory(action) ?? {
          type: "llm_response",
          conversationState,
        }),
        deterministicIntelligence: deterministicMetrics,
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
        ...deterministicMetrics,
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
      deterministicMetrics.decision = decision.kind === "llm" ? "llm_fallback" : decision.kind;
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
      && isUnanchoredRelativeDateFollowup(input.message, conversationMemory.state)
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

    if (relationshipContext?.response) {
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
                return persistResult(finalResponseFromArgs(finalCall.args, toolHistory));
              }
              if (finalization.text.trim()) {
                  setDiagnosticDecision(diagnosticCall, {
                    kind: "return_text",
                    reason: "Finalization returned text without a tool call.",
                    nextLogicalCallNumber: null,
                    nextCallKind: null,
                    nextScope: activeToolScope.name,
                  });
                return persistResult(finalResponseFromText(finalization.text, toolHistory));
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
          return persistResult(finalResponseFromText(response.text, toolHistory));
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
          return persistResult(finalResponseFromArgs(finalCall.args, toolHistory));
        }

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
              idempotencyKey: input.idempotencyKey,
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
            setDiagnosticDecision(diagnosticCall, {
              kind: "return_approval",
              reason: "The write tool returned a pending approval operation.",
              nextLogicalCallNumber: null,
              nextCallKind: null,
              nextScope: activeToolScope.name,
            });
            action = {
              type: "approval_required",
              operationId: approval.operationId,
              status: approval.status,
              toolName: approval.toolName,
              display: { title, details },
              args: approval.args,
            };
            return persistResult({
              kind: "clarification",
              message: `قبل ما أنفذ ${title}${details.length > 0 ? ` (${details.join(" — ")})` : ""}، هل توافق؟`,
            });
          }
          messages.push({
            role: "tool",
            toolCallId: call.id,
            toolName: call.name,
            text: compactToolResultForPrompt(toolResult),
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
      throw error;
    } finally {
      finishRequestInstrumentation();
    }
  }
}

export class CohereModelGateway implements ModelGateway {
  readonly provider = "cohere" as const;
  private readonly apiKey = process.env.COHERE_API_KEY;
  readonly model = COHERE_MODEL;

  get modelName(): string {
    return this.model;
  }

  async generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse> {
    if (!this.apiKey) throw new Error("COHERE_API_KEY is not configured.");
    const tools = toCohereTools(context.toolScope, context.finalResponseOnly);
    const apiMessages = [
      {
        role: "system",
        content: `${systemInstruction}\n${requestGuidance}`,
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
    const systemText = `${systemInstruction}\n${requestGuidance}`;
    const attemptMeasurement = recordProviderRequest(context, "cohere", {
      model: this.model,
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
      ),
      fallback: Boolean(context.providerFallback),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
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
  return normalized === "gemini"
    || normalized === "groq"
    || normalized === "mistral"
    || normalized === "cohere"
    ? normalized
    : undefined;
}

export function configuredProviderOrder(): ProviderName[] {
  const fallbackPreference = featureFlags.providerRouting()
    ? providerOrder()
    : (["groq", "gemini", "mistral", "cohere"] as ProviderName[]);
  const firstConfiguredByRouting = fallbackPreference.find((provider) => (
    provider === "groq"
      ? Boolean(process.env.GROQ_API_KEY)
      : provider === "gemini"
        ? Boolean(process.env.GEMINI_API_KEY)
        : provider === "mistral"
          ? Boolean(process.env.MISTRAL_API_KEY)
          : Boolean(process.env.COHERE_API_KEY)
  ));
  const originalDefaultProvider = process.env.GEMINI_API_KEY
    ? "gemini"
    : process.env.GROQ_API_KEY
      ? "groq"
      : process.env.MISTRAL_API_KEY
        ? "mistral"
        : process.env.COHERE_API_KEY
          ? "cohere"
          : undefined;
  const primary = asProvider(process.env.AI_PRIMARY_PROVIDER)
    ?? asProvider(process.env.AI_PROVIDER)
    ?? (featureFlags.providerRouting() ? firstConfiguredByRouting : originalDefaultProvider);
  const autoFallbacks = (featureFlags.providerRouting()
    ? fallbackPreference
    : (["groq", "gemini", "mistral", "cohere"] as ProviderName[]))
    .filter((provider) => provider !== primary)
    .filter((provider) => (
      provider === "groq"
        ? Boolean(process.env.GROQ_API_KEY)
        : provider === "gemini"
          ? Boolean(process.env.GEMINI_API_KEY)
          : provider === "mistral"
            ? Boolean(process.env.MISTRAL_API_KEY)
            : Boolean(process.env.COHERE_API_KEY)
    ));
  return [
    primary,
    asProvider(process.env.AI_FALLBACK_PROVIDER),
    asProvider(process.env.AI_SECONDARY_FALLBACK_PROVIDER),
    ...autoFallbacks,
  ].filter(
    (provider, index, providers): provider is ProviderName => Boolean(provider) && providers.indexOf(provider) === index,
  );
}

export function configuredProvider(): ConfiguredProvider {
  const configured = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (configured === "development") return "development";
  return configuredProviderOrder()[0] ?? "unavailable";
}

export function phase2Enabled(): boolean {
  return configuredProviderOrder().length > 0;
}

function createGateway(provider: ProviderName): ModelGateway {
  if (provider === "groq") return new GroqModelGateway();
  if (provider === "mistral") return new MistralModelGateway();
  if (provider === "cohere") return new CohereModelGateway();
  return new GeminiModelGateway();
}

function createConfiguredGateway(): ModelGateway {
  const order = configuredProviderOrder();
  const selectedOrder = order.length > 0 ? order : ["gemini" as const];
  return new FailoverModelGateway(
    Object.fromEntries(selectedOrder.map((provider) => [provider, createGateway(provider)])),
    [...selectedOrder],
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
