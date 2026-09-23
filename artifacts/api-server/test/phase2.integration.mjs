import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import test from "node:test";

process.env.AI_PROVIDER = "development";
delete process.env.AI_PRIMARY_PROVIDER;
delete process.env.AI_FALLBACK_PROVIDER;
delete process.env.AI_SECONDARY_FALLBACK_PROVIDER;

const port = 8091 + (process.pid % 1000);
const baseUrl = `http://127.0.0.1:${port}/api`;
const testTenantId = `phase2-test-${process.pid}-${Date.now()}`;
const testUserId = "phase2-test-user";
let server;
let provider = "development";
let patternInsightsEnabled = false;

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
  const env = {
    ...process.env,
    PORT: String(port),
    AI_PROVIDER: provider,
    EXPERIMENTAL_PATTERN_INSIGHTS_ENABLED: patternInsightsEnabled ? "1" : "0",
    SECRETARY_TENANT_ID: testTenantId,
    SECRETARY_USER_ID: testUserId,
  };
  delete env.AI_PRIMARY_PROVIDER;
  delete env.AI_FALLBACK_PROVIDER;
  delete env.AI_SECONDARY_FALLBACK_PROVIDER;
  if (provider === "development" || provider === "unavailable") {
    delete env.GEMINI_API_KEY;
    delete env.GROQ_API_KEY;
    delete env.MISTRAL_API_KEY;
    delete env.COHERE_API_KEY;
    delete env.DEEPSEEK_API_KEY;
    delete env.QWEN_API_KEY;
    delete env.OPENROUTER_API_KEY;
  }
  if (provider === "unavailable") {
    delete env.AI_PROVIDER;
    env.AI_PROVIDER = "unavailable";
  }
  server = spawn("node", ["--enable-source-maps", "dist/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (provider === "groq") {
    server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  }
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForHealth();
}

async function stopServer() {
  if (!server) return;
  const current = server;
  server = null;
  const exit = once(current, "exit");
  current.kill("SIGTERM");
  const killTimer = setTimeout(() => current.kill("SIGKILL"), 1000);
  await exit;
  clearTimeout(killTimer);
}

