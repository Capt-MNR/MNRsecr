import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
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

export type Phase2TurnInput = {
  message: string;
  conversationId?: string | null;
  idempotencyKey?: string | null;
};

export type Phase2TurnResult = {
  conversationId: string;
  assistantMessage: string;
  action?: Record<string, unknown>;
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
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
};

type ConversationMessage = {
  role: "user" | "assistant" | "tool";
  text?: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  toolCallId?: string;
  toolName?: string;
};

type GatewayToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

type GatewayResponse = {
  text: string;
  toolCalls: GatewayToolCall[];
  usage?: unknown;
};

interface ModelGateway {
  readonly provider: "gemini" | "groq";
  readonly modelName: string;
  generate(messages: ConversationMessage[]): Promise<GatewayResponse>;
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
  }, ["amountMinor", "currency", "description"]),
  tool("query_expenses", "Query saved expenses for a person or project.", {
    personId: { type: "STRING" },
    projectId: { type: "STRING" },
    description: { type: "STRING", description: "Optional description/category text to search" },
    limit: { type: "INTEGER" },
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

async function executeTool(
  identity: Identity,
  name: string,
  rawArgs: Record<string, unknown>,
): Promise<ToolResult> {
  const args = rawArgs ?? {};
  logger.info({ tool: name, arguments: jsonSafe(args) }, "agent tool selected");

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
        matches: matches.map((person) => ({ id: person.id, name: person.name, notes: person.notes })),
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
        matches: matches.map((project) => ({ id: project.id, name: project.name, status: project.status })),
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
      const currency = stringArg("currency");
      const description = stringArg("description");
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !currency || !description) {
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
    case "query_expenses": {
      const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 50);
      const description = stringArg("description");
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
          description ? ilike(expensesTable.description, `%${description}%`) : undefined,
        ))
        .orderBy(desc(expensesTable.occurredAt))
        .limit(limit);
      result = { ok: true, expenses: rows };
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
      result = { ok: true, context: { reminders, expenses, projects, people, tasks, asOf: new Date().toISOString() } };
      break;
    }
    default:
      result = { ok: false, error: `Tool ${name} is not available.` };
  }

  logger.info({ tool: name, ok: result.ok }, "agent tool completed");
  return jsonSafe(result) as ToolResult;
}

const systemInstruction = `أنت سكرتير شخصي عربي يعمل داخل نظام بيانات منظم.
افهم اللغة الطبيعية ولا تعتمد على جملة ثابتة. استخدم الأدوات المعتمدة فقط.
قواعد إلزامية:
1. لا تصل مباشرة إلى قاعدة البيانات ولا تخترع هوية المستخدم أو المستأجر.
2. قبل استخدام شخص أو مشروع، استدع find_person أو find_project. إذا وجدت أكثر من نتيجة لا تختار عشوائيًا؛ اطلب توضيحًا. إذا لم تجد نتيجة وأنشأ المستخدم كيانًا جديدًا بوضوح، استدع أداة الإنشاء.
3. لا تسجل مصروفًا قبل حل الشخص والمشروع عندما يذكرهما المستخدم. استخدم amountMinor كعدد صحيح بوحدات العملة الصغرى، ولا تستخدم أرقامًا عائمة.
4. إذا لم يذكر المستخدم العملة ولم توجد عملة افتراضية موثوقة، اسأل عن العملة.
5. نفّذ الخطوات الآمنة المطلوبة في رسالة واحدة، ولا تقل إن شيئًا تم إلا إذا أعادت الأداة نجاحًا.
6. لا تعرض أسماء الأدوات أو تفاصيل النظام للمستخدم. رد بالعربية الطبيعية عندما تكون الرسالة بالعربية.
7. لا تنشئ ذاكرة دائمة من المحادثة. استخدم recall_context للبيانات القانونية المحفوظة.
8. عند إنشاء شخص أو مشروع، لا تضف هاتفًا أو بريدًا أو صفة أو علاقة لم يذكرها المستخدم.`;

