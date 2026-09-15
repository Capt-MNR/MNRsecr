import { and, eq } from "drizzle-orm";
import { conversationMemoryTable, db } from "@workspace/db";
import type { Identity } from "./secretary";
import { featureFlags } from "./feature-flags";

export type ConversationTurn = {
  userMessage: string;
  assistantMessage: string;
  action?: Record<string, unknown>;
  createdAt: string;
};

export type ConversationMemorySnapshot = {
  conversationId: string;
  recentTurns: ConversationTurn[];
  summary: string | null;
  turnCount: number;
  state: ConversationState;
};

export const RECENT_CONVERSATION_TURNS = 6;
export const SUMMARY_TRIGGER_TURNS = 7;
const SUMMARY_MAX_CHARS = 3200;
const MEMORY_VALUE_MAX_CHARS = 320;
const STATE_MARKER = "\n[حالة المحادثة المنظمة]\n";

export type ConversationEntity = {
  id: string;
  name: string;
  type: "person" | "project";
  status?: string;
  ordinal?: number;
};

export type ConversationState = {
  people: ConversationEntity[];
  projects: ConversationEntity[];
  candidatePeople: ConversationEntity[];
  candidateProjects: ConversationEntity[];
  facts: Array<{
    key: string;
    value: string;
    confidence: number;
    evidence: "saved_row" | "user_stated";
  }>;
  preferences: Array<{
    key: string;
    value: string;
    confidence: number;
    evidence: "user_stated";
  }>;
  relationships: Array<{
    personId: string;
    projectId: string;
    relationship?: string | null;
    confidence: number;
    evidence: "saved_row";
  }>;
  lastPerson?: ConversationEntity;
  lastProject?: ConversationEntity;
  lastExpense?: {
    id: string;
    amountMinor: number;
    currency: string;
    description?: string;
    personId?: string;
    projectId?: string;
  };
};

export const emptyConversationState = (): ConversationState => ({
  people: [],
  projects: [],
  candidatePeople: [],
  candidateProjects: [],
  facts: [],
  preferences: [],
  relationships: [],
});

function validEntity(value: unknown, type: ConversationEntity["type"]): ConversationEntity | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.name !== "string") return null;
  return {
    id: item.id,
    name: item.name,
    type,
    ...(typeof item.status === "string" ? { status: item.status } : {}),
    ...(typeof item.ordinal === "number" ? { ordinal: item.ordinal } : {}),
  };
}

function validFact(value: unknown): value is ConversationState["facts"][number] {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.key === "string"
    && typeof item.value === "string"
    && typeof item.confidence === "number"
    && (item.evidence === "saved_row" || item.evidence === "user_stated");
}

function validPreference(value: unknown): value is ConversationState["preferences"][number] {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.key === "string"
    && typeof item.value === "string"
    && typeof item.confidence === "number"
    && item.evidence === "user_stated";
}

function validRelationship(value: unknown): value is ConversationState["relationships"][number] {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.personId === "string"
    && typeof item.projectId === "string"
    && typeof item.confidence === "number"
    && item.evidence === "saved_row";
}

