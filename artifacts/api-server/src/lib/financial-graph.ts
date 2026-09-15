import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  donationsTable,
  financialObligationsTable,
  financialPartyPeopleTable,
  financialPartyProjectsTable,
  financialPartyPurposesTable,
  financialPartiesTable,
  financialPaymentsTable,
  incomeReceivablesTable,
  obligationSettlementsTable,
  paymentLinksTable,
  peopleTable,
  projectsTable,
  purposesTable,
} from "@workspace/db";
import type { DbExecutor } from "./entity-graph";
import type { Identity } from "./secretary";

const scoped = (identity: Identity, table: { tenantId: any; ownerUserId: any }) =>
  and(eq(table.tenantId, identity.tenantId), eq(table.ownerUserId, identity.userId));

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function currencyCode(value: unknown): string {
  const currency = requiredText(value, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("currency must be a three-letter ISO code.");
  return currency;
}

function positiveMinor(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("amountMinor must be a positive integer.");
  }
  return value;
}

function dateArg(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error("The date must be a valid ISO timestamp.");
  return date;
}

async function party(identity: Identity, partyId: string, executor: DbExecutor) {
  const [row] = await executor.select().from(financialPartiesTable).where(and(
    scoped(identity, financialPartiesTable),
    eq(financialPartiesTable.id, partyId),
  ));
  if (!row) throw new Error("Financial party is not accessible.");
  return row;
}

async function optionalLinks(
  identity: Identity,
  args: { personId?: unknown; projectId?: unknown; purposeId?: unknown },
  partyId: string,
  executor: DbExecutor,
) {
  const personId = typeof args.personId === "string" && args.personId ? args.personId : undefined;
  const projectId = typeof args.projectId === "string" && args.projectId ? args.projectId : undefined;
  const purposeId = typeof args.purposeId === "string" && args.purposeId ? args.purposeId : undefined;
  if (personId) {
    const [row] = await executor.select({ id: peopleTable.id }).from(peopleTable).where(and(
      scoped(identity, peopleTable), eq(peopleTable.id, personId),
    ));
    if (!row) throw new Error("Person is not accessible.");
    await executor.insert(financialPartyPeopleTable).values({
      tenantId: identity.tenantId, ownerUserId: identity.userId, partyId, personId,
    }).onConflictDoNothing();
  }
  if (projectId) {
    const [row] = await executor.select({ id: projectsTable.id }).from(projectsTable).where(and(
      scoped(identity, projectsTable), eq(projectsTable.id, projectId),
    ));
    if (!row) throw new Error("Project is not accessible.");
    await executor.insert(financialPartyProjectsTable).values({
      tenantId: identity.tenantId, ownerUserId: identity.userId, partyId, projectId,
    }).onConflictDoNothing();
  }
  if (purposeId) {
    const [row] = await executor.select({ id: purposesTable.id }).from(purposesTable).where(and(
      scoped(identity, purposesTable), eq(purposesTable.id, purposeId),
    ));
    if (!row) throw new Error("Purpose is not accessible.");
    await executor.insert(financialPartyPurposesTable).values({
      tenantId: identity.tenantId, ownerUserId: identity.userId, partyId, purposeId,
    }).onConflictDoNothing();
  }
}

async function validateOptionalReferences(
  identity: Identity,
  args: { projectId?: unknown; purposeId?: unknown },
  executor: DbExecutor,
) {
  const projectId = typeof args.projectId === "string" && args.projectId ? args.projectId : undefined;
  const purposeId = typeof args.purposeId === "string" && args.purposeId ? args.purposeId : undefined;
  if (projectId) {
    const [row] = await executor.select({ id: projectsTable.id }).from(projectsTable).where(and(
      scoped(identity, projectsTable), eq(projectsTable.id, projectId),
    ));
    if (!row) throw new Error("Project is not accessible.");
  }
  if (purposeId) {
    const [row] = await executor.select({ id: purposesTable.id }).from(purposesTable).where(and(
      scoped(identity, purposesTable), eq(purposesTable.id, purposeId),
    ));
    if (!row) throw new Error("Purpose is not accessible.");
  }
}

