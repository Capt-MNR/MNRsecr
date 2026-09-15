import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import test from "node:test";

const port = 8093;
const baseUrl = `http://127.0.0.1:${port}/api`;
const tenantId = `phase3-records-${process.pid}-${Date.now()}`;
const userId = "phase3-records-owner";
const otherUserId = "phase3-records-other-user";
const otherTenantId = `${tenantId}-other-tenant`;
const serverHeaders = {
  Authorization: "Bearer dev-user",
  "Content-Type": "application/json",
};

const ids = {
  ownerConversation: "a1000000-0000-4000-8000-000000000001",
  foreignConversation: "a1000000-0000-4000-8000-000000000002",
  linkedPerson: "a1000000-0000-4000-8000-000000000010",
  freePerson: "a1000000-0000-4000-8000-000000000011",
  foreignPersonSameTenant: "a1000000-0000-4000-8000-000000000012",
  foreignPersonOtherTenant: "a1000000-0000-4000-8000-000000000013",
  linkedProject: "a1000000-0000-4000-8000-000000000020",
  freeProject: "a1000000-0000-4000-8000-000000000021",
  foreignProjectSameTenant: "a1000000-0000-4000-8000-000000000022",
  foreignProjectOtherTenant: "a1000000-0000-4000-8000-000000000023",
  linkedExpense: "a1000000-0000-4000-8000-000000000030",
  crudExpense: "a1000000-0000-4000-8000-000000000031",
  foreignExpenseSameTenant: "a1000000-0000-4000-8000-000000000032",
  foreignExpenseOtherTenant: "a1000000-0000-4000-8000-000000000033",
  ownerTask: "a1000000-0000-4000-8000-000000000040",
  undoChangedTask: "a1000000-0000-4000-8000-000000000041",
  undoSuccessTask: "a1000000-0000-4000-8000-000000000042",
  foreignTaskSameTenant: "a1000000-0000-4000-8000-000000000043",
  foreignTaskOtherTenant: "a1000000-0000-4000-8000-000000000044",
  ownerReminder: "a1000000-0000-4000-8000-000000000050",
  foreignReminderSameTenant: "a1000000-0000-4000-8000-000000000051",
  foreignReminderOtherTenant: "a1000000-0000-4000-8000-000000000052",
  linkedCommitment: "a1000000-0000-4000-8000-000000000060",
  ownerCommitment: "a1000000-0000-4000-8000-000000000061",
  foreignCommitmentSameTenant: "a1000000-0000-4000-8000-000000000062",
  foreignCommitmentOtherTenant: "a1000000-0000-4000-8000-000000000063",
  projectPersonLink: "a1000000-0000-4000-8000-000000000070",
};

let server;

function queryDb(sql) {
  return execFileSync(
    "psql",
    ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      env: process.env,
      encoding: "utf8",
    },
  ).trim();
}

