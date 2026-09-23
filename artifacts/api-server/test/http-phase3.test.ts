import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { and, eq } from "drizzle-orm";
import {
  activityEventEntitiesTable,
  activityEventsTable,
  conversationMemoryTable,
  commitmentPeopleTable,
  commitmentProjectsTable,
  commitmentPurposesTable,
  commitmentsTable,
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
  purposesTable,
  projectPeopleTable,
  projectsTable,
  reminderPeopleTable,
  reminderProjectsTable,
  reminderTasksTable,
  remindersTable,
  secretaryOperationsTable,
  taskPeopleTable,
  taskProjectsTable,
  taskPurposesTable,
  tasksTable,
} from "@workspace/db";
import { recordActivityEvent } from "../src/lib/entity-graph.ts";

const tenantId = `http-phase3-${process.pid}-${Date.now()}`;
const userId = "http-phase3-user";
process.env.SECRETARY_TENANT_ID = tenantId;
process.env.SECRETARY_USER_ID = userId;
process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY = "true";
process.env.AI_PROVIDER = "development";

const { default: app } = await import("../src/app.ts");

let server: ReturnType<typeof app.listen>;
let baseUrl = "";

async function startServer() {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a port.");
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function stopServer() {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function restartServer() {
  await stopServer();
  await startServer();
}

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
    conversationMemoryTable,
    secretaryOperationsTable,
    idempotencyRecordsTable,
    obligationSettlementsTable,
    commitmentPeopleTable,
    commitmentProjectsTable,
    commitmentPurposesTable,
    reminderPeopleTable,
    reminderProjectsTable,
    reminderTasksTable,
    taskPeopleTable,
    taskProjectsTable,
    taskPurposesTable,
    financialPartyPeopleTable,
    financialPartyProjectsTable,
    projectPeopleTable,
    financialPaymentsTable,
    financialObligationsTable,
    expensesTable,
    remindersTable,
    commitmentsTable,
    tasksTable,
    projectsTable,
    peopleTable,
    purposesTable,
    financialPartiesTable,
  ]) {
    await deleteOwned(table);
  }
}

before(async () => {
  await cleanup();
  await startServer();
});

