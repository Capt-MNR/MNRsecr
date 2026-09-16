import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  sql,
} from "drizzle-orm";
import {
  db,
  expensesTable,
  idempotencyRecordsTable,
  peopleTable,
  projectPeopleTable,
  projectsTable,
  remindersTable,
  tasksTable,
  type Expense,
  type Person,
  type Project,
  type Reminder,
  type Task,
} from "@workspace/db";
import {
  configuredProvider,
  executeStructuredTool,
  phase2AgentRuntime,
  phase2Enabled,
  unavailableAgentRuntime,
} from "./phase2";
import {
  createPendingOperation,
  displayForOperation,
  type OperationExecutionResult,
  type PendingOperation,
} from "./secretary-operations";
import { annotateApprovalAction, approvalMessage } from "./secretary-confirmation";
import {
  loadConversationMemory,
  saveConversationTurn,
  type ConversationMemorySnapshot,
} from "./conversation-memory";
import { isBroadExpenseReportRequest } from "./expense-report";
import type { SecretaryChatContext, SecretaryChatPeer, TurnInputChannel } from "@workspace/api-zod";

export type Identity = {
  tenantId: string;
  userId: string;
};

type TodayContext = {
  upcomingReminders: Array<{
    id: string;
    text: string;
    dueAt: string;
    timezone: string;
    status: string;
  }>;
  recentExpenses: Array<{
    id: string;
    amountMinor: number;
    currency: string;
    description: string;
    personName: string | null;
    projectName: string | null;
    occurredAt: string;
  }>;
  activeProjects: Array<{ id: string; name: string }>;
  relevantPeople: Array<{ id: string; name: string }>;
  pendingTasks: Array<{
    id: string;
    title: string;
    dueAt: string | null;
    status: string;
  }>;
  asOf: string;
};

type TurnResult = {
  conversationId: string;
  turnId?: string;
  assistantMessage: string;
  action?: Record<string, unknown>;
  provider: string;
  model: string;
};

type PersistedExpense = Expense & {
  personName: string | null;
  projectName: string | null;
};

export interface PersistencePort {
  getTodayContext(identity: Identity): Promise<TodayContext>;
  getExpenseReport(identity: Identity): Promise<{
    count: number;
    totalMinor: number;
    currency: string;
    projectCount: number;
  }>;
  createExpense(
    identity: Identity,
    input: {
      amountMinor: number;
      currency: string;
      description: string;
      personName?: string;
      projectName?: string;
      projectId?: string;
    },
  ): Promise<PersistedExpense>;
  findPeople(identity: Identity, name: string): Promise<Person[]>;
  findProjects(identity: Identity, name: string): Promise<Project[]>;
  listPeople(identity: Identity): Promise<Person[]>;
  listProjects(identity: Identity): Promise<Project[]>;
  createProject(identity: Identity, name: string): Promise<Project>;
  createPerson(identity: Identity, name: string): Promise<Person>;
  linkPersonToProject(
    identity: Identity,
    input: { personId: string; projectId: string; relationship: string },
  ): Promise<void>;
  updateExpense(
    identity: Identity,
    input: {
      expenseId: string;
      amountMinor?: number;
      currency?: string;
      description?: string;
      occurredAt?: Date;
      personId?: string | null;
      projectId?: string | null;
    },
  ): Promise<PersistedExpense | null>;
  createReminder(
    identity: Identity,
    input: { text: string; dueAt: Date; timezone: string },
  ): Promise<Reminder>;
  totalPaidToPerson(
    identity: Identity,
    personName: string,
  ): Promise<{ totalMinor: number; currency: string; count: number }>;
  peopleForProject(identity: Identity, projectName: string): Promise<Person[]>;
  getIdempotentResponse(
    identity: Identity,
    key: string,
  ): Promise<TurnResult | null>;
  saveIdempotentResponse(
    identity: Identity,
    key: string,
    response: TurnResult,
  ): Promise<void>;
}

function normalizeArabic(value: string): string {
  return value
    .trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u064B-\u065F]/g, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ar");
}

function ownerWhere(identity: Identity) {
  return and(
    eq(peopleTable.tenantId, identity.tenantId),
    eq(peopleTable.ownerUserId, identity.userId),
  );
}

class DrizzlePersistence implements PersistencePort {
  private async findOrCreatePerson(
    identity: Identity,
    name: string,
  ): Promise<Person> {
    const nameKey = normalizeArabic(name);
    const [existing] = await db
      .select()
      .from(peopleTable)
      .where(
        and(
          ownerWhere(identity),
          eq(peopleTable.nameKey, nameKey),
        ),
      )
      .limit(1);

    if (existing) return existing;

    const [created] = await db
      .insert(peopleTable)
      .values({
        tenantId: identity.tenantId,
        ownerUserId: identity.userId,
        name: name.trim(),
        nameKey,
      })
      .returning();
    return created;
  }

  private async findOrCreateProject(
    identity: Identity,
    name: string,
  ): Promise<Project> {
    const nameKey = normalizeArabic(name);
    const [existing] = await db
      .select()
      .from(projectsTable)
      .where(
        and(
          eq(projectsTable.tenantId, identity.tenantId),
          eq(projectsTable.ownerUserId, identity.userId),
          eq(projectsTable.nameKey, nameKey),
        ),
      )
      .limit(1);

    if (existing) return existing;

    const [created] = await db
      .insert(projectsTable)
      .values({
        tenantId: identity.tenantId,
        ownerUserId: identity.userId,
        name: name.trim(),
        nameKey,
      })
      .returning();
    return created;
  }

  async createExpense(
    identity: Identity,
    input: {
      amountMinor: number;
      currency: string;
      description: string;
      personName?: string;
      projectName?: string;
      projectId?: string;
    },
  ): Promise<PersistedExpense> {
    const person = input.personName
      ? await this.findOrCreatePerson(identity, input.personName)
      : null;
    const [selectedProject] = input.projectId
      ? await db.select().from(projectsTable).where(and(
        eq(projectsTable.id, input.projectId),
        eq(projectsTable.tenantId, identity.tenantId),
        eq(projectsTable.ownerUserId, identity.userId),
      )).limit(1)
      : [];
    const project = selectedProject ?? (
      input.projectName
        ? await this.findOrCreateProject(identity, input.projectName)
        : null
    );

    const [expense] = await db
      .insert(expensesTable)
      .values({
        tenantId: identity.tenantId,
        ownerUserId: identity.userId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        description: input.description,
        personId: person?.id,
        projectId: project?.id,
      })
      .returning();

    return {
      ...expense,
      personName: person?.name ?? null,
      projectName: project?.name ?? null,
    };
  }

