import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import {
  db,
  googleCalendarConnectionsTable,
  googleCalendarOAuthStatesTable,
} from "@workspace/db";
import type { AgentWorkIdentity } from "./agent-work/types";
import {
  decryptEmailToken,
  encryptEmailToken,
  isEmailTokenEncryptionKeyConfigured,
} from "./email-token-crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export type GoogleCalendarOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEncryptionKey: string;
};

export function getGoogleCalendarOAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): GoogleCalendarOAuthConfig | null {
  if (env.NODE_ENV === "production" || env.GOOGLE_CALENDAR_ENABLED !== "true") return null;
  const clientId = env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_CALENDAR_REDIRECT_URI?.trim();
  const tokenEncryptionKey = env.EMAIL_TOKEN_ENCRYPTION_KEY?.trim();
  if (!clientId || !clientSecret || !redirectUri || !tokenEncryptionKey
    || !isEmailTokenEncryptionKeyConfigured(tokenEncryptionKey)) {
    return null;
  }
  try {
    const parsedRedirect = new URL(redirectUri);
    if (!["http:", "https:"].includes(parsedRedirect.protocol)) return null;
  } catch {
    return null;
  }
  return { clientId, clientSecret, redirectUri, tokenEncryptionKey };
}

export function googleCalendarOAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getGoogleCalendarOAuthConfig(env) !== null;
}

export class GoogleCalendarOAuthError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GoogleCalendarOAuthError";
  }
}

export function buildGoogleCalendarAuthorizationUrl(
  config: GoogleCalendarOAuthConfig,
  state: string,
  codeChallenge: string,
): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

type GoogleTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  scope?: unknown;
};

