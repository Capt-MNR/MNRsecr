import assert from "node:assert/strict";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  agentWorkEvidenceTable,
  agentWorkEventsTable,
  agentWorkRunsTable,
  agentWorksTable,
  authMembershipsTable,
  db,
  mobilePushTokensTable,
  notificationDeliveryAttemptsTable,
  notificationDeliveriesTable,
  notificationOutboxTable,
  remindersTable,
  triggerOutboxTable,
} from "@workspace/db";
import { AgentWorkRunner } from "../src/lib/agent-work/runner";
import { processNotificationOutbox } from "../src/lib/mobile-push";
import { seedProactiveDeadlineEvents } from "../src/lib/proactive-triggers";
import { TriggerOutboxDispatcher } from "../src/lib/trigger-outbox";

const identity = {
  tenantId: `reminder-lifecycle-${process.pid}-${Date.now()}`,
  userId: "reminder-owner",
};

async function cleanup() {
  await db.delete(notificationDeliveryAttemptsTable).where(and(
    eq(notificationDeliveryAttemptsTable.tenantId, identity.tenantId),
    eq(notificationDeliveryAttemptsTable.ownerUserId, identity.userId),
  ));
  await db.delete(notificationDeliveriesTable).where(and(
    eq(notificationDeliveriesTable.tenantId, identity.tenantId),
    eq(notificationDeliveriesTable.ownerUserId, identity.userId),
  ));
  await db.delete(notificationOutboxTable).where(and(
    eq(notificationOutboxTable.tenantId, identity.tenantId),
    eq(notificationOutboxTable.ownerUserId, identity.userId),
  ));
  await db.delete(mobilePushTokensTable).where(and(
    eq(mobilePushTokensTable.tenantId, identity.tenantId),
    eq(mobilePushTokensTable.ownerUserId, identity.userId),
  ));

  const works = await db.select({ id: agentWorksTable.id }).from(agentWorksTable).where(and(
    eq(agentWorksTable.tenantId, identity.tenantId),
    eq(agentWorksTable.ownerUserId, identity.userId),
  ));
  const workIds = works.map((work) => work.id);
  if (workIds.length > 0) {
    await db.delete(agentWorkEvidenceTable).where(and(
      eq(agentWorkEvidenceTable.tenantId, identity.tenantId),
      eq(agentWorkEvidenceTable.ownerUserId, identity.userId),
      inArray(agentWorkEvidenceTable.workId, workIds),
    ));
    await db.delete(agentWorkEventsTable).where(and(
      eq(agentWorkEventsTable.tenantId, identity.tenantId),
      eq(agentWorkEventsTable.ownerUserId, identity.userId),
      inArray(agentWorkEventsTable.workId, workIds),
    ));
    await db.delete(agentWorkRunsTable).where(and(
      eq(agentWorkRunsTable.tenantId, identity.tenantId),
      eq(agentWorkRunsTable.ownerUserId, identity.userId),
      inArray(agentWorkRunsTable.workId, workIds),
    ));
    await db.delete(agentWorksTable).where(and(
      eq(agentWorksTable.tenantId, identity.tenantId),
      eq(agentWorksTable.ownerUserId, identity.userId),
      inArray(agentWorksTable.id, workIds),
    ));
  }
  await db.delete(triggerOutboxTable).where(and(
    eq(triggerOutboxTable.tenantId, identity.tenantId),
    eq(triggerOutboxTable.ownerUserId, identity.userId),
  ));
  await db.delete(remindersTable).where(and(
    eq(remindersTable.tenantId, identity.tenantId),
    eq(remindersTable.ownerUserId, identity.userId),
  ));
  await db.delete(authMembershipsTable).where(and(
    eq(authMembershipsTable.tenantId, identity.tenantId),
    eq(authMembershipsTable.userId, identity.userId),
  ));
}

