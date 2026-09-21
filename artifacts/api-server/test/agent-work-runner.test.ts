import assert from "node:assert/strict";
import test from "node:test";
import { AgentWorkRunner } from "../src/lib/agent-work/runner.ts";
import type {
  AgentWorkAdapters,
  AgentWorkRecord,
  AgentWorkRunRecord,
} from "../src/lib/agent-work/types.ts";

const now = new Date("2026-09-21T10:00:00.000Z");

function work(overrides: Partial<AgentWorkRecord> = {}): AgentWorkRecord {
  return {
    id: "work-1",
    identity: { tenantId: "tenant-1", userId: "user-1" },
    kind: "monitor",
    title: "فحص آمن",
    description: "اختبار",
    status: "active",
    source: { type: "clock" },
    condition: {},
    schedule: { frequency: "interval", minutes: 60 },
    nextRunAt: new Date("2026-09-21T09:59:00.000Z"),
    lastRunAt: null,
    lastRunStatus: null,
    rowVersion: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function adaptersFor(inputWork: AgentWorkRecord): {
  adapters: AgentWorkAdapters;
  state: { runStatus: string; nextRunAt: Date | null; evidence: number; events: string[]; notifications: number };
} {
  const run: AgentWorkRunRecord = {
    id: "run-1",
    workId: inputWork.id,
    identity: inputWork.identity,
    attempt: 1,
    status: "claimed",
    idempotencyKey: `agent-work-run:${inputWork.id}:${inputWork.nextRunAt?.toISOString() ?? "immediate"}`,
    leaseToken: "lease-1",
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    startedAt: now,
    completedAt: null,
    verification: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  const state = {
    runStatus: run.status,
    nextRunAt: inputWork.nextRunAt,
    evidence: 0,
    events: [] as string[],
    notifications: 0,
  };
  const adapters = {
    scheduler: { driver: "stub", schedule: async () => ({ scheduled: false, driver: "stub", reason: "test" }), cancel: async () => undefined },
    identity: { driver: "development", resolveRequest: () => inputWork.identity, resolveBackground: () => inputWork.identity },
    notification: {
      driver: "development",
      notify: async () => {
        state.notifications += 1;
        return { status: "accepted", driver: "development" as const };
      },
    },
    storage: {
      driver: "stub",
      listDueWorks: async () => [{ identity: inputWork.identity, workId: inputWork.id, nextRunAt: inputWork.nextRunAt }],
      listWaitingWorks: async () => [],
      getWork: async () => inputWork,
      claimRun: async () => run,
      storeEvidenceSnapshot: async () => {
        state.evidence += 1;
        return { reference: "evidence-1", stored: true, driver: "stub" as const };
      },
      completeRun: async (input: { status: string; nextRunAt?: Date | null }) => {
        state.runStatus = input.status;
        state.nextRunAt = input.nextRunAt ?? null;
        return { ...run, status: input.status as AgentWorkRunRecord["status"], leaseToken: null };
      },
      addEvent: async (input: { eventType: string }) => {
        state.events.push(input.eventType);
        return { id: `${input.eventType}-1` };
      },
    },
  } as unknown as AgentWorkAdapters;
  return { adapters, state };
}

test("runner claims a safe due Work, persists evidence, and reschedules it", async () => {
  process.env.NODE_ENV = "development";
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  const { adapters, state } = adaptersFor(work());
  const result = await new AgentWorkRunner({ adapters, now: () => now }).tick(now);
  assert.equal(result.claimed, 1);
  assert.equal(result.completed, 1);
  assert.equal(state.runStatus, "verified");
  assert.equal(state.evidence, 1);
  assert.equal(state.notifications, 1);
  assert.deepEqual(state.events, ["run_notification", "notification_delivery"]);
  assert.equal(state.nextRunAt?.toISOString(), "2026-09-21T11:00:00.000Z");
});

test("runner refuses an unknown source instead of claiming success", async () => {
  process.env.NODE_ENV = "development";
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  const { adapters, state } = adaptersFor(work({ source: { type: "unconnected_api" } }));
  const result = await new AgentWorkRunner({ adapters, now: () => now }).tick(now);
  assert.equal(result.completed, 1);
  assert.equal(state.runStatus, "needs_review");
  assert.equal(state.nextRunAt, null);
});

test("internal task monitoring establishes a quiet baseline and stays quiet when unchanged", async () => {
  process.env.NODE_ENV = "production";
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  const identity = {
    tenantId: `monitor-test-${process.pid}-${Date.now()}`,
    userId: "monitor-user",
  };
  const monitoredWork = work({
    identity,
    source: { type: "internal_records" },
    condition: {
      entity: "tasks",
      metric: "open_task_count",
      operator: "gt",
      threshold: 0,
    },
  });
  const { adapters, state } = adaptersFor(monitoredWork);
  const originalStorage = adapters.storage as Record<string, unknown>;
  const evidence: Array<{ snapshot: Record<string, unknown> }> = [];
  let notificationCount = 0;
  let eventCount = 0;
  originalStorage.listEvidence = async () => evidence;
  originalStorage.storeEvidenceSnapshot = async (input: { snapshot: Record<string, unknown> }) => {
    evidence.unshift({ snapshot: input.snapshot });
    return { reference: "evidence-monitor", stored: true, driver: "stub" as const };
  };
  originalStorage.addEvent = async (input: { eventType: string }) => {
    eventCount += 1;
    state.events.push(input.eventType);
    return { id: `event-${eventCount}` };
  };
  (adapters.notification as unknown as { notify: () => Promise<unknown> }).notify = async () => {
    notificationCount += 1;
    return { status: "accepted", driver: "stub" };
  };

  const runner = new AgentWorkRunner({ adapters, now: () => now });
  const first = await runner.tick(now);
  const second = await runner.tick(now);

  assert.equal(first.completed, 1);
  assert.equal(second.completed, 1);
  assert.equal(state.runStatus, "unchanged");
  assert.equal(evidence.length, 2);
  assert.equal(notificationCount, 0);
  assert.deepEqual(state.events, ["run_unchanged", "run_unchanged"]);
});