function normalizeState(value: unknown): ConversationState {
  const fallback = emptyConversationState();
  if (!value || typeof value !== "object") return fallback;
  const input = value as Record<string, unknown>;
  const people = Array.isArray(input.people)
    ? input.people.map((item) => validEntity(item, "person")).filter((item): item is ConversationEntity => Boolean(item))
    : [];
  const projects = Array.isArray(input.projects)
    ? input.projects.map((item) => validEntity(item, "project")).filter((item): item is ConversationEntity => Boolean(item))
    : [];
  const candidatePeople = Array.isArray(input.candidatePeople)
    ? input.candidatePeople.map((item) => validEntity(item, "person")).filter((item): item is ConversationEntity => Boolean(item))
    : [];
  const candidateProjects = Array.isArray(input.candidateProjects)
    ? input.candidateProjects.map((item) => validEntity(item, "project")).filter((item): item is ConversationEntity => Boolean(item))
    : [];
  const facts = Array.isArray(input.facts)
    ? input.facts.filter(validFact)
    : [];
  const preferences = Array.isArray(input.preferences)
    ? input.preferences.filter(validPreference)
    : [];
  const relationships = Array.isArray(input.relationships)
    ? input.relationships.filter(validRelationship)
    : [];
  const lastPerson = validEntity(input.lastPerson, "person") ?? undefined;
  const lastProject = validEntity(input.lastProject, "project") ?? undefined;
  const lastExpenseValue = input.lastExpense;
  const lastExpense = lastExpenseValue && typeof lastExpenseValue === "object"
    ? (() => {
        const expense = lastExpenseValue as Record<string, unknown>;
        return typeof expense.id === "string"
          && typeof expense.amountMinor === "number"
          && typeof expense.currency === "string"
          ? {
              id: expense.id,
              amountMinor: expense.amountMinor,
              currency: expense.currency,
              ...(typeof expense.description === "string" ? { description: expense.description } : {}),
              ...(typeof expense.personId === "string" ? { personId: expense.personId } : {}),
              ...(typeof expense.projectId === "string" ? { projectId: expense.projectId } : {}),
            }
          : undefined;
      })()
    : undefined;

  return {
    people: people.slice(-10),
    projects: projects.slice(-10),
    candidatePeople: candidatePeople.slice(-10),
    candidateProjects: candidateProjects.slice(-10),
    facts: facts.slice(-20),
    preferences: preferences.slice(-20),
    relationships: relationships.slice(-20),
    ...(lastPerson ? { lastPerson } : {}),
    ...(lastProject ? { lastProject } : {}),
    ...(lastExpense ? { lastExpense } : {}),
  };
}

function stripStateMarker(summary: string | null): string | null {
  if (!summary) return summary;
  return summary.split(STATE_MARKER, 1)[0] || null;
}

function stateFromSummary(summary: string | null): ConversationState {
  if (!summary || !summary.includes(STATE_MARKER)) return emptyConversationState();
  const encoded = summary.slice(summary.lastIndexOf(STATE_MARKER) + STATE_MARKER.length);
  try {
    return normalizeState(JSON.parse(encoded));
  } catch {
    return emptyConversationState();
  }
}

function stateFromTurns(turns: ConversationTurn[]): ConversationState {
  let state = emptyConversationState();
  for (const turn of turns) {
    const candidate = turn.action?.conversationState;
    if (candidate) state = normalizeState(candidate);
  }
  return state;
}

function compactExpenseRows(value: unknown) {
  if (!Array.isArray(value)) return { count: 0, totalByCurrency: {} };
  const totals = new Map<string, number>();
  const projects = new Set<string>();
  const people = new Set<string>();
  const ids: string[] = [];

  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const expense = "expense" in row && row.expense && typeof row.expense === "object"
      ? row.expense as Record<string, unknown>
      : row as Record<string, unknown>;
    const currency = typeof expense.currency === "string" ? expense.currency : "unknown";
    const amount = typeof expense.amountMinor === "number" ? expense.amountMinor : 0;
    totals.set(currency, (totals.get(currency) ?? 0) + amount);
    if (typeof expense.projectId === "string") projects.add(expense.projectId);
    if (typeof expense.personId === "string") people.add(expense.personId);
    if (typeof expense.id === "string" && ids.length < 8) ids.push(expense.id);
  }

  return {
    count: value.length,
    totalByCurrency: Object.fromEntries(totals),
    projectCount: projects.size,
    personCount: people.size,
    expenseIds: ids,
  };
}

