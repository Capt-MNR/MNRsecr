import {
  and,
  eq,
  gt,
  gte,
  inArray,
  lt,
  sql,
} from "drizzle-orm";
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
import {
  GetOperationalSummaryResponse,
  GetOperationalSummaryQueryParams,
} from "@workspace/api-zod";
import type { Identity } from "./secretary";
import { z } from "zod";

const MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1_000;
const TRIGGER_DELAY_SLA_MS = 60_000;
type OperationalSummaryQuery = z.infer<typeof GetOperationalSummaryQueryParams>;

export class InvalidOperationalWindowError extends Error {
  constructor() {
    super("INVALID_OPERATIONAL_WINDOW");
    this.name = "InvalidOperationalWindowError";
  }
}

type CountRows = Array<{ value: number | string | null }>;
type MetricRows = Array<{
  count: number | string;
  averageMs: number | string | null;
  maxMs: number | string | null;
}>;

function countOf(rows: CountRows): number {
  return Math.max(0, Number(rows[0]?.value ?? 0));
}

function nullableNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function metricOf(rows: MetricRows) {
  const row = rows[0];
  return {
    count: Math.max(0, Number(row?.count ?? 0)),
    averageMs: nullableNumber(row?.averageMs),
    maxMs: nullableNumber(row?.maxMs),
  };
}

function validateWindow(input: OperationalSummaryQuery): {
  from: Date;
  to: Date;
} {
  const from = new Date(input.from);
  const to = new Date(input.to);
  if (
    !Number.isFinite(from.getTime())
    || !Number.isFinite(to.getTime())
    || from >= to
    || to.getTime() - from.getTime() > MAX_WINDOW_MS
  ) {
    throw new InvalidOperationalWindowError();
  }
  return { from, to };
}

