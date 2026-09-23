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

async function executeApproved(
  owner: typeof identity,
  toolName: string,
  args: Record<string, unknown>,
  requestId: string,
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
  }) as Record<string, unknown>;
}

test("commitment deadline uses a versioned edge trigger and reuses Agent Work", async () => {
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY = "true";
  await cleanup();
  const now = Date.now();
  const firstDeadline = new Date(now + 2_000);
  const secondDeadline = new Date(now + 5_000);

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
  assert.equal(initialEvents.length, 1);
  assert.equal(initialEvents[0]?.eventType, "commitment.deadline");
  assert.equal(initialEvents[0]?.availableAt.toISOString(), firstDeadline.toISOString());

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
    new Date(now + 3_000),
    20,
  );
  assert.equal(oldDeadline.processed, 1);
  assert.equal(await workCount(identity), 0);

  const atNewDeadline = await new TriggerOutboxDispatcher().tick(
    new Date(now + 6_000),
    20,
  );
  assert.equal(atNewDeadline.processed, 1);
  assert.equal(await workCount(identity), 1);

  const runner = await new AgentWorkRunner().tick(new Date(now + 6_000));
  assert.equal(runner.completed, 1);

  const closed = await executeApproved(identity, "update_commitment", {
    commitmentId,
    status: "closed",
  }, "trigger-stress-commitment-close");
  assert.equal(closed.ok, true);
  const closedDeadline = await new TriggerOutboxDispatcher().tick(
    new Date(now + 7_000),
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
