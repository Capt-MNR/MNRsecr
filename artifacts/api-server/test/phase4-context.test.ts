import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  activityEventEntitiesTable,
  activityEventsTable,
  conversationMemoryTable,
  db,
  donationsTable,
  expensesTable,
  financialObligationsTable,
  financialPartiesTable,
  financialPartyPeopleTable,
  financialPartyProjectsTable,
  financialPaymentsTable,
  incomeReceivablesTable,
  obligationSettlementsTable,
  peopleTable,
  projectsTable,
  secretaryOperationsTable,
} from "@workspace/db";
import {
  emptyConversationState,
  loadConversationMemory,
  saveConversationTurn,
  type ConversationState,
} from "../src/lib/conversation-memory.ts";
import {
  parseFinancialFollowupAdjustment,
  parseRelationshipRequest,
  RELATIONSHIP_CONTEXT_LIMITS,
  retrieveRelationshipContext,
  serializeRelationshipContext,
} from "../src/lib/relationship-context.ts";
import {
  createFinancialObligation,
  createFinancialParty,
  createFinancialPayment,
  createIncomeReceivable,
  getFinancialEntity,
  settleObligation,
} from "../src/lib/financial-graph.ts";
import { Phase2AgentRuntime, type ModelGateway } from "../src/lib/phase2.ts";
import { executeApprovedOperation, type Identity } from "../src/lib/secretary.ts";
import { claimOperation } from "../src/lib/secretary-operations.ts";

const identity: Identity = {
  tenantId: `phase4-context-${process.pid}-${Date.now()}`,
  userId: "phase4-user",
};
const otherIdentity: Identity = {
  tenantId: `${identity.tenantId}-other`,
  userId: identity.userId,
};

const cleanupTables = [
  activityEventEntitiesTable,
  activityEventsTable,
  secretaryOperationsTable,
  conversationMemoryTable,
  obligationSettlementsTable,
  donationsTable,
  incomeReceivablesTable,
  financialPaymentsTable,
  financialObligationsTable,
  financialPartyPeopleTable,
  financialPartyProjectsTable,
  financialPartiesTable,
  expensesTable,
  peopleTable,
  projectsTable,
] as const;

async function cleanup() {
  for (const table of cleanupTables) {
    await db.delete(table).where(and(
      eq(table.tenantId, identity.tenantId),
      eq(table.ownerUserId, identity.userId),
    ));
    await db.delete(table).where(and(
      eq(table.tenantId, otherIdentity.tenantId),
      eq(table.ownerUserId, otherIdentity.userId),
    ));
  }
}

async function seedGraph() {
  const [person] = await db.insert(peopleTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    name: "محمد أحمد",
    nameKey: "محمد احمد",
  }).returning();
  const [project] = await db.insert(projectsTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    name: "المحجر",
    nameKey: "المحجر",
  }).returning();
  const ownerParty = await createFinancialParty(identity, {
    partyType: "person",
    name: "أنا",
  });
  const personParty = await createFinancialParty(identity, {
    partyType: "person",
    name: "محمد أحمد",
  });
  await db.insert(financialPartyPeopleTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    partyId: personParty.id,
    personId: person.id,
  });
  await db.insert(financialPartyProjectsTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    partyId: personParty.id,
    projectId: project.id,
  });
  const obligation = await createFinancialObligation(identity, {
    kind: "debt",
    title: "دين محمد",
    lenderPartyId: ownerParty.id,
    borrowerPartyId: personParty.id,
    principalAmountMinor: 10_000,
    currency: "EGP",
  });
  const settlementPayment = await createFinancialPayment(identity, {
    payerPartyId: personParty.id,
    payeePartyId: ownerParty.id,
    amountMinor: 4_000,
    currency: "EGP",
    paymentKind: "settlement",
  });
  await settleObligation(identity, {
    obligationId: obligation.id,
    paymentId: settlementPayment.id,
    amountMinor: 4_000,
  });
  await createIncomeReceivable(identity, {
    kind: "receivable",
    title: "مستحق منفصل",
    creditorPartyId: ownerParty.id,
    debtorPartyId: personParty.id,
    amountMinor: 5_000,
    currency: "USD",
  });
  const expenseRows = await db.insert(expensesTable).values([
    {
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      projectId: project.id,
      personId: person.id,
      description: "معدات",
      amountMinor: 12_000,
      currency: "EGP",
    },
    {
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      projectId: project.id,
      personId: person.id,
      description: "خدمة",
      amountMinor: 300,
      currency: "USD",
    },
  ]).returning();
  await db.insert(peopleTable).values({
    tenantId: otherIdentity.tenantId,
    ownerUserId: otherIdentity.userId,
    name: "محمد أحمد",
    nameKey: "محمد احمد",
  });
  const foreignParty = await createFinancialParty(otherIdentity, {
    partyType: "person",
    name: "محمد أحمد",
  });
  const foreignOwner = await createFinancialParty(otherIdentity, {
    partyType: "person",
    name: "أنا",
  });
  await createIncomeReceivable(otherIdentity, {
    kind: "receivable",
    title: "يجب ألا يظهر",
    creditorPartyId: foreignOwner.id,
    debtorPartyId: foreignParty.id,
    amountMinor: 999_999,
    currency: "EGP",
  });
  return { person, project, personParty, ownerParty, expense: expenseRows[0] };
}

