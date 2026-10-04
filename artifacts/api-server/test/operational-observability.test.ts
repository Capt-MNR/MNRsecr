import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  agentWorkEventsTable,
  agentWorkRunsTable,
  agentWorksTable,
  db,
  notificationDeliveryAttemptsTable,
  notificationDeliveriesTable,
  notificationOutboxTable,
  operationalProviderFailuresTable,
  triggerOutboxTable,
} from "@workspace/db";
import { getOperationalSummary } from "../src/lib/operational-observability";

const tenantId = `ops-summary-${crypto.randomUUID()}`;
const otherTenantId = `ops-summary-other-${crypto.randomUUID()}`;
const ownerUserId = `owner-${crypto.randomUUID()}`;
const from = new Date("2026-10-03T00:00:00.000Z");
const to = new Date("2026-10-04T00:00:00.000Z");
const identity = { tenantId, userId: ownerUserId };
const scopeTenants = [tenantId, otherTenantId];

after(async () => {
  const ownerScope = and(
    eq(agentWorkEventsTable.ownerUserId, ownerUserId),
    inArray(agentWorkEventsTable.tenantId, scopeTenants),
  );
  await db.delete(notificationDeliveryAttemptsTable).where(and(
    eq(notificationDeliveryAttemptsTable.ownerUserId, ownerUserId),
    inArray(notificationDeliveryAttemptsTable.tenantId, scopeTenants),
  ));
  await db.delete(notificationDeliveriesTable).where(and(
    eq(notificationDeliveriesTable.ownerUserId, ownerUserId),
    inArray(notificationDeliveriesTable.tenantId, scopeTenants),
  ));
  await db.delete(notificationOutboxTable).where(and(
    eq(notificationOutboxTable.ownerUserId, ownerUserId),
    inArray(notificationOutboxTable.tenantId, scopeTenants),
  ));
  await db.delete(agentWorkEventsTable).where(ownerScope);
  await db.delete(agentWorkRunsTable).where(and(
    eq(agentWorkRunsTable.ownerUserId, ownerUserId),
    inArray(agentWorkRunsTable.tenantId, scopeTenants),
  ));
  await db.delete(agentWorksTable).where(and(
    eq(agentWorksTable.ownerUserId, ownerUserId),
    inArray(agentWorksTable.tenantId, scopeTenants),
  ));
  await db.delete(triggerOutboxTable).where(and(
    eq(triggerOutboxTable.ownerUserId, ownerUserId),
    inArray(triggerOutboxTable.tenantId, scopeTenants),
  ));
  await db.delete(operationalProviderFailuresTable).where(and(
    eq(operationalProviderFailuresTable.ownerUserId, ownerUserId),
    inArray(operationalProviderFailuresTable.tenantId, scopeTenants),
  ));
});

