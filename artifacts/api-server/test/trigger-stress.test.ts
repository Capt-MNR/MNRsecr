import assert from "node:assert/strict";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  agentWorkEvidenceTable,
  agentWorkEventsTable,
  agentWorkRunsTable,
  agentWorksTable,
  activityEventEntitiesTable,
  activityEventsTable,
  commitmentsTable,
  db,
  tasksTable,
  triggerOutboxTable,
} from "@workspace/db";
import { executeStructuredTool } from "../src/lib/phase2";
import { AgentWorkRunner } from "../src/lib/agent-work/runner";
import { claimOperation, createPendingOperation } from "../src/lib/secretary-operations";
import {
  enqueueTaskThresholdTrigger,
  enqueueTriggerOutbox,
  TriggerOutboxDispatcher,
} from "../src/lib/trigger-outbox";

const identity = {
  tenantId: `trigger-stress-${process.pid}-${Date.now()}`,
  userId: "stress-owner",
};

const otherIdentity = {
  tenantId: `${identity.tenantId}-other`,
  userId: identity.userId,
};

async function cleanupOwner(owner: typeof identity): Promise<void> {
  const works = await db.select({ id: agentWorksTable.id }).from(agentWorksTable).where(and(
    eq(agentWorksTable.tenantId, owner.tenantId),
    eq(agentWorksTable.ownerUserId, owner.userId),
  ));
  const workIds = works.map((work) => work.id);
  if (workIds.length > 0) {
    await db.delete(agentWorkEventsTable).where(and(
      eq(agentWorkEventsTable.tenantId, owner.tenantId),
      eq(agentWorkEventsTable.ownerUserId, owner.userId),
      inArray(agentWorkEventsTable.workId, workIds),
    ));
    await db.delete(agentWorkEvidenceTable).where(and(
      eq(agentWorkEvidenceTable.tenantId, owner.tenantId),
      eq(agentWorkEvidenceTable.ownerUserId, owner.userId),
      inArray(agentWorkEvidenceTable.workId, workIds),
    ));
    await db.delete(agentWorkRunsTable).where(and(
      eq(agentWorkRunsTable.tenantId, owner.tenantId),
      eq(agentWorkRunsTable.ownerUserId, owner.userId),
      inArray(agentWorkRunsTable.workId, workIds),
    ));
    await db.delete(agentWorksTable).where(and(
      eq(agentWorksTable.tenantId, owner.tenantId),
      eq(agentWorksTable.ownerUserId, owner.userId),
      inArray(agentWorksTable.id, workIds),
    ));
  }
  await db.delete(activityEventEntitiesTable).where(and(
    eq(activityEventEntitiesTable.tenantId, owner.tenantId),
    eq(activityEventEntitiesTable.ownerUserId, owner.userId),
  ));
  await db.delete(activityEventsTable).where(and(
    eq(activityEventsTable.tenantId, owner.tenantId),
    eq(activityEventsTable.ownerUserId, owner.userId),
  ));
  await db.delete(triggerOutboxTable).where(and(
    eq(triggerOutboxTable.tenantId, owner.tenantId),
    eq(triggerOutboxTable.ownerUserId, owner.userId),
  ));
  await db.delete(tasksTable).where(and(
    eq(tasksTable.tenantId, owner.tenantId),
    eq(tasksTable.ownerUserId, owner.userId),
  ));
  await db.delete(commitmentsTable).where(and(
    eq(commitmentsTable.tenantId, owner.tenantId),
    eq(commitmentsTable.ownerUserId, owner.userId),
  ));
}

async function cleanup(): Promise<void> {
  await cleanupOwner(identity);
  await cleanupOwner(otherIdentity);
}

async function workCount(owner: typeof identity): Promise<number> {
  const works = await db.select({ id: agentWorksTable.id }).from(agentWorksTable).where(and(
    eq(agentWorksTable.tenantId, owner.tenantId),
    eq(agentWorksTable.ownerUserId, owner.userId),
  ));
  return works.length;
}

async function thresholdWorkCount(owner: typeof identity): Promise<number> {
  const works = await db.select({ source: agentWorksTable.source }).from(agentWorksTable).where(and(
    eq(agentWorksTable.tenantId, owner.tenantId),
    eq(agentWorksTable.ownerUserId, owner.userId),
  ));
  return works.filter((work) =>
    work.source?.type === "trigger_outbox"
    && work.source?.eventType === "task.open_count_threshold",
  ).length;
}

