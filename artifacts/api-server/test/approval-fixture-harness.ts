import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

/**
 * Persistent, isolated fixture server for browser approval verification.
 *
 * Start from artifacts/api-server with:
 *   ../../scripts/node_modules/.bin/tsx test/approval-fixture-harness.ts
 *
 * The process deliberately stays alive until SIGTERM. It only removes rows
 * belonging to its generated tenant during that shutdown path.
 */

process.env.AI_PROVIDER = "development";
const tenantId = `approval-fixture-${process.pid}-${Date.now()}`;
const userId = `approval-fixture-user-${process.pid}`;
process.env.SECRETARY_TENANT_ID = tenantId;
process.env.SECRETARY_USER_ID = userId;

const requestedPort = Number.parseInt(process.env.FIXTURE_PORT ?? "0", 10);
const port = Number.isInteger(requestedPort) && requestedPort >= 0 ? requestedPort : 0;

const ids = {
  person: randomUUID(),
  project: randomUUID(),
  expense: randomUUID(),
  task: randomUUID(),
  reminder: randomUUID(),
  lenderParty: randomUUID(),
  borrowerParty: randomUUID(),
  obligation: randomUUID(),
  payment: randomUUID(),
  donation: randomUUID(),
  receivable: randomUUID(),
  conversation: `approval-fixture-conversation-${process.pid}`,
};

const [{ default: app }, dbModule] = await Promise.all([
  import("../src/app.ts"),
  import("@workspace/db"),
]);

const {
  activityEventEntitiesTable,
  activityEventsTable,
  db,
  donationsTable,
  expensesTable,
  financialObligationsTable,
  financialPartyPeopleTable,
  financialPartyProjectsTable,
  financialPartiesTable,
  financialPaymentsTable,
  incomeReceivablesTable,
  obligationSettlementsTable,
  peopleTable,
  projectPeopleTable,
  projectsTable,
  reminderPeopleTable,
  reminderProjectsTable,
  reminderTasksTable,
  remindersTable,
  taskPeopleTable,
  taskProjectsTable,
  tasksTable,
  conversationMemoryTable,
  secretaryOperationsTable,
  idempotencyRecordsTable,
  paymentLinksTable,
  purposesTable,
  commitmentPeopleTable,
  commitmentProjectsTable,
  commitmentPurposesTable,
  commitmentsTable,
  taskPurposesTable,
} = dbModule;

