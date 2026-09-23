import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import { checkAuthAbuse, resetAuthAbuseForTests } from "../src/lib/auth-abuse.ts";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = `auth-abuse-test-${process.pid}-${Date.now()}`;
process.env.AUTH_ABUSE_WINDOW_MS = "1000";

const { default: app } = await import("../src/app.ts");

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
const password = "correct horse battery staple";

async function startServer() {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Auth abuse test server did not expose a port.");
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, init);
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Record<string, any> : null,
  };
}

async function signup(email: string) {
  const response = await request("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-transport": "bearer" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 201);
  return response.body as { refreshToken: string };
}

before(startServer);
after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("repeated failed login attempts are bounded without exposing account state", async () => {
  resetAuthAbuseForTests();
  const email = `abuse-login-${randomUUID()}@example.test`;
  const responses = await Promise.all(Array.from({ length: 12 }, () => request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-transport": "bearer" },
    body: JSON.stringify({ email, password: "wrong password 123" }),
  })));
  assert.ok(responses.some((response) => response.status === 429));
  const limited = responses.find((response) => response.status === 429);
  assert.equal(limited?.body?.code, "AUTH_RATE_LIMITED");
  assert.equal(JSON.stringify(limited?.body).includes(email), false);
});

test("repeated signup and refresh attempts are bounded", async () => {
  resetAuthAbuseForTests();
  const email = `abuse-signup-${randomUUID()}@example.test`;
  await signup(email);
  const signupResponses = await Promise.all(Array.from({ length: 8 }, () => request("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-transport": "bearer" },
    body: JSON.stringify({ email, password }),
  })));
  assert.ok(signupResponses.some((response) => response.status === 429));

  resetAuthAbuseForTests();
  const invalidRefresh = `invalid-refresh-${randomUUID()}`;
  const refreshResponses = await Promise.all(Array.from({ length: 14 }, () => request("/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-transport": "bearer" },
    body: JSON.stringify({ refreshToken: invalidRefresh }),
  })));
  assert.ok(refreshResponses.some((response) => response.status === 429));
});

test("auth abuse windows expire and dimensions remain tenant/account independent", () => {
  resetAuthAbuseForTests();
  const now = Date.now();
  for (let index = 0; index < 8; index += 1) {
    assert.equal(checkAuthAbuse({
      kind: "login",
      ip: "10.0.0.1",
      identity: "one@example.test",
      now,
    }).allowed, true);
  }
  assert.equal(checkAuthAbuse({
    kind: "login",
    ip: "10.0.0.1",
    identity: "one@example.test",
    now,
  }).allowed, false);
  assert.equal(checkAuthAbuse({
    kind: "login",
    ip: "10.0.0.2",
    identity: "one@example.test",
    now,
  }).allowed, false);
  assert.equal(checkAuthAbuse({
    kind: "login",
    ip: "10.0.0.1",
    identity: "two@example.test",
    now,
  }).allowed, true);
  assert.equal(checkAuthAbuse({
    kind: "login",
    ip: "10.0.0.1",
    identity: "one@example.test",
    now: now + 1_001,
  }).allowed, true);
});