type GoogleUserInfo = {
  email?: unknown;
  email_verified?: unknown;
};

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stateDigest(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function connectionPredicate(identity: AgentWorkIdentity) {
  return and(
    eq(googleCalendarConnectionsTable.tenantId, identity.tenantId),
    eq(googleCalendarConnectionsTable.ownerUserId, identity.userId),
  );
}

function scopeList(value: unknown): string[] {
  return typeof value === "string"
    ? [...new Set(value.split(/\s+/u).map((scope) => scope.trim()).filter(Boolean))].sort()
    : [];
}

async function consumeOAuthState(state: string) {
  if (!/^[A-Za-z0-9._~-]{20,512}$/u.test(state)) return null;
  const now = new Date();
  const [oauthState] = await db.update(googleCalendarOAuthStatesTable)
    .set({ consumedAt: now })
    .where(and(
      eq(googleCalendarOAuthStatesTable.stateHash, stateDigest(state)),
      isNull(googleCalendarOAuthStatesTable.consumedAt),
      gt(googleCalendarOAuthStatesTable.expiresAt, now),
    ))
    .returning();
  return oauthState ?? null;
}

export const googleCalendarOAuthService = {
  async start(identity: AgentWorkIdentity): Promise<string> {
    const config = getGoogleCalendarOAuthConfig();
    if (!config) throw new GoogleCalendarOAuthError("GOOGLE_CALENDAR_NOT_CONFIGURED");

    await db.delete(googleCalendarOAuthStatesTable)
      .where(lt(googleCalendarOAuthStatesTable.expiresAt, new Date()));
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    await db.insert(googleCalendarOAuthStatesTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      stateHash: stateDigest(state),
      codeVerifierCiphertext: encryptEmailToken(codeVerifier, config.tokenEncryptionKey),
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    });
    return buildGoogleCalendarAuthorizationUrl(config, state, codeChallenge);
  },

  async complete(code: string, state: string): Promise<void> {
    const config = getGoogleCalendarOAuthConfig();
    if (!config) throw new GoogleCalendarOAuthError("GOOGLE_CALENDAR_NOT_CONFIGURED");
    if (!code || code.length > 4096) {
      throw new GoogleCalendarOAuthError("GOOGLE_CALENDAR_OAUTH_STATE_INVALID");
    }

    const oauthState = await consumeOAuthState(state);
    if (!oauthState) throw new GoogleCalendarOAuthError("GOOGLE_CALENDAR_OAUTH_STATE_INVALID");

    const codeVerifier = decryptEmailToken(
      oauthState.codeVerifierCiphertext,
      config.tokenEncryptionKey,
    );
    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new GoogleCalendarOAuthError("GOOGLE_CALENDAR_OAUTH_EXCHANGE_UNAVAILABLE");
    }
    const token = await responseJson(tokenResponse) as GoogleTokenResponse;
    if (!tokenResponse.ok || typeof token.access_token !== "string"
      || token.token_type !== "Bearer") {
      throw new GoogleCalendarOAuthError("GOOGLE_CALENDAR_OAUTH_EXCHANGE_REJECTED");
    }
    const grantedScopes = scopeList(token.scope);
    if (!GOOGLE_CALENDAR_SCOPES.every((scope) => grantedScopes.includes(scope))) {
      throw new GoogleCalendarOAuthError("GOOGLE_CALENDAR_REQUIRED_SCOPE_MISSING");
    }

    let userInfoResponse: Response;
    try {
      userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new GoogleCalendarOAuthError("GOOGLE_CALENDAR_ACCOUNT_LOOKUP_UNAVAILABLE");
    }
    const userInfo = await responseJson(userInfoResponse) as GoogleUserInfo;
    const emailAddress = typeof userInfo.email === "string"
      ? userInfo.email.trim().toLowerCase()
      : "";
    if (!userInfoResponse.ok || userInfo.email_verified !== true
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(emailAddress)) {
      throw new GoogleCalendarOAuthError("GOOGLE_CALENDAR_ACCOUNT_LOOKUP_REJECTED");
    }

    const identity = { tenantId: oauthState.tenantId, userId: oauthState.ownerUserId };
    const [existing] = await db.select()
      .from(googleCalendarConnectionsTable)
      .where(connectionPredicate(identity))
      .limit(1);
    const refreshToken = typeof token.refresh_token === "string" && token.refresh_token.length > 0
      ? token.refresh_token
      : existing?.emailAddress === emailAddress
        ? decryptEmailToken(existing.refreshTokenCiphertext, config.tokenEncryptionKey)
        : null;
    if (!refreshToken) {
      throw new GoogleCalendarOAuthError("GOOGLE_CALENDAR_REFRESH_TOKEN_MISSING");
    }

    await db.insert(googleCalendarConnectionsTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      emailAddress,
      grantedScopes,
      refreshTokenCiphertext: encryptEmailToken(refreshToken, config.tokenEncryptionKey),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [
        googleCalendarConnectionsTable.tenantId,
        googleCalendarConnectionsTable.ownerUserId,
      ],
      set: {
        emailAddress,
        grantedScopes,
        refreshTokenCiphertext: encryptEmailToken(refreshToken, config.tokenEncryptionKey),
        updatedAt: new Date(),
      },
    });
  },

  async cancel(state: string): Promise<void> {
    const oauthState = await consumeOAuthState(state);
    if (!oauthState) throw new GoogleCalendarOAuthError("GOOGLE_CALENDAR_OAUTH_STATE_INVALID");
  },

  async account(identity: AgentWorkIdentity): Promise<{
    emailAddress: string;
    grantedScopes: string[];
  } | null> {
    const [connection] = await db.select({
      emailAddress: googleCalendarConnectionsTable.emailAddress,
      grantedScopes: googleCalendarConnectionsTable.grantedScopes,
    })
      .from(googleCalendarConnectionsTable)
      .where(connectionPredicate(identity))
      .limit(1);
    return connection ?? null;
  },

  async disconnect(identity: AgentWorkIdentity): Promise<{ revoked: boolean }> {
    const config = getGoogleCalendarOAuthConfig();
    const [connection] = await db.select()
      .from(googleCalendarConnectionsTable)
      .where(connectionPredicate(identity))
      .limit(1);
    let revoked = !connection;
    if (connection && config) {
      try {
        const refreshToken = decryptEmailToken(
          connection.refreshTokenCiphertext,
          config.tokenEncryptionKey,
        );
        const response = await fetch(GOOGLE_REVOKE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: refreshToken }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        revoked = response.ok;
      } catch {
        revoked = false;
      }
    }
    await db.delete(googleCalendarConnectionsTable).where(connectionPredicate(identity));
    await db.delete(googleCalendarOAuthStatesTable).where(and(
      eq(googleCalendarOAuthStatesTable.tenantId, identity.tenantId),
      eq(googleCalendarOAuthStatesTable.ownerUserId, identity.userId),
    ));
    return { revoked };
  },

  async accessToken(identity: AgentWorkIdentity): Promise<string> {
    const config = getGoogleCalendarOAuthConfig();
    if (!config) throw new Error("GOOGLE_CALENDAR_NOT_CONFIGURED");
    const [connection] = await db.select()
      .from(googleCalendarConnectionsTable)
      .where(connectionPredicate(identity))
      .limit(1);
    if (!connection) throw new Error("GOOGLE_CALENDAR_ACCOUNT_NOT_CONNECTED");

    const refreshToken = decryptEmailToken(
      connection.refreshTokenCiphertext,
      config.tokenEncryptionKey,
    );
    let response: Response;
    try {
      response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error("GOOGLE_CALENDAR_TOKEN_REFRESH_UNAVAILABLE");
    }
    const token = await responseJson(response);
    if (!response.ok || typeof token.access_token !== "string"
      || token.token_type !== "Bearer") {
      throw new Error(response.status === 400 || response.status === 401
        ? "GOOGLE_CALENDAR_REAUTH_REQUIRED"
        : "GOOGLE_CALENDAR_TOKEN_REFRESH_FAILED");
    }
    if (typeof token.refresh_token === "string" && token.refresh_token.length > 0) {
      await db.update(googleCalendarConnectionsTable)
        .set({
          refreshTokenCiphertext: encryptEmailToken(
            token.refresh_token,
            config.tokenEncryptionKey,
          ),
          updatedAt: new Date(),
        })
        .where(and(
          eq(googleCalendarConnectionsTable.id, connection.id),
          connectionPredicate(identity),
        ));
    }
    return token.access_token;
  },
};