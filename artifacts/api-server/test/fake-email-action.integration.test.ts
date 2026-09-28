import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.AGENT_WORK_ENABLED = "true";
process.env.AGENT_WORK_RUNNER_ENABLED = "true";
process.env.AGENT_WORK_TEST_FAKE_EMAIL_CONNECTOR = "true";
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
    factoryModule,
    emailModule,
    registryModule,
  ] = await Promise.all([
    import("@workspace/db"),
    import("drizzle-orm"),
    import("../src/lib/secretary-operations.ts"),
    import("../src/lib/secretary.ts"),
    import("../src/lib/phase2.ts"),
    import("../src/lib/agent-work/postgres-storage.ts"),
    import("../src/lib/agent-work/runner.ts"),
    import("../src/lib/agent-work/factory.ts"),
    import("../src/lib/agent-work/fake-email-action.ts"),
    import("../src/lib/agent-work/external-action-registry.ts"),
  ]);
  return {
    dbModule,
    drizzle,
    operationModule,
    secretaryModule,
    phase2Module,
    storageModule,
    runnerModule,
    factoryModule,
    emailModule,
    registryModule,
  };
}

type Modules = Awaited<ReturnType<typeof loadModules>>;

function safeRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

async function cleanupTenant(modules: Modules, identity: { tenantId: string; userId: string }) {
  const { and, eq } = modules.drizzle;
  const { db, agentWorkEvidenceTable, agentWorkEventsTable, agentWorkRunsTable, agentWorksTable, secretaryOperationsTable } =
    modules.dbModule as any;
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

async function createEmailScenario(
  modules: Modules,
  outcome: "accepted" | "rejected" | "timeout_before_ack" | "accepted_ack_lost",
) {
  const identity = {
    tenantId: `fake-email-${process.pid}-${randomUUID()}`,
    userId: `email-owner-${randomUUID()}`,
  };
  const { fakeEmailTransportForTests } = modules.emailModule;
  fakeEmailTransportForTests.reset(outcome);

  const storage = new modules.storageModule.PostgresAgentWorkStorageAdapter();
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
  const workTitle = "Send a test email";
  const recipient = `recipient+${randomUUID()}@example.test`;
  const subject = `Test subject ${randomUUID()}`;
  const body = `CONFIDENTIAL-EMAIL-BODY-${randomUUID()}`;
  const attachmentRef = `fixture://email-attachment/${randomUUID()}`;
  let workId: string | null = null;

  try {
    const setupRequest = await modules.phase2Module.executeStructuredTool(
      identity,
      "create_agent_work",
      {
        kind: "external_action",
        title: workTitle,
        description: "Test-only simulated email action.",
        sourceType: "email",
        action: {
          type: "send_email",
          recipient,
          subject,
          body,
          attachmentRef,
        },
        condition: {},
        schedule: {},
      },
      {
        requestId: `email-understand-${randomUUID()}`,
        conversationId: `email-conversation-${randomUUID()}`,
        sourceTurnId: `email-turn-${randomUUID()}`,
      },
    );
    assert.equal(setupRequest.pendingApproval, true);
    const setupApprovalOperationId = String(safeRecord(setupRequest.approval).operationId);
    assert.ok(setupApprovalOperationId);

    const setupClaim = await modules.operationModule.claimOperation(identity, setupApprovalOperationId);
    assert.equal(setupClaim.kind, "claimed");
    if (setupClaim.kind !== "claimed") throw new Error("setup approval was not claimed");
    const createdResult = await modules.secretaryModule.executeApprovedOperation(identity, setupClaim.operation);
    const completedSetup = await modules.operationModule.getOperation(identity, setupApprovalOperationId);
    assert.equal(completedSetup?.status, "completed");
    const createdAction = safeRecord(createdResult.action);
    const createdToolResult = safeRecord(createdAction.toolResult);
    workId = String(safeRecord(createdToolResult.agentWork).id);
    assert.ok(workId);

    const work = await storage.getWork(identity, workId);
    assert.ok(work);
    assert.equal(work.kind, "external_action");
    assert.equal(safeRecord(work.source).type, "email");
    const storedAction = safeRecord(work.action);
    assert.equal(storedAction.setupApprovalOperationId, setupApprovalOperationId);
    const actionId = String(storedAction.actionId);
    assert.ok(actionId);

    const runAt = new Date(Date.now() + 5_000);
    const runnerAdapters = adapters as any;
    const runner = new modules.runnerModule.AgentWorkRunner({
      adapters: runnerAdapters,
      now: () => runAt,
    });
    const planningTick = await runner.tick(runAt);
    assert.ok(planningTick.claimed >= 1);
    const waitingWork = await storage.getWork(identity, workId);
    assert.equal(waitingWork?.status, "waiting");

    const approvalEvent = (await storage.listEvents(identity, workId, 100))
      .find((event: any) => event.eventType === "approval_requested");
    assert.ok(approvalEvent);
    const approvalOperationId = String(approvalEvent.metadata.approvalOperationId);
    const runId = String(approvalEvent.runId);
    const run = await storage.getRun(identity, runId);
    assert.ok(run);
    const approvalOperation = await modules.operationModule.getOperation(identity, approvalOperationId);
    assert.ok(approvalOperation);
    assert.equal(approvalOperation.status, "pending");
    assert.equal(approvalOperation.toolName, modules.emailModule.EMAIL_APPROVAL_TOOL);
    const approvalArgs = approvalOperation.args as Record<string, any>;
    const stepId = String(approvalArgs.plan[0].stepId);

    assert.equal(new Set([
      workId,
      runId,
      setupApprovalOperationId,
      approvalOperationId,
      actionId,
      stepId,
    ]).size, 6);
    assert.equal(approvalArgs.provider, "email");
    assert.equal(approvalArgs.action.recipient, recipient);
    assert.equal(approvalArgs.action.subject, subject);
    assert.equal(approvalArgs.action.body, body);
    assert.equal(approvalArgs.action.attachmentRef, attachmentRef);

    return {
      identity,
      storage,
      adapters: runnerAdapters,
      runner,
      workId,
      runId,
      setupApprovalOperationId,
      approvalOperationId,
      actionId,
      stepId,
      recipient,
      subject,
      body,
      attachmentRef,
      approvalOperation,
      cleanup: () => cleanupTenant(modules, identity),
    };
  } catch (error) {
    await cleanupTenant(modules, identity);
    throw error;
  }
}

async function approveEmailScenario(
  modules: Modules,
  scenario: Awaited<ReturnType<typeof createEmailScenario>>,
  options: { mutateArgs?: (args: Record<string, any>) => Record<string, unknown> } = {},
) {
  const claim = await modules.operationModule.claimOperation(
    scenario.identity,
    scenario.approvalOperationId,
  );
  assert.equal(claim.kind, "claimed");
  if (claim.kind !== "claimed") throw new Error("email approval was not claimed");
  const operation = options.mutateArgs
    ? { ...claim.operation, args: options.mutateArgs(claim.operation.args as Record<string, any>) }
    : claim.operation;
  const result = await modules.secretaryModule.executeApprovedOperation(scenario.identity, operation);
  await modules.operationModule.completeOperation(
    scenario.identity,
    scenario.approvalOperationId,
    result,
  );
  return { operation, result };
}

test("test-gated Email connector completes the existing External Action lifecycle", async (t) => {
  const productionRegistry = spawnSync(
    "../../scripts/node_modules/.bin/tsx",
    [
      "--eval",
      'import("./src/lib/agent-work/external-action-registry.ts").then((registry) => console.log(JSON.stringify(registry.registeredExternalActionProviders().map((connector) => connector.provider))))',
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        AGENT_WORK_TEST_FAKE_EMAIL_CONNECTOR: "true",
      },
    },
  );
  assert.equal(productionRegistry.status, 0, productionRegistry.stderr);
  assert.deepEqual(JSON.parse(productionRegistry.stdout.trim()), ["google_sheets"]);
  const modules = await loadModules();
  const registered = modules.registryModule.registeredExternalActionProviders()
    .map((connector: { provider: string }) => connector.provider);
  assert.deepEqual(registered, ["google_sheets", "email"]);
  const { fakeEmailTransportForTests } = modules.emailModule;

  await t.test("verified slice, content/plan tampering, IDs, evidence, and duplicate execution", async () => {
    const scenario = await createEmailScenario(modules, "accepted");
    try {
      const claim = await modules.operationModule.claimOperation(
        scenario.identity,
        scenario.approvalOperationId,
      );
      assert.equal(claim.kind, "claimed");
      if (claim.kind !== "claimed") throw new Error("email approval was not claimed");

      for (const field of ["recipient", "subject", "body"] as const) {
        await assert.rejects(
          () => modules.secretaryModule.executeApprovedOperation(scenario.identity, {
            ...claim.operation,
            args: {
              ...claim.operation.args,
              action: {
                ...safeRecord(claim.operation.args.action),
              [field]: field === "recipient"
                ? String(safeRecord(claim.operation.args.action)[field]).replace("@", "+changed@")
                : `${String(safeRecord(claim.operation.args.action)[field])}-changed`,
              },
            },
          }),
          /EMAIL_APPROVAL_CONTEXT_MISMATCH/u,
        );
      }
      await assert.rejects(
        () => modules.secretaryModule.executeApprovedOperation(scenario.identity, {
          ...claim.operation,
          args: {
            ...claim.operation.args,
            plan: [{
              ...safeRecord((claim.operation.args.plan as unknown[])[0]),
              stepId: `step_${"a".repeat(48)}`,
            }],
          },
        }),
        /EXTERNAL_ACTION_PLAN_MISMATCH/u,
      );
      assert.equal(fakeEmailTransportForTests.requestCount, 0);

      const result = await modules.secretaryModule.executeApprovedOperation(
        scenario.identity,
        claim.operation,
      );
      assert.equal(safeRecord(safeRecord(result.action).externalAction).status, "verified");
      const externalAction = safeRecord(safeRecord(result.action).externalAction);
      assert.equal(externalAction.workId, scenario.workId);
      assert.equal(externalAction.runId, scenario.runId);
      assert.equal(externalAction.approvalOperationId, scenario.approvalOperationId);
      assert.equal(externalAction.actionId, scenario.actionId);
      assert.equal(externalAction.stepId, scenario.stepId);
      assert.equal(externalAction.providerReference.messageId.length > 0, true);
      assert.equal(fakeEmailTransportForTests.requestCount, 1);
      assert.equal(fakeEmailTransportForTests.messages.size, 1);
      const sent = [...fakeEmailTransportForTests.messages.values()][0];
      assert.equal(sent?.recipient, scenario.recipient);
      assert.equal(sent?.subject, scenario.subject);
      assert.equal(sent?.body, scenario.body);
      assert.equal(sent?.attachmentRef, scenario.attachmentRef);

      await modules.operationModule.completeOperation(
        scenario.identity,
        scenario.approvalOperationId,
        result,
      );
      const duplicate = await modules.secretaryModule.executeApprovedOperation(
        scenario.identity,
        { ...claim.operation, status: "executing" },
      );
      assert.equal(safeRecord(safeRecord(duplicate.action).externalAction).status, "verified");
      assert.equal(fakeEmailTransportForTests.requestCount, 1);
      assert.equal(fakeEmailTransportForTests.messages.size, 1);

      const reconcileTick = await scenario.runner.tick(new Date(Date.now() + 10_000));
      assert.equal(reconcileTick.completed >= 1, true);
      assert.equal((await scenario.storage.getWork(scenario.identity, scenario.workId))?.status, "completed");
      const events = await scenario.storage.listEvents(scenario.identity, scenario.workId, 100);
      const evidence = await scenario.storage.listEvidence(scenario.identity, scenario.workId, 100);
      assert.ok(events.some((event: any) => event.eventType === "external_action_step_verified"));
      assert.ok(evidence.length > 0);
      const serializedEvidence = JSON.stringify({
        events: events.map((event: any) => event.metadata),
        evidence: evidence.map((item: any) => item.snapshot),
      });
      for (const sensitive of [
        scenario.recipient,
        scenario.subject,
        scenario.body,
        scenario.attachmentRef,
      ]) {
        assert.ok(!serializedEvidence.includes(sensitive));
      }
      assert.ok(serializedEvidence.includes("approvedActionHash"));
      assert.ok(serializedEvidence.includes("messageId"));
    } finally {
      await scenario.cleanup();
    }
  });

  await t.test("provider rejection is a classified failed result", async () => {
    const scenario = await createEmailScenario(modules, "rejected");
    try {
      const claim = await modules.operationModule.claimOperation(
        scenario.identity,
        scenario.approvalOperationId,
      );
      assert.equal(claim.kind, "claimed");
      if (claim.kind !== "claimed") throw new Error("email approval was not claimed");
      await assert.rejects(
        () => modules.secretaryModule.executeApprovedOperation(scenario.identity, claim.operation),
        /EMAIL_PROVIDER_REJECTED/u,
      );
      await modules.operationModule.failOperation(
        scenario.identity,
        scenario.approvalOperationId,
        "EMAIL_PROVIDER_REJECTED",
      );
      const operation = await modules.operationModule.getOperation(
        scenario.identity,
        scenario.approvalOperationId,
      );
      assert.equal(operation?.status, "failed");
      const events = await scenario.storage.listEvents(scenario.identity, scenario.workId, 100);
      const failure = events.find((event: any) =>
        event.eventType === "external_action_step_failed");
      assert.equal(safeRecord(failure?.metadata).actionState, "failed");
      assert.equal(safeRecord(safeRecord(failure?.metadata).error).outcome, "rejected");
      assert.equal(fakeEmailTransportForTests.messages.size, 0);
    } finally {
      await scenario.cleanup();
    }
  });

  for (const mode of ["timeout_before_ack", "accepted_ack_lost"] as const) {
    await t.test(`${mode} becomes review-only and cannot create a second email`, async () => {
      const scenario = await createEmailScenario(modules, mode);
      try {
        const { operation, result } = await approveEmailScenario(modules, scenario);
        const externalAction = safeRecord(safeRecord(result.action).externalAction);
        assert.equal(externalAction.status, "unknown_result");
        assert.equal(externalAction.retryable, false);
        assert.equal(externalAction.reviewRequired, true);
        assert.equal(fakeEmailTransportForTests.requestCount, 1);

        const hasAcceptedButLostAck = mode === "accepted_ack_lost";
        assert.equal(fakeEmailTransportForTests.messages.size, hasAcceptedButLostAck ? 1 : 0);
        if (hasAcceptedButLostAck) {
          assert.equal(typeof externalAction.providerReference.messageId, "string");
        } else {
          assert.equal(externalAction.providerReference, undefined);
        }

        await modules.secretaryModule.executeApprovedOperation(scenario.identity, {
          ...operation,
          status: "executing",
        });
        assert.equal(fakeEmailTransportForTests.requestCount, 1);
        assert.equal(fakeEmailTransportForTests.messages.size, hasAcceptedButLostAck ? 1 : 0);

        const reviewTick = await scenario.runner.tick(new Date(Date.now() + 10_000));
        assert.equal(reviewTick.completed >= 1, true);
        assert.equal((await scenario.storage.getWork(scenario.identity, scenario.workId))?.status, "needs_review");
        await scenario.runner.tick(new Date(Date.now() + 30_000));
        assert.equal(fakeEmailTransportForTests.requestCount, 1);
        assert.equal(fakeEmailTransportForTests.messages.size, hasAcceptedButLostAck ? 1 : 0);
        const events = await scenario.storage.listEvents(scenario.identity, scenario.workId, 100);
        assert.ok(events.some((event: any) => event.eventType === "external_action_unknown_result"));
        const serialized = JSON.stringify(events.map((event: any) => event.metadata));
        assert.ok(!serialized.includes(scenario.body));
        if (hasAcceptedButLostAck) {
          assert.ok(serialized.includes(String(externalAction.providerReference.messageId)));
        }
      } finally {
        await scenario.cleanup();
      }
    });
  }

  await t.test("interruption after provider acceptance recovers from a started receipt without resending", async () => {
    const scenario = await createEmailScenario(modules, "accepted");
    try {
      const claim = await modules.operationModule.claimOperation(
        scenario.identity,
        scenario.approvalOperationId,
      );
      assert.equal(claim.kind, "claimed");
      if (claim.kind !== "claimed") throw new Error("email approval was not claimed");
      const connector = modules.registryModule.externalActionConnectorForProvider("email");
      assert.ok(connector);
      const interruptedStorage = new Proxy(scenario.storage, {
        get(target, property, receiver) {
          if (property === "addEvent") {
            return async (event: Record<string, unknown>) => {
              if (event.eventType === "external_action_step_verified") {
                throw new Error("SIMULATED_RECEIPT_STORAGE_INTERRUPTION");
              }
              return (target as any).addEvent(event);
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await assert.rejects(
        () => connector.executeApproved({
          identity: scenario.identity,
          operation: claim.operation,
          storage: interruptedStorage as any,
        }),
        /SIMULATED_RECEIPT_STORAGE_INTERRUPTION/u,
      );
      assert.equal(fakeEmailTransportForTests.requestCount, 1);
      assert.equal(fakeEmailTransportForTests.messages.size, 1);

      const recovered = await connector.executeApproved({
        identity: scenario.identity,
        operation: claim.operation,
        storage: scenario.storage,
      });
      assert.equal(recovered.status, "unknown_result");
      assert.equal(recovered.retryable, false);
      assert.equal(recovered.reviewRequired, true);
      assert.equal(fakeEmailTransportForTests.requestCount, 1);
      assert.equal(fakeEmailTransportForTests.messages.size, 1);
      assert.ok(recovered.executionResult);
      await modules.operationModule.completeOperation(
        scenario.identity,
        scenario.approvalOperationId,
        recovered.executionResult!,
      );
      await scenario.runner.tick(new Date(Date.now() + 10_000));
      assert.equal((await scenario.storage.getWork(scenario.identity, scenario.workId))?.status, "needs_review");
    } finally {
      await scenario.cleanup();
    }
  });
});
