import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  db,
  notificationDeliveriesTable,
  notificationOutboxTable,
} from "@workspace/db";
import {
  classifyExpoFailure,
  dispatchMobilePush,
  notificationBackoffMs,
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