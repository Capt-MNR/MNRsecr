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
  const action = turn.action ? ` | نتيجة: ${JSON.stringify(turn.action)}` : "";
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
    { ...turn, createdAt },
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