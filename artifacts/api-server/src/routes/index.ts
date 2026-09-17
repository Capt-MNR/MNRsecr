import { Router, type IRouter } from "express";
import healthRouter from "./health";
import secretaryRouter from "./secretary";
import conversationsRouter from "./conversations";
import recordsRouter from "./records";
import entitiesRouter from "./entities";
import financialGraphRouter from "./financial-graph";
import relationshipsRouter from "./relationships";
import pushTokensRouter from "./push-tokens";

const router: IRouter = Router();

router.use(healthRouter);
router.use(secretaryRouter);
router.use(conversationsRouter);
router.use(recordsRouter);
router.use(entitiesRouter);
router.use(financialGraphRouter);
router.use(relationshipsRouter);
router.use(pushTokensRouter);

export default router;
