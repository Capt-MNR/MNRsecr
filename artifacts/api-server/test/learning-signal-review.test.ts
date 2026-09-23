import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { and, eq } from "drizzle-orm";
import {
  conversationMemoryTable,
  db,
  donationsTable,
  expensesTable,
  financialObligationsTable,
  financialPartiesTable,
  financialPaymentsTable,
  incomeReceivablesTable,
  learningSignalReviewsTable,
  remindersTable,
} from "@workspace/db";

const tenantId = `learning-review-${process.pid}-${Date.now()}`;
const otherTenantId = `${tenantId}-other`;
const userId = "learning-review-user";
process.env.SECRETARY_TENANT_ID = tenantId;
process.env.SECRETARY_USER_ID = userId;
process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY = "true";
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
  for (const table of [
    learningSignalReviewsTable,
    conversationMemoryTable,
    incomeReceivablesTable,
    donationsTable,
    financialObligationsTable,
    financialPaymentsTable,
    expensesTable,
    remindersTable,
    financialPartiesTable,
  ]) {
    await deleteOwned(table, tenantId);
    await deleteOwned(table, otherTenantId);
  }
}

const protectedRecordTables = {
  expenses: expensesTable,
  reminders: remindersTable,
  financialParties: financialPartiesTable,
  financialObligations: financialObligationsTable,
  financialPayments: financialPaymentsTable,
  donations: donationsTable,
  incomeReceivables: incomeReceivablesTable,
} as const;

type ProtectedRecordTable = typeof protectedRecordTables[keyof typeof protectedRecordTables];

