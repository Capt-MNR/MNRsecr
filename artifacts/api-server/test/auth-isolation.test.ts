import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { and, eq } from "drizzle-orm";
import {
  agentWorkEventsTable,
  agentWorksTable,
  db,
  mobilePushTokensTable,
  peopleTable,
} from "@workspace/db";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = `auth-test-${process.pid}-${Date.now()}`;
process.env.AGENT_WORK_ENABLED = "true";
process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY = "false";

const { default: app } = await import("../src/app.ts");

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
const suffix = `${process.pid}-${Date.now()}-${randomUUID()}`;
const emails = [`auth-a-${suffix}@example.test`, `auth-b-${suffix}@example.test`];
const password = "correct horse battery staple";
let alice: { token: string; refreshToken: string; user: { userId: string; tenantId: string } };
let bob: { token: string; refreshToken: string; user: { userId: string; tenantId: string } };
let aliceWorkId: string;
const alicePushToken = `ExponentPushToken[auth-isolation-${suffix}]`;

async function startServer() {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Auth test server did not expose a port.");
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

async function signup(email: string) {
  const response = await request("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-transport": "bearer" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 201);
  return {
    token: response.body.accessToken as string,
    refreshToken: response.body.refreshToken as string,
    user: response.body.user as { userId: string; tenantId: string },
  };
}

async function cleanup() {
  for (const table of [agentWorkEventsTable, agentWorksTable, mobilePushTokensTable, peopleTable]) {
    await db.delete(table).where(
      table === peopleTable
        ? eq(peopleTable.name, `Auth isolation person ${suffix}`)
        : table === mobilePushTokensTable
          ? eq(mobilePushTokensTable.token, alicePushToken)
          : table === agentWorksTable
            ? eq(agentWorksTable.id, aliceWorkId ?? "")
            : and(
              eq(agentWorkEventsTable.workId, aliceWorkId ?? ""),
            ),
    );
  }
}

before(async () => {
  await startServer();
  alice = await signup(emails[0]);
  bob = await signup(emails[1]);
  const [person] = await db.insert(peopleTable).values({
    tenantId: alice.user.tenantId,
    ownerUserId: alice.user.userId,
    name: `Auth isolation person ${suffix}`,
    nameKey: `auth-isolation-${suffix}`,
  }).returning();
  assert.ok(person);
  const [work] = await db.insert(agentWorksTable).values({
    tenantId: alice.user.tenantId,
    ownerUserId: alice.user.userId,
    kind: "reminder",
    title: "Alice private work",
    source: {},
    condition: {},
    action: {},
    schedule: {},
  }).returning();
  assert.ok(work);
  aliceWorkId = work.id;
  await db.insert(agentWorkEventsTable).values({
    tenantId: alice.user.tenantId,
    ownerUserId: alice.user.userId,
    workId: aliceWorkId,
    eventType: "test",
    actorType: "system",
    summary: "private",
  });
  const register = await request("/push-tokens", {
    method: "POST",
    headers: { ...bearer(alice.token), "content-type": "application/json" },
    body: JSON.stringify({
      token: alicePushToken,
      provider: "expo",
      platform: "android",
      appId: "com.example.secretary",
    }),
  });
  assert.equal(register.status, 200);
});

after(async () => {
  await cleanup();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("unauthenticated, malformed, expired-development, and invalid sessions are rejected", async () => {
  assert.equal((await request("/records")).status, 401);
  assert.equal((await request("/records", { headers: { authorization: "Bearer malformed" } })).status, 401);
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal((await request("/records", { headers: { authorization: "Bearer dev-user" } })).status, 401);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
  const revokedAlice = await signup(`auth-revoked-${suffix}@example.test`);
  const logout = await request("/auth/logout", {
    method: "POST",
    headers: { ...bearer(revokedAlice.token), "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: revokedAlice.refreshToken }),
  });
  assert.equal(logout.status, 204);
  assert.equal((await request("/records", { headers: bearer(revokedAlice.token) })).status, 401);
});

test("authenticated user owns a tenant and cannot forge tenant or owner headers", async () => {
  const records = await request("/records", {
    headers: {
      ...bearer(bob.token),
      "x-tenant-id": alice.user.tenantId,
      "x-user-id": alice.user.userId,
    },
  });
  assert.equal(records.status, 200);
  assert.equal(records.body.people.some((item: { id: string }) => item.id), false);

  const works = await request("/works", {
    headers: {
      ...bearer(bob.token),
      "x-tenant-id": alice.user.tenantId,
      "x-user-id": alice.user.userId,
    },
  });
  assert.equal(works.status, 200);
  assert.deepEqual(works.body.works, []);

  const foreignWork = await request(`/works/${aliceWorkId}`, {
    headers: {
      ...bearer(bob.token),
      "x-tenant-id": alice.user.tenantId,
      "x-user-id": alice.user.userId,
    },
  });
  assert.equal(foreignWork.status, 404);
});

test("approval and notification ownership cannot cross users", async () => {
  const duplicateToken = await request("/push-tokens", {
    method: "POST",
    headers: { ...bearer(bob.token), "content-type": "application/json" },
    body: JSON.stringify({
      token: alicePushToken,
      provider: "expo",
      platform: "android",
      appId: "com.example.secretary",
    }),
  });
  assert.equal(duplicateToken.status, 409);

  const disableForeignToken = await request("/push-tokens", {
    method: "DELETE",
    headers: { ...bearer(bob.token), "content-type": "application/json" },
    body: JSON.stringify({ token: alicePushToken }),
  });
  assert.equal(disableForeignToken.status, 200);
  assert.equal(disableForeignToken.body.registered, false);
  const [token] = await db.select().from(mobilePushTokensTable).where(eq(mobilePushTokensTable.token, alicePushToken));
  assert.equal(token?.enabled, 1);

  const approveForeign = await request(`/approvals/${randomUUID()}/approve`, {
    method: "POST",
    headers: { ...bearer(bob.token), "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(approveForeign.status, 404);
});

test("refresh rotates the refresh token and logout revokes the session", async () => {
  const fresh = await signup(`auth-refresh-${suffix}@example.test`);
  const refreshed = await request("/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-transport": "bearer" },
    body: JSON.stringify({ refreshToken: fresh.refreshToken }),
  });
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.body.refreshToken, fresh.refreshToken);
  const oldRefresh = await request("/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-transport": "bearer" },
    body: JSON.stringify({ refreshToken: fresh.refreshToken }),
  });
  assert.equal(oldRefresh.status, 401);
  const logout = await request("/auth/logout", {
    method: "POST",
    headers: { authorization: `Bearer ${refreshed.body.accessToken}` },
    body: JSON.stringify({ refreshToken: refreshed.body.refreshToken }),
  });
  assert.equal(logout.status, 204);
  const me = await request("/auth/me", { headers: bearer(refreshed.body.accessToken) });
  assert.equal(me.status, 401);
});

test("logout revokes access-only, refresh-only, and matching access-plus-refresh sessions", async () => {
  const accessOnly = await signup(`auth-logout-access-${suffix}@example.test`);
  const accessLogout = await request("/auth/logout", {
    method: "POST",
    headers: bearer(accessOnly.token),
  });
  assert.equal(accessLogout.status, 204);
  const accessRefresh = await request("/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-transport": "bearer" },
    body: JSON.stringify({ refreshToken: accessOnly.refreshToken }),
  });
  assert.equal(accessRefresh.status, 401);

  const refreshOnly = await signup(`auth-logout-refresh-${suffix}@example.test`);
  const refreshLogout = await request("/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: refreshOnly.refreshToken }),
  });
  assert.equal(refreshLogout.status, 204);
  const refreshAfterLogout = await request("/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-transport": "bearer" },
    body: JSON.stringify({ refreshToken: refreshOnly.refreshToken }),
  });
  assert.equal(refreshAfterLogout.status, 401);

  const both = await signup(`auth-logout-both-${suffix}@example.test`);
  const bothLogout = await request("/auth/logout", {
    method: "POST",
    headers: { ...bearer(both.token), "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: both.refreshToken }),
  });
  assert.equal(bothLogout.status, 204);
  const bothAfterLogout = await request("/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-transport": "bearer" },
    body: JSON.stringify({ refreshToken: both.refreshToken }),
  });
  assert.equal(bothAfterLogout.status, 401);
});

test("mismatched tokens cannot revoke either session", async () => {
  const first = await signup(`auth-logout-mismatch-a-${suffix}@example.test`);
  const second = await signup(`auth-logout-mismatch-b-${suffix}@example.test`);
  const logout = await request("/auth/logout", {
    method: "POST",
    headers: { ...bearer(first.token), "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: second.refreshToken }),
  });
  assert.equal(logout.status, 204);

  const firstMe = await request("/auth/me", { headers: bearer(first.token) });
  assert.equal(firstMe.status, 200);
  const secondRefresh = await request("/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-transport": "bearer" },
    body: JSON.stringify({ refreshToken: second.refreshToken }),
  });
  assert.equal(secondRefresh.status, 200);
});