import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  activityEventEntitiesTable,
  activityEventsTable,
  db,
  financialPartiesTable,
  secretaryOperationsTable,
} from "@workspace/db";
import { executeStructuredTool } from "../src/lib/phase2";
import { claimOperation, createPendingOperation } from "../src/lib/secretary-operations";

const identity = {
  tenantId: `activity-atomicity-${process.pid}-${Date.now()}`,
  userId: "activity-test-user",
};

async function cleanup() {
  await db.delete(activityEventEntitiesTable).where(and(
    eq(activityEventEntitiesTable.tenantId, identity.tenantId),
    eq(activityEventEntitiesTable.ownerUserId, identity.userId),
  ));
  await db.delete(activityEventsTable).where(and(
    eq(activityEventsTable.tenantId, identity.tenantId),
    eq(activityEventsTable.ownerUserId, identity.userId),
  ));
  await db.delete(financialPartiesTable).where(and(
    eq(financialPartiesTable.tenantId, identity.tenantId),
    eq(financialPartiesTable.ownerUserId, identity.userId),
  ));
  await db.delete(secretaryOperationsTable).where(and(
    eq(secretaryOperationsTable.tenantId, identity.tenantId),
    eq(secretaryOperationsTable.ownerUserId, identity.userId),
  ));
}

async function createApprovedOperation(label: string): Promise<string> {
  const pending = await createPendingOperation(identity, {
    toolName: "create_financial_party",
    args: { partyType: "external", name: label },
    idempotencyKey: `activity-${label}`,
  });
  const claimed = await claimOperation(identity, pending.operationId);
  assert.equal(claimed.kind, "claimed");
  return claimed.operation.operationId;
}

test("rolls back the financial mutation when activity recording fails", async () => {
  await cleanup();
  const operationId = await createApprovedOperation("فشل النشاط");
  await assert.rejects(
    executeStructuredTool(identity, "create_financial_party", {
      partyType: "external",
      name: "فشل النشاط",
    }, {
      requestId: "activity-failure-test",
      approvedOperationId: operationId,
      activityWriter: async () => {
        throw new Error("forced activity failure");
      },
    }),
    /forced activity failure/,
  );
  const parties = await db.select().from(financialPartiesTable).where(and(
    eq(financialPartiesTable.tenantId, identity.tenantId),
    eq(financialPartiesTable.ownerUserId, identity.userId),
  ));
  const events = await db.select().from(activityEventsTable).where(and(
    eq(activityEventsTable.tenantId, identity.tenantId),
    eq(activityEventsTable.ownerUserId, identity.userId),
  ));
  assert.equal(parties.length, 0);
  assert.equal(events.length, 0);
});

test("commits the financial mutation and its activity event together", async () => {
  await cleanup();
  const operationId = await createApprovedOperation("طرف مالي");
  const result = await executeStructuredTool(identity, "create_financial_party", {
    partyType: "external",
    name: "طرف مالي",
  }, {
    requestId: "activity-success-test",
    approvedOperationId: operationId,
  });
  assert.equal(result.ok, true);
  const parties = await db.select().from(financialPartiesTable).where(and(
    eq(financialPartiesTable.tenantId, identity.tenantId),
    eq(financialPartiesTable.ownerUserId, identity.userId),
  ));
  const events = await db.select().from(activityEventsTable).where(and(
    eq(activityEventsTable.tenantId, identity.tenantId),
    eq(activityEventsTable.ownerUserId, identity.userId),
  ));
  const links = await db.select().from(activityEventEntitiesTable).where(and(
    eq(activityEventEntitiesTable.tenantId, identity.tenantId),
    eq(activityEventEntitiesTable.ownerUserId, identity.userId),
  ));
  assert.equal(parties.length, 1);
  assert.equal(events.length, 1);
  assert.equal(links.length, 1);
  assert.equal(links[0]?.entityId, parties[0]?.id);
  await cleanup();
});