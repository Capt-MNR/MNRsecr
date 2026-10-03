import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptEmailToken,
  encryptEmailToken,
  isEmailTokenEncryptionKeyConfigured,
} from "../src/lib/email-token-crypto";
import {
  buildGmailAuthorizationUrl,
  getGmailOAuthConfig,
} from "../src/lib/gmail-oauth";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

test("OAuth tokens are encrypted with unique authenticated ciphertexts", () => {
  const token = "refresh-token-for-test-only";
  const first = encryptEmailToken(token, encryptionKey);
  const second = encryptEmailToken(token, encryptionKey);
  assert.notEqual(first, second);
  assert.equal(decryptEmailToken(first, encryptionKey), token);
  assert.equal(decryptEmailToken(second, encryptionKey), token);
  assert.equal(first.includes(token), false);
});

test("OAuth token ciphertext rejects tampering, wrong keys, and malformed values", () => {
  const ciphertext = encryptEmailToken("test-token", encryptionKey);
  const parts = ciphertext.split(".");
  parts[3] = `${parts[3]}x`;
  assert.throws(() => decryptEmailToken(parts.join("."), encryptionKey));
  assert.throws(() => decryptEmailToken(ciphertext, Buffer.alloc(32, 8).toString("base64")));
  assert.throws(() => decryptEmailToken("not-a-ciphertext", encryptionKey));
  assert.equal(isEmailTokenEncryptionKeyConfigured("short"), false);
});

test("Gmail OAuth configuration is opt-in and always disabled in production", () => {
  const configured = {
    NODE_ENV: "development",
    EMAIL_GMAIL_ENABLED: "true",
    EMAIL_GMAIL_CLIENT_ID: "test-client-id",
    EMAIL_GMAIL_CLIENT_SECRET: "test-client-secret",
    EMAIL_GMAIL_REDIRECT_URI: "https://example.test/api/email/gmail/oauth/callback",
    EMAIL_TOKEN_ENCRYPTION_KEY: encryptionKey,
  } as NodeJS.ProcessEnv;
  assert.equal(getGmailOAuthConfig(configured)?.clientId, "test-client-id");
  assert.equal(getGmailOAuthConfig({ ...configured, NODE_ENV: "production" }), null);
  assert.equal(getGmailOAuthConfig({ ...configured, EMAIL_GMAIL_ENABLED: "false" }), null);

  const authorizationUrl = new URL(buildGmailAuthorizationUrl(
    getGmailOAuthConfig(configured)!,
    "test-one-time-state",
    "test-pkce-challenge",
  ));
  assert.equal(authorizationUrl.searchParams.get("client_id"), "test-client-id");
  assert.equal(authorizationUrl.searchParams.get("state"), "test-one-time-state");
  assert.equal(authorizationUrl.searchParams.get("code_challenge"), "test-pkce-challenge");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorizationUrl.searchParams.get("access_type"), "offline");
  assert.equal(authorizationUrl.searchParams.get("scope")?.includes("gmail.send"), true);
  assert.equal(authorizationUrl.searchParams.has("client_secret"), false);
});