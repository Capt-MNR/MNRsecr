import { and, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import {
  authMembershipsTable,
  commitmentsTable,
  db,
  remindersTable,
  tasksTable,
  triggerOutboxTable,
} from "@workspace/db";
import type { DbExecutor, Identity } from "./entity-graph";
import { logger } from "./logger";
import { enqueueTriggerOutbox } from "./trigger-outbox";

export type ProactiveDeadlineRecord = {
  entityType: "task" | "commitment" | "reminder";
  entityId: string;
  title: string;
  dueAt: Date | null;
  status: string;
  rowVersion: number;
  occurredAt: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const allowDevelopmentIdentity = process.env.NODE_ENV !== "production"
  && ["1", "true", "yes", "on"].includes(
    (process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY ?? "false").trim().toLowerCase(),
  );
const developmentTenantId = process.env.SECRETARY_TENANT_ID ?? "development";
const developmentUserId = process.env.SECRETARY_USER_ID ?? "dev-user";

function isActive(input: ProactiveDeadlineRecord): boolean {
  if (input.entityType === "task") return ["pending", "in_progress"].includes(input.status);
  if (input.entityType === "reminder") return ["scheduled", "pending", "open", "active"].includes(input.status);
  return ["open", "active", "in_progress", "pending"].includes(input.status);
}

/**
 * Schedules the approaching window for deadlines, a distinct due-time event
 * for reminders, and a separate overdue event for tasks and commitments.
 * Event identity follows the explicit deadline mutation version.
 */
export async function enqueueProactiveDeadlineTriggers(
  identity: Identity,
  input: ProactiveDeadlineRecord,
  executor: DbExecutor,
  writer: typeof enqueueTriggerOutbox = enqueueTriggerOutbox,
): Promise<void> {
  if (!input.dueAt || !Number.isFinite(input.dueAt.getTime()) || !isActive(input)) return;

  const dueAt = input.dueAt;
  const deadlineVersion = `v${input.rowVersion}`;
  const approachingAt = new Date(Math.max(
    input.occurredAt.getTime(),
    dueAt.getTime() - DAY_MS,
  ));
  if (input.entityType !== "reminder" || dueAt.getTime() > input.occurredAt.getTime()) {
    await writer({
      identity,
      eventType: `${input.entityType}.approaching`,
      aggregateType: input.entityType,
      aggregateId: input.entityId,
      occurredAt: input.occurredAt,
      availableAt: approachingAt,
      payload: {
        entityType: input.entityType,
        entityId: input.entityId,
        title: input.title,
        status: input.status,
        dueAt: dueAt.toISOString(),
        rowVersion: input.rowVersion,
        window: "next-24-hours",
      },
      dedupeKey: [
        "proactive-deadline:v1",
        input.entityType,
        input.entityId,
        "approaching",
        deadlineVersion,
        dueAt.toISOString(),
      ].join(":"),
    }, executor);
  }

  if (input.entityType === "reminder") {
    await writer({
      identity,
      eventType: "reminder.due",
      aggregateType: "reminder",
      aggregateId: input.entityId,
      occurredAt: dueAt,
      availableAt: dueAt,
      payload: {
        entityType: "reminder",
        entityId: input.entityId,
        title: input.title,
        status: input.status,
        dueAt: dueAt.toISOString(),
        rowVersion: input.rowVersion,
        window: "due-time",
      },
      dedupeKey: [
        "proactive-deadline:v1",
        "reminder",
        input.entityId,
        "due-time",
        deadlineVersion,
        dueAt.toISOString(),
      ].join(":"),
    }, executor);
    return;
  }

  if (input.entityType !== "task" && input.entityType !== "commitment") return;
  await writer({
    identity,
    eventType: `${input.entityType}.overdue`,
    aggregateType: input.entityType,
    aggregateId: input.entityId,
    occurredAt: input.occurredAt,
    availableAt: dueAt,
    payload: {
      entityType: input.entityType,
      entityId: input.entityId,
      title: input.title,
      status: input.status,
      dueAt: dueAt.toISOString(),
      rowVersion: input.rowVersion,
      window: "overdue",
    },
    dedupeKey: [
      "proactive-deadline:v1",
      input.entityType,
      input.entityId,
      "overdue",
      deadlineVersion,
      dueAt.toISOString(),
    ].join(":"),
  }, executor);
}

/**
 * Reconcile saved deadlines into the existing trigger outbox at startup.
 * Past active reminders are included so reminders whose due trigger predates
 * this lifecycle are caught up from durable record and outbox state.
 */
export async function seedProactiveDeadlineEvents(
  now = new Date(),
  executor: DbExecutor = db,
): Promise<number> {
  const [tasks, commitments, reminders] = await Promise.all([
    executor.select({
      id: tasksTable.id,
      tenantId: tasksTable.tenantId,
      ownerUserId: tasksTable.ownerUserId,
      title: tasksTable.title,
      dueAt: tasksTable.dueAt,
      status: tasksTable.status,
      rowVersion: tasksTable.rowVersion,
    }).from(tasksTable).leftJoin(authMembershipsTable, and(
      eq(authMembershipsTable.tenantId, tasksTable.tenantId),
      eq(authMembershipsTable.userId, tasksTable.ownerUserId),
    )).where(and(
      or(
        eq(authMembershipsTable.userId, tasksTable.ownerUserId),
        allowDevelopmentIdentity
          ? and(
            eq(tasksTable.tenantId, developmentTenantId),
            eq(tasksTable.ownerUserId, developmentUserId),
          )
          : undefined,
      ),
      inArray(tasksTable.status, ["pending", "in_progress"]),
      gt(tasksTable.dueAt, now),
    )),
    executor.select({
      id: commitmentsTable.id,
      tenantId: commitmentsTable.tenantId,
      ownerUserId: commitmentsTable.ownerUserId,
      title: commitmentsTable.title,
      dueAt: commitmentsTable.dueAt,
      status: commitmentsTable.status,
      rowVersion: commitmentsTable.rowVersion,
    }).from(commitmentsTable).leftJoin(authMembershipsTable, and(
      eq(authMembershipsTable.tenantId, commitmentsTable.tenantId),
      eq(authMembershipsTable.userId, commitmentsTable.ownerUserId),
    )).where(and(
      or(
        eq(authMembershipsTable.userId, commitmentsTable.ownerUserId),
        allowDevelopmentIdentity
          ? and(
            eq(commitmentsTable.tenantId, developmentTenantId),
            eq(commitmentsTable.ownerUserId, developmentUserId),
          )
          : undefined,
      ),
      inArray(commitmentsTable.status, ["open", "active", "in_progress", "pending"]),
      gt(commitmentsTable.dueAt, now),
    )),
    executor.select({
      id: remindersTable.id,
      tenantId: remindersTable.tenantId,
      ownerUserId: remindersTable.ownerUserId,
      title: remindersTable.text,
      dueAt: remindersTable.dueAt,
      status: remindersTable.status,
      rowVersion: remindersTable.rowVersion,
    }).from(remindersTable).leftJoin(authMembershipsTable, and(
      eq(authMembershipsTable.tenantId, remindersTable.tenantId),
      eq(authMembershipsTable.userId, remindersTable.ownerUserId),
    )).where(and(
      or(
        eq(authMembershipsTable.userId, remindersTable.ownerUserId),
        allowDevelopmentIdentity
          ? and(
            eq(remindersTable.tenantId, developmentTenantId),
            eq(remindersTable.ownerUserId, developmentUserId),
          )
          : undefined,
      ),
      inArray(remindersTable.status, ["scheduled", "pending", "open", "active"]),
      isNotNull(remindersTable.dueAt),
    )),
  ]);

  for (const row of tasks) {
    await enqueueProactiveDeadlineTriggers(
      { tenantId: row.tenantId, userId: row.ownerUserId },
      { ...row, entityId: row.id, entityType: "task", occurredAt: now },
      executor,
    );
  }
  for (const row of commitments) {
    await enqueueProactiveDeadlineTriggers(
      { tenantId: row.tenantId, userId: row.ownerUserId },
      { ...row, entityId: row.id, entityType: "commitment", occurredAt: now },
      executor,
    );
  }
  for (const row of reminders) {
    const dueAt = row.dueAt?.toISOString();
    if (!dueAt) continue;
    const [existingDueEvent] = await executor.select({
      eventId: triggerOutboxTable.id,
      status: triggerOutboxTable.status,
    }).from(triggerOutboxTable).where(and(
      eq(triggerOutboxTable.tenantId, row.tenantId),
      eq(triggerOutboxTable.ownerUserId, row.ownerUserId),
      eq(triggerOutboxTable.eventType, "reminder.due"),
      eq(triggerOutboxTable.aggregateType, "reminder"),
      eq(triggerOutboxTable.aggregateId, row.id),
      sql`${triggerOutboxTable.payload}->>'dueAt' = ${dueAt}`,
    )).limit(1);
    if (existingDueEvent) {
      if (existingDueEvent.status === "quarantined") {
        logger.warn({
          eventId: existingDueEvent.eventId,
          tenantId: row.tenantId,
          ownerUserId: row.ownerUserId,
          reminderId: row.id,
          dueAt,
        }, "reminder due trigger is quarantined; reconciliation will not duplicate it");
      }
      continue;
    }

    await enqueueProactiveDeadlineTriggers(
      { tenantId: row.tenantId, userId: row.ownerUserId },
      { ...row, entityId: row.id, entityType: "reminder", occurredAt: now },
      executor,
    );
  }
  return tasks.length + commitments.length + reminders.length;
}

/** @deprecated Use seedProactiveDeadlineEvents for all deadline windows. */
export const seedUpcomingProactiveDeadlineEvents = seedProactiveDeadlineEvents;