async function snapshotProtectedTable(
  table: ProtectedRecordTable,
  ownerTenantId: string,
) {
  const rows = await db.select({
    id: table.id,
    rowVersion: table.rowVersion,
  }).from(table).where(and(
    eq(table.tenantId, ownerTenantId),
    eq(table.ownerUserId, userId),
  ));
  return {
    count: rows.length,
    rowVersions: rows
      .map((row) => ({ id: row.id, rowVersion: row.rowVersion }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

async function snapshotProtectedRecords(ownerTenantId: string) {
  const entries = await Promise.all(
    Object.entries(protectedRecordTables).map(async ([name, table]) => [
      name,
      await snapshotProtectedTable(table, ownerTenantId),
    ]),
  );
  return Object.fromEntries(entries);
}

async function seedProtectedRecords(ownerTenantId: string) {
  const [lender, borrower] = await db.insert(financialPartiesTable).values([
    {
      tenantId: ownerTenantId,
      ownerUserId: userId,
      partyType: "person",
      name: `${ownerTenantId} lender`,
      nameKey: `${ownerTenantId} lender`,
    },
    {
      tenantId: ownerTenantId,
      ownerUserId: userId,
      partyType: "external",
      name: `${ownerTenantId} borrower`,
      nameKey: `${ownerTenantId} borrower`,
    },
  ]).returning({ id: financialPartiesTable.id });
  assert.ok(lender && borrower);

  await db.insert(expensesTable).values({
    tenantId: ownerTenantId,
    ownerUserId: userId,
    amountMinor: 12_500,
    currency: "EGP",
    description: `${ownerTenantId} expense`,
  });
  await db.insert(remindersTable).values({
    tenantId: ownerTenantId,
    ownerUserId: userId,
    text: `${ownerTenantId} reminder`,
    dueAt: new Date("2099-09-16T10:00:00.000Z"),
  });
  await db.insert(financialObligationsTable).values({
    tenantId: ownerTenantId,
    ownerUserId: userId,
    kind: "debt",
    title: `${ownerTenantId} obligation`,
    lenderPartyId: lender.id,
    borrowerPartyId: borrower.id,
    principalAmountMinor: 50_000,
    currency: "EGP",
  });
  await db.insert(financialPaymentsTable).values({
    tenantId: ownerTenantId,
    ownerUserId: userId,
    payerPartyId: borrower.id,
    payeePartyId: lender.id,
    amountMinor: 5_000,
    currency: "EGP",
    description: `${ownerTenantId} payment`,
  });
  await db.insert(donationsTable).values({
    tenantId: ownerTenantId,
    ownerUserId: userId,
    donorPartyId: lender.id,
    recipientPartyId: borrower.id,
    amountMinor: 1_000,
    currency: "EGP",
    description: `${ownerTenantId} donation`,
  });
  await db.insert(incomeReceivablesTable).values({
    tenantId: ownerTenantId,
    ownerUserId: userId,
    kind: "receivable",
    title: `${ownerTenantId} receivable`,
    creditorPartyId: lender.id,
    debtorPartyId: borrower.id,
    amountMinor: 7_500,
    currency: "EGP",
  });
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
  await seedProtectedRecords(tenantId);
  await seedProtectedRecords(otherTenantId);

  await seedConversation(tenantId, "learning-review-current", [
    signalTurn("approve-turn"),
    signalTurn("context-turn"),
    signalTurn("reject-turn"),
  ]);
  await seedConversation(otherTenantId, "learning-review-foreign", [
    signalTurn("foreign-turn"),
  ]);

  const beforeCurrentRecords = await snapshotProtectedRecords(tenantId);
  const beforeOtherRecords = await snapshotProtectedRecords(otherTenantId);

  const listed = await request("/learning/signals");
  assert.equal(listed.status, 200);
  const signals = listed.body?.signals as Array<{ signalId: string; turnId: string; status: string }> | undefined;
  assert.equal(signals?.length, 3);
  assert.equal(signals?.some((signal) => signal.turnId === "foreign-turn"), false);

  const foreignReviewAttempt = await request(
    `/learning/signals/${encodeURIComponent(`${otherTenantId}:foreign-turn`)}/review`,
    "POST",
    { status: "approved" },
  );
  assert.equal(foreignReviewAttempt.status, 404);
  assert.deepEqual(
    await db.select({ signalId: learningSignalReviewsTable.signalId })
      .from(learningSignalReviewsTable)
      .where(and(
        eq(learningSignalReviewsTable.tenantId, tenantId),
        eq(learningSignalReviewsTable.ownerUserId, userId),
        eq(learningSignalReviewsTable.signalId, `${otherTenantId}:foreign-turn`),
      )),
    [],
  );
  assert.deepEqual(await snapshotProtectedRecords(tenantId), beforeCurrentRecords);
  assert.deepEqual(await snapshotProtectedRecords(otherTenantId), beforeOtherRecords);

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
    assert.deepEqual(await snapshotProtectedRecords(tenantId), beforeCurrentRecords);
    assert.deepEqual(await snapshotProtectedRecords(otherTenantId), beforeOtherRecords);
  }

  const approvedReview = await db.select({
    status: learningSignalReviewsTable.status,
    benchmarkPayload: learningSignalReviewsTable.benchmarkPayload,
  }).from(learningSignalReviewsTable).where(and(
    eq(learningSignalReviewsTable.tenantId, tenantId),
    eq(learningSignalReviewsTable.ownerUserId, userId),
    eq(learningSignalReviewsTable.signalId, signals?.find((signal) => signal.turnId === "approve-turn")?.signalId ?? ""),
  ));
  assert.equal(approvedReview[0]?.status, "approved");
  assert.deepEqual(approvedReview[0]?.benchmarkPayload, {
    signalId: "learning-review-current:approve-turn",
    conversationId: "learning-review-current",
    conversationTitle: "لا، قصدي التصحيح approve-turn",
    turnId: "approve-turn",
    previousTurnId: "previous-approve-turn",
    category: "amount",
    dialect: "unknown",
    confidence: 0.95,
    userMessage: "لا، قصدي التصحيح approve-turn",
    assistantMessage: "تم حفظ الرد السابق.",
    previousUserMessage: null,
    previousAssistantMessage: null,
    previousActionType: "record_expense",
    createdAt: "2026-09-16T11:30:00.000Z",
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