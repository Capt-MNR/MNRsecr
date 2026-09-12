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
    },
  ): Promise<PersistedExpense>;
  createProject(identity: Identity, name: string): Promise<Project>;
  createPerson(identity: Identity, name: string): Promise<Person>;
  linkPersonToProject(
    identity: Identity,
    input: { personId: string; projectId: string; relationship: string },
  ): Promise<void>;
  updateExpense(
    identity: Identity,
    input: { expenseId: string; amountMinor: number },
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
    },
  ): Promise<PersistedExpense> {
    const person = input.personName
      ? await this.findOrCreatePerson(identity, input.personName)
      : null;
    const project = input.projectName
      ? await this.findOrCreateProject(identity, input.projectName)
      : null;

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
    input: { expenseId: string; amountMinor: number },
  ): Promise<PersistedExpense | null> {
    const [updated] = await db.update(expensesTable).set({
      amountMinor: input.amountMinor,
    }).where(and(
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

function parseExpense(message: string) {
  const match = message.match(
    /دفعت\s+ل?([^\d]+?)\s+([\d٠-٩]+(?:[.,][\d٠-٩]+)?)\s*(جنيه|جنية|دولار|ريال)(?:\s+(.+))?$/i,
  );
  if (!match) return null;
  const westernDigits = match[2].replace(/[٠-٩]/g, (digit) =>
    String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)),
  );
  const amount = Number(westernDigits.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const context = match[4]?.trim();
  return {
    personName: match[1].trim(),
    amountMinor: Math.round(amount * 100),
    currency: detectCurrency(match[3]),
    description: context || `دفعة إلى ${match[1].trim()}`,
    projectName: context || undefined,
  };
}

function amountMinorFromArabic(value: string): number {
  const westernDigits = value.replace(/[٠-٩]/g, (digit) =>
    String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)),
  );
  return Math.round(Number(westernDigits.replace(",", ".")) * 100);
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

function parseConversationExpense(
  message: string,
  memory: ConversationMemorySnapshot,
) {
  const match = message.match(
    /^(?:و)?دفعت\s*ل(?:ه|ها)\s+([\d٠-٩]+(?:[.,][\d٠-٩]+)?)\s*$/i,
  );
  if (!match) return null;
  const amountMinor = amountMinorFromArabic(match[1]);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  const personName = recentActionValue(memory, "personName");
  const projectName = recentActionValue(memory, "projectName");
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
  const match = message.match(
    /^(?:لا[،,]?\s*)?(?:المبلغ\s+كان|المبلغ|خليه)\s+([\d٠-٩]+(?:[.,][\d٠-٩]+)?)/i,
  );
  const expenseId = recentActionValue(memory, "expenseId");
  if (!match || typeof expenseId !== "string") return null;
  const amountMinor = amountMinorFromArabic(match[1]);
  return Number.isSafeInteger(amountMinor) && amountMinor > 0
    ? { expenseId, amountMinor }
    : null;
}

function tomorrowAtNine(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
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
      const saved = await this.persistence.createExpense(identity, contextualExpense);
      result = {
        conversationId,
        assistantMessage: `تمام، سجلت ${moneyLabel(saved.amountMinor, saved.currency)} لـ${saved.personName ?? "الشخص السابق"}${saved.projectName ? ` على مشروع ${saved.projectName}` : ""}.`,
        action: {
          type: "expense_recorded",
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
      };
    } else if (expense) {
      const saved = await this.persistence.createExpense(identity, expense);
      result = {
        conversationId,
        assistantMessage: `تمام، سجلت ${moneyLabel(saved.amountMinor, saved.currency)} لـ${saved.personName ?? expense.personName}${saved.projectName ? ` على مشروع ${saved.projectName}` : ""}.`,
        action: {
          type: "expense_recorded",
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
      };
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