async function seedFixtures(): Promise<void> {
  await db.insert(peopleTable).values({
    id: ids.person,
    tenantId,
    ownerUserId: userId,
    name: "محمد اختبار",
    nameKey: "محمد اختبار",
    notes: "شخص مرتبط ببيانات التحقق.",
  });
  await db.insert(projectsTable).values({
    id: ids.project,
    tenantId,
    ownerUserId: userId,
    name: "السكرتير",
    nameKey: "السكرتير",
    status: "active",
  });
  await db.insert(projectPeopleTable).values({
    tenantId,
    ownerUserId: userId,
    projectId: ids.project,
    personId: ids.person,
    relationship: "owner",
  });
  await db.insert(expensesTable).values({
    id: ids.expense,
    tenantId,
    ownerUserId: userId,
    amountMinor: 12500,
    currency: "EGP",
    description: "مصروف الاختبار",
    personId: ids.person,
    projectId: ids.project,
    occurredAt: new Date("2026-09-14T09:00:00.000Z"),
  });
  await db.insert(tasksTable).values({
    id: ids.task,
    tenantId,
    ownerUserId: userId,
    title: "مهمة الاختبار",
    dueAt: new Date("2099-09-15T10:00:00.000Z"),
    status: "pending",
  });
  await db.insert(taskPeopleTable).values({
    tenantId,
    ownerUserId: userId,
    taskId: ids.task,
    personId: ids.person,
    relationship: "assignee",
  });
  await db.insert(taskProjectsTable).values({
    tenantId,
    ownerUserId: userId,
    taskId: ids.task,
    projectId: ids.project,
    relationship: "tracked",
  });
  await db.insert(remindersTable).values({
    id: ids.reminder,
    tenantId,
    ownerUserId: userId,
    text: "تذكير الاختبار",
    dueAt: new Date("2099-09-16T10:00:00.000Z"),
    timezone: "Africa/Cairo",
    status: "scheduled",
  });
  await db.insert(reminderPeopleTable).values({
    tenantId,
    ownerUserId: userId,
    reminderId: ids.reminder,
    personId: ids.person,
    relationship: "about",
  });
  await db.insert(reminderProjectsTable).values({
    tenantId,
    ownerUserId: userId,
    reminderId: ids.reminder,
    projectId: ids.project,
    relationship: "about",
  });
  await db.insert(reminderTasksTable).values({
    tenantId,
    ownerUserId: userId,
    reminderId: ids.reminder,
    taskId: ids.task,
    relationship: "follows",
  });

  await db.insert(financialPartiesTable).values([
    {
      id: ids.lenderParty,
      tenantId,
      ownerUserId: userId,
      partyType: "person",
      name: "طرف مالي مُقرض",
      nameKey: "طرف مالي مقرض",
    },
    {
      id: ids.borrowerParty,
      tenantId,
      ownerUserId: userId,
      partyType: "external",
      name: "طرف مالي مُقترض",
      nameKey: "طرف مالي مقترض",
    },
  ]);
  await db.insert(financialPartyPeopleTable).values({
    tenantId,
    ownerUserId: userId,
    partyId: ids.lenderParty,
    personId: ids.person,
    relationship: "person",
  });
  await db.insert(financialPartyProjectsTable).values({
    tenantId,
    ownerUserId: userId,
    partyId: ids.lenderParty,
    projectId: ids.project,
    relationship: "funds",
  });
  await db.insert(financialObligationsTable).values({
    id: ids.obligation,
    tenantId,
    ownerUserId: userId,
    kind: "debt",
    title: "التزام الاختبار",
    lenderPartyId: ids.lenderParty,
    borrowerPartyId: ids.borrowerParty,
    principalAmountMinor: 100000,
    currency: "EGP",
    projectId: ids.project,
    dueAt: new Date("2099-09-20T10:00:00.000Z"),
    status: "open",
  });
  await db.insert(financialPaymentsTable).values({
    id: ids.payment,
    tenantId,
    ownerUserId: userId,
    paymentKind: "settlement",
    payerPartyId: ids.borrowerParty,
    payeePartyId: ids.lenderParty,
    amountMinor: 25000,
    currency: "EGP",
    description: "دفعة الاختبار",
    occurredAt: new Date("2026-09-14T11:00:00.000Z"),
  });
  await db.insert(donationsTable).values({
    id: ids.donation,
    tenantId,
    ownerUserId: userId,
    donorPartyId: ids.lenderParty,
    recipientPartyId: ids.borrowerParty,
    amountMinor: 15000,
    currency: "EGP",
    projectId: ids.project,
    description: "تبرع الاختبار",
    status: "paid",
    pledgedAt: new Date("2026-09-14T12:00:00.000Z"),
    paidAt: new Date("2026-09-14T12:00:00.000Z"),
  });
  await db.insert(incomeReceivablesTable).values({
    id: ids.receivable,
    tenantId,
    ownerUserId: userId,
    kind: "receivable",
    title: "مستحق الاختبار",
    creditorPartyId: ids.lenderParty,
    debtorPartyId: ids.borrowerParty,
    amountMinor: 30000,
    currency: "EGP",
    projectId: ids.project,
    dueAt: new Date("2099-09-22T10:00:00.000Z"),
    status: "open",
  });

  const events = [
    { id: randomUUID(), eventType: "fixture.expense", sourceType: "expense", sourceId: ids.expense, summary: "تم تسجيل مصروف الاختبار.", entityType: "expense", entityId: ids.expense },
    { id: randomUUID(), eventType: "fixture.task", sourceType: "task", sourceId: ids.task, summary: "تمت إضافة مهمة الاختبار.", entityType: "task", entityId: ids.task },
    { id: randomUUID(), eventType: "fixture.reminder", sourceType: "reminder", sourceId: ids.reminder, summary: "تمت جدولة تذكير الاختبار.", entityType: "reminder", entityId: ids.reminder },
    { id: randomUUID(), eventType: "fixture.payment", sourceType: "financial_payment", sourceId: ids.payment, summary: "تم تسجيل دفعة الاختبار.", entityType: "financial_payment", entityId: ids.payment },
    { id: randomUUID(), eventType: "fixture.obligation", sourceType: "financial_obligation", sourceId: ids.obligation, summary: "تم إنشاء التزام الاختبار.", entityType: "financial_obligation", entityId: ids.obligation },
    { id: randomUUID(), eventType: "fixture.donation", sourceType: "donation", sourceId: ids.donation, summary: "تم تسجيل تبرع الاختبار.", entityType: "donation", entityId: ids.donation },
    { id: randomUUID(), eventType: "fixture.receivable", sourceType: "income_receivable", sourceId: ids.receivable, summary: "تم تسجيل مستحق الاختبار.", entityType: "income_receivable", entityId: ids.receivable },
  ];
  await db.insert(activityEventsTable).values(events.map((event) => ({
    id: event.id,
    tenantId,
    ownerUserId: userId,
    eventType: event.eventType,
    sourceType: event.sourceType,
    sourceId: event.sourceId,
    actorType: "fixture",
    actorId: userId,
    summary: event.summary,
  })));
  await db.insert(activityEventEntitiesTable).values(events.map((event) => ({
    tenantId,
    ownerUserId: userId,
    eventId: event.id,
    entityType: event.entityType,
    entityId: event.entityId,
    role: "source",
  })));

  await db.insert(conversationMemoryTable).values({
    tenantId,
    ownerUserId: userId,
    conversationId: ids.conversation,
    recentStateJson: JSON.stringify([]),
    summary: "محادثة التحقق",
    turnCount: 0,
  });
}

