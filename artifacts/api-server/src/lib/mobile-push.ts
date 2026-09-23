import { randomUUID } from "node:crypto";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  mobilePushTokensTable,
  notificationDeliveryAttemptsTable,
  notificationDeliveriesTable,
  notificationOutboxTable,
  type MobilePushToken,
} from "@workspace/db";
import type { Identity } from "./secretary";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const REQUEST_TIMEOUT_MS = 10_000;
const DELIVERY_LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const MAX_BATCH = 50;

export type MobilePushNotification = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  categoryIdentifier?: string;
  dedupeKey?: string;
  workId?: string | null;
  runId?: string | null;
  sourceEventId?: string | null;
  operationId?: string | null;
};

export type NotificationDbExecutor = Pick<typeof db, "select" | "insert" | "update">;

export type NotificationEnqueueResult = {
  id: string;
  created: boolean;
};

export type ExpoFailureClass = "transient" | "permanent" | "unknown";

export function classifyExpoFailure(input: {
  httpStatus?: number;
  error?: string | null;
}): ExpoFailureClass {
  const error = input.error?.trim() ?? "";
  if (error === "DeviceNotRegistered" || error === "MessageTooBig" || error === "InvalidCredentials"
    || error === "MismatchSenderId" || error === "InvalidProviderToken") {
    return "permanent";
  }
  if (input.httpStatus === 408 || input.httpStatus === 425 || input.httpStatus === 429
    || (input.httpStatus !== undefined && input.httpStatus >= 500)) {
    return "unknown";
  }
  if (input.httpStatus !== undefined && input.httpStatus >= 400) return "permanent";
  return "unknown";
}

export function notificationBackoffMs(attemptNumber: number): number {
  const attempt = Math.max(1, Math.floor(attemptNumber));
  return Math.min(15 * 60_000, 5_000 * (2 ** (attempt - 1)));
}

function boundedError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message.slice(0, 500);
}

function ownerWhere(identity: Identity, table: {
  tenantId: typeof notificationOutboxTable.tenantId;
  ownerUserId: typeof notificationOutboxTable.ownerUserId;
}) {
  return and(
    eq(table.tenantId, identity.tenantId),
    eq(table.ownerUserId, identity.userId),
  );
}

function defaultDedupeKey(notification: MobilePushNotification): string {
  return notification.dedupeKey
    ?? `push:${notification.title}:${notification.body}:${JSON.stringify(notification.data ?? {})}`;
}

/**
 * Inserts the logical notification and a snapshot of the currently enabled
 * devices. This function accepts a transaction executor so Agent Work can
 * commit its run and its outbox row atomically.
 */
export async function enqueueMobilePushOutbox(
  executor: NotificationDbExecutor,
  identity: Identity,
  notification: MobilePushNotification,
): Promise<NotificationEnqueueResult> {
  const dedupeKey = defaultDedupeKey(notification);
  const existing = await executor.select().from(notificationOutboxTable).where(and(
    ownerWhere(identity, notificationOutboxTable),
    eq(notificationOutboxTable.dedupeKey, dedupeKey),
  )).limit(1);
  if (existing[0]) return { id: existing[0].id, created: false };

  const [created] = await executor.insert(notificationOutboxTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    workId: notification.workId ?? null,
    runId: notification.runId ?? null,
    sourceEventId: notification.sourceEventId ?? null,
    operationId: notification.operationId ?? null,
    dedupeKey,
    title: notification.title,
    body: notification.body,
    data: {
      ...(notification.data ?? {}),
      ...(notification.categoryIdentifier ? { categoryIdentifier: notification.categoryIdentifier } : {}),
    },
  }).onConflictDoNothing().returning();

  if (!created) {
    const [raced] = await executor.select().from(notificationOutboxTable).where(and(
      ownerWhere(identity, notificationOutboxTable),
      eq(notificationOutboxTable.dedupeKey, dedupeKey),
    )).limit(1);
    if (!raced) throw new Error("NOTIFICATION_OUTBOX_RESERVATION_FAILED");
    return { id: raced.id, created: false };
  }

  const tokens = await executor.select().from(mobilePushTokensTable).where(and(
    eq(mobilePushTokensTable.tenantId, identity.tenantId),
    eq(mobilePushTokensTable.ownerUserId, identity.userId),
    eq(mobilePushTokensTable.enabled, 1),
  ));
  if (tokens.length > 0) {
    await executor.insert(notificationDeliveriesTable).values(tokens.map((token) => ({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      notificationId: created.id,
      tokenId: token.id,
      provider: token.provider,
    }))).onConflictDoNothing();
  }
  return { id: created.id, created: true };
}

