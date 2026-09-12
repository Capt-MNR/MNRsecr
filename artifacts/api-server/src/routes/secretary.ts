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
import { configuredProvider } from "../lib/phase2";

const router: IRouter = Router();

function getIdentity(req: Request): Identity | null {
  const authorization = req.get("authorization");
  if (authorization !== "Bearer dev-user") return null;
  return {
    tenantId: process.env.SECRETARY_TENANT_ID ?? "development",
    userId: process.env.SECRETARY_USER_ID ?? "dev-user",
  };
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
      error: "The configured LLM provider is unavailable. Check its server-side configuration and try again.",
      code: "LLM_PROVIDER_UNAVAILABLE",
      provider: configuredProvider() === "unavailable" ? null : configuredProvider(),
    });
  }
});

export default router;