import assert from "node:assert/strict";
import test from "node:test";
import { AgentWorkRunner } from "../src/lib/agent-work/runner.ts";
import { readGitHubRepositorySource } from "../src/lib/agent-work/sources.ts";
import type {
  AgentWorkAdapters,
  AgentWorkEvidenceRecord,
  AgentWorkEventRecord,
  AgentWorkRecord,
  AgentWorkRunRecord,
} from "../src/lib/agent-work/types.ts";

const baseNow = new Date("2026-09-21T10:00:00.000Z");

function createHarness() {
  const identity = { tenantId: "github-tenant-1", userId: "github-owner-1" };
  const work: AgentWorkRecord = {
    id: "github-work-1",
    identity,
    kind: "monitor",
    title: "متابعة GitHub octocat/Hello-World",
    description: "تابع عدد العناصر المفتوحة",
    status: "active",
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
    action: { type: "notify", deepLink: "work_detail" },
    schedule: { frequency: "interval", minutes: 60 },
    nextRunAt: new Date(baseNow.getTime() - 1_000),
    lastRunAt: null,
    lastRunStatus: null,
    rowVersion: 1,
    createdAt: baseNow,
    updatedAt: baseNow,
  };
  const evidence: AgentWorkEvidenceRecord[] = [];
  const events: string[] = [];
  const notifications: Array<{ body: string; data: Record<string, unknown> }> = [];
  let runNumber = 0;
  let currentNow = baseNow;
  let currentValue = 3;
  let mode: "ok" | "malformed" | "stale" | "unavailable" | "timeout" = "ok";
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_input, _init) => {
    if (mode === "timeout") throw new Error("request timeout");
    if (mode === "unavailable") {
      return new Response(JSON.stringify({ message: "temporary unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    if (mode === "malformed") {
      return new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json", date: currentNow.toUTCString() },
      });
    }
    if (mode === "stale") {
      return new Response(JSON.stringify({
        id: 1296269,
        full_name: "octocat/Hello-World",
        open_issues_count: currentValue,
        updated_at: "2026-09-21T09:00:00.000Z",
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          date: new Date(currentNow.getTime() - 30 * 60_000).toUTCString(),
        },
      });
    }
    return new Response(JSON.stringify({
      id: 1296269,
      full_name: "octocat/Hello-World",
      open_issues_count: currentValue,
      updated_at: "2026-09-21T09:00:00.000Z",
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        date: currentNow.toUTCString(),
      },
    });
  };

  const adapters = {
    scheduler: {
      driver: "stub",
      schedule: async () => ({ scheduled: false, driver: "stub" as const, reason: "test" }),
      cancel: async () => undefined,
    },
    identity: {
      driver: "development",
      resolveRequest: () => identity,
      resolveBackground: (input: { tenantId: string; userId: string }) => ({
        tenantId: input.tenantId,
        userId: input.userId,
      }),
    },
    notification: {
      driver: "development",
      notify: async (input: { body: string; data: Record<string, unknown> }) => {
        notifications.push({ body: input.body, data: input.data });
        return { status: "accepted" as const, driver: "development" as const };
      },
    },
    storage: {
      driver: "stub",
      listDueWorks: async () => work.status === "active" && work.nextRunAt && work.nextRunAt <= currentNow
        ? [{ identity, workId: work.id, nextRunAt: work.nextRunAt }]
        : [],
      listWaitingWorks: async () => [],
      getWork: async (requestedIdentity: typeof identity, workId: string) =>
        requestedIdentity.tenantId === identity.tenantId
        && requestedIdentity.userId === identity.userId
        && workId === work.id
          ? work
          : null,
      claimRun: async (input: { now: Date; idempotencyKey: string }) => {
        runNumber += 1;
        return {
          id: `github-run-${runNumber}`,
          workId: work.id,
          identity,
          attempt: runNumber,
          status: "claimed",
          idempotencyKey: input.idempotencyKey,
          leaseToken: `lease-${runNumber}`,
          leaseExpiresAt: new Date(input.now.getTime() + 60_000),
          startedAt: input.now,
          completedAt: null,
          verification: null,
          error: null,
          createdAt: input.now,
          updatedAt: input.now,
        } satisfies AgentWorkRunRecord;
      },
      completeRun: async (input: {
        runId: string;
        status: AgentWorkRunRecord["status"];
        verification?: Record<string, unknown> | null;
        error?: string | null;
        completedAt: Date;
        nextRunAt?: Date | null;
        workStatus?: AgentWorkRecord["status"];
      }) => {
        work.lastRunAt = input.completedAt;
        work.lastRunStatus = input.status;
        work.nextRunAt = input.nextRunAt ?? null;
        work.status = input.workStatus ?? work.status;
        return {
          id: input.runId,
          workId: work.id,
          identity,
          attempt: runNumber,
          status: input.status,
          idempotencyKey: `run-${input.runId}`,
          leaseToken: null,
          leaseExpiresAt: null,
          startedAt: input.completedAt,
          completedAt: input.completedAt,
          verification: input.verification ?? null,
          error: input.error ?? null,
          createdAt: input.completedAt,
          updatedAt: input.completedAt,
        } satisfies AgentWorkRunRecord;
      },
      listEvidence: async () => evidence,
      storeEvidenceSnapshot: async (input: {
        runId: string;
        snapshot: Record<string, unknown>;
      }) => {
        evidence.unshift({
          id: `evidence-${evidence.length + 1}`,
          workId: work.id,
          runId: input.runId,
          snapshotHash: `hash-${evidence.length + 1}`,
          snapshot: input.snapshot,
          retentionClass: "standard",
          expiresAt: null,
          createdAt: currentNow,
        });
        return { reference: "evidence", stored: true, driver: "stub" as const };
      },
      addEvent: async (input: { eventType: string }) => {
        events.push(input.eventType);
        return {
          id: `event-${events.length}`,
          workId: work.id,
          runId: null,
          eventType: input.eventType,
          actorType: "system",
          actorId: null,
          summary: input.eventType,
          metadata: {},
          dedupeKey: null,
          occurredAt: currentNow,
          createdAt: currentNow,
        } satisfies AgentWorkEventRecord;
      },
    },
  } as unknown as AgentWorkAdapters;

  return {
    adapters,
    work,
    evidence,
    events,
    notifications,
    originalFetch,
    setNow(value: Date) { currentNow = value; },
    setValue(value: number) { currentValue = value; },
    setMode(value: typeof mode) { mode = value; },
  };
}

