import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import {
  authExternalIdentitiesTable,
  authExternalOAuthStatesTable,
  db,
} from "@workspace/db";
import {
  AuthError,
  getAuthUser,
  issueAuthSessionForIdentity,
  verifyAuthUserPassword,
  type AuthIdentity,
  type IssuedSession,
} from "./auth";
import { getOAuthPublicOrigin } from "./oauth-public-origin";

export type AuthProvider = "google" | "microsoft";
export type OAuthClient = "web" | "mobile";
export type OAuthMode = "login" | "link";

const STATE_TTL_MS = 10 * 60_000;
const MOBILE_TICKET_TTL_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
export const MOBILE_OAUTH_RETURN_URI = "personal-secretary-mobile://oauth";

type OAuthProviderConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
  scopes: string;
};

type OAuthProfile = {
  subject: string;
  emailAddress: string | null;
};

export type OAuthCallbackResult = {
  client: OAuthClient;
  mode: OAuthMode;
  redirectUrl: string;
  session?: IssuedSession;
};

export function getExternalOAuthConfig(
  provider: AuthProvider,
  env: NodeJS.ProcessEnv = process.env,
): OAuthProviderConfig | null {
  const origin = getOAuthPublicOrigin(env);
  const providerPrefix = provider === "google" ? "AUTH_GOOGLE" : "AUTH_MICROSOFT";
  const clientPrefix = provider === "google" ? "GOOGLE_OAUTH" : "MICROSOFT_OAUTH";
  const clientId = env[`${clientPrefix}_CLIENT_ID`]?.trim();
  const clientSecret = env[`${clientPrefix}_CLIENT_SECRET`]?.trim();
  const redirectUri = env[`${providerPrefix}_REDIRECT_URI`]?.trim()
    || (origin ? `${origin}/api/auth/oauth/${provider}/callback` : "");
  if (!clientId || !clientSecret || !redirectUri) return null;

  try {
    const parsedRedirect = new URL(redirectUri);
    const isLocalHttp = parsedRedirect.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(parsedRedirect.hostname);
    if (parsedRedirect.protocol !== "https:" && !isLocalHttp) return null;
  } catch {
    return null;
  }

  if (provider === "google") {
    return {
      clientId,
      clientSecret,
      redirectUri,
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      userInfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
      scopes: "openid email profile",
    };
  }

  const tenant = env.MICROSOFT_OAUTH_TENANT?.trim() || "common";
  if (!/^[A-Za-z0-9.-]+$/.test(tenant)) return null;
  return {
    clientId,
    clientSecret,
    redirectUri,
    authorizationEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    userInfoEndpoint: "https://graph.microsoft.com/oidc/userinfo",
    scopes: "openid profile email",
  };
}

function stateEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const secret = env.SESSION_SECRET?.trim()
    || (env.NODE_ENV === "production" ? "" : "development-only-session-secret");
  if (!secret) throw new AuthError(503, "AUTH_SESSION_SECRET_MISSING");
  return createHash("sha256")
    .update("personal-secretary:external-oauth-state:v1\0")
    .update(secret)
    .digest();
}

