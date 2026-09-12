import { Router, type IRouter } from "express";
import healthRouter from "./health";
import secretaryRouter from "./secretary";
import conversationsRouter from "./conversations";
import recordsRouter from "./records";

const router: IRouter = Router();

router.use(healthRouter);
router.use(secretaryRouter);
router.use(conversationsRouter);
router.use(recordsRouter);

export default router;