async function executeApproved(
  owner: typeof identity,
  toolName: string,
  args: Record<string, unknown>,
  requestId: string,
  triggerOutboxWriter?: typeof enqueueTriggerOutbox,
): Promise<Record<string, unknown>> {
  const pending = await createPendingOperation(owner, {
    toolName,
    args,
    idempotencyKey: `trigger-stress:${requestId}`,
  });
  const claimed = await claimOperation(owner, pending.operationId);
  assert.equal(claimed.kind, "claimed");
  return await executeStructuredTool(owner, toolName, args, {
    requestId,
    approvedOperationId: claimed.operation.operationId,
    ...(triggerOutboxWriter ? { triggerOutboxWriter } : {}),
  }) as Record<string, unknown>;
}

test("commitment deadline uses a versioned edge trigger and reuses Agent Work", async () => {
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY = "true";
  await cleanup();
  const now = Date.now();
  const firstDeadline = new Date(now + 30 * 60 * 60 * 1_000);
  const secondDeadline = new Date(now + 60 * 60 * 60 * 1_000);

  const created = await executeApproved(identity, "create_commitment", {
    title: "Deadline stress test",
    dueAt: firstDeadline.toISOString(),
  }, "trigger-stress-commitment-create");
  assert.equal(created.ok, true);
  const commitmentId = String((created as { commitment?: { id: string } }).commitment?.id);
  assert.ok(commitmentId);

  const initialEvents = await db.select().from(triggerOutboxTable).where(and(
    eq(triggerOutboxTable.tenantId, identity.tenantId),
    eq(triggerOutboxTable.ownerUserId, identity.userId),
  ));
  assert.deepEqual(
    initialEvents.map((event) => event.eventType).sort(),
    ["commitment.approaching", "commitment.deadline", "commitment.overdue"],
  );
  const deadlineEvent = initialEvents.find((event) => event.eventType === "commitment.deadline");
  assert.equal(deadlineEvent?.availableAt.toISOString(), firstDeadline.toISOString());

  const beforeDeadline = await new TriggerOutboxDispatcher().tick(
    new Date(now + 1_000),
    20,
  );
  assert.equal(beforeDeadline.inspected, 0);

  const updated = await executeApproved(identity, "update_commitment", {
    commitmentId,
    dueAt: secondDeadline.toISOString(),
  }, "trigger-stress-commitment-update");
  assert.equal(updated.ok, true);

  const oldDeadline = await new TriggerOutboxDispatcher().tick(
    new Date(now + 31 * 60 * 60 * 1_000),
    20,
  );
  assert.equal(oldDeadline.processed, 3);
  assert.equal(await workCount(identity), 0);

  const atNewDeadline = await new TriggerOutboxDispatcher().tick(
    new Date(now + 61 * 60 * 60 * 1_000),
    20,
  );
  assert.equal(atNewDeadline.processed, 2);
  assert.equal(await workCount(identity), 1);

  // This runner is global across tenants. Keep this test scoped to its own
  // WorkIntent instead of consuming unrelated due work from shared fixtures.
  assert.equal(await workCount(identity), 1);

  const closed = await executeApproved(identity, "update_commitment", {
    commitmentId,
    status: "closed",
  }, "trigger-stress-commitment-close");
  assert.equal(closed.ok, true);
  const closedDeadline = await new TriggerOutboxDispatcher().tick(
    new Date(now + 62 * 60 * 60 * 1_000),
    20,
  );
  assert.equal(closedDeadline.processed, 1);
  assert.equal(await workCount(identity), 1);
  await cleanup();
});

test("deadline event/time collision produces one WorkIntent by commitment version", async () => {
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY = "true";
  await cleanup();
  const dueAt = new Date(Date.now() - 1_000);
  const [commitment] = await db.insert(commitmentsTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    title: "Collision commitment",
    dueAt,
    status: "open",
  }).returning();
  assert.ok(commitment);

  const payload = {
    commitmentId: commitment.id,
    dueAt: dueAt.toISOString(),
    status: "open",
    rowVersion: commitment.rowVersion,
  };
  await enqueueTriggerOutbox({
    identity,
    eventType: "commitment.deadline",
    aggregateType: "commitment",
    aggregateId: commitment.id,
    availableAt: dueAt,
    payload,
    dedupeKey: "commitment-time-source:collision",
  });
  await enqueueTriggerOutbox({
    identity,
    eventType: "commitment.deadline",
    aggregateType: "commitment",
    aggregateId: commitment.id,
    availableAt: dueAt,
    payload,
    dedupeKey: "commitment-event-source:collision",
  });

  const dispatched = await new TriggerOutboxDispatcher().tick(new Date(), 20);
  assert.equal(dispatched.processed + dispatched.coalesced, 2);
  assert.equal(await workCount(identity), 1);
  await cleanup();
});