test("relationship parser recognizes bounded deterministic reads and safe follow-up adjustments", () => {
  const state: ConversationState = {
    ...emptyConversationState(),
    lastExpense: {
      id: "00000000-0000-0000-0000-000000000001",
      amountMinor: 500_000,
      currency: "EGP",
    },
  };
  assert.equal(parseRelationshipRequest("محمد أحمد عليه كام؟", state)?.intent, "person_financial_status");
  assert.equal(parseRelationshipRequest("كام دفعنا في مشروع المحجر؟", state)?.intent, "project_expenses");
  assert.equal(parseRelationshipRequest("إيه المدفوعات الأخيرة؟", state)?.intent, "recent_payments");
  assert.deepEqual(parseFinancialFollowupAdjustment("طب زود عليهم 2000", state), {
    status: "ready",
    expenseId: state.lastExpense!.id,
    amountMinor: 700_000,
    currency: "EGP",
    previousAmountMinor: 500_000,
    deltaMinor: 200_000,
  });
  assert.deepEqual(
    parseFinancialFollowupAdjustment("زود عليهم 50 دولار", state),
    { status: "currency_mismatch" },
  );
});

test("financial context uses canonical directions, settlements, currencies, and tenant isolation", async () => {
  await cleanup();
  const seeded = await seedGraph();
  const state = emptyConversationState();
  const result = await retrieveRelationshipContext(identity, "محمد أحمد عليه كام؟", state);
  assert.ok(result?.response);
  assert.equal(result?.response?.kind, "answer");
  assert.deepEqual(result?.context.financialSummary.outstandingObligationsOwedByParty, [
    { currency: "EGP", amountMinor: 6_000, count: 1 },
  ]);
  assert.deepEqual(result?.context.financialSummary.openReceivablesOwedByParty, [
    { currency: "USD", amountMinor: 5_000, count: 1 },
  ]);
  assert.equal(JSON.stringify(result).includes("999999"), false);
  assert.equal(result?.context.resolvedEntities.some((entity) => entity.id === seeded.personParty.id), true);
  const detail = await getFinancialEntity(identity, "party", seeded.personParty.id);
  const firstObligation = (detail?.related.obligations as Array<{ settledAmountMinor: unknown }>)[0];
  assert.equal(typeof firstObligation.settledAmountMinor, "number");

  await createFinancialPayment(identity, {
    payerPartyId: seeded.ownerParty.id,
    payeePartyId: seeded.personParty.id,
    amountMinor: 700,
    currency: "USD",
    paymentKind: "general",
  });
  const followupState: ConversationState = {
    ...state,
    financialParties: [{ id: seeded.personParty.id, name: seeded.personParty.name, type: "financial_party" }],
    lastFinancialParty: { id: seeded.personParty.id, name: seeded.personParty.name, type: "financial_party" },
  };
  const payments = await retrieveRelationshipContext(identity, "طب والمدفوعات الأخيرة؟", followupState);
  assert.deepEqual(payments?.context.financialSummary.recentPaymentsPaidByParty, [
    { currency: "EGP", amountMinor: 4_000, count: 1 },
  ]);
  assert.deepEqual(payments?.context.financialSummary.recentPaymentsReceivedByParty, [
    { currency: "USD", amountMinor: 700, count: 1 },
  ]);

  const project = await retrieveRelationshipContext(identity, "كام دفعنا في مشروع المحجر؟", state);
  assert.equal(project?.response?.kind, "answer");
  assert.deepEqual(project?.context.financialSummary.projectExpenses, [
    { currency: "EGP", amountMinor: 12_000, count: 1 },
    { currency: "USD", amountMinor: 300, count: 1 },
  ]);
  assert.ok(serializeRelationshipContext(project!.context).length <= RELATIONSHIP_CONTEXT_LIMITS.maxContextChars);
  await cleanup();
});

