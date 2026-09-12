import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import test from "node:test";

const port = 8091;
const baseUrl = `http://127.0.0.1:${port}/api`;
let server;

const headers = {
  Authorization: "Bearer dev-user",
  "Content-Type": "application/json",
};

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

async function startServer() {
  server = spawn("node", ["--enable-source-maps", "dist/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), AI_PROVIDER: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForHealth();
}

async function stopServer() {
  if (!server) return;
  const current = server;
  server = null;
  current.kill("SIGTERM");
  await once(current, "exit");
}

async function sendTurn(message, conversationId, idempotencyKey = `${conversationId}-${message}`) {
  const response = await fetch(`${baseUrl}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, conversationId, idempotencyKey }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

function queryDb(sql) {
  return execFileSync("psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    env: process.env,
    encoding: "utf8",
  }).trim();
}

test.before(async () => {
  await startServer();
});

test.after(async () => {
  await stopServer();
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

test("keeps conversation state across a restart and applies a multi-turn correction", async () => {
  const conversationId = `memory-correction-${Date.now()}`;
  const projectName = `المحجر-${Date.now()}`;

  const project = await sendTurn(`بدأت مشروع اسمه ${projectName}`, conversationId, `${conversationId}-project`);
  assert.equal(project.action.type, "project_created");

  await stopServer();
  await startServer();

  const person = await sendTurn("محمد هو المقاول", conversationId, `${conversationId}-person`);
  assert.equal(person.action.type, "person_linked");
  assert.equal(person.action.projectName, projectName);

  const expense = await sendTurn("ودفعتله 5000", conversationId, `${conversationId}-expense`);
  assert.equal(expense.action.type, "expense_recorded");
  assert.equal(expense.action.amountMinor, 500000);
  assert.equal(expense.action.projectName, projectName);

  const corrected = await sendTurn("لا، المبلغ كان 7500", conversationId, `${conversationId}-correction`);
  assert.equal(corrected.action.type, "expense_corrected");
  assert.equal(corrected.action.amountMinor, 750000);
  assert.equal(corrected.action.expenseId, expense.action.expenseId);

  const today = await fetch(`${baseUrl}/today`, { headers: { Authorization: "Bearer dev-user" } });
  assert.equal(today.status, 200);
  const todayPayload = await today.json();
  const matching = todayPayload.context.recentExpenses.filter(
    (item) => item.id === expense.action.expenseId,
  );
  assert.equal(matching.length, 1);
  assert.equal(matching[0].amountMinor, 750000);
  assert.equal(matching[0].projectName, projectName);
});

test("creates a bounded summary without turning conversation into structured memory", async () => {
  const conversationId = `memory-summary-${Date.now()}`;
  for (let index = 0; index < 8; index += 1) {
    await sendTurn(`رسالة سياق ${index} قصدي ده`, conversationId, `${conversationId}-${index}`);
  }

  const where = `tenant_id = 'development' AND owner_user_id = 'dev-user' AND conversation_id = '${conversationId}'`;
  const summary = queryDb(`SELECT summary FROM conversation_memory WHERE ${where}`);
  const recentState = queryDb(`SELECT recent_state_json FROM conversation_memory WHERE ${where}`);
  const turnCount = queryDb(`SELECT turn_count FROM conversation_memory WHERE ${where}`);
  assert.ok(summary.length > 0);
  assert.ok(summary.includes("رسالة سياق"));
  assert.ok(JSON.parse(recentState).length <= 6);
  assert.equal(Number(turnCount), 8);

  const structuredRows = queryDb(
    `SELECT count(*) FROM expenses WHERE tenant_id = 'development' AND owner_user_id = 'dev-user' AND description ILIKE '%رسالة سياق%'`,
  );
  assert.equal(Number(structuredRows), 0);
});

test("does not read another owner's conversation state", async () => {
  const conversationId = `memory-isolation-${Date.now()}`;
  const escapedState = JSON.stringify([{
    userMessage: "مشروع من مستخدم آخر",
    assistantMessage: "لا تستخدم هذا السياق",
    action: { type: "project_created", projectId: "foreign-project", projectName: "foreign" },
    createdAt: new Date().toISOString(),
  }]).replaceAll("'", "''");
  queryDb(
    `INSERT INTO conversation_memory (tenant_id, owner_user_id, conversation_id, recent_state_json, summary, turn_count) VALUES ('foreign-tenant', 'foreign-user', '${conversationId}', '${escapedState}', 'foreign summary', 1)`,
  );

  const response = await sendTurn("محمد هو المقاول", conversationId, `${conversationId}-isolation`);
  assert.equal(response.action.type, "clarification_needed");
  assert.notEqual(response.action.projectName, "foreign");
});