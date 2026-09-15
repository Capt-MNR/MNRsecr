import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { and, eq } from "drizzle-orm";
import {
  activityEventEntitiesTable,
  activityEventsTable,
  db,
  expensesTable,
  financialObligationsTable,
  financialPartyPeopleTable,
  financialPartyProjectsTable,
  financialPartiesTable,
  financialPaymentsTable,
  idempotencyRecordsTable,
  obligationSettlementsTable,
  peopleTable,
  projectPeopleTable,
  projectsTable,
  secretaryOperationsTable,
  taskProjectsTable,
  tasksTable,
} from "@workspace/db";
import { recordActivityEvent } from "../src/lib/entity-graph.ts";

const tenantId = `http-phase3-${process.pid}-${Date.now()}`;
const userId = "http-phase3-user";
process.env.SECRETARY_TENANT_ID = tenantId;
process.env.SECRETARY_USER_ID = userId;
process.env.AI_PROVIDER = "development";

const { default: app } = await import("../src/app.ts");

let server: ReturnType<typeof app.listen>;
let baseUrl = "";

async function deleteOwned(table: any) {
  await db.delete(table).where(and(
    eq(table.tenantId, tenantId),
    eq(table.ownerUserId, userId),
  ));
}

async function cleanup() {
  for (const table of [
    activityEventEntitiesTable,
    activityEventsTable,
    secretaryOperationsTable,
    idempotencyRecordsTable,
    obligationSettlementsTable,
    taskProjectsTable,
    financialPartyPeopleTable,
    financialPartyProjectsTable,
    projectPeopleTable,
    financialPaymentsTable,
    financialObligationsTable,
    expensesTable,
    tasksTable,
    projectsTable,
    peopleTable,
    financialPartiesTable,
  ]) {
    await deleteOwned(table);
  }
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

async function request(
  path: string,
  method = "GET",
  body?: unknown,
  authorization = "Bearer dev-user",
) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      authorization,
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

async function approve(operationId: string, body: Record<string, unknown> = {}) {
  return request(`/approvals/${operationId}/approve`, "POST", body);
}

async function createAndApprove(
  path: string,
  body: Record<string, unknown>,
  method = "POST",
) {
  const pending = await request(path, method, body);
  assert.equal(pending.status, 202);
  assert.equal(pending.body?.pendingApproval, true);
  const operationId = pending.body?.approval?.operationId;
  assert.equal(typeof operationId, "string");
  const approved = await approve(operationId);
  return { pending, approved, operationId };
}

test("HTTP approval is server-side on the first request and idempotent", async () => {
  const [person] = await db.insert(peopleTable).values({
    tenantId,
    ownerUserId: userId,
    name: "محمد",
    nameKey: "محمد",
  }).returning();
  const [project] = await db.insert(projectsTable).values({
    tenantId,
    ownerUserId: userId,
    name: "المحجر",
    nameKey: "المحجر",
  }).returning();

  const turnIdempotencyKey = `http-turn-${Date.now()}`;
  const turn = await request("/turns", "POST", {
    message: "دفعت لمحمد 500 جنيه في مشروع المحجر",
    conversationId: `http-approval-conversation-${Date.now()}`,
    idempotencyKey: turnIdempotencyKey,
  });
  assert.equal(turn.status, 200);
  assert.equal(turn.body?.action?.type, "approval_required");
  assert.equal(typeof turn.body?.action?.operationId, "string");
  assert.equal(turn.body?.action?.status, "pending");
  assert.equal(turn.body?.action?.args?.amountMinor, 50000, JSON.stringify(turn.body));

  const operationId = turn.body.action.operationId as string;
  const stored = await db.select().from(secretaryOperationsTable).where(and(
    eq(secretaryOperationsTable.tenantId, tenantId),
    eq(secretaryOperationsTable.ownerUserId, userId),
    eq(secretaryOperationsTable.id, operationId),
  ));
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.status, "pending");

  const refreshed = await request(`/approvals/${operationId}`);
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body?.status, "pending");
  assert.equal(refreshed.body?.args?.amountMinor, 50000);

  const retry = await request("/turns", "POST", {
    message: "دفعت لمحمد 500 جنيه في مشروع المحجر",
    conversationId: turn.body.conversationId,
    idempotencyKey: turnIdempotencyKey,
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body?.action?.operationId, operationId);
  const sameOperation = await db.select().from(secretaryOperationsTable).where(and(
    eq(secretaryOperationsTable.tenantId, tenantId),
    eq(secretaryOperationsTable.ownerUserId, userId),
    eq(secretaryOperationsTable.id, operationId),
  ));
  assert.equal(sameOperation.length, 1);

  const rejected = await request("/records", "POST", {
    recordType: "expense",
    amountMinor: 12300,
    currency: "EGP",
    description: "مصروف مرفوض",
    idempotencyKey: `reject-${Date.now()}`,
  });
  assert.equal(rejected.status, 202);
  const rejectedId = rejected.body?.approval?.operationId as string;
  const rejectResponse = await request(`/approvals/${rejectedId}/reject`, "POST", {});
  assert.equal(rejectResponse.status, 200);
  assert.equal(rejectResponse.body?.status, "rejected");
  const rejectedExpenses = await db.select().from(expensesTable).where(and(
    eq(expensesTable.tenantId, tenantId),
    eq(expensesTable.ownerUserId, userId),
    eq(expensesTable.description, "مصروف مرفوض"),
  ));
  assert.equal(rejectedExpenses.length, 0);

  const approvedIdempotencyKey = `approve-${Date.now()}`;
  const approvedRequest = await request("/records", "POST", {
    recordType: "expense",
    amountMinor: 25000,
    currency: "EGP",
    description: "مصروف موافق عليه",
    idempotencyKey: approvedIdempotencyKey,
  });
  assert.equal(approvedRequest.status, 202);
  const approvedId = approvedRequest.body?.approval?.operationId as string;
  const approved = await approve(approvedId, {
    toolName: "different_tool",
    arguments: { amountMinor: 1 },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body?.status, "completed");

  const saved = await db.select().from(expensesTable).where(and(
    eq(expensesTable.tenantId, tenantId),
    eq(expensesTable.ownerUserId, userId),
    eq(expensesTable.description, "مصروف موافق عليه"),
  ));
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.amountMinor, 25000);

  const events = await db.select().from(activityEventsTable).where(and(
    eq(activityEventsTable.tenantId, tenantId),
    eq(activityEventsTable.ownerUserId, userId),
  ));
  assert.ok(events.some((event) => event.sourceId === saved[0]?.id));

  const duplicateApprove = await approve(approvedId);
  assert.equal(duplicateApprove.status, 200);
  assert.equal(duplicateApprove.body?.status, "completed");
  const afterDuplicate = await db.select().from(expensesTable).where(and(
    eq(expensesTable.tenantId, tenantId),
    eq(expensesTable.ownerUserId, userId),
    eq(expensesTable.description, "مصروف موافق عليه"),
  ));
  assert.equal(afterDuplicate.length, 1);

  const retryAfterCompletion = await request("/records", "POST", {
    recordType: "expense",
    amountMinor: 25000,
    currency: "EGP",
    description: "مصروف موافق عليه",
    idempotencyKey: approvedIdempotencyKey,
  });
  assert.equal(retryAfterCompletion.status, 202);
  const retryId = retryAfterCompletion.body?.approval?.operationId as string;
  const retryApproval = await approve(retryId);
  assert.equal(retryApproval.status, 200);
  const secondRetry = await request("/records", "POST", {
    recordType: "expense",
    amountMinor: 25000,
    currency: "EGP",
    description: "مصروف موافق عليه",
    idempotencyKey: approvedIdempotencyKey,
  });
  assert.equal(secondRetry.status, 202);

  const foreignTenant = `${tenantId}-foreign`;
  const previousTenant = process.env.SECRETARY_TENANT_ID;
  process.env.SECRETARY_TENANT_ID = foreignTenant;
  try {
    const foreignGet = await request(`/approvals/${approvedId}`);
    assert.equal(foreignGet.status, 404);
    const foreignApprove = await approve(approvedId);
    assert.equal(foreignApprove.status, 404);
  } finally {
    process.env.SECRETARY_TENANT_ID = previousTenant;
  }
});

