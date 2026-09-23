import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, mobilePushTokensTable } from "@workspace/db";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = `push-handoff-${process.pid}-${Date.now()}`;
process.env.AGENT_WORK_ENABLED = "true";
process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY = "false";

const { default: app } = await import("../src/app.ts");

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
const suffix = `${process.pid}-${Date.now()}-${randomUUID()}`;
const password = "correct horse battery staple";
const emails = [
  `push-handoff-a-${suffix}@example.test`,
  `push-handoff-b-${suffix}@example.test`,
  `push-handoff-c-${suffix}@example.test`,
];
const tokens = [
  `ExponentPushToken[handoff-${suffix}-one]`,
  `ExponentPushToken[handoff-${suffix}-two]`,
  `ExponentPushToken[handoff-${suffix}-three]`,
];

type Session = {
  token: string;
  refreshToken: string;
  user: { userId: string; tenantId: string };
};

async function startServer() {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Push handoff test server did not expose a port.");
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

function bearer(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

async function signup(email: string): Promise<Session> {
  const response = await request("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-transport": "bearer" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 201);
  return {
    token: response.body.accessToken as string,
    refreshToken: response.body.refreshToken as string,
    user: response.body.user as Session["user"],
  };
}

async function login(email: string): Promise<Session> {
  const response = await request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-transport": "bearer" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  return {
    token: response.body.accessToken as string,
    refreshToken: response.body.refreshToken as string,
    user: response.body.user as Session["user"],
  };
}

async function register(session: Session, token: string) {
  return request("/push-tokens", {
    method: "POST",
    headers: { ...bearer(session.token), "content-type": "application/json" },
    body: JSON.stringify({
      token,
      provider: "expo",
      platform: "android",
      appId: "com.example.secretary",
    }),
  });
}

async function unregister(session: Session, token: string) {
  return request("/push-tokens", {
    method: "DELETE",
    headers: { ...bearer(session.token), "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

async function logout(session: Session) {
  return request("/auth/logout", {
    method: "POST",
    headers: { ...bearer(session.token), "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
}

async function tokenRow(token: string) {
  const [row] = await db.select().from(mobilePushTokensTable).where(
    eq(mobilePushTokensTable.token, token),
  );
  return row;
}

async function cleanup() {
  await db.delete(mobilePushTokensTable).where(inArray(mobilePushTokensTable.token, tokens));
}

before(async () => {
  await startServer();
});

after(async () => {
  await cleanup();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("logout allows one atomic disabled-token handoff and preserves one owner", async () => {
  const alice = await signup(emails[0]);
  const bob = await signup(emails[1]);

  assert.equal((await register(alice, tokens[0])).status, 200);
  assert.equal((await unregister(alice, tokens[0])).status, 200);
  assert.equal((await logout(alice)).status, 204);
  const disabled = await tokenRow(tokens[0]);
  assert.equal(disabled?.enabled, 0);
  assert.equal(disabled?.disabledReason, "unregistered");

  assert.equal((await register(bob, tokens[0])).status, 200);
  const handedOff = await tokenRow(tokens[0]);
  assert.equal(handedOff?.enabled, 1);
  assert.equal(handedOff?.ownerUserId, bob.user.userId);
  assert.equal(handedOff?.tenantId, bob.user.tenantId);
  assert.equal(handedOff?.disabledReason, null);

  const rows = await db.select().from(mobilePushTokensTable).where(
    eq(mobilePushTokensTable.token, tokens[0]),
  );
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0]?.ownerUserId, alice.user.userId);

  assert.equal((await unregister(bob, tokens[0])).status, 200);
  assert.equal((await logout(bob)).status, 204);
  const carol = await signup(emails[2]);
  assert.equal((await register(carol, tokens[0])).status, 200);
  const handedOffAgain = await tokenRow(tokens[0]);
  assert.equal(handedOffAgain?.ownerUserId, carol.user.userId);

  const aliceAgain = await login(emails[0]);
  assert.equal((await register(aliceAgain, tokens[0])).status, 409);
});

test("an active token still rejects another account", async () => {
  const alice = await signup(`push-handoff-active-a-${suffix}@example.test`);
  const bob = await signup(`push-handoff-active-b-${suffix}@example.test`);

  assert.equal((await register(alice, tokens[1])).status, 200);
  const conflict = await register(bob, tokens[1]);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body?.code, "PUSH_TOKEN_OWNERSHIP_CONFLICT");
  const row = await tokenRow(tokens[1]);
  assert.equal(row?.enabled, 1);
  assert.equal(row?.ownerUserId, alice.user.userId);
});

test("only explicit unregister handoff is reusable; provider-invalid tokens stay protected", async () => {
  const alice = await signup(`push-handoff-invalid-a-${suffix}@example.test`);
  const bob = await signup(`push-handoff-invalid-b-${suffix}@example.test`);

  assert.equal((await register(alice, tokens[2])).status, 200);
  await db.update(mobilePushTokensTable).set({
    enabled: 0,
    disabledReason: "provider_invalid",
  }).where(and(
    eq(mobilePushTokensTable.token, tokens[2]),
    eq(mobilePushTokensTable.ownerUserId, alice.user.userId),
  ));

  const conflict = await register(bob, tokens[2]);
  assert.equal(conflict.status, 409);
  const row = await tokenRow(tokens[2]);
  assert.equal(row?.enabled, 0);
  assert.equal(row?.ownerUserId, alice.user.userId);
});