async function sendTurn(message, conversationId, idempotencyKey = `${conversationId}-${message}`) {
  const response = await fetch(`${baseUrl}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, conversationId, idempotencyKey, channel: "main" }),
  });
  if (response.status !== 200) {
    const body = await response.text();
    const error = new Error(`turn failed with ${response.status}: ${body}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return response.json();
}

async function approveOperation(operationId) {
  const response = await fetch(`${baseUrl}/approvals/${operationId}/approve`, {
    method: "POST",
    headers,
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
}

async function rejectOperation(operationId) {
  const response = await fetch(`${baseUrl}/approvals/${operationId}/reject`, {
    method: "POST",
    headers,
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
}

async function sendApprovedTurn(message, conversationId, idempotencyKey) {
  const pending = await sendTurn(message, conversationId, idempotencyKey);
  if (pending.action?.type !== "approval_required") return pending;
  return approveOperation(pending.action.operationId);
}

async function sendRealTurnOrSkip(t, message, conversationId, idempotencyKey) {
  try {
    return await sendTurn(message, conversationId, idempotencyKey);
  } catch (error) {
    if ([429, 500, 502, 503, 504].includes(error.status)) {
      console.warn(`Groq smoke skipped after transient provider status ${error.status}.`);
      t.skip(`Groq provider returned transient status ${error.status}`);
      return null;
    }
    throw error;
  }
}

function queryDb(sql) {
  return execFileSync("psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    env: process.env,
    encoding: "utf8",
  }).trim();
}

const scopedWhere = `tenant_id = '${testTenantId}' AND owner_user_id = '${testUserId}'`;

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

test("returns classified validation and authentication errors", async () => {
  const unauthenticated = await fetch(`${baseUrl}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "اختبار" }),
  });
  assert.equal(unauthenticated.status, 401);
  const unauthenticatedPayload = await unauthenticated.json();
  assert.equal(unauthenticatedPayload.category, "authentication_error");
  assert.equal(unauthenticatedPayload.requestId, unauthenticated.headers.get("x-request-id"));

  const invalid = await fetch(`${baseUrl}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message: "" }),
  });
  assert.equal(invalid.status, 400);
  const invalidPayload = await invalid.json();
  assert.equal(invalidPayload.category, "validation_error");
  assert.equal(invalidPayload.code, "INVALID_TURN_BODY");
  assert.equal(invalidPayload.requestId, invalid.headers.get("x-request-id"));
});

test("classifies malformed JSON and missing routes without using a connection error", async () => {
  const malformed = await fetch(`${baseUrl}/turns`, {
    method: "POST",
    headers,
    body: "{not-json",
  });
  assert.equal(malformed.status, 400);
  const malformedPayload = await malformed.json();
  assert.equal(malformedPayload.category, "validation_error");
  assert.equal(malformedPayload.code, "INVALID_JSON_BODY");

  const missingRoute = await fetch(`${baseUrl}/missing-route`, {
    headers: { Authorization: "Bearer dev-user" },
  });
  assert.equal(missingRoute.status, 404);
  const missingPayload = await missingRoute.json();
  assert.equal(missingPayload.category, "not_found");
  assert.equal(missingPayload.requestId, missingRoute.headers.get("x-request-id"));
});

test("returns a provider-unavailable error instead of a connection error", async () => {
  await stopServer();
  provider = "unavailable";
  await startServer();

  const response = await fetch(`${baseUrl}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message: "اختبار مزود غير متاح", channel: "main" }),
  });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.category, "provider_unavailable");
  assert.equal(payload.code, "PROVIDER_NOT_CONFIGURED");
  assert.equal(payload.requestId, response.headers.get("x-request-id"));

  await stopServer();
  provider = "development";
  await startServer();
});

test("persists a natural-language expense and deduplicates an idempotent retry", async () => {
  const body = {
    message: "دفعت لاختبار المرحلة الثانية 275 جنيه اختبار تكامل",
    idempotencyKey: `phase2-integration-${Date.now()}`,
    channel: "main",
  };
  const first = await fetch(`${baseUrl}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(first.status, 200);
  const firstPayload = await first.json();
  assert.equal(firstPayload.provider, "development");
  assert.equal(firstPayload.action.type, "approval_required");
  assert.equal(firstPayload.action.status, "pending");
  assert.equal(Number(queryDb(
    `SELECT count(*) FROM expenses WHERE ${scopedWhere} AND description = 'اختبار تكامل'`,
  )), 0);

  const approved = await approveOperation(firstPayload.action.operationId);
  assert.equal(approved.status, "completed");
  assert.equal(approved.action.type, "expense_recorded");

  const retry = await fetch(`${baseUrl}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(retry.status, 200);
  const retryPayload = await retry.json();
  assert.equal(retryPayload.action.operationId, firstPayload.action.operationId);

  const approvalRetry = await approveOperation(firstPayload.action.operationId);
  assert.equal(approvalRetry.status, "completed");
  assert.equal(approvalRetry.action.expenseId, approved.action.expenseId);

  const today = await fetch(`${baseUrl}/today`, {
    headers: { Authorization: "Bearer dev-user" },
  });
  assert.equal(today.status, 200);
  const todayPayload = await today.json();
  assert.ok(
    todayPayload.context.recentExpenses.some(
      (expense) => expense.id === approved.action.expenseId,
    ),
  );
});

test("a retry after the client gives up keeps one pending save", async () => {
  const body = {
    message: "دفعت لاختبار المهلة 276 جنيه اختبار إعادة المحاولة",
    idempotencyKey: `phase2-timeout-${Date.now()}`,
    channel: "main",
  };
  const controller = new AbortController();
  const firstRequest = fetch(`${baseUrl}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: controller.signal,
  }).catch((error) => {
    if (error.name === "AbortError") return null;
    throw error;
  });
  setTimeout(() => controller.abort(), 1);
  await new Promise((resolve) => setTimeout(resolve, 5));

  const retry = await fetch(`${baseUrl}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(retry.status, 200);
  const retryPayload = await retry.json();
  assert.equal(retryPayload.action.type, "approval_required");

  const firstPayload = await firstRequest;
  if (firstPayload) {
    assert.equal(firstPayload.status, 200);
    const firstBody = await firstPayload.json();
    assert.equal(firstBody.action.operationId, retryPayload.action.operationId);
  }
  assert.equal(Number(queryDb(
    `SELECT count(*) FROM secretary_operations WHERE ${scopedWhere} AND id = '${retryPayload.action.operationId}'`,
  )), 1);
  await rejectOperation(retryPayload.action.operationId);
});

test("read-only turns do not create approval operations", async () => {
  const response = await sendTurn("إيه عندي النهارده؟", `readonly-${Date.now()}`, `readonly-${Date.now()}`);
  assert.notEqual(response.action?.type, "approval_required");
  assert.equal(response.provider, "development");
});

test("broad expense reports use a bounded deterministic response", async () => {
  const response = await sendTurn("تقرير بالمصروفات", `report-${Date.now()}`, `report-${Date.now()}`);
  assert.equal(response.action.type, "expense_report");
  assert.match(response.assistantMessage, /تقرير المصروفات|لا توجد مصروفات/);
});

test("historical unit audit blocks totals without changing stored values", async () => {
  const description = `legacy-unit-audit-${Date.now()}`;
  queryDb(`
    INSERT INTO expenses (tenant_id, owner_user_id, amount_minor, currency, description)
    VALUES ('${testTenantId}', '${testUserId}', 50, 'EGP', '${description}')
  `);
  const beforeAmount = queryDb(
    `SELECT amount_minor FROM expenses WHERE ${scopedWhere} AND description = '${description}'`,
  );
  const beforeOperations = Number(queryDb(
    `SELECT count(*) FROM secretary_operations WHERE ${scopedWhere}`,
  ));

  const response = await sendTurn(
    "تقرير بالمصروفات",
    `legacy-unit-audit-${Date.now()}`,
    `legacy-unit-audit-request-${Date.now()}`,
  );

  assert.equal(response.action.type, "expense_unit_audit_required");
  assert.equal(response.action.audit.reviewCount, 1);
  assert.equal(response.action.audit.records[0].stored.value, 50);
  assert.equal(response.action.audit.records[0].expected.minorPerMajor, 100);
  assert.match(response.assistantMessage, /مراجعة بشرية|بوحدة صغرى/);
  assert.equal(
    queryDb(`SELECT amount_minor FROM expenses WHERE ${scopedWhere} AND description = '${description}'`),
    beforeAmount,
  );
  assert.equal(
    Number(queryDb(`SELECT count(*) FROM secretary_operations WHERE ${scopedWhere}`)),
    beforeOperations,
  );

  queryDb(`DELETE FROM expenses WHERE ${scopedWhere} AND description = '${description}'`);
});

test("reminders ask for an optional exact time before approval", async () => {
  const conversationId = `reminder-time-${Date.now()}`;
  const first = await sendTurn("فكرني بكرة أراجع الفاتورة", conversationId, `${conversationId}-first`);
  assert.equal(first.action.type, "clarification_needed");
  assert.equal(first.action.awaitingReminderTime, true);

  const second = await sendTurn("الساعة 5 مساء", conversationId, `${conversationId}-second`);
  assert.equal(second.action.type, "approval_required");
  assert.match(second.action.display.details.join(" "), /أراجع الفاتورة/);
  assert.match(second.action.display.details.join(" "), /موعد|202|5/);
});

test("expenses allow an omitted recipient and collect the purpose", async () => {
  const conversationId = `optional-expense-${Date.now()}`;
  const first = await sendTurn("دفعت 250 جنيه", conversationId, `${conversationId}-first`);
  assert.equal(first.action.type, "clarification_needed");
  assert.equal(first.action.awaitingPersonOptional, true);

  const second = await sendTurn("بدون اسم", conversationId, `${conversationId}-second`);
  assert.equal(second.action.awaitingProjectOrPurpose, true);

  const third = await sendTurn("مستلزمات المكتب", conversationId, `${conversationId}-third`);
  assert.equal(third.action.type, "approval_required");
  assert.match(third.action.display.details.join(" "), /مستلزمات المكتب/);
});

test("record edits return approval and apply only after approval", async () => {
  const created = await sendApprovedTurn(
    `دفعت تعديل السجل ${Date.now()} 155 جنيه`,
    `record-edit-${Date.now()}`,
    `record-edit-create-${Date.now()}`,
  );
  assert.equal(created.action.type, "expense_recorded");

  const recordsBeforeEdit = await fetch(`${baseUrl}/records`, { headers });
  const recordsBeforeEditPayload = await recordsBeforeEdit.json();
  const savedExpense = recordsBeforeEditPayload.expenses.find(
    (expense) => expense.id === created.action.expenseId,
  );
  assert.ok(savedExpense);

  const edit = await fetch(`${baseUrl}/records/expense/${created.action.expenseId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      expectedRowVersion: savedExpense.rowVersion,
      amountMinor: created.action.amountMinor,
      description: "وصف بعد الموافقة",
    }),
  });
  assert.equal(edit.status, 202);
  const pending = await edit.json();
  assert.equal(pending.pendingApproval, true);
  assert.equal(pending.approval.toolName, "update_expense");

  const before = await fetch(`${baseUrl}/records`, { headers });
  const beforePayload = await before.json();
  assert.notEqual(
    beforePayload.expenses.find((expense) => expense.id === created.action.expenseId).description,
    "وصف بعد الموافقة",
  );

  const approved = await approveOperation(pending.approval.operationId);
  assert.equal(approved.status, "completed");

  const after = await fetch(`${baseUrl}/records`, { headers });
  const afterPayload = await after.json();
  assert.equal(
    afterPayload.expenses.find((expense) => expense.id === created.action.expenseId).description,
    "وصف بعد الموافقة",
  );
});