const requestGuidance = `إرشادات تنفيذ إضافية:
- إذا كانت الرسالة جملة دفع/إعطاء/استلام وبها شخص ومبلغ وعملة، نفّذ find_person ثم record_expense مباشرة. لا تستدع recall_context أولًا. إذا لم يذكر المستخدم وصفًا، استخدم وصفًا صادقًا مثل "دفعة إلى <الاسم>".
- إذا كانت الرسالة تسأل عن إجمالي ما صُرف على وصف أو فئة مثل "التشطيبات" من دون ذكر مشروع صريح، استخدم query_expenses مع description ثم احسب الناتج من الصفوف. لا تخترع مشروعًا اسمه الفئة.
- إذا كانت الرسالة تسأل "محمد أخد مني كام؟"، نفّذ find_person ثم get_person_expense_total.`;

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
    if (message.role === "assistant") {
      return {
        role: "model",
        parts: [
          ...(message.text ? [{ text: message.text }] : []),
          ...(message.toolCalls ?? []).map((call) => ({
            functionCall: { name: call.name, args: call.args },
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

  async generate(messages: ConversationMessage[]): Promise<GatewayResponse> {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not configured.");
    let lastError: Error | null = null;
    const models = this.model === GEMINI_FALLBACK_MODEL
      ? [this.model]
      : [this.model, GEMINI_FALLBACK_MODEL];

    for (const model of models) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);
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
          return {
            text: parts.map((part) => part.text ?? "").join("").trim(),
            toolCalls: parts.flatMap((part, index) => part.functionCall
              ? [{
                  id: `gemini-call-${index}`,
                  name: part.functionCall.name,
                  args: part.functionCall.args ?? {},
                }]
              : []),
            usage: parsed.usageMetadata,
          };
        }
        lastError = new Error(`Gemini request failed with ${response.status}: ${raw.slice(0, 500)}`);
        if (![404, 429, 500, 502, 503, 504].includes(response.status)) throw lastError;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
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

  async generate(messages: ConversationMessage[]): Promise<GatewayResponse> {
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
          return {
            text: message?.content?.trim() ?? "",
            toolCalls: (message?.tool_calls ?? []).map((call) => ({
              id: call.id,
              name: call.function.name,
              args: parseJsonObject(call.function.arguments),
            })),
            usage: payload.usage,
          };
        }
        lastError = new Error(`Groq request failed with ${response.status}: ${raw.slice(0, 500)}`);
        if (response.status !== 429 || attempt === 1) throw lastError;
        const retryAfter = Number(response.headers.get("retry-after") ?? 1);
        await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(retryAfter * 1000, 500), 3_000)));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === 1 || !lastError.message.includes("429")) throw lastError;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError ?? new Error("Groq request failed.");
  }
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

  async run(identity: Identity, input: Phase2TurnInput): Promise<Phase2TurnResult> {
    const startedAt = Date.now();
    if (input.idempotencyKey) {
      const stored = await loadIdempotent(identity, input.idempotencyKey);
      if (stored) return stored;
    }

    const conversationId = input.conversationId || crypto.randomUUID();
    const messages: ConversationMessage[] = [{ role: "user", text: input.message.trim() }];
    let calls = 0;
    let action: Record<string, unknown> | undefined;

    while (calls < MAX_TOOL_CALLS) {
      const response = await this.gateway.generate(messages);
      if (response.toolCalls.length === 0) {
        const result: Phase2TurnResult = {
          conversationId,
          assistantMessage: response.text || "لم أستطع إكمال الطلب بشكل آمن. اكتب التفاصيل المطلوبة وسأحاول مرة أخرى.",
          action: action ?? { type: "llm_response" },
          provider: this.gateway.provider,
          model: this.gateway.modelName,
        };
        if (input.idempotencyKey) await saveIdempotent(identity, input.idempotencyKey, result);
        logger.info({
          provider: this.gateway.provider,
          model: this.gateway.modelName,
          toolCalls: calls,
          latencyMs: Date.now() - startedAt,
          usage: response.usage,
        }, "agent turn completed");
        return result;
      }

      messages.push({
        role: "assistant",
        text: response.text || undefined,
        toolCalls: response.toolCalls,
      });
      for (const call of response.toolCalls) {
        calls += 1;
        if (calls > MAX_TOOL_CALLS) break;
        const toolResult = await executeTool(identity, call.name, call.args);
        action = {
          type: "tool_orchestration",
          lastTool: call.name,
          toolCalls: calls,
        };
        messages.push({
          role: "tool",
          toolCallId: call.id,
          toolName: call.name,
          text: JSON.stringify(toolResult),
        });
      }
    }

    throw new Error(`Agent stopped after ${MAX_TOOL_CALLS} tool calls.`);
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
    throw new Error(
      "No configured LLM provider is available. Set AI_PROVIDER to gemini or groq and configure its server-side API key.",
    );
  }
}

export const phase2AgentRuntime = new Phase2AgentRuntime(createConfiguredGateway());
export const unavailableAgentRuntime = new UnavailableAgentRuntime();