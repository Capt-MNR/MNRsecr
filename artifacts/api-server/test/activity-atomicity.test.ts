import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  activityEventEntitiesTable,
  activityEventsTable,
  db,
  financialPartiesTable,
} from "@workspace/db";
import { executeStructuredTool } from "../src/lib/phase2";

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
}

test("rolls back the financial mutation when activity recording fails", async () => {
  await cleanup();
  await assert.rejects(
    executeStructuredTool(identity, "create_financial_party", {
      partyType: "external",
      name: "فشل النشاط",
    }, {
      requestId: "activity-failure-test",
      approvedOperationId: "activity-failure-operation",
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
  const result = await executeStructuredTool(identity, "create_financial_party", {
    partyType: "external",
    name: "طرف مالي",
  }, {
    requestId: "activity-success-test",
    approvedOperationId: "activity-success-operation",
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