test("rejected approval never writes and cannot be replayed", async () => {
  const description = `رفض approval ${Date.now()}`;
  const pending = await sendTurn(`دفعت ${description} 125 جنيه`, `reject-${Date.now()}`, `reject-${Date.now()}`);
  assert.equal(pending.action.type, "approval_required");
  const rejected = await rejectOperation(pending.action.operationId);
  assert.equal(rejected.status, "rejected");
  const replay = await approveOperation(pending.action.operationId);
  assert.equal(replay.status, "rejected");
  assert.equal(Number(queryDb(
    `SELECT count(*) FROM expenses WHERE ${scopedWhere} AND description = '${description}'`,
  )), 0);
});

test("approval executes the stored action even when the client sends a different payload", async () => {
  const description = `stored approval ${Date.now()}`;
  const pending = await sendTurn(`دفعت ${description} 135 جنيه`, `stored-${Date.now()}`, `stored-${Date.now()}`);
  assert.equal(pending.action.type, "approval_required");
  const response = await fetch(`${baseUrl}/approvals/${pending.action.operationId}/approve`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      toolName: "create_project",
      arguments: { name: "يجب ألا ينشأ هذا المشروع" },
    }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.status, "completed");
  assert.equal(payload.action.type, "expense_recorded");
  assert.equal(Number(queryDb(
    `SELECT count(*) FROM expenses WHERE ${scopedWhere} AND description ILIKE '%stored approval%'`,
  )), 1);
  assert.equal(Number(queryDb(
    `SELECT count(*) FROM projects WHERE ${scopedWhere} AND name = 'يجب ألا ينشأ هذا المشروع'`,
  )), 0);
});

