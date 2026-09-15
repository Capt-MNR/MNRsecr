import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  db,
  financialObligationsTable,
  financialPartiesTable,
  financialPaymentsTable,
  obligationSettlementsTable,
  donationsTable,
  incomeReceivablesTable,
} from "@workspace/db";
import {
  createDonation,
  createFinancialObligation,
  createFinancialParty,
  createFinancialPayment,
  createIncomeReceivable,
  settleObligation,
  updateFinancialPayment,
} from "../src/lib/financial-graph";

const identity = { tenantId: `financial-test-${process.pid}-${Date.now()}`, userId: "financial-user" };
const otherIdentity = { tenantId: `${identity.tenantId}-other`, userId: "financial-user" };

async function cleanup() {
  for (const table of [obligationSettlementsTable, donationsTable, incomeReceivablesTable, financialPaymentsTable, financialObligationsTable, financialPartiesTable]) {
    await db.delete(table).where(and(eq(table.tenantId, identity.tenantId), eq(table.ownerUserId, identity.userId)));
    await db.delete(table).where(and(eq(table.tenantId, otherIdentity.tenantId), eq(table.ownerUserId, otherIdentity.userId)));
  }
}

test("keeps explicit directions, partial settlements, donations, and receivables separate", async () => {
  await cleanup();
  const lender = await createFinancialParty(identity, { partyType: "person", name: "المُقرض" });
  const borrower = await createFinancialParty(identity, { partyType: "person", name: "المُقترض" });
  const recipient = await createFinancialParty(identity, { partyType: "organization", name: "الجمعية" });
  const obligation = await createFinancialObligation(identity, {
    kind: "advance",
    title: "سلفة واضحة الاتجاه",
    lenderPartyId: lender.id,
    borrowerPartyId: borrower.id,
    principalAmountMinor: 10000,
    currency: "EGP",
  });
  const payment = await createFinancialPayment(identity, {
    payerPartyId: borrower.id,
    payeePartyId: lender.id,
    amountMinor: 7000,
    currency: "EGP",
    paymentKind: "settlement",
  });
  const secondPayment = await createFinancialPayment(identity, {
    payerPartyId: borrower.id,
    payeePartyId: lender.id,
    amountMinor: 3000,
    currency: "EGP",
    paymentKind: "settlement",
  });
  await settleObligation(identity, { obligationId: obligation.id, paymentId: payment.id, amountMinor: 4000 });
  await settleObligation(identity, { obligationId: obligation.id, paymentId: secondPayment.id, amountMinor: 3000 });
  const settlements = await db.select().from(obligationSettlementsTable).where(and(
    eq(obligationSettlementsTable.tenantId, identity.tenantId),
    eq(obligationSettlementsTable.obligationId, obligation.id),
  ));
  assert.deepEqual(settlements.map((item) => item.amountMinor).sort((a, b) => a - b), [3000, 4000]);
  const [settledObligation] = await db.select().from(financialObligationsTable).where(eq(financialObligationsTable.id, obligation.id));
  assert.equal(settledObligation?.status, "open");
  assert.equal((settledObligation?.principalAmountMinor ?? 0) - settlements.reduce((sum, item) => sum + item.amountMinor, 0), 3000);
  await assert.rejects(settleObligation(identity, {
    obligationId: obligation.id,
    paymentId: secondPayment.id,
    amountMinor: 1,
  }), /already applied|settled/);
  await assert.rejects(createFinancialPayment(identity, {
    payerPartyId: borrower.id,
    payeePartyId: lender.id,
    amountMinor: 100,
    currency: "USD",
  }).then((paymentInWrongCurrency) => settleObligation(identity, {
    obligationId: obligation.id,
    paymentId: paymentInWrongCurrency.id,
    amountMinor: 100,
  })), /currency/);
  await assert.rejects(settleObligation(identity, {
    obligationId: obligation.id,
    paymentId: payment.id,
    amountMinor: 1,
  }), /already applied/);
  const finalPayment = await createFinancialPayment(identity, {
    payerPartyId: borrower.id,
    payeePartyId: lender.id,
    amountMinor: 3000,
    currency: "EGP",
    paymentKind: "settlement",
  });
  await settleObligation(identity, { obligationId: obligation.id, paymentId: finalPayment.id, amountMinor: 3000 });
  const [fullySettled] = await db.select().from(financialObligationsTable).where(eq(financialObligationsTable.id, obligation.id));
  assert.equal(fullySettled?.status, "settled");
  const settledTotal = await db.select().from(obligationSettlementsTable).where(eq(obligationSettlementsTable.obligationId, obligation.id));
  assert.equal(fullySettled?.principalAmountMinor - settledTotal.reduce((sum, item) => sum + item.amountMinor, 0), 0);
  const secondObligation = await createFinancialObligation(identity, {
    kind: "debt",
    title: "التزام آخر",
    lenderPartyId: lender.id,
    borrowerPartyId: borrower.id,
    principalAmountMinor: 4000,
    currency: "EGP",
  });
  await assert.rejects(settleObligation(identity, {
    obligationId: secondObligation.id,
    paymentId: payment.id,
    amountMinor: 4000,
  }), /payment amount/);

  const donation = await createDonation(identity, {
    donorPartyId: lender.id,
    recipientPartyId: recipient.id,
    amountMinor: 2500,
    currency: "EGP",
    status: "pledged",
  });
  const receivable = await createIncomeReceivable(identity, {
    kind: "income",
    title: "دخل مستحق",
    creditorPartyId: lender.id,
    debtorPartyId: borrower.id,
    amountMinor: 5000,
    currency: "USD",
  });
  assert.equal(donation.status, "pledged");
  assert.equal(receivable.kind, "income");
  assert.notEqual(donation.id, receivable.id);

  const corrected = await updateFinancialPayment(identity, {
    paymentId: payment.id,
    amountMinor: 6500,
    expectedRowVersion: payment.rowVersion,
  });
  assert.equal(corrected.amountMinor, 6500);
  await assert.rejects(updateFinancialPayment(identity, {
    paymentId: payment.id,
    amountMinor: 3999,
    expectedRowVersion: corrected.rowVersion,
  }), /settled amount/);
  await assert.rejects(updateFinancialPayment(identity, {
    paymentId: payment.id,
    amountMinor: 6000,
    expectedRowVersion: payment.rowVersion,
  }), /changed/);
  await cleanup();
});

test("does not allow a party from another tenant to define an obligation", async () => {
  await cleanup();
  const foreignParty = await createFinancialParty(otherIdentity, { partyType: "external", name: "طرف آخر" });
  await assert.rejects(createFinancialObligation(identity, {
    kind: "debt",
    title: "اختبار عزل",
    lenderPartyId: foreignParty.id,
    borrowerPartyId: foreignParty.id,
    principalAmountMinor: 1,
    currency: "EGP",
  }), /not accessible|must differ/);
  await cleanup();
});