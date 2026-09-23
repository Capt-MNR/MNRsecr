import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  activityEventEntitiesTable,
  activityEventsTable,
  db,
  expensesTable,
  financialPartiesTable,
  secretaryOperationsTable,
} from "@workspace/db";
import { recordToolActivity } from "../src/lib/entity-graph";
import { executeStructuredTool } from "../src/lib/phase2";
import {
  executeApprovedOperation,
  type Identity,
} from "../src/lib/secretary";
import {
  claimOperation,
  completeOperation,
  completeOperationWithExecutor,
  createPendingOperation,
  failOperation,
  getOperation,
  type PendingOperation,
} from "../src/lib/secretary-operations";

let sequence = 0;

function identity(label: string): Identity {
  sequence += 1;
  return {
    tenantId: `approval-recovery-${process.pid}-${Date.now()}-${sequence}-${label}`,
    userId: `user-${label}`,
  };
}

async function cleanup(owner: Identity): Promise<void> {
  await db.delete(activityEventEntitiesTable).where(and(
    eq(activityEventEntitiesTable.tenantId, owner.tenantId),
    eq(activityEventEntitiesTable.ownerUserId, owner.userId),
  ));
  await db.delete(activityEventsTable).where(and(
    eq(activityEventsTable.tenantId, owner.tenantId),
    eq(activityEventsTable.ownerUserId, owner.userId),
  ));
  await db.delete(financialPartiesTable).where(and(
    eq(financialPartiesTable.tenantId, owner.tenantId),
    eq(financialPartiesTable.ownerUserId, owner.userId),
  ));
  await db.delete(expensesTable).where(and(
    eq(expensesTable.tenantId, owner.tenantId),
    eq(expensesTable.ownerUserId, owner.userId),
  ));
  await db.delete(secretaryOperationsTable).where(and(
    eq(secretaryOperationsTable.tenantId, owner.tenantId),
    eq(secretaryOperationsTable.ownerUserId, owner.userId),
  ));
}

async function claimedOperation(
  owner: Identity,
  toolName: string,
  args: Record<string, unknown>,
): Promise<PendingOperation> {
  const pending = await createPendingOperation(owner, {
    toolName,
    args,
    idempotencyKey: `approval-${owner.tenantId}-${toolName}`,
  });
  const claim = await claimOperation(owner, pending.operationId);
  assert.equal(claim.kind, "claimed");
  return claim.operation;
}

async function parties(owner: Identity) {
  return db.select().from(financialPartiesTable).where(and(
    eq(financialPartiesTable.tenantId, owner.tenantId),
    eq(financialPartiesTable.ownerUserId, owner.userId),
  ));
}

async function events(owner: Identity) {
  return db.select().from(activityEventsTable).where(and(
    eq(activityEventsTable.tenantId, owner.tenantId),
    eq(activityEventsTable.ownerUserId, owner.userId),
  ));
}

test("normal approval atomically commits mutation, activity, verification, and operation result", async () => {
  const owner = identity("normal");
  await cleanup(owner);
  const operation = await claimedOperation(owner, "create_financial_party", {
    partyType: "external",
    name: "طرف ذري",
  });

  const result = await executeApprovedOperation(owner, operation);
  const stored = await getOperation(owner, operation.operationId);
  const savedParties = await parties(owner);
  const savedEvents = await events(owner);

  assert.equal(result.action?.operationId, operation.operationId);
  assert.equal(stored?.status, "completed");
  assert.equal(stored?.result?.action?.operationId, operation.operationId);
  assert.equal(savedParties.length, 1);
  assert.equal(savedEvents.length, 1);
  assert.equal(savedEvents[0]?.metadata.sourceOperationId, operation.operationId);
  assert.deepEqual(
    (stored?.result?.action?.verification as Record<string, unknown>)?.state,
    "verified",
  );

  const outerCompletion = await completeOperation(owner, operation.operationId, result);
  assert.equal(outerCompletion.status, "completed");
  await cleanup(owner);
});

test("failure before mutation marks the operation failed without activity or domain rows", async () => {
  const owner = identity("before");
  await cleanup(owner);
  const operation = await claimedOperation(owner, "create_financial_party", {
    partyType: "external",
  });

  await assert.rejects(
    executeApprovedOperation(owner, operation),
    /name is required/,
  );
  const failed = await failOperation(owner, operation.operationId, "forced validation failure");

  assert.equal(failed.status, "failed");
  assert.equal((await parties(owner)).length, 0);
  assert.equal((await events(owner)).length, 0);
  await cleanup(owner);
});

