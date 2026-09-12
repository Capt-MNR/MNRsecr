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
  phase2AgentRuntime,
  phase2Enabled,
  unavailableAgentRuntime,
} from "./phase2";
import {
  loadConversationMemory,
  saveConversationTurn,
  type ConversationMemorySnapshot,
} from "./conversation-memory";

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
  createProject(identity: Identity, name: string): Promise<Project>;
  createPerson(identity: Identity, name: string): Promise<Person>;
  linkPersonToProject(
    identity: Identity,
    input: { personId: string; projectId: string; relationship: string },
  ): Promise<void>;
  updateExpense(
    identity: Identity,
    input: { expenseId: string; amountMinor?: number; projectId?: string },
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
    input: { expenseId: string; amountMinor?: number; projectId?: string },
  ): Promise<PersistedExpense | null> {
    const updates = {
      ...(input.amountMinor === undefined ? {} : { amountMinor: input.amountMinor }),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    };
    if (Object.keys(updates).length === 0) return null;
    if (input.projectId !== undefined) {
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

function tomorrowAtNine(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}

async function saveDeterministicExpense(
  persistence: PersistencePort,
  identity: Identity,
  conversationId: string,
  input: {
    amountMinor: number;
    currency: string;
    description: string;
    personName?: string;
    projectName?: string;
    projectId?: string;
    projectCandidates?: Array<{ id: string; name: string }>;
  },
): Promise<TurnResult> {
  const saved = await persistence.createExpense(identity, input);
  return {
    conversationId,
    assistantMessage: `تمام، سجلت ${moneyLabel(saved.amountMinor, saved.currency)} لـ${saved.personName ?? input.personName ?? "الشخص"}${saved.projectName ? ` على مشروع ${saved.projectName}` : ""}.`,
    action: {
      type: "expense_recorded",
      expenseId: saved.id,
      amountMinor: saved.amountMinor,
      currency: saved.currency,
      personId: saved.personId,
      projectId: saved.projectId,
      personName: saved.personName,
      projectName: saved.projectName,
      ...(input.projectCandidates ? { projectCandidates: input.projectCandidates } : {}),
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
    const conversationMemory = await loadConversationMemory(identity, conversationId);
    const message = input.message.trim();
    let result: TurnResult;
    const expense = parseExpense(message);
    const contextualExpense = parseConversationExpense(message, conversationMemory);
    const correction = parseConversationCorrection(message, conversationMemory);
    const projectCorrection = parseProjectCorrection(message, conversationMemory);
    const pendingProjectSelection = parsePendingProjectSelection(message, conversationMemory);
    const projectMatch = message.match(
      /^بدأت\s+(?:مشروع(?:\s+جديد)?)\s+(?:اسمه\s+)?(.+)$/i,
    );
    const personRelationshipMatch = message.match(/^(.+?)\s+هو\s+(.+)$/i);

    if (projectMatch) {
      const project = await this.persistence.createProject(identity, projectMatch[1].trim());
      result = {
        conversationId,
        assistantMessage: `تمام، سجلت مشروع ${project.name}.`,
        action: {
          type: "project_created",
          projectId: project.id,
          projectName: project.name,
        },
        provider: "development",
        model: "deterministic-ar-v1",
      };
    } else if (personRelationshipMatch) {
      const person = await this.persistence.createPerson(identity, personRelationshipMatch[1].trim());
      const projectId = recentActionValue(conversationMemory, "projectId");
      const projectName = recentActionValue(conversationMemory, "projectName");
      if (typeof projectId !== "string") {
        result = {
          conversationId,
          assistantMessage: "حدّد المشروع المرتبط بمحمد أولًا.",
          action: { type: "clarification_needed", personId: person.id, personName: person.name },
          provider: "development",
          model: "deterministic-ar-v1",
        };
      } else {
        await this.persistence.linkPersonToProject(identity, {
          personId: person.id,
          projectId,
          relationship: personRelationshipMatch[2].trim(),
        });
        result = {
          conversationId,
          assistantMessage: `تمام، ربطت ${person.name} بمشروع ${typeof projectName === "string" ? projectName : "المشروع السابق"} كـ${personRelationshipMatch[2].trim()}.`,
          action: {
            type: "person_linked",
            personId: person.id,
            personName: person.name,
            projectId,
            projectName,
            relationship: personRelationshipMatch[2].trim(),
          },
          provider: "development",
          model: "deterministic-ar-v1",
        };
      }
    } else if (projectCorrection) {
      const saved = await this.persistence.updateExpense(identity, projectCorrection);
      result = saved
        ? {
            conversationId,
            assistantMessage: `تمام، نقلت المصروف إلى مشروع ${saved.projectName ?? projectCorrection.projectName ?? "المشروع المقصود"}.`,
            action: {
              type: "expense_project_corrected",
              expenseId: saved.id,
              projectId: saved.projectId,
              projectName: saved.projectName,
              personId: saved.personId,
              personName: saved.personName,
            },
            provider: "development",
            model: "deterministic-ar-v1",
          }
        : {
            conversationId,
            assistantMessage: "لم أجد المصروف السابق لتغيير المشروع.",
            action: { type: "clarification_needed", reason: "expense_not_found" },
            provider: "development",
            model: "deterministic-ar-v1",
          };
    } else if (correction) {
      const saved = await this.persistence.updateExpense(identity, correction);
      result = saved
        ? {
            conversationId,
            assistantMessage: `تمام، صححت المبلغ إلى ${moneyLabel(saved.amountMinor, saved.currency)} بدلًا من تسجيل دفعة جديدة.`,
            action: {
              type: "expense_corrected",
              expenseId: saved.id,
              amountMinor: saved.amountMinor,
              currency: saved.currency,
              personId: saved.personId,
              projectId: saved.projectId,
              personName: saved.personName,
              projectName: saved.projectName,
            },
            provider: "development",
            model: "deterministic-ar-v1",
          }
        : {
            conversationId,
            assistantMessage: "لم أجد الدفعة السابقة لتصحيحها.",
            action: { type: "clarification_needed", reason: "expense_not_found" },
            provider: "development",
            model: "deterministic-ar-v1",
          };
    } else if (contextualExpense) {
      result = await saveDeterministicExpense(
        this.persistence,
        identity,
        conversationId,
        contextualExpense,
      );
    } else if (pendingProjectSelection) {
      const pending = pendingProjectSelection as Record<string, unknown>;
      if (typeof pending.amountMinor === "number" && typeof pending.currency === "string"
        && typeof pending.description === "string") {
        result = await saveDeterministicExpense(this.persistence, identity, conversationId, {
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
        });
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
    } else if (expense) {
      if (!expense.personName) {
        result = {
          conversationId,
          assistantMessage: "تمام، المصروف ده لمين؟",
          action: { type: "clarification_needed", intent: "record_expense", awaitingPerson: true },
          provider: "development",
          model: "deterministic-ar-v1",
        };
      } else {
        const [people, projects] = await Promise.all([
          this.persistence.findPeople(identity, expense.personName),
          expense.projectName ? this.persistence.findProjects(identity, expense.projectName) : Promise.resolve([]),
        ]);
        if (people.length > 1) {
          result = {
            conversationId,
            assistantMessage: `عندك أكثر من شخص باسم ${expense.personName}، تقصد أي واحد؟`,
            action: {
              type: "clarification_needed",
              reason: "ambiguous_person",
              personCandidates: people.map((person) => ({ id: person.id, name: person.name })),
              pendingExpense: expense,
            },
            provider: "development",
            model: "deterministic-ar-v1",
          };
        } else if (projects.length > 1) {
          result = {
            conversationId,
            assistantMessage: `عندك أكثر من مشروع باسم ${expense.projectName}، تقصد أي واحد؟`,
            action: {
              type: "clarification_needed",
              reason: "ambiguous_project",
              awaitingProject: true,
              projectCandidates: projects.map((project) => ({ id: project.id, name: project.name })),
              pendingExpense: expense,
            },
            provider: "development",
            model: "deterministic-ar-v1",
          };
        } else {
          result = await saveDeterministicExpense(this.persistence, identity, conversationId, expense);
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
        const text = message.replace(/^فكرني\s+بكر[هة]\s*/i, "").trim();
        const reminder = await this.persistence.createReminder(identity, {
          text: text || "راجع تذكيرك",
          dueAt: tomorrowAtNine(),
          timezone: "Africa/Cairo",
        });
        result = {
          conversationId,
          assistantMessage: `حاضر، هفكرك بكرة الساعة ٩ صباحًا: ${reminder.text}.`,
          action: {
            type: "reminder_created",
            reminderId: reminder.id,
            dueAt: reminder.dueAt.toISOString(),
          },
          provider: "development",
          model: "deterministic-ar-v1",
        };
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

    if (input.idempotencyKey) {
      await this.persistence.saveIdempotentResponse(
        identity,
        input.idempotencyKey,
        result,
      );
    }
    await saveConversationTurn(identity, conversationMemory, {
      userMessage: message,
      assistantMessage: result.assistantMessage,
      action: result.action,
    });
    return result;
  }
}

export const persistence: PersistencePort = new DrizzlePersistence();
export const developmentAgentRuntime = new DeterministicAgentRuntime(persistence);
export const agentRuntime = configuredProvider() === "development"
  ? developmentAgentRuntime
  : phase2Enabled()
    ? phase2AgentRuntime
    : unavailableAgentRuntime;