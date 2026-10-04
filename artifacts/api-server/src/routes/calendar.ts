import { Router, type IRouter } from "express";
import {
  CompleteGoogleCalendarOAuthQueryParams,
  ConnectGoogleCalendarAccountResponse,
  DisconnectGoogleCalendarAccountResponse,
  GetGoogleCalendarAccountResponse,
} from "@workspace/api-zod";
import {
  GoogleCalendarOAuthError,
  googleCalendarOAuthConfigured,
  googleCalendarOAuthService,
} from "../lib/google-calendar-oauth";
import { getIdentity, sendRouteError } from "./route-context";

const router: IRouter = Router();

router.get("/calendar/google/account", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    sendRouteError(req, res, 401, "Authentication required.", "AUTHENTICATION_REQUIRED");
    return;
  }
  try {
    const account = await googleCalendarOAuthService.account(identity);
    res.json(GetGoogleCalendarAccountResponse.parse({
      configured: googleCalendarOAuthConfigured(),
      connected: Boolean(account),
      emailAddress: account?.emailAddress ?? null,
      grantedScopes: account?.grantedScopes ?? [],
    }));
  } catch {
    req.log.error("Google Calendar account status lookup failed");
    sendRouteError(
      req,
      res,
      500,
      "تعذر فحص اتصال التقويم.",
      "GOOGLE_CALENDAR_STATUS_FAILED",
    );
  }
});

router.post("/calendar/google/connect", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    sendRouteError(req, res, 401, "Authentication required.", "AUTHENTICATION_REQUIRED");
    return;
  }
  if (!googleCalendarOAuthConfigured()) {
    sendRouteError(
      req,
      res,
      503,
      "اتصال Google Calendar غير مفعّل في هذه البيئة.",
      "GOOGLE_CALENDAR_NOT_CONFIGURED",
    );
    return;
  }
  try {
    const authorizationUrl = await googleCalendarOAuthService.start(identity);
    res.json(ConnectGoogleCalendarAccountResponse.parse({ authorizationUrl }));
  } catch (error) {
    const code = error instanceof GoogleCalendarOAuthError
      ? error.code
      : "GOOGLE_CALENDAR_CONNECT_FAILED";
    req.log.error({ code }, "Google Calendar OAuth start failed");
    sendRouteError(req, res, 500, "تعذر بدء ربط Google Calendar.", code);
  }
});

router.get("/calendar/google/oauth/callback", async (req, res): Promise<void> => {
  const parsed = CompleteGoogleCalendarOAuthQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.redirect(303, "/email?calendar_connection=error");
    return;
  }
  if (parsed.data.error) {
    const state = parsed.data.state;
    if (!state) {
      res.redirect(303, "/email?calendar_connection=error");
      return;
    }
    try {
      await googleCalendarOAuthService.cancel(state);
      res.redirect(303, "/email?calendar_connection=cancelled");
    } catch (error) {
      const code = error instanceof GoogleCalendarOAuthError
        ? error.code
        : "GOOGLE_CALENDAR_OAUTH_CANCEL_FAILED";
      req.log.warn({ code }, "Google Calendar OAuth cancellation failed");
      res.redirect(303, "/email?calendar_connection=error");
    }
    return;
  }
  const code = parsed.data.code;
  const state = parsed.data.state;
  if (!code || !state) {
    res.redirect(303, "/email?calendar_connection=error");
    return;
  }
  try {
    await googleCalendarOAuthService.complete(code, state);
    res.redirect(303, "/email?calendar_connection=connected");
  } catch (error) {
    const code = error instanceof GoogleCalendarOAuthError
      ? error.code
      : "GOOGLE_CALENDAR_OAUTH_CALLBACK_FAILED";
    req.log.warn({ code }, "Google Calendar OAuth callback failed");
    res.redirect(303, "/email?calendar_connection=error");
  }
});

router.delete("/calendar/google/account", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    sendRouteError(req, res, 401, "Authentication required.", "AUTHENTICATION_REQUIRED");
    return;
  }
  try {
    const result = await googleCalendarOAuthService.disconnect(identity);
    res.json(DisconnectGoogleCalendarAccountResponse.parse({
      disconnected: true,
      revoked: result.revoked,
    }));
  } catch {
    req.log.error("Google Calendar account disconnect failed");
    sendRouteError(
      req,
      res,
      500,
      "تعذر إزالة اتصال Google Calendar.",
      "GOOGLE_CALENDAR_DISCONNECT_FAILED",
    );
  }
});

export default router;