test("task threshold supports edge and level semantics, threshold changes, and tenant isolation", async () => {
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY = "true";
  await cleanup();

  const below = await enqueueTaskThresholdTrigger({
    identity,
    operator: "gte",
    threshold: 2,
    previousValue: 0,
    currentValue: 1,
    transitionKey: "threshold-2-transition-0",
  });
  const belowResult = await new TriggerOutboxDispatcher().tick(new Date(), 20);
  assert.equal(belowResult.processed, 1);
  assert.equal(await workCount(identity), 0);

  const crossed = await enqueueTaskThresholdTrigger({
    identity,
    operator: "gte",
    threshold: 2,
    previousValue: 1,
    currentValue: 2,
    transitionKey: "threshold-2-transition-1",
  });
  const duplicate = await enqueueTaskThresholdTrigger({
    identity,
    operator: "gte",
    threshold: 2,
    previousValue: 1,
    currentValue: 2,
    transitionKey: "threshold-2-transition-1",
  });
  assert.equal(crossed.created, true);
  assert.equal(duplicate.created, false);
  const crossedResult = await new TriggerOutboxDispatcher().tick(new Date(), 20);
  assert.equal(crossedResult.processed, 1);
  assert.equal(await workCount(identity), 1);

  const remainsAbove = await enqueueTaskThresholdTrigger({
    identity,
    operator: "gte",
    threshold: 2,
    previousValue: 2,
    currentValue: 3,
    transitionKey: "threshold-2-transition-1",
  });
  assert.equal(remainsAbove.created, false);
  const remainsResult = await new TriggerOutboxDispatcher().tick(new Date(), 20);
  assert.equal(remainsResult.inspected, 0);

  const levelObservation = await enqueueTriggerOutbox({
    identity,
    eventType: "task.open_count_threshold",
    aggregateType: "task",
    aggregateId: "open-task-count",
    payload: {
      entity: "tasks",
      metric: "open_task_count",
      operator: "gte",
      threshold: 2,
      previousValue: 2,
      currentValue: 3,
      transitionKey: "threshold-2-transition-1",
      mode: "level",
    },
    dedupeKey: "threshold-level-observation-with-new-event",
  });
  assert.equal(levelObservation.created, true);
  const levelResult = await new TriggerOutboxDispatcher().tick(new Date(), 20);
  assert.equal(levelResult.coalesced, 1);
  assert.equal(await workCount(identity), 1);

  const fellBelow = await enqueueTaskThresholdTrigger({
    identity,
    operator: "gte",
    threshold: 2,
    previousValue: 3,
    currentValue: 1,
    transitionKey: "threshold-2-transition-2",
  });
  assert.equal(fellBelow.created, true);
  const fellResult = await new TriggerOutboxDispatcher().tick(new Date(), 20);
  assert.equal(fellResult.processed, 1);
  assert.equal(await workCount(identity), 1);

  const crossedAgain = await enqueueTaskThresholdTrigger({
    identity,
    operator: "gte",
    threshold: 2,
    previousValue: 1,
    currentValue: 2,
    transitionKey: "threshold-2-transition-3",
  });
  const crossedAgainResult = await new TriggerOutboxDispatcher().tick(new Date(), 20);
  assert.equal(crossedAgainResult.processed, 1);
  assert.equal(await workCount(identity), 2);

  const changedThreshold = await enqueueTaskThresholdTrigger({
    identity,
    operator: "gte",
    threshold: 3,
    previousValue: 2,
    currentValue: 3,
    transitionKey: "threshold-3-transition-1",
  });
  const changedThresholdResult = await new TriggerOutboxDispatcher().tick(new Date(), 20);
  assert.equal(changedThresholdResult.processed, 1);
  assert.equal(await workCount(identity), 3);

  const otherTenant = await enqueueTaskThresholdTrigger({
    identity: otherIdentity,
    operator: "gte",
    threshold: 2,
    previousValue: 1,
    currentValue: 2,
    transitionKey: "threshold-2-transition-3",
  });
  assert.equal(otherTenant.created, true);
  const otherResult = await new TriggerOutboxDispatcher().tick(new Date(), 20);
  assert.equal(otherResult.processed, 1);
  assert.equal(await workCount(otherIdentity), 1);
  assert.equal(await workCount(identity), 3);

  const runnerResult = await new AgentWorkRunner().tick(new Date());
  assert.equal(runnerResult.completed, 4);
  await cleanup();
});

