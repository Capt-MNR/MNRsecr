import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  db,
  emailConnectionsTable,
  emailOAuthStatesTable,
} from "@workspace/db";
import { gmailOAuthService } from "../src/lib/gmail-oauth";

const identity = {
  tenantId: `gmail-oauth-mock-${process.pid}-${Date.now()}`,
  userId: "gmail-oauth-owner",
};

test("Gmail OAuth uses mocked PKCE exchange, tenant-bound single-use state, encrypted refresh tokens, and refresh", async () => {
  const environmentKeys = [
    "NODE_ENV",
    "EMAIL_GMAIL_ENABLED",
    "EMAIL_GMAIL_CLIENT_ID",
    "EMAIL_GMAIL_CLIENT_SECRET",
    "EMAIL_GMAIL_REDIRECT_URI",
    "EMAIL_TOKEN_ENCRYPTION_KEY",
  ] as const;
  const previousEnvironment = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string; authorization: string }> = [];
  const testEncryptionKey = Buffer.alloc(32, 7).toString("base64");
  process.env.NODE_ENV = "test";
  process.env.EMAIL_GMAIL_ENABLED = "true";
  process.env.EMAIL_GMAIL_CLIENT_ID = "mock-client-id";
  process.env.EMAIL_GMAIL_CLIENT_SECRET = "mock-client-secret";
  process.env.EMAIL_GMAIL_REDIRECT_URI = "https://example.test/oauth/callback";
  process.env.EMAIL_TOKEN_ENCRYPTION_KEY = testEncryptionKey;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string"
      ? init.body
      : init?.body instanceof URLSearchParams
        ? init.body.toString()
        : "";
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    const method = init?.method ?? "GET";
    calls.push({ url, method, body, authorization });
    if (url === "https://oauth2.googleapis.com/token") {
      const params = new URLSearchParams(body);
      if (params.get("grant_type") === "authorization_code") {
        return Response.json({
          access_token: "mock-initial-access",
          refresh_token: "mock-refresh-token",
          token_type: "Bearer",
        });
      }
      return Response.json({ access_token: "mock-refreshed-access", token_type: "Bearer" });
    }
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
      return Response.json({
        email: "mock-user@example.test",
        email_verified: true,
      });
    }
    throw new Error(`Unexpected mocked OAuth request: ${url}`);
  }) as typeof fetch;

  try {
    await db.delete(emailConnectionsTable).where(and(
      eq(emailConnectionsTable.tenantId, identity.tenantId),
      eq(emailConnectionsTable.ownerUserId, identity.userId),
    ));
    await db.delete(emailOAuthStatesTable).where(and(
      eq(emailOAuthStatesTable.tenantId, identity.tenantId),
      eq(emailOAuthStatesTable.ownerUserId, identity.userId),
    ));

    const authorizationUrl = new URL(await gmailOAuthService.start(identity));
    assert.equal(authorizationUrl.origin, "https://accounts.google.com");
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    assert.ok(authorizationUrl.searchParams.get("code_challenge"));
    const state = authorizationUrl.searchParams.get("state");
    assert.ok(state);

    await gmailOAuthService.complete("mock-authorization-code", state);
    assert.deepEqual(await gmailOAuthService.account(identity), {
      emailAddress: "mock-user@example.test",
    });
    const connection = await db.select({
      refreshTokenCiphertext: emailConnectionsTable.refreshTokenCiphertext,
    }).from(emailConnectionsTable).where(and(
      eq(emailConnectionsTable.tenantId, identity.tenantId),
      eq(emailConnectionsTable.ownerUserId, identity.userId),
      eq(emailConnectionsTable.provider, "gmail"),
    )).limit(1);
    assert.equal(connection.length, 1);
    assert.notEqual(connection[0]?.refreshTokenCiphertext, "mock-refresh-token");

    assert.equal(await gmailOAuthService.accessToken(identity), "mock-refreshed-access");
    assert.ok(calls.some((call) =>
      call.url === "https://openidconnect.googleapis.com/v1/userinfo"
      && call.authorization === "Bearer mock-initial-access"));
    assert.ok(calls.some((call) =>
      call.url === "https://oauth2.googleapis.com/token"
      && new URLSearchParams(call.body).get("grant_type") === "refresh_token"));

    const callsBeforeReplay = calls.length;
    await assert.rejects(
      gmailOAuthService.complete("mock-authorization-code", state),
      (error: unknown) => error instanceof Error
        && error.message === "EMAIL_GMAIL_OAUTH_STATE_INVALID",
    );
    assert.equal(calls.length, callsBeforeReplay, "a consumed state must be rejected before token exchange");
    assert.equal(await gmailOAuthService.account({
      tenantId: `${identity.tenantId}-other`,
      userId: identity.userId,
    }), null);
  } finally {
    globalThis.fetch = originalFetch;
    await db.delete(emailConnectionsTable).where(and(
      eq(emailConnectionsTable.tenantId, identity.tenantId),
      eq(emailConnectionsTable.ownerUserId, identity.userId),
    ));
    await db.delete(emailOAuthStatesTable).where(and(
      eq(emailOAuthStatesTable.tenantId, identity.tenantId),
      eq(emailOAuthStatesTable.ownerUserId, identity.userId),
    ));
    for (const key of environmentKeys) {
      const previous = previousEnvironment[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
});