async function settlementTotal(identity: Identity, obligationId: string, executor: DbExecutor) {
  const [row] = await executor.select({
    value: sql<number>`coalesce(sum(${obligationSettlementsTable.amountMinor}), 0)`,
  }).from(obligationSettlementsTable).where(and(
    scoped(identity, obligationSettlementsTable),
    eq(obligationSettlementsTable.obligationId, obligationId),
  ));
  return Number(row?.value ?? 0);
}

export async function createFinancialParty(
  identity: Identity,
  args: Record<string, unknown>,
  executor: DbExecutor = db,
) {
  const name = requiredText(args.name, "name");
  const partyType = requiredText(args.partyType, "partyType");
  if (!["person", "project", "organization", "external"].includes(partyType)) {
    throw new Error("partyType must be person, project, organization, or external.");
  }
  const [created] = await executor.insert(financialPartiesTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    partyType,
    name,
    nameKey: name.normalize("NFKC").trim().toLocaleLowerCase("ar"),
  }).returning();
  await optionalLinks(identity, args, created.id, executor);
  return created;
}

export async function createFinancialObligation(
  identity: Identity,
  args: Record<string, unknown>,
  executor: DbExecutor = db,
) {
  const kind = requiredText(args.kind, "kind");
  const title = requiredText(args.title, "title");
  const lenderPartyId = requiredText(args.lenderPartyId, "lenderPartyId");
  const borrowerPartyId = requiredText(args.borrowerPartyId, "borrowerPartyId");
  if (!["advance", "debt"].includes(kind)) throw new Error("kind must be advance or debt.");
  if (lenderPartyId === borrowerPartyId) throw new Error("lenderPartyId and borrowerPartyId must differ.");
  await party(identity, lenderPartyId, executor);
  await party(identity, borrowerPartyId, executor);
  const amountMinor = positiveMinor(args.principalAmountMinor);
  const currency = currencyCode(args.currency);
  const purposeId = typeof args.purposeId === "string" ? args.purposeId : null;
  const projectId = typeof args.projectId === "string" ? args.projectId : null;
  if (purposeId) {
    const [row] = await executor.select({ id: purposesTable.id }).from(purposesTable).where(and(scoped(identity, purposesTable), eq(purposesTable.id, purposeId)));
    if (!row) throw new Error("Purpose is not accessible.");
  }
  if (projectId) {
    const [row] = await executor.select({ id: projectsTable.id }).from(projectsTable).where(and(scoped(identity, projectsTable), eq(projectsTable.id, projectId)));
    if (!row) throw new Error("Project is not accessible.");
  }
  const [created] = await executor.insert(financialObligationsTable).values({
    tenantId: identity.tenantId, ownerUserId: identity.userId, kind, title,
    lenderPartyId, borrowerPartyId, principalAmountMinor: amountMinor, currency,
    purposeId, projectId, dueAt: dateArg(args.dueAt),
  }).returning();
  return created;
}

export async function createFinancialPayment(
  identity: Identity,
  args: Record<string, unknown>,
  executor: DbExecutor = db,
) {
  const payerPartyId = requiredText(args.payerPartyId, "payerPartyId");
  const payeePartyId = requiredText(args.payeePartyId, "payeePartyId");
  if (payerPartyId === payeePartyId) throw new Error("payerPartyId and payeePartyId must differ.");
  await party(identity, payerPartyId, executor);
  await party(identity, payeePartyId, executor);
  const [created] = await executor.insert(financialPaymentsTable).values({
    tenantId: identity.tenantId, ownerUserId: identity.userId,
    paymentKind: typeof args.paymentKind === "string" ? args.paymentKind : "general",
    payerPartyId, payeePartyId, amountMinor: positiveMinor(args.amountMinor),
    currency: currencyCode(args.currency),
    description: typeof args.description === "string" ? args.description.trim() || null : null,
    occurredAt: dateArg(args.occurredAt) ?? new Date(),
  }).returning();
  return created;
}