test("concurrent approval requests claim one operation and write once", async () => {
  const description = `concurrent approval ${Date.now()}`;
  const pending = await sendTurn(`دفعت ${description} 145 جنيه`, `concurrent-${Date.now()}`, `concurrent-${Date.now()}`);
  assert.equal(pending.action.type, "approval_required");
  const results = await Promise.all([
    approveOperation(pending.action.operationId),
    approveOperation(pending.action.operationId),
  ]);
  assert.ok(results.every((result) => ["completed", "executing"].includes(result.status)));
  assert.equal(Number(queryDb(
    `SELECT count(*) FROM expenses WHERE ${scopedWhere} AND description ILIKE '%concurrent approval%'`,
  )), 1);
});

test("understands equivalent natural expense phrases without punctuation", async () => {
  const messages = [
    "دفعت لمحمد 7500",
    "محمد خد مني 7500",
    "أنا اديت محمد سبعة آلاف ونص",
    "سجل 7500 لمحمد",
    "سجل مصروف لمحمد بمبلغ 7500",
  ];

  for (const [index, message] of messages.entries()) {
    const response = await sendApprovedTurn(message, `natural-variants-${index}`, `natural-variants-${index}`);
    assert.equal(response.action.type, "expense_recorded");
    assert.equal(response.action.amountMinor, 750000);
    assert.equal(response.action.personName, "محمد");
  }
});

