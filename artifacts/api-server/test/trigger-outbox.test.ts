import assert from "node:assert/strict";
import test from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  agentWorkEvidenceTable,
  agentWorkEventsTable,
  agentWorkRunsTable,
  agentWorksTable,
  activityEventEntitiesTable,
  activityEventsTable,
  db,
  secretaryOperationsTable,
  tasksTable,
  triggerOutboxTable,
} from "@workspace/db";
import { executeStructuredTool } from "../src/lib/phase2";
import { claimOperation, createPendingOperation } from "../src/lib/secretary-operations";
import {
  enqueueTriggerOutbox,
  evaluateTriggerEvent,
  TriggerOutboxDispatcher,
} from "../src/lib/trigger-outbox";
import { AgentWorkRunner } from "../src/lib/agent-work/runner";
import { agentWorkRuntime } from "../src/lib/agent-work/runtime";

const identity = {
  tenantId: `trigger-outbox-${process.pid}-${Date.now()}`,
  userId: "trigger-owner",
};

async function cleanup() {
  const works = await db.select({ id: agentWorksTable.id }).from(agentWorksTable).where(and(
    eq(agentWorksTable.tenantId, identity.tenantId),
    eq(agentWorksTable.ownerUserId, identity.userId),
  ));
  const workIds = works.map((work) => work.id);
  if (workIds.length > 0) {
    await db.delete(agentWorkEventsTable).where(and(
      eq(agentWorkEventsTable.tenantId, identity.tenantId),
      eq(agentWorkEventsTable.ownerUserId, identity.userId),
      inArray(agentWorkEventsTable.workId, workIds),
    ));
    await db.delete(agentWorkEvidenceTable).where(and(
      eq(agentWorkEvidenceTable.tenantId, identity.tenantId),
      eq(agentWorkEvidenceTable.ownerUserId, identity.userId),
      inArray(agentWorkEvidenceTable.workId, workIds),
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
  await db.delete(activityEventEntitiesTable).where(and(
    eq(activityEventEntitiesTable.tenantId, identity.tenantId),
    eq(activityEventEntitiesTable.ownerUserId, identity.userId),
  ));
  await db.delete(activityEventsTable).where(and(
    eq(activityEventsTable.tenantId, identity.tenantId),
    eq(activityEventsTable.ownerUserId, identity.userId),
  ));
  await db.delete(triggerOutboxTable).where(and(
    eq(triggerOutboxTable.tenantId, identity.tenantId),
    eq(triggerOutboxTable.ownerUserId, identity.userId),
  ));
  await db.delete(tasksTable).where(and(
    eq(tasksTable.tenantId, identity.tenantId),
    eq(tasksTable.ownerUserId, identity.userId),
  ));
  await db.delete(secretaryOperationsTable).where(and(
    eq(secretaryOperationsTable.tenantId, identity.tenantId),
    eq(secretaryOperationsTable.ownerUserId, identity.userId),
  ));
}

async function approvedCreateTaskOperation(label: string): Promise<string> {
  const pending = await createPendingOperation(identity, {
    toolName: "create_task",
    args: { title: label },
    idempotencyKey: `trigger-outbox-operation:${label}`,
  });
  const claimed = await claimOperation(identity, pending.operationId);
  assert.equal(claimed.kind, "claimed");
  return claimed.operation.operationId;
}

test("task creation and trigger outbox insertion commit atomically", async () => {
  process.env.AGENT_WORK_ENABLED = "true";
  await cleanup();
  const operationId = await approvedCreateTaskOperation("مهمة outbox");

  const result = await executeStructuredTool(identity, "create_task", {
    title: "مهمة outbox",
  }, {
    requestId: "trigger-outbox-success",
    approvedOperationId: operationId,
  });
  assert.equal(result.ok, true);

  const tasks = await db.select().from(tasksTable).where(and(
    eq(tasksTable.tenantId, identity.tenantId),
    eq(tasksTable.ownerUserId, identity.userId),
  ));
  const events = await db.select().from(triggerOutboxTable).where(and(
    eq(triggerOutboxTable.tenantId, identity.tenantId),
    eq(triggerOutboxTable.ownerUserId, identity.userId),
  ));
  assert.equal(tasks.length, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventType, "task.created");
  assert.equal(events[0]?.aggregateId, tasks[0]?.id);
  await cleanup();
});

test("trigger outbox failure rolls back the task mutation", async () => {
  await cleanup();
  const operationId = await approvedCreateTaskOperation("فشل trigger outbox");

  await assert.rejects(
    executeStructuredTool(identity, "create_task", {
      title: "فشل trigger outbox",
    }, {
      requestId: "trigger-outbox-failure",
      approvedOperationId: operationId,
      triggerOutboxWriter: async () => {
        throw new Error("forced trigger outbox failure");
      },
    }),
    /forced trigger outbox failure/,
  );

  const tasks = await db.select().from(tasksTable).where(and(
    eq(tasksTable.tenantId, identity.tenantId),
    eq(tasksTable.ownerUserId, identity.userId),
  ));
  const events = await db.select().from(triggerOutboxTable).where(and(
    eq(triggerOutboxTable.tenantId, identity.tenantId),
    eq(triggerOutboxTable.ownerUserId, identity.userId),
  ));
  assert.equal(tasks.length, 0);
  assert.equal(events.length, 0);
  await cleanup();
});

test("evaluation is deterministic, dedupe is database-enforced, and tenant ownership is scoped", async () => {
  await cleanup();
  const now = new Date();
  const first = await enqueueTriggerOutbox({
    identity,
    eventType: "task.created",
    aggregateType: "task",
    aggregateId: "task-a",
    occurredAt: now,
    payload: { status: "pending" },
    dedupeKey: "task-created-test:task-a",
  });
  const duplicate = await enqueueTriggerOutbox({
    identity,
    eventType: "task.created",
    aggregateType: "task",
    aggregateId: "task-a",
    occurredAt: now,
    payload: { status: "pending" },
    dedupeKey: "task-created-test:task-a",
  });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.event.eventId, first.event.eventId);
   assert.equal((await evaluateTriggerEvent(first.event)).eligible, true);
   assert.equal((await evaluateTriggerEvent({
    ...first.event,
    payload: { status: "completed" },
   })).eligible, false);

  const otherIdentity = {
    tenantId: `${identity.tenantId}-other`,
    userId: identity.userId,
  };
  const other = await enqueueTriggerOutbox({
    identity: otherIdentity,
    eventType: "task.created",
    aggregateType: "task",
    aggregateId: "task-a",
    occurredAt: now,
    payload: { status: "pending" },
    dedupeKey: "task-created-test:task-a",
  });
  assert.notEqual(other.event.eventId, first.event.eventId);
  await cleanup();
  await db.delete(triggerOutboxTable).where(eq(triggerOutboxTable.tenantId, otherIdentity.tenantId));
});

test("handoff failures retry with backoff and then quarantine", async () => {
  process.env.AGENT_WORK_ENABLED = "true";
  await cleanup();
  await db.delete(triggerOutboxTable).where(like(
    triggerOutboxTable.tenantId,
    "trigger-outbox-%",
  ));
  const occurredAt = new Date();
  const enqueued = await enqueueTriggerOutbox({
    identity,
    eventType: "task.created",
    aggregateType: "task",
    aggregateId: "task-retry",
    occurredAt,
    payload: { status: "pending" },
    dedupeKey: "task-created-test:task-retry",
  });
  const firstNow = new Date(Date.now() + 1_000);
  const originalCreateWork = agentWorkRuntime.createWork;
  agentWorkRuntime.createWork = async () => {
    throw new Error("forced Agent Work handoff failure");
  };
  try {
    const first = await new TriggerOutboxDispatcher({
      now: () => firstNow,
      maxAttempts: 2,
    }).tick(firstNow, 1);
    assert.equal(first.retried, 1);

    const secondNow = new Date(firstNow.getTime() + 5_000);
    const second = await new TriggerOutboxDispatcher({
      now: () => secondNow,
      maxAttempts: 2,
    }).tick(secondNow, 1);
    assert.equal(second.quarantined, 1);
  } finally {
    agentWorkRuntime.createWork = originalCreateWork;
  }
  const [event] = await db.select().from(triggerOutboxTable).where(eq(
    triggerOutboxTable.id,
    enqueued.event.eventId,
  ));
  assert.equal(event?.status, "quarantined");
  assert.equal(event?.attemptCount, 2);
  await cleanup();
});

test("dispatcher claims concurrently, reclaims expired leases, and hands off without an LLM", async () => {
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY = "true";
  await cleanup();
  await db.delete(triggerOutboxTable).where(like(
    triggerOutboxTable.tenantId,
    "trigger-outbox-%",
  ));
  const occurredAt = new Date();
  const enqueued = await enqueueTriggerOutbox({
    identity,
    eventType: "task.created",
    aggregateType: "task",
    aggregateId: "task-concurrent",
    occurredAt,
    payload: { status: "pending" },
    dedupeKey: "task-created-test:task-concurrent",
  });
  const now = new Date(Date.now() + 1_000);

  const [one, two] = await Promise.all([
    new TriggerOutboxDispatcher({ now: () => now, leaseMs: 30_000 }).tick(now, 1),
    new TriggerOutboxDispatcher({ now: () => now, leaseMs: 30_000 }).tick(now, 1),
  ]);
  assert.equal(one.inspected + two.inspected, 1);
  assert.equal(one.processed + two.processed, 1);

  const [work] = await db.select().from(agentWorksTable).where(and(
    eq(agentWorksTable.tenantId, identity.tenantId),
    eq(agentWorksTable.ownerUserId, identity.userId),
  ));
  assert.ok(work);
  assert.equal(work?.source && (work.source as Record<string, unknown>).eventId, enqueued.event.eventId);
  assert.equal(work?.status, "active");

  const runnerResult = await new AgentWorkRunner({ now: () => now }).tick(now);
  assert.equal(runnerResult.completed, 1);
  const [completedWork] = await db.select().from(agentWorksTable).where(eq(agentWorksTable.id, work?.id ?? ""));
  assert.equal(completedWork?.status, "completed");
  const runs = await db.select().from(agentWorkRunsTable).where(eq(agentWorkRunsTable.workId, work?.id ?? ""));
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.status, "verified");

  await db.update(triggerOutboxTable).set({
    status: "claimed",
    leaseToken: "stale-worker-token",
    leaseExpiresAt: new Date(now.getTime() - 1),
    attemptCount: 1,
    updatedAt: now,
  }).where(eq(triggerOutboxTable.id, enqueued.event.eventId));
  const reclaimed = await new TriggerOutboxDispatcher({
    now: () => now,
    leaseMs: 30_000,
  }).tick(now, 1);
  assert.equal(reclaimed.inspected, 1);
  assert.equal(reclaimed.coalesced, 1);
  const staleCompletion = await db.update(triggerOutboxTable).set({
    status: "processed",
    processedAt: now,
  }).where(and(
    eq(triggerOutboxTable.id, enqueued.event.eventId),
    eq(triggerOutboxTable.status, "claimed"),
    eq(triggerOutboxTable.leaseToken, "stale-worker-token"),
  )).returning();
  assert.equal(staleCompletion.length, 0);
  await cleanup();
});