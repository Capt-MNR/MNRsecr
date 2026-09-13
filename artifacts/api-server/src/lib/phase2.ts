import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  commitmentsTable,
  db,
  expensesTable,
  idempotencyRecordsTable,
  peopleTable,
  projectPeopleTable,
  projectsTable,
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
  saveConversationTurn,
  updateConversationState,
  type ConversationState,
  type ConversationMemorySnapshot,
} from "./conversation-memory";
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
import { isBroadExpenseReportRequest } from "./expense-report";

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

export type ProviderName = "gemini" | "groq";

export type GatewayCallContext = {
  requestId: string;
  callNumber: number;
  toolCallsExecuted: number;
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
  };
};

type ToolResult = {
  ok: boolean;
  [key: string]: unknown;
};

const MAX_TOOL_CALLS = 8;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3-flash-preview";
const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-20b";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_TIMEZONE = "Africa/Cairo";
const WRITE_TOOLS = new Set([
  "create_person",
  "update_person",
  "create_project",
  "update_project",
  "link_person_to_project",
  "update_person_project_relationship",
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

function broadExpenseReportResponse(result: ToolResult): FinalResponse {
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
  const message = count === 0
    ? "لا توجد مصروفات محفوظة حتى الآن."
    : `تقرير المصروفات: ${amount} عبر ${count} مصروف${projectCount > 0 ? ` موزعة على ${projectCount} مشروع` : ""}.`;
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
  tool("find_person", "Find accessible people by name. Always call before using a person.", {
    name: { type: "STRING", description: "The known person name" },
  }, ["name"]),
  tool("create_person", "Create a person only when no suitable match exists.", {
    name: { type: "STRING" },
    notes: { type: "STRING" },
  }, ["name"]),
  tool("update_person", "Update only known fields on an accessible person.", {
    personId: { type: "STRING" },
    name: { type: "STRING" },
    notes: { type: "STRING" },
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
  tool("record_expense", "Record an expense using integer minor units. The recipient person and project are optional; use description for the purpose when no project is confirmed.", {
    amountMinor: { type: "INTEGER", description: "Money in minor units, e.g. 1150000 for 11500.00" },
    currency: { type: "STRING", description: "ISO currency code" },
    description: { type: "STRING" },
    personId: { type: ["STRING", "NULL"], description: "Optional recipient person ID after resolving a name" },
    projectId: { type: ["STRING", "NULL"], description: "Optional confirmed project ID" },
    occurredAt: { type: "STRING", description: "ISO timestamp if explicitly known" },
  }, ["amountMinor", "description"]),
  tool("update_expense", "Correct an existing saved expense; never create a second expense for a correction.", {
    expenseId: { type: "STRING" },
    amountMinor: { type: "INTEGER" },
    currency: { type: "STRING" },
    description: { type: "STRING" },
    personId: { type: "STRING" },
    projectId: { type: "STRING" },
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
    idempotencyKey?: string | null;
    approvedOperationId?: string;
  },
): Promise<ToolResult> {
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
      }).returning();
      result = { ok: true, created: true, person: created };
      break;
    }
    case "update_person": {
      if (!personId) return { ok: false, error: "personId is required." };
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      const name = stringArg("name");
      if (name) {
        updates.name = name;
        updates.nameKey = normalize(name);
      }
      if (args.notes === null) updates.notes = null;
      else if (stringArg("notes")) updates.notes = stringArg("notes")!;
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
      const updates: Record<string, unknown> = { updatedAt: new Date() };
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
        set: { relationship: stringArg("relationship") ?? null, updatedAt: new Date() },
      }).returning();
      result = { ok: true, relationship };
      break;
    }
    case "update_person_project_relationship": {
      const relationshipId = stringArg("relationshipId");
      const relationship = stringArg("relationship");
      if (!relationshipId || !relationship) return { ok: false, error: "Relationship ID and value are required." };
      const [updated] = await db.update(projectPeopleTable).set({ relationship, updatedAt: new Date() }).where(and(
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
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !description) {
        return { ok: false, error: "Amount, currency, and description are required; amount must be integer minor units." };
      }
      if (personId) {
        const [person] = await db.select({ id: peopleTable.id }).from(peopleTable).where(and(
          identityWhere(identity, peopleTable), eq(peopleTable.id, personId),
        ));
        if (!person) return { ok: false, error: "Person is not accessible." };
      }
      if (projectId) {
        const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(and(
          identityWhere(identity, projectsTable), eq(projectsTable.id, projectId),
        ));
        if (!project) return { ok: false, error: "Project is not accessible." };
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
        personId: personId ?? null,
        projectId: projectId ?? null,
        occurredAt,
      }).returning();
      result = { ok: true, expense };
      break;
    }
    case "update_expense": {
      const expenseId = stringArg("expenseId");
      const amountMinor = Number(args.amountMinor);
      if (!expenseId || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        return { ok: false, error: "expenseId and a positive integer amountMinor are required." };
      }
      const [existing] = await db.select().from(expensesTable).where(and(
        identityWhere(identity, expensesTable),
        eq(expensesTable.id, expenseId),
      )).limit(1);
      if (!existing) return { ok: false, error: "Expense not found." };
      const updates: Record<string, unknown> = { amountMinor };
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
      const occurredAtValue = stringArg("occurredAt");
      if (occurredAtValue) {
        const occurredAt = new Date(occurredAtValue);
        if (Number.isNaN(occurredAt.getTime())) return { ok: false, error: "occurredAt must be a valid ISO timestamp." };
        updates.occurredAt = occurredAt;
      }
      const [updated] = await db.update(expensesTable).set(updates).where(and(
        identityWhere(identity, expensesTable),
        eq(expensesTable.id, expenseId),
      )).returning();
      result = updated ? { ok: true, corrected: true, expense: updated } : { ok: false, error: "Expense not found." };
      break;
    }
    case "update_task": {
      const taskId = stringArg("taskId");
      if (!taskId) return { ok: false, error: "taskId is required." };
      const updates: Record<string, unknown> = {};
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
      const updates: Record<string, unknown> = {};
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
      const updates: Record<string, unknown> = {};
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
      await db.delete(expensesTable).where(and(
        identityWhere(identity, expensesTable),
        eq(expensesTable.id, expenseId),
      ));
      result = { ok: true, deleted: true, deletedExpense: existing };
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
      await db.delete(peopleTable).where(and(
        identityWhere(identity, peopleTable),
        eq(peopleTable.id, targetId),
      ));
      result = { ok: true, deleted: true, deletedPerson: existing };
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
      await db.delete(projectsTable).where(and(
        identityWhere(identity, projectsTable),
        eq(projectsTable.id, targetId),
      ));
      result = { ok: true, deleted: true, deletedProject: existing };
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
    idempotencyKey?: string | null;
    approvedOperationId?: string;
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
- إذا كانت الرسالة جملة دفع/إعطاء/استلام وبها شخص ومبلغ وعملة، نفّذ find_person ثم record_expense مباشرة. لا تستدع recall_context أولًا. إذا لم يذكر المستخدم وصفًا، استخدم وصفًا صادقًا مثل "دفعة إلى <الاسم>".
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

function toGeminiContents(messages: ConversationMessage[]): Array<{ role: string; parts: GeminiPart[] }> {
  return messages.map((message) => {
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

function toOpenAiTools() {
  return phase2Tools.map((definition) => ({
    type: "function",
    function: {
      name: definition.name,
      description: definition.description,
      parameters: toOpenAiSchema(definition.parameters),
    },
  }));
}

function toGeminiTools() {
  return phase2Tools.map((definition) => ({
    ...definition,
    parameters: toGeminiSchema(definition.parameters),
  }));
}

export class GeminiModelGateway implements ModelGateway {
  readonly provider = "gemini" as const;
  private readonly apiKey = process.env.GEMINI_API_KEY;
  private readonly model = GEMINI_MODEL;
  private activeModel = GEMINI_MODEL;

  get modelName(): string {
    return this.activeModel;
  }

  async generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse> {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not configured.");
    let lastError: Error | null = null;
    const models = this.model === GEMINI_FALLBACK_MODEL
      ? [this.model]
      : [this.model, GEMINI_FALLBACK_MODEL];

    for (const model of models) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);
      const startedAt = Date.now();
      logger.info({
        requestId: context.requestId,
        provider: this.provider,
        model,
        llmCall: context.callNumber,
      }, "agent llm call started");
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: `${systemInstruction}\n${requestGuidance}` }] },
              contents: toGeminiContents(messages),
              tools: [{ functionDeclarations: toGeminiTools() }],
              toolConfig: { functionCallingConfig: { mode: "AUTO" } },
              generationConfig: { temperature: 0.15, maxOutputTokens: 8192 },
            }),
            signal: controller.signal,
          },
        );
        const raw = await response.text();
        if (response.ok) {
          const parsed = JSON.parse(raw) as GeminiResponse;
          const parts = parsed.candidates?.[0]?.content?.parts ?? [];
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
          logger.info({
            requestId: context.requestId,
            provider: this.provider,
            model,
            llmCall: context.callNumber,
            toolCalls: responseResult.toolCalls.length,
            latencyMs: Date.now() - startedAt,
          }, "agent llm call completed");
          return responseResult;
        }
        lastError = providerResponseError("gemini", response.status, raw);
        if (![404, 429, 500, 502, 503, 504].includes(response.status)) throw lastError;
      } catch (error) {
        lastError = error instanceof SecretaryError
          ? error
          : providerExceptionError("gemini", error);
        logLlmFailure("gemini", model, context, 1, lastError);
      } finally {
        clearTimeout(timeout);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
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
    const apiMessages = [
      {
        role: "system",
        content: `${systemInstruction}\n${requestGuidance}`,
      },
      ...messages.map((message) => {
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
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);
      const startedAt = Date.now();
      logger.info({
        requestId: context.requestId,
        provider: this.provider,
        model: this.model,
        llmCall: context.callNumber,
        attempt: attempt + 1,
      }, "agent llm call started");
      try {
        const response = await fetch(GROQ_API_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages: apiMessages,
            tools: toOpenAiTools(),
            tool_choice: "auto",
            reasoning_effort: "low",
            include_reasoning: false,
            temperature: 0.15,
            max_tokens: 2048,
          }),
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
        lastError = providerResponseError("groq", response.status, raw);
        if (response.status !== 429 || attempt === 1) throw lastError;
        const retryAfter = Number(response.headers.get("retry-after") ?? 1);
        logger.warn({
          requestId: context.requestId,
          provider: this.provider,
          model: this.model,
          llmCall: context.callNumber,
          attempt: attempt + 1,
          retryAfterSeconds: retryAfter,
          safeToRetry: true,
        }, "agent llm rate limit retry");
        await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(retryAfter * 1000, 500), 3_000)));
      } catch (error) {
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

type CircuitState = {
  consecutiveFailures: number;
  openUntil: number;
};

type RequestProviderState = {
  fallbackProvider?: ProviderName;
  selectedProvider?: ProviderName;
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

  private markSuccess(provider: ProviderName): void {
    this.circuits.set(provider, { consecutiveFailures: 0, openUntil: 0 });
  }

  private markTransientFailure(provider: ProviderName): void {
    const current = this.circuit(provider);
    const consecutiveFailures = current.consecutiveFailures + 1;
    this.circuits.set(provider, {
      consecutiveFailures,
      openUntil: consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD
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
    return this.trace(requestId);
  }

  finishRequest(requestId: string): void {
    this.requests.delete(requestId);
    this.traces.delete(requestId);
  }

  async generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse> {
    const request = this.requestState(context.requestId);
    const lockedProvider = request?.fallbackProvider;
    const preferredProviders = lockedProvider
      ? [lockedProvider]
      : this.order;
    const trace = this.trace(context.requestId);
    const candidates = preferredProviders.filter((provider) => this.gateways[provider]);
    const available = candidates.filter((provider) => !this.isCircuitOpen(provider));
    const providersToTry = available.length > 0 ? available : candidates.slice(0, 1);
    let primaryError = request?.primaryError;

    for (const [index, provider] of providersToTry.entries()) {
      const gateway = this.gateways[provider];
      if (!gateway) continue;
      if (provider !== this.order[0] && !trace.fallbackOccurred) {
        trace.fallbackOccurred = true;
        trace.fallbackReason = "circuit_open";
        trace.toolCallsExecutedBeforeFailure = context.toolCallsExecuted;
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
        const response = await gateway.generate(messages, context);
        this.markSuccess(provider);
        trace.selectedProvider = provider;
        this.requests.set(context.requestId, {
          ...(trace.fallbackOccurred ? { fallbackProvider: provider } : {}),
          selectedProvider: provider,
          expiresAt: Date.now() + REQUEST_PROVIDER_STATE_TTL_MS,
        });
        return response;
      } catch (error) {
        const classified = error instanceof SecretaryError
          ? error
          : providerExceptionError(provider, error);
        if (!isTransientProviderFailure(classified)) throw classified;
        this.markTransientFailure(provider);
        trace.fallbackReason = classified.code;
        trace.toolCallsExecutedBeforeFailure = context.toolCallsExecuted;
        primaryError ??= classified;

        const nextProvider = providersToTry[index + 1];
        if (nextProvider) {
          trace.fallbackOccurred = true;
          this.requests.set(context.requestId, {
            fallbackProvider: nextProvider,
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

function safeFinalResponse(
  kind: FinalResponseKind,
  message: string,
  history: ToolHistoryEntry[],
  groundedFacts?: GroundedFact[],
): FinalResponse {
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
    const messages: ConversationMessage[] = [
      ...conversationContextMessages(conversationMemory),
      { role: "user", text: input.message.trim() },
    ];
    let toolCalls = 0;
    let llmCalls = 0;
    let action: Record<string, unknown> | undefined;
    const toolHistory: ToolHistoryEntry[] = [];
    let conversationState: ConversationState = conversationMemory.state;

    const persistResult = async (finalResponse: FinalResponse): Promise<Phase2TurnResult> => {
      const providerSelection = this.gateway.getProviderForRequest?.(requestId) ?? {
        provider: this.gateway.provider,
        model: this.gateway.modelName,
      };
      const providerTrace = this.gateway.getTrace?.(requestId);
      const finalAction = {
        ...(compactActionForMemory(action) ?? {
          type: "llm_response",
          conversationState,
        }),
        llmCalls,
        toolCalls,
        ...(providerTrace ? { providerTrace } : {}),
      };
      const result: Phase2TurnResult = {
        conversationId,
        assistantMessage: finalResponse.message,
        response: finalResponse,
        action: finalAction,
        provider: providerSelection.provider,
        model: providerSelection.model,
      };
      if (!options.dryRun) {
        await saveConversationTurn(identity, conversationMemory, {
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
      return result;
    };

    if (isBroadExpenseReportRequest(input.message)) {
      const report = await executeStructuredTool(identity, "query_expenses", { limit: 50 }, {
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
      return persistResult(broadExpenseReportResponse(report));
    }

    try {
      while (toolCalls < MAX_TOOL_CALLS) {
        llmCalls += 1;
        const response = await this.gateway.generate(messages, {
          requestId,
          callNumber: llmCalls,
          toolCallsExecuted: toolCalls,
        });
        if (response.toolCalls.length === 0) {
          return persistResult(finalResponseFromText(response.text, toolHistory));
        }

        messages.push({
          role: "assistant",
          text: response.text || undefined,
          toolCalls: response.toolCalls,
        });

        const finalCall = response.toolCalls.find((call) => call.name === "final_response");
        if (finalCall && response.toolCalls.length === 1) {
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
            throw agentToolError(call.name, error);
          }
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
            action = {
              type: "approval_required",
              operationId: approval.operationId,
              status: approval.status,
              toolName: approval.toolName,
              display: { title, details },
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
            text: JSON.stringify(toolResult),
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
      this.gateway.finishRequest?.(requestId);
    }
  }
}

export type ConfiguredProvider = ProviderName | "development" | "unavailable";

function asProvider(value: string | undefined): ProviderName | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized === "gemini" || normalized === "groq" ? normalized : undefined;
}

export function configuredProviderOrder(): ProviderName[] {
  const primary = asProvider(process.env.AI_PRIMARY_PROVIDER)
    ?? asProvider(process.env.AI_PROVIDER)
    ?? (process.env.GEMINI_API_KEY ? "gemini" : process.env.GROQ_API_KEY ? "groq" : undefined);
  const fallback = asProvider(process.env.AI_FALLBACK_PROVIDER)
    ?? (primary === "gemini" && process.env.GROQ_API_KEY ? "groq" : undefined)
    ?? (primary === "groq" && process.env.GEMINI_API_KEY ? "gemini" : undefined);
  return [primary, fallback].filter(
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
  return provider === "groq" ? new GroqModelGateway() : new GeminiModelGateway();
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