test("failure after mutation work starts but before completion rolls back and can be retried after restart", async () => {
  const owner = identity("rollback");
  await cleanup(owner);
  const operation = await claimedOperation(owner, "create_financial_party", {
    partyType: "external",
    name: "يجب التراجع",
  });

  await assert.rejects(
    executeStructuredTool(owner, "create_financial_party", {
      partyType: "external",
      name: "يجب التراجع",
    }, {
      requestId: `forced-crash-${operation.operationId}`,
      approvedOperationId: operation.operationId,
      operationCompletion: async () => {
        throw new Error("simulated process termination before completion");
      },
    }),
    /simulated process termination/,
  );

  assert.equal((await parties(owner)).length, 0);
  assert.equal((await events(owner)).length, 0);
  assert.equal((await getOperation(owner, operation.operationId))?.status, "executing");

  await db.update(secretaryOperationsTable)
    .set({ claimedAt: new Date(Date.now() - 2 * 60 * 1000) })
    .where(and(
      eq(secretaryOperationsTable.id, operation.operationId),
      eq(secretaryOperationsTable.tenantId, owner.tenantId),
      eq(secretaryOperationsTable.ownerUserId, owner.userId),
    ));

  const retryClaim = await claimOperation(owner, operation.operationId);
  assert.equal(retryClaim.kind, "claimed");
  const retryResult = await executeApprovedOperation(owner, retryClaim.operation);
  const completed = await getOperation(owner, operation.operationId);

  assert.equal(retryResult.action?.operationId, operation.operationId);
  assert.equal(completed?.status, "completed");
  assert.equal((await parties(owner)).length, 1);
  assert.equal((await events(owner)).length, 1);
  await cleanup(owner);
});

test("restart reconciles a committed mutation receipt without executing it again", async () => {
  const owner = identity("receipt-restart");
  await cleanup(owner);
  const operation = await claimedOperation(owner, "create_financial_party", {
    partyType: "external",
    name: "تم قبل الانقطاع",
  });

  await executeStructuredTool(owner, "create_financial_party", {
    partyType: "external",
    name: "تم قبل الانقطاع",
  }, {
    requestId: `committed-before-crash-${operation.operationId}`,
    approvedOperationId: operation.operationId,
    // Simulates the old boundary: mutation and activity commit, then the
    // process stops before the operation row is completed.
    operationCompletion: async () => {},
  });

  assert.equal((await parties(owner)).length, 1);
  assert.equal((await events(owner)).length, 1);
  assert.equal((await getOperation(owner, operation.operationId))?.status, "executing");

  await db.update(secretaryOperationsTable)
    .set({ claimedAt: new Date(Date.now() - 2 * 60 * 1000) })
    .where(and(
      eq(secretaryOperationsTable.id, operation.operationId),
      eq(secretaryOperationsTable.tenantId, owner.tenantId),
      eq(secretaryOperationsTable.ownerUserId, owner.userId),
    ));

  const retry = await claimOperation(owner, operation.operationId);
  const reconciled = await getOperation(owner, operation.operationId);

  assert.equal(retry.kind, "existing");
  assert.equal(retry.operation.status, "completed");
  assert.equal(reconciled?.result?.action?.type, "operation_reconciled");
  assert.equal((await parties(owner)).length, 1);
  assert.equal((await events(owner)).length, 1);
  await cleanup(owner);
});

