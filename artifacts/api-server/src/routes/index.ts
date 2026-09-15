import { Router, type IRouter } from "express";
import healthRouter from "./health";
import secretaryRouter from "./secretary";
import conversationsRouter from "./conversations";
import recordsRouter from "./records";
import entitiesRouter from "./entities";
import financialGraphRouter from "./financial-graph";

const router: IRouter = Router();

router.use(healthRouter);
router.use(secretaryRouter);
router.use(conversationsRouter);
router.use(recordsRouter);
router.use(entitiesRouter);
router.use(financialGraphRouter);

export default router;