function scalar(table, id, column = "id") {
  const expression =
    column === "created_at"
      ? `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
      : column;
  return queryDb(
    `SELECT ${expression} FROM ${table} WHERE id = '${id}' LIMIT 1`,
  );
}

function rowCount(table, id) {
  return Number(queryDb(`SELECT count(*) FROM ${table} WHERE id = '${id}'`));
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
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
    AI_PROVIDER: "unavailable",
    SECRETARY_TENANT_ID: tenantId,
    SECRETARY_USER_ID: userId,
  };
  delete env.GEMINI_API_KEY;
  delete env.GROQ_API_KEY;
  server = spawn("node", ["--enable-source-maps", "dist/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env,
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

async function request(path, options = {}) {
  const { authenticated = true, headers = {}, ...fetchOptions } = options;
  return fetch(`${baseUrl}${path}`, {
    ...fetchOptions,
    headers: {
      ...(authenticated ? serverHeaders : {}),
      ...headers,
    },
  });
}

async function jsonRequest(path, method, body, headers = {}) {
  return request(path, {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

async function assertUnauthorized(path, options = {}) {
  const response = await request(path, {
    ...options,
    authenticated: false,
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(response.status, 401, `${options.method ?? "GET"} ${path}`);
  const body = await response.json();
  assert.equal(body.code, "AUTHENTICATION_REQUIRED");
  assert.equal(body.category, "authentication_error");
  assert.equal(body.requestId, response.headers.get("x-request-id"));
}

function seedFixtures() {
  queryDb(`
    INSERT INTO people (id, tenant_id, owner_user_id, name, name_key, notes)
    VALUES
      ('${ids.linkedPerson}', '${tenantId}', '${userId}', 'Linked Person', 'linked-person', 'owner'),
      ('${ids.freePerson}', '${tenantId}', '${userId}', 'Free Person', 'free-person', 'owner'),
      ('${ids.foreignPersonSameTenant}', '${tenantId}', '${otherUserId}', 'Foreign User Person', 'foreign-user-person', 'foreign'),
      ('${ids.foreignPersonOtherTenant}', '${otherTenantId}', '${userId}', 'Foreign Tenant Person', 'foreign-tenant-person', 'foreign');

    INSERT INTO projects (id, tenant_id, owner_user_id, name, name_key, status)
    VALUES
      ('${ids.linkedProject}', '${tenantId}', '${userId}', 'Linked Project', 'linked-project', 'active'),
      ('${ids.freeProject}', '${tenantId}', '${userId}', 'Free Project', 'free-project', 'active'),
      ('${ids.foreignProjectSameTenant}', '${tenantId}', '${otherUserId}', 'Foreign User Project', 'foreign-user-project', 'active'),
      ('${ids.foreignProjectOtherTenant}', '${otherTenantId}', '${userId}', 'Foreign Tenant Project', 'foreign-tenant-project', 'active');

    INSERT INTO expenses (id, tenant_id, owner_user_id, amount_minor, currency, description, person_id, project_id, occurred_at)
    VALUES
      ('${ids.linkedExpense}', '${tenantId}', '${userId}', 12500, 'EGP', 'Linked expense', '${ids.linkedPerson}', '${ids.linkedProject}', '2026-09-01T10:00:00Z'),
      ('${ids.crudExpense}', '${tenantId}', '${userId}', 15000, 'EGP', 'CRUD expense', NULL, NULL, '2026-09-01T11:00:00Z'),
      ('${ids.foreignExpenseSameTenant}', '${tenantId}', '${otherUserId}', 22500, 'EGP', 'Foreign user expense', '${ids.foreignPersonSameTenant}', '${ids.foreignProjectSameTenant}', '2026-09-02T10:00:00Z'),
      ('${ids.foreignExpenseOtherTenant}', '${otherTenantId}', '${userId}', 32500, 'EGP', 'Foreign tenant expense', '${ids.foreignPersonOtherTenant}', '${ids.foreignProjectOtherTenant}', '2026-09-03T10:00:00Z');

    INSERT INTO tasks (id, tenant_id, owner_user_id, title, due_at, status)
    VALUES
      ('${ids.ownerTask}', '${tenantId}', '${userId}', 'Owner task', '2026-09-10T10:00:00Z', 'pending'),
      ('${ids.undoChangedTask}', '${tenantId}', '${userId}', 'Changed undo task', '2026-09-11T10:00:00Z', 'pending'),
      ('${ids.undoSuccessTask}', '${tenantId}', '${userId}', 'Successful undo task', '2026-09-12T10:00:00Z', 'pending'),
      ('${ids.foreignTaskSameTenant}', '${tenantId}', '${otherUserId}', 'Foreign user task', '2026-09-13T10:00:00Z', 'pending'),
      ('${ids.foreignTaskOtherTenant}', '${otherTenantId}', '${userId}', 'Foreign tenant task', '2026-09-14T10:00:00Z', 'pending');

    INSERT INTO reminders (id, tenant_id, owner_user_id, text, due_at, timezone, status)
    VALUES
      ('${ids.ownerReminder}', '${tenantId}', '${userId}', 'Owner reminder', '2026-09-15T10:00:00Z', 'Africa/Cairo', 'scheduled'),
      ('${ids.foreignReminderSameTenant}', '${tenantId}', '${otherUserId}', 'Foreign user reminder', '2026-09-16T10:00:00Z', 'Africa/Cairo', 'scheduled'),
      ('${ids.foreignReminderOtherTenant}', '${otherTenantId}', '${userId}', 'Foreign tenant reminder', '2026-09-17T10:00:00Z', 'Africa/Cairo', 'scheduled');

    INSERT INTO commitments (id, tenant_id, owner_user_id, title, person_id, due_at, status)
    VALUES
      ('${ids.linkedCommitment}', '${tenantId}', '${userId}', 'Linked commitment', '${ids.linkedPerson}', '2026-09-18T10:00:00Z', 'open'),
      ('${ids.ownerCommitment}', '${tenantId}', '${userId}', 'Owner commitment', NULL, '2026-09-19T10:00:00Z', 'open'),
      ('${ids.foreignCommitmentSameTenant}', '${tenantId}', '${otherUserId}', 'Foreign user commitment', '${ids.foreignPersonSameTenant}', '2026-09-20T10:00:00Z', 'open'),
      ('${ids.foreignCommitmentOtherTenant}', '${otherTenantId}', '${userId}', 'Foreign tenant commitment', '${ids.foreignPersonOtherTenant}', '2026-09-21T10:00:00Z', 'open');

    INSERT INTO project_people (id, tenant_id, owner_user_id, project_id, person_id, relationship)
    VALUES ('${ids.projectPersonLink}', '${tenantId}', '${userId}', '${ids.linkedProject}', '${ids.linkedPerson}', 'owner');

    INSERT INTO conversation_memory (tenant_id, owner_user_id, conversation_id, recent_state_json, summary, turn_count)
    VALUES
      ('${tenantId}', '${userId}', 'owner-conversation', '[{"userMessage":"Owner conversation","assistantMessage":"Owner reply","createdAt":"2026-09-01T10:00:00.000Z"}]', 'Owner summary', 1),
      ('${tenantId}', '${otherUserId}', 'foreign-conversation', '[{"userMessage":"Foreign conversation","assistantMessage":"Foreign reply","createdAt":"2026-09-01T10:00:00.000Z"}]', 'Foreign summary', 1);
  `);
}

test.before(async () => {
  seedFixtures();
  await startServer();
});

test.after(async () => {
  await stopServer();
  queryDb(`
    DELETE FROM conversation_memory WHERE tenant_id IN ('${tenantId}', '${otherTenantId}');
    DELETE FROM project_people WHERE tenant_id IN ('${tenantId}', '${otherTenantId}');
    DELETE FROM expenses WHERE tenant_id IN ('${tenantId}', '${otherTenantId}');
    DELETE FROM commitments WHERE tenant_id IN ('${tenantId}', '${otherTenantId}');
    DELETE FROM tasks WHERE tenant_id IN ('${tenantId}', '${otherTenantId}');
    DELETE FROM reminders WHERE tenant_id IN ('${tenantId}', '${otherTenantId}');
    DELETE FROM projects WHERE tenant_id IN ('${tenantId}', '${otherTenantId}');
    DELETE FROM people WHERE tenant_id IN ('${tenantId}', '${otherTenantId}');
  `);
});

test("requires authentication for conversation and record routes", async () => {
  await assertUnauthorized("/conversations");
  await assertUnauthorized("/conversations/owner-conversation");
  await assertUnauthorized("/records");
  await assertUnauthorized("/records/person/${ids.freePerson}", {
    method: "PATCH",
    body: "{}",
  });
  await assertUnauthorized("/records/person/${ids.freePerson}", {
    method: "DELETE",
  });
  await assertUnauthorized("/records/undo", {
    method: "POST",
    body: JSON.stringify({
      recordType: "task",
      recordId: ids.ownerTask,
      createdAt: "2026-09-01T00:00:00.000Z",
    }),
  });
});

test("isolates conversations and records by tenant and user", async () => {
  const conversations = await request("/conversations");
  assert.equal(conversations.status, 200);
  const conversationPayload = await conversations.json();
  assert.deepEqual(
    conversationPayload.conversations.map((item) => item.conversationId),
    ["owner-conversation"],
  );

  const foreignConversation = await request(
    "/conversations/foreign-conversation",
  );
  assert.equal(foreignConversation.status, 404);

  const records = await request("/records");
  assert.equal(records.status, 200);
  const payload = await records.json();
  for (const [kind, foreignIds] of Object.entries({
    expenses: [ids.foreignExpenseSameTenant, ids.foreignExpenseOtherTenant],
    people: [ids.foreignPersonSameTenant, ids.foreignPersonOtherTenant],
    projects: [ids.foreignProjectSameTenant, ids.foreignProjectOtherTenant],
    tasks: [ids.foreignTaskSameTenant, ids.foreignTaskOtherTenant],
    reminders: [ids.foreignReminderSameTenant, ids.foreignReminderOtherTenant],
    commitments: [
      ids.foreignCommitmentSameTenant,
      ids.foreignCommitmentOtherTenant,
    ],
  })) {
    const visibleIds = payload[kind].map((record) => record.id);
    for (const foreignId of foreignIds)
      assert.equal(
        visibleIds.includes(foreignId),
        false,
        `${kind} leaked ${foreignId}`,
      );
  }
});

const recordKinds = [
  {
    kind: "expense",
    table: "expenses",
    ownerId: ids.crudExpense,
    foreignIds: [ids.foreignExpenseSameTenant, ids.foreignExpenseOtherTenant],
    update: { amountMinor: 14000, description: "Updated expense" },
    changedColumn: "description",
    changedValue: "Updated expense",
  },
  {
    kind: "person",
    table: "people",
    ownerId: ids.freePerson,
    foreignIds: [ids.foreignPersonSameTenant, ids.foreignPersonOtherTenant],
    update: { name: "Updated free person" },
    changedColumn: "name",
    changedValue: "Updated free person",
  },
  {
    kind: "project",
    table: "projects",
    ownerId: ids.freeProject,
    foreignIds: [ids.foreignProjectSameTenant, ids.foreignProjectOtherTenant],
    update: { name: "Updated free project" },
    changedColumn: "name",
    changedValue: "Updated free project",
  },
  {
    kind: "task",
    table: "tasks",
    ownerId: ids.ownerTask,
    foreignIds: [ids.foreignTaskSameTenant, ids.foreignTaskOtherTenant],
    update: { title: "Updated owner task", status: "done" },
    changedColumn: "title",
    changedValue: "Updated owner task",
  },
  {
    kind: "reminder",
    table: "reminders",
    ownerId: ids.ownerReminder,
    foreignIds: [ids.foreignReminderSameTenant, ids.foreignReminderOtherTenant],
    update: { text: "Updated owner reminder", status: "completed" },
    changedColumn: "text",
    changedValue: "Updated owner reminder",
  },
  {
    kind: "commitment",
    table: "commitments",
    ownerId: ids.ownerCommitment,
    foreignIds: [
      ids.foreignCommitmentSameTenant,
      ids.foreignCommitmentOtherTenant,
    ],
    update: { title: "Updated owner commitment", status: "closed" },
    changedColumn: "title",
    changedValue: "Updated owner commitment",
  },
];

test("updates and deletes every owned record type without crossing tenant or user boundaries", async () => {
  for (const record of recordKinds) {
    for (const foreignId of record.foreignIds) {
      const updateResponse = await jsonRequest(
        `/records/${record.kind}/${foreignId}`,
        "PATCH",
        record.update,
      );
      assert.equal(updateResponse.status, 404, `${record.kind} foreign update`);
      const updatePayload = await updateResponse.json();
      assert.equal(updatePayload.code, "RECORD_UPDATE_FAILED");

      const deleteResponse = await request(
        `/records/${record.kind}/${foreignId}`,
        { method: "DELETE" },
      );
      assert.equal(deleteResponse.status, 404, `${record.kind} foreign delete`);
      const deletePayload = await deleteResponse.json();
      assert.equal(deletePayload.code, "RECORD_DELETE_FAILED");
      assert.equal(rowCount(record.table, foreignId), 1);
    }

    const updateResponse = await jsonRequest(
      `/records/${record.kind}/${record.ownerId}`,
      "PATCH",
      record.update,
    );
    assert.equal(updateResponse.status, 200, `${record.kind} owned update`);
    const updatePayload = await updateResponse.json();
    assert.equal(updatePayload.ok, true);
    assert.equal(updatePayload.recordId, record.ownerId);
    assert.equal(
      updatePayload.record[record.changedColumn],
      record.changedValue,
    );
    assert.equal(
      scalar(record.table, record.ownerId, record.changedColumn),
      record.changedValue,
    );

    const deleteResponse = await request(
      `/records/${record.kind}/${record.ownerId}`,
      { method: "DELETE" },
    );
    assert.equal(deleteResponse.status, 200, `${record.kind} owned delete`);
    const deletePayload = await deleteResponse.json();
    assert.equal(deletePayload.ok, true);
    assert.equal(deletePayload.deleted, true);
    assert.equal(rowCount(record.table, record.ownerId), 0);
  }
});

test("refuses to delete people and projects with owned financial or linked records", async () => {
  const personResponse = await request(`/records/person/${ids.linkedPerson}`, {
    method: "DELETE",
  });
  assert.equal(personResponse.status, 404);
  assert.equal((await personResponse.json()).code, "RECORD_DELETE_FAILED");
  assert.equal(rowCount("people", ids.linkedPerson), 1);
  assert.equal(rowCount("expenses", ids.linkedExpense), 1);
  assert.equal(rowCount("commitments", ids.linkedCommitment), 1);

  const projectResponse = await request(
    `/records/project/${ids.linkedProject}`,
    { method: "DELETE" },
  );
  assert.equal(projectResponse.status, 404);
  assert.equal((await projectResponse.json()).code, "RECORD_DELETE_FAILED");
  assert.equal(rowCount("projects", ids.linkedProject), 1);
  assert.equal(rowCount("expenses", ids.linkedExpense), 1);
  assert.equal(rowCount("project_people", ids.projectPersonLink), 1);
});

test("undo only deletes the exact owned record version and identity", async () => {
  const changedCreatedAt = scalar("tasks", ids.undoChangedTask, "created_at");
  queryDb(
    `UPDATE tasks SET created_at = '2026-09-13T12:00:00Z' WHERE id = '${ids.undoChangedTask}'`,
  );
  const changedUndo = await jsonRequest("/records/undo", "POST", {
    recordType: "task",
    recordId: ids.undoChangedTask,
    createdAt: changedCreatedAt,
  });
  assert.equal(changedUndo.status, 404);
  assert.equal((await changedUndo.json()).code, "UNDO_NOT_APPLIED");
  assert.equal(rowCount("tasks", ids.undoChangedTask), 1);

  const foreignCreatedAt = scalar(
    "tasks",
    ids.foreignTaskSameTenant,
    "created_at",
  );
  const foreignUndo = await jsonRequest("/records/undo", "POST", {
    recordType: "task",
    recordId: ids.foreignTaskSameTenant,
    createdAt: foreignCreatedAt,
  });
  assert.equal(foreignUndo.status, 404);
  assert.equal((await foreignUndo.json()).code, "UNDO_NOT_APPLIED");
  assert.equal(rowCount("tasks", ids.foreignTaskSameTenant), 1);

  const successCreatedAt = scalar("tasks", ids.undoSuccessTask, "created_at");
  const successUndo = await jsonRequest("/records/undo", "POST", {
    recordType: "task",
    recordId: ids.undoSuccessTask,
    createdAt: successCreatedAt,
  });
  assert.equal(successUndo.status, 200);
  assert.equal((await successUndo.json()).deleted, true);
  assert.equal(rowCount("tasks", ids.undoSuccessTask), 0);
});