test("asks for a missing amount and completes the expense on the next turn", async () => {
  const conversationId = `missing-amount-${Date.now()}`;
  const clarification = await sendTurn("عايز أسجل مصروف لمحمد", conversationId, `${conversationId}-ask`);
  assert.equal(clarification.action.type, "clarification_needed");
  assert.equal(clarification.action.awaitingAmount, true);

  const completed = await sendApprovedTurn("7500", conversationId, `${conversationId}-amount`);
  assert.equal(completed.action.type, "expense_recorded");
  assert.equal(completed.action.amountMinor, 750000);
  assert.equal(completed.action.personName, "محمد");
});

test("corrects a previous amount without creating another expense", async () => {
  const conversationId = `natural-correction-${Date.now()}`;
  const first = await sendApprovedTurn("سجلت لمحمد 5000", conversationId, `${conversationId}-first`);
  assert.equal(first.action.type, "expense_recorded");
  const corrected = await sendApprovedTurn("لا، قصدي 7500", conversationId, `${conversationId}-correct`);
  assert.equal(corrected.action.type, "expense_corrected");
  assert.equal(corrected.action.expenseId, first.action.expenseId);
  assert.equal(corrected.action.amountMinor, 750000);

  const rows = queryDb(
    `SELECT count(*) FROM expenses WHERE ${scopedWhere} AND id = '${first.action.expenseId}'`,
  );
  assert.equal(Number(rows), 1);
});

test("asks about duplicate projects and uses the selected project in later turns", async () => {
  const projectName = "المحجر";
  queryDb(
    `INSERT INTO projects (tenant_id, owner_user_id, name, name_key, status)
     VALUES ('${testTenantId}', '${testUserId}', '${projectName}', '${projectName}', 'active'),
            ('${testTenantId}', '${testUserId}', '${projectName}', '${projectName}', 'active')`,
  );
  const conversationId = `duplicate-project-${Date.now()}`;
  const clarification = await sendTurn(
    "دفعت لمحمد 7500 على المحجر",
    conversationId,
    `${conversationId}-ask`,
  );
  assert.equal(clarification.action.type, "clarification_needed");
  assert.equal(clarification.action.reason, "ambiguous_project");
  assert.equal(clarification.action.projectCandidates.length, 2);

  const selected = await sendApprovedTurn("الأول", conversationId, `${conversationId}-select`);
  assert.equal(selected.action.type, "expense_recorded");
  assert.equal(selected.action.projectId, clarification.action.projectCandidates[0].id);
  assert.equal(selected.action.projectCandidates.length, 2);

  const corrected = await sendApprovedTurn(
    "مش ده، المشروع التاني",
    conversationId,
    `${conversationId}-project-correction`,
  );
  assert.equal(corrected.action.type, "expense_project_corrected");
  assert.equal(corrected.action.projectId, clarification.action.projectCandidates[1].id);
});

