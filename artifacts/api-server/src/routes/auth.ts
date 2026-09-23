import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  ACCESS_COOKIE,
  AuthError,
  REFRESH_COOKIE,
  authenticateAccessToken,
  getAuthUser,
  loginAuthUser,
  refreshAuthSession,
  registerAuthUser,
  revokeAuthSession,
  type IssuedSession,
} from "../lib/auth";
import { getIdentity, requestId } from "./route-context";

const router: IRouter = Router();
const credentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(12).max(256),
});
const signupSchema = credentialsSchema.extend({
  name: z.string().trim().min(1).max(120).optional(),
});

function wantsBearer(req: Request): boolean {
  return req.get("x-auth-transport") === "bearer";
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

function setSessionCookies(res: Response, session: IssuedSession): void {
  res.cookie(ACCESS_COOKIE, session.accessToken, cookieOptions(session.accessExpiresAt.getTime() - Date.now()));
  res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(session.refreshExpiresAt.getTime() - Date.now()));
}

function clearSessionCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, cookieOptions(0));
  res.clearCookie(REFRESH_COOKIE, cookieOptions(0));
}

function serializeSession(session: IssuedSession, includeTokens: boolean) {
  return {
    user: session.user,
    accessExpiresAt: session.accessExpiresAt.toISOString(),
    refreshExpiresAt: session.refreshExpiresAt.toISOString(),
    ...(includeTokens
      ? { accessToken: session.accessToken, refreshToken: session.refreshToken }
      : {}),
  };
}

function sendAuthError(req: Request, res: Response, error: unknown): void {
  const authError = error instanceof AuthError
    ? error
    : new AuthError(500, "AUTH_REQUEST_FAILED");
  res.status(authError.status).json({
    error: authError.code === "AUTH_INVALID_CREDENTIALS"
      ? "بيانات الدخول غير صحيحة."
      : "تعذر إكمال طلب تسجيل الدخول.",
    code: authError.code,
    category: authError.status === 401
      ? "authentication_error"
      : authError.status === 409
        ? "conflict_error"
        : "internal_error",
    requestId: requestId(req),
    retryable: false,
  });
}

router.post("/auth/signup", async (req, res): Promise<void> => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    sendAuthError(req, res, new AuthError(400, "AUTH_INVALID_SIGNUP"));
    return;
  }
  try {
    const session = await registerAuthUser(parsed.data);
    setSessionCookies(res, session);
    res.status(201).json(serializeSession(session, wantsBearer(req)));
  } catch (error) {
    sendAuthError(req, res, error);
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    sendAuthError(req, res, new AuthError(400, "AUTH_INVALID_LOGIN"));
    return;
  }
  try {
    const session = await loginAuthUser(parsed.data);
    setSessionCookies(res, session);
    res.json(serializeSession(session, wantsBearer(req)));
  } catch (error) {
    sendAuthError(req, res, error);
  }
});

router.post("/auth/refresh", async (req, res): Promise<void> => {
  const refreshToken = typeof req.body?.refreshToken === "string"
    ? req.body.refreshToken
    : req.cookies?.[REFRESH_COOKIE];
  try {
    const session = await refreshAuthSession(refreshToken);
    setSessionCookies(res, session);
    res.json(serializeSession(session, wantsBearer(req)));
  } catch (error) {
    clearSessionCookies(res);
    sendAuthError(req, res, error);
  }
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    res.status(401).json({
      error: "Authentication required.",
      code: "AUTHENTICATION_REQUIRED",
      category: "authentication_error",
      requestId: requestId(req),
      retryable: false,
    });
    return;
  }
  const user = await getAuthUser(identity);
  if (!user) {
    res.status(401).json({
      error: "Authentication required.",
      code: "AUTHENTICATION_REQUIRED",
      category: "authentication_error",
      requestId: requestId(req),
      retryable: false,
    });
    return;
  }
  res.json({ user });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await revokeAuthSession({
    accessToken: req.authAccessToken,
    refreshToken: typeof req.body?.refreshToken === "string"
      ? req.body.refreshToken
      : req.cookies?.[REFRESH_COOKIE],
  });
  clearSessionCookies(res);
  res.status(204).end();
});

export default router;