import { Router, type IRouter } from "express";
import healthRouter from "./health";
import secretaryRouter from "./secretary";

const router: IRouter = Router();

router.use(healthRouter);
router.use(secretaryRouter);

export default router;