function compactToolResult(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const result = value as Record<string, unknown>;
  const compact: Record<string, unknown> = {};

  if ("ok" in result) compact.ok = result.ok;
  if ("error" in result) compact.error = result.error;
  if ("needsClarification" in result) compact.needsClarification = result.needsClarification;
  if (Array.isArray(result.matches)) {
    compact.matches = result.matches.slice(0, 10).map((match) => {
      if (!match || typeof match !== "object") return match;
      const item = match as Record<string, unknown>;
      return {
        id: item.id,
        name: item.name,
        status: item.status,
        ordinal: item.ordinal,
      };
    });
  }
  if ("total" in result && result.total && typeof result.total === "object") {
    const total = result.total as Record<string, unknown>;
    compact.total = {
      amountMinor: total.amountMinor,
      count: total.count,
      currency: total.currency,
    };
  }
  if ("context" in result && result.context && typeof result.context === "object") {
    const context = result.context as Record<string, unknown>;
    compact.context = {
      asOf: context.asOf,
      reminderCount: Array.isArray(context.reminders) ? context.reminders.length : 0,
      expenseSummary: compactExpenseRows(context.expenses),
      projectCount: Array.isArray(context.projects) ? context.projects.length : 0,
      peopleCount: Array.isArray(context.people) ? context.people.length : 0,
      taskCount: Array.isArray(context.tasks) ? context.tasks.length : 0,
    };
  }
  if (Array.isArray(result.expenses)) {
    compact.expenseSummary = compactExpenseRows(result.expenses);
  }
  if ("expense" in result && result.expense && typeof result.expense === "object") {
    const expense = result.expense as Record<string, unknown>;
    compact.expense = {
      id: expense.id,
      amountMinor: expense.amountMinor,
      currency: expense.currency,
      description: expense.description,
      occurredAt: expense.occurredAt,
      createdAt: expense.createdAt,
      personId: expense.personId,
      projectId: expense.projectId,
    };
  }
  if ("person" in result && result.person && typeof result.person === "object") {
    const person = result.person as Record<string, unknown>;
    compact.person = { id: person.id, name: person.name };
  }
  if ("project" in result && result.project && typeof result.project === "object") {
    const project = result.project as Record<string, unknown>;
    compact.project = { id: project.id, name: project.name, status: project.status };
  }
  for (const key of ["task", "commitment", "reminder", "deletedExpense", "deletedPerson", "deletedProject", "deletedTask", "deletedCommitment", "deletedReminder"]) {
    if (key in result && result[key] && typeof result[key] === "object") {
      const item = result[key] as Record<string, unknown>;
      compact[key] = {
        id: item.id,
        name: item.name,
        title: item.title,
        text: item.text,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        amountMinor: item.amountMinor,
        currency: item.currency,
      };
    }
  }

  return Object.keys(compact).length > 0 ? compact : result;
}

export function updateConversationState(
  previous: ConversationState,
  toolName: string,
  rawResult: unknown,
): ConversationState {
  const state = normalizeState(previous);
  if (!rawResult || typeof rawResult !== "object") return state;
  const result = rawResult as Record<string, unknown>;
  const matches = Array.isArray(result.matches) ? result.matches : [];

  if (toolName === "find_person") {
    const candidates = matches
      .map((item, index) => {
        const entity = validEntity(
          item && typeof item === "object"
            ? { ...(item as Record<string, unknown>), ordinal: index + 1 }
            : item,
          "person",
        );
        return entity;
      })
      .filter((item): item is ConversationEntity => Boolean(item));
    state.candidatePeople = candidates;
    state.people = [...state.people, ...candidates].slice(-10);
    if (candidates.length === 1) state.lastPerson = candidates[0];
  }

  if (toolName === "find_project") {
    const candidates = matches
      .map((item, index) => {
        const entity = validEntity(
          item && typeof item === "object"
            ? { ...(item as Record<string, unknown>), ordinal: index + 1 }
            : item,
          "project",
        );
        return entity;
      })
      .filter((item): item is ConversationEntity => Boolean(item));
    state.candidateProjects = candidates;
    state.projects = [...state.projects, ...candidates].slice(-10);
    if (candidates.length === 1) state.lastProject = candidates[0];
  }

  for (const [key, type] of [["person", "person"], ["project", "project"]] as const) {
    const entity = validEntity(result[key], type);
    if (!entity) continue;
    if (type === "person") {
      state.people = [...state.people, entity].slice(-10);
      state.lastPerson = entity;
      state.candidatePeople = [];
    } else {
      state.projects = [...state.projects, entity].slice(-10);
      state.lastProject = entity;
      state.candidateProjects = [];
    }
  }

  const expenseValue = result.expense;
  if (expenseValue && typeof expenseValue === "object") {
    const expense = expenseValue as Record<string, unknown>;
    if (
      typeof expense.id === "string"
      && typeof expense.amountMinor === "number"
      && typeof expense.currency === "string"
    ) {
      state.lastExpense = {
        id: expense.id,
        amountMinor: expense.amountMinor,
        currency: expense.currency,
        ...(typeof expense.description === "string" ? { description: expense.description } : {}),
        ...(typeof expense.personId === "string" ? { personId: expense.personId } : {}),
        ...(typeof expense.projectId === "string" ? { projectId: expense.projectId } : {}),
      };
      const person = state.people.find((item) => item.id === expense.personId);
      const project = state.projects.find((item) => item.id === expense.projectId);
      if (person) state.lastPerson = person;
      if (project) state.lastProject = project;
      if (featureFlags.experimentalMemoryIntelligence()) {
        state.facts = [
          ...state.facts.filter((fact) => fact.key !== `expense:${expense.id}`),
          {
            key: `expense:${expense.id}`,
            value: `${expense.amountMinor} ${expense.currency}`,
            confidence: 1,
            evidence: "saved_row" as const,
          },
        ].slice(-20);
      }
    }
  }

  if (
    featureFlags.experimentalMemoryIntelligence()
    && (toolName === "link_person_to_project" || toolName === "update_person_project_relationship")
  ) {
    const relationshipValue = result.relationship;
    if (relationshipValue && typeof relationshipValue === "object") {
      const relationship = relationshipValue as Record<string, unknown>;
      if (typeof relationship.personId === "string" && typeof relationship.projectId === "string") {
        state.relationships = [
          ...state.relationships.filter((item) =>
            item.personId !== relationship.personId || item.projectId !== relationship.projectId),
          {
            personId: relationship.personId,
            projectId: relationship.projectId,
            ...(typeof relationship.relationship === "string"
              ? { relationship: relationship.relationship }
              : {}),
            confidence: 1,
            evidence: "saved_row" as const,
          },
        ].slice(-20);
      }
    }
  }

  if (toolName.startsWith("delete_") && result.deleted === true) {
    const deletedKey = Object.keys(result).find((key) => key.startsWith("deleted") && key !== "deleted");
    const deleted = deletedKey && result[deletedKey] && typeof result[deletedKey] === "object"
      ? result[deletedKey] as Record<string, unknown>
      : undefined;
    const deletedId = typeof deleted?.id === "string" ? deleted.id : undefined;
    if (deletedId) {
      if (toolName === "delete_expense") {
        if (state.lastExpense?.id === deletedId) state.lastExpense = undefined;
      }
      if (toolName === "delete_person") {
        state.people = state.people.filter((item) => item.id !== deletedId);
        state.candidatePeople = state.candidatePeople.filter((item) => item.id !== deletedId);
        if (state.lastPerson?.id === deletedId) state.lastPerson = undefined;
      }
      if (toolName === "delete_project") {
        state.projects = state.projects.filter((item) => item.id !== deletedId);
        state.candidateProjects = state.candidateProjects.filter((item) => item.id !== deletedId);
        if (state.lastProject?.id === deletedId) state.lastProject = undefined;
      }
    }
  }

  return normalizeState(state);
}