async function cleanupFixtures(): Promise<void> {
  const ownedTables = [
    activityEventEntitiesTable,
    activityEventsTable,
    secretaryOperationsTable,
    idempotencyRecordsTable,
    conversationMemoryTable,
    obligationSettlementsTable,
    paymentLinksTable,
    reminderPeopleTable,
    reminderProjectsTable,
    reminderTasksTable,
    taskPeopleTable,
    taskProjectsTable,
    taskPurposesTable,
    commitmentPeopleTable,
    commitmentProjectsTable,
    commitmentPurposesTable,
    projectPeopleTable,
    financialPartyPeopleTable,
    financialPartyProjectsTable,
    donationsTable,
    incomeReceivablesTable,
    financialPaymentsTable,
    financialObligationsTable,
    expensesTable,
    commitmentsTable,
    tasksTable,
    remindersTable,
    projectsTable,
    peopleTable,
    financialPartiesTable,
    purposesTable,
  ];
  for (const table of ownedTables) {
    await db.delete(table).where(eq(table.tenantId, tenantId));
  }
}

await seedFixtures();

const server = await new Promise<any>((resolve, reject) => {
  const nextServer = app.listen(port, "127.0.0.1", () => resolve(nextServer));
  nextServer.once("error", reject);
});
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Fixture server did not expose a TCP port.");
}

console.log(JSON.stringify({
  type: "approval-fixture-ready",
  apiBaseUrl: `http://127.0.0.1:${address.port}/api`,
  port: address.port,
  tenantId,
  userId,
  ids,
  firstApprovalMessage: "دفعت لمحمد اختبار 500 جنيه في مشروع السكرتير",
  firstApprovalRequest: {
    method: "POST",
    path: "/turns",
    body: {
      message: "دفعت لمحمد اختبار 500 جنيه في مشروع السكرتير",
      conversationId: ids.conversation,
      idempotencyKey: `approval-fixture-first-${process.pid}`,
    },
  },
  authHeader: "Bearer dev-user",
}));

let shuttingDown = false;
process.once("SIGTERM", () => {
  if (shuttingDown) return;
  shuttingDown = true;
  void (async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanupFixtures();
    await dbModule.pool.end();
    process.exit(0);
  })().catch((error) => {
    console.error("approval fixture cleanup failed", error);
    process.exit(1);
  });
});