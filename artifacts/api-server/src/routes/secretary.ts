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
import {
  classifySecretaryError,
  errorLogFields,
  SecretaryError,
} from "../lib/error-contract";

const router: IRouter = Router();

function getIdentity(req: Request): Identity | null {
  const authorization = req.get("authorization");
  if (authorization !== "Bearer dev-user") return null;
  return {
    tenantId: process.env.SECRETARY_TENANT_ID ?? "development",
    userId: process.env.SECRETARY_USER_ID ?? "dev-user",
  };
}

function requestId(req: Request): string {
  return String(req.id);
}

function sendError(
  req: Request,
  res: any,
  error: unknown,
  logLevel: "warn" | "error" = "error",
  providerOverride?: string,
): void {
  const classified = classifySecretaryError(error);
  const provider = classified.provider ?? providerOverride;
  const fields = {
    requestId: requestId(req),
    httpStatus: classified.status,
    ...errorLogFields(classified),
  };
  if (logLevel === "warn") {
    req.log.warn(fields, "Secretary request rejected");
  } else {
    req.log.error(fields, "Secretary request failed");
  }
  res.status(classified.status).json({
    error: "تعذر إكمال طلب السكرتير.",
    code: classified.code,
    category: classified.category,
    requestId: requestId(req),
    retryable: classified.retryable,
    ...(provider ? { provider } : {}),
  });
}

router.get("/today", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    sendError(req, res, new SecretaryError("Authentication required.", {
      status: 401,
      category: "authentication_error",
      code: "AUTHENTICATION_REQUIRED",
      retryable: false,
    }), "warn");
    return;
  }

  try {
    const context = await persistence.getTodayContext(identity);
    res.json(GetTodayContextResponse.parse({ context }));
  } catch (error) {
    sendError(req, res, error);
  }
});

router.post("/turns", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    sendError(req, res, new SecretaryError("Authentication required.", {
      status: 401,
      category: "authentication_error",
      code: "AUTHENTICATION_REQUIRED",
      retryable: false,
    }), "warn");
    return;
  }

  const parsed = CreateTurnBody.safeParse(req.body);
  if (!parsed.success) {
    sendError(req, res, new SecretaryError("Invalid turn body.", {
      status: 400,
      category: "validation_error",
      code: "INVALID_TURN_BODY",
      retryable: false,
      cause: parsed.error,
    }), "warn");
    return;
  }

  try {
    const result = await agentRuntime.run(identity, parsed.data);
    res.json(CreateTurnResponse.parse(result));
  } catch (error) {
    const classified = classifySecretaryError(error);
    const provider = configuredProvider() === "unavailable" ? undefined : configuredProvider();
    sendError(req, res, classified, "error", provider);
  }
});

export default router;