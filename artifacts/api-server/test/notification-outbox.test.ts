import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  db,
  mobilePushTokensTable,
  notificationDeliveryAttemptsTable,
  notificationDeliveriesTable,
  notificationOutboxTable,
} from "@workspace/db";
import {
  classifyExpoFailure,
  dispatchMobilePush,
  notificationBackoffMs,
  processNotificationOutbox,
  registerMobilePushToken,
} from "../src/lib/mobile-push.ts";

test("Expo failures distinguish permanent, transient-unknown, and unknown delivery", () => {
  assert.equal(classifyExpoFailure({ error: "DeviceNotRegistered" }), "permanent");
  assert.equal(classifyExpoFailure({ httpStatus: 503 }), "unknown");
  assert.equal(classifyExpoFailure({ httpStatus: 400 }), "permanent");
  assert.equal(classifyExpoFailure({}), "unknown");
  assert.equal(notificationBackoffMs(1), 5_000);
  assert.equal(notificationBackoffMs(2), 10_000);
  assert.equal(notificationBackoffMs(99), 15 * 60_000);
});

test("durable push outbox isolates devices and deduplicates a notification", async () => {
  const identity = {
    tenantId: `notification-outbox-${process.pid}-${Date.now()}`,
    userId: "outbox-owner",
  };
  const tokenA = `ExponentPushToken[${identity.tenantId}-a]`;
  const tokenB = `ExponentPushToken[${identity.tenantId}-b]`;
  await registerMobilePushToken(identity, {
    token: tokenA,
    provider: "expo",
    platform: "android",
    appId: "test-app",
  });
  await registerMobilePushToken(identity, {
    token: tokenB,
    provider: "expo",
    platform: "ios",
    appId: "test-app",
  });

  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async (_url, init) => {
    requestCount += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as { to?: string };
    if (body.to === tokenA) throw new Error("socket closed after submit");
    return new Response(JSON.stringify({
      data: { status: "ok", id: `ticket-${requestCount}` },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const first = await dispatchMobilePush(identity, {
      title: "اختبار الاسترداد",
      body: "لا تفقد هذا التنبيه",
      dedupeKey: "notification-outbox-test:one",
    });
    const second = await dispatchMobilePush(identity, {
      title: "اختبار الاسترداد",
      body: "لا تفقد هذا التنبيه",
      dedupeKey: "notification-outbox-test:one",
    });
    assert.equal(first.id, second.id);
    assert.equal(requestCount, 2);

    const deliveries = await db.select().from(notificationDeliveriesTable).where(and(
      eq(notificationDeliveriesTable.tenantId, identity.tenantId),
      eq(notificationDeliveriesTable.ownerUserId, identity.userId),
      eq(notificationDeliveriesTable.notificationId, first.id),
    ));
    assert.equal(deliveries.length, 2);
    assert.deepEqual(
      deliveries.map((delivery) => delivery.status).sort(),
      ["submitted", "unknown"],
    );

    const outboxes = await db.select().from(notificationOutboxTable).where(and(
      eq(notificationOutboxTable.tenantId, identity.tenantId),
      eq(notificationOutboxTable.ownerUserId, identity.userId),
    ));
    assert.equal(outboxes.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a positive Expo receipt confirms delivery and closes the matching attempt", async () => {
  const identity = {
    tenantId: `notification-receipt-${process.pid}-${Date.now()}`,
    userId: "receipt-owner",
  };
  const token = `ExponentPushToken[${identity.tenantId}]`;
  await registerMobilePushToken(identity, {
    token,
    provider: "expo",
    platform: "android",
    appId: "test-app",
  });

  const originalFetch = globalThis.fetch;
  let sendRequests = 0;
  let receiptRequests = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/push/send")) {
      sendRequests += 1;
      return new Response(JSON.stringify({
        data: { status: "ok", id: "receipt-confirmed-ticket" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).endsWith("/push/getReceipts")) {
      receiptRequests += 1;
      return new Response(JSON.stringify({
        data: { "receipt-confirmed-ticket": { status: "ok" } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected Expo endpoint: ${String(url)}`);
  };

  try {
    const queued = await dispatchMobilePush(identity, {
      title: "اختبار تأكيد التسليم",
      body: "تأكيد من إيصال Expo",
      dedupeKey: "notification-outbox-test:positive-receipt",
    });
    const [submitted] = await db.select().from(notificationDeliveriesTable).where(
      eq(notificationDeliveriesTable.notificationId, queued.id),
    );
    assert.equal(submitted?.status, "submitted");

    const receiptTick = await processNotificationOutbox({
      notificationId: queued.id,
      now: new Date(Date.now() + 6_000),
    });

    const [confirmed] = await db.select().from(notificationDeliveriesTable).where(
      eq(notificationDeliveriesTable.id, submitted!.id),
    );
    const [attempt] = await db.select().from(notificationDeliveryAttemptsTable).where(
      eq(notificationDeliveryAttemptsTable.deliveryId, submitted!.id),
    );
    const [outbox] = await db.select().from(notificationOutboxTable).where(
      eq(notificationOutboxTable.id, queued.id),
    );
    assert.equal(confirmed?.status, "confirmed");
    assert.ok(confirmed?.confirmedAt);
    assert.equal(attempt?.status, "confirmed");
    assert.ok(attempt?.completedAt);
    assert.equal(outbox?.status, "confirmed");
    assert.equal(sendRequests, 1);
    assert.equal(receiptRequests, 1);
    assert.equal(receiptTick.receiptsUpdated, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a permanent Expo receipt error closes the attempt and disables that device token", async () => {
  const identity = {
    tenantId: `notification-receipt-invalid-${process.pid}-${Date.now()}`,
    userId: "receipt-owner",
  };
  const token = `ExponentPushToken[${identity.tenantId}]`;
  await registerMobilePushToken(identity, {
    token,
    provider: "expo",
    platform: "android",
    appId: "test-app",
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/push/send")) {
      return new Response(JSON.stringify({
        data: { status: "ok", id: "receipt-invalid-ticket" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).endsWith("/push/getReceipts")) {
      return new Response(JSON.stringify({
        data: {
          "receipt-invalid-ticket": {
            status: "error",
            details: { error: "DeviceNotRegistered" },
          },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected Expo endpoint: ${String(url)}`);
  };

  try {
    const queued = await dispatchMobilePush(identity, {
      title: "اختبار جهاز غير مسجل",
      body: "يجب تعطيل الرمز غير الصالح",
      dedupeKey: "notification-outbox-test:invalid-receipt",
    });
    const [submitted] = await db.select().from(notificationDeliveriesTable).where(
      eq(notificationDeliveriesTable.notificationId, queued.id),
    );
    const receiptTick = await processNotificationOutbox({
      notificationId: queued.id,
      now: new Date(Date.now() + 6_000),
    });
    const [failed] = await db.select().from(notificationDeliveriesTable).where(
      eq(notificationDeliveriesTable.id, submitted!.id),
    );
    const [attempt] = await db.select().from(notificationDeliveryAttemptsTable).where(
      eq(notificationDeliveryAttemptsTable.deliveryId, submitted!.id),
    );
    const [storedToken] = await db.select().from(mobilePushTokensTable).where(
      eq(mobilePushTokensTable.id, submitted!.tokenId),
    );
    const [outbox] = await db.select().from(notificationOutboxTable).where(
      eq(notificationOutboxTable.id, queued.id),
    );

    assert.equal(failed?.status, "failed");
    assert.equal(attempt?.status, "failed");
    assert.equal(attempt?.errorClass, "permanent");
    assert.equal(storedToken?.enabled, 0);
    assert.equal(storedToken?.disabledReason, "provider_invalid");
    assert.equal(outbox?.status, "failed");
    assert.equal(receiptTick.receiptsUpdated, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("network ambiguity becomes terminal failure after max attempts", async () => {
  const identity = {
    tenantId: `notification-max-attempts-${process.pid}-${Date.now()}`,
    userId: "outbox-owner",
  };
  const token = `ExponentPushToken[${identity.tenantId}]`;
  await registerMobilePushToken(identity, {
    token,
    provider: "expo",
    platform: "android",
    appId: "test-app",
  });

  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    throw new Error("network unavailable");
  };

  try {
    const queued = await dispatchMobilePush(identity, {
      title: "اختبار الحد الأقصى",
      body: "يجب أن يتوقف",
      dedupeKey: "notification-outbox-test:max-attempts",
    });
    const [createdDelivery] = await db.select().from(notificationDeliveriesTable).where(
      eq(notificationDeliveriesTable.notificationId, queued.id),
    );
    assert.ok(createdDelivery);

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      await db.update(notificationDeliveriesTable)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(notificationDeliveriesTable.id, createdDelivery.id));
      await processNotificationOutbox({ notificationId: queued.id, now: new Date() });
    }

    const [terminalDelivery] = await db.select().from(notificationDeliveriesTable).where(
      eq(notificationDeliveriesTable.id, createdDelivery.id),
    );
    assert.equal(terminalDelivery?.status, "failed");
    assert.equal(terminalDelivery?.attemptCount, 5);
    assert.equal(terminalDelivery?.lastErrorClass, "unknown_delivery_exhausted");
    assert.equal(requestCount, 5);

    await processNotificationOutbox({
      notificationId: queued.id,
      now: new Date(Date.now() + 60 * 60_000),
    });
    assert.equal(requestCount, 5);

    const [outbox] = await db.select().from(notificationOutboxTable).where(
      eq(notificationOutboxTable.id, queued.id),
    );
    assert.equal(outbox?.status, "failed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});