export async function registerMobilePushToken(
  identity: Identity,
  input: {
    token: string;
    provider: "expo" | "fcm" | "apns";
    platform: "android" | "ios";
    appId: string;
    deviceId?: string | null;
  },
): Promise<MobilePushToken> {
  return db.transaction(async (tx) => {
    const updateExisting = async (existing: MobilePushToken): Promise<MobilePushToken> => {
      const sameOwner = existing.tenantId === identity.tenantId
        && existing.ownerUserId === identity.userId;
      const controlledHandoff = existing.enabled === 0
        && existing.disabledReason === "unregistered";
      if (!sameOwner && !controlledHandoff) {
        throw new Error("PUSH_TOKEN_OWNERSHIP_CONFLICT");
      }
      const [updated] = await tx.update(mobilePushTokensTable)
        .set({
          tenantId: identity.tenantId,
          ownerUserId: identity.userId,
          provider: input.provider,
          platform: input.platform,
          appId: input.appId,
          deviceId: input.deviceId ?? null,
          enabled: 1,
          disabledReason: null,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(mobilePushTokensTable.id, existing.id))
        .returning();
      if (!updated) throw new Error("PUSH_TOKEN_REGISTRATION_FAILED");
      return updated;
    };

    const [existing] = await tx.select().from(mobilePushTokensTable).where(
      eq(mobilePushTokensTable.token, input.token),
    ).for("update");

    if (existing) return updateExisting(existing);

    const [created] = await tx.insert(mobilePushTokensTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      token: input.token,
      provider: input.provider,
      platform: input.platform,
      appId: input.appId,
      deviceId: input.deviceId ?? null,
    }).onConflictDoNothing({
      target: mobilePushTokensTable.token,
    }).returning();
    if (created) return created;

    const [raced] = await tx.select().from(mobilePushTokensTable).where(
      eq(mobilePushTokensTable.token, input.token),
    ).for("update");
    if (!raced) throw new Error("PUSH_TOKEN_REGISTRATION_FAILED");
    return updateExisting(raced);
  });
}

export async function disableMobilePushToken(identity: Identity, token: string): Promise<boolean> {
  const result = await db.update(mobilePushTokensTable)
    .set({ enabled: 0, disabledReason: "unregistered", updatedAt: new Date() })
    .where(and(
      eq(mobilePushTokensTable.tenantId, identity.tenantId),
      eq(mobilePushTokensTable.ownerUserId, identity.userId),
      eq(mobilePushTokensTable.token, token),
    ));
  return (result.rowCount ?? 0) > 0;
}