export async function settleObligation(
  identity: Identity,
  args: Record<string, unknown>,
  executor: DbExecutor = db,
) {
  const obligationId = requiredText(args.obligationId, "obligationId");
  const paymentId = requiredText(args.paymentId, "paymentId");
  const amountMinor = positiveMinor(args.amountMinor);
  const [obligation] = await executor.select().from(financialObligationsTable).where(and(scoped(identity, financialObligationsTable), eq(financialObligationsTable.id, obligationId)));
  const [payment] = await executor.select().from(financialPaymentsTable).where(and(scoped(identity, financialPaymentsTable), eq(financialPaymentsTable.id, paymentId)));
  if (!obligation || !payment) throw new Error("Obligation or payment is not accessible.");
  if (obligation.status === "cancelled") throw new Error("Cancelled obligations cannot receive settlements.");
  if (obligation.status === "settled") throw new Error("This obligation is already settled.");
  if (obligation.currency !== payment.currency) throw new Error("Settlement currency must match the obligation and payment.");
  if (amountMinor > payment.amountMinor) throw new Error("Settlement cannot exceed the payment amount.");
  const existingPayment = await executor.select({ id: obligationSettlementsTable.id })
    .from(obligationSettlementsTable)
    .where(and(
      scoped(identity, obligationSettlementsTable),
      eq(obligationSettlementsTable.obligationId, obligationId),
      eq(obligationSettlementsTable.paymentId, paymentId),
    ));
  if (existingPayment.length > 0) throw new Error("This payment is already applied to the obligation.");
  const currentTotal = await settlementTotal(identity, obligationId, executor);
  const [paymentTotalRow] = await executor.select({
    value: sql<number>`coalesce(sum(${obligationSettlementsTable.amountMinor}), 0)`,
  }).from(obligationSettlementsTable).where(and(
    scoped(identity, obligationSettlementsTable),
    eq(obligationSettlementsTable.paymentId, paymentId),
  ));
  if (Number(paymentTotalRow?.value ?? 0) + amountMinor > payment.amountMinor) {
    throw new Error("Settlement allocations cannot exceed the payment amount.");
  }
  const nextTotal = currentTotal + amountMinor;
  if (nextTotal > obligation.principalAmountMinor) {
    throw new Error("Settlement cannot exceed the obligation principal.");
  }
  const [created] = await executor.insert(obligationSettlementsTable).values({
    tenantId: identity.tenantId, ownerUserId: identity.userId, obligationId, paymentId,
    amountMinor, currency: obligation.currency, settledAt: dateArg(args.settledAt) ?? new Date(),
  }).returning();
  const [updatedObligation] = await executor.update(financialObligationsTable).set({
    status: nextTotal === obligation.principalAmountMinor ? "settled" : "open",
    rowVersion: sql`${financialObligationsTable.rowVersion} + 1`,
    updatedAt: new Date(),
  }).where(and(
    scoped(identity, financialObligationsTable),
    eq(financialObligationsTable.id, obligationId),
    eq(financialObligationsTable.rowVersion, obligation.rowVersion),
  )).returning();
  if (!updatedObligation) throw new Error("Obligation changed while applying the settlement.");
  return {
    ...created,
    outstandingAmountMinor: obligation.principalAmountMinor - nextTotal,
    obligationStatus: updatedObligation.status,
  };
}

export async function createDonation(identity: Identity, args: Record<string, unknown>, executor: DbExecutor = db) {
  const donorPartyId = requiredText(args.donorPartyId, "donorPartyId");
  const recipientPartyId = requiredText(args.recipientPartyId, "recipientPartyId");
  if (donorPartyId === recipientPartyId) throw new Error("Donor and recipient must differ.");
  await party(identity, donorPartyId, executor);
  await party(identity, recipientPartyId, executor);
  await validateOptionalReferences(identity, args, executor);
  const status = typeof args.status === "string" ? args.status : "pledged";
  if (!["pledged", "paid", "cancelled"].includes(status)) throw new Error("Invalid donation status.");
  const [created] = await executor.insert(donationsTable).values({
    tenantId: identity.tenantId, ownerUserId: identity.userId, donorPartyId, recipientPartyId,
    amountMinor: positiveMinor(args.amountMinor), currency: currencyCode(args.currency),
    purposeId: typeof args.purposeId === "string" ? args.purposeId : null,
    projectId: typeof args.projectId === "string" ? args.projectId : null,
    description: typeof args.description === "string" ? args.description.trim() || null : null,
    status,
    pledgedAt: dateArg(args.pledgedAt) ?? new Date(),
    paidAt: status === "paid" ? dateArg(args.paidAt) ?? new Date() : null,
  }).returning();
  return created;
}