export function compactActionForMemory(action: Record<string, unknown> | undefined) {
  if (!action) return undefined;
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(action)) {
    if (key === "toolResult") {
      compact[key] = compactToolResult(value);
      continue;
    }
    if (typeof value === "string") {
      compact[key] = value.length > MEMORY_VALUE_MAX_CHARS
        ? `${value.slice(0, MEMORY_VALUE_MAX_CHARS - 1)}…`
        : value;
      continue;
    }
    if (Array.isArray(value)) {
      compact[key] = value.slice(0, 10);
      continue;
    }
    compact[key] = value;
  }
  return compact;
}

function ownershipWhere(identity: Identity, conversationId: string) {
  return and(
    eq(conversationMemoryTable.tenantId, identity.tenantId),
    eq(conversationMemoryTable.ownerUserId, identity.userId),
    eq(conversationMemoryTable.conversationId, conversationId),
  );
}

function parseTurns(value: string): ConversationTurn[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((turn): turn is ConversationTurn =>
      turn && typeof turn === "object"
      && typeof turn.userMessage === "string"
      && typeof turn.assistantMessage === "string"
      && typeof turn.createdAt === "string",
    );
  } catch {
    return [];
  }
}

function turnLine(turn: ConversationTurn): string {
  const action = turn.action
    ? ` | نتيجة: ${JSON.stringify(compactActionForMemory(turn.action))}`
    : "";
  return `المستخدم: ${turn.userMessage}\nالمساعد: ${turn.assistantMessage}${action}`;
}

function appendSummary(
  existing: string | null,
  turnsToCompress: ConversationTurn[],
): string | null {
  if (turnsToCompress.length === 0) return existing;
  const additions = turnsToCompress.map(turnLine).join("\n");
  const combined = [existing, additions].filter(Boolean).join("\n");
  if (!combined) return null;
  return combined.length <= SUMMARY_MAX_CHARS
    ? combined
    : `...${combined.slice(-(SUMMARY_MAX_CHARS - 3))}`;
}

