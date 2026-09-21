import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db, secretaryOperationsTable, tasksTable } from "@workspace/db";
import { AgentWorkRunner } from "../src/lib/agent-work/runner.ts";
import { PostgresAgentWorkStorageAdapter } from "../src/lib/agent-work/postgres-storage.ts";
import {
  claimOperation,
  completeOperation,
  getOperation,
} from "../src/lib/secretary-operations.ts";
import { executeApprovedOperation } from "../src/lib/secretary.ts";
import {
  recordAgentWorkActionApproved,
  recordAgentWorkActionRejected,
} from "../src/lib/agent-work/delegated-actions.ts";
import type { AgentWorkAdapters } from "../src/lib/agent-work/types.ts";

test("delegated GitHub condition requests one approval, executes create_task, verifies, and retriggers after clear", async () => {
  process.env.NODE_ENV = "production";
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  process.env.AI_PROVIDER = "development";
  process.env.GITHUB_MONITOR_MAX_AGE_MS = "86400000";

  const now = new Date("2026-09-21T10:00:00.000Z");
  const identity = {
    tenantId: `delegated-action-${process.pid}-${Date.now()}`,
    userId: "delegated-owner",
  };
  const storage = new PostgresAgentWorkStorageAdapter();
  let openIssues = 6;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 1296269,
    full_name: "octocat/Hello-World",
    open_issues_count: openIssues,
    updated_at: now.toISOString(),
  }), {
    status: 200,
    headers: { "content-type": "application/json", date: now.toUTCString() },
  });

  const adapters = {
    scheduler: {
      driver: "stub",
      schedule: async () => ({ scheduled: false, driver: "stub" as const, reason: "test" }),
      cancel: async () => undefined,
    },
    identity: {
      driver: "development",
      resolveRequest: () => identity,
      resolveBackground: (input: { tenantId: string; userId: string }) =>
        input.tenantId === identity.tenantId && input.userId === identity.userId ? identity : null,
    },
    notification: {
      driver: "stub",
      notify: async () => ({ status: "accepted" as const, driver: "stub" as const }),
    },
    storage,
  } satisfies AgentWorkAdapters;

  try {
    const work = await storage.createWork({
      identity,
      kind: "monitor",
      title: "مراجعة GitHub octocat/Hello-World",
      description: "أنشئ مهمة عند تجاوز العناصر المفتوحة للحد.",
      source: { type: "github_repository" },
      condition: {
        provider: "github",
        entity: "repository",
        metric: "open_issues_count",
        owner: "octocat",
        repository: "Hello-World",
        operator: "gt",
        threshold: 5,
      },
      action: {
        type: "create_task",
        toolName: "create_task",
        title: "مراجعة العناصر المفتوحة في octocat/Hello-World",
        requiresApproval: true,
      },
      schedule: { frequency: "interval", minutes: 60 },
      nextRunAt: new Date(now.getTime() - 1_000),
    });
    await storage.changeWorkStatus({
      identity,
      workId: work.id,
      from: "draft",
      to: "active",
      actorType: "user",
      actorId: identity.userId,
    });

    const runner = new AgentWorkRunner({ adapters, now: () => now });
    const first = await runner.tick(now);
    assert.equal(first.claimed, 1);
    assert.equal(first.completed, 1);
    const waiting = await storage.getWork(identity, work.id);
    assert.equal(waiting?.status, "waiting");

    const requestedEvent = (await storage.listEvents(identity, work.id, 20))
      .find((event) => event.eventType === "approval_requested");
    const operationId = requestedEvent?.metadata.operationId;
    assert.equal(typeof operationId, "string");
    const operation = await getOperation(identity, operationId as string);
    assert.equal(operation?.status, "pending");
    assert.equal(operation?.toolName, "create_task");

    const claim = await claimOperation(identity, operationId as string);
    assert.equal(claim.kind, "claimed");
    if (claim.kind !== "claimed") throw new Error("approval was not claimed");
    const result = await executeApprovedOperation(identity, claim.operation);
    const completed = await completeOperation(identity, operationId as string, result);
    await recordAgentWorkActionApproved(identity, completed, result, adapters);

    const resumed = await storage.getWork(identity, work.id);
    assert.equal(resumed?.status, "active");
    const taskRows = await db.select().from(tasksTable).where(and(
      eq(tasksTable.tenantId, identity.tenantId),
      eq(tasksTable.ownerUserId, identity.userId),
    ));
    assert.equal(taskRows.length, 1);
    assert.equal(taskRows[0]?.title, "مراجعة العناصر المفتوحة في octocat/Hello-World");
    assert.ok((await storage.listEvents(identity, work.id, 40)).some((event) => event.eventType === "action_verified"));

    const unchangedAt = new Date("2026-09-21T11:00:00.000Z");
    const unchanged = await runner.tick(unchangedAt);
    assert.equal(unchanged.completed, 1);
    const sameTaskRows = await db.select().from(tasksTable).where(and(
      eq(tasksTable.tenantId, identity.tenantId),
      eq(tasksTable.ownerUserId, identity.userId),
    ));
    assert.equal(sameTaskRows.length, 1);

    openIssues = 2;
    const clearedAt = new Date("2026-09-21T12:00:00.000Z");
    await runner.tick(clearedAt);
    openIssues = 7;
    const reenteredAt = new Date("2026-09-21T13:00:00.000Z");
    await runner.tick(reenteredAt);
    const secondApproval = (await storage.listEvents(identity, work.id, 60))
      .filter((event) => event.eventType === "approval_requested");
    assert.equal(secondApproval.length, 2);
    const secondOperationId = secondApproval.find((event) => event.metadata.operationId !== operationId)?.metadata.operationId;
    assert.equal(typeof secondOperationId, "string");
    const secondOperation = await getOperation(identity, secondOperationId as string);
    assert.equal(secondOperation?.status, "pending");
    await recordAgentWorkActionRejected(identity, secondOperation!, "rejected", adapters);
    assert.equal((await storage.getWork(identity, work.id))?.status, "active");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("expired delegated approval resumes monitoring without executing or requesting a duplicate", async () => {
  process.env.NODE_ENV = "production";
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  process.env.AI_PROVIDER = "development";
  process.env.GITHUB_MONITOR_MAX_AGE_MS = "86400000";

  const now = new Date("2026-09-21T10:00:00.000Z");
  const identity = {
    tenantId: `delegated-expiry-${process.pid}-${Date.now()}`,
    userId: "delegated-owner",
  };
  const storage = new PostgresAgentWorkStorageAdapter();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 1296269,
    full_name: "octocat/Hello-World",
    open_issues_count: 6,
    updated_at: now.toISOString(),
  }), {
    status: 200,
    headers: { "content-type": "application/json", date: now.toUTCString() },
  });

  const adapters = {
    scheduler: {
      driver: "stub",
      schedule: async () => ({ scheduled: false, driver: "stub" as const, reason: "test" }),
      cancel: async () => undefined,
    },
    identity: {
      driver: "development",
      resolveRequest: () => identity,
      resolveBackground: (input: { tenantId: string; userId: string }) =>
        input.tenantId === identity.tenantId && input.userId === identity.userId ? identity : null,
    },
    notification: {
      driver: "stub",
      notify: async () => ({ status: "accepted" as const, driver: "stub" as const }),
    },
    storage,
  } satisfies AgentWorkAdapters;

  try {
    const work = await storage.createWork({
      identity,
      kind: "monitor",
      title: "موافقة منتهية الصلاحية",
      description: "أنشئ مهمة عند تجاوز العناصر المفتوحة للحد.",
      source: { type: "github_repository" },
      condition: {
        provider: "github",
        entity: "repository",
        metric: "open_issues_count",
        owner: "octocat",
        repository: "Hello-World",
        operator: "gt",
        threshold: 5,
      },
      action: {
        type: "create_task",
        toolName: "create_task",
        title: "لا يجب أن تُنشأ بعد انتهاء الموافقة",
        requiresApproval: true,
      },
      schedule: { frequency: "interval", minutes: 60 },
      nextRunAt: new Date(now.getTime() - 1_000),
    });
    await storage.changeWorkStatus({
      identity,
      workId: work.id,
      from: "draft",
      to: "active",
      actorType: "user",
      actorId: identity.userId,
    });

    const runner = new AgentWorkRunner({ adapters, now: () => now });
    await runner.tick(now);
    const requestedEvent = (await storage.listEvents(identity, work.id, 20))
      .find((event) => event.eventType === "approval_requested");
    const operationId = requestedEvent?.metadata.operationId;
    assert.equal(typeof operationId, "string");
    await db.update(secretaryOperationsTable)
      .set({ expiresAt: new Date(0) })
      .where(and(
        eq(secretaryOperationsTable.tenantId, identity.tenantId),
        eq(secretaryOperationsTable.ownerUserId, identity.userId),
        eq(secretaryOperationsTable.id, operationId as string),
      ));

    const reconciled = await runner.tick(new Date("2026-09-22T10:00:00.000Z"));
    assert.equal(reconciled.completed, 1);
    assert.equal((await storage.getWork(identity, work.id))?.status, "active");
    assert.equal((await getOperation(identity, operationId as string))?.status, "expired");
    const evidence = await storage.listEvidence(identity, work.id, 20);
    assert.ok(evidence.some((item) => item.snapshot.actionState === "not_executed" && item.snapshot.reason === "expired"));
    assert.ok((await storage.listEvents(identity, work.id, 40)).some((event) => event.eventType === "action_expired"));
    const taskRows = await db.select().from(tasksTable).where(and(
      eq(tasksTable.tenantId, identity.tenantId),
      eq(tasksTable.ownerUserId, identity.userId),
    ));
    assert.equal(taskRows.length, 0);

    const stillOneApproval = (await storage.listEvents(identity, work.id, 60))
      .filter((event) => event.eventType === "approval_requested");
    assert.equal(stillOneApproval.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});