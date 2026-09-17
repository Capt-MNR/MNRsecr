import { and, eq } from "drizzle-orm";
import {
  db,
  mobilePushTokensTable,
  type MobilePushToken,
} from "@workspace/db";
import type { Identity } from "./secretary";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type MobilePushNotification = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export async function registerMobilePushToken(
  identity: Identity,
  input: {
    token: string;
    provider: "expo" | "fcm" | "apns";
    platform: "android" | "ios";
    appId: string;
    deviceId?: string | null;
  },
): Promise<MobilePushToken> {
  const existing = await db.select().from(mobilePushTokensTable).where(and(
    eq(mobilePushTokensTable.tenantId, identity.tenantId),
    eq(mobilePushTokensTable.ownerUserId, identity.userId),
    eq(mobilePushTokensTable.token, input.token),
  )).limit(1);

  if (existing[0]) {
    const [updated] = await db.update(mobilePushTokensTable)
      .set({
        provider: input.provider,
        platform: input.platform,
        appId: input.appId,
        deviceId: input.deviceId ?? null,
        enabled: 1,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(mobilePushTokensTable.id, existing[0].id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(mobilePushTokensTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    token: input.token,
    provider: input.provider,
    platform: input.platform,
    appId: input.appId,
    deviceId: input.deviceId ?? null,
  }).returning();
  return created;
}

export async function disableMobilePushToken(identity: Identity, token: string): Promise<boolean> {
  const result = await db.update(mobilePushTokensTable)
    .set({ enabled: 0, updatedAt: new Date() })
    .where(and(
      eq(mobilePushTokensTable.tenantId, identity.tenantId),
      eq(mobilePushTokensTable.ownerUserId, identity.userId),
      eq(mobilePushTokensTable.token, token),
    ));
  return (result.rowCount ?? 0) > 0;
}

async function disableInvalidToken(token: MobilePushToken): Promise<void> {
  await db.update(mobilePushTokensTable)
    .set({ enabled: 0, updatedAt: new Date() })
    .where(eq(mobilePushTokensTable.id, token.id));
}

/**
 * Expo's push gateway hands delivery to FCM on Android and APNs on iOS.
 * Keeping the gateway here avoids putting provider credentials in the mobile
 * bundle while retaining a single server-owned delivery boundary.
 */
export async function dispatchMobilePush(
  identity: Identity,
  notification: MobilePushNotification,
): Promise<void> {
  const tokens = await db.select().from(mobilePushTokensTable).where(and(
    eq(mobilePushTokensTable.tenantId, identity.tenantId),
    eq(mobilePushTokensTable.ownerUserId, identity.userId),
    eq(mobilePushTokensTable.enabled, 1),
  ));

  await Promise.all(tokens.map(async (token) => {
    if (token.provider !== "expo") return;
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: token.token,
        title: notification.title,
        body: notification.body,
        data: notification.data ?? {},
        sound: "default",
        channelId: "secretary-events",
      }),
    });
    if (!response.ok) {
      throw new Error(`Expo push gateway returned ${response.status}.`);
    }
    const payload = await response.json() as {
      data?: { status?: string; details?: { error?: string } };
    };
    if (payload.data?.details?.error === "DeviceNotRegistered") {
      await disableInvalidToken(token);
    }
  }));
}