test("HTTP entity detail is authorized, typed, bounded, and paginated", async () => {
  const [person] = await db.insert(peopleTable).values({
    tenantId,
    ownerUserId: userId,
    name: "تفاصيل الشخص",
    nameKey: "تفاصيل الشخص",
  }).returning();
  const projects = await db.insert(projectsTable).values(
    Array.from({ length: 101 }, (_, index) => ({
      tenantId,
      ownerUserId: userId,
      name: `تفاصيل مشروع ${index}`,
      nameKey: `تفاصيل مشروع ${index}`,
    })),
  ).returning();
  await db.insert(projectPeopleTable).values(projects.map((project) => ({
    tenantId,
    ownerUserId: userId,
    projectId: project.id,
    personId: person.id,
    relationship: "member",
  })));
  const [party] = await db.insert(financialPartiesTable).values({
    tenantId,
    ownerUserId: userId,
    partyType: "person",
    name: "طرف تفاصيل",
    nameKey: "طرف تفاصيل",
  }).returning();
  await db.insert(financialPartyPeopleTable).values({
    tenantId,
    ownerUserId: userId,
    partyId: party.id,
    personId: person.id,
    relationship: "owner",
  });
  await db.insert(financialPartyProjectsTable).values({
    tenantId,
    ownerUserId: userId,
    partyId: party.id,
    projectId: projects[0].id,
    relationship: "funds",
  });
  const [task] = await db.insert(tasksTable).values({
    tenantId,
    ownerUserId: userId,
    title: "مهمة typed",
  }).returning();
  await db.insert(taskProjectsTable).values({
    tenantId,
    ownerUserId: userId,
    taskId: task.id,
    projectId: projects[0].id,
    relationship: "tracked",
  });
  for (let index = 0; index < 3; index += 1) {
    await recordActivityEvent({
      tenantId,
      userId,
    }, {
      eventType: `http.entity.${index}`,
      sourceType: "test",
      sourceId: person.id,
      summary: `entity event ${index}`,
      entities: [{ entityType: "person", entityId: person.id }],
    });
  }

  const personResponse = await request(`/entities/person/${person.id}`);
  assert.equal(personResponse.status, 200);
  assert.equal(personResponse.body?.entity?.id, person.id);
  assert.equal(personResponse.body?.related?.projects.length, 100);
  assert.equal(personResponse.body?.related?.financialParties[0]?.id, party.id);

  const projectResponse = await request(`/entities/project/${projects[0].id}`);
  assert.equal(projectResponse.status, 200);
  assert.equal(projectResponse.body?.entity?.id, projects[0].id);
  assert.equal(projectResponse.body?.related?.tasks[0]?.id, task.id);

  const partyResponse = await request(`/entities/financial_party/${party.id}`);
  assert.equal(partyResponse.status, 200);
  assert.equal(partyResponse.body?.entity?.id, party.id);
  assert.equal(partyResponse.body?.related?.people[0]?.id, person.id);
  assert.equal(partyResponse.body?.related?.projects[0]?.id, projects[0].id);

  const page = await request(`/entities/person/${person.id}/timeline?limit=1&offset=1`);
  assert.equal(page.status, 200);
  assert.equal(page.body?.events.length, 1);
  const hardMax = await request(`/entities/person/${person.id}/timeline?limit=1000&offset=0`);
  assert.equal(hardMax.status, 200);
  assert.ok(hardMax.body?.events.length <= 100);

  const invalidUuid = await request("/entities/person/not-a-uuid");
  assert.equal(invalidUuid.status, 400);
  const invalidType = await request(`/entities/unknown/${person.id}`);
  assert.equal(invalidType.status, 400);
  const missing = await request("/entities/person/00000000-0000-4000-8000-000000000000");
  assert.equal(missing.status, 404);

  const foreignPerson = await db.insert(peopleTable).values({
    tenantId: `${tenantId}-other`,
    ownerUserId: userId,
    name: "شخص مستأجر آخر",
    nameKey: "شخص مستأجر آخر",
  }).returning();
  const foreignProject = await db.insert(projectsTable).values({
    tenantId: `${tenantId}-other`,
    ownerUserId: userId,
    name: "مشروع مستأجر آخر",
    nameKey: "مشروع مستأجر آخر",
  }).returning();
  const foreignParty = await db.insert(financialPartiesTable).values({
    tenantId: `${tenantId}-other`,
    ownerUserId: userId,
    partyType: "external",
    name: "طرف مستأجر آخر",
    nameKey: "طرف مستأجر آخر",
  }).returning();
  assert.equal((await request(`/entities/person/${foreignPerson[0].id}`)).status, 404);
  assert.equal((await request(`/entities/project/${foreignProject[0].id}`)).status, 404);
  assert.equal((await request(`/entities/financial_party/${foreignParty[0].id}`)).status, 404);

  await db.insert(projectPeopleTable).values({
    tenantId,
    ownerUserId: userId,
    projectId: projects[0].id,
    personId: foreignPerson[0].id,
    relationship: "foreign",
  });
  await db.insert(financialPartyPeopleTable).values({
    tenantId,
    ownerUserId: userId,
    partyId: party.id,
    personId: foreignPerson[0].id,
    relationship: "foreign",
  });
  const isolatedProject = await request(`/entities/project/${projects[0].id}`);
  assert.equal(isolatedProject.status, 200);
  assert.equal(isolatedProject.body?.related?.people.some((item: any) => item.id === foreignPerson[0].id), false);
  const isolatedParty = await request(`/entities/financial_party/${party.id}`);
  assert.equal(isolatedParty.status, 200);
  assert.equal(isolatedParty.body?.related?.people.some((item: any) => item.id === foreignPerson[0].id), false);
});

