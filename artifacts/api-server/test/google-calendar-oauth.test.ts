import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  db,
  googleCalendarConnectionsTable,
  googleCalendarOAuthStatesTable,
} from "@workspace/db";
import {
  GOOGLE_CALENDAR_SCOPES,
  getGoogleCalendarOAuthConfig,
  googleCalendarOAuthService,
} from "../src/lib/google-calendar-oauth";
import { decryptEmailToken } from "../src/lib/email-token-crypto";

const identity = {
  tenantId: `google-calendar-oauth-mock-${process.pid}-${Date.now()}`,
  userId: "calendar-owner",
};
const otherUser = { ...identity, userId: "calendar-other-user" };
const otherTenant = { ...identity, tenantId: `${identity.tenantId}-other` };
const thirdUser = { ...identity, userId: "calendar-revoke-failure-user" };
const testEncryptionKey = Buffer.alloc(32, 9).toString("base64");
const fullScope = [...GOOGLE_CALENDAR_SCOPES].join(" ");

test("Google Calendar OAuth links the authenticated owner with least-privilege scopes", async (t) => {
  const environmentKeys = [
    "NODE_ENV",
    "GOOGLE_CALENDAR_ENABLED",
    "GOOGLE_CALENDAR_CLIENT_ID",
    "GOOGLE_CALENDAR_CLIENT_SECRET",
    "GOOGLE_CALENDAR_REDIRECT_URI",
    "EMAIL_TOKEN_ENCRYPTION_KEY",
  ] as const;
  const previousEnvironment = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string; authorization: string }> = [];
  let grantedScope = fullScope;
  let revokeStatus = 200;
  let completedState: string | null = null;
  process.env.NODE_ENV = "test";
  process.env.GOOGLE_CALENDAR_ENABLED = "true";
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "mock-calendar-client";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "mock-calendar-secret";
  process.env.GOOGLE_CALENDAR_REDIRECT_URI =
    "https://example.test/api/calendar/google/oauth/callback";
  process.env.EMAIL_TOKEN_ENCRYPTION_KEY = testEncryptionKey;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string"
      ? init.body
      : init?.body instanceof URLSearchParams
        ? init.body.toString()
        : "";
    const method = init?.method ?? "GET";
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    calls.push({ url, method, body, authorization });
    if (url === "https://oauth2.googleapis.com/token") {
      const params = new URLSearchParams(body);
      if (params.get("grant_type") === "authorization_code") {
        return Response.json({
          access_token: "mock-calendar-initial-access",
          refresh_token: "mock-calendar-refresh-token",
          token_type: "Bearer",
          scope: grantedScope,
        });
      }
      return Response.json({
        access_token: "mock-calendar-refreshed-access",
        token_type: "Bearer",
      });
    }
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
      return Response.json({
        email: "calendar-owner@example.test",
        email_verified: true,
      });
    }
    if (url === "https://oauth2.googleapis.com/revoke") {
      return new Response(null, { status: revokeStatus });
    }
    throw new Error(`Unexpected mocked Google OAuth request: ${url}`);
  }) as typeof fetch;

  const clearIdentity = async (owner: typeof identity) => {
    await db.delete(googleCalendarConnectionsTable).where(and(
      eq(googleCalendarConnectionsTable.tenantId, owner.tenantId),
      eq(googleCalendarConnectionsTable.ownerUserId, owner.userId),
    ));
    await db.delete(googleCalendarOAuthStatesTable).where(and(
      eq(googleCalendarOAuthStatesTable.tenantId, owner.tenantId),
      eq(googleCalendarOAuthStatesTable.ownerUserId, owner.userId),
    ));
  };

  try {
    await Promise.all([identity, otherUser, otherTenant, thirdUser].map(clearIdentity));

    await t.test("PKCE state is opaque, hashed, encrypted, and bound to the current owner", async () => {
      const authorizationUrl = new URL(await googleCalendarOAuthService.start(identity));
      assert.equal(authorizationUrl.origin, "https://accounts.google.com");
      assert.equal(authorizationUrl.searchParams.get("client_id"), "mock-calendar-client");
      assert.equal(
        authorizationUrl.searchParams.get("scope"),
        fullScope,
      );
      assert.equal(authorizationUrl.searchParams.get("access_type"), "offline");
      assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
      const state = authorizationUrl.searchParams.get("state");
      const challenge = authorizationUrl.searchParams.get("code_challenge");
      assert.ok(state);
      assert.ok(challenge);
      completedState = state;

      const [storedState] = await db.select().from(googleCalendarOAuthStatesTable).where(and(
        eq(googleCalendarOAuthStatesTable.tenantId, identity.tenantId),
        eq(googleCalendarOAuthStatesTable.ownerUserId, identity.userId),
      )).limit(1);
      assert.ok(storedState);
      assert.equal(storedState.stateHash, createHash("sha256").update(state).digest("hex"));
      assert.notEqual(storedState.stateHash, state);
      assert.ok(storedState.codeVerifierCiphertext.startsWith("v1."));

      await googleCalendarOAuthService.complete("mock-calendar-authorization-code", state);
      const tokenExchange = calls.find((call) =>
        call.url === "https://oauth2.googleapis.com/token"
        && new URLSearchParams(call.body).get("grant_type") === "authorization_code");
      assert.ok(tokenExchange);
      const codeVerifier = new URLSearchParams(tokenExchange.body).get("code_verifier");
      assert.ok(codeVerifier);
      assert.equal(
        createHash("sha256").update(codeVerifier).digest("base64url"),
        challenge,
      );
      assert.equal(
        decryptEmailToken(storedState.codeVerifierCiphertext, testEncryptionKey),
        codeVerifier,
      );

      const account = await googleCalendarOAuthService.account(identity);
      assert.deepEqual(account, {
        emailAddress: "calendar-owner@example.test",
        grantedScopes: [...GOOGLE_CALENDAR_SCOPES].sort(),
      });
      assert.equal(await googleCalendarOAuthService.account(otherUser), null);
      assert.equal(await googleCalendarOAuthService.account(otherTenant), null);

      const [storedConnection] = await db.select().from(googleCalendarConnectionsTable).where(and(
        eq(googleCalendarConnectionsTable.tenantId, identity.tenantId),
        eq(googleCalendarConnectionsTable.ownerUserId, identity.userId),
      )).limit(1);
      assert.ok(storedConnection);
      assert.notEqual(storedConnection.refreshTokenCiphertext, "mock-calendar-refresh-token");
      assert.equal(
        decryptEmailToken(storedConnection.refreshTokenCiphertext, testEncryptionKey),
        "mock-calendar-refresh-token",
      );
    });

    await t.test("refresh uses only the linked owner's encrypted token and disconnect revokes it", async () => {
      const callsBeforeRefresh = calls.length;
      assert.equal(
        await googleCalendarOAuthService.accessToken(identity),
        "mock-calendar-refreshed-access",
      );
      const refreshCall = calls.slice(callsBeforeRefresh).find((call) =>
        call.url === "https://oauth2.googleapis.com/token"
        && new URLSearchParams(call.body).get("grant_type") === "refresh_token");
      assert.ok(refreshCall);
      assert.equal(
        new URLSearchParams(refreshCall.body).get("refresh_token"),
        "mock-calendar-refresh-token",
      );

      const disconnect = await googleCalendarOAuthService.disconnect(identity);
      assert.deepEqual(disconnect, { revoked: true });
      const revokeCall = calls.find((call) => call.url === "https://oauth2.googleapis.com/revoke");
      assert.ok(revokeCall);
      assert.equal(revokeCall.method, "POST");
      assert.equal(
        new URLSearchParams(revokeCall.body).get("token"),
        "mock-calendar-refresh-token",
      );
      assert.equal(await googleCalendarOAuthService.account(identity), null);
    });

    await t.test("callback state is single-use, cancellation consumes it, and missing scope is rejected", async () => {
      const callsBeforeReplay = calls.length;
      assert.ok(completedState);
      await assert.rejects(
        googleCalendarOAuthService.complete(
          "mock-calendar-replayed-authorization-code",
          completedState,
        ),
        (error: unknown) => error instanceof Error
          && error.message === "GOOGLE_CALENDAR_OAUTH_STATE_INVALID",
      );
      assert.equal(calls.length, callsBeforeReplay, "a replayed state must not reach token exchange");

      const stateUrl = new URL(await googleCalendarOAuthService.start(otherUser));
      const state = stateUrl.searchParams.get("state");
      assert.ok(state);
      await googleCalendarOAuthService.cancel(state);
      await assert.rejects(
        googleCalendarOAuthService.cancel(state),
        (error: unknown) => error instanceof Error
          && error.message === "GOOGLE_CALENDAR_OAUTH_STATE_INVALID",
      );
      assert.equal(calls.length, callsBeforeReplay);

      grantedScope = "openid email";
      const scopeUrl = new URL(await googleCalendarOAuthService.start(otherTenant));
      const scopeState = scopeUrl.searchParams.get("state");
      assert.ok(scopeState);
      await assert.rejects(
        googleCalendarOAuthService.complete("mock-calendar-code-without-scope", scopeState),
        (error: unknown) => error instanceof Error
          && error.message === "GOOGLE_CALENDAR_REQUIRED_SCOPE_MISSING",
      );
      assert.equal(await googleCalendarOAuthService.account(otherTenant), null);
      grantedScope = fullScope;
    });

    await t.test("local disconnect still removes the account when Google revocation is not confirmed", async () => {
      const authorizationUrl = new URL(await googleCalendarOAuthService.start(thirdUser));
      const state = authorizationUrl.searchParams.get("state");
      assert.ok(state);
      await googleCalendarOAuthService.complete("mock-calendar-relink-code", state);
      revokeStatus = 503;
      assert.deepEqual(await googleCalendarOAuthService.disconnect(thirdUser), { revoked: false });
      assert.equal(await googleCalendarOAuthService.account(thirdUser), null);
    });

    await t.test("OAuth remains opt-in and is disabled for production configuration", () => {
      const configuredEnvironment: NodeJS.ProcessEnv = {
        NODE_ENV: "development",
        GOOGLE_CALENDAR_ENABLED: "true",
        GOOGLE_CALENDAR_CLIENT_ID: "mock-client",
        GOOGLE_CALENDAR_CLIENT_SECRET: "mock-secret",
        GOOGLE_CALENDAR_REDIRECT_URI: "https://example.test/callback",
        EMAIL_TOKEN_ENCRYPTION_KEY: testEncryptionKey,
      };
      assert.equal(getGoogleCalendarOAuthConfig(configuredEnvironment)?.clientId, "mock-client");
      assert.equal(
        getGoogleCalendarOAuthConfig({ ...configuredEnvironment, NODE_ENV: "production" }),
        null,
      );
      assert.equal(
        getGoogleCalendarOAuthConfig({ ...configuredEnvironment, GOOGLE_CALENDAR_ENABLED: "false" }),
        null,
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
    await Promise.all([identity, otherUser, otherTenant, thirdUser].map(clearIdentity));
    for (const key of environmentKeys) {
      const previous = previousEnvironment[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
});