after(async () => {
  await stopServer();
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

test("Secretary turn contract validates channel, bounded context, and peer metadata", async () => {
  const missingChannel = await request("/turns", "POST", {
    message: "اختبار العقد",
  });
  assert.equal(missingChannel.status, 400);

  const invalidPeer = await request("/turns", "POST", {
    message: "اختبار العقد",
    channel: "quick",
    peer: { displayName: "بدون معرف" },
  });
  assert.equal(invalidPeer.status, 400);

  const invalidContext = await request("/turns", "POST", {
    message: "اختبار العقد",
    channel: "record",
    context: { recordType: "expense", recordId: "expense-1" },
  });
  assert.equal(invalidContext.status, 400);
});

test("candidate lookup includes tenant-scoped financial parties", async () => {
  const [party] = await db.insert(financialPartiesTable).values({
    tenantId,
    ownerUserId: userId,
    partyType: "vendor",
    name: "مكتب النور",
    nameKey: "مكتب النور",
  }).returning();

  try {
    const response = await request(`/candidates?type=financial_party&q=${encodeURIComponent("النور")}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, [{
      id: party?.id,
      name: "مكتب النور",
      status: "vendor",
    }]);
  } finally {
    if (party) {
      await db.delete(financialPartiesTable).where(eq(financialPartiesTable.id, party.id));
    }
  }
});

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
    channel: "main",
    context: {
      recordType: "project",
      recordId: project.id,
      title: project.name,
    },
    peer: {
      agentId: "test-peer",
      protocol: "a2a",
      capabilities: ["read"],
    },
  });
  assert.equal(turn.status, 200);
  assert.equal(typeof turn.body?.turnId, "string");
  assert.equal(turn.body?.action?.type, "approval_required");
  assert.equal(typeof turn.body?.action?.operationId, "string");
  assert.equal(turn.body?.action?.status, "pending");
  assert.equal(turn.body?.action?.args?.amountMinor, 50000, JSON.stringify(turn.body));
  assert.equal(turn.body?.action?.display?.title, "تسجيل مصروف");
  assert.ok(Array.isArray(turn.body?.action?.display?.details));
  assert.ok(turn.body?.action?.display?.details?.some((detail: unknown) => String(detail).includes("القيمة")));

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
  assert.deepEqual(turn.body?.action?.args, refreshed.body?.args);
  assert.deepEqual(turn.body?.action?.display, refreshed.body?.display);

  const retry = await request("/turns", "POST", {
    message: "دفعت لمحمد 500 جنيه في مشروع المحجر",
    conversationId: turn.body.conversationId,
    idempotencyKey: turnIdempotencyKey,
    channel: "main",
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
  assert.equal(typeof rejectResponse.body?.turnId, "string");
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
  await restartServer();
  const approved = await approve(approvedId, {
    toolName: "different_tool",
    arguments: { amountMinor: 1 },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body?.status, "completed");
  assert.equal(typeof approved.body?.turnId, "string");

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
  assert.equal(events.filter((event) => event.sourceId === saved[0]?.id).length, 1);

  await restartServer();
  const duplicateApprove = await approve(approvedId);
  assert.equal(duplicateApprove.status, 200);
  assert.equal(duplicateApprove.body?.status, "completed");
  const afterDuplicate = await db.select().from(expensesTable).where(and(
    eq(expensesTable.tenantId, tenantId),
    eq(expensesTable.ownerUserId, userId),
    eq(expensesTable.description, "مصروف موافق عليه"),
  ));
  assert.equal(afterDuplicate.length, 1);
  const eventsAfterDuplicate = await db.select().from(activityEventsTable).where(and(
    eq(activityEventsTable.tenantId, tenantId),
    eq(activityEventsTable.ownerUserId, userId),
  ));
  assert.equal(eventsAfterDuplicate.filter((event) => event.sourceId === saved[0]?.id).length, 1);

  const concurrentPending = await request("/records", "POST", {
    recordType: "expense",
    amountMinor: 27000,
    currency: "EGP",
    description: "مصروف موافقة متزامنة",
    idempotencyKey: `concurrent-approval-${Date.now()}`,
  });
  assert.equal(concurrentPending.status, 202);
  const concurrentOperationId = concurrentPending.body?.approval?.operationId as string;
  const concurrentArgs = (amountMinor: number) => ({
    args: {
      amountMinor,
      currency: "EGP",
      description: "مصروف موافقة متزامنة معدل",
      personId: null,
      projectId: null,
    },
  });
  const [concurrentFirst, concurrentSecond] = await Promise.all([
    approve(concurrentOperationId, concurrentArgs(28000)),
    approve(concurrentOperationId, concurrentArgs(29000)),
  ]);
  assert.equal(concurrentFirst.status, 200);
  assert.equal(concurrentSecond.status, 200);
  const concurrentOperation = await db.select().from(secretaryOperationsTable).where(and(
    eq(secretaryOperationsTable.tenantId, tenantId),
    eq(secretaryOperationsTable.ownerUserId, userId),
    eq(secretaryOperationsTable.id, concurrentOperationId),
  ));
  assert.equal(concurrentOperation[0]?.status, "completed");
  const concurrentExpenses = await db.select().from(expensesTable).where(and(
    eq(expensesTable.tenantId, tenantId),
    eq(expensesTable.ownerUserId, userId),
    eq(expensesTable.description, "مصروف موافقة متزامنة معدل"),
  ));
  assert.equal(concurrentExpenses.length, 1);
  assert.ok([28000, 29000].includes(concurrentExpenses[0]?.amountMinor ?? -1));
  const concurrentEvents = await db.select().from(activityEventsTable).where(and(
    eq(activityEventsTable.tenantId, tenantId),
    eq(activityEventsTable.ownerUserId, userId),
  ));
  assert.equal(concurrentEvents.filter((event) => event.sourceId === concurrentExpenses[0]?.id).length, 1);

  const updatePending = await request(`/records/expense/${saved[0]?.id}`, "PATCH", {
    expectedRowVersion: saved[0]?.rowVersion,
    amountMinor: 26000,
    currency: "EGP",
    description: "مصروف موافق عليه بعد تعديل",
    occurredAt: new Date().toISOString(),
  });
  assert.equal(updatePending.status, 202);
  const updateOperationId = updatePending.body?.approval?.operationId as string;
  const updateApproved = await approve(updateOperationId);
  assert.equal(updateApproved.status, 200);
  assert.equal(updateApproved.body?.status, "completed");
  const updatedSaved = await db.select().from(expensesTable).where(and(
    eq(expensesTable.tenantId, tenantId),
    eq(expensesTable.ownerUserId, userId),
    eq(expensesTable.id, saved[0]?.id),
  ));
  assert.equal(updatedSaved[0]?.description, "مصروف موافق عليه بعد تعديل");

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

test("edited expense approval executes one scoped write and stores executable IDs in conversation memory", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const [originalPerson] = await db.insert(peopleTable).values({
    tenantId,
    ownerUserId: userId,
    name: `شخص قديم ${suffix}`,
    nameKey: `شخص قديم ${suffix}`,
  }).returning();
  const [editedPerson] = await db.insert(peopleTable).values({
    tenantId,
    ownerUserId: userId,
    name: `شخص معدل ${suffix}`,
    nameKey: `شخص معدل ${suffix}`,
  }).returning();
  const [originalProject] = await db.insert(projectsTable).values({
    tenantId,
    ownerUserId: userId,
    name: `مشروع قديم ${suffix}`,
    nameKey: `مشروع قديم ${suffix}`,
  }).returning();
  const [editedProject] = await db.insert(projectsTable).values({
    tenantId,
    ownerUserId: userId,
    name: `مشروع معدل ${suffix}`,
    nameKey: `مشروع معدل ${suffix}`,
  }).returning();
  assert.ok(originalPerson && editedPerson && originalProject && editedProject);

  const conversationId = `edited-approval-${suffix}`;
  const pending = await request("/turns", "POST", {
    message: `دفعت ل${originalPerson.name} 100 جنيه في مشروع ${originalProject.name}`,
    conversationId,
    channel: "main",
  });
  assert.equal(pending.status, 200, JSON.stringify(pending.body));
  assert.equal(pending.body?.action?.type, "approval_required");
  const operationId = pending.body?.action?.operationId as string;
  assert.equal(typeof operationId, "string");

  const editedArgs = {
    amountMinor: 22500,
    currency: "EGP",
    description: `مصروف معدل ${suffix}`,
    personId: editedPerson.id,
    projectId: editedProject.id,
    personName: editedPerson.name,
    projectName: editedProject.name,
    personCandidates: [{ id: editedPerson.id, name: editedPerson.name }],
    projectCandidates: [{ id: editedProject.id, name: editedProject.name }],
  };
  const approved = await approve(operationId, { args: editedArgs });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body?.status, "completed");
  assert.equal(approved.body?.action?.args?.amountMinor, editedArgs.amountMinor);
  assert.equal(approved.body?.action?.args?.personId, editedPerson.id);
  assert.equal(approved.body?.action?.args?.projectId, editedProject.id);
  assert.equal(approved.body?.action?.args?.personName, undefined);
  assert.equal(approved.body?.action?.args?.projectName, undefined);

  const saved = await db.select().from(expensesTable).where(and(
    eq(expensesTable.tenantId, tenantId),
    eq(expensesTable.ownerUserId, userId),
    eq(expensesTable.description, editedArgs.description),
  ));
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.amountMinor, editedArgs.amountMinor);
  assert.equal(saved[0]?.personId, editedPerson.id);
  assert.equal(saved[0]?.projectId, editedProject.id);

  const storedOperation = await db.select().from(secretaryOperationsTable).where(and(
    eq(secretaryOperationsTable.tenantId, tenantId),
    eq(secretaryOperationsTable.ownerUserId, userId),
    eq(secretaryOperationsTable.id, operationId),
  ));
  assert.equal(storedOperation.length, 1);
  const storedArgs = JSON.parse(storedOperation[0]!.argumentsJson) as Record<string, unknown>;
  assert.equal(storedArgs.personId, editedPerson.id);
  assert.equal(storedArgs.projectId, editedProject.id);
  assert.equal(storedArgs.personName, undefined);
  assert.equal(storedArgs.projectName, undefined);
  assert.equal(storedArgs.personCandidates, undefined);
  assert.equal(storedArgs.projectCandidates, undefined);

  const memoryRows = await db.select().from(conversationMemoryTable).where(and(
    eq(conversationMemoryTable.tenantId, tenantId),
    eq(conversationMemoryTable.ownerUserId, userId),
    eq(conversationMemoryTable.conversationId, conversationId),
  ));
  assert.equal(memoryRows.length, 1);
  const recentTurns = JSON.parse(memoryRows[0]!.recentStateJson) as Array<{
    turnId?: string;
    action?: Record<string, any>;
  }>;
  const approvalTurn = recentTurns.find((turn) => turn.turnId === `approval:${operationId}`);
  assert.ok(approvalTurn);
  assert.equal(approvalTurn.action?.personId, editedPerson.id);
  assert.equal(approvalTurn.action?.projectId, editedProject.id);
  assert.equal(approvalTurn.action?.args?.personId, editedPerson.id);
  assert.equal(approvalTurn.action?.args?.projectId, editedProject.id);
  assert.equal(approvalTurn.action?.args?.amountMinor, editedArgs.amountMinor);
  assert.equal(approvalTurn.action?.args?.personName, undefined);
  assert.equal(approvalTurn.action?.args?.projectName, undefined);

  const duplicate = await approve(operationId, {
    args: {
      ...editedArgs,
      amountMinor: 99900,
      personId: originalPerson.id,
      projectId: originalProject.id,
      personName: originalPerson.name,
      projectName: originalProject.name,
    },
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body?.status, "completed");
  assert.deepEqual(duplicate.body?.action?.args, approved.body?.action?.args);

  const afterDuplicate = await db.select().from(expensesTable).where(and(
    eq(expensesTable.tenantId, tenantId),
    eq(expensesTable.ownerUserId, userId),
    eq(expensesTable.description, editedArgs.description),
  ));
  assert.equal(afterDuplicate.length, 1);
});

test("HTTP record edits reject a stale approval instead of overwriting a newer edit", async () => {
  const [expense] = await db.insert(expensesTable).values({
    tenantId,
    ownerUserId: userId,
    amountMinor: 10000,
    currency: "EGP",
    description: "مصروف نافذتين",
    occurredAt: new Date(),
  }).returning();

  const firstPending = await request(`/records/expense/${expense.id}`, "PATCH", {
    amountMinor: 11000,
    currency: "EGP",
    description: "تعديل النافذة الأولى",
    occurredAt: new Date().toISOString(),
    expectedRowVersion: expense.rowVersion,
  });
  const secondPending = await request(`/records/expense/${expense.id}`, "PATCH", {
    amountMinor: 12000,
    currency: "EGP",
    description: "تعديل النافذة الثانية",
    occurredAt: new Date().toISOString(),
    expectedRowVersion: expense.rowVersion,
  });
  assert.equal(firstPending.status, 202);
  assert.equal(secondPending.status, 202);

  const firstApprovalId = firstPending.body?.approval?.operationId as string;
  const secondApprovalId = secondPending.body?.approval?.operationId as string;
  const firstApproved = await approve(firstApprovalId);
  assert.equal(firstApproved.status, 200);
  assert.equal(firstApproved.body?.status, "completed");

  const staleApproved = await approve(secondApprovalId);
  assert.equal(staleApproved.status, 500);
  assert.equal(staleApproved.body?.code, "APPROVED_OPERATION_FAILED");

  const [stored] = await db.select().from(expensesTable).where(and(
    eq(expensesTable.tenantId, tenantId),
    eq(expensesTable.ownerUserId, userId),
    eq(expensesTable.id, expense.id),
  ));
  assert.equal(stored?.amountMinor, 11000);
  assert.equal(stored?.description, "تعديل النافذة الأولى");
  assert.equal(stored?.rowVersion, expense.rowVersion + 1);
});

test("HTTP concurrent person deletion and financial linking preserve referential integrity", async () => {
  const [person] = await db.insert(peopleTable).values({
    tenantId,
    ownerUserId: userId,
    name: "شخص حذف وربط",
    nameKey: "شخص حذف وربط",
  }).returning();
  const [project] = await db.insert(projectsTable).values({
    tenantId,
    ownerUserId: userId,
    name: "مشروع يبقى مع الشخص",
    nameKey: "مشروع يبقى مع الشخص",
  }).returning();
  await db.insert(projectPeopleTable).values({
    tenantId,
    ownerUserId: userId,
    projectId: project.id,
    personId: person.id,
    relationship: "existing",
  });

  const linkPending = await request("/financial/parties", "POST", {
    partyType: "person",
    name: "طرف ربط متزامن",
    personId: person.id,
    idempotencyKey: `concurrent-financial-link-${Date.now()}`,
  });
  const deletePending = await request(`/records/person/${person.id}`, "DELETE");
  assert.equal(linkPending.status, 202);
  assert.equal(deletePending.status, 202);

  const linkOperationId = linkPending.body?.approval?.operationId as string;
  const deleteOperationId = deletePending.body?.approval?.operationId as string;
  const [linkResult, deleteResult] = await Promise.all([
    approve(linkOperationId),
    approve(deleteOperationId),
  ]);
  assert.deepEqual(
    [linkResult.status, deleteResult.status].sort((a, b) => a - b),
    [200, 500],
  );

  const [remainingPerson] = await db.select().from(peopleTable).where(and(
    eq(peopleTable.tenantId, tenantId),
    eq(peopleTable.ownerUserId, userId),
    eq(peopleTable.id, person.id),
  ));
  const partyLinks = await db.select().from(financialPartyPeopleTable).where(and(
    eq(financialPartyPeopleTable.tenantId, tenantId),
    eq(financialPartyPeopleTable.ownerUserId, userId),
    eq(financialPartyPeopleTable.personId, person.id),
  ));
  const projectLinks = await db.select().from(projectPeopleTable).where(and(
    eq(projectPeopleTable.tenantId, tenantId),
    eq(projectPeopleTable.ownerUserId, userId),
    eq(projectPeopleTable.projectId, project.id),
    eq(projectPeopleTable.personId, person.id),
  ));

  if (remainingPerson) {
    assert.equal(partyLinks.length, 1);
    assert.equal(projectLinks.length, 1);
  } else {
    assert.equal(partyLinks.length, 0);
    assert.equal(projectLinks.length, 0);
  }
});

test("HTTP typed relationships require approval once and reject cross-tenant access", async () => {
  const [person] = await db.insert(peopleTable).values({
    tenantId,
    ownerUserId: userId,
    name: "شخص علاقة HTTP",
    nameKey: "شخص علاقة HTTP",
  }).returning();
  const [project] = await db.insert(projectsTable).values({
    tenantId,
    ownerUserId: userId,
    name: "مشروع علاقة HTTP",
    nameKey: "مشروع علاقة HTTP",
  }).returning();
  const foreignTenantId = `${tenantId}-relationship-other`;
  const [foreignPerson] = await db.insert(peopleTable).values({
    tenantId: foreignTenantId,
    ownerUserId: userId,
    name: "شخص علاقة مستأجر آخر",
    nameKey: "شخص علاقة مستأجر آخر",
  }).returning();
  const [foreignProject] = await db.insert(projectsTable).values({
    tenantId: foreignTenantId,
    ownerUserId: userId,
    name: "مشروع علاقة مستأجر آخر",
    nameKey: "مشروع علاقة مستأجر آخر",
  }).returning();
  const [foreignRelationship] = await db.insert(projectPeopleTable).values({
    tenantId: foreignTenantId,
    ownerUserId: userId,
    projectId: foreignProject.id,
    personId: foreignPerson.id,
    relationship: "foreign",
  }).returning();

  const idempotencyKey = `http-relationship-${Date.now()}`;
  const relationshipInput = {
    leftId: project.id,
    rightId: person.id,
    relationship: "owner",
    idempotencyKey,
  };
  const pending = await request("/relationships?relation=project_people", "POST", relationshipInput);
  assert.equal(pending.status, 202, JSON.stringify(pending.body));
  assert.equal(pending.body?.pendingApproval, true);
  assert.equal(pending.body?.approval?.toolName, "create_typed_relationship");
  const operationId = pending.body?.approval?.operationId as string;
  assert.equal(typeof operationId, "string");

  const retryBeforeApproval = await request(
    "/relationships?relation=project_people",
    "POST",
    relationshipInput,
  );
  assert.equal(retryBeforeApproval.status, 202);
  assert.equal(retryBeforeApproval.body?.approval?.operationId, operationId);

  const beforeApproval = await request(
    `/relationships?relation=project_people&side=left&entityId=${project.id}`,
  );
  assert.equal(beforeApproval.status, 200);
  assert.deepEqual(beforeApproval.body, {
    relation: "project_people",
    side: "left",
    entityId: project.id,
    relationships: [],
  });

  const approved = await approve(operationId);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body?.status, "completed");
  assert.equal(approved.body?.action?.type, "operation_completed");
  assert.equal(approved.body?.action?.toolResult?.relationship?.projectId, project.id);
  assert.equal(approved.body?.action?.toolResult?.relationship?.personId, person.id);

  const listed = await request(
    `/relationships?relation=project_people&side=left&entityId=${project.id}`,
  );
  assert.equal(listed.status, 200);
  assert.equal(listed.body?.relation, "project_people");
  assert.equal(listed.body?.side, "left");
  assert.equal(listed.body?.entityId, project.id);
  assert.equal(listed.body?.relationships.length, 1);
  assert.equal(listed.body?.relationships[0]?.relationship, "owner");
  const relationshipId = listed.body?.relationships[0]?.id as string;
  assert.equal(typeof relationshipId, "string");

  const duplicateApproval = await approve(operationId);
  assert.equal(duplicateApproval.status, 200);
  assert.equal(duplicateApproval.body?.status, "completed");
  const afterDuplicateApproval = await request(
    `/relationships?relation=project_people&side=left&entityId=${project.id}`,
  );
  assert.equal(afterDuplicateApproval.body?.relationships.length, 1);
  assert.equal(afterDuplicateApproval.body?.relationships[0]?.id, relationshipId);

  const retryAfterApproval = await request(
    "/relationships?relation=project_people",
    "POST",
    relationshipInput,
  );
  assert.equal(retryAfterApproval.status, 202);
  assert.equal(retryAfterApproval.body?.approval?.operationId, operationId);
  assert.equal(
    (await request(`/relationships?relation=project_people&entityId=${project.id}`)).body?.relationships.length,
    1,
  );

  const deletePending = await request(`/relationships/project_people/${relationshipId}`, "DELETE");
  assert.equal(deletePending.status, 202);
  assert.equal(deletePending.body?.pendingApproval, true);
  assert.equal(deletePending.body?.approval?.toolName, "delete_typed_relationship");
  const deleteOperationId = deletePending.body?.approval?.operationId as string;
  const deleteApproved = await approve(deleteOperationId);
  assert.equal(deleteApproved.status, 200, JSON.stringify(deleteApproved.body));
  assert.equal(deleteApproved.body?.status, "completed");
  assert.equal(deleteApproved.body?.action?.toolResult?.relationship?.id, relationshipId);

  const afterDelete = await request(
    `/relationships?relation=project_people&side=left&entityId=${project.id}`,
  );
  assert.equal(afterDelete.status, 200);
  assert.deepEqual(afterDelete.body?.relationships, []);
  const duplicateDeleteApproval = await approve(deleteOperationId);
  assert.equal(duplicateDeleteApproval.status, 200);
  assert.equal(duplicateDeleteApproval.body?.status, "completed");

  const foreignRead = await request(
    `/relationships?relation=project_people&side=left&entityId=${foreignProject.id}`,
  );
  assert.equal(foreignRead.status, 404);
  assert.equal(foreignRead.body?.code, "RELATIONSHIP_NOT_FOUND");

  const foreignDeletePending = await request(
    `/relationships/project_people/${foreignRelationship.id}`,
    "DELETE",
  );
  assert.equal(foreignDeletePending.status, 202);
  const foreignDeleteApproval = await approve(foreignDeletePending.body?.approval?.operationId as string);
  assert.equal(foreignDeleteApproval.status, 500);
  assert.equal(foreignDeleteApproval.body?.code, "APPROVED_OPERATION_FAILED");
  const foreignRows = await db.select().from(projectPeopleTable).where(and(
    eq(projectPeopleTable.tenantId, foreignTenantId),
    eq(projectPeopleTable.ownerUserId, userId),
    eq(projectPeopleTable.id, foreignRelationship.id),
  ));
  assert.equal(foreignRows.length, 1);
});

test("HTTP relationship approvals cover task, reminder, and commitment families", async () => {
  const [person] = await db.insert(peopleTable).values({
    tenantId,
    ownerUserId: userId,
    name: "شخص علاقات موسعة",
    nameKey: "شخص علاقات موسعة",
  }).returning();
  const [project] = await db.insert(projectsTable).values({
    tenantId,
    ownerUserId: userId,
    name: "مشروع علاقات موسعة",
    nameKey: "مشروع علاقات موسعة",
  }).returning();
  const [task] = await db.insert(tasksTable).values({
    tenantId,
    ownerUserId: userId,
    title: "مهمة علاقات موسعة",
  }).returning();
  const [purpose] = await db.insert(purposesTable).values({
    tenantId,
    ownerUserId: userId,
    name: "غرض علاقات موسعة",
    nameKey: "غرض علاقات موسعة",
  }).returning();
  const [reminder] = await db.insert(remindersTable).values({
    tenantId,
    ownerUserId: userId,
    text: "تذكير علاقات موسعة",
    dueAt: new Date("2030-01-01T12:00:00.000Z"),
  }).returning();
  const [commitment] = await db.insert(commitmentsTable).values({
    tenantId,
    ownerUserId: userId,
    title: "التزام علاقات موسعة",
  }).returning();

  const cases = [
    { relation: "task_people", leftId: task.id, rightId: person.id, rightKey: "personId" },
    { relation: "task_projects", leftId: task.id, rightId: project.id, rightKey: "projectId" },
    { relation: "task_purposes", leftId: task.id, rightId: purpose.id, rightKey: "purposeId" },
    { relation: "reminder_people", leftId: reminder.id, rightId: person.id, rightKey: "personId" },
    { relation: "reminder_projects", leftId: reminder.id, rightId: project.id, rightKey: "projectId" },
    { relation: "reminder_tasks", leftId: reminder.id, rightId: task.id, rightKey: "taskId" },
    { relation: "commitment_people", leftId: commitment.id, rightId: person.id, rightKey: "personId" },
    { relation: "commitment_projects", leftId: commitment.id, rightId: project.id, rightKey: "projectId" },
    { relation: "commitment_purposes", leftId: commitment.id, rightId: purpose.id, rightKey: "purposeId" },
  ] as const;

  for (const [index, relationshipCase] of cases.entries()) {
    const input = {
      leftId: relationshipCase.leftId,
      rightId: relationshipCase.rightId,
      relationship: `regression-${index}`,
      idempotencyKey: `http-relationship-family-${index}-${Date.now()}`,
    };
    const created = await createAndApprove(
      `/relationships?relation=${relationshipCase.relation}`,
      input,
    );
    assert.equal(created.approved.status, 200, JSON.stringify(created.approved.body));
    assert.equal(created.approved.body?.status, "completed");

    const listed = await request(
      `/relationships?relation=${relationshipCase.relation}&side=left&entityId=${relationshipCase.leftId}`,
    );
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.equal(listed.body?.relationships.length, 1);
    const relationship = listed.body?.relationships[0];
    const relationshipId = relationship?.id as string;
    assert.equal(relationship?.[relationshipCase.rightKey], relationshipCase.rightId);

    const deleted = await request(
      `/relationships/${relationshipCase.relation}/${relationshipId}`,
      "DELETE",
    );
    assert.equal(deleted.status, 202, JSON.stringify(deleted.body));
    const deleteApproved = await approve(deleted.body?.approval?.operationId as string);
    assert.equal(deleteApproved.status, 200, JSON.stringify(deleteApproved.body));
    assert.equal(deleteApproved.body?.status, "completed");

    const afterDelete = await request(
      `/relationships?relation=${relationshipCase.relation}&side=left&entityId=${relationshipCase.leftId}`,
    );
    assert.equal(afterDelete.status, 200);
    assert.deepEqual(afterDelete.body?.relationships, []);
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
  assert.ok(Array.isArray(personResponse.body?.related?.projects));
  assert.ok(Array.isArray(personResponse.body?.related?.expenses));
  assert.ok(Array.isArray(personResponse.body?.timeline));
  assert.equal(personResponse.body?.related?.projects.length, 100);
  assert.equal(personResponse.body?.related?.financialParties[0]?.id, party.id);

  const projectResponse = await request(`/entities/project/${projects[0].id}`);
  assert.equal(projectResponse.status, 200);
  assert.equal(projectResponse.body?.entity?.id, projects[0].id);
  assert.ok(Array.isArray(projectResponse.body?.related?.people));
  assert.ok(Array.isArray(projectResponse.body?.timeline));
  assert.equal(projectResponse.body?.related?.tasks[0]?.id, task.id);

  const partyResponse = await request(`/entities/financial_party/${party.id}`);
  assert.equal(partyResponse.status, 200);
  assert.equal(partyResponse.body?.entity?.id, party.id);
  assert.ok(Array.isArray(partyResponse.body?.related?.people));
  assert.ok(Array.isArray(partyResponse.body?.relationships?.projects));
  assert.ok(Array.isArray(partyResponse.body?.timeline));
  assert.equal(partyResponse.body?.related?.people[0]?.id, person.id);
  assert.equal(partyResponse.body?.related?.projects[0]?.id, projects[0].id);

  const page = await request(`/entities/person/${person.id}/timeline?limit=1&offset=1`);
  assert.equal(page.status, 200);
  assert.equal(page.body?.entityType, "person");
  assert.equal(page.body?.entityId, person.id);
  assert.ok(Array.isArray(page.body?.events));
  assert.equal(page.body?.events.length, 1);
  const hardMax = await request(`/entities/person/${person.id}/timeline?limit=1000&offset=0`);
  assert.equal(hardMax.status, 200);
  assert.equal(hardMax.body?.entityType, "person");
  assert.equal(hardMax.body?.entityId, person.id);
  assert.ok(Array.isArray(hardMax.body?.events));
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