test("operational summary aggregates persisted traces in the requested tenant and time window", async () => {
  const scheduledAt = new Date("2026-10-03T01:00:00.000Z");
  const processedAt = new Date(scheduledAt.getTime() + 70_000);
  const [processedTrigger] = await db.insert(triggerOutboxTable).values({
    tenantId,
    ownerUserId,
    eventType: "task.updated",
    aggregateType: "task",
    aggregateId: "task-a",
    dedupeKey: `${tenantId}:trigger:processed`,
    status: "processed",
    occurredAt: scheduledAt,
    availableAt: scheduledAt,
    createdAt: scheduledAt,
    processedAt,
  }).returning();
  await db.insert(triggerOutboxTable).values({
    tenantId,
    ownerUserId,
    eventType: "task.updated",
    aggregateType: "task",
    aggregateId: "task-b",
    dedupeKey: `${tenantId}:trigger:quarantined`,
    status: "quarantined",
    occurredAt: new Date("2026-10-03T02:00:00.000Z"),
    availableAt: new Date("2026-10-03T02:00:00.000Z"),
    createdAt: new Date("2026-10-03T02:00:00.000Z"),
    quarantinedAt: new Date("2026-10-03T02:04:00.000Z"),
  });
  await db.insert(triggerOutboxTable).values({
    tenantId,
    ownerUserId,
    eventType: "task.updated",
    aggregateType: "task",
    aggregateId: "task-c",
    dedupeKey: `${tenantId}:trigger:overdue`,
    status: "pending",
    occurredAt: new Date("2026-10-03T03:00:00.000Z"),
    availableAt: new Date(Date.now() - 180_000),
    createdAt: new Date("2026-10-03T03:00:00.000Z"),
  });
  await db.insert(triggerOutboxTable).values({
    tenantId: otherTenantId,
    ownerUserId,
    eventType: "task.updated",
    aggregateType: "task",
    aggregateId: "foreign-task",
    dedupeKey: `${otherTenantId}:trigger`,
    status: "processed",
    occurredAt: scheduledAt,
    availableAt: scheduledAt,
    createdAt: scheduledAt,
    processedAt,
  });

  const [work] = await db.insert(agentWorksTable).values({
    tenantId,
    ownerUserId,
    kind: "scheduled_check",
    title: "Operational test work",
    status: "completed",
    source: { eventId: processedTrigger.id },
    createdAt: new Date(scheduledAt.getTime() + 2_000),
  }).returning();
  const startedAt = new Date("2026-10-03T01:01:00.000Z");
  const completedAt = new Date(startedAt.getTime() + 2_000);
  const [run] = await db.insert(agentWorkRunsTable).values({
    tenantId,
    ownerUserId,
    workId: work.id,
    attempt: 1,
    status: "completed",
    idempotencyKey: `${tenantId}:run`,
    startedAt,
    completedAt,
  }).returning();
  await db.insert(agentWorkEventsTable).values([
    {
      tenantId,
      ownerUserId,
      workId: work.id,
      runId: run.id,
      eventType: "run_completed",
      summary: "completed",
      occurredAt: completedAt,
      dedupeKey: `${tenantId}:completed`,
    },
    {
      tenantId,
      ownerUserId,
      workId: work.id,
      runId: run.id,
      eventType: "run_failed",
      summary: "failed",
      occurredAt: new Date("2026-10-03T04:00:00.000Z"),
      dedupeKey: `${tenantId}:failed`,
    },
    {
      tenantId,
      ownerUserId,
      workId: work.id,
      runId: run.id,
      eventType: "run_lease_expired",
      actorType: "recovery",
      summary: "lease expired",
      occurredAt: new Date("2026-10-03T05:00:00.000Z"),
      dedupeKey: `${tenantId}:lease-expired`,
    },
  ]);

  const notificationCreatedAt = new Date("2026-10-03T06:00:00.000Z");
  const [notification] = await db.insert(notificationOutboxTable).values({
    tenantId,
    ownerUserId,
    dedupeKey: `${tenantId}:notification`,
    title: "Test",
    body: "Test body",
    createdAt: notificationCreatedAt,
  }).returning();
  const [delivery] = await db.insert(notificationDeliveriesTable).values({
    tenantId,
    ownerUserId,
    notificationId: notification.id,
    tokenId: crypto.randomUUID(),
    provider: "expo",
    status: "confirmed",
    attemptCount: 2,
    confirmedAt: new Date(notificationCreatedAt.getTime() + 80_000),
    createdAt: notificationCreatedAt,
  }).returning();
  await db.insert(notificationDeliveryAttemptsTable).values([
    {
      tenantId,
      ownerUserId,
      deliveryId: delivery.id,
      attemptNumber: 1,
      status: "submitted",
      startedAt: new Date(notificationCreatedAt.getTime() + 60_000),
      completedAt: new Date(notificationCreatedAt.getTime() + 61_000),
    },
    {
      tenantId,
      ownerUserId,
      deliveryId: delivery.id,
      attemptNumber: 2,
      status: "confirmed",
      startedAt: new Date(notificationCreatedAt.getTime() + 75_000),
      completedAt: new Date(notificationCreatedAt.getTime() + 80_000),
    },
  ]);
  await db.insert(operationalProviderFailuresTable).values({
    tenantId,
    ownerUserId,
    requestId: `${tenantId}:provider-request`,
    logicalCallNumber: 1,
    attemptNumber: 1,
    provider: "test-provider",
    model: "test-model",
    routeId: "test-route",
    failureReason: "rate_limited",
    latencyMs: 250,
    startedAt: new Date("2026-10-03T07:00:00.000Z"),
    completedAt: new Date("2026-10-03T07:00:00.250Z"),
  });
  await db.insert(operationalProviderFailuresTable).values({
    tenantId: otherTenantId,
    ownerUserId,
    requestId: `${otherTenantId}:provider-request`,
    logicalCallNumber: 1,
    attemptNumber: 1,
    provider: "test-provider",
    model: "test-model",
    routeId: "test-route",
    latencyMs: 900,
    startedAt: new Date("2026-10-03T07:00:00.000Z"),
    completedAt: new Date("2026-10-03T07:00:00.900Z"),
  });

  const report = await getOperationalSummary(identity, {
    from: from.toISOString(),
    to: to.toISOString(),
  });

  assert.deepEqual(report.triggers, {
    total: 3,
    processed: 1,
    delayed: 1,
    missed: 1,
    overdue: 1,
  });
  assert.deepEqual(report.work, {
    created: 1,
    completed: 1,
    failed: 1,
    stale: 1,
    leaseRecoveries: 1,
  });
  assert.deepEqual(report.notifications, {
    queued: 1,
    attempts: 2,
    retries: 1,
    confirmed: 1,
  });
  assert.equal(report.providerFailures.count, 1);
  assert.equal(report.latencyMs.triggerToWork.averageMs, 2_000);
  assert.equal(report.latencyMs.workRun.averageMs, 2_000);
  assert.equal(report.latencyMs.notificationQueueToFirstAttempt.averageMs, 60_000);
  assert.equal(report.latencyMs.notificationQueueToConfirmation.averageMs, 80_000);
  assert.equal(report.latencyMs.providerFailure.averageMs, 250);
  assert.equal(
    new Date(report.range.asOf).getTime(),
    new Date(report.generatedAt).getTime(),
  );
});

test("operational summary rejects invalid or excessively wide windows", async () => {
  await assert.rejects(
    getOperationalSummary(identity, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-04-10T00:00:00.000Z",
    }),
    /INVALID_OPERATIONAL_WINDOW/,
  );
});