  async findPeople(identity: Identity, name: string): Promise<Person[]> {
    return db.select().from(peopleTable).where(and(
      ownerWhere(identity),
      eq(peopleTable.nameKey, normalizeArabic(name)),
    )).orderBy(asc(peopleTable.createdAt));
  }

  async findProjects(identity: Identity, name: string): Promise<Project[]> {
    return db.select().from(projectsTable).where(and(
      eq(projectsTable.tenantId, identity.tenantId),
      eq(projectsTable.ownerUserId, identity.userId),
      eq(projectsTable.nameKey, normalizeArabic(name)),
    )).orderBy(asc(projectsTable.createdAt));
  }

  async listPeople(identity: Identity): Promise<Person[]> {
    return db.select().from(peopleTable).where(ownerWhere(identity))
      .orderBy(asc(peopleTable.name));
  }

  async listProjects(identity: Identity): Promise<Project[]> {
    return db.select().from(projectsTable).where(and(
      eq(projectsTable.tenantId, identity.tenantId),
      eq(projectsTable.ownerUserId, identity.userId),
    )).orderBy(asc(projectsTable.name));
  }

  async createProject(identity: Identity, name: string): Promise<Project> {
    return this.findOrCreateProject(identity, name);
  }

  async createPerson(identity: Identity, name: string): Promise<Person> {
    return this.findOrCreatePerson(identity, name);
  }

  async linkPersonToProject(
    identity: Identity,
    input: { personId: string; projectId: string; relationship: string },
  ): Promise<void> {
    await db.insert(projectPeopleTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      personId: input.personId,
      projectId: input.projectId,
      relationship: input.relationship,
    }).onConflictDoUpdate({
      target: [
        projectPeopleTable.tenantId,
        projectPeopleTable.ownerUserId,
        projectPeopleTable.projectId,
        projectPeopleTable.personId,
      ],
      set: { relationship: input.relationship, updatedAt: new Date() },
    });
  }

  async updateExpense(
    identity: Identity,
    input: {
      expenseId: string;
      amountMinor?: number;
      currency?: string;
      description?: string;
      occurredAt?: Date;
      personId?: string | null;
      projectId?: string | null;
    },
  ): Promise<PersistedExpense | null> {
    const updates = {
      ...(input.amountMinor === undefined ? {} : { amountMinor: input.amountMinor }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
      ...(input.personId === undefined ? {} : { personId: input.personId }),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    };
    if (Object.keys(updates).length === 0) return null;
    if (input.personId !== undefined && input.personId !== null) {
      const [person] = await db.select({ id: peopleTable.id }).from(peopleTable).where(and(
        eq(peopleTable.id, input.personId),
        eq(peopleTable.tenantId, identity.tenantId),
        eq(peopleTable.ownerUserId, identity.userId),
      )).limit(1);
      if (!person) return null;
    }
    if (input.projectId !== undefined && input.projectId !== null) {
      const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(and(
        eq(projectsTable.id, input.projectId),
        eq(projectsTable.tenantId, identity.tenantId),
        eq(projectsTable.ownerUserId, identity.userId),
      )).limit(1);
      if (!project) return null;
    }
    const [updated] = await db.update(expensesTable).set(updates).where(and(
      eq(expensesTable.id, input.expenseId),
      eq(expensesTable.tenantId, identity.tenantId),
      eq(expensesTable.ownerUserId, identity.userId),
    )).returning();
    if (!updated) return null;
    const [names] = await db.select({
      personName: peopleTable.name,
      projectName: projectsTable.name,
    }).from(expensesTable)
      .leftJoin(peopleTable, eq(expensesTable.personId, peopleTable.id))
      .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
      .where(eq(expensesTable.id, updated.id))
      .limit(1);
    return {
      ...updated,
      personName: names?.personName ?? null,
      projectName: names?.projectName ?? null,
    };
  }

  async createReminder(
    identity: Identity,
    input: { text: string; dueAt: Date; timezone: string },
  ): Promise<Reminder> {
    const [reminder] = await db
      .insert(remindersTable)
      .values({
        tenantId: identity.tenantId,
        ownerUserId: identity.userId,
        text: input.text,
        dueAt: input.dueAt,
        timezone: input.timezone,
      })
      .returning();
    return reminder;
  }

  async totalPaidToPerson(
    identity: Identity,
    personName: string,
  ): Promise<{ totalMinor: number; currency: string; count: number }> {
    const [person] = await db
      .select()
      .from(peopleTable)
      .where(
        and(
          ownerWhere(identity),
          eq(peopleTable.nameKey, normalizeArabic(personName)),
        ),
      )
      .limit(1);

    if (!person) return { totalMinor: 0, currency: "EGP", count: 0 };

    const [result] = await db
      .select({
        totalMinor: sql<number>`coalesce(sum(${expensesTable.amountMinor}), 0)::bigint`,
        count: sql<number>`count(*)::int`,
        currency: sql<string>`coalesce(min(${expensesTable.currency}), 'EGP')`,
      })
      .from(expensesTable)
      .where(
        and(
          eq(expensesTable.tenantId, identity.tenantId),
          eq(expensesTable.ownerUserId, identity.userId),
          eq(expensesTable.personId, person.id),
        ),
      );

    return {
      totalMinor: Number(result?.totalMinor ?? 0),
      count: Number(result?.count ?? 0),
      currency: result?.currency ?? "EGP",
    };
  }

  async peopleForProject(
    identity: Identity,
    projectName: string,
  ): Promise<Person[]> {
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(
        and(
          eq(projectsTable.tenantId, identity.tenantId),
          eq(projectsTable.ownerUserId, identity.userId),
          eq(projectsTable.nameKey, normalizeArabic(projectName)),
        ),
      )
      .limit(1);

    if (!project) return [];

    const rows = await db
      .selectDistinct({ person: peopleTable })
      .from(expensesTable)
      .innerJoin(peopleTable, eq(expensesTable.personId, peopleTable.id))
      .where(
        and(
          eq(expensesTable.tenantId, identity.tenantId),
          eq(expensesTable.ownerUserId, identity.userId),
          eq(expensesTable.projectId, project.id),
        ),
      )
      .orderBy(asc(peopleTable.name));
    return rows.map((row) => row.person);
  }

  async getTodayContext(identity: Identity): Promise<TodayContext> {
    const now = new Date();
    const [reminders, expenseRows, projects, people, tasks] = await Promise.all([
      db
        .select()
        .from(remindersTable)
        .where(
          and(
            eq(remindersTable.tenantId, identity.tenantId),
            eq(remindersTable.ownerUserId, identity.userId),
            eq(remindersTable.status, "scheduled"),
            gte(remindersTable.dueAt, now),
          ),
        )
        .orderBy(asc(remindersTable.dueAt))
        .limit(8),
      db
        .select({
          expense: expensesTable,
          personName: peopleTable.name,
          projectName: projectsTable.name,
        })
        .from(expensesTable)
        .leftJoin(peopleTable, eq(expensesTable.personId, peopleTable.id))
        .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
        .where(
          and(
            eq(expensesTable.tenantId, identity.tenantId),
            eq(expensesTable.ownerUserId, identity.userId),
          ),
        )
        .orderBy(desc(expensesTable.occurredAt))
        .limit(8),
      db
        .select()
        .from(projectsTable)
        .where(
          and(
            eq(projectsTable.tenantId, identity.tenantId),
            eq(projectsTable.ownerUserId, identity.userId),
            eq(projectsTable.status, "active"),
          ),
        )
        .orderBy(desc(projectsTable.updatedAt))
        .limit(8),
      db
        .select()
        .from(peopleTable)
        .where(ownerWhere(identity))
        .orderBy(desc(peopleTable.updatedAt))
        .limit(8),
      db
        .select()
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.tenantId, identity.tenantId),
            eq(tasksTable.ownerUserId, identity.userId),
            inArray(tasksTable.status, ["pending", "in_progress"]),
          ),
        )
        .orderBy(asc(tasksTable.dueAt))
        .limit(8),
    ]);

    return {
      upcomingReminders: reminders.map((reminder: Reminder) => ({
        id: reminder.id,
        text: reminder.text,
        dueAt: reminder.dueAt.toISOString(),
        timezone: reminder.timezone,
        status: reminder.status,
      })),
      recentExpenses: expenseRows.map(({ expense, personName, projectName }) => ({
        id: expense.id,
        amountMinor: expense.amountMinor,
        currency: expense.currency,
        description: expense.description,
        personName,
        projectName,
        occurredAt: expense.occurredAt.toISOString(),
      })),
      activeProjects: projects.map((project: Project) => ({
        id: project.id,
        name: project.name,
      })),
      relevantPeople: people.map((person: Person) => ({
        id: person.id,
        name: person.name,
      })),
      pendingTasks: tasks.map((task: Task) => ({
        id: task.id,
        title: task.title,
        dueAt: task.dueAt?.toISOString() ?? null,
        status: task.status,
      })),
      asOf: now.toISOString(),
    };
  }

  async getExpenseReport(identity: Identity) {
    const rows = await db
      .select({
        amountMinor: expensesTable.amountMinor,
        currency: expensesTable.currency,
        projectId: expensesTable.projectId,
        projectName: projectsTable.name,
      })
      .from(expensesTable)
      .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
      .where(and(
        eq(expensesTable.tenantId, identity.tenantId),
        eq(expensesTable.ownerUserId, identity.userId),
      ))
      .orderBy(desc(expensesTable.occurredAt))
      .limit(50);
    const [currency, totalMinor] = rows.reduce<[string, number]>(
      ([currentCurrency, total], row) => [
        currentCurrency || row.currency,
        total + row.amountMinor,
      ],
      ["", 0],
    );
    return {
      count: rows.length,
      totalMinor,
      currency: currency || "EGP",
      projectCount: new Set(rows.map((row) => row.projectId).filter(Boolean)).size,
    };
  }

  async getIdempotentResponse(
    identity: Identity,
    key: string,
  ): Promise<TurnResult | null> {
    const [record] = await db
      .select()
      .from(idempotencyRecordsTable)
      .where(
        and(
          eq(idempotencyRecordsTable.tenantId, identity.tenantId),
          eq(idempotencyRecordsTable.ownerUserId, identity.userId),
          eq(idempotencyRecordsTable.key, key),
        ),
      )
      .limit(1);
    return record ? (JSON.parse(record.responseJson) as TurnResult) : null;
  }

  async saveIdempotentResponse(
    identity: Identity,
    key: string,
    response: TurnResult,
  ): Promise<void> {
    await db
      .insert(idempotencyRecordsTable)
      .values({
        tenantId: identity.tenantId,
        ownerUserId: identity.userId,
        key,
        responseJson: JSON.stringify(response),
      })
      .onConflictDoNothing();
  }
}

