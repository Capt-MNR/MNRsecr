import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import {
  db,
  emailConnectionsTable,
  emailOAuthStatesTable,
} from "@workspace/db";
import type { AgentWorkIdentity } from "./agent-work/types";
import { decryptEmailToken, encryptEmailToken, isEmailTokenEncryptionKeyConfigured } from "./email-token-crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

export type GmailOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEncryptionKey: string;
};

export function getGmailOAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): GmailOAuthConfig | null {
  if (env.NODE_ENV === "production" || env.EMAIL_GMAIL_ENABLED !== "true") return null;
  const clientId = env.EMAIL_GMAIL_CLIENT_ID?.trim();
  const clientSecret = env.EMAIL_GMAIL_CLIENT_SECRET?.trim();
  const redirectUri = env.EMAIL_GMAIL_REDIRECT_URI?.trim();
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

export function gmailOAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getGmailOAuthConfig(env) !== null;
}

export class GmailOAuthError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GmailOAuthError";
  }
}

export function buildGmailAuthorizationUrl(
  config: GmailOAuthConfig,
  state: string,
  codeChallenge: string,
): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OAUTH_SCOPES);
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

function identityPredicate(identity: AgentWorkIdentity) {
  return and(
    eq(emailConnectionsTable.tenantId, identity.tenantId),
    eq(emailConnectionsTable.ownerUserId, identity.userId),
    eq(emailConnectionsTable.provider, "gmail"),
  );
}

export const gmailOAuthService = {
  async start(identity: AgentWorkIdentity): Promise<string> {
    const config = getGmailOAuthConfig();
    if (!config) throw new GmailOAuthError("EMAIL_GMAIL_NOT_CONFIGURED");

    await db.delete(emailOAuthStatesTable)
      .where(lt(emailOAuthStatesTable.expiresAt, new Date()));
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    await db.insert(emailOAuthStatesTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      stateHash: stateDigest(state),
      codeVerifierCiphertext: encryptEmailToken(codeVerifier, config.tokenEncryptionKey),
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    });
    return buildGmailAuthorizationUrl(config, state, codeChallenge);
  },

  async complete(code: string, state: string): Promise<void> {
    const config = getGmailOAuthConfig();
    if (!config) throw new GmailOAuthError("EMAIL_GMAIL_NOT_CONFIGURED");
    if (!code || code.length > 4096 || !/^[A-Za-z0-9._~-]{20,512}$/u.test(state)) {
      throw new GmailOAuthError("EMAIL_GMAIL_OAUTH_STATE_INVALID");
    }

    const now = new Date();
    const [oauthState] = await db.update(emailOAuthStatesTable)
      .set({ consumedAt: now })
      .where(and(
        eq(emailOAuthStatesTable.stateHash, stateDigest(state)),
        isNull(emailOAuthStatesTable.consumedAt),
        gt(emailOAuthStatesTable.expiresAt, now),
      ))
      .returning();
    if (!oauthState) throw new GmailOAuthError("EMAIL_GMAIL_OAUTH_STATE_INVALID");

    const codeVerifier = decryptEmailToken(
      oauthState.codeVerifierCiphertext,
      config.tokenEncryptionKey,
    );
    const tokenBody = new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    });
    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new GmailOAuthError("EMAIL_GMAIL_OAUTH_EXCHANGE_UNAVAILABLE");
    }
    const token = await responseJson(tokenResponse) as GoogleTokenResponse;
    if (!tokenResponse.ok
      || typeof token.access_token !== "string"
      || token.token_type !== "Bearer") {
      throw new GmailOAuthError("EMAIL_GMAIL_OAUTH_EXCHANGE_REJECTED");
    }

    let userInfoResponse: Response;
    try {
      userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new GmailOAuthError("EMAIL_GMAIL_ACCOUNT_LOOKUP_UNAVAILABLE");
    }
    const userInfo = await responseJson(userInfoResponse) as GoogleUserInfo;
    const emailAddress = typeof userInfo.email === "string"
      ? userInfo.email.trim().toLowerCase()
      : "";
    if (!userInfoResponse.ok
      || userInfo.email_verified !== true
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(emailAddress)) {
      throw new GmailOAuthError("EMAIL_GMAIL_ACCOUNT_LOOKUP_REJECTED");
    }

    const identity = {
      tenantId: oauthState.tenantId,
      userId: oauthState.ownerUserId,
    };
    const [existing] = await db.select()
      .from(emailConnectionsTable)
      .where(identityPredicate(identity))
      .limit(1);
    const refreshToken = typeof token.refresh_token === "string" && token.refresh_token.length > 0
      ? token.refresh_token
      : existing?.emailAddress === emailAddress
        ? decryptEmailToken(existing.refreshTokenCiphertext, config.tokenEncryptionKey)
        : null;
    if (!refreshToken) throw new GmailOAuthError("EMAIL_GMAIL_REFRESH_TOKEN_MISSING");

    await db.insert(emailConnectionsTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      provider: "gmail",
      emailAddress,
      refreshTokenCiphertext: encryptEmailToken(refreshToken, config.tokenEncryptionKey),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [
        emailConnectionsTable.tenantId,
        emailConnectionsTable.ownerUserId,
        emailConnectionsTable.provider,
      ],
      set: {
        emailAddress,
        refreshTokenCiphertext: encryptEmailToken(refreshToken, config.tokenEncryptionKey),
        updatedAt: new Date(),
      },
    });
  },

  async account(identity: AgentWorkIdentity): Promise<{ emailAddress: string } | null> {
    if (!gmailOAuthConfigured()) return null;
    const [connection] = await db.select({
      emailAddress: emailConnectionsTable.emailAddress,
    })
      .from(emailConnectionsTable)
      .where(identityPredicate(identity))
      .limit(1);
    return connection ?? null;
  },

  async disconnect(identity: AgentWorkIdentity): Promise<void> {
    await db.delete(emailConnectionsTable).where(identityPredicate(identity));
    await db.delete(emailOAuthStatesTable).where(and(
      eq(emailOAuthStatesTable.tenantId, identity.tenantId),
      eq(emailOAuthStatesTable.ownerUserId, identity.userId),
    ));
  },

  async accessToken(identity: AgentWorkIdentity): Promise<string> {
    const config = getGmailOAuthConfig();
    if (!config) throw new Error("EMAIL_GMAIL_NOT_CONFIGURED");
    const [connection] = await db.select()
      .from(emailConnectionsTable)
      .where(identityPredicate(identity))
      .limit(1);
    if (!connection) throw new Error("EMAIL_GMAIL_ACCOUNT_NOT_CONNECTED");

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
      throw new Error("EMAIL_GMAIL_TOKEN_REFRESH_UNAVAILABLE");
    }
    const token = await responseJson(response);
    if (!response.ok || typeof token.access_token !== "string") {
      throw new Error(response.status === 400 || response.status === 401
        ? "EMAIL_GMAIL_REAUTH_REQUIRED"
        : "EMAIL_GMAIL_TOKEN_REFRESH_FAILED");
    }
    return token.access_token;
  },
};

export const GMAIL_API_BASE = GOOGLE_API_BASE_URL;