test("context refuses ambiguous names instead of guessing", async () => {
  await cleanup();
  await db.insert(peopleTable).values([
    {
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      name: "محمد أحمد",
      nameKey: "محمد احمد",
    },
    {
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      name: "محمد أحمد",
      nameKey: "محمد احمد",
    },
  ]);
  const result = await retrieveRelationshipContext(identity, "محمد أحمد عليه كام؟", emptyConversationState());
  assert.equal(result?.response?.kind, "clarification");
  assert.equal(result?.context.uncertainties.includes("ambiguous_entity"), true);
  await cleanup();
});

test("recent records and serialized context enforce hard bounds", async () => {
  await cleanup();
  const seeded = await seedGraph();
  for (let index = 0; index < RELATIONSHIP_CONTEXT_LIMITS.maxRecords + 5; index += 1) {
    await createFinancialPayment(identity, {
      payerPartyId: seeded.personParty.id,
      payeePartyId: seeded.ownerParty.id,
      amountMinor: 100 + index,
      currency: "EGP",
      paymentKind: "general",
    });
  }
  const state: ConversationState = {
    ...emptyConversationState(),
    financialParties: [{
      id: seeded.personParty.id,
      name: seeded.personParty.name,
      type: "financial_party",
    }],
    lastFinancialParty: {
      id: seeded.personParty.id,
      name: seeded.personParty.name,
      type: "financial_party",
    },
  };
  const result = await retrieveRelationshipContext(identity, "طب والمدفوعات الأخيرة؟", state);
  assert.equal(result?.context.relevantRecords.length, RELATIONSHIP_CONTEXT_LIMITS.maxRecords);
  assert.ok(serializeRelationshipContext(result!.context).length <= RELATIONSHIP_CONTEXT_LIMITS.maxContextChars);
  result!.context.resolvedEntities[0]!.name = "س".repeat(20_000);
  assert.ok(serializeRelationshipContext(result!.context).length <= RELATIONSHIP_CONTEXT_LIMITS.maxContextChars);
  await cleanup();
});

test("entity-scoped debt follow-up never falls back to global totals", async () => {
  await cleanup();
  const seeded = await seedGraph();
  const unrelated = await createFinancialParty(identity, { partyType: "person", name: "طرف آخر" });
  await createFinancialObligation(identity, {
    kind: "debt",
    title: "دين غير مرتبط",
    lenderPartyId: seeded.ownerParty.id,
    borrowerPartyId: unrelated.id,
    principalAmountMinor: 800_000,
    currency: "EGP",
  });
  const state: ConversationState = {
    ...emptyConversationState(),
    financialParties: [{ id: seeded.personParty.id, name: seeded.personParty.name, type: "financial_party" }],
    lastFinancialParty: { id: seeded.personParty.id, name: seeded.personParty.name, type: "financial_party" },
  };
  const result = await retrieveRelationshipContext(identity, "والديون المفتوحة؟", state);
  assert.equal(JSON.stringify(result).includes("800000"), false);
  assert.deepEqual(result?.context.financialSummary.outstandingObligationsOwedByParty, [
    { currency: "EGP", amountMinor: 6_000, count: 1 },
  ]);
  await cleanup();
});