function moneyLabel(amountMinor: number, currency: string): string {
  const unit = currency === "EGP" ? "جنيه" : currency;
  return `${new Intl.NumberFormat("ar-EG").format(amountMinor / 100)} ${unit}`;
}

function detectCurrency(label: string): string {
  const normalized = normalizeArabic(label);
  if (normalized.includes("دولار")) return "USD";
  if (normalized.includes("ريال")) return "SAR";
  return "EGP";
}

function amountMinorFromArabic(value: string): number {
  const digitMatch = value.match(/[\d٠-٩]+(?:[.,][\d٠-٩]+)?/);
  if (digitMatch) {
    const westernDigits = digitMatch[0].replace(/[٠-٩]/g, (digit) =>
      String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)),
    );
    const amount = Number(westernDigits.replace(",", "."));
    return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
  }

  const normalized = normalizeArabic(value).replace(/[،,]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:سبع|سبعه)\s+(?:الاف|الاف|آلاف)\s+و?\s*(?:نص|نصف)$/.test(normalized)) {
    return 750000;
  }

  const commonAmounts: Record<string, number> = {
    الف: 1000,
    "الفين": 2000,
    "ثلاثه الاف": 3000,
    "ثلاث الاف": 3000,
    "خمسه الاف": 5000,
    "خمسة الاف": 5000,
    "سبعه الاف": 7000,
    "سبعة الاف": 7000,
    "عشره الاف": 10000,
    "عشرة الاف": 10000,
  };
  const major = commonAmounts[normalized];
  return major ? major * 100 : Number.NaN;
}

function findAmountText(message: string): { raw: string; index: number } | null {
  const digits = message.match(/[\d٠-٩]+(?:[.,][\d٠-٩]+)?/);
  if (digits && digits.index !== undefined) return { raw: digits[0], index: digits.index };
  const words = message.match(/(?:سبعة|سبعه|سبع)\s+(?:آلاف|الاف)\s+و?\s*(?:نص|نصف)/i);
  return words && words.index !== undefined ? { raw: words[0], index: words.index } : null;
}

