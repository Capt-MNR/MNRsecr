import assert from "node:assert/strict";
import test from "node:test";
import { AgentWorkRunner } from "../src/lib/agent-work/runner.ts";
import { createAgentWorkAdapters } from "../src/lib/agent-work/factory.ts";
import { PostgresAgentWorkStorageAdapter } from "../src/lib/agent-work/postgres-storage.ts";
import type { AgentWorkAdapters } from "../src/lib/agent-work/types.ts";

test("durable Agent Work state is readable by a fresh runner after restart", async () => {
  process.env.NODE_ENV = "production";
  process.env.AGENT_WORK_ENABLED = "true";
  process.env.AGENT_WORK_RUNNER_ENABLED = "true";
  process.env.AGENT_WORK_STORAGE_DRIVER = "postgres";
  delete process.env.AGENT_WORK_IDENTITY_DRIVER;

  const defaults = createAgentWorkAdapters();
  assert.equal(defaults.storage.driver, "postgres");
  assert.equal(defaults.identity.driver, "postgres");

  const now = new Date("2026-09-21T10:00:00.000Z");
  const identity = {
    tenantId: `agent-work-restart-${process.pid}-${Date.now()}`,
    userId: "restart-owner",
  };
  const storage = new PostgresAgentWorkStorageAdapter();
  const makeAdapters = (currentStorage: PostgresAgentWorkStorageAdapter): AgentWorkAdapters => ({
    scheduler: {
      driver: "stub",
      schedule: async () => ({ scheduled: false, driver: "stub" as const, reason: "test" }),
      cancel: async () => undefined,
    },
    identity: {
      driver: "postgres",
      resolveRequest: () => identity,
      resolveBackground: (input: { tenantId: string; userId: string }) =>
        input.tenantId === identity.tenantId && input.userId === identity.userId ? identity : null,
    },
    notification: {
      driver: "stub",
      notify: async () => ({ status: "accepted" as const, driver: "stub" as const }),
    },
    storage: currentStorage,
  });

  const work = await storage.createWork({
    identity,
    kind: "monitor",
    title: "متابعة تستمر بعد إعادة التشغيل",
    description: "فحص آمن بعد إعادة تشغيل الخادم.",
    source: { type: "clock" },
    condition: { type: "heartbeat" },
    action: { type: "notify" },
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

  const first = await new AgentWorkRunner({ adapters: makeAdapters(storage), now: () => now }).tick(now);
  assert.equal(first.completed, 1);

  const freshStorage = new PostgresAgentWorkStorageAdapter();
  const persisted = await freshStorage.getWork(identity, work.id);
  assert.equal(persisted?.status, "active");
  assert.ok(persisted?.nextRunAt);
  assert.equal((await freshStorage.listRuns(identity, work.id)).length, 1);
  assert.equal((await freshStorage.listEvidence(identity, work.id)).length, 1);
  assert.ok((await freshStorage.listEvents(identity, work.id, 20)).some((event) => event.eventType === "run_notification"));

  const second = await new AgentWorkRunner({
    adapters: makeAdapters(freshStorage),
    now: () => persisted?.nextRunAt ?? now,
  }).tick(persisted?.nextRunAt ?? now);
  assert.equal(second.completed, 1);
  assert.equal((await freshStorage.listRuns(identity, work.id)).length, 2);
});