test("an unresolved or merely fuzzy financial-party link never degrades to global data", async () => {
  await cleanup();
  const seeded = await seedGraph();
  const [unlinked] = await db.insert(peopleTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    name: "سامي بلا طرف",
    nameKey: "سامي بلا طرف",
  }).returning();
  const missingState: ConversationState = {
    ...emptyConversationState(),
    people: [{ id: unlinked.id, name: unlinked.name, type: "person" }],
    lastPerson: { id: unlinked.id, name: unlinked.name, type: "person" },
  };
  const missing = await retrieveRelationshipContext(identity, "طب والمدفوعات الأخيرة؟", missingState);
  assert.equal(missing?.response?.kind, "not_found");
  assert.deepEqual(missing?.context.relevantRecords, []);
  assert.equal(JSON.stringify(missing).includes(seeded.personParty.id), false);

  const [similar] = await db.insert(peopleTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    name: "محمد احم",
    nameKey: "محمد احم",
  }).returning();
  const fuzzyState: ConversationState = {
    ...emptyConversationState(),
    people: [{ id: similar.id, name: similar.name, type: "person" }],
    lastPerson: { id: similar.id, name: similar.name, type: "person" },
  };
  const fuzzy = await retrieveRelationshipContext(identity, "طب والمدفوعات الأخيرة؟", fuzzyState);
  assert.notEqual(fuzzy?.response?.kind, "answer");
  assert.equal(
    fuzzy?.context.relevantRecords.every((record) => record.candidate === true && record.amountMinor === undefined),
    true,
  );

  const [prefix] = await db.insert(peopleTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    name: "محمد",
    nameKey: "محمد",
  }).returning();
  const prefixState: ConversationState = {
    ...emptyConversationState(),
    people: [{ id: prefix.id, name: prefix.name, type: "person" }],
    lastPerson: { id: prefix.id, name: prefix.name, type: "person" },
  };
  const prefixResult = await retrieveRelationshipContext(identity, "طب والمدفوعات الأخيرة؟", prefixState);
  assert.notEqual(prefixResult?.response?.kind, "answer");
  assert.equal(
    prefixResult?.context.relevantRecords.every((record) => record.candidate === true && record.amountMinor === undefined),
    true,
  );
  await cleanup();
});

test("aggregate currency categories are selected deterministically inside the hard bound", async () => {
  await cleanup();
  const seeded = await seedGraph();
  for (let index = 0; index < 12; index += 1) {
    await createFinancialObligation(identity, {
      kind: "debt",
      title: `دين ${index}`,
      lenderPartyId: seeded.ownerParty.id,
      borrowerPartyId: seeded.personParty.id,
      principalAmountMinor: 100 + index,
      currency: `A${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`,
    });
  }
  const result = await retrieveRelationshipContext(identity, "إيه الديون المفتوحة؟", emptyConversationState());
  const totals = result?.context.financialSummary.openObligations ?? [];
  assert.equal(totals.length, 10);
  assert.deepEqual(
    totals.map((total) => total.currency),
    [...totals.map((total) => total.currency)].sort(),
  );
  assert.equal(result?.context.truncated, true);
  await cleanup();
});

test("Phase2 persists a financial referent and resolves the next turn without provider calls", async () => {
  await cleanup();
  const seeded = await seedGraph();
  class UnreachableGateway implements ModelGateway {
    readonly provider = "gemini" as const;
    readonly modelName = "unreachable";
    calls = 0;
    async generate(): Promise<never> {
      this.calls += 1;
      throw new Error("provider should not be called");
    }
  }
  const gateway = new UnreachableGateway();
  const runtime = new Phase2AgentRuntime(gateway);
  const conversationId = `phase4-followup-${Date.now()}`;
  const first = await runtime.run(identity, {
    message: "محمد أحمد عليه كام؟",
    conversationId,
  });
  assert.equal(first.response?.kind, "answer");
  assert.equal(first.action?.llmCalls, 0);
  assert.equal(gateway.calls, 0);
  const memory = await loadConversationMemory(identity, conversationId);
  assert.equal(memory.state.lastFinancialParty?.id, seeded.personParty.id);

  const followup = await runtime.run(identity, {
    message: "طب والمدفوعات الأخيرة؟",
    conversationId,
  });
  assert.equal(followup.response?.kind, "answer");
  assert.equal(followup.action?.llmCalls, 0);
  assert.equal(gateway.calls, 0);
  const context = followup.action?.context as { conversationReferences?: unknown[] } | undefined;
  assert.equal((context?.conversationReferences?.length ?? 0) > 0, true);
  await cleanup();
});

