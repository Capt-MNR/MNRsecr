import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.AGENT_WORK_ENABLED = "true";
process.env.AGENT_WORK_RUNNER_ENABLED = "true";
process.env.AGENT_WORK_TEST_FAKE_EMAIL_CONNECTOR = "false";
process.env.AGENT_WORK_TEST_FAKE_CALENDAR_CONNECTOR = "true";
process.env.AGENT_WORK_TEST_FAKE_MESSAGING_CONNECTOR = "true";
process.env.AI_PROVIDER = "development";

async function loadModules() {
  const [
    dbModule,
    drizzle,
    operationModule,
    secretaryModule,
    phase2Module,
    storageModule,
    runnerModule,
    registryModule,
    fakeProviders,
  ] = await Promise.all([
    import("@workspace/db"),
    import("drizzle-orm"),
    import("../src/lib/secretary-operations.ts"),
    import("../src/lib/secretary.ts"),
    import("../src/lib/phase2.ts"),
    import("../src/lib/agent-work/postgres-storage.ts"),
    import("../src/lib/agent-work/runner.ts"),
    import("../src/lib/agent-work/external-action-registry.ts"),
    import("../src/lib/agent-work/fake-integration-providers.ts"),
  ]);
  return {
    dbModule,
    drizzle,
    operationModule,
    secretaryModule,
    phase2Module,
    storageModule,
    runnerModule,
    registryModule,
    fakeProviders,
  };
}

type Modules = Awaited<ReturnType<typeof loadModules>>;

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

async function cleanupTenant(
  modules: Modules,
  identity: { tenantId: string; userId: string },
) {
  const { and, eq } = modules.drizzle;
  const {
    db,
    agentWorkEvidenceTable,
    agentWorkEventsTable,
    agentWorkRunsTable,
    agentWorksTable,
    secretaryOperationsTable,
  } = modules.dbModule as any;
  const scope = (table: any) => and(
    eq(table.tenantId, identity.tenantId),
    eq(table.ownerUserId, identity.userId),
  );
  await db.delete(agentWorkEvidenceTable).where(scope(agentWorkEvidenceTable));
  await db.delete(agentWorkEventsTable).where(scope(agentWorkEventsTable));
  await db.delete(agentWorkRunsTable).where(scope(agentWorkRunsTable));
  await db.delete(agentWorksTable).where(scope(agentWorksTable));
  await db.delete(secretaryOperationsTable).where(scope(secretaryOperationsTable));
}