test("GitHub monitoring completes read, compare, verify, evidence, event, notify, and reschedule", async () => {
  process.env.NODE_ENV = "development";
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  const harness = createHarness();
  const runner = new AgentWorkRunner({
    adapters: harness.adapters,
    now: () => new Date("2026-09-21T10:00:00.000Z"),
  });
  try {
    const first = await runner.tick(new Date("2026-09-21T10:00:00.000Z"));
    assert.equal(first.completed, 1);
    assert.equal(harness.work.lastRunStatus, "unchanged");
    assert.equal(harness.notifications.length, 0);
    assert.equal(harness.evidence[0]?.snapshot.reason, "github_api_read_verified");
    assert.equal(harness.work.nextRunAt?.toISOString(), "2026-09-21T11:00:00.000Z");

    const changedAt = new Date("2026-09-21T11:00:00.000Z");
    harness.setNow(changedAt);
    harness.setValue(6);
    const changed = await runner.tick(changedAt);
    assert.equal(changed.completed, 1);
    assert.equal(harness.work.lastRunStatus, "verified");
    assert.equal(harness.notifications.length, 1);
    assert.match(harness.notifications[0].body, /القيمة الحالية 6/u);
    assert.equal(harness.notifications[0].data.deepLink, `/main?workId=${harness.work.id}`);

    const duplicateAt = new Date("2026-09-21T12:00:00.000Z");
    harness.setNow(duplicateAt);
    const duplicate = await runner.tick(duplicateAt);
    assert.equal(duplicate.completed, 1);
    assert.equal(harness.work.lastRunStatus, "unchanged");
    assert.equal(harness.notifications.length, 1);

    const clearedAt = new Date("2026-09-21T13:00:00.000Z");
    harness.setNow(clearedAt);
    harness.setValue(4);
    await runner.tick(clearedAt);
    assert.equal(harness.notifications.length, 1);

    const reenteredAt = new Date("2026-09-21T14:00:00.000Z");
    harness.setNow(reenteredAt);
    harness.setValue(7);
    await runner.tick(reenteredAt);
    assert.equal(harness.work.lastRunStatus, "verified");
    assert.equal(harness.notifications.length, 2);
    assert.ok(harness.events.includes("run_notification"));
    assert.ok(harness.events.includes("notification_delivery"));
    assert.ok(harness.events.includes("run_unchanged"));

    for (const failure of ["timeout", "malformed", "stale", "unavailable"] as const) {
      const failureAt = new Date(harness.work.nextRunAt?.getTime() ?? reenteredAt.getTime());
      harness.setNow(failureAt);
      harness.setMode(failure);
      const result = await runner.tick(failureAt);
      assert.equal(result.failed, 1, failure);
      assert.equal(harness.work.status, "active", failure);
      assert.equal(harness.notifications.length, 2, failure);
      assert.ok(harness.events.includes("run_failed"), failure);
    }

    const originalListDueWorks = harness.adapters.storage.listDueWorks;
    harness.adapters.storage.listDueWorks = async () => [{
      identity: { tenantId: "foreign-tenant", userId: "foreign-owner" },
      workId: harness.work.id,
      nextRunAt: harness.work.nextRunAt,
    }];
    const foreignTenant = await runner.tick(new Date(harness.work.nextRunAt?.getTime() ?? Date.now()));
    assert.equal(foreignTenant.claimed, 0);
    assert.equal(foreignTenant.skipped, 1);
    harness.adapters.storage.listDueWorks = originalListDueWorks;

    harness.setMode("ok");
    harness.work.status = "paused";
    harness.setNow(new Date(harness.work.nextRunAt?.getTime() ?? Date.now()));
    const paused = await runner.tick(harness.work.nextRunAt ?? new Date());
    assert.equal(paused.claimed, 0);
    harness.work.status = "cancelled";
    const cancelled = await runner.tick(harness.work.nextRunAt ?? new Date());
    assert.equal(cancelled.claimed, 0);

    const foreignCandidate = await harness.adapters.storage.listDueWorks({ now: new Date() });
    assert.equal(foreignCandidate.length, 0);
  } finally {
    globalThis.fetch = harness.originalFetch;
  }
});

test("GitHub source rejects invalid configuration and verifies repository identity", async () => {
  const harness = createHarness();
  try {
    const invalid = await readGitHubRepositorySource(
      harness.work.identity,
      { ...harness.work, source: { type: "github_repository" }, condition: { ...harness.work.condition, repository: "bad/name/extra" } },
    );
    assert.deepEqual(invalid, { ok: false, reason: "invalid_configuration" });

    const wrongRepositoryResponse = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json", date: baseNow.toUTCString() }),
      json: async () => ({ id: 1, full_name: "someone/else", open_issues_count: 9, updated_at: baseNow.toISOString() }),
    } as unknown as Response;
    const verified = await readGitHubRepositorySource(harness.work.identity, harness.work, {
      now: baseNow,
      fetchImpl: async () => wrongRepositoryResponse,
    });
    assert.deepEqual(verified, { ok: false, reason: "malformed_response" });
  } finally {
    globalThis.fetch = harness.originalFetch;
  }
});