test("relative expense approval applies its delta to the latest saved amount atomically", async () => {
  await cleanup();
  const seeded = await seedGraph();
  const gateway: ModelGateway = {
    provider: "gemini",
    modelName: "unreachable",
    async generate() {
      throw new Error("provider should not be called");
    },
  };
  const runtime = new Phase2AgentRuntime(gateway);
  const conversationId = `phase4-relative-${Date.now()}`;
  const snapshot = await loadConversationMemory(identity, conversationId);
  const state: ConversationState = {
    ...emptyConversationState(),
    lastExpense: {
      id: seeded.expense.id,
      amountMinor: seeded.expense.amountMinor,
      currency: seeded.expense.currency,
      description: seeded.expense.description,
      projectId: seeded.project.id,
    },
  };
  await saveConversationTurn(identity, snapshot, {
    userMessage: "سجلناه",
    assistantMessage: "تم",
    action: { type: "expense_recorded", conversationState: state },
  });
  const pending = await runtime.run(identity, {
    message: "طب زود عليهم 20",
    conversationId,
  });
  assert.equal(pending.action?.llmCalls, 0);
  const operationId = pending.action?.operationId;
  assert.equal(typeof operationId, "string");
  await db.update(expensesTable).set({
    amountMinor: 15_000,
    rowVersion: seeded.expense.rowVersion + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(expensesTable.tenantId, identity.tenantId),
    eq(expensesTable.ownerUserId, identity.userId),
    eq(expensesTable.id, seeded.expense.id),
  ));
  const claimed = await claimOperation(identity, String(operationId));
  assert.equal(claimed.kind, "claimed");
  await executeApprovedOperation(identity, claimed.operation);
  const [updated] = await db.select().from(expensesTable).where(and(
    eq(expensesTable.tenantId, identity.tenantId),
    eq(expensesTable.ownerUserId, identity.userId),
    eq(expensesTable.id, seeded.expense.id),
  ));
  assert.equal(updated.amountMinor, 17_000);

  const secondConversationId = `phase4-relative-currency-${Date.now()}`;
  const secondSnapshot = await loadConversationMemory(identity, secondConversationId);
  await saveConversationTurn(identity, secondSnapshot, {
    userMessage: "المصروف الحالي",
    assistantMessage: "تم",
    action: {
      type: "expense_recorded",
      conversationState: {
        ...emptyConversationState(),
        lastExpense: {
          id: updated.id,
          amountMinor: updated.amountMinor,
          currency: updated.currency,
          description: updated.description,
          projectId: seeded.project.id,
        },
      },
    },
  });
  const currencyPending = await runtime.run(identity, {
    message: "طب زود عليهم 10",
    conversationId: secondConversationId,
  });
  const currencyOperationId = currencyPending.action?.operationId;
  assert.equal(typeof currencyOperationId, "string");
  await db.update(expensesTable).set({
    currency: "USD",
    updatedAt: new Date(),
    rowVersion: updated.rowVersion + 1,
  }).where(and(
    eq(expensesTable.tenantId, identity.tenantId),
    eq(expensesTable.ownerUserId, identity.userId),
    eq(expensesTable.id, updated.id),
  ));
  const currencyClaim = await claimOperation(identity, String(currencyOperationId));
  assert.equal(currencyClaim.kind, "claimed");
  await assert.rejects(
    executeApprovedOperation(identity, currencyClaim.operation),
    /currency changed/i,
  );
  const [currencyChanged] = await db.select().from(expensesTable).where(and(
    eq(expensesTable.tenantId, identity.tenantId),
    eq(expensesTable.ownerUserId, identity.userId),
    eq(expensesTable.id, updated.id),
  ));
  assert.equal(currencyChanged.amountMinor, 17_000);
  assert.equal(currencyChanged.currency, "USD");
  await cleanup();
});