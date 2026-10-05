import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  ExchangeAuthOAuthTicketBody,
  GetAuthOAuthLinkedProvidersResponse,
  StartAuthOAuthBody,
  UnlinkAuthOAuthProviderBody,
  UnlinkAuthOAuthProviderParams,
} from "@workspace/api-zod";
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
import { checkAuthAbuse } from "../lib/auth-abuse";
import {
  completeExternalOAuthCallback,
  exchangeExternalOAuthTicket,
  getLinkedAuthProviders,
  startExternalOAuth,
  unlinkExternalAuthProvider,
  type AuthProvider,
} from "../lib/external-auth-oauth";
import { getIdentity, requestId, requireIdentity } from "./route-context";

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

function sendAuthRateLimit(req: Request, res: Response, retryAfterSeconds: number): void {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.status(429).json({
    error: "تعذر إكمال طلب المصادقة الآن. حاول لاحقًا.",
    code: "AUTH_RATE_LIMITED",
    category: "rate_limit",
    requestId: requestId(req),
    retryable: true,
  });
}

function queryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function handleExternalOAuthCallback(
  provider: AuthProvider,
  req: Request,
  res: Response,
): Promise<void> {
  const state = queryString(req.query.state);
  if (!state) {
    res.redirect(302, "/?authError=oauth_failed");
    return;
  }
  try {
    const result = await completeExternalOAuthCallback({
      provider,
      state,
      code: queryString(req.query.code),
      providerError: queryString(req.query.error),
    });
    if (result.session) setSessionCookies(res, result.session);
    res.redirect(302, result.redirectUrl);
  } catch (error) {
    const code = error instanceof AuthError ? error.code : "AUTH_OAUTH_CALLBACK_FAILED";
    req.log.warn({ provider, code }, "External sign-in callback failed");
    res.redirect(302, "/?authError=oauth_failed");
  }
}

router.post("/auth/signup", async (req, res): Promise<void> => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    sendAuthError(req, res, new AuthError(400, "AUTH_INVALID_SIGNUP"));
    return;
  }
  const abuse = checkAuthAbuse({
    kind: "signup",
    ip: req.ip || req.socket.remoteAddress || "unknown",
    identity: parsed.data.email,
  });
  if (!abuse.allowed) {
    sendAuthRateLimit(req, res, abuse.retryAfterSeconds);
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
  const abuse = checkAuthAbuse({
    kind: "login",
    ip: req.ip || req.socket.remoteAddress || "unknown",
    identity: parsed.data.email,
  });
  if (!abuse.allowed) {
    sendAuthRateLimit(req, res, abuse.retryAfterSeconds);
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
  const abuse = checkAuthAbuse({
    kind: "refresh",
    ip: req.ip || req.socket.remoteAddress || "unknown",
    identity: refreshToken,
  });
  if (!abuse.allowed) {
    sendAuthRateLimit(req, res, abuse.retryAfterSeconds);
    return;
  }
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

router.post("/auth/oauth/start", async (req, res): Promise<void> => {
  const parsed = StartAuthOAuthBody.safeParse(req.body);
  if (!parsed.success) {
    sendAuthError(req, res, new AuthError(400, "AUTH_OAUTH_REQUEST_INVALID"));
    return;
  }
  const abuse = checkAuthAbuse({
    kind: "login",
    ip: req.ip || req.socket.remoteAddress || "unknown",
    identity: `oauth:${parsed.data.provider}:${parsed.data.mode}`,
  });
  if (!abuse.allowed) {
    sendAuthRateLimit(req, res, abuse.retryAfterSeconds);
    return;
  }
  try {
    const authorizationUrl = await startExternalOAuth({
      provider: parsed.data.provider,
      mode: parsed.data.mode,
      client: parsed.data.client,
      currentPassword: parsed.data.currentPassword,
      returnTo: parsed.data.returnTo,
      identity: getIdentity(req),
    });
    res.json({ authorizationUrl });
  } catch (error) {
    sendAuthError(req, res, error);
  }
});

router.get("/auth/oauth/linked", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  try {
    const providers = await getLinkedAuthProviders(identity);
    res.json(GetAuthOAuthLinkedProvidersResponse.parse({ providers }));
  } catch (error) {
    sendAuthError(req, res, error);
  }
});

router.delete("/auth/oauth/linked/:provider", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const parsedParams = UnlinkAuthOAuthProviderParams.safeParse(req.params);
  const parsedBody = UnlinkAuthOAuthProviderBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    sendAuthError(req, res, new AuthError(400, "AUTH_OAUTH_REQUEST_INVALID"));
    return;
  }
  try {
    await unlinkExternalAuthProvider({
      identity,
      provider: parsedParams.data.provider,
      currentPassword: parsedBody.data.currentPassword,
    });
    res.status(204).end();
  } catch (error) {
    sendAuthError(req, res, error);
  }
});

router.post("/auth/oauth/ticket/exchange", async (req, res): Promise<void> => {
  const parsed = ExchangeAuthOAuthTicketBody.safeParse(req.body);
  if (!parsed.success) {
    sendAuthError(req, res, new AuthError(401, "AUTH_OAUTH_TICKET_INVALID"));
    return;
  }
  try {
    const session = await exchangeExternalOAuthTicket(parsed.data.ticket);
    setSessionCookies(res, session);
    res.json(serializeSession(session, wantsBearer(req)));
  } catch (error) {
    sendAuthError(req, res, error);
  }
});

router.get("/auth/oauth/google/callback", async (req, res): Promise<void> => {
  await handleExternalOAuthCallback("google", req, res);
});

router.get("/auth/oauth/microsoft/callback", async (req, res): Promise<void> => {
  await handleExternalOAuthCallback("microsoft", req, res);
});

export default router;