test("HTTP financial mutations preserve approval, invariants, corrections, and row versions", async () => {
  const createParty = async (name: string) => {
    const result = await createAndApprove("/financial/parties", {
      partyType: "external",
      name,
      idempotencyKey: `${name}-${Date.now()}-${Math.random()}`,
    });
    assert.equal(result.approved.body?.status, "completed");
    return result.approved.body.action.toolResult.financial_party as { id: string };
  };
  const lender = await createParty("مقرض HTTP");
  const borrower = await createParty("مقترض HTTP");
  const obligationResult = await createAndApprove("/financial/obligations", {
    kind: "debt",
    title: "التزام HTTP",
    lenderPartyId: lender.id,
    borrowerPartyId: borrower.id,
    principalAmountMinor: 10000,
    currency: "EGP",
    idempotencyKey: `obligation-${Date.now()}`,
  });
  const obligation = obligationResult.approved.body.action.toolResult.financial_obligation as { id: string; rowVersion: number };
  const paymentResult = await createAndApprove("/financial/payments", {
    payerPartyId: borrower.id,
    payeePartyId: lender.id,
    amountMinor: 7000,
    currency: "EGP",
    paymentKind: "settlement",
    idempotencyKey: `payment-${Date.now()}`,
  });
  const payment = paymentResult.approved.body.action.toolResult.financial_payment as { id: string; rowVersion: number };

  const partial = await createAndApprove(`/financial/obligations/${obligation.id}/settlements`, {
    paymentId: payment.id,
    amountMinor: 4000,
    idempotencyKey: `settlement-partial-${Date.now()}`,
  });
  assert.equal(partial.approved.body?.status, "completed");
  const secondPaymentResult = await createAndApprove("/financial/payments", {
    payerPartyId: borrower.id,
    payeePartyId: lender.id,
    amountMinor: 3000,
    currency: "EGP",
    paymentKind: "settlement",
    idempotencyKey: `payment-second-${Date.now()}`,
  });
  const secondPayment = secondPaymentResult.approved.body.action.toolResult.financial_payment as { id: string };
  await createAndApprove(`/financial/obligations/${obligation.id}/settlements`, {
    paymentId: secondPayment.id,
    amountMinor: 3000,
    idempotencyKey: `settlement-second-${Date.now()}`,
  });

  const [storedObligation] = await db.select().from(financialObligationsTable).where(eq(financialObligationsTable.id, obligation.id));
  const settlements = await db.select().from(obligationSettlementsTable).where(eq(obligationSettlementsTable.obligationId, obligation.id));
  const settledTotal = settlements.reduce((sum, row) => sum + row.amountMinor, 0);
  assert.equal(settledTotal, 7000);
  assert.equal((storedObligation?.principalAmountMinor ?? 0) - settledTotal, 3000);
  assert.ok((storedObligation?.principalAmountMinor ?? 0) - settledTotal >= 0);
  assert.equal(storedObligation?.status, "open");

  const duplicate = await createAndApprove(`/financial/obligations/${obligation.id}/settlements`, {
    paymentId: payment.id,
    amountMinor: 1,
    idempotencyKey: `settlement-duplicate-${Date.now()}`,
  });
  assert.equal(duplicate.approved.status, 500);

  const over = await createAndApprove(`/financial/obligations/${obligation.id}/settlements`, {
    paymentId: secondPayment.id,
    amountMinor: 1,
    idempotencyKey: `settlement-over-${Date.now()}`,
  });
  assert.equal(over.approved.status, 500);

  const wrongCurrencyPayment = await createAndApprove("/financial/payments", {
    payerPartyId: borrower.id,
    payeePartyId: lender.id,
    amountMinor: 1000,
    currency: "USD",
    paymentKind: "settlement",
    idempotencyKey: `payment-usd-${Date.now()}`,
  });
  const usdPayment = wrongCurrencyPayment.approved.body.action.toolResult.financial_payment as { id: string };
  const wrongCurrencySettlement = await createAndApprove(`/financial/obligations/${obligation.id}/settlements`, {
    paymentId: usdPayment.id,
    amountMinor: 1000,
    idempotencyKey: `settlement-usd-${Date.now()}`,
  });
  assert.equal(wrongCurrencySettlement.approved.status, 500);

  const correctedPayment = await createAndApprove(`/financial/payments/${payment.id}`, {
    amountMinor: 6500,
    expectedRowVersion: payment.rowVersion,
    idempotencyKey: `payment-correction-${Date.now()}`,
  }, "PATCH");
  assert.equal(correctedPayment.approved.status, 200);
  const belowAllocation = await createAndApprove(`/financial/payments/${payment.id}`, {
    amountMinor: 3999,
    expectedRowVersion: correctedPayment.approved.body.action.toolResult.financial_payment.rowVersion,
    idempotencyKey: `payment-correction-low-${Date.now()}`,
  }, "PATCH");
  assert.equal(belowAllocation.approved.status, 500);
  const currencyCorrection = await createAndApprove(`/financial/payments/${payment.id}`, {
    currency: "USD",
    expectedRowVersion: correctedPayment.approved.body.action.toolResult.financial_payment.rowVersion,
    idempotencyKey: `payment-correction-currency-${Date.now()}`,
  }, "PATCH");
  assert.equal(currencyCorrection.approved.status, 500);

  const obligationCorrection = await createAndApprove(`/financial/obligations/${obligation.id}`, {
    principalAmountMinor: 7000,
    expectedRowVersion: storedObligation?.rowVersion,
    idempotencyKey: `obligation-correction-${Date.now()}`,
  }, "PATCH");
  assert.equal(obligationCorrection.approved.status, 200);
  const staleCorrection = await createAndApprove(`/financial/obligations/${obligation.id}`, {
    title: "تعديل قديم",
    expectedRowVersion: storedObligation?.rowVersion,
    idempotencyKey: `obligation-stale-${Date.now()}`,
  }, "PATCH");
  assert.equal(staleCorrection.approved.status, 500);

  const successfulEvents = await db.select().from(activityEventsTable).where(and(
    eq(activityEventsTable.tenantId, tenantId),
    eq(activityEventsTable.ownerUserId, userId),
  ));
  assert.ok(successfulEvents.length >= 8);
});