function cleanPersonName(value: string): string {
  return value
    .trim()
    .replace(/^(?:مصروف|دفعة)\s+/i, "")
    .replace(/^ل(?=\S)/, "")
    .trim();
}

function extractExpensePerson(message: string, amount: { raw: string; index: number }): string | undefined {
  const before = message.slice(0, amount.index).replace(/[،,]/g, " ").trim();
  const after = message.slice(amount.index + amount.raw.length).replace(/[،,؟?]/g, " ").trim();
  const beforeProject = before.replace(/\s+(?:بمبلغ|مبلغ|بقيمة)\s*$/i, "").trim();

  const tookPattern = beforeProject.match(/^(?:أنا\s+)?(.+?)\s+(?:خد|أخد)\s+مني$/i);
  if (tookPattern?.[1]) return tookPattern[1].trim();

  const afterLink = after.match(/^(?:ل|إلى|الى)\s*(.+?)(?:\s+(?:على|بمبلغ|مبلغ|بقيمة)\b|$)/i);
  if (afterLink?.[1]) return cleanPersonName(afterLink[1]);

  const beforeLink = beforeProject.match(/(?:ل|إلى|الى)\s*(.+)$/i);
  if (beforeLink?.[1]) return cleanPersonName(beforeLink[1]);

  const verb = beforeProject.match(/(?:دفعت|أديت|اديت|أعطيت|اعطيت|سجل(?:\s+مصروف)?|صرفت|صرف)\s+(.+)$/i);
  if (verb?.[1]) return cleanPersonName(verb[1]);
  return undefined;
}

type ExpenseInput = {
  amountMinor: number;
  currency: string;
  description: string;
  personName?: string;
  projectName?: string;
  projectOrPurpose?: boolean;
};

function parseExpense(message: string) {
  const normalized = normalizeArabic(message);
  if (!/(?:دفعت|اديت|اعطيت|خد|اخد|سجل|مصروف|صرفت|صرف)/i.test(normalized)) return null;
  const amount = findAmountText(message);
  if (!amount) return { needsAmount: true as const, personName: extractExpensePerson(message, { raw: "", index: message.length }) };

  const amountMinor = amountMinorFromArabic(amount.raw);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  const personName = extractExpensePerson(message, amount);
  const projectMatch = message.match(/(?:على|بمشروع|مشروع)\s+(.+?)(?:[،,]|$)/i);
  const projectName = projectMatch?.[1]?.trim() || undefined;
  const currencyMatch = message.match(/(جنيه|جنية|دولار|ريال)/i);
  const currency = currencyMatch ? detectCurrency(currencyMatch[1]) : "EGP";
  return {
    amountMinor,
    currency,
    description: projectName
      ? `دفعة${personName ? ` إلى ${personName}` : ""} على ${projectName}`
      : `دفعة${personName ? ` إلى ${personName}` : ""}`,
    personName,
    projectName,
  };
}

function recentActionValue(
  memory: ConversationMemorySnapshot,
  key: string,
): unknown {
  for (const turn of [...memory.recentTurns].reverse()) {
    if (turn.action && key in turn.action) return turn.action[key];
  }
  return undefined;
}

function recentAction(memory: ConversationMemorySnapshot): Record<string, unknown> | undefined {
  for (const turn of [...memory.recentTurns].reverse()) {
    if (turn.action) return turn.action;
  }
  return undefined;
}

function parseConversationExpense(
  message: string,
  memory: ConversationMemorySnapshot,
) {
  const pending = recentAction(memory);
  const amount = findAmountText(message);
  if (!amount) return null;
  const isBareAmount = message.trim() === amount.raw.trim();
  const usesPreviousPerson = /^(?:و)?دفعت\s*له(?:ا)?\s*/i.test(message.trim());
  if (!pending || (!pending.awaitingAmount && !usesPreviousPerson) || (!isBareAmount && !usesPreviousPerson)) {
    return null;
  }
  const amountMinor = amountMinorFromArabic(amount.raw);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  const personName = pending.personName;
  const projectName = pending.projectName;
  return {
    amountMinor,
    currency: "EGP",
    description: `دفعة إلى ${typeof personName === "string" ? personName : "الشخص السابق"}`,
    personName: typeof personName === "string" ? personName : undefined,
    projectName: typeof projectName === "string" ? projectName : undefined,
  };
}

function parseConversationCorrection(
  message: string,
  memory: ConversationMemorySnapshot,
) {
  const normalized = normalizeArabic(message);
  if (!/(?:قصدي|المبلغ|خليه|خلي|غيره|لا)/i.test(normalized)) return null;
  const expenseId = recentActionValue(memory, "expenseId");
  const amount = findAmountText(message);
  if (!amount || typeof expenseId !== "string") return null;
  const amountMinor = amountMinorFromArabic(amount.raw);
  return Number.isSafeInteger(amountMinor) && amountMinor > 0
    ? { expenseId, amountMinor }
    : null;
}

function parseProjectCorrection(
  message: string,
  memory: ConversationMemorySnapshot,
) {
  if (!/(?:مش\s+ده|التاني|الثاني|غير\s+المشروع|المشروع\s+التاني)/i.test(normalizeArabic(message))) {
    return null;
  }
  const previous = recentAction(memory);
  const expenseId = previous?.expenseId;
  const candidates = previous?.projectCandidates;
  if (typeof expenseId !== "string" || !Array.isArray(candidates)) return null;
  const index = /(?:التاني|الثاني)/i.test(normalizeArabic(message)) ? 1 : 0;
  const candidate = candidates[index];
  if (!candidate || typeof candidate !== "object") return null;
  const project = candidate as Record<string, unknown>;
  return typeof project.id === "string"
    ? { expenseId, projectId: project.id, projectName: project.name }
    : null;
}

function parsePendingProjectSelection(
  message: string,
  memory: ConversationMemorySnapshot,
) {
  const previous = recentAction(memory);
  if (!previous?.awaitingProject || !Array.isArray(previous.projectCandidates)) return null;
  const normalized = normalizeArabic(message);
  const index = /(?:التاني|الثاني|2|٢)/i.test(normalized) ? 1 : 0;
  const candidate = previous.projectCandidates[index];
  const pending = previous.pendingExpense;
  if (!candidate || typeof candidate !== "object" || !pending || typeof pending !== "object") return null;
  const project = candidate as Record<string, unknown>;
  return typeof project.id === "string"
    ? {
        ...(pending as Record<string, unknown>),
        projectId: project.id,
        projectName: project.name,
        projectCandidates: previous.projectCandidates,
      }
    : null;
}