test("task mutations emit threshold events only when the open count changes", async () => {
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY = "true";
  await cleanup();

  await db.insert(agentWorksTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    kind: "monitor",
    title: "Open task count alert",
    status: "active",
    source: { type: "internal_records" },
    condition: {
      entity: "tasks",
      metric: "open_task_count",
      operator: "gte",
      threshold: 1,
    },
    action: { type: "notify" },
    schedule: { frequency: "event" },
    dedupeKey: `task-count-monitor:${identity.tenantId}`,
  });

  const thresholdEvents = async () => db.select().from(triggerOutboxTable).where(and(
    eq(triggerOutboxTable.tenantId, identity.tenantId),
    eq(triggerOutboxTable.ownerUserId, identity.userId),
    eq(triggerOutboxTable.eventType, "task.open_count_threshold"),
  ));
  const dispatch = () => new TriggerOutboxDispatcher().tick(new Date(), 20);
  await assert.rejects(
    executeApproved(identity, "create_task", {
      title: "Rolled back threshold task",
    }, "trigger-stress-task-threshold-rollback", async () => {
      throw new Error("forced task threshold trigger failure");
    }),
    /forced task threshold trigger failure/,
  );
  assert.equal((await db.select().from(tasksTable).where(and(
    eq(tasksTable.tenantId, identity.tenantId),
    eq(tasksTable.ownerUserId, identity.userId),
  ))).length, 0);
  assert.equal((await thresholdEvents()).length, 0);

  const created = await executeApproved(identity, "create_task", {
    title: "Mutation integration task",
  }, "trigger-stress-task-create");
  const firstTask = (created as {
    task: { id: string; rowVersion: number };
  }).task;
  assert.equal((await thresholdEvents()).length, 1);
  await dispatch();
  assert.equal(await thresholdWorkCount(identity), 1);

  const inProgress = await executeApproved(identity, "update_task", {
    taskId: firstTask.id,
    status: "in_progress",
    expectedRowVersion: firstTask.rowVersion,
  }, "trigger-stress-task-in-progress");
  assert.equal((inProgress as { ok: boolean }).ok, true);
  assert.equal((await thresholdEvents()).length, 1);

  const completed = await executeApproved(identity, "update_task", {
    taskId: firstTask.id,
    status: "completed",
    expectedRowVersion: (inProgress as { task: { rowVersion: number } }).task.rowVersion,
  }, "trigger-stress-task-complete");
  assert.equal((completed as { ok: boolean }).ok, true);
  assert.equal((await thresholdEvents()).length, 2);
  await dispatch();
  assert.equal(await thresholdWorkCount(identity), 1);

  const reopened = await executeApproved(identity, "update_task", {
    taskId: firstTask.id,
    status: "pending",
    expectedRowVersion: (completed as { task: { rowVersion: number } }).task.rowVersion,
  }, "trigger-stress-task-reopen");
  assert.equal((reopened as { ok: boolean }).ok, true);
  assert.equal((await thresholdEvents()).length, 3);
  await dispatch();
  assert.equal(await thresholdWorkCount(identity), 2);

  const cancelled = await executeApproved(identity, "update_task", {
    taskId: firstTask.id,
    status: "cancelled",
    expectedRowVersion: (reopened as { task: { rowVersion: number } }).task.rowVersion,
  }, "trigger-stress-task-cancel");
  assert.equal((cancelled as { ok: boolean }).ok, true);
  assert.equal((await thresholdEvents()).length, 4);
  await dispatch();
  assert.equal(await thresholdWorkCount(identity), 2);

  const secondCreated = await executeApproved(identity, "create_task", {
    title: "Delete integration task",
  }, "trigger-stress-task-delete-create");
  const secondTask = (secondCreated as {
    task: { id: string; createdAt: string; rowVersion: number };
  }).task;
  assert.equal((await thresholdEvents()).length, 5);
  await dispatch();
  assert.equal(await thresholdWorkCount(identity), 3);

  const deleted = await executeApproved(identity, "delete_task", {
    taskId: secondTask.id,
    expectedCreatedAt: new Date(secondTask.createdAt).toISOString(),
  }, "trigger-stress-task-delete");
  assert.equal((deleted as { ok: boolean }).ok, true);
  assert.equal((await thresholdEvents()).length, 6);
  await dispatch();
  assert.equal(await thresholdWorkCount(identity), 3);

  const deleteClosed = await executeApproved(identity, "delete_task", {
    taskId: firstTask.id,
    expectedCreatedAt: new Date((created as { task: { createdAt: string } }).task.createdAt).toISOString(),
  }, "trigger-stress-task-delete-closed");
  assert.equal((deleteClosed as { ok: boolean }).ok, true);
  assert.equal((await thresholdEvents()).length, 6);
  await cleanup();
});

