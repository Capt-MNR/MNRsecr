import { Router, type IRouter } from "express";
import healthRouter from "./health";
import secretaryRouter from "./secretary";
import conversationsRouter from "./conversations";
import recordsRouter from "./records";
import entitiesRouter from "./entities";
import financialGraphRouter from "./financial-graph";
import relationshipsRouter from "./relationships";
import pushTokensRouter from "./push-tokens";
import memoriesRouter from "./memories";
import memoryCandidatesRouter from "./memory-candidates";
import agentWorkRouter from "./agent-work";
import authRouter from "./auth";
import proactivePreferencesRouter from "./proactive-preferences";
import emailRouter from "./email";
import operationsRouter from "./operations";

const router: IRouter = Router();

router.use(authRouter);
router.use(emailRouter);
router.use(operationsRouter);
router.use(proactivePreferencesRouter);
router.use(healthRouter);
router.use(secretaryRouter);
router.use(conversationsRouter);
router.use(recordsRouter);
router.use(entitiesRouter);
router.use(financialGraphRouter);
router.use(relationshipsRouter);
router.use(pushTokensRouter);
router.use(memoriesRouter);
router.use(memoryCandidatesRouter);
router.use(agentWorkRouter);

export default router;
