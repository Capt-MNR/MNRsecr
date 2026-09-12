import { and, eq } from "drizzle-orm";
import { conversationMemoryTable, db } from "@workspace/db";
import type { Identity } from "./secretary";

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
};

export const RECENT_CONVERSATION_TURNS = 6;
export const SUMMARY_TRIGGER_TURNS = 7;
const SUMMARY_MAX_CHARS = 5000;
const MEMORY_VALUE_MAX_CHARS = 320;

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

  return Object.keys(compact).length > 0 ? compact : result;
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
    return { conversationId, recentTurns: [], summary: null, turnCount: 0 };
  }
  return {
    conversationId,
    recentTurns: parseTurns(record.recentStateJson),
    summary: record.summary,
    turnCount: Number(record.turnCount),
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
  const turnCount = snapshot.turnCount + 1;
  const shouldSummarize = expandedTurns.length > RECENT_CONVERSATION_TURNS
    || turnCount >= SUMMARY_TRIGGER_TURNS;
  const turnsToCompress = shouldSummarize
    ? expandedTurns.slice(0, Math.max(0, expandedTurns.length - RECENT_CONVERSATION_TURNS))
    : [];
  const next: ConversationMemorySnapshot = {
    conversationId: snapshot.conversationId,
    recentTurns: expandedTurns.slice(-RECENT_CONVERSATION_TURNS),
    summary: appendSummary(snapshot.summary, turnsToCompress),
    turnCount,
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
): Array<{ role: "user" | "assistant"; text: string }> {
  const context: Array<{ role: "user" | "assistant"; text: string }> = [];
  if (snapshot.summary) {
    context.push({
      role: "user",
      text: `[ملخص محادثة سابق، ليس مصدرًا قانونيًا للبيانات:\n${snapshot.summary}]`,
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