test("a past reminder is caught up once through Work, durable notification, and delivery evidence", async () => {
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY = "true";
  await cleanup();

  try {
    await db.insert(authMembershipsTable).values({
      tenantId: identity.tenantId,
      userId: identity.userId,
    });
    const dueAt = new Date(Date.now() - 60_000);
    const [reminder] = await db.insert(remindersTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      text: "تذكير اختبار الاستحقاق",
      dueAt,
      status: "scheduled",
    }).returning();
    assert.ok(reminder);

    const reconciledAt = new Date();
    const restartLeaseExpiresAt = new Date(Date.now() + 2 * 60_000);
    await db.transaction(async (tx) => {
      assert.equal(await seedProactiveDeadlineEvents(reconciledAt, tx), 1);
      assert.equal(await seedProactiveDeadlineEvents(reconciledAt, tx), 1);
      const [insertedEvent] = await tx.select().from(triggerOutboxTable).where(and(
        eq(triggerOutboxTable.tenantId, identity.tenantId),
        eq(triggerOutboxTable.ownerUserId, identity.userId),
        eq(triggerOutboxTable.aggregateId, reminder.id),
      ));
      assert.ok(insertedEvent);
      assert.equal(insertedEvent.status, "pending");
      assert.equal(insertedEvent.availableAt.toISOString(), dueAt.toISOString());
      await tx.update(triggerOutboxTable).set({
        status: "claimed",
        leaseToken: "abandoned-before-restart",
        leaseExpiresAt: restartLeaseExpiresAt,
        updatedAt: reconciledAt,
      }).where(eq(triggerOutboxTable.id, insertedEvent.id));
    });

    const events = await db.select().from(triggerOutboxTable).where(and(
      eq(triggerOutboxTable.tenantId, identity.tenantId),
      eq(triggerOutboxTable.ownerUserId, identity.userId),
      eq(triggerOutboxTable.aggregateId, reminder.id),
    ));
    assert.equal(events.length, 1);
    const dueEvent = events[0]!;
    assert.equal(dueEvent.eventType, "reminder.due");
    assert.equal(dueEvent.status, "claimed");
    assert.equal(dueEvent.occurredAt.toISOString(), dueAt.toISOString());
    assert.equal(dueEvent.availableAt.toISOString(), dueAt.toISOString());

    await db.insert(mobilePushTokensTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      token: `TestPushToken-${identity.tenantId}`,
      provider: "lifecycle-test",
      platform: "test",
      appId: "secretary-lifecycle-test",
    });

    // A fresh dispatcher reclaims a due event left leased by the prior process.
    const lateNow = new Date(restartLeaseExpiresAt.getTime() + 5_000);
    const [firstTick, competingTick] = await Promise.all([
      new TriggerOutboxDispatcher().tick(lateNow, 100),
      new TriggerOutboxDispatcher().tick(lateNow, 100),
    ]);
    assert.equal(firstTick.enabled, true);
    assert.equal(competingTick.enabled, true);
    const [processedDueEvent] = await db.select().from(triggerOutboxTable).where(
      eq(triggerOutboxTable.id, dueEvent.id),
    );
    assert.equal(processedDueEvent?.status, "processed");

    const works = await db.select().from(agentWorksTable).where(and(
      eq(agentWorksTable.tenantId, identity.tenantId),
      eq(agentWorksTable.ownerUserId, identity.userId),
    ));
    assert.equal(works.length, 1);
    const work = works[0]!;
    const source = work.source as Record<string, unknown>;
    const deadlineEvidence = source.deadlineEvidence as Record<string, unknown>;
    assert.equal(source.eventId, dueEvent.id);
    assert.equal(deadlineEvidence.triggerEventId, dueEvent.id);
    assert.equal(deadlineEvidence.dueAt, dueAt.toISOString());
    assert.ok(Number(deadlineEvidence.triggerProcessingLatenessMs) > 0);
    assert.ok(Number(deadlineEvidence.triggerQueueDelayMs) >= 0);

    const runner = new AgentWorkRunner({ now: () => lateNow });
    const runResult = await runner.tick(lateNow);
    assert.ok(runResult.completed >= 1);

    const [completedWork] = await db.select().from(agentWorksTable).where(
      eq(agentWorksTable.id, work.id),
    );
    assert.equal(completedWork?.status, "completed");
    const runs = await db.select().from(agentWorkRunsTable).where(
      eq(agentWorkRunsTable.workId, work.id),
    );
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.status, "verified");
    const workEvents = await db.select().from(agentWorkEventsTable).where(
      eq(agentWorkEventsTable.workId, work.id),
    );
    const deliveryEvent = workEvents.find((event) => event.eventType === "notification_delivery");
    assert.ok(deliveryEvent);
    assert.match(deliveryEvent.summary, /لم يتأكد وصوله للجهاز/);
    assert.equal(
      (deliveryEvent.metadata as Record<string, unknown>).reason,
      "durable_outbox_queued",
    );

    const evidenceRows = await db.select().from(agentWorkEvidenceTable).where(
      eq(agentWorkEvidenceTable.workId, work.id),
    );
    assert.equal(evidenceRows.length, 1);
    const runEvidence = evidenceRows[0]?.snapshot as Record<string, unknown>;
    assert.equal(runEvidence.eventId, dueEvent.id);
    assert.equal(runEvidence.deadlineDueAt, dueAt.toISOString());
    assert.ok(typeof runEvidence.workIntentCreatedAt === "string");
    assert.ok(Number(runEvidence.triggerProcessingLatenessMs) > 0);

    const [notification] = await db.select().from(notificationOutboxTable).where(and(
      eq(notificationOutboxTable.tenantId, identity.tenantId),
      eq(notificationOutboxTable.ownerUserId, identity.userId),
      eq(notificationOutboxTable.workId, work.id),
    ));
    assert.ok(notification);
    assert.equal(notification.sourceEventId, dueEvent.id);
    assert.equal((notification.data as Record<string, unknown>).triggerEventId, dueEvent.id);

    // The test provider is intentionally unsupported, so the attempt records a
    // terminal result without making any external network request.
    await processNotificationOutbox({ notificationId: notification.id, now: lateNow });
    const [delivery] = await db.select().from(notificationDeliveriesTable).where(
      eq(notificationDeliveriesTable.notificationId, notification.id),
    );
    assert.ok(delivery);
    assert.equal(delivery.status, "failed");
    const attempts = await db.select().from(notificationDeliveryAttemptsTable).where(
      eq(notificationDeliveryAttemptsTable.deliveryId, delivery.id),
    );
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.status, "failed");
    assert.equal(attempts[0]?.errorClass, "unsupported_provider");

    const replayAt = new Date(lateNow.getTime() + 60_000);
    await db.update(triggerOutboxTable).set({
      status: "pending",
      processedAt: null,
      availableAt: replayAt,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: replayAt,
    }).where(eq(triggerOutboxTable.id, dueEvent.id));
    await new TriggerOutboxDispatcher().tick(replayAt, 100);
    const [replayedEvent] = await db.select().from(triggerOutboxTable).where(
      eq(triggerOutboxTable.id, dueEvent.id),
    );
    assert.equal(replayedEvent?.status, "processed");
    assert.equal(replayedEvent?.attemptCount, 2);
    const worksAfterDeliveryFailure = await db.select().from(agentWorksTable).where(and(
      eq(agentWorksTable.tenantId, identity.tenantId),
      eq(agentWorksTable.ownerUserId, identity.userId),
    ));
    assert.equal(worksAfterDeliveryFailure.length, 1);
    assert.equal((await db.select().from(agentWorkRunsTable).where(
      eq(agentWorkRunsTable.workId, work.id),
    )).length, 1);
    assert.equal((await db.select().from(notificationOutboxTable).where(
      eq(notificationOutboxTable.workId, work.id),
    )).length, 1);
  } finally {
    await cleanup();
  }
});