async function disableInvalidToken(tokenId: string): Promise<void> {
  await db.update(mobilePushTokensTable)
    .set({ enabled: 0, disabledReason: "provider_invalid", updatedAt: new Date() })
    .where(eq(mobilePushTokensTable.id, tokenId));
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function expoData(payload: Record<string, unknown>): Record<string, unknown> {
  const data = payload.data;
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}

function expoError(payload: Record<string, unknown>): string | null {
  const data = expoData(payload);
  const details = data.details;
  if (details && typeof details === "object" && typeof (details as Record<string, unknown>).error === "string") {
    return (details as Record<string, unknown>).error as string;
  }
  return typeof data.message === "string" ? data.message : null;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function claimDelivery(id: string, now: Date) {
  const leaseToken = randomUUID();
  const [claimed] = await db.update(notificationDeliveriesTable).set({
    status: "dispatching",
    leaseToken,
    leaseExpiresAt: new Date(now.getTime() + DELIVERY_LEASE_MS),
    updatedAt: now,
  }).where(and(
    eq(notificationDeliveriesTable.id, id),
    or(
      and(
        or(eq(notificationDeliveriesTable.status, "queued"), eq(notificationDeliveriesTable.status, "unknown")),
        lte(notificationDeliveriesTable.nextAttemptAt, now),
      ),
      and(
        eq(notificationDeliveriesTable.status, "dispatching"),
        or(isNull(notificationDeliveriesTable.leaseExpiresAt), lte(notificationDeliveriesTable.leaseExpiresAt, now)),
      ),
    ),
  )).returning();
  return claimed ? { ...claimed, leaseToken } : null;
}

async function finishDelivery(
  deliveryId: string,
  leaseToken: string,
  attemptNumber: number,
  result: {
    status: "submitted" | "confirmed" | "failed" | "unknown";
    providerTicket?: string | null;
    errorClass?: string | null;
    error?: string | null;
    nextAttemptAt?: Date;
  },
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(notificationDeliveryAttemptsTable).set({
      status: result.status,
      providerRequestId: result.providerTicket ?? null,
      errorClass: result.errorClass ?? null,
      error: result.error ?? null,
      completedAt: now,
    }).where(and(
      eq(notificationDeliveryAttemptsTable.deliveryId, deliveryId),
      eq(notificationDeliveryAttemptsTable.attemptNumber, attemptNumber),
    ));
    await tx.update(notificationDeliveriesTable).set({
      status: result.status,
      attemptCount: attemptNumber,
      leaseToken: null,
      leaseExpiresAt: null,
      providerTicket: result.providerTicket ?? null,
      lastErrorClass: result.errorClass ?? null,
      lastError: result.error ?? null,
      nextAttemptAt: result.nextAttemptAt ?? now,
      ...(result.status === "submitted" ? { submittedAt: now } : {}),
      ...(result.status === "confirmed" ? { confirmedAt: now } : {}),
      updatedAt: now,
    }).where(and(
      eq(notificationDeliveriesTable.id, deliveryId),
      eq(notificationDeliveriesTable.leaseToken, leaseToken),
    ));
  });
}

async function sendDelivery(
  delivery: typeof notificationDeliveriesTable.$inferSelect,
  token: typeof mobilePushTokensTable.$inferSelect,
  outbox: typeof notificationOutboxTable.$inferSelect,
): Promise<void> {
  const attemptNumber = delivery.attemptCount + 1;
  await db.insert(notificationDeliveryAttemptsTable).values({
    tenantId: delivery.tenantId,
    ownerUserId: delivery.ownerUserId,
    deliveryId: delivery.id,
    attemptNumber,
    status: "dispatching",
  }).onConflictDoNothing();

  if (delivery.provider !== "expo") {
    await finishDelivery(delivery.id, delivery.leaseToken ?? "", attemptNumber, {
      status: "failed",
      errorClass: "unsupported_provider",
      error: `Unsupported push provider: ${delivery.provider}`,
    });
    return;
  }

  try {
    const response = await fetchWithTimeout(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: token.token,
        title: outbox.title,
        body: outbox.body,
        data: outbox.data ?? {},
        sound: "default",
        channelId: "secretary-events",
        ...(typeof (outbox.data as Record<string, unknown>).categoryIdentifier === "string"
          ? { categoryId: (outbox.data as Record<string, unknown>).categoryIdentifier }
          : {}),
      }),
    });
    const payload = await responseJson(response);
    const error = expoError(payload);
    if (!response.ok || error) {
      const failureClass = classifyExpoFailure({ httpStatus: response.status, error });
      if (error === "DeviceNotRegistered") await disableInvalidToken(token.id);
      const retry = failureClass === "unknown" && attemptNumber < MAX_ATTEMPTS;
      await finishDelivery(delivery.id, delivery.leaseToken ?? "", attemptNumber, {
        status: retry ? "unknown" : "failed",
        errorClass: failureClass,
        error: error ?? `Expo push gateway returned ${response.status}.`,
        ...(retry ? { nextAttemptAt: new Date(Date.now() + notificationBackoffMs(attemptNumber)) } : {}),
      });
      return;
    }
    const data = expoData(payload);
    const ticket = typeof data.id === "string" ? data.id : null;
    await finishDelivery(delivery.id, delivery.leaseToken ?? "", attemptNumber, {
      status: "submitted",
      providerTicket: ticket,
    });
  } catch (error) {
    const retry = attemptNumber < MAX_ATTEMPTS;
    await finishDelivery(delivery.id, delivery.leaseToken ?? "", attemptNumber, {
      status: retry ? "unknown" : "failed",
      errorClass: retry ? "unknown_delivery" : "unknown_delivery_exhausted",
      error: boundedError(error),
      ...(retry ? { nextAttemptAt: new Date(Date.now() + notificationBackoffMs(attemptNumber)) } : {}),
    });
  }
}

