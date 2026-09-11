import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";

const port = 8091;
const baseUrl = `http://127.0.0.1:${port}/api`;
let server;

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("API server did not become healthy");
}

test.before(async () => {
  server = spawn("node", ["--enable-source-maps", "dist/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), AI_PROVIDER: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForHealth();
});

test.after(async () => {
  server.kill("SIGTERM");
  await once(server, "exit");
});

test("rejects unauthenticated Today requests", async () => {
  const response = await fetch(`${baseUrl}/today`);
  assert.equal(response.status, 401);
});

test("persists a natural-language expense and deduplicates an idempotent retry", async () => {
  const body = {
    message: "دفعت لاختبار المرحلة الثانية 275 جنيه اختبار تكامل",
    idempotencyKey: `phase2-integration-${Date.now()}`,
  };
  const headers = {
    Authorization: "Bearer dev-user",
    "Content-Type": "application/json",
  };

  const first = await fetch(`${baseUrl}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(first.status, 200);
  const firstPayload = await first.json();
  assert.equal(firstPayload.provider, "development");
  assert.equal(firstPayload.action.type, "expense_recorded");

  const retry = await fetch(`${baseUrl}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(retry.status, 200);
  const retryPayload = await retry.json();
  assert.equal(retryPayload.action.expenseId, firstPayload.action.expenseId);

  const today = await fetch(`${baseUrl}/today`, {
    headers: { Authorization: "Bearer dev-user" },
  });
  assert.equal(today.status, 200);
  const todayPayload = await today.json();
  assert.ok(
    todayPayload.context.recentExpenses.some(
      (expense) => expense.id === firstPayload.action.expenseId,
    ),
  );
});