export async function createIncomeReceivable(identity: Identity, args: Record<string, unknown>, executor: DbExecutor = db) {
  const creditorPartyId = requiredText(args.creditorPartyId, "creditorPartyId");
  const debtorPartyId = requiredText(args.debtorPartyId, "debtorPartyId");
  if (creditorPartyId === debtorPartyId) throw new Error("Creditor and debtor must differ.");
  await party(identity, creditorPartyId, executor);
  await party(identity, debtorPartyId, executor);
  const kind = requiredText(args.kind, "kind");
  if (!["income", "receivable"].includes(kind)) throw new Error("kind must be income or receivable.");
  await validateOptionalReferences(identity, args, executor);
  const [created] = await executor.insert(incomeReceivablesTable).values({
    tenantId: identity.tenantId, ownerUserId: identity.userId, kind,
    title: requiredText(args.title, "title"), creditorPartyId, debtorPartyId,
    amountMinor: positiveMinor(args.amountMinor), currency: currencyCode(args.currency),
    purposeId: typeof args.purposeId === "string" ? args.purposeId : null,
    projectId: typeof args.projectId === "string" ? args.projectId : null,
    dueAt: dateArg(args.dueAt),
  }).returning();
  return created;
}

export async function createPaymentLink(identity: Identity, args: Record<string, unknown>, executor: DbExecutor = db) {
  const targets = ["paymentId", "receivableId", "donationId"].filter((key) => typeof args[key] === "string" && args[key]);
  if (targets.length !== 1) throw new Error("A payment link must target exactly one payment, receivable, or donation.");
  const targetKey = targets[0];
  const targetId = requiredText(args[targetKey], targetKey);
  const targetTable = targetKey === "paymentId"
    ? financialPaymentsTable
    : targetKey === "receivableId" ? incomeReceivablesTable : donationsTable;
  const [target] = await executor.select({ id: targetTable.id }).from(targetTable).where(and(scoped(identity, targetTable), eq(targetTable.id, targetId)));
  if (!target) throw new Error("Payment link target is not accessible.");
  const [created] = await executor.insert(paymentLinksTable).values({
    tenantId: identity.tenantId, ownerUserId: identity.userId,
    token: requiredText(args.token, "token"),
    ...(targetKey === "paymentId" ? { paymentId: targetId } : {}),
    ...(targetKey === "receivableId" ? { receivableId: targetId } : {}),
    ...(targetKey === "donationId" ? { donationId: targetId } : {}),
    provider: typeof args.provider === "string" ? args.provider : "internal",
    expiresAt: dateArg(args.expiresAt),
  }).returning();
  return created;
}

function expectedVersion(args: Record<string, unknown>) {
  return typeof args.expectedRowVersion === "number" && Number.isSafeInteger(args.expectedRowVersion)
    ? args.expectedRowVersion
    : undefined;
}

export async function updateFinancialPayment(identity: Identity, args: Record<string, unknown>, executor: DbExecutor = db) {
  const id = requiredText(args.paymentId, "paymentId");
  const [existing] = await executor.select().from(financialPaymentsTable).where(and(scoped(identity, financialPaymentsTable), eq(financialPaymentsTable.id, id)));
  if (!existing) throw new Error("Payment is not accessible.");
  const [allocatedRow] = await executor.select({
    value: sql<number>`coalesce(sum(${obligationSettlementsTable.amountMinor}), 0)`,
  }).from(obligationSettlementsTable).where(and(
    scoped(identity, obligationSettlementsTable),
    eq(obligationSettlementsTable.paymentId, id),
  ));
  const allocated = Number(allocatedRow?.value ?? 0);
  const updates: Record<string, unknown> = { updatedAt: new Date(), rowVersion: sql`${financialPaymentsTable.rowVersion} + 1` };
  if (args.amountMinor !== undefined) {
    const nextAmount = positiveMinor(args.amountMinor);
    if (nextAmount < allocated) throw new Error("Payment cannot be corrected below its settled amount.");
    updates.amountMinor = nextAmount;
  }
  if (typeof args.currency === "string" && args.currency.trim()) {
    const nextCurrency = args.currency.trim().toUpperCase();
    if (allocated > 0 && nextCurrency !== existing.currency) {
      throw new Error("A settled payment cannot change currency.");
    }
    updates.currency = nextCurrency;
  }
  if (args.description === null) updates.description = null;
  else if (typeof args.description === "string") updates.description = args.description.trim() || null;
  const occurredAt = dateArg(args.occurredAt);
  if (occurredAt) updates.occurredAt = occurredAt;
  const where = and(scoped(identity, financialPaymentsTable), eq(financialPaymentsTable.id, id), ...(expectedVersion(args) === undefined ? [] : [eq(financialPaymentsTable.rowVersion, expectedVersion(args)!)]));
  const [updated] = await executor.update(financialPaymentsTable).set(updates).where(where).returning();
  if (!updated) throw new Error("Payment changed since it was read.");
  return updated;
}