test("keeps conversation state across a restart and applies a multi-turn correction", async () => {
  const conversationId = `memory-correction-${Date.now()}`;
  const projectName = `المحجر-${Date.now()}`;

  const project = await sendApprovedTurn(`بدأت مشروع اسمه ${projectName}`, conversationId, `${conversationId}-project`);
  assert.equal(project.action.type, "project_created");

  await stopServer();
  await startServer();

  const person = await sendApprovedTurn("محمد هو المقاول", conversationId, `${conversationId}-person`);
  assert.equal(person.action.type, "person_linked");
  assert.equal(person.action.projectName, projectName);

  const expense = await sendApprovedTurn("ودفعتله 5000", conversationId, `${conversationId}-expense`);
  assert.equal(expense.action.type, "expense_recorded");
  assert.equal(expense.action.amountMinor, 500000);
  assert.equal(expense.action.projectName, projectName);

  const corrected = await sendApprovedTurn("لا، المبلغ كان 7500", conversationId, `${conversationId}-correction`);
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

  const where = `${scopedWhere} AND conversation_id = '${conversationId}'`;
  const summary = queryDb(`SELECT summary FROM conversation_memory WHERE ${where}`);
  const recentState = queryDb(`SELECT recent_state_json FROM conversation_memory WHERE ${where}`);
  const turnCount = queryDb(`SELECT turn_count FROM conversation_memory WHERE ${where}`);
  assert.ok(summary.length > 0);
  assert.ok(summary.includes("رسالة سياق"));
  assert.ok(JSON.parse(recentState).length <= 6);
  assert.equal(Number(turnCount), 8);

  const structuredRows = queryDb(
    `SELECT count(*) FROM expenses WHERE ${scopedWhere} AND description ILIKE '%رسالة سياق%'`,
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

test("derives experimental patterns from tenant-scoped historical rows", async () => {
  await stopServer();
  patternInsightsEnabled = true;
  await startServer();

  const personId = `00000000-0000-4000-8000-${String(Date.now()).slice(-12).padStart(12, "0")}`;
  const projectId = `00000000-0000-4000-8001-${String(Date.now() + 1).slice(-12).padStart(12, "0")}`;
  const foreignPersonId = `00000000-0000-4000-8002-${String(Date.now() + 2).slice(-12).padStart(12, "0")}`;
  const foreignProjectId = `00000000-0000-4000-8003-${String(Date.now() + 3).slice(-12).padStart(12, "0")}`;
  const relationshipId = `00000000-0000-4000-8004-${String(Date.now() + 4).slice(-12).padStart(12, "0")}`;
  const escapedTenant = testTenantId.replaceAll("'", "''");
  const escapedUser = testUserId.replaceAll("'", "''");

  queryDb(`
    INSERT INTO people (id, tenant_id, owner_user_id, name, name_key)
    VALUES
      ('${personId}', '${escapedTenant}', '${escapedUser}', 'نمط الاختبار', 'نمط الاختبار'),
      ('${foreignPersonId}', 'foreign-pattern-tenant', 'foreign-pattern-user', 'نمط خارجي', 'نمط خارجي');
    INSERT INTO projects (id, tenant_id, owner_user_id, name, name_key, status)
    VALUES
      ('${projectId}', '${escapedTenant}', '${escapedUser}', 'مشروع النمط', 'مشروع النمط', 'active'),
      ('${foreignProjectId}', 'foreign-pattern-tenant', 'foreign-pattern-user', 'مشروع خارجي', 'مشروع خارجي', 'active');
    INSERT INTO project_people (id, tenant_id, owner_user_id, project_id, person_id, relationship)
    VALUES ('${relationshipId}', '${escapedTenant}', '${escapedUser}', '${projectId}', '${personId}', 'مورد');
    INSERT INTO expenses (
      tenant_id, owner_user_id, amount_minor, currency, description, person_id, project_id, occurred_at
    )
    SELECT '${escapedTenant}', '${escapedUser}', 250000, 'egp', 'نمط متكرر', '${personId}'::uuid, '${projectId}'::uuid, now() - interval '60 days'
    UNION ALL
    SELECT '${escapedTenant}', '${escapedUser}', 250000, 'EGP', 'نمط متكرر', '${personId}'::uuid, '${projectId}'::uuid, now() - interval '30 days'
    UNION ALL
    SELECT '${escapedTenant}', '${escapedUser}', 250000, 'EGP', 'نمط متكرر', '${personId}'::uuid, '${projectId}'::uuid, now()
    UNION ALL
    SELECT 'foreign-pattern-tenant', 'foreign-pattern-user', 250000, 'EGP', 'لا يجب أن يظهر', '${foreignPersonId}'::uuid, '${foreignProjectId}'::uuid, now() - interval '60 days'
    UNION ALL
    SELECT 'foreign-pattern-tenant', 'foreign-pattern-user', 250000, 'EGP', 'لا يجب أن يظهر', '${foreignPersonId}'::uuid, '${foreignProjectId}'::uuid, now() - interval '30 days'
    UNION ALL
    SELECT 'foreign-pattern-tenant', 'foreign-pattern-user', 250000, 'EGP', 'لا يجب أن يظهر', '${foreignPersonId}'::uuid, '${foreignProjectId}'::uuid, now();
  `);

  const response = await sendTurn(
    "اختبار قراءة الأنماط التاريخية",
    `pattern-history-${Date.now()}`,
    `pattern-history-${Date.now()}-request`,
  );
  const insights = response.action?.patternInsights ?? [];
  const recurring = insights.find((insight) => insight.kind === "recurring_expense");
  const frequent = insights.find((insight) => insight.kind === "frequent_entity");
  const relationship = insights.find((insight) => insight.kind === "relationship");

  assert.equal(response.action?.patternInsights?.length > 0, true);
  assert.equal(recurring?.evidence, "observation");
  assert.equal(recurring?.value.observations, 3);
  assert.equal(recurring?.value.currency, "EGP");
  assert.equal(frequent?.value.entity, `person:${personId}`);
  assert.equal(frequent?.value.observations, 3);
  assert.equal(relationship?.evidence, "fact");
  assert.equal(relationship?.value.personId, personId);
  assert.equal(relationship?.value.projectId, projectId);
  assert.equal(insights.some((insight) => JSON.stringify(insight).includes("foreign-pattern")), false);

  await stopServer();
  patternInsightsEnabled = false;
  await startServer();
  const disabled = await sendTurn(
    "اختبار بعد تعطيل الأنماط",
    `pattern-disabled-${Date.now()}`,
    `pattern-disabled-${Date.now()}-request`,
  );
  assert.equal(Object.prototype.hasOwnProperty.call(disabled.action ?? {}, "patternInsights"), false);
});

test("runs a real Groq turn and keeps tool output compact", {
  skip: process.env.RUN_REAL_LLM_TESTS !== "1",
}, async (t) => {
  await stopServer();
  provider = "groq";
  await startServer();

  const todayConversation = `groq-summary-${Date.now()}`;
  const today = await sendRealTurnOrSkip(
    t,
    "إيه عندي النهارده؟",
    todayConversation,
    `${todayConversation}-today`,
  );
  if (!today) return;
  assert.equal(today.provider, "groq");
  assert.ok(today.assistantMessage.length < 1800);
  assert.ok((today.assistantMessage.match(/7[٬,]?500/g) ?? []).length <= 4);

  const stored = queryDb(
    `SELECT recent_state_json FROM conversation_memory WHERE ${scopedWhere} AND conversation_id = '${todayConversation}'`,
  );
  assert.ok(stored.length > 0);
  assert.ok(stored.length < 3500);
  assert.equal(stored.includes('"expenses":['), false);

  const reportConversation = `groq-report-${Date.now()}`;
  const report = await sendRealTurnOrSkip(
    t,
    "عايز تقرير بالمصروفات",
    reportConversation,
    `${reportConversation}-first`,
  );
  if (!report) return;
  assert.equal(report.provider, "groq");
  assert.ok(report.response?.kind);
  assert.ok(report.assistantMessage.length > 0);
});

test("runs the real conversational reference flow in one isolated conversation", {
  skip: process.env.RUN_REAL_LLM_TESTS !== "1",
}, async (t) => {
  const conversationId = `groq-conversation-${Date.now()}`;
  const messages = [
    "محمد خد مني 7500 في المحجر",
    "لأ، مش المحجر ده، المشروع التاني",
    "خليهم 8000",
    "أنا دفعت لمحمد كام؟",
    "فاكر الفلوس اللي اديتهاله؟",
    "طب وريني كل مصروفاتي الشهر اللي فات",
    "وأنهي مشروع صرفت فيه أكتر؟",
    "طب من غير المحجر",
  ];
  const responses = [];
  for (const [index, message] of messages.entries()) {
    const response = await sendRealTurnOrSkip(t, message, conversationId, `${conversationId}-${index}`);
    if (!response) return;
    assert.equal(response.provider, "groq");
    assert.ok(response.response?.kind);
    assert.ok(response.assistantMessage.length > 0);
    responses.push(response);
  }

  assert.ok(
    responses.some((response) => response.action?.lastTool === "record_expense"),
    "the model should use the write tool for the first expense",
  );
  assert.ok(
    responses.some((response) => response.action?.lastTool === "update_expense"),
    "the model should use update_expense for the correction",
  );
  assert.ok(
    responses.some((response) => response.action?.lastTool === "rank_expense_projects"),
    "the model should use database ranking for project comparisons",
  );
});