test("concurrent task creates produce one threshold WorkIntent for one crossing", async () => {
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY = "true";
  const owner = {
    tenantId: `${identity.tenantId}-concurrent`,
    userId: identity.userId,
  };
  await cleanupOwner(owner);

  await db.insert(agentWorksTable).values({
    tenantId: owner.tenantId,
    ownerUserId: owner.userId,
    kind: "monitor",
    title: "Concurrent open task count alert",
    status: "active",
    source: { type: "internal_records" },
    condition: {
      entity: "tasks",
      metric: "open_task_count",
      operator: "gte",
      threshold: 1,
    },
    action: { type: "notify" },
    schedule: { frequency: "event" },
    dedupeKey: `concurrent-task-count-monitor:${owner.tenantId}`,
  });

  const [first, second] = await Promise.all([
    executeApproved(owner, "create_task", {
      title: "Concurrent task one",
    }, "trigger-stress-concurrent-task-one"),
    executeApproved(owner, "create_task", {
      title: "Concurrent task two",
    }, "trigger-stress-concurrent-task-two"),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  const tasks = await db.select().from(tasksTable).where(and(
    eq(tasksTable.tenantId, owner.tenantId),
    eq(tasksTable.ownerUserId, owner.userId),
  ));
  assert.equal(tasks.length, 2);
  const events = await db.select().from(triggerOutboxTable).where(and(
    eq(triggerOutboxTable.tenantId, owner.tenantId),
    eq(triggerOutboxTable.ownerUserId, owner.userId),
    eq(triggerOutboxTable.eventType, "task.open_count_threshold"),
  ));
  assert.equal(events.length, 2);

  const dispatched = await new TriggerOutboxDispatcher().tick(new Date(), 20);
  assert.equal(dispatched.processed + dispatched.coalesced, 4);
  assert.equal(await thresholdWorkCount(owner), 1);

  const firstTask = (first as { task: { id: string; rowVersion: number } }).task;
  const secondTask = (second as { task: { id: string; rowVersion: number } }).task;
  const [firstCompleted, secondCompleted] = await Promise.all([
    executeApproved(owner, "update_task", {
      taskId: firstTask.id,
      status: "completed",
      expectedRowVersion: firstTask.rowVersion,
    }, "trigger-stress-concurrent-task-one-complete"),
    executeApproved(owner, "update_task", {
      taskId: secondTask.id,
      status: "completed",
      expectedRowVersion: secondTask.rowVersion,
    }, "trigger-stress-concurrent-task-two-complete"),
  ]);
  assert.equal(firstCompleted.ok, true);
  assert.equal(secondCompleted.ok, true);
  await new TriggerOutboxDispatcher().tick(new Date(), 20);
  assert.equal(await thresholdWorkCount(owner), 1);

  await Promise.all([
    executeApproved(owner, "update_task", {
      taskId: firstTask.id,
      status: "pending",
      expectedRowVersion: (firstCompleted as { task: { rowVersion: number } }).task.rowVersion,
    }, "trigger-stress-concurrent-task-one-reopen"),
    executeApproved(owner, "update_task", {
      taskId: secondTask.id,
      status: "pending",
      expectedRowVersion: (secondCompleted as { task: { rowVersion: number } }).task.rowVersion,
    }, "trigger-stress-concurrent-task-two-reopen"),
  ]);
  await new TriggerOutboxDispatcher().tick(new Date(), 20);
  assert.equal(await thresholdWorkCount(owner), 2);
  await cleanupOwner(owner);
});

test("task threshold events wait while their Agent Work monitor is paused", async () => {
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY = "true";
  const owner = {
    tenantId: `${identity.tenantId}-paused`,
    userId: identity.userId,
  };
  await cleanupOwner(owner);

  const [monitor] = await db.insert(agentWorksTable).values({
    tenantId: owner.tenantId,
    ownerUserId: owner.userId,
    kind: "monitor",
    title: "Pause-aware open task count alert",
    status: "active",
    source: { type: "internal_records" },
    condition: {
      entity: "tasks",
      metric: "open_task_count",
      operator: "gte",
      threshold: 1,
    },
    action: { type: "notify" },
    schedule: { frequency: "event" },
    dedupeKey: `pause-aware-task-count-monitor:${owner.tenantId}`,
  }).returning();
  assert.ok(monitor);

  await executeApproved(owner, "create_task", {
    title: "Paused monitor task",
  }, "trigger-stress-paused-monitor-task");
  const [event] = await db.select().from(triggerOutboxTable).where(and(
    eq(triggerOutboxTable.tenantId, owner.tenantId),
    eq(triggerOutboxTable.ownerUserId, owner.userId),
    eq(triggerOutboxTable.eventType, "task.open_count_threshold"),
  ));
  assert.ok(event);

  await db.update(agentWorksTable).set({ status: "paused" }).where(and(
    eq(agentWorksTable.tenantId, owner.tenantId),
    eq(agentWorksTable.ownerUserId, owner.userId),
    eq(agentWorksTable.id, monitor.id),
  ));
  const pausedDispatch = await new TriggerOutboxDispatcher().tick(new Date(), 20);
  assert.equal(pausedDispatch.retried, 1);
  assert.equal(await thresholdWorkCount(owner), 0);
  const [deferred] = await db.select().from(triggerOutboxTable).where(eq(
    triggerOutboxTable.id,
    event.id,
  ));
  assert.equal(deferred?.status, "pending");
  assert.equal(deferred?.lastError, "agent_work_not_active");

  await db.update(agentWorksTable).set({ status: "active" }).where(and(
    eq(agentWorksTable.tenantId, owner.tenantId),
    eq(agentWorksTable.ownerUserId, owner.userId),
    eq(agentWorksTable.id, monitor.id),
  ));
  const resumedDispatch = await new TriggerOutboxDispatcher().tick(
    new Date(Date.now() + 10_000),
    20,
  );
  assert.equal(resumedDispatch.processed + resumedDispatch.coalesced, 1);
  assert.equal(await thresholdWorkCount(owner), 1);
  await cleanupOwner(owner);
});

test("global Agent Work disable leaves task threshold events pending for later dispatch", async () => {
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY = "true";
  const owner = {
    tenantId: `${identity.tenantId}-disabled`,
    userId: identity.userId,
  };
  await cleanupOwner(owner);

  await db.insert(agentWorksTable).values({
    tenantId: owner.tenantId,
    ownerUserId: owner.userId,
    kind: "monitor",
    title: "Disabled-aware open task count alert",
    status: "active",
    source: { type: "internal_records" },
    condition: {
      entity: "tasks",
      metric: "open_task_count",
      operator: "gte",
      threshold: 1,
    },
    action: { type: "notify" },
    schedule: { frequency: "event" },
    dedupeKey: `disabled-aware-task-count-monitor:${owner.tenantId}`,
  });

  await executeApproved(owner, "create_task", {
    title: "Globally disabled monitor task",
  }, "trigger-stress-global-disabled-task");
  const [event] = await db.select().from(triggerOutboxTable).where(and(
    eq(triggerOutboxTable.tenantId, owner.tenantId),
    eq(triggerOutboxTable.ownerUserId, owner.userId),
    eq(triggerOutboxTable.eventType, "task.open_count_threshold"),
  ));
  assert.ok(event);

  process.env.AGENT_WORK_ENABLED = "false";
  const disabledDispatch = await new TriggerOutboxDispatcher().tick(new Date(), 20);
  assert.equal(disabledDispatch.enabled, false);
  assert.equal(await thresholdWorkCount(owner), 0);
  const [pending] = await db.select().from(triggerOutboxTable).where(eq(
    triggerOutboxTable.id,
    event.id,
  ));
  assert.equal(pending?.status, "pending");

  process.env.AGENT_WORK_ENABLED = "true";
  const resumedDispatch = await new TriggerOutboxDispatcher().tick(
    new Date(Date.now() + 10_000),
    20,
  );
  assert.equal(resumedDispatch.processed + resumedDispatch.coalesced >= 1, true);
  assert.equal(await thresholdWorkCount(owner), 1);
  await cleanupOwner(owner);
});