test("a stale retry waits for an active mutation transaction instead of resetting it", async () => {
  const owner = identity("active-race");
  await cleanup(owner);
  const operation = await claimedOperation(owner, "create_financial_party", {
    partyType: "external",
    name: "لا يتكرر",
  });
  await db.update(secretaryOperationsTable)
    .set({ claimedAt: new Date(Date.now() - 2 * 60 * 1000) })
    .where(and(
      eq(secretaryOperationsTable.id, operation.operationId),
      eq(secretaryOperationsTable.tenantId, owner.tenantId),
      eq(secretaryOperationsTable.ownerUserId, owner.userId),
    ));

  let enteredActivity!: () => void;
  const activityEntered = new Promise<void>((resolve) => {
    enteredActivity = resolve;
  });
  let releaseTransaction!: () => void;
  const transactionReleased = new Promise<void>((resolve) => {
    releaseTransaction = resolve;
  });

  const originalExecution = executeStructuredTool(owner, "create_financial_party", {
    partyType: "external",
    name: "لا يتكرر",
  }, {
    requestId: `active-race-${operation.operationId}`,
    approvedOperationId: operation.operationId,
    activityWriter: async (activityIdentity, toolName, args, result, executor) => {
      await recordToolActivity(activityIdentity, toolName, args, result, executor);
      enteredActivity();
      await transactionReleased;
    },
    operationCompletion: async (verifiedResult, executor) => {
      await completeOperationWithExecutor(owner, operation.operationId, {
        conversationId: "",
        assistantMessage: "test",
        action: { operationId: operation.operationId, toolResult: verifiedResult },
        provider: "test",
        model: "test",
      }, executor, true);
    },
  });
  await activityEntered;

  let retrySettled = false;
  const retry = claimOperation(owner, operation.operationId).then((value) => {
    retrySettled = true;
    return value;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(retrySettled, false);

  releaseTransaction();
  const [, retryResult] = await Promise.all([originalExecution, retry]);
  const completed = await getOperation(owner, operation.operationId);

  assert.equal(retryResult.kind, "existing");
  assert.equal(retryResult.operation.status, "completed");
  assert.equal(completed?.status, "completed");
  assert.equal((await parties(owner)).length, 1);
  assert.equal((await events(owner)).length, 1);
  await cleanup(owner);
});

test("duplicate approval returns the completed operation and never mutates twice", async () => {
  const owner = identity("duplicate");
  await cleanup(owner);
  const operation = await claimedOperation(owner, "create_financial_party", {
    partyType: "external",
    name: "مرة واحدة",
  });
  await executeApprovedOperation(owner, operation);

  const duplicate = await claimOperation(owner, operation.operationId);
  assert.equal(duplicate.kind, "existing");
  assert.equal(duplicate.operation.status, "completed");
  assert.equal((await parties(owner)).length, 1);
  assert.equal((await events(owner)).length, 1);
  await cleanup(owner);
});

test("stale row version fails without changing the record", async () => {
  const owner = identity("stale");
  await cleanup(owner);
  const [expense] = await db.insert(expensesTable).values({
    tenantId: owner.tenantId,
    ownerUserId: owner.userId,
    amountMinor: 1000,
    currency: "EGP",
    description: "قبل التعديل",
    rowVersion: 2,
  }).returning();
  const operation = await claimedOperation(owner, "update_expense", {
    expenseId: expense.id,
    amountMinor: 2000,
    expectedRowVersion: 1,
  });

  await assert.rejects(
    executeApprovedOperation(owner, operation),
    /Record changed after this edit was opened/,
  );
  const failed = await failOperation(owner, operation.operationId, "stale row version");
  const [unchanged] = await db.select().from(expensesTable).where(eq(expensesTable.id, expense.id));

  assert.equal(failed.status, "failed");
  assert.equal(unchanged?.amountMinor, 1000);
  assert.equal(unchanged?.rowVersion, 2);
  assert.equal((await events(owner)).length, 0);
  await cleanup(owner);
});

test("tenant and owner scoping prevents claiming another user's operation", async () => {
  const owner = identity("owner");
  const other = identity("other");
  await cleanup(owner);
  await cleanup(other);
  const operation = await claimedOperation(owner, "create_financial_party", {
    partyType: "external",
    name: "خاص",
  });

  await assert.rejects(
    claimOperation(other, operation.operationId),
    /Pending operation was not found/,
  );
  assert.equal((await parties(owner)).length, 0);
  assert.equal((await parties(other)).length, 0);
  await cleanup(owner);
  await cleanup(other);
});

test("activity and operation evidence remain paired on a recovered completion", async () => {
  const owner = identity("receipt");
  await cleanup(owner);
  const operation = await claimedOperation(owner, "create_financial_party", {
    partyType: "external",
    name: "إثبات",
  });

  await executeApprovedOperation(owner, operation);
  const stored = await getOperation(owner, operation.operationId);
  const savedEvents = await events(owner);

  assert.equal(savedEvents.length, 1);
  assert.equal(savedEvents[0]?.metadata.sourceOperationId, operation.operationId);
  assert.equal(
    (stored?.result?.action?.verification as Record<string, unknown>)?.state,
    "verified",
  );
  assert.equal(stored?.status, "completed");
  await cleanup(owner);
});