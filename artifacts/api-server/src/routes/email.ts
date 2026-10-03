import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  ConnectGmailEmailAccountResponse,
  GetGmailEmailAccountResponse,
} from "@workspace/api-zod";
import {
  GmailOAuthError,
  gmailOAuthConfigured,
  gmailOAuthService,
} from "../lib/gmail-oauth";
import { getIdentity, sendRouteError } from "./route-context";

const router: IRouter = Router();

const gmailOAuthCallbackQuerySchema = z.object({
  code: z.string().max(4096).optional(),
  state: z.string().max(128).optional(),
  error: z.string().max(128).optional(),
});

router.get("/email/gmail/account", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    sendRouteError(req, res, 401, "Authentication required.", "AUTHENTICATION_REQUIRED");
    return;
  }
  try {
    const account = await gmailOAuthService.account(identity);
    res.json(GetGmailEmailAccountResponse.parse({
      configured: gmailOAuthConfigured(),
      connected: Boolean(account),
      emailAddress: account?.emailAddress ?? null,
    }));
  } catch {
    req.log.error("Gmail account status lookup failed");
    sendRouteError(req, res, 500, "تعذر فحص اتصال البريد.", "EMAIL_GMAIL_STATUS_FAILED");
  }
});

router.post("/email/gmail/connect", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    sendRouteError(req, res, 401, "Authentication required.", "AUTHENTICATION_REQUIRED");
    return;
  }
  if (!gmailOAuthConfigured()) {
    sendRouteError(req, res, 503, "اتصال Gmail غير مفعّل في هذه البيئة.", "EMAIL_GMAIL_NOT_CONFIGURED");
    return;
  }
  try {
    const authorizationUrl = await gmailOAuthService.start(identity);
    res.json(ConnectGmailEmailAccountResponse.parse({ authorizationUrl }));
  } catch (error) {
    const code = error instanceof GmailOAuthError ? error.code : "EMAIL_GMAIL_CONNECT_FAILED";
    req.log.error({ code }, "Gmail OAuth start failed");
    sendRouteError(req, res, 500, "تعذر بدء ربط Gmail.", code);
  }
});

router.get("/email/gmail/oauth/callback", async (req, res): Promise<void> => {
  const parsed = gmailOAuthCallbackQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.redirect(303, "/email?email_connection=error");
    return;
  }
  if (parsed.data.error) {
    res.redirect(303, "/email?email_connection=cancelled");
    return;
  }
  const code = parsed.data.code;
  const state = parsed.data.state;
  if (!code || !state) {
    res.redirect(303, "/email?email_connection=error");
    return;
  }
  try {
    await gmailOAuthService.complete(code, state);
    res.redirect(303, "/email?email_connection=connected");
  } catch (error) {
    const codeName = error instanceof GmailOAuthError ? error.code : "EMAIL_GMAIL_OAUTH_CALLBACK_FAILED";
    req.log.warn({ code: codeName }, "Gmail OAuth callback failed");
    res.redirect(303, "/email?email_connection=error");
  }
});

router.delete("/email/gmail/account", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    sendRouteError(req, res, 401, "Authentication required.", "AUTHENTICATION_REQUIRED");
    return;
  }
  try {
    await gmailOAuthService.disconnect(identity);
    res.sendStatus(204);
  } catch {
    req.log.error("Gmail account disconnect failed");
    sendRouteError(req, res, 500, "تعذر إزالة اتصال البريد.", "EMAIL_GMAIL_DISCONNECT_FAILED");
  }
});

export default router;