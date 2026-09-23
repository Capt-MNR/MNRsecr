import assert from "node:assert/strict";
import test from "node:test";
import {
  agentWorkEvidenceTable,
  agentWorkEventsTable,
  agentWorkRunsTable,
  agentWorksTable,
  db,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { PostgresAgentWorkStorageAdapter } from "../src/lib/agent-work/postgres-storage.ts";

function uniqueIdentity(label: string) {
  return {
    tenantId: `agent-work-recovery-${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    userId: `${label}-owner`,
  };
}

async function createActiveWork(storage: PostgresAgentWorkStorageAdapter, identity: { tenantId: string; userId: string }, nextRunAt: Date) {
  const work = await storage.createWork({
    identity,
    kind: "monitor",
    title: "اختبار استعادة عمل الوكيل",
    source: { type: "clock" },
    condition: {},
    action: { type: "notify" },
    schedule: { frequency: "interval", minutes: 60 },
    nextRunAt,
  });
  await storage.changeWorkStatus({
    identity,
    workId: work.id,
    from: "draft",
    to: "active",
    actorType: "user",
    actorId: identity.userId,
  });
  return work;
}

async function cleanup(identity: { tenantId: string; userId: string }, workId: string): Promise<void> {
  const owner = and(
    eq(agentWorkEvidenceTable.tenantId, identity.tenantId),
    eq(agentWorkEvidenceTable.ownerUserId, identity.userId),
    eq(agentWorkEvidenceTable.workId, workId),
  );
  await db.delete(agentWorkEvidenceTable).where(owner);
  await db.delete(agentWorkEventsTable).where(and(
    eq(agentWorkEventsTable.tenantId, identity.tenantId),
    eq(agentWorkEventsTable.ownerUserId, identity.userId),
    eq(agentWorkEventsTable.workId, workId),
  ));
  await db.delete(agentWorkRunsTable).where(and(
    eq(agentWorkRunsTable.tenantId, identity.tenantId),
    eq(agentWorkRunsTable.ownerUserId, identity.userId),
    eq(agentWorkRunsTable.workId, workId),
  ));
  await db.delete(agentWorksTable).where(and(
    eq(agentWorksTable.tenantId, identity.tenantId),
    eq(agentWorksTable.ownerUserId, identity.userId),
    eq(agentWorksTable.id, workId),
  ));
}

test("two workers get one DB-backed execution lease", async () => {
  const storage = new PostgresAgentWorkStorageAdapter();
  const identity = uniqueIdentity("claim");
  const now = new Date();
  const work = await createActiveWork(storage, identity, new Date(now.getTime() - 1_000));
  try {
    const [first, second] = await Promise.all([
      storage.claimRun({
        identity,
        workId: work.id,
        now,
        leaseMs: 60_000,
        idempotencyKey: `worker-a:${work.id}`,
      }),
      storage.claimRun({
        identity,
        workId: work.id,
        now,
        leaseMs: 60_000,
        idempotencyKey: `worker-b:${work.id}`,
      }),
    ]);
    assert.ok(first);
    assert.ok(second);
    assert.equal(first?.id, second?.id);
    assert.equal((await storage.listRuns(identity, work.id)).length, 1);
  } finally {
    await cleanup(identity, work.id);
  }
});

test("expired running Work is fenced, recorded as uncertain, and is not retried automatically", async () => {
  const storage = new PostgresAgentWorkStorageAdapter();
  const identity = uniqueIdentity("expired");
  const startedAt = new Date();
  const expiredAt = new Date(startedAt.getTime() + 2_000);
  const work = await createActiveWork(storage, identity, new Date(startedAt.getTime() - 1_000));
  try {
    const claimed = await storage.claimRun({
      identity,
      workId: work.id,
      now: startedAt,
      leaseMs: 1_000,
      idempotencyKey: `first:${work.id}`,
    });
    assert.ok(claimed?.leaseToken);

    const recovered = await storage.claimRun({
      identity,
      workId: work.id,
      now: expiredAt,
      leaseMs: 60_000,
      idempotencyKey: `retry:${work.id}`,
    });
    assert.equal(recovered?.status, "uncertain");
    assert.equal(recovered?.leaseToken, null);
    assert.equal((await storage.getWork(identity, work.id))?.status, "needs_review");
    assert.equal((await storage.listRuns(identity, work.id)).length, 1);
    assert.ok((await storage.listEvents(identity, work.id, 30)).some((event) => event.eventType === "run_lease_expired"));

    await assert.rejects(
      storage.completeRun({
        identity,
        runId: claimed!.id,
        status: "verified",
        leaseToken: claimed!.leaseToken!,
        verification: { kind: "late_completion" },
        completedAt: new Date(expiredAt.getTime() + 1_000),
      }),
      /AGENT_WORK_RUN_LEASE_CONFLICT/,
    );
  } finally {
    await cleanup(identity, work.id);
  }
});

test("evidence written before a crash remains visible while recovery refuses an unsafe retry", async () => {
  const storage = new PostgresAgentWorkStorageAdapter();
  const identity = uniqueIdentity("evidence");
  const startedAt = new Date();
  const work = await createActiveWork(storage, identity, new Date(startedAt.getTime() - 1_000));
  try {
    const claimed = await storage.claimRun({
      identity,
      workId: work.id,
      now: startedAt,
      leaseMs: 1_000,
      idempotencyKey: `crashed:${work.id}`,
    });
    assert.ok(claimed);
    await storage.storeEvidenceSnapshot({
      identity,
      workId: work.id,
      runId: claimed!.id,
      retentionClass: "standard",
      snapshot: { source: "clock", status: "verified-before-crash" },
    });

    const recovered = await storage.claimRun({
      identity,
      workId: work.id,
      now: new Date(startedAt.getTime() + 2_000),
      leaseMs: 60_000,
      idempotencyKey: `after-restart:${work.id}`,
    });
    assert.equal(recovered?.status, "uncertain");
    assert.equal((await storage.listEvidence(identity, work.id)).length, 1);
    assert.equal((await storage.getWork(identity, work.id))?.lastRunStatus, "uncertain");
  } finally {
    await cleanup(identity, work.id);
  }
});