function cairoDateAt(dayOffset: number, hour: number, minute: number): Date {
  const nowParts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const utcGuess = Date.UTC(
    Number(nowParts.year),
    Number(nowParts.month) - 1,
    Number(nowParts.day) + dayOffset,
    hour,
    minute,
  );
  const offsetParts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess)).map((part) => [part.type, part.value]));
  const cairoAsUtc = Date.UTC(
    Number(offsetParts.year),
    Number(offsetParts.month) - 1,
    Number(offsetParts.day),
    Number(offsetParts.hour),
    Number(offsetParts.minute),
    Number(offsetParts.second),
  );
  return new Date(utcGuess - (cairoAsUtc - utcGuess));
}

function tomorrowAtNine(): Date {
  return cairoDateAt(1, 9, 0);
}

function arabicDigits(value: string): number {
  return Number(value.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))));
}

function parseClock(message: string): { hour: number; minute: number } | null {
  const match = message.match(
    /(?:الساعة\s*)?([0-9٠-٩]{1,2})(?:\s*[:٫]\s*([0-9٠-٩]{1,2}))?\s*(صباح(?:ا|ًا)?|مساء(?:ا|ً)?|بالليل|ليل|ظهر)?/i,
  );
  if (!match) return null;
  let hour = arabicDigits(match[1]);
  const minute = match[2] ? arabicDigits(match[2]) : 0;
  const period = match[3]?.toLocaleLowerCase("ar");
  if (minute > 59 || hour > 23) return null;
  if (period?.startsWith("مساء") || period === "بالليل" || period === "ليل") {
    if (hour < 12) hour += 12;
  } else if (period?.startsWith("صباح") && hour === 12) {
    hour = 0;
  } else if (period === "ظهر" && hour < 12) {
    hour += 12;
  }
  return hour <= 23 ? { hour, minute } : null;
}

function reminderDueAt(message: string): Date | null {
  const clock = parseClock(message);
  return clock ? cairoDateAt(1, clock.hour, clock.minute) : null;
}

function isNoValueReply(message: string): boolean {
  return /^(?:لا|لأ|لا\s+مش\s+مهم|مش\s+مهم|مش\s+لازم|بدون|من\s+غير|ولا\s+حاجه|ولا\s+شيء|مش\s+عايز|مش\s+عاوزه|أي\s+وقت|اي\s+وقت)$/i.test(
    normalizeArabic(message),
  );
}

