import { and, eq, lte } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  commitmentsTable,
  db,
  proactivePreferencesTable,
  proactiveSuppressionsTable,
  tasksTable,
} from "@workspace/db";
import { requireIdentity, sendRouteError } from "./route-context";

const router: IRouter = Router();

const preferencePatchSchema = z.object({
  activity: z.enum(["focused", "balanced", "quiet"]).nullable().optional(),
  proactive: z.enum(["low", "balanced", "high"]).nullable().optional(),
  intelligence: z.enum(["fast", "balanced", "deep"]).nullable().optional(),
  communicationStyle: z.enum(["formal", "friendly", "concise", "balanced"]).nullable().optional(),
  language: z.enum(["ar", "en"]).nullable().optional(),
  repeatReminders: z.boolean().nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one preference is required.");

const suppressionSchema = z.object({
  entityType: z.enum(["task", "commitment"]),
  entityId: z.string().uuid(),
  sourceConversationId: z.string().nullable().optional(),
  sourceTurnId: z.string().nullable().optional(),
}).strict();

type PreferenceRow = typeof proactivePreferencesTable.$inferSelect;

function toPreferences(row?: PreferenceRow) {
  const explicitFields = [
    ["activity", row?.activity],
    ["proactive", row?.proactive],
    ["intelligence", row?.intelligence],
    ["communicationStyle", row?.communicationStyle],
    ["language", row?.language],
    ["repeatReminders", row?.repeatReminders],
  ].filter(([, value]) => value !== null && value !== undefined).map(([key]) => key as string);

  return {
    activity: row?.activity ?? "balanced",
    proactive: row?.proactive ?? "balanced",
    intelligence: row?.intelligence ?? "balanced",
    communicationStyle: row?.communicationStyle ?? "balanced",
    language: row?.language ?? "ar",
    repeatReminders: row?.repeatReminders ?? false,
    explicitFields,
  };
}

async function readPreferences(identity: { tenantId: string; userId: string }) {
  const [row] = await db.select().from(proactivePreferencesTable).where(and(
    eq(proactivePreferencesTable.tenantId, identity.tenantId),
    eq(proactivePreferencesTable.ownerUserId, identity.userId),
  )).limit(1);
  return toPreferences(row);
}

router.get("/proactive-preferences", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  try {
    res.json(await readPreferences(identity));
  } catch (error) {
    sendRouteError(req, res, 500, error instanceof Error ? error.message : "تعذر تحميل التفضيلات.", "PROACTIVE_PREFERENCES_READ_FAILED");
  }
});

router.patch("/proactive-preferences", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const parsed = preferencePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    sendRouteError(req, res, 400, "قيمة تفضيل واحدة أو أكثر غير صالحة.", "INVALID_PROACTIVE_PREFERENCES");
    return;
  }
  try {
    const now = new Date();
    const set: Partial<typeof proactivePreferencesTable.$inferInsert> = { updatedAt: now };
    for (const key of Object.keys(parsed.data) as (keyof typeof parsed.data)[]) {
      (set as Record<string, unknown>)[key] = parsed.data[key];
    }
    await db.insert(proactivePreferencesTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      ...set,
    }).onConflictDoUpdate({
      target: [proactivePreferencesTable.tenantId, proactivePreferencesTable.ownerUserId],
      set,
    });
    res.json(await readPreferences(identity));
  } catch (error) {
    sendRouteError(req, res, 500, error instanceof Error ? error.message : "تعذر حفظ التفضيلات.", "PROACTIVE_PREFERENCES_WRITE_FAILED");
  }
});

router.post("/proactive-suppressions", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const parsed = suppressionSchema.safeParse(req.body);
  if (!parsed.success) {
    sendRouteError(req, res, 400, "بيانات إيقاف التنبيه المؤقت غير صالحة.", "INVALID_PROACTIVE_SUPPRESSION");
    return;
  }

  try {
    const { entityType, entityId } = parsed.data;
    const record = entityType === "task"
      ? (await db.select({
        id: tasksTable.id,
        status: tasksTable.status,
        rowVersion: tasksTable.rowVersion,
      }).from(tasksTable).where(and(
        eq(tasksTable.tenantId, identity.tenantId),
        eq(tasksTable.ownerUserId, identity.userId),
        eq(tasksTable.id, entityId),
      )).limit(1))[0]
      : (await db.select({
        id: commitmentsTable.id,
        status: commitmentsTable.status,
        rowVersion: commitmentsTable.rowVersion,
      }).from(commitmentsTable).where(and(
        eq(commitmentsTable.tenantId, identity.tenantId),
        eq(commitmentsTable.ownerUserId, identity.userId),
        eq(commitmentsTable.id, entityId),
      )).limit(1))[0];

    if (!record) {
      sendRouteError(req, res, 404, "السجل غير متاح لهذا الحساب.", "PROACTIVE_SUPPRESSION_RECORD_NOT_FOUND");
      return;
    }
    const activeStatuses = entityType === "task"
      ? new Set(["pending", "in_progress"])
      : new Set(["open", "active", "in_progress", "pending"]);
    if (!activeStatuses.has(record.status)) {
      sendRouteError(req, res, 409, "لا يمكن إيقاف تنبيه سجل مكتمل أو ملغى.", "PROACTIVE_SUPPRESSION_RECORD_INACTIVE");
      return;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await db.delete(proactiveSuppressionsTable).where(and(
      eq(proactiveSuppressionsTable.tenantId, identity.tenantId),
      eq(proactiveSuppressionsTable.ownerUserId, identity.userId),
      lte(proactiveSuppressionsTable.expiresAt, now),
    ));
    await db.insert(proactiveSuppressionsTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      entityType,
      entityId,
      contextVersion: record.rowVersion,
      reason: "user_tracking_acknowledgement",
      sourceConversationId: parsed.data.sourceConversationId ?? null,
      sourceTurnId: parsed.data.sourceTurnId ?? null,
      expiresAt,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        proactiveSuppressionsTable.tenantId,
        proactiveSuppressionsTable.ownerUserId,
        proactiveSuppressionsTable.entityType,
        proactiveSuppressionsTable.entityId,
        proactiveSuppressionsTable.contextVersion,
      ],
      set: {
        reason: "user_tracking_acknowledgement",
        sourceConversationId: parsed.data.sourceConversationId ?? null,
        sourceTurnId: parsed.data.sourceTurnId ?? null,
        expiresAt,
        updatedAt: now,
      },
    });
    res.status(201).json({ suppressed: true, entityType, entityId, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    sendRouteError(req, res, 500, error instanceof Error ? error.message : "تعذر إيقاف التنبيه مؤقتًا.", "PROACTIVE_SUPPRESSION_WRITE_FAILED");
  }
});

export default router;