export async function updateFinancialObligation(identity: Identity, args: Record<string, unknown>, executor: DbExecutor = db) {
  const id = requiredText(args.obligationId, "obligationId");
  const [existing] = await executor.select().from(financialObligationsTable).where(and(scoped(identity, financialObligationsTable), eq(financialObligationsTable.id, id)));
  if (!existing) throw new Error("Obligation is not accessible.");
  const total = await settlementTotal(identity, id, executor);
  const updates: Record<string, unknown> = { updatedAt: new Date(), rowVersion: sql`${financialObligationsTable.rowVersion} + 1` };
  if (typeof args.title === "string" && args.title.trim()) updates.title = args.title.trim();
  if (args.principalAmountMinor !== undefined) {
    const principal = positiveMinor(args.principalAmountMinor);
    if (principal < total) throw new Error("Principal cannot be corrected below settled total.");
    updates.principalAmountMinor = principal;
    updates.status = principal === total ? "settled" : "open";
  }
  if (typeof args.status === "string") {
    if (!["open", "settled", "cancelled"].includes(args.status)) throw new Error("Invalid obligation status.");
    if (args.status === "cancelled" && total > 0) throw new Error("An obligation with settlements cannot be cancelled.");
    if (args.status === "settled" && total !== (updates.principalAmountMinor ?? existing.principalAmountMinor)) {
      throw new Error("An obligation can be settled only when fully covered.");
    }
    const effectivePrincipal = Number(updates.principalAmountMinor ?? existing.principalAmountMinor);
    if (args.status === "open" && total >= effectivePrincipal) {
      throw new Error("A fully settled obligation cannot be marked open.");
    }
    updates.status = args.status;
  }
  if (args.dueAt === null) updates.dueAt = null;
  else {
    const dueAt = dateArg(args.dueAt);
    if (dueAt) updates.dueAt = dueAt;
  }
  const where = and(scoped(identity, financialObligationsTable), eq(financialObligationsTable.id, id), ...(expectedVersion(args) === undefined ? [] : [eq(financialObligationsTable.rowVersion, expectedVersion(args)!)]));
  const [updated] = await executor.update(financialObligationsTable).set(updates).where(where).returning();
  if (!updated) throw new Error("Obligation changed since it was read.");
  return updated;
}

export async function updateDonation(identity: Identity, args: Record<string, unknown>, executor: DbExecutor = db) {
  const id = requiredText(args.donationId, "donationId");
  const [existing] = await executor.select().from(donationsTable).where(and(scoped(identity, donationsTable), eq(donationsTable.id, id)));
  if (!existing) throw new Error("Donation is not accessible.");
  const updates: Record<string, unknown> = { updatedAt: new Date(), rowVersion: sql`${donationsTable.rowVersion} + 1` };
  if (args.amountMinor !== undefined) updates.amountMinor = positiveMinor(args.amountMinor);
  if (typeof args.currency === "string") updates.currency = currencyCode(args.currency);
  if (typeof args.status === "string") {
    if (!["pledged", "paid", "cancelled"].includes(args.status)) throw new Error("Invalid donation status.");
    if (existing.status === "cancelled" && args.status !== "cancelled") throw new Error("Cancelled donations cannot be reopened.");
    updates.status = args.status;
    if (args.status === "paid") updates.paidAt = dateArg(args.paidAt) ?? new Date();
    if (args.status === "pledged") updates.paidAt = null;
  }
  if (args.description === null) updates.description = null;
  else if (typeof args.description === "string") updates.description = args.description.trim() || null;
  const where = and(scoped(identity, donationsTable), eq(donationsTable.id, id), ...(expectedVersion(args) === undefined ? [] : [eq(donationsTable.rowVersion, expectedVersion(args)!)]));
  const [updated] = await executor.update(donationsTable).set(updates).where(where).returning();
  if (!updated) throw new Error("Donation is missing or changed since it was read.");
  return updated;
}

