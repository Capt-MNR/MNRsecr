import { Router, type IRouter } from "express";
import {
  GetOperationalSummaryQueryParams,
  GetOperationalSummaryResponse,
} from "@workspace/api-zod";
import {
  getOperationalSummary,
  InvalidOperationalWindowError,
} from "../lib/operational-observability";
import { requireIdentity, sendRouteError } from "./route-context";

const router: IRouter = Router();

router.get("/operations/summary", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const query = GetOperationalSummaryQueryParams.safeParse(req.query);
  if (!query.success) {
    sendRouteError(req, res, 400, "حدد فترة زمنية صحيحة للتقرير.", "INVALID_OPERATIONAL_WINDOW");
    return;
  }

  try {
    const report = await getOperationalSummary(identity, query.data);
    res.json(GetOperationalSummaryResponse.parse(report));
  } catch (error) {
    if (error instanceof InvalidOperationalWindowError) {
      sendRouteError(req, res, 400, "يجب ألا تتجاوز الفترة 90 يومًا وأن يكون تاريخ البداية أسبق.", "INVALID_OPERATIONAL_WINDOW");
      return;
    }
    req.log.error({ error }, "Operational summary query failed");
    sendRouteError(req, res, 500, "تعذر تحميل التقرير التشغيلي.", "OPERATIONAL_SUMMARY_FAILED");
  }
});

export default router;