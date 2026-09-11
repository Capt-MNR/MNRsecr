import { Router, type IRouter, type Request } from "express";
import {
  CreateTurnBody,
  CreateTurnResponse,
  GetTodayContextResponse,
} from "@workspace/api-zod";
import {
  agentRuntime,
  persistence,
  type Identity,
} from "../lib/secretary";

const router: IRouter = Router();

function getIdentity(req: Request): Identity | null {
  const authorization = req.get("authorization");
  if (authorization !== "Bearer dev-user") return null;
  return { tenantId: "development", userId: "dev-user" };
}

router.get("/today", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const context = await persistence.getTodayContext(identity);
  res.json(GetTodayContextResponse.parse({ context }));
});

router.post("/turns", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const parsed = CreateTurnBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid turn body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result = await agentRuntime.run(identity, parsed.data);
    res.json(CreateTurnResponse.parse(result));
  } catch (error) {
    req.log.error({ err: error }, "Secretary turn failed");
    res.status(503).json({
      error: "The secretary could not complete this request. Review saved context before retrying.",
    });
  }
});

export default router;