import { Router, type IRouter } from "express";
import {
  RegisterMobilePushTokenBody,
  RegisterMobilePushTokenResponse,
  UnregisterMobilePushTokenBody,
  UnregisterMobilePushTokenResponse,
} from "@workspace/api-zod";
import {
  disableMobilePushToken,
  registerMobilePushToken,
} from "../lib/mobile-push";
import { getIdentity, sendRouteError } from "./route-context";

const router: IRouter = Router();

router.post("/push-tokens", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    sendRouteError(req, res, 401, "Authentication required.", "AUTHENTICATION_REQUIRED");
    return;
  }
  const parsed = RegisterMobilePushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    sendRouteError(req, res, 400, "بيانات الإشعارات غير صالحة.", "INVALID_PUSH_TOKEN");
    return;
  }

  try {
    await registerMobilePushToken(identity, parsed.data);
    res.json(RegisterMobilePushTokenResponse.parse({ registered: true, enabled: true }));
  } catch (error) {
    req.log.error({ error }, "Push token registration failed");
    sendRouteError(req, res, 500, "تعذر تسجيل الإشعارات.", "PUSH_TOKEN_REGISTRATION_FAILED");
  }
});

router.delete("/push-tokens", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    sendRouteError(req, res, 401, "Authentication required.", "AUTHENTICATION_REQUIRED");
    return;
  }
  const parsed = UnregisterMobilePushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    sendRouteError(req, res, 400, "بيانات الإشعارات غير صالحة.", "INVALID_PUSH_TOKEN");
    return;
  }

  try {
    const enabled = !(await disableMobilePushToken(identity, parsed.data.token));
    res.json(UnregisterMobilePushTokenResponse.parse({ registered: true, enabled }));
  } catch (error) {
    req.log.error({ error }, "Push token disable failed");
    sendRouteError(req, res, 500, "تعذر إيقاف الإشعارات.", "PUSH_TOKEN_DISABLE_FAILED");
  }
});

export default router;