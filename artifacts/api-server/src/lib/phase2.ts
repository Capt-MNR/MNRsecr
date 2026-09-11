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
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

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

class GeminiModelGateway {
  private readonly apiKey = process.env.GEMINI_API_KEY;
  private readonly model = MODEL;

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  async generate(contents: Array<{ role: string; parts: GeminiPart[] }>): Promise<GeminiResponse> {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not configured.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents,
            tools: [{ functionDeclarations: phase2Tools }],
            toolConfig: { functionCallingConfig: { mode: "AUTO" } },
            generationConfig: { temperature: 0.15, maxOutputTokens: 8192 },
          }),
          signal: controller.signal,
        },
      );
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`Gemini request failed with ${response.status}: ${raw.slice(0, 500)}`);
      }
      return JSON.parse(raw) as GeminiResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  get modelName(): string {
    return this.model;
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
  private readonly gateway = new GeminiModelGateway();

  async run(identity: Identity, input: Phase2TurnInput): Promise<Phase2TurnResult> {
    const startedAt = Date.now();
    if (input.idempotencyKey) {
      const stored = await loadIdempotent(identity, input.idempotencyKey);
      if (stored) return stored;
    }

    const conversationId = input.conversationId || crypto.randomUUID();
    const contents: Array<{ role: string; parts: GeminiPart[] }> = [{
      role: "user",
      parts: [{ text: input.message.trim() }],
    }];
    let calls = 0;
    let action: Record<string, unknown> | undefined;

    while (calls < MAX_TOOL_CALLS) {
      const response = await this.gateway.generate(contents);
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const callsInResponse = parts.filter((part) => part.functionCall);
      const text = parts.map((part) => part.text ?? "").join("").trim();
      if (callsInResponse.length === 0) {
        const result: Phase2TurnResult = {
          conversationId,
          assistantMessage: text || "لم أستطع إكمال الطلب بشكل آمن. اكتب التفاصيل المطلوبة وسأحاول مرة أخرى.",
          action: action ?? { type: "llm_response" },
          provider: "gemini",
          model: this.gateway.modelName,
        };
        if (input.idempotencyKey) await saveIdempotent(identity, input.idempotencyKey, result);
        logger.info({
          provider: "gemini",
          model: this.gateway.modelName,
          toolCalls: calls,
          latencyMs: Date.now() - startedAt,
          usage: response.usageMetadata,
        }, "agent turn completed");
        return result;
      }

      contents.push({
        role: "model",
        parts,
      });
      const functionResponses: GeminiPart[] = [];
      for (const part of callsInResponse) {
        const call = part.functionCall!;
        calls += 1;
        if (calls > MAX_TOOL_CALLS) break;
        const toolResult = await executeTool(identity, call.name, call.args ?? {});
        action = {
          type: "tool_orchestration",
          lastTool: call.name,
          toolCalls: calls,
        };
        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: toolResult,
          },
        });
      }
      contents.push({ role: "user", parts: functionResponses });
    }

    throw new Error(`Agent stopped after ${MAX_TOOL_CALLS} tool calls.`);
  }
}

export function phase2Enabled(): boolean {
  const provider = (process.env.AI_PROVIDER ?? (process.env.GEMINI_API_KEY ? "gemini" : "development")).toLowerCase();
  return provider === "gemini";
}

export const phase2AgentRuntime = new Phase2AgentRuntime();