async function refreshOutboxStatus(notificationId: string): Promise<void> {
  const deliveries = await db.select().from(notificationDeliveriesTable)
    .where(eq(notificationDeliveriesTable.notificationId, notificationId));
  let status = "queued";
  if (deliveries.length > 0) {
    if (deliveries.every((item) => item.status === "confirmed")) status = "confirmed";
    else if (deliveries.some((item) => item.status === "dispatching" || item.status === "queued")) status = "queued";
    else if (deliveries.some((item) => item.status === "unknown")) status = "unknown";
    else if (deliveries.some((item) => item.status === "submitted")) status = "submitted";
    else status = "failed";
  }
  await db.update(notificationOutboxTable).set({
    status,
    updatedAt: new Date(),
  }).where(eq(notificationOutboxTable.id, notificationId));
}

async function materializeQueuedRecipients(now: Date): Promise<void> {
  const outboxes = await db.select().from(notificationOutboxTable).where(
    or(eq(notificationOutboxTable.status, "queued"), eq(notificationOutboxTable.status, "unknown")),
  ).limit(MAX_BATCH);
  await Promise.all(outboxes.map(async (outbox) => {
    const tokens = await db.select().from(mobilePushTokensTable).where(and(
      eq(mobilePushTokensTable.tenantId, outbox.tenantId),
      eq(mobilePushTokensTable.ownerUserId, outbox.ownerUserId),
      eq(mobilePushTokensTable.enabled, 1),
    ));
    if (tokens.length === 0) return;
    await db.insert(notificationDeliveriesTable).values(tokens.map((token) => ({
      tenantId: outbox.tenantId,
      ownerUserId: outbox.ownerUserId,
      notificationId: outbox.id,
      tokenId: token.id,
      provider: token.provider,
      nextAttemptAt: now,
    }))).onConflictDoNothing();
  }));
}

async function pollExpoReceipts(now: Date): Promise<void> {
  const rows = await db.select({
    delivery: notificationDeliveriesTable,
    token: mobilePushTokensTable,
  }).from(notificationDeliveriesTable)
    .innerJoin(mobilePushTokensTable, eq(notificationDeliveriesTable.tokenId, mobilePushTokensTable.id))
    .where(and(
      eq(notificationDeliveriesTable.provider, "expo"),
      eq(notificationDeliveriesTable.status, "submitted"),
      sql`${notificationDeliveriesTable.providerTicket} is not null`,
      lte(notificationDeliveriesTable.updatedAt, new Date(now.getTime() - 5_000)),
    )).limit(MAX_BATCH);

  await Promise.all(rows.map(async ({ delivery, token }) => {
    if (!delivery.providerTicket) return;
    try {
      const response = await fetchWithTimeout(EXPO_RECEIPTS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [delivery.providerTicket] }),
      });
      if (!response.ok) return;
      const payload = await responseJson(response);
      const data = payload.data;
      const receipt = data && typeof data === "object"
        ? (data as Record<string, unknown>)[delivery.providerTicket]
        : undefined;
      if (!receipt || typeof receipt !== "object") return;
      const receiptRecord = receipt as Record<string, unknown>;
      if (receiptRecord.status === "ok") {
        await db.update(notificationDeliveriesTable).set({
          status: "confirmed",
          confirmedAt: now,
          updatedAt: now,
          lastError: null,
          lastErrorClass: null,
        }).where(and(
          eq(notificationDeliveriesTable.id, delivery.id),
          eq(notificationDeliveriesTable.status, "submitted"),
        ));
      } else if (receiptRecord.status === "error") {
        const details = receiptRecord.details;
        const error = details && typeof details === "object"
          && typeof (details as Record<string, unknown>).error === "string"
          ? (details as Record<string, unknown>).error as string
          : "Expo receipt reported an error.";
        const failureClass = classifyExpoFailure({ error });
        if (error === "DeviceNotRegistered") await disableInvalidToken(token.id);
        const retry = failureClass === "unknown" && delivery.attemptCount < MAX_ATTEMPTS;
        await db.update(notificationDeliveriesTable).set({
          status: retry ? "unknown" : "failed",
          nextAttemptAt: retry
            ? new Date(now.getTime() + notificationBackoffMs(delivery.attemptCount))
            : now,
          lastErrorClass: failureClass,
          lastError: error,
          updatedAt: now,
        }).where(and(
          eq(notificationDeliveriesTable.id, delivery.id),
          eq(notificationDeliveriesTable.status, "submitted"),
        ));
      }
      await refreshOutboxStatus(delivery.notificationId);
    } catch {
      // A receipt lookup failure does not prove the original submission failed.
    }
  }));
}

