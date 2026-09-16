import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { conversationMemoryTable, db } from "@workspace/db";
import {
  GetConversationResponse,
  ListLearningSignalsResponse,
  ListConversationsResponse,
} from "@workspace/api-zod";
import {
  loadConversationMemory,
  type ConversationTurn,
} from "../lib/conversation-memory";
import {
  requireIdentity,
  sendRouteError,
} from "./route-context";

const router: IRouter = Router();

function parseStoredTurns(value: string): ConversationTurn[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((turn): turn is ConversationTurn =>
      Boolean(turn)
      && typeof turn === "object"
      && typeof (turn as Record<string, unknown>).userMessage === "string"
      && typeof (turn as Record<string, unknown>).assistantMessage === "string"
      && typeof (turn as Record<string, unknown>).createdAt === "string",
    ) : [];
  } catch {
    return [];
  }
}

function cleanTitle(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > 72 ? `${oneLine.slice(0, 69)}…` : oneLine;
}

const signalCategories = new Set([
  "amount",
  "date_time",
  "person",
  "project",
  "intent",
  "general",
]);

function learningSignalFromTurn(
  conversationId: string,
  conversationTitle: string,
  turn: ConversationTurn,
  previousTurn: ConversationTurn | undefined,
) {
  const raw = turn.action?.learningSignal;
  if (!raw || typeof raw !== "object") return null;
  const signal = raw as Record<string, unknown>;
  if (
    signal.kind !== "explicit_correction"
    || signal.reviewOnly !== true
    || signal.autoApply !== false
    || typeof signal.category !== "string"
    || !signalCategories.has(signal.category)
    || typeof signal.confidence !== "number"
  ) return null;
  return {
    signalId: `${conversationId}:${turn.turnId ?? turn.createdAt}`,
    conversationId,
    conversationTitle,
    turnId: turn.turnId ?? null,
    previousTurnId: typeof signal.previousTurnId === "string"
      ? signal.previousTurnId
      : previousTurn?.turnId ?? null,
    category: signal.category as "amount" | "date_time" | "person" | "project" | "intent" | "general",
    confidence: Math.min(1, Math.max(0, signal.confidence)),
    status: "pending_review" as const,
    userMessage: turn.userMessage,
    assistantMessage: turn.assistantMessage,
    previousUserMessage: previousTurn?.userMessage ?? null,
    previousAssistantMessage: previousTurn?.assistantMessage ?? null,
    previousActionType: typeof signal.previousActionType === "string"
      ? signal.previousActionType
      : null,
    createdAt: turn.createdAt,
  };
}

function conversationPresentation(
  conversationId: string,
  recentStateJson: string,
  summary: string | null,
  updatedAt: Date,
  turnCount: number,
) {
  const turns = parseStoredTurns(recentStateJson);
  const firstUserMessage = turns.find((turn) => turn.userMessage.trim())?.userMessage;
  const lastTurn = turns.at(-1);
  const title = cleanTitle(firstUserMessage ?? summary?.split("\n")[0] ?? "محادثة جديدة");
  const preview = cleanTitle(lastTurn?.assistantMessage ?? firstUserMessage ?? "لا توجد رسائل بعد");
  return {
    conversationId,
    title,
    preview,
    lastActivityAt: updatedAt.toISOString(),
    turnCount,
  };
}

router.get("/conversations", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

  try {
    const rows = await db.select().from(conversationMemoryTable).where(and(
      eq(conversationMemoryTable.tenantId, identity.tenantId),
      eq(conversationMemoryTable.ownerUserId, identity.userId),
      search
        ? or(
          ilike(conversationMemoryTable.recentStateJson, `%${search}%`),
          ilike(conversationMemoryTable.summary, `%${search}%`),
          ilike(conversationMemoryTable.conversationId, `%${search}%`),
        )
        : undefined,
    )).orderBy(desc(conversationMemoryTable.updatedAt)).limit(100);
    res.json(ListConversationsResponse.parse({
      conversations: rows.map((row) => conversationPresentation(
        row.conversationId,
        row.recentStateJson,
        row.summary,
        row.updatedAt,
        Number(row.turnCount),
      )),
    }));
  } catch (error) {
    req.log.error({ error }, "Conversation list failed");
    sendRouteError(req, res, 500, "تعذر تحميل المحادثات.", "CONVERSATIONS_READ_FAILED");
  }
});

router.get("/learning/signals", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;

  try {
    const rows = await db.select().from(conversationMemoryTable).where(and(
      eq(conversationMemoryTable.tenantId, identity.tenantId),
      eq(conversationMemoryTable.ownerUserId, identity.userId),
    )).orderBy(desc(conversationMemoryTable.updatedAt)).limit(100);
    const signals = rows.flatMap((row) => {
      const turns = parseStoredTurns(row.recentStateJson);
      const title = conversationPresentation(
        row.conversationId,
        row.recentStateJson,
        row.summary,
        row.updatedAt,
        Number(row.turnCount),
      ).title;
      return turns.flatMap((turn, index) => {
        const signal = learningSignalFromTurn(row.conversationId, title, turn, turns[index - 1]);
        return signal ? [signal] : [];
      });
    }).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 100);
    res.json(ListLearningSignalsResponse.parse({ signals }));
  } catch (error) {
    req.log.error({ error }, "Learning signals read failed");
    sendRouteError(req, res, 500, "تعذر تحميل إشارات التصحيح.", "LEARNING_SIGNALS_READ_FAILED");
  }
});

router.get("/conversations/:conversationId", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;

  try {
    const [row] = await db.select().from(conversationMemoryTable).where(and(
      eq(conversationMemoryTable.tenantId, identity.tenantId),
      eq(conversationMemoryTable.ownerUserId, identity.userId),
      eq(conversationMemoryTable.conversationId, req.params.conversationId),
    )).limit(1);
    if (!row) {
      sendRouteError(req, res, 404, "المحادثة غير موجودة.", "CONVERSATION_NOT_FOUND");
      return;
    }
    const presentation = conversationPresentation(
      row.conversationId,
      row.recentStateJson,
      row.summary,
      row.updatedAt,
      Number(row.turnCount),
    );
    const memory = await loadConversationMemory(identity, row.conversationId);
    res.json(GetConversationResponse.parse({
      ...presentation,
      recentTurns: memory.recentTurns,
      summary: memory.summary,
      state: memory.state,
    }));
  } catch (error) {
    req.log.error({ error }, "Conversation load failed");
    sendRouteError(req, res, 500, "تعذر تحميل المحادثة.", "CONVERSATION_READ_FAILED");
  }
});

export default router;