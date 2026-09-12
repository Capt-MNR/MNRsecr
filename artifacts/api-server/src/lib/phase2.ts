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
  providerExceptionError,
  providerResponseError,
  SecretaryError,
} from "./error-contract";

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

type GatewayCallContext = {
  requestId: string;
  callNumber: number;
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
  readonly provider: "gemini" | "groq";
  readonly modelName: string;
  generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse>;
}

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
  tool("record_expense", "Record an expense using integer minor units and resolved entity IDs.", {
    amountMinor: { type: "INTEGER", description: "Money in minor units, e.g. 1150000 for 11500.00" },
    currency: { type: "STRING", description: "ISO currency code" },
    description: { type: "STRING" },
    personId: { type: "STRING" },
    projectId: { type: "STRING" },
    occurredAt: { type: "STRING", description: "ISO timestamp if explicitly known" },
  }, ["amountMinor", "description"]),
  tool("update_expense", "Correct an existing saved expense; never create a second expense for a correction.", {
    expenseId: { type: "STRING" },
    amountMinor: { type: "INTEGER" },
    currency: { type: "STRING" },
    description: { type: "STRING" },
    personId: { type: "STRING" },
    projectId: { type: "STRING" },
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
  options: { requestId: string; callId?: string; dryRun?: boolean },
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

  const stringArg = (key: string): string | undefined =>
    typeof args[key] === "string" && args[key].trim() ? String(args[key]).trim() : undefined;
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
        notes: stringArg("notes") ?? null,
      }).returning();
      result = { ok: true, created: true, person: created };
      break;
    }
    case "update_person": {
      if (!personId) return { ok: false, error: "personId is required." };
      const updates: Record<string, string> = {};
      if (stringArg("name")) {
        updates.name = stringArg("name")!;
        updates.nameKey = normalize(updates.name);
      }
      if (stringArg("notes")) updates.notes = stringArg("notes")!;
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
        status: "active",
      }).returning();
      result = { ok: true, created: true, project: created };
      break;
    }
    case "update_project": {
      if (!projectId) return { ok: false, error: "projectId is required." };
      const updates: Record<string, string> = {};
      if (stringArg("name")) {
        updates.name = stringArg("name")!;
        updates.nameKey = normalize(updates.name);
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
      if (personId) updates.personId = personId;
      if (projectId) updates.projectId = projectId;
      const [updated] = await db.update(expensesTable).set(updates).where(and(
        identityWhere(identity, expensesTable),
        eq(expensesTable.id, expenseId),
      )).returning();
      result = updated ? { ok: true, corrected: true, expense: updated } : { ok: false, error: "Expense not found." };
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
        tenantId: identity.tenantId, ownerUserId: identity.userId, title, dueAt,
      }).returning();
      result = { ok: true, task };
      break;
    }
    case "create_commitment": {
      const title = stringArg("title");
      if (!title) return { ok: false, error: "Commitment title is required." };
      const dueAtValue = stringArg("dueAt");
      const dueAt = dueAtValue ? new Date(dueAtValue) : null;
      const [commitment] = await db.insert(commitmentsTable).values({
        tenantId: identity.tenantId, ownerUserId: identity.userId, title,
        personId: personId ?? null, dueAt,
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
18. لا تستخدم final_response قبل إكمال الأدوات اللازمة. إذا كانت البيانات ناقصة أو الأسماء متكررة، اجعل kind = clarification بدل التخمين.`;

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

function toOpenAiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toOpenAiSchema);
  if (!value || typeof value !== "object") {
    return typeof value === "string" && ["OBJECT", "STRING", "INTEGER", "NUMBER", "BOOLEAN", "ARRAY"].includes(value)
      ? value.toLowerCase()
      : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, toOpenAiSchema(child)]),
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

class GeminiModelGateway implements ModelGateway {
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
              tools: [{ functionDeclarations: phase2Tools }],
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
        lastError = providerExceptionError("gemini", error);
        logLlmFailure("gemini", model, context, 1, lastError);
      } finally {
        clearTimeout(timeout);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw lastError ?? new Error("Gemini request failed.");
  }
}

class GroqModelGateway implements ModelGateway {
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
            max_tokens: 4096,
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
        lastError = providerExceptionError("groq", error);
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
      const finalAction = compactActionForMemory(action) ?? {
        type: "llm_response",
        conversationState,
      };
      const result: Phase2TurnResult = {
        conversationId,
        assistantMessage: finalResponse.message,
        response: finalResponse,
        action: finalAction,
        provider: this.gateway.provider,
        model: this.gateway.modelName,
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
        provider: this.gateway.provider,
        model: this.gateway.modelName,
        toolCalls,
        llmCalls,
        latencyMs: Date.now() - startedAt,
        dryRun: options.dryRun ?? false,
      }, "agent final response");
      return result;
    };

    while (toolCalls < MAX_TOOL_CALLS) {
      llmCalls += 1;
      const response = await this.gateway.generate(messages, {
        requestId,
        callNumber: llmCalls,
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
  }
}

export type ConfiguredProvider = "gemini" | "groq" | "development" | "unavailable";

export function configuredProvider(): ConfiguredProvider {
  const configured = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (configured === "gemini" || configured === "groq" || configured === "development") {
    return configured;
  }
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.GROQ_API_KEY) return "groq";
  return "unavailable";
}

export function phase2Enabled(): boolean {
  const provider = configuredProvider();
  return provider === "gemini" || provider === "groq";
}

function createConfiguredGateway(): ModelGateway {
  return configuredProvider() === "groq"
    ? new GroqModelGateway()
    : new GeminiModelGateway();
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