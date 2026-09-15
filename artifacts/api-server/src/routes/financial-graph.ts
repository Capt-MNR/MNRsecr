import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  donationsTable,
  financialObligationsTable,
  financialPartiesTable,
  financialPaymentsTable,
  incomeReceivablesTable,
  paymentLinksTable,
} from "@workspace/db";
import { executeStructuredTool } from "../lib/phase2";
import {
  getFinancialEntity,
} from "../lib/financial-graph";
import {
  requireIdentity,
  requestId,
  sendRouteError,
} from "./route-context";

const router: IRouter = Router();

function pendingOrResult(res: any, result: Record<string, unknown>, toolName: string) {
  if (result.pendingApproval && result.approval) {
    res.status(202).json({ ok: false, pendingApproval: true, toolName, approval: result.approval });
    return true;
  }
  return false;
}

async function mutate(req: any, res: any, toolName: string, body = req.body ?? {}) {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  try {
    const result = await executeStructuredTool(identity, toolName, body, {
      requestId: requestId(req),
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
    });
    if (pendingOrResult(res, result, toolName)) return;
    if (!result.ok) {
      sendRouteError(req, res, 400, String(result.error ?? "Financial mutation failed."), "FINANCIAL_MUTATION_FAILED");
      return;
    }
    res.status(201).json(result);
  } catch (error) {
    req.log.error({ error, toolName }, "Financial mutation failed");
    sendRouteError(req, res, 500, "تعذر حفظ العملية المالية.", "FINANCIAL_MUTATION_FAILED");
  }
}

router.get("/financial/parties", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  try {
    const items = await db.select().from(financialPartiesTable)
      .where(and(eq(financialPartiesTable.tenantId, identity.tenantId), eq(financialPartiesTable.ownerUserId, identity.userId)))
      .orderBy(desc(financialPartiesTable.updatedAt)).limit(200);
    res.json({ items });
  } catch (error) {
    req.log.error({ error }, "Financial parties read failed");
    sendRouteError(req, res, 500, "تعذر تحميل الأطراف المالية.", "FINANCIAL_PARTIES_READ_FAILED");
  }
});

router.get("/financial/parties/:partyId", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  try {
    const graph = await getFinancialEntity(identity, "party", req.params.partyId);
    if (!graph) {
      sendRouteError(req, res, 404, "الطرف المالي غير موجود.", "FINANCIAL_PARTY_NOT_FOUND");
      return;
    }
    res.json(graph);
  } catch (error) {
    req.log.error({ error }, "Financial party graph read failed");
    sendRouteError(req, res, 500, "تعذر تحميل تفاصيل الطرف المالي.", "FINANCIAL_PARTY_READ_FAILED");
  }
});

router.get("/financial/obligations", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const items = await db.select().from(financialObligationsTable)
    .where(and(eq(financialObligationsTable.tenantId, identity.tenantId), eq(financialObligationsTable.ownerUserId, identity.userId)))
    .orderBy(desc(financialObligationsTable.createdAt)).limit(200);
  res.json({ items });
});

router.get("/financial/payments", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const items = await db.select().from(financialPaymentsTable)
    .where(and(eq(financialPaymentsTable.tenantId, identity.tenantId), eq(financialPaymentsTable.ownerUserId, identity.userId)))
    .orderBy(desc(financialPaymentsTable.occurredAt)).limit(200);
  res.json({ items });
});

router.get("/financial/donations", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const items = await db.select().from(donationsTable)
    .where(and(eq(donationsTable.tenantId, identity.tenantId), eq(donationsTable.ownerUserId, identity.userId)))
    .orderBy(desc(donationsTable.pledgedAt)).limit(200);
  res.json({ items });
});

router.get("/financial/receivables", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const items = await db.select().from(incomeReceivablesTable)
    .where(and(eq(incomeReceivablesTable.tenantId, identity.tenantId), eq(incomeReceivablesTable.ownerUserId, identity.userId)))
    .orderBy(desc(incomeReceivablesTable.createdAt)).limit(200);
  res.json({ items });
});

router.get("/financial/payment-links", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const items = await db.select().from(paymentLinksTable)
    .where(and(eq(paymentLinksTable.tenantId, identity.tenantId), eq(paymentLinksTable.ownerUserId, identity.userId)))
    .orderBy(desc(paymentLinksTable.createdAt)).limit(200);
  res.json({ items });
});

router.post("/financial/parties", (req, res) => mutate(req, res, "create_financial_party"));
router.post("/financial/obligations", (req, res) => mutate(req, res, "create_financial_obligation"));
router.post("/financial/payments", (req, res) => mutate(req, res, "create_financial_payment"));
router.post("/financial/obligations/:obligationId/settlements", (req, res) =>
  mutate(req, res, "settle_financial_obligation", { ...(req.body ?? {}), obligationId: req.params.obligationId }));
router.post("/financial/donations", (req, res) => mutate(req, res, "create_donation"));
router.post("/financial/receivables", (req, res) => mutate(req, res, "create_income_receivable"));
router.post("/financial/payment-links", (req, res) => mutate(req, res, "create_payment_link"));
router.patch("/financial/obligations/:obligationId", (req, res) =>
  mutate(req, res, "update_financial_obligation", { ...(req.body ?? {}), obligationId: req.params.obligationId }));
router.patch("/financial/payments/:paymentId", (req, res) =>
  mutate(req, res, "update_financial_payment", { ...(req.body ?? {}), paymentId: req.params.paymentId }));
router.patch("/financial/donations/:donationId", (req, res) =>
  mutate(req, res, "update_donation", { ...(req.body ?? {}), donationId: req.params.donationId }));
router.patch("/financial/receivables/:receivableId", (req, res) =>
  mutate(req, res, "update_income_receivable", { ...(req.body ?? {}), receivableId: req.params.receivableId }));

export default router;