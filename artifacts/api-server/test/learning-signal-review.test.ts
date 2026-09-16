import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { and, eq } from "drizzle-orm";
import {
  conversationMemoryTable,
  db,
  expensesTable,
  learningSignalReviewsTable,
} from "@workspace/db";

const tenantId = `learning-review-${process.pid}-${Date.now()}`;
const otherTenantId = `${tenantId}-other`;
const userId = "learning-review-user";
process.env.SECRETARY_TENANT_ID = tenantId;
process.env.SECRETARY_USER_ID = userId;
process.env.AI_PROVIDER = "development";

const { default: app } = await import("../src/app.ts");

let server: ReturnType<typeof app.listen>;
let baseUrl = "";

async function deleteOwned(table: any, ownerTenantId: string) {
  await db.delete(table).where(and(
    eq(table.tenantId, ownerTenantId),
    eq(table.ownerUserId, userId),
  ));
}

async function cleanup() {
  for (const table of [learningSignalReviewsTable, conversationMemoryTable, expensesTable]) {
    await deleteOwned(table, tenantId);
    await deleteOwned(table, otherTenantId);
  }
}

async function request(
  path: string,
  method = "GET",
  body?: unknown,
) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      authorization: "Bearer dev-user",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Record<string, any> : null,
  };
}

function signalTurn(turnId: string) {
  return {
    turnId,
    userMessage: `لا، قصدي التصحيح ${turnId}`,
    assistantMessage: "تم حفظ الرد السابق.",
    action: {
      type: "expense_recorded",
      learningSignal: {
        kind: "explicit_correction",
        category: "amount",
        confidence: 0.95,
        previousTurnId: `previous-${turnId}`,
        previousActionType: "record_expense",
        reviewOnly: true,
        autoApply: false,
      },
    },
    createdAt: "2026-09-16T11:30:00.000Z",
  };
}

async function seedConversation(
  ownerTenantId: string,
  conversationId: string,
  turns: unknown[],
) {
  await db.insert(conversationMemoryTable).values({
    tenantId: ownerTenantId,
    ownerUserId: userId,
    conversationId,
    recentStateJson: JSON.stringify(turns),
    summary: "اختبار إشارات التصحيح",
    turnCount: turns.length,
  });
}

before(async () => {
  await cleanup();
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a port.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await cleanup();
});

test("review decisions stay tenant-scoped and never mutate financial records", async () => {
  const expense = await db.insert(expensesTable).values({
    tenantId,
    ownerUserId: userId,
    amountMinor: 12_500,
    currency: "EGP",
    description: "fixture لا يجب تغييره",
  }).returning();
  const beforeExpense = expense[0];
  assert.ok(beforeExpense);

  await seedConversation(tenantId, "learning-review-current", [
    signalTurn("approve-turn"),
    signalTurn("context-turn"),
    signalTurn("reject-turn"),
  ]);
  await seedConversation(otherTenantId, "learning-review-foreign", [
    signalTurn("foreign-turn"),
  ]);

  const listed = await request("/learning/signals");
  assert.equal(listed.status, 200);
  const signals = listed.body?.signals as Array<{ signalId: string; turnId: string; status: string }> | undefined;
  assert.equal(signals?.length, 3);
  assert.equal(signals?.some((signal) => signal.turnId === "foreign-turn"), false);

  const decisions = [
    ["approve-turn", "approved"],
    ["context-turn", "needs_context"],
    ["reject-turn", "rejected"],
  ] as const;
  for (const [turnId, status] of decisions) {
    const signal = signals?.find((item) => item.turnId === turnId);
    assert.ok(signal);
    const reviewed = await request(
      `/learning/signals/${encodeURIComponent(signal.signalId)}/review`,
      "POST",
      { status },
    );
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body?.status, status);
    assert.equal(reviewed.body?.benchmarkReady, status === "approved");
  }

  const afterExpense = await db.select({
    id: expensesTable.id,
    amountMinor: expensesTable.amountMinor,
    currency: expensesTable.currency,
    description: expensesTable.description,
    rowVersion: expensesTable.rowVersion,
  }).from(expensesTable).where(and(
    eq(expensesTable.tenantId, tenantId),
    eq(expensesTable.ownerUserId, userId),
    eq(expensesTable.id, beforeExpense.id),
  ));
  assert.deepEqual(afterExpense[0], {
    id: beforeExpense.id,
    amountMinor: 12_500,
    currency: "EGP",
    description: "fixture لا يجب تغييره",
    rowVersion: 1,
  });

  const reviewedList = await request("/learning/signals");
  const reviewedByTurn = new Map(
    (reviewedList.body?.signals as Array<{ turnId: string; status: string }>).map((signal) => [signal.turnId, signal.status]),
  );
  assert.deepEqual(Object.fromEntries(reviewedByTurn), {
    "approve-turn": "approved",
    "context-turn": "needs_context",
    "reject-turn": "rejected",
  });
});