export async function processNotificationOutbox(options: {
  notificationId?: string;
  now?: Date;
  limit?: number;
} = {}): Promise<{ inspected: number; claimed: number }> {
  const now = options.now ?? new Date();
  const limit = Math.min(MAX_BATCH, Math.max(1, Math.floor(options.limit ?? MAX_BATCH)));
  if (!options.notificationId) {
    await materializeQueuedRecipients(now);
    await pollExpoReceipts(now);
  }
  const rows = await db.select({
    delivery: notificationDeliveriesTable,
    token: mobilePushTokensTable,
    outbox: notificationOutboxTable,
  }).from(notificationDeliveriesTable)
    .innerJoin(mobilePushTokensTable, eq(notificationDeliveriesTable.tokenId, mobilePushTokensTable.id))
    .innerJoin(notificationOutboxTable, eq(notificationDeliveriesTable.notificationId, notificationOutboxTable.id))
    .where(and(
      options.notificationId ? eq(notificationDeliveriesTable.notificationId, options.notificationId) : undefined,
      or(
        and(
          or(eq(notificationDeliveriesTable.status, "queued"), eq(notificationDeliveriesTable.status, "unknown")),
          lte(notificationDeliveriesTable.nextAttemptAt, now),
        ),
        and(
          eq(notificationDeliveriesTable.status, "dispatching"),
          or(isNull(notificationDeliveriesTable.leaseExpiresAt), lte(notificationDeliveriesTable.leaseExpiresAt, now)),
        ),
      ),
    )).limit(limit);

  let claimedCount = 0;
  await Promise.all(rows.map(async (row) => {
    const claimed = await claimDelivery(row.delivery.id, now);
    if (!claimed) return;
    claimedCount += 1;
    await sendDelivery(claimed, row.token, row.outbox);
    await refreshOutboxStatus(row.outbox.id);
  }));
  return { inspected: rows.length, claimed: claimedCount };
}

/**
 * Delivery is deliberately "queued" rather than "device-confirmed": Expo's
 * ticket only proves gateway submission. A later receipt processor can move
 * submitted to confirmed when the provider exposes a positive receipt.
 */
export async function dispatchMobilePush(
  identity: Identity,
  notification: MobilePushNotification,
): Promise<NotificationEnqueueResult> {
  const queued = await enqueueMobilePushOutbox(db, identity, notification);
  await processNotificationOutbox({ notificationId: queued.id }).catch(() => undefined);
  return queued;
}

export async function recoverNotificationOutbox(): Promise<void> {
  await processNotificationOutbox().catch(() => undefined);
}

export function createNotificationRecovery(options: { pollMs?: number } = {}) {
  const pollMs = Math.max(1_000, Math.floor(options.pollMs ?? Number(process.env.NOTIFICATION_RECOVERY_POLL_MS ?? 15_000)));
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  return {
    start() {
      if (timer) return;
      const run = () => {
        if (running) return;
        running = true;
        void recoverNotificationOutbox().finally(() => {
          running = false;
        });
      };
      timer = setInterval(run, pollMs);
      run();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}