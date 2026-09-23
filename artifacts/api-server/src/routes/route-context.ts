import type { Request, Response } from "express";
import type { Identity } from "../lib/secretary";
import { authenticateAccessToken, ACCESS_COOKIE } from "../lib/auth";

export function requestId(req: Request): string {
  return String(req.id);
}

export function getIdentity(req: Request): Identity | null {
  return req.authIdentity ?? null;
}

export async function authenticateRequest(req: Request): Promise<void> {
  const authorization = req.get("authorization");
  const bearer = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
  const token = bearer ?? req.cookies?.[ACCESS_COOKIE] ?? null;
  req.authAccessToken = token;
  req.authIdentity = await authenticateAccessToken(token);
  if (!req.authIdentity
    && process.env.NODE_ENV !== "production"
    && authorization === "Bearer dev-user"
    && ["1", "true", "yes", "on"].includes(
      (process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY ?? "false").trim().toLowerCase(),
    )) {
    const tenantId = process.env.SECRETARY_TENANT_ID ?? "development";
    const userId = process.env.SECRETARY_USER_ID ?? "dev-user";
    if (tenantId.trim() && userId.trim()) req.authIdentity = { tenantId, userId };
  }
}

export function requireIdentity(req: Request, res: Response): Identity | null {
  const identity = getIdentity(req);
  if (identity) return identity;
  res.status(401).json({
    error: "Authentication required.",
    code: "AUTHENTICATION_REQUIRED",
    category: "authentication_error",
    requestId: requestId(req),
    retryable: false,
  });
  return null;
}

export function sendRouteError(
  req: Request,
  res: Response,
  status: number,
  error: string,
  code: string,
): void {
  res.status(status).json({
    error,
    code,
    category: status === 409
      ? "conflict_error"
      : status === 404
        ? "not_found"
        : status === 400
          ? "validation_error"
          : "internal_error",
    requestId: requestId(req),
    retryable: false,
  });
}