test("Calendar and provider-neutral messaging use the registered Agent Work approval lifecycle", async () => {
  const modules = await loadModules();
  assert.deepEqual(
    modules.registryModule.registeredExternalActionProviders()
      .map((connector: { provider: string }) => connector.provider),
    ["google_sheets", "calendar", "messaging"],
  );
  const storage = new modules.storageModule.PostgresAgentWorkStorageAdapter();
  const scenarios = [
    {
      provider: "calendar",
      title: "Create a calendar event",
      action: {
        type: "create_event",
        calendarId: "primary",
        summary: "Review the prototype",
        description: "Inspect the revised layout.",
        startAt: "2026-10-09T10:00:00Z",
        endAt: "2026-10-09T10:30:00Z",
        timeZone: "Africa/Cairo",
      },
      approvalTool: "calendar_execute",
      expectedRecipientOrCalendar: "primary",
    },
    {
      provider: "messaging",
      title: "Send a direct message",
      action: {
        type: "send_message",
        recipient: "user:integration-fixture",
        channel: "chat",
        body: "The revised prototype is ready to review.",
      },
      approvalTool: "message_send",
      expectedRecipientOrCalendar: "user:integration-fixture",
    },
  ] as const;

  for (const scenario of scenarios) {
    const identity = {
      tenantId: `fake-${scenario.provider}-${process.pid}-${randomUUID()}`,
      userId: `integration-owner-${randomUUID()}`,
    };
    const calendarFake = modules.fakeProviders.fakeCalendarProviderForTests;
    const messagingFake = modules.fakeProviders.fakeMessagingProviderForTests;
    if (scenario.provider === "calendar") calendarFake.reset("accepted_ack_lost");
    else messagingFake.reset("accepted_ack_lost");

    const adapters = {
      scheduler: {
        driver: "stub",
        schedule: async () => ({ scheduled: false, driver: "stub", reason: "test" }),
        cancel: async () => undefined,
      },
      identity: {
        driver: "test",
        resolveRequest: () => identity,
        resolveBackground: (candidate: { tenantId: string; userId: string }) =>
          candidate.tenantId === identity.tenantId && candidate.userId === identity.userId
            ? identity
            : null,
      },
      notification: {
        driver: "stub",
        notify: async () => ({ status: "accepted", driver: "stub" }),
      },
      storage,
    };

    try {
      const setup = await modules.phase2Module.executeStructuredTool(
        identity,
        "create_agent_work",
        {
          kind: "external_action",
          title: scenario.title,
          description: "Test-only simulated external action.",
          sourceType: scenario.provider,
          action: scenario.action,
          condition: {},
          schedule: {},
        },
        {
          requestId: `${scenario.provider}-setup-${randomUUID()}`,
          conversationId: `${scenario.provider}-conversation-${randomUUID()}`,
          sourceTurnId: `${scenario.provider}-turn-${randomUUID()}`,
        },
      );
      assert.equal(setup.pendingApproval, true);
      const setupApprovalOperationId = String(record(setup.approval).operationId);
      const setupClaim = await modules.operationModule.claimOperation(
        identity,
        setupApprovalOperationId,
      );
      assert.equal(setupClaim.kind, "claimed");
      if (setupClaim.kind !== "claimed") throw new Error("setup approval was not claimed");
      const createdResult = await modules.secretaryModule.executeApprovedOperation(
        identity,
        setupClaim.operation,
      );

      const setupOperation = await modules.operationModule.getOperation(
        identity,
        setupApprovalOperationId,
      );
      assert.equal(setupOperation?.status, "completed");
      const setupAction = record(createdResult.action);
      const workId = String(record(record(setupAction.toolResult).agentWork).id);
      assert.ok(workId);
      const work = await storage.getWork(identity, workId);
      assert.ok(work);
      assert.equal(work.kind, "external_action");
      assert.equal(record(work.source).type, scenario.provider);

      if (scenario.provider === "calendar") assert.equal(calendarFake.writeCount, 0);
      else assert.equal(messagingFake.sendCount, 0);

      const runnerAdapters = adapters as any;
      const runAt = new Date(Date.now() + 5_000);
      const runner = new modules.runnerModule.AgentWorkRunner({
        adapters: runnerAdapters,
        now: () => runAt,
      });
      await runner.tick(runAt);
      assert.equal((await storage.getWork(identity, workId))?.status, "waiting");

      const events = await storage.listEvents(identity, workId, 100);
      const approvalEvent = events.find((event: any) => event.eventType === "approval_requested");
      assert.ok(approvalEvent);
      const approvalOperationId = String(approvalEvent.metadata.approvalOperationId);
      const approvalOperation = await modules.operationModule.getOperation(
        identity,
        approvalOperationId,
      );
      assert.ok(approvalOperation);
      assert.equal(approvalOperation.toolName, scenario.approvalTool);
      assert.equal(record(approvalOperation.args).provider, scenario.provider);
      assert.equal(
        scenario.provider === "calendar"
          ? record(approvalOperation.args).action.calendarId
          : record(approvalOperation.args).action.recipient,
        scenario.expectedRecipientOrCalendar,
      );

      const claim = await modules.operationModule.claimOperation(identity, approvalOperationId);
      assert.equal(claim.kind, "claimed");
      if (claim.kind !== "claimed") throw new Error("external action approval was not claimed");
      const result = await modules.secretaryModule.executeApprovedOperation(
        identity,
        claim.operation,
      );
      assert.equal(record(record(result.action).externalAction).status, "verified");
      await modules.operationModule.completeOperation(identity, approvalOperationId, result);

      if (scenario.provider === "calendar") {
        assert.equal(calendarFake.writeCount, 1);
        assert.equal(calendarFake.readCount >= 1, true);
      } else {
        assert.equal(messagingFake.sendCount, 1);
        assert.equal(messagingFake.lookupCount >= 1, true);
      }
      const finalEvents = await storage.listEvents(identity, workId, 100);
      assert.ok(finalEvents.some((event: any) =>
        event.eventType === "external_action_step_verified"));
      assert.ok(finalEvents.some((event: any) =>
        event.eventType === "external_action_unknown_result"));
      const serializedEvidence = JSON.stringify({
        events: finalEvents.map((event: any) => event.metadata),
        evidence: await storage.listEvidence(identity, workId, 100),
      });
      if (scenario.provider === "messaging") {
        assert.ok(!serializedEvidence.includes(scenario.action.body));
        assert.ok(!serializedEvidence.includes(scenario.action.recipient));
      }
    } finally {
      await cleanupTenant(modules, identity);
    }
  }
});