export async function getOperationalSummary(
  identity: Identity,
  input: OperationalSummaryQuery,
) {
  const { from, to } = validateWindow(input);
  const generatedAt = new Date();
  const overdueBefore = new Date(generatedAt.getTime() - TRIGGER_DELAY_SLA_MS);

  const countQueries = [
    db.select({ value: sql<number>`count(*)::int` }).from(triggerOutboxTable).where(and(
      eq(triggerOutboxTable.tenantId, identity.tenantId),
      eq(triggerOutboxTable.ownerUserId, identity.userId),
      gte(triggerOutboxTable.createdAt, from),
      lt(triggerOutboxTable.createdAt, to),
    )),
    db.select({ value: sql<number>`count(*)::int` }).from(triggerOutboxTable).where(and(
      eq(triggerOutboxTable.tenantId, identity.tenantId),
      eq(triggerOutboxTable.ownerUserId, identity.userId),
      gte(triggerOutboxTable.processedAt, from),
      lt(triggerOutboxTable.processedAt, to),
    )),
    db.select({ value: sql<number>`count(*)::int` }).from(triggerOutboxTable).where(and(
      eq(triggerOutboxTable.tenantId, identity.tenantId),
      eq(triggerOutboxTable.ownerUserId, identity.userId),
      gte(triggerOutboxTable.processedAt, from),
      lt(triggerOutboxTable.processedAt, to),
      sql`${triggerOutboxTable.processedAt} - ${triggerOutboxTable.availableAt} > interval '1 minute'`,
    )),
    db.select({ value: sql<number>`count(*)::int` }).from(triggerOutboxTable).where(and(
      eq(triggerOutboxTable.tenantId, identity.tenantId),
      eq(triggerOutboxTable.ownerUserId, identity.userId),
      gte(triggerOutboxTable.quarantinedAt, from),
      lt(triggerOutboxTable.quarantinedAt, to),
    )),
    db.select({ value: sql<number>`count(*)::int` }).from(triggerOutboxTable).where(and(
      eq(triggerOutboxTable.tenantId, identity.tenantId),
      eq(triggerOutboxTable.ownerUserId, identity.userId),
      inArray(triggerOutboxTable.status, ["pending", "claimed"]),
      lt(triggerOutboxTable.availableAt, overdueBefore),
      lt(triggerOutboxTable.createdAt, generatedAt),
    )),
    db.select({ value: sql<number>`count(*)::int` }).from(agentWorksTable).where(and(
      eq(agentWorksTable.tenantId, identity.tenantId),
      eq(agentWorksTable.ownerUserId, identity.userId),
      gte(agentWorksTable.createdAt, from),
      lt(agentWorksTable.createdAt, to),
    )),
    db.select({ value: sql<number>`count(*)::int` }).from(agentWorkEventsTable).where(and(
      eq(agentWorkEventsTable.tenantId, identity.tenantId),
      eq(agentWorkEventsTable.ownerUserId, identity.userId),
      eq(agentWorkEventsTable.eventType, "run_completed"),
      gte(agentWorkEventsTable.occurredAt, from),
      lt(agentWorkEventsTable.occurredAt, to),
    )),
    db.select({ value: sql<number>`count(*)::int` }).from(agentWorkEventsTable).where(and(
      eq(agentWorkEventsTable.tenantId, identity.tenantId),
      eq(agentWorkEventsTable.ownerUserId, identity.userId),
      eq(agentWorkEventsTable.eventType, "run_failed"),
      gte(agentWorkEventsTable.occurredAt, from),
      lt(agentWorkEventsTable.occurredAt, to),
    )),
    db.select({ value: sql<number>`count(*)::int` }).from(agentWorkEventsTable).where(and(
      eq(agentWorkEventsTable.tenantId, identity.tenantId),
      eq(agentWorkEventsTable.ownerUserId, identity.userId),
      eq(agentWorkEventsTable.eventType, "run_lease_expired"),
      gte(agentWorkEventsTable.occurredAt, from),
      lt(agentWorkEventsTable.occurredAt, to),
    )),
    db.select({ value: sql<number>`count(*)::int` }).from(notificationOutboxTable).where(and(
      eq(notificationOutboxTable.tenantId, identity.tenantId),
      eq(notificationOutboxTable.ownerUserId, identity.userId),
      gte(notificationOutboxTable.createdAt, from),
      lt(notificationOutboxTable.createdAt, to),
    )),
    db.select({ value: sql<number>`count(*)::int` }).from(notificationDeliveryAttemptsTable).where(and(
      eq(notificationDeliveryAttemptsTable.tenantId, identity.tenantId),
      eq(notificationDeliveryAttemptsTable.ownerUserId, identity.userId),
      gte(notificationDeliveryAttemptsTable.startedAt, from),
      lt(notificationDeliveryAttemptsTable.startedAt, to),
    )),
    db.select({ value: sql<number>`count(*)::int` }).from(notificationDeliveryAttemptsTable).where(and(
      eq(notificationDeliveryAttemptsTable.tenantId, identity.tenantId),
      eq(notificationDeliveryAttemptsTable.ownerUserId, identity.userId),
      gt(notificationDeliveryAttemptsTable.attemptNumber, 1),
      gte(notificationDeliveryAttemptsTable.startedAt, from),
      lt(notificationDeliveryAttemptsTable.startedAt, to),
    )),
    db.select({ value: sql<number>`count(*)::int` }).from(notificationDeliveriesTable).where(and(
      eq(notificationDeliveriesTable.tenantId, identity.tenantId),
      eq(notificationDeliveriesTable.ownerUserId, identity.userId),
      gte(notificationDeliveriesTable.confirmedAt, from),
      lt(notificationDeliveriesTable.confirmedAt, to),
    )),
    db.select({ value: sql<number>`count(*)::int` }).from(operationalProviderFailuresTable).where(and(
      eq(operationalProviderFailuresTable.tenantId, identity.tenantId),
      eq(operationalProviderFailuresTable.ownerUserId, identity.userId),
      gte(operationalProviderFailuresTable.completedAt, from),
      lt(operationalProviderFailuresTable.completedAt, to),
    )),
  ];

  const latencyQueries = [
    db.select({
      count: sql<number>`count(*)::int`,
      averageMs: sql<string | null>`avg(extract(epoch from (${agentWorksTable.createdAt} - ${triggerOutboxTable.occurredAt})) * 1000)`,
      maxMs: sql<string | null>`max(extract(epoch from (${agentWorksTable.createdAt} - ${triggerOutboxTable.occurredAt})) * 1000)`,
    }).from(triggerOutboxTable)
      .innerJoin(agentWorksTable, sql`${agentWorksTable.source}->>'eventId' = ${triggerOutboxTable.id}::text`)
      .where(and(
        eq(triggerOutboxTable.tenantId, identity.tenantId),
        eq(triggerOutboxTable.ownerUserId, identity.userId),
        eq(agentWorksTable.tenantId, identity.tenantId),
        eq(agentWorksTable.ownerUserId, identity.userId),
        gte(triggerOutboxTable.occurredAt, from),
        lt(triggerOutboxTable.occurredAt, to),
      )),
    db.select({
      count: sql<number>`count(*)::int`,
      averageMs: sql<string | null>`avg(extract(epoch from (${agentWorkRunsTable.completedAt} - ${agentWorkRunsTable.startedAt})) * 1000)`,
      maxMs: sql<string | null>`max(extract(epoch from (${agentWorkRunsTable.completedAt} - ${agentWorkRunsTable.startedAt})) * 1000)`,
    }).from(agentWorkRunsTable).where(and(
      eq(agentWorkRunsTable.tenantId, identity.tenantId),
      eq(agentWorkRunsTable.ownerUserId, identity.userId),
      gte(agentWorkRunsTable.completedAt, from),
      lt(agentWorkRunsTable.completedAt, to),
      sql`${agentWorkRunsTable.startedAt} is not null`,
    )),
    db.select({
      count: sql<number>`count(*)::int`,
      averageMs: sql<string | null>`avg(extract(epoch from (${notificationDeliveryAttemptsTable.startedAt} - ${notificationOutboxTable.createdAt})) * 1000)`,
      maxMs: sql<string | null>`max(extract(epoch from (${notificationDeliveryAttemptsTable.startedAt} - ${notificationOutboxTable.createdAt})) * 1000)`,
    }).from(notificationDeliveryAttemptsTable)
      .innerJoin(notificationDeliveriesTable, eq(
        notificationDeliveryAttemptsTable.deliveryId,
        notificationDeliveriesTable.id,
      ))
      .innerJoin(notificationOutboxTable, eq(
        notificationDeliveriesTable.notificationId,
        notificationOutboxTable.id,
      ))
      .where(and(
        eq(notificationDeliveryAttemptsTable.tenantId, identity.tenantId),
        eq(notificationDeliveryAttemptsTable.ownerUserId, identity.userId),
        eq(notificationDeliveriesTable.tenantId, identity.tenantId),
        eq(notificationDeliveriesTable.ownerUserId, identity.userId),
        eq(notificationOutboxTable.tenantId, identity.tenantId),
        eq(notificationOutboxTable.ownerUserId, identity.userId),
        eq(notificationDeliveryAttemptsTable.attemptNumber, 1),
        gte(notificationDeliveryAttemptsTable.startedAt, from),
        lt(notificationDeliveryAttemptsTable.startedAt, to),
      )),
    db.select({
      count: sql<number>`count(*)::int`,
      averageMs: sql<string | null>`avg(extract(epoch from (${notificationDeliveriesTable.confirmedAt} - ${notificationOutboxTable.createdAt})) * 1000)`,
      maxMs: sql<string | null>`max(extract(epoch from (${notificationDeliveriesTable.confirmedAt} - ${notificationOutboxTable.createdAt})) * 1000)`,
    }).from(notificationDeliveriesTable)
      .innerJoin(notificationOutboxTable, eq(
        notificationDeliveriesTable.notificationId,
        notificationOutboxTable.id,
      ))
      .where(and(
        eq(notificationDeliveriesTable.tenantId, identity.tenantId),
        eq(notificationDeliveriesTable.ownerUserId, identity.userId),
        eq(notificationOutboxTable.tenantId, identity.tenantId),
        eq(notificationOutboxTable.ownerUserId, identity.userId),
        gte(notificationDeliveriesTable.confirmedAt, from),
        lt(notificationDeliveriesTable.confirmedAt, to),
      )),
    db.select({
      count: sql<number>`count(*)::int`,
      averageMs: sql<string | null>`avg(${operationalProviderFailuresTable.latencyMs})`,
      maxMs: sql<string | null>`max(${operationalProviderFailuresTable.latencyMs})`,
    }).from(operationalProviderFailuresTable).where(and(
      eq(operationalProviderFailuresTable.tenantId, identity.tenantId),
      eq(operationalProviderFailuresTable.ownerUserId, identity.userId),
      gte(operationalProviderFailuresTable.completedAt, from),
      lt(operationalProviderFailuresTable.completedAt, to),
    )),
  ];

  const [counts, latencyRows] = await Promise.all([
    Promise.all(countQueries),
    Promise.all(latencyQueries),
  ]);
  const [
    triggerTotal,
    triggerProcessed,
    triggerDelayed,
    triggerMissed,
    triggerOverdue,
    workCreated,
    workCompleted,
    workFailed,
    leaseRecoveries,
    notificationsQueued,
    notificationAttempts,
    notificationRetries,
    notificationsConfirmed,
    providerFailures,
  ] = counts.map(countOf);

  return GetOperationalSummaryResponse.parse({
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      asOf: generatedAt.toISOString(),
    },
    triggers: {
      total: triggerTotal,
      processed: triggerProcessed,
      delayed: triggerDelayed,
      missed: triggerMissed,
      overdue: triggerOverdue,
    },
    work: {
      created: workCreated,
      completed: workCompleted,
      failed: workFailed,
      stale: leaseRecoveries,
      leaseRecoveries,
    },
    notifications: {
      queued: notificationsQueued,
      attempts: notificationAttempts,
      retries: notificationRetries,
      confirmed: notificationsConfirmed,
    },
    providerFailures: { count: providerFailures },
    latencyMs: {
      triggerToWork: metricOf(latencyRows[0]),
      workRun: metricOf(latencyRows[1]),
      notificationQueueToFirstAttempt: metricOf(latencyRows[2]),
      notificationQueueToConfirmation: metricOf(latencyRows[3]),
      providerFailure: metricOf(latencyRows[4]),
    },
  });
}