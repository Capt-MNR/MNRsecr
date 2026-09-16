import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import {
  conversationMemoryTable,
  db,
  learningSignalReviewsTable,
} from "@workspace/db";
import {
  GetConversationResponse,
  ListLearningSignalsResponse,
  ListConversationsResponse,
  ReviewLearningSignalBody,
  ReviewLearningSignalResponse,
} from "@workspace/api-zod";
import {
  loadConversationMemory,
  type ConversationTurn,
} from "../lib/conversation-memory";
import type { Identity } from "../lib/secretary";
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
const signalStatuses = new Set([
  "pending_review",
  "approved",
  "rejected",
  "needs_context",
]);
type LearningSignalStatus = "pending_review" | "approved" | "rejected" | "needs_context";

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

async function listLearningSignals(identity: Identity) {
  const [memoryRows, reviewRows] = await Promise.all([
    db.select().from(conversationMemoryTable).where(and(
      eq(conversationMemoryTable.tenantId, identity.tenantId),
      eq(conversationMemoryTable.ownerUserId, identity.userId),
    )).orderBy(desc(conversationMemoryTable.updatedAt)).limit(100),
    db.select().from(learningSignalReviewsTable).where(and(
      eq(learningSignalReviewsTable.tenantId, identity.tenantId),
      eq(learningSignalReviewsTable.ownerUserId, identity.userId),
    )),
  ]);
  const reviews = new Map(reviewRows.map((review) => [review.signalId, review]));
  return memoryRows.flatMap((row) => {
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
      if (!signal) return [];
      const review = reviews.get(signal.signalId);
      const status = review && signalStatuses.has(review.status)
        ? review.status as LearningSignalStatus
        : signal.status;
      return [{ ...signal, status }];
    });
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 100);
}

async function findLearningSignal(
  identity: Identity,
  signalId: string,
) {
  const signals = await listLearningSignals(identity);
  return signals.find((signal) => signal.signalId === signalId) ?? null;
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
    const signals = await listLearningSignals(identity);
    res.json(ListLearningSignalsResponse.parse({ signals }));
  } catch (error) {
    req.log.error({ error }, "Learning signals read failed");
    sendRouteError(req, res, 500, "تعذر تحميل إشارات التصحيح.", "LEARNING_SIGNALS_READ_FAILED");
  }
});

router.post("/learning/signals/:signalId/review", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const parsed = ReviewLearningSignalBody.safeParse(req.body);
  if (!parsed.success) {
    sendRouteError(req, res, 400, "بيانات مراجعة الإشارة غير صحيحة.", "INVALID_LEARNING_SIGNAL_REVIEW");
    return;
  }

  try {
    const signal = await findLearningSignal(identity, req.params.signalId);
    if (!signal) {
      sendRouteError(req, res, 404, "إشارة التصحيح غير موجودة.", "LEARNING_SIGNAL_NOT_FOUND");
      return;
    }
    const now = new Date();
    await db.insert(learningSignalReviewsTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      signalId: signal.signalId,
      conversationId: signal.conversationId,
      turnId: signal.turnId,
      category: signal.category,
      confidenceBps: Math.round(signal.confidence * 10_000),
      status: parsed.data.status,
      reviewerNote: parsed.data.note ?? null,
      benchmarkPayload: {
        signalId: signal.signalId,
        conversationId: signal.conversationId,
        conversationTitle: signal.conversationTitle,
        turnId: signal.turnId,
        previousTurnId: signal.previousTurnId,
        category: signal.category,
        confidence: signal.confidence,
        userMessage: signal.userMessage,
        assistantMessage: signal.assistantMessage,
        previousUserMessage: signal.previousUserMessage,
        previousAssistantMessage: signal.previousAssistantMessage,
        previousActionType: signal.previousActionType,
        createdAt: signal.createdAt,
      },
      reviewedAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        learningSignalReviewsTable.tenantId,
        learningSignalReviewsTable.ownerUserId,
        learningSignalReviewsTable.signalId,
      ],
      set: {
        conversationId: signal.conversationId,
        turnId: signal.turnId,
        category: signal.category,
        confidenceBps: Math.round(signal.confidence * 10_000),
        status: parsed.data.status,
        reviewerNote: parsed.data.note ?? null,
        benchmarkPayload: {
          signalId: signal.signalId,
          conversationId: signal.conversationId,
          conversationTitle: signal.conversationTitle,
          turnId: signal.turnId,
          previousTurnId: signal.previousTurnId,
          category: signal.category,
          confidence: signal.confidence,
          userMessage: signal.userMessage,
          assistantMessage: signal.assistantMessage,
          previousUserMessage: signal.previousUserMessage,
          previousAssistantMessage: signal.previousAssistantMessage,
          previousActionType: signal.previousActionType,
          createdAt: signal.createdAt,
        },
        reviewedAt: now,
        updatedAt: now,
      },
    });
    res.json(ReviewLearningSignalResponse.parse({
      signalId: signal.signalId,
      status: parsed.data.status,
      benchmarkReady: parsed.data.status === "approved",
    }));
  } catch (error) {
    req.log.error({ error }, "Learning signal review failed");
    sendRouteError(req, res, 500, "تعذر حفظ مراجعة الإشارة.", "LEARNING_SIGNAL_REVIEW_FAILED");
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