function reminderTextAndDueAt(message: string): { text: string; dueAt: Date | null } {
  const rest = message.replace(/^فكرني\s+(?:بكره|بكرة)\s*/i, "").trim();
  const clock = parseClock(rest);
  const text = rest
    .replace(/(?:الساعة\s*)?[0-9٠-٩]{1,2}(?:\s*[:٫]\s*[0-9٠-٩]{1,2})?\s*(?:صباح(?:ا|ًا)?|مساء(?:ا|ً)?|بالليل|ليل|ظهر)?/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return { text: text || "راجع تذكيرك", dueAt: clock ? cairoDateAt(1, clock.hour, clock.minute) : null };
}

function parsePendingReminderReply(message: string, memory: ConversationMemorySnapshot) {
  const previous = recentAction(memory);
  const pending = previous?.pendingReminder;
  if (!previous?.awaitingReminderTime || !pending || typeof pending !== "object") return null;
  const pendingReminder = pending as Record<string, unknown>;
  const clock = parseClock(message);
  const dueAt = clock ? cairoDateAt(1, clock.hour, clock.minute) : isNoValueReply(message) ? tomorrowAtNine() : null;
  if (!dueAt) return { needsTime: true as const };
  return {
    needsTime: false as const,
    text: typeof pendingReminder.text === "string" ? pendingReminder.text : "راجع تذكيرك",
    dueAt,
  };
}

function parsePendingExpenseReply(message: string, memory: ConversationMemorySnapshot) {
  const previous = recentAction(memory);
  const pending = previous?.pendingExpense;
  if (!pending || typeof pending !== "object") return null;
  const pendingExpense = pending as Record<string, unknown>;
  if (previous.awaitingPersonOptional) {
    const personName = isNoValueReply(message) ? undefined : message.trim();
    return {
      stage: "person" as const,
      expense: {
        ...pendingExpense,
        ...(personName ? { personName } : {}),
      },
    };
  }
  if (previous.awaitingProjectOrPurpose) {
    const purpose = isNoValueReply(message) ? undefined : message.trim()
      .replace(/^(?:مشروع|الغرض|على)\s+/i, "")
      .trim();
    return {
      stage: "ready" as const,
      expense: {
        ...pendingExpense,
        ...(purpose ? { projectName: purpose, projectOrPurpose: true } : {}),
      },
    };
  }
  return null;
}

async function saveDeterministicExpense(
  persistence: PersistencePort,
  identity: Identity,
  conversationId: string,
  idempotencyKey: string | null | undefined,
  input: {
    amountMinor: number;
    currency: string;
    description: string;
    personName?: string;
    projectName?: string;
    projectId?: string;
    personCandidates?: Array<{ id: string; name: string }>;
    projectCandidates?: Array<{ id: string; name: string }>;
  },
  sourceTurnId?: string,
  channel?: TurnInputChannel,
): Promise<TurnResult> {
  const [people, projects] = channel === "quick"
    ? [[], []] as const
    : await Promise.all([
        persistence.listPeople(identity),
        persistence.listProjects(identity),
      ]);
  const operationArgs = {
    ...input,
    personCandidates: input.personCandidates ?? people.map((person) => ({ id: person.id, name: person.name })),
    projectCandidates: input.projectCandidates ?? projects.map((project) => ({ id: project.id, name: project.name })),
  };
  const pending = await createPendingOperation(identity, {
    conversationId,
    sourceTurnId,
    idempotencyKey,
    toolName: "record_expense",
    args: operationArgs,
  });
  return {
    conversationId,
    assistantMessage: `قبل ما أسجل المصروف، أحتاج موافقتك: ${pending.display.details.join(" — ")}.`,
    action: {
      type: "approval_required",
      operationId: pending.operationId,
      status: pending.status,
      toolName: pending.toolName,
      display: pending.display,
      args: pending.args,
    },
    provider: "development",
    model: "deterministic-ar-v1",
  };
}

async function pendingDeterministicAction(
  identity: Identity,
  conversationId: string,
  idempotencyKey: string | null | undefined,
  toolName: string,
  args: Record<string, unknown>,
  sourceTurnId?: string,
): Promise<TurnResult> {
  const pending = await createPendingOperation(identity, {
    conversationId,
    sourceTurnId,
    idempotencyKey,
    toolName,
    args,
    display: displayForOperation(toolName, args),
  });
  const details = pending.display.details.join(" — ");
  return {
    conversationId,
    assistantMessage: `قبل ما أنفذ ${pending.display.title}${details ? ` (${details})` : ""}، هل توافق؟`,
    action: {
      type: "approval_required",
      operationId: pending.operationId,
      status: pending.status,
      toolName: pending.toolName,
      display: pending.display,
      args: pending.args,
    },
    provider: "development",
    model: "deterministic-ar-v1",
  };
}

export class DeterministicAgentRuntime {
  constructor(private readonly persistence: PersistencePort) {}

  async run(
    identity: Identity,
    input: {
      message: string;
      conversationId?: string | null;
      idempotencyKey?: string | null;
      channel?: TurnInputChannel;
      context?: SecretaryChatContext | null;
      peer?: SecretaryChatPeer | null;
      requestId?: string;
    },
  ): Promise<TurnResult> {
    if (input.idempotencyKey) {
      const stored = await this.persistence.getIdempotentResponse(
        identity,
        input.idempotencyKey,
      );
      if (stored) return stored;
    }

    const conversationId = input.conversationId || randomUUID();
    const turnId = input.requestId ?? randomUUID();
    const conversationMemory = await loadConversationMemory(identity, conversationId);
    const message = input.message.trim();
    let result: TurnResult;
    if (isBroadExpenseReportRequest(message)) {
      const report = await this.persistence.getExpenseReport(identity);
      const amount = new Intl.NumberFormat("ar-EG", {
        style: "currency",
        currency: report.currency,
      }).format(report.totalMinor / 100);
      result = {
        conversationId,
        assistantMessage: report.count === 0
          ? "لا توجد مصروفات محفوظة حتى الآن."
          : `تقرير المصروفات: ${amount} عبر ${report.count} مصروف${report.projectCount > 0 ? ` موزعة على ${report.projectCount} مشروع` : ""}.`,
        action: { type: "expense_report", summary: report },
        provider: "development",
        model: "deterministic-ar-v1",
      };
      result = { ...result, turnId };
      if (input.idempotencyKey) {
        await this.persistence.saveIdempotentResponse(identity, input.idempotencyKey, result);
      }
      await saveConversationTurn(identity, conversationMemory, {
        turnId,
        userMessage: message,
        assistantMessage: result.assistantMessage,
        action: result.action,
      });
      return result;
    }
    const expense = parseExpense(message);
    const contextualExpense = parseConversationExpense(message, conversationMemory);
    const correction = parseConversationCorrection(message, conversationMemory);
    const projectCorrection = parseProjectCorrection(message, conversationMemory);
    const pendingProjectSelection = parsePendingProjectSelection(message, conversationMemory);
    const pendingReminderReply = parsePendingReminderReply(message, conversationMemory);
    const pendingExpenseReply = parsePendingExpenseReply(message, conversationMemory);
    const pendingExpenseInput = pendingExpenseReply && "expense" in pendingExpenseReply
      ? pendingExpenseReply.expense as ExpenseInput
      : null;
    const expenseInput = pendingExpenseInput
      ?? (expense && !("needsAmount" in expense) ? expense as ExpenseInput : null);
    const projectMatch = message.match(
      /^بدأت\s+(?:مشروع(?:\s+جديد)?)\s+(?:اسمه\s+)?(.+)$/i,
    );
    const personRelationshipMatch = message.match(/^(.+?)\s+هو\s+(.+)$/i);

    if (pendingReminderReply && !pendingReminderReply.needsTime) {
      result = await pendingDeterministicAction(identity, conversationId, input.idempotencyKey, "create_reminder", {
        text: pendingReminderReply.text,
        dueAt: pendingReminderReply.dueAt.toISOString(),
        timezone: "Africa/Cairo",
      }, turnId);
    } else if (pendingReminderReply?.needsTime) {
      result = {
        conversationId,
        assistantMessage: "تحب التذكير الساعة كام؟ اكتب الوقت، أو قل «أي وقت» لأضعه الساعة 9 صباحًا.",
        action: {
          type: "clarification_needed",
          intent: "create_reminder",
          awaitingReminderTime: true,
          pendingReminder: recentAction(conversationMemory)?.pendingReminder,
        },
        provider: "development",
        model: "deterministic-ar-v1",
      };
    } else if (projectMatch) {
      result = await pendingDeterministicAction(identity, conversationId, input.idempotencyKey, "create_project", {
        name: projectMatch[1].trim(),
      }, turnId);
    } else if (personRelationshipMatch) {
      const projectId = recentActionValue(conversationMemory, "projectId");
      const projectName = recentActionValue(conversationMemory, "projectName");
      if (typeof projectId !== "string") {
        result = {
          conversationId,
          assistantMessage: "حدّد المشروع المرتبط بالشخص أولًا.",
          action: { type: "clarification_needed", personName: personRelationshipMatch[1].trim() },
          provider: "development",
          model: "deterministic-ar-v1",
        };
      } else {
        result = await pendingDeterministicAction(identity, conversationId, input.idempotencyKey, "create_person_and_link_person_to_project", {
          personName: personRelationshipMatch[1].trim(),
          projectId,
          projectName,
          relationship: personRelationshipMatch[2].trim(),
        }, turnId);
      }
    } else if (projectCorrection) {
      result = await pendingDeterministicAction(identity, conversationId, input.idempotencyKey, "update_expense", projectCorrection, turnId);
    } else if (correction) {
      result = await pendingDeterministicAction(identity, conversationId, input.idempotencyKey, "update_expense", correction, turnId);
    } else if (contextualExpense) {
      result = await saveDeterministicExpense(
        this.persistence,
        identity,
        conversationId,
        input.idempotencyKey,
        contextualExpense,
        turnId,
        input.channel,
      );
    } else if (pendingProjectSelection) {
      const pending = pendingProjectSelection as Record<string, unknown>;
      if (typeof pending.amountMinor === "number" && typeof pending.currency === "string"
        && typeof pending.description === "string") {
          result = await saveDeterministicExpense(this.persistence, identity, conversationId, input.idempotencyKey, {
          amountMinor: pending.amountMinor,
          currency: pending.currency,
          description: pending.description,
          personName: typeof pending.personName === "string" ? pending.personName : undefined,
          projectName: typeof pending.projectName === "string" ? pending.projectName : undefined,
          projectId: typeof pending.projectId === "string" ? pending.projectId : undefined,
          projectCandidates: Array.isArray(pending.projectCandidates)
            ? pending.projectCandidates.filter((candidate): candidate is { id: string; name: string } =>
              Boolean(candidate && typeof candidate === "object"
                && typeof (candidate as Record<string, unknown>).id === "string"
                && typeof (candidate as Record<string, unknown>).name === "string"))
            : undefined,
         }, turnId, input.channel);
      } else {
        result = {
          conversationId,
          assistantMessage: "لم أستطع ربط اختيار المشروع بالمصروف السابق.",
          action: { type: "clarification_needed", reason: "pending_expense_missing" },
          provider: "development",
          model: "deterministic-ar-v1",
        };
      }
    } else if (expense && "needsAmount" in expense) {
      const personName = typeof expense.personName === "string" ? expense.personName : undefined;
      result = {
        conversationId,
        assistantMessage: personName ? "تمام، كام المبلغ؟" : "تمام، المصروف ده لمين؟",
        action: {
          type: "clarification_needed",
          intent: "record_expense",
          awaitingAmount: Boolean(personName),
          personName,
        },
        provider: "development",
        model: "deterministic-ar-v1",
      };
    } else if (expenseInput) {
      if (pendingExpenseReply?.stage === "person" && !expenseInput.projectName) {
        result = {
          conversationId,
          assistantMessage: "تمام. ما اسم المشروع أو الغرض؟ ولو المصروف غير مرتبط، اكتب «بدون مشروع».",
          action: {
            type: "clarification_needed",
            intent: "record_expense",
            awaitingProjectOrPurpose: true,
            pendingExpense: expenseInput,
          },
          provider: "development",
          model: "deterministic-ar-v1",
        };
      } else if (!expenseInput.personName) {
        result = {
          conversationId,
          assistantMessage: "اسم المستلم اختياري. اكتب الاسم لو تحب أضيفه، أو اكتب «بدون اسم». وبعدها هأكد المشروع أو الغرض.",
          action: {
            type: "clarification_needed",
            intent: "record_expense",
            awaitingPersonOptional: true,
            pendingExpense: expenseInput,
          },
          provider: "development",
          model: "deterministic-ar-v1",
        };
      } else {
        const [people, projects] = await Promise.all([
          expenseInput.personName ? this.persistence.findPeople(identity, expenseInput.personName) : Promise.resolve([]),
          expenseInput.projectName ? this.persistence.findProjects(identity, expenseInput.projectName) : Promise.resolve([]),
        ]);
        const resolvedExpense = expenseInput.projectOrPurpose && expenseInput.projectName && projects.length === 0
          ? {
              ...expenseInput,
              description: `${expenseInput.description} — الغرض: ${expenseInput.projectName}`,
              projectName: undefined,
              projectOrPurpose: undefined,
            }
          : expenseInput;
        if (people.length > 1) {
          result = {
            conversationId,
            assistantMessage: `عندك أكثر من شخص باسم ${expenseInput.personName}، تقصد أي واحد؟`,
            action: {
              type: "clarification_needed",
              reason: "ambiguous_person",
              personCandidates: people.map((person) => ({ id: person.id, name: person.name })),
              pendingExpense: resolvedExpense,
            },
            provider: "development",
            model: "deterministic-ar-v1",
          };
        } else if (projects.length > 1) {
          result = {
            conversationId,
            assistantMessage: `عندك أكثر من مشروع باسم ${expenseInput.projectName}، تقصد أي واحد؟`,
            action: {
              type: "clarification_needed",
              reason: "ambiguous_project",
              awaitingProject: true,
              projectCandidates: projects.map((project) => ({ id: project.id, name: project.name })),
              pendingExpense: resolvedExpense,
            },
            provider: "development",
            model: "deterministic-ar-v1",
          };
        } else {
          result = await saveDeterministicExpense(this.persistence, identity, conversationId, input.idempotencyKey, resolvedExpense, turnId, input.channel);
        }
      }
    } else {
      const reminderMatch = message.match(
        /^فكرني\s+بكره|^فكرني\s+بكرة/i,
      );
      const totalMatch = message.match(
        /^(.+?)\s+(?:اخد|أخد)\s+مني\s+كام[؟?]?$/i,
      );
      const projectPeopleMatch = message.match(
        /مين\s+(?:الناس\s+)?(?:المرتبطين|اللي\s+في)\s+(?:ب)?مشروع\s+(.+?)[؟?]?$/i,
      );

      if (reminderMatch) {
        const { text, dueAt } = reminderTextAndDueAt(message);
        if (dueAt) {
          result = await pendingDeterministicAction(identity, conversationId, input.idempotencyKey, "create_reminder", {
            text,
            dueAt: dueAt.toISOString(),
            timezone: "Africa/Cairo",
          }, turnId);
        } else {
          result = {
            conversationId,
            assistantMessage: "تحب التذكير الساعة كام؟ اكتب الوقت، أو قل «أي وقت» لأضعه الساعة 9 صباحًا.",
            action: {
              type: "clarification_needed",
              intent: "create_reminder",
              awaitingReminderTime: true,
              pendingReminder: { text },
            },
            provider: "development",
            model: "deterministic-ar-v1",
          };
        }
      } else if (totalMatch) {
        const personName = totalMatch[1].trim();
        const total = await this.persistence.totalPaidToPerson(
          identity,
          personName,
        );
        result = {
          conversationId,
          assistantMessage:
            total.count > 0
              ? `${personName} أخد منك ${moneyLabel(total.totalMinor, total.currency)} في ${new Intl.NumberFormat("ar-EG").format(total.count)} دفعة.`
              : `مش لاقي مصروفات مسجلة لـ${personName}.`,
          action: {
            type: "person_expense_total",
            personName,
            ...total,
          },
          provider: "development",
          model: "deterministic-ar-v1",
        };
      } else if (projectPeopleMatch) {
        const projectName = projectPeopleMatch[1].trim();
        const people = await this.persistence.peopleForProject(
          identity,
          projectName,
        );
        result = {
          conversationId,
          assistantMessage:
            people.length > 0
              ? `المرتبطين بمشروع ${projectName}: ${people.map((person) => person.name).join("، ")}.`
              : `مش لاقي أشخاص مرتبطين بمشروع ${projectName}.`,
          action: {
            type: "project_people",
            projectName,
            people: people.map((person) => ({ id: person.id, name: person.name })),
          },
          provider: "development",
          model: "deterministic-ar-v1",
        };
      } else if (
        /(?:ملخص|ايه|إيه).*(?:اليوم|عندي)|(?:اليوم|عندي).*(?:ايه|إيه)/i.test(
          message,
        )
      ) {
        const context = await this.persistence.getTodayContext(identity);
        result = {
          conversationId,
          assistantMessage: `عندك ${context.upcomingReminders.length} تذكير جاي، ${context.pendingTasks.length} مهمة مفتوحة، و${context.recentExpenses.length} مصروف حديث.`,
          action: { type: "today_context", context },
          provider: "development",
          model: "deterministic-ar-v1",
        };
      } else {
        result = {
          conversationId,
          assistantMessage:
            "أقدر أسجل مصروف، أضيف تذكير لبكرة، أحسب دفعات شخص، أو أقول لك مين مرتبط بمشروع. اكتب طلبك بطريقتك.",
          action: { type: "help" },
          provider: "development",
          model: "deterministic-ar-v1",
        };
      }
    }

    result = {
      ...result,
      turnId,
      action: annotateApprovalAction(result.action, input.channel),
    };
    result = {
      ...result,
      assistantMessage: approvalMessage(result.action, result.assistantMessage, input.channel),
    };
    if (input.idempotencyKey) {
      await this.persistence.saveIdempotentResponse(
        identity,
        input.idempotencyKey,
        result,
      );
    }
    await saveConversationTurn(identity, conversationMemory, {
      turnId,
      userMessage: message,
      assistantMessage: result.assistantMessage,
      action: result.action,
    });
    return result;
  }
}

function operationStringArg(operation: PendingOperation, key: string): string | undefined {
  const value = operation.args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function operationNumberArg(operation: PendingOperation, key: string): number | undefined {
  const value = operation.args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function executeApprovedOperation(
  identity: Identity,
  operation: PendingOperation,
): Promise<OperationExecutionResult> {
  const conversationId = operation.conversationId ?? randomUUID();
  let action: Record<string, unknown>;
  let assistantMessage: string;

  const toolResult = await executeStructuredTool(identity, operation.toolName, operation.args, {
    requestId: `approval-${operation.operationId}`,
    conversationId,
    sourceTurnId: operation.sourceTurnId ?? undefined,
    approvedOperationId: operation.operationId,
  });
  if (!toolResult.ok || toolResult.pendingApproval) {
    throw new Error(typeof toolResult.error === "string" ? toolResult.error : "تعذر تنفيذ العملية.");
  }
  const resultRecord = (key: string) => {
    const value = toolResult[key];
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  };
  const expense = resultRecord("expense");
  const project = resultRecord("project");
  const person = resultRecord("person");
  const reminder = resultRecord("reminder");
  if (operation.toolName === "record_expense" && expense) {
    assistantMessage = `تمام، سجلت ${moneyLabel(Number(expense.amountMinor), String(expense.currency))}.`;
    action = {
      type: "expense_recorded",
      operationId: operation.operationId,
      expenseId: expense.id,
      amountMinor: expense.amountMinor,
      currency: expense.currency,
      personId: expense.personId,
      projectId: expense.projectId,
      personName: operationStringArg(operation, "personName"),
      projectName: operationStringArg(operation, "projectName"),
      ...(Array.isArray(operation.args.projectCandidates)
        ? { projectCandidates: operation.args.projectCandidates }
        : {}),
    };
  } else if (operation.toolName === "create_project" && project) {
    assistantMessage = `تمام، سجلت مشروع ${String(project.name)}.`;
    action = { type: "project_created", operationId: operation.operationId, projectId: project.id, projectName: project.name };
  } else if (operation.toolName === "create_person" && person) {
    assistantMessage = `تمام، سجلت ${String(person.name)}.`;
    action = { type: "person_created", operationId: operation.operationId, personId: person.id, personName: person.name };
  } else if (operation.toolName === "update_expense" && expense) {
    const projectCorrection = operationNumberArg(operation, "amountMinor") === undefined
      && Boolean(operationStringArg(operation, "projectId"));
    assistantMessage = projectCorrection
      ? "تمام، نقلت المصروف إلى المشروع الآخر."
      : `تمام، صححت المصروف إلى ${moneyLabel(Number(expense.amountMinor), String(expense.currency))}.`;
    action = {
      type: projectCorrection ? "expense_project_corrected" : "expense_corrected",
      operationId: operation.operationId,
      expenseId: expense.id,
      amountMinor: expense.amountMinor,
      currency: expense.currency,
      personId: expense.personId,
      projectId: expense.projectId,
      personName: operationStringArg(operation, "personName"),
      projectName: operationStringArg(operation, "projectName"),
      description: expense.description,
    };
  } else if (operation.toolName === "create_person_and_link_person_to_project" && person) {
    assistantMessage = `تمام، ربطت ${String(person.name)} بالمشروع المحدد.`;
    action = {
      type: "person_linked",
      operationId: operation.operationId,
      personId: person.id,
      personName: person.name,
      projectId: operation.args.projectId,
      projectName: operation.args.projectName,
      relationship: operation.args.relationship,
    };
  } else if (operation.toolName === "create_reminder" && reminder) {
    assistantMessage = `حاضر، هفكرك: ${String(reminder.text)}.`;
    action = {
      type: "reminder_created",
      operationId: operation.operationId,
      reminderId: reminder.id,
      dueAt: reminder.dueAt instanceof Date ? reminder.dueAt.toISOString() : reminder.dueAt,
    };
  } else {
    assistantMessage = "تم تنفيذ التغيير المطلوب.";
    action = {
      type: "operation_completed",
      operationId: operation.operationId,
      toolName: operation.toolName,
      toolResult,
    };
  }

  return {
    conversationId,
    assistantMessage,
    action,
    provider: "server",
    model: "approved-operation",
  };
}

export async function saveApprovedOperationTurn(
  identity: Identity,
  operation: PendingOperation,
  result: OperationExecutionResult,
): Promise<void> {
  if (!operation.conversationId) return;
  const memory = await loadConversationMemory(identity, operation.conversationId);
  await saveConversationTurn(identity, memory, {
    turnId: crypto.randomUUID(),
    userMessage: "موافقة على العملية",
    assistantMessage: result.assistantMessage,
    action: result.action,
  });
}

export const persistence: PersistencePort = new DrizzlePersistence();
export const developmentAgentRuntime = new DeterministicAgentRuntime(persistence);
export const agentRuntime = configuredProvider() === "development"
  ? developmentAgentRuntime
  : phase2Enabled()
    ? phase2AgentRuntime
    : unavailableAgentRuntime;