export async function updateIncomeReceivable(identity: Identity, args: Record<string, unknown>, executor: DbExecutor = db) {
  const id = requiredText(args.receivableId, "receivableId");
  const [existing] = await executor.select().from(incomeReceivablesTable).where(and(scoped(identity, incomeReceivablesTable), eq(incomeReceivablesTable.id, id)));
  if (!existing) throw new Error("Receivable is not accessible.");
  const updates: Record<string, unknown> = { updatedAt: new Date(), rowVersion: sql`${incomeReceivablesTable.rowVersion} + 1` };
  if (args.amountMinor !== undefined) updates.amountMinor = positiveMinor(args.amountMinor);
  if (typeof args.currency === "string") updates.currency = currencyCode(args.currency);
  if (typeof args.title === "string" && args.title.trim()) updates.title = args.title.trim();
  if (typeof args.status === "string") {
    if (!["open", "settled", "cancelled"].includes(args.status)) throw new Error("Invalid receivable status.");
    if (existing.status === "cancelled" && args.status !== "cancelled") throw new Error("Cancelled receivables cannot be reopened.");
    updates.status = args.status;
  }
  const where = and(scoped(identity, incomeReceivablesTable), eq(incomeReceivablesTable.id, id), ...(expectedVersion(args) === undefined ? [] : [eq(incomeReceivablesTable.rowVersion, expectedVersion(args)!)]));
  const [updated] = await executor.update(incomeReceivablesTable).set(updates).where(where).returning();
  if (!updated) throw new Error("Receivable is missing or changed since it was read.");
  return updated;
}

export async function getFinancialEntity(identity: Identity, kind: string, id: string) {
  if (kind === "party") {
    const [entity] = await db.select().from(financialPartiesTable).where(and(scoped(identity, financialPartiesTable), eq(financialPartiesTable.id, id)));
    if (!entity) return null;
    const [obligations, payments, donations, receivables, settlements] = await Promise.all([
      db.select().from(financialObligationsTable).where(and(scoped(identity, financialObligationsTable), sql`${financialObligationsTable.lenderPartyId} = ${id} OR ${financialObligationsTable.borrowerPartyId} = ${id}`)).orderBy(desc(financialObligationsTable.createdAt)),
      db.select().from(financialPaymentsTable).where(and(scoped(identity, financialPaymentsTable), sql`${financialPaymentsTable.payerPartyId} = ${id} OR ${financialPaymentsTable.payeePartyId} = ${id}`)).orderBy(desc(financialPaymentsTable.occurredAt)),
      db.select().from(donationsTable).where(and(scoped(identity, donationsTable), sql`${donationsTable.donorPartyId} = ${id} OR ${donationsTable.recipientPartyId} = ${id}`)).orderBy(desc(donationsTable.pledgedAt)),
      db.select().from(incomeReceivablesTable).where(and(scoped(identity, incomeReceivablesTable), sql`${incomeReceivablesTable.creditorPartyId} = ${id} OR ${incomeReceivablesTable.debtorPartyId} = ${id}`)).orderBy(desc(incomeReceivablesTable.createdAt)),
      db.select().from(obligationSettlementsTable).where(scoped(identity, obligationSettlementsTable)),
    ]);
    const settledByObligation = new Map<string, number>();
    for (const settlement of settlements) {
      settledByObligation.set(
        settlement.obligationId,
        (settledByObligation.get(settlement.obligationId) ?? 0) + settlement.amountMinor,
      );
    }
    return {
      entity,
      related: {
        obligations: obligations.map((obligation) => ({
          ...obligation,
          settledAmountMinor: settledByObligation.get(obligation.id) ?? 0,
          outstandingAmountMinor: obligation.principalAmountMinor - (settledByObligation.get(obligation.id) ?? 0),
        })),
        payments,
        donations,
        receivables,
      },
    };
  }
  return null;
}