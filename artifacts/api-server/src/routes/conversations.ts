import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { conversationMemoryTable, db } from "@workspace/db";
import {
  GetConversationResponse,
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