import type { Request, Response } from "express";
import type { Identity } from "../lib/secretary";

export function requestId(req: Request): string {
  return String(req.id);
}

export function getIdentity(req: Request): Identity | null {
  if (req.get("authorization") !== "Bearer dev-user") return null;
  return {
    tenantId: process.env.SECRETARY_TENANT_ID ?? "development",
    userId: process.env.SECRETARY_USER_ID ?? "dev-user",
  };
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
    category: status === 404 ? "not_found" : status === 400 ? "validation_error" : "internal_error",
    requestId: requestId(req),
    retryable: false,
  });
}