function encryptVerifier(verifier: string, env: NodeJS.ProcessEnv): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", stateEncryptionKey(env), iv);
  const ciphertext = Buffer.concat([cipher.update(verifier, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function decryptVerifier(encoded: string, env: NodeJS.ProcessEnv): string {
  const [version, encodedIv, encodedTag, encodedCiphertext] = encoded.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new AuthError(400, "AUTH_OAUTH_STATE_INVALID");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      stateEncryptionKey(env),
      Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AuthError(400, "AUTH_OAUTH_STATE_INVALID");
  }
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeWebReturnTo(value: string | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.length > 512) {
    throw new AuthError(400, "AUTH_OAUTH_RETURN_TO_INVALID");
  }
  try {
    const parsed = new URL(value, "https://personal-secretary.invalid");
    if (parsed.origin !== "https://personal-secretary.invalid") {
      throw new AuthError(400, "AUTH_OAUTH_RETURN_TO_INVALID");
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(400, "AUTH_OAUTH_RETURN_TO_INVALID");
  }
}

function appendQuery(target: string, values: Record<string, string>): string {
  const parsed = new URL(target, "https://personal-secretary.invalid");
  for (const [key, value] of Object.entries(values)) parsed.searchParams.set(key, value);
  if (parsed.origin === "https://personal-secretary.invalid") {
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
  return parsed.toString();
}

function mobileRedirect(values: Record<string, string>): string {
  return appendQuery(MOBILE_OAUTH_RETURN_URI, values);
}

function createAuthorizationUrl(
  config: OAuthProviderConfig,
  state: string,
  codeChallenge: string,
): string {
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  if (url.hostname === "accounts.google.com") {
    url.searchParams.set("access_type", "online");
  }
  return url.toString();
}

export async function startExternalOAuth(input: {
  provider: AuthProvider;
  mode: OAuthMode;
  client: OAuthClient;
  identity?: AuthIdentity | null;
  currentPassword?: string;
  returnTo?: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const config = getExternalOAuthConfig(input.provider, env);
  if (!config) throw new AuthError(503, "AUTH_PROVIDER_NOT_CONFIGURED");

  let identity: AuthIdentity | null = null;
  if (input.mode === "link") {
    identity = input.identity ?? null;
    if (!identity) throw new AuthError(401, "AUTHENTICATION_REQUIRED");
    if (!input.currentPassword
      || !(await verifyAuthUserPassword(identity, input.currentPassword))) {
      throw new AuthError(401, "AUTH_REAUTHENTICATION_REQUIRED");
    }
    if (!(await getAuthUser(identity))) throw new AuthError(401, "AUTHENTICATION_REQUIRED");
  }

  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const returnTo = input.client === "mobile"
    ? MOBILE_OAUTH_RETURN_URI
    : normalizeWebReturnTo(input.returnTo);
  const now = new Date();

  await db.delete(authExternalOAuthStatesTable)
    .where(lt(authExternalOAuthStatesTable.expiresAt, new Date(now.getTime() - STATE_TTL_MS)));
  await db.insert(authExternalOAuthStatesTable).values({
    stateHash: hashValue(state),
    provider: input.provider,
    mode: input.mode,
    client: input.client,
    tenantId: identity?.tenantId ?? null,
    ownerUserId: identity?.userId ?? null,
    returnTo,
    codeVerifierCiphertext: encryptVerifier(verifier, env),
    expiresAt: new Date(now.getTime() + STATE_TTL_MS),
  });

  return createAuthorizationUrl(config, state, challenge);
}

async function exchangeCodeForProfile(
  config: OAuthProviderConfig,
  code: string,
  verifier: string,
): Promise<OAuthProfile> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AuthError(502, "AUTH_PROVIDER_UNAVAILABLE");
  }
  if (!tokenResponse.ok) throw new AuthError(401, "AUTH_PROVIDER_EXCHANGE_FAILED");
  const tokenBody: unknown = await tokenResponse.json().catch(() => null);
  if (!tokenBody || typeof tokenBody !== "object"
    || !("access_token" in tokenBody)
    || typeof tokenBody.access_token !== "string"
    || !tokenBody.access_token) {
    throw new AuthError(502, "AUTH_PROVIDER_RESPONSE_INVALID");
  }

  let profileResponse: Response;
  try {
    profileResponse = await fetch(config.userInfoEndpoint, {
      headers: { authorization: `Bearer ${tokenBody.access_token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AuthError(502, "AUTH_PROVIDER_UNAVAILABLE");
  }
  if (!profileResponse.ok) throw new AuthError(502, "AUTH_PROVIDER_PROFILE_FAILED");
  const profile: unknown = await profileResponse.json().catch(() => null);
  if (!profile || typeof profile !== "object"
    || !("sub" in profile)
    || typeof profile.sub !== "string"
    || !profile.sub.trim()
    || profile.sub.length > 512) {
    throw new AuthError(502, "AUTH_PROVIDER_PROFILE_INVALID");
  }
  const emailValue = "email" in profile && typeof profile.email === "string"
    ? profile.email.trim().toLowerCase()
    : "preferred_username" in profile && typeof profile.preferred_username === "string"
      ? profile.preferred_username.trim().toLowerCase()
      : "";
  return {
    subject: profile.sub,
    emailAddress: emailValue && emailValue.length <= 320 ? emailValue : null,
  };
}

async function linkProviderIdentity(input: {
  identity: AuthIdentity;
  provider: AuthProvider;
  profile: OAuthProfile;
}): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [existingSubject] = await tx.select().from(authExternalIdentitiesTable)
        .where(and(
          eq(authExternalIdentitiesTable.provider, input.provider),
          eq(authExternalIdentitiesTable.providerSubject, input.profile.subject),
        ))
        .limit(1);
      if (existingSubject) {
        if (existingSubject.tenantId !== input.identity.tenantId
          || existingSubject.ownerUserId !== input.identity.userId) {
          throw new AuthError(409, "AUTH_PROVIDER_ALREADY_LINKED");
        }
        await tx.update(authExternalIdentitiesTable).set({
          emailAddress: input.profile.emailAddress,
          lastUsedAt: new Date(),
        }).where(eq(authExternalIdentitiesTable.id, existingSubject.id));
        return;
      }

      const [existingProvider] = await tx.select({ id: authExternalIdentitiesTable.id })
        .from(authExternalIdentitiesTable)
        .where(and(
          eq(authExternalIdentitiesTable.tenantId, input.identity.tenantId),
          eq(authExternalIdentitiesTable.ownerUserId, input.identity.userId),
          eq(authExternalIdentitiesTable.provider, input.provider),
        ))
        .limit(1);
      if (existingProvider) throw new AuthError(409, "AUTH_PROVIDER_ALREADY_LINKED");

      await tx.insert(authExternalIdentitiesTable).values({
        tenantId: input.identity.tenantId,
        ownerUserId: input.identity.userId,
        provider: input.provider,
        providerSubject: input.profile.subject,
        emailAddress: input.profile.emailAddress,
      });
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (typeof error === "object" && error && "code" in error
      && (error as { code?: unknown }).code === "23505") {
      throw new AuthError(409, "AUTH_PROVIDER_ALREADY_LINKED");
    }
    throw error;
  }
}

export async function completeExternalOAuthCallback(input: {
  provider: AuthProvider;
  state: string;
  code?: string;
  providerError?: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<OAuthCallbackResult> {
  if (!input.state || input.state.length > 512) throw new AuthError(400, "AUTH_OAUTH_STATE_INVALID");
  const now = new Date();
  const [stateRow] = await db.update(authExternalOAuthStatesTable)
    .set({ consumedAt: now })
    .where(and(
      eq(authExternalOAuthStatesTable.stateHash, hashValue(input.state)),
      eq(authExternalOAuthStatesTable.provider, input.provider),
      gt(authExternalOAuthStatesTable.expiresAt, now),
      isNull(authExternalOAuthStatesTable.consumedAt),
    ))
    .returning();
  if (!stateRow) throw new AuthError(400, "AUTH_OAUTH_STATE_INVALID");

  const returnWith = (values: Record<string, string>) => stateRow.client === "mobile"
    ? mobileRedirect(values)
    : appendQuery(stateRow.returnTo, values);
  if (input.providerError) {
    return {
      client: stateRow.client as OAuthClient,
      mode: stateRow.mode as OAuthMode,
      redirectUrl: returnWith({ authError: "provider_cancelled" }),
    };
  }
  if (!input.code || input.code.length > 4096) {
    return {
      client: stateRow.client as OAuthClient,
      mode: stateRow.mode as OAuthMode,
      redirectUrl: returnWith({ authError: "provider_response_invalid" }),
    };
  }

  const config = getExternalOAuthConfig(input.provider, env);
  if (!config) {
    return {
      client: stateRow.client as OAuthClient,
      mode: stateRow.mode as OAuthMode,
      redirectUrl: returnWith({ authError: "provider_not_configured" }),
    };
  }
  const verifier = decryptVerifier(stateRow.codeVerifierCiphertext, env);
  let profile: OAuthProfile;
  try {
    profile = await exchangeCodeForProfile(config, input.code, verifier);
  } catch {
    return {
      client: stateRow.client as OAuthClient,
      mode: stateRow.mode as OAuthMode,
      redirectUrl: returnWith({ authError: "provider_exchange_failed" }),
    };
  }

  if (stateRow.mode === "link") {
    if (!stateRow.tenantId || !stateRow.ownerUserId) {
      throw new AuthError(400, "AUTH_OAUTH_STATE_INVALID");
    }
    const identity = { tenantId: stateRow.tenantId, userId: stateRow.ownerUserId };
    try {
      if (!(await getAuthUser(identity))) throw new AuthError(401, "AUTHENTICATION_REQUIRED");
      await linkProviderIdentity({ identity, provider: input.provider, profile });
    } catch (error) {
      const authError = error instanceof AuthError && error.code === "AUTH_PROVIDER_ALREADY_LINKED"
        ? "provider_already_linked"
        : "oauth_failed";
      return {
        client: stateRow.client as OAuthClient,
        mode: "link",
        redirectUrl: returnWith({ authError }),
      };
    }
    return {
      client: stateRow.client as OAuthClient,
      mode: "link",
      redirectUrl: returnWith({ authProviderLinked: input.provider }),
    };
  }

  const [linkedIdentity] = await db.select().from(authExternalIdentitiesTable)
    .where(and(
      eq(authExternalIdentitiesTable.provider, input.provider),
      eq(authExternalIdentitiesTable.providerSubject, profile.subject),
    ))
    .limit(1);
  if (!linkedIdentity) {
    return {
      client: stateRow.client as OAuthClient,
      mode: "login",
      redirectUrl: returnWith({ authError: "provider_not_linked" }),
    };
  }

  const identity = {
    tenantId: linkedIdentity.tenantId,
    userId: linkedIdentity.ownerUserId,
  };
  let user;
  try {
    user = await getAuthUser(identity);
  } catch {
    return {
      client: stateRow.client as OAuthClient,
      mode: "login",
      redirectUrl: returnWith({ authError: "oauth_failed" }),
    };
  }
  if (!user) {
    return {
      client: stateRow.client as OAuthClient,
      mode: "login",
      redirectUrl: returnWith({ authError: "provider_not_linked" }),
    };
  }
  await db.update(authExternalIdentitiesTable).set({ lastUsedAt: now })
    .where(eq(authExternalIdentitiesTable.id, linkedIdentity.id));

  if (stateRow.client === "mobile") {
    const ticket = randomBytes(32).toString("base64url");
    await db.update(authExternalOAuthStatesTable).set({
      ticketHash: hashValue(ticket),
      ticketExpiresAt: new Date(now.getTime() + MOBILE_TICKET_TTL_MS),
      resolvedTenantId: identity.tenantId,
      resolvedUserId: identity.userId,
    }).where(eq(authExternalOAuthStatesTable.id, stateRow.id));
    return {
      client: "mobile",
      mode: "login",
      redirectUrl: mobileRedirect({ ticket }),
    };
  }

  let session: IssuedSession;
  try {
    session = await issueAuthSessionForIdentity(identity);
  } catch {
    return {
      client: stateRow.client as OAuthClient,
      mode: "login",
      redirectUrl: returnWith({ authError: "oauth_failed" }),
    };
  }
  return {
    client: "web",
    mode: "login",
    redirectUrl: stateRow.returnTo,
    session,
  };
}

export async function exchangeExternalOAuthTicket(ticket: string): Promise<IssuedSession> {
  if (!ticket || ticket.length < 16 || ticket.length > 512) {
    throw new AuthError(401, "AUTH_OAUTH_TICKET_INVALID");
  }
  const now = new Date();
  const [stateRow] = await db.update(authExternalOAuthStatesTable)
    .set({ ticketConsumedAt: now })
    .where(and(
      eq(authExternalOAuthStatesTable.ticketHash, hashValue(ticket)),
      gt(authExternalOAuthStatesTable.ticketExpiresAt, now),
      isNull(authExternalOAuthStatesTable.ticketConsumedAt),
    ))
    .returning();
  if (!stateRow?.resolvedTenantId || !stateRow.resolvedUserId) {
    throw new AuthError(401, "AUTH_OAUTH_TICKET_INVALID");
  }
  return issueAuthSessionForIdentity({
    tenantId: stateRow.resolvedTenantId,
    userId: stateRow.resolvedUserId,
  });
}

export async function getLinkedAuthProviders(identity: AuthIdentity) {
  const rows = await db.select({
    provider: authExternalIdentitiesTable.provider,
    emailAddress: authExternalIdentitiesTable.emailAddress,
    linkedAt: authExternalIdentitiesTable.createdAt,
  }).from(authExternalIdentitiesTable)
    .where(and(
      eq(authExternalIdentitiesTable.tenantId, identity.tenantId),
      eq(authExternalIdentitiesTable.ownerUserId, identity.userId),
    ));
  return rows.map((row) => ({
    provider: row.provider as AuthProvider,
    emailAddress: row.emailAddress,
    linkedAt: row.linkedAt.toISOString(),
  }));
}

export async function unlinkExternalAuthProvider(input: {
  identity: AuthIdentity;
  provider: AuthProvider;
  currentPassword: string;
}): Promise<void> {
  if (!(await verifyAuthUserPassword(input.identity, input.currentPassword))) {
    throw new AuthError(401, "AUTH_REAUTHENTICATION_REQUIRED");
  }
  const removed = await db.delete(authExternalIdentitiesTable).where(and(
    eq(authExternalIdentitiesTable.tenantId, input.identity.tenantId),
    eq(authExternalIdentitiesTable.ownerUserId, input.identity.userId),
    eq(authExternalIdentitiesTable.provider, input.provider),
  )).returning({ id: authExternalIdentitiesTable.id });
  if (removed.length === 0) throw new AuthError(404, "AUTH_PROVIDER_NOT_LINKED");
}