export async function loadConversationMemory(
  identity: Identity,
  conversationId: string,
): Promise<ConversationMemorySnapshot> {
  const [record] = await db.select().from(conversationMemoryTable).where(
    ownershipWhere(identity, conversationId),
  ).limit(1);
  if (!record) {
    return {
      conversationId,
      recentTurns: [],
      summary: null,
      turnCount: 0,
      state: emptyConversationState(),
    };
  }
  const recentTurns = parseTurns(record.recentStateJson);
  const summaryState = stateFromSummary(record.summary);
  return {
    conversationId,
    recentTurns,
    summary: stripStateMarker(record.summary),
    turnCount: Number(record.turnCount),
    state: record.summary?.includes(STATE_MARKER)
      ? summaryState
      : stateFromTurns(recentTurns),
  };
}

export async function saveConversationTurn(
  identity: Identity,
  snapshot: ConversationMemorySnapshot,
  turn: Omit<ConversationTurn, "createdAt">,
): Promise<ConversationMemorySnapshot> {
  const createdAt = new Date().toISOString();
  const expandedTurns = [
    ...snapshot.recentTurns,
    { ...turn, action: compactActionForMemory(turn.action), createdAt },
  ];
  const nextState = normalizeState(
    turn.action?.conversationState
      ?? snapshot.state
      ?? stateFromTurns(expandedTurns),
  );
  const turnCount = snapshot.turnCount + 1;
  const shouldSummarize = expandedTurns.length > RECENT_CONVERSATION_TURNS
    || turnCount >= SUMMARY_TRIGGER_TURNS;
  const turnsToCompress = shouldSummarize
    ? expandedTurns.slice(0, Math.max(0, expandedTurns.length - RECENT_CONVERSATION_TURNS))
    : [];
  const next: ConversationMemorySnapshot = {
    conversationId: snapshot.conversationId,
    recentTurns: expandedTurns.slice(-RECENT_CONVERSATION_TURNS),
    summary: (() => {
      const summary = appendSummary(stripStateMarker(snapshot.summary), turnsToCompress);
      return summary
        ? `${summary}${STATE_MARKER}${JSON.stringify(nextState)}`
        : STATE_MARKER + JSON.stringify(nextState);
    })(),
    turnCount,
    state: nextState,
  };

  await db.insert(conversationMemoryTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    conversationId: next.conversationId,
    recentStateJson: JSON.stringify(next.recentTurns),
    summary: next.summary,
    turnCount: next.turnCount,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [
      conversationMemoryTable.tenantId,
      conversationMemoryTable.ownerUserId,
      conversationMemoryTable.conversationId,
    ],
    set: {
      recentStateJson: JSON.stringify(next.recentTurns),
      summary: next.summary,
      turnCount: next.turnCount,
      updatedAt: new Date(),
    },
  });
  return next;
}

export function conversationContextMessages(
  snapshot: ConversationMemorySnapshot,
): Array<{ role: "system" | "user" | "assistant"; text: string }> {
  const context: Array<{ role: "system" | "user" | "assistant"; text: string }> = [];
  const state = featureFlags.experimentalMemoryIntelligence()
    ? snapshot.state
    : {
        ...snapshot.state,
        facts: [],
        preferences: [],
        relationships: [],
      };
  if (snapshot.summary) {
    context.push({
      role: "system",
      text: `[ملخص محادثة سابق، ليس مصدرًا قانونيًا للبيانات]\n${stripStateMarker(snapshot.summary)}`,
    });
  }
  if (
    state.people.length > 0
    || state.projects.length > 0
    || state.candidatePeople.length > 0
    || state.candidateProjects.length > 0
    || state.lastPerson
    || state.lastProject
    || state.lastExpense
    || state.facts.length > 0
    || state.preferences.length > 0
    || state.relationships.length > 0
  ) {
    context.push({
      role: "system",
      text: `[حالة المحادثة المنظمة، استخدمها لفهم الإشارات فقط ثم تحقق من Structured Memory بالأدوات]\n${JSON.stringify(state)}`,
    });
  }
  for (const turn of snapshot.recentTurns) {
    context.push({ role: "user", text: turn.userMessage });
    context.push({
      role: "assistant",
      text: turn.action
        ? `${turn.assistantMessage}\n[نتيجة التنفيذ: ${JSON.stringify(turn.action)}]`
        : turn.assistantMessage,
    });
  }
  return context;
}