import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  recordAgentWorkActionApproved,
  recordAgentWorkActionRejected,
} from "../src/lib/agent-work/delegated-actions.ts";
import {
  executeGoogleSheetsApproval,
  makeGoogleSheetsApprovalArgs,
  recoverGoogleSheetsOperation,
  storedGoogleSheetsWorkActionSchema,
} from "../src/lib/agent-work/google-sheets-action.ts";
import type {
  AgentWorkEventRecord,
  AgentWorkIdentity,
  AgentWorkRecord,
  AgentWorkRunRecord,
  AgentWorkStatusChange,
  CreateAgentWorkEventInput,
  StorageAdapter,
} from "../src/lib/agent-work/types.ts";
import {
  GoogleSheetsClientError,
  type GoogleSheetsClient,
} from "../src/lib/google-sheets-client.ts";
import type { PendingOperation } from "../src/lib/secretary-operations.ts";
import { displayForOperation } from "../src/lib/secretary-operations.ts";
import { agentWorkAdapters } from "../src/lib/agent-work/factory.ts";
import type { GoogleSheetsCell } from "../src/lib/agent-work/action-contract.ts";

type Fixture = {
  identity: AgentWorkIdentity;
  work: AgentWorkRecord;
  run: AgentWorkRunRecord;
  operation: PendingOperation;
  events: AgentWorkEventRecord[];
  storage: StorageAdapter;
  client: FakeGoogleSheetsClient;
};

function cellPosition(address: string): { row: number; column: number } {
  const match = address.match(/^([A-Z]+)([1-9]\d*)$/u);
  if (!match) throw new Error(`Invalid test cell: ${address}`);
  const column = [...match[1]!].reduce(
    (value, character) => value * 26 + character.charCodeAt(0) - 64,
    0,
  );
  return { row: Number(match[2]), column };
}

function columnName(value: number): string {
  let rest = value;
  let output = "";
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    output = String.fromCharCode(65 + digit) + output;
    rest = Math.floor((rest - 1) / 26);
  }
  return output;
}

class FakeGoogleSheetsClient implements GoogleSheetsClient {
  readonly calls = { create: 0, update: 0, read: 0 };
  readonly cells = new Map<string, GoogleSheetsCell>();
  createError: Error | null = null;

  async createSpreadsheet(): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
    this.calls.create += 1;
    if (this.createError) throw this.createError;
    return {
      spreadsheetId: "fake-spreadsheet-id",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/fake-spreadsheet-id/edit",
    };
  }

  async updateValues(input: {
    spreadsheetId: string;
    sheetTitle: string;
    range: string;
    values: GoogleSheetsCell[][];
  }): Promise<void> {
    assert.equal(input.spreadsheetId, "fake-spreadsheet-id");
    this.calls.update += 1;
    const start = cellPosition(input.range);
    input.values.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
      this.cells.set(
        `${columnName(start.column + columnIndex)}${start.row + rowIndex}`,
        value,
      );
    }));
  }

  async readValues(input: {
    spreadsheetId: string;
    sheetTitle: string;
    range: string;
  }): Promise<GoogleSheetsCell[][]> {
    assert.equal(input.spreadsheetId, "fake-spreadsheet-id");
    this.calls.read += 1;
    const [startAddress, endAddress = startAddress] = input.range.split(":");
    const start = cellPosition(startAddress!);
    const end = cellPosition(endAddress!);
    return Array.from({ length: end.row - start.row + 1 }, (_, rowIndex) =>
      Array.from({ length: end.column - start.column + 1 }, (_, columnIndex) =>
        this.cells.get(
          `${columnName(start.column + columnIndex)}${start.row + rowIndex}`,
        ) ?? ""));
  }
}

function makeFixture(): Fixture {
  const identity: AgentWorkIdentity = {
    tenantId: randomUUID(),
    userId: randomUUID(),
  };
  const workId = randomUUID();
  const runId = randomUUID();
  const operationId = randomUUID();
  const action = storedGoogleSheetsWorkActionSchema.parse({
    type: "google_sheets_create_populate",
    spreadsheetTitle: "Weekly plan",
    sheetTitle: "Plan",
    initialValues: [
      ["Owner", "Status"],
      ["Mona", "pending"],
    ],
    updates: [{ range: "B2", values: [["done"]] }],
    actionId: randomUUID(),
    sourceOperationId: randomUUID(),
  });
  const work = {
    id: workId,
    identity,
    kind: "external_action",
    title: "Create weekly plan",
    description: null,
    source: { type: "google_sheets" },
    condition: {},
    action,
    schedule: {},
    status: "waiting",
    nextRunAt: new Date(),
  } as unknown as AgentWorkRecord;
  const run = { id: runId, workId } as AgentWorkRunRecord;
  const args = makeGoogleSheetsApprovalArgs({
    identity,
    work,
    run: { id: runId, workId },
    operationId,
    action,
  });
  const operation = {
    operationId,
    conversationId: `conversation-${randomUUID()}`,
    sourceTurnId: randomUUID(),
    toolName: "google_sheets_execute",
    args: args as unknown as Record<string, unknown>,
    display: { title: "Create spreadsheet", details: [] },
    status: "executing",
    updatedAt: new Date(),
  } as PendingOperation;
  const events: AgentWorkEventRecord[] = [];
  let eventNumber = 0;
  const storage = {
    getWork: async (_identity: AgentWorkIdentity, requestedWorkId: string) =>
      requestedWorkId === workId ? work : null,
    getRun: async (_identity: AgentWorkIdentity, requestedRunId: string) =>
      requestedRunId === runId ? run : null,
    listEvents: async (
      _identity: AgentWorkIdentity,
      requestedWorkId: string,
      limit = 100,
    ) => events
      .filter((event) => event.workId === requestedWorkId)
      .slice(0, limit),
    addEvent: async (input: CreateAgentWorkEventInput) => {
      eventNumber += 1;
      const createdAt = new Date(Date.now() + eventNumber);
      const record: AgentWorkEventRecord = {
        id: randomUUID(),
        workId: input.workId,
        runId: input.runId ?? null,
        eventType: input.eventType,
        actorType: input.actorType ?? "system",
        actorId: input.actorId ?? null,
        summary: input.summary,
        metadata: input.metadata ?? {},
        dedupeKey: input.dedupeKey ?? null,
        occurredAt: createdAt,
        createdAt,
        created: true,
      };
      events.push(record);
      return record;
    },
    changeWorkStatus: async (input: AgentWorkStatusChange) => {
      const updated = {
        ...work,
        status: input.to,
        ...(Object.prototype.hasOwnProperty.call(input, "nextRunAt")
          ? { nextRunAt: input.nextRunAt ?? null }
          : {}),
      } as AgentWorkRecord;
      Object.assign(work, updated);
      return work;
    },
    storeEvidenceSnapshot: async () => ({ id: randomUUID() }),
  } as unknown as StorageAdapter;
  return {
    identity,
    work,
    run,
    operation,
    events,
    storage,
    client: new FakeGoogleSheetsClient(),
  };
}

test("Google Sheets action is separately approved, read back, and completes one-shot Work", async () => {
  const fixture = makeFixture();
  const setupDisplay = displayForOperation("create_agent_work", {
    title: "Create weekly plan",
    sourceType: "google_sheets",
    action: {
      type: "google_sheets_create_populate",
      spreadsheetTitle: "Weekly plan",
      sheetTitle: "Plan",
      initialValues: [["Owner", "Status"], ["Mona", "pending"]],
      updates: [{ range: "B2", values: [["done"]] }],
    },
  });
  assert.ok(setupDisplay.details.some((detail) => detail.includes("Mona")));
  const executionDisplay = displayForOperation("google_sheets_execute", {
    spreadsheetTitle: "Weekly plan",
    sheetTitle: "Plan",
    initialRows: 2,
    initialColumns: 2,
    updateRanges: ["B2"],
    previewText: '{"initialValues":[["Owner","Status"],["Mona","pending"]]}',
  });
  assert.ok(executionDisplay.details.some((detail) => detail.includes("Mona")));

  const result = await executeGoogleSheetsApproval({
    identity: fixture.identity,
    operation: fixture.operation,
    storage: fixture.storage,
    client: fixture.client,
  });

  assert.equal(result.action?.type, "google_sheets_workflow_verified");
  assert.equal(fixture.client.calls.create, 1);
  assert.equal(fixture.client.calls.update, 2);
  assert.equal(fixture.client.calls.read, 1);
  assert.equal(fixture.client.cells.get("B2"), "done");
  assert.equal(JSON.stringify(fixture.events).includes("Mona"), false);
  assert.equal(JSON.stringify(fixture.events).includes("done"), false);

  await recordAgentWorkActionApproved(
    fixture.identity,
    { ...fixture.operation, status: "completed" },
    result,
    {
      ...agentWorkAdapters,
      storage: fixture.storage,
      notification: {
        driver: "stub",
        notify: async () => ({ status: "accepted", driver: "stub" }),
      },
    } as typeof agentWorkAdapters,
  );
  assert.equal(fixture.work.status, "completed");
  assert.equal(fixture.work.nextRunAt, null);
  assert.ok(fixture.events.some((event) => event.eventType === "action_verified"));

  const recovery = recoverGoogleSheetsOperation(
    fixture.events,
    fixture.operation.operationId,
    fixture.operation.args,
  );
  assert.equal(recovery.state, "verified");
});

test("ambiguous spreadsheet creation is recorded as unknown and never replayed", async () => {
  const fixture = makeFixture();
  fixture.client.createError = new GoogleSheetsClientError(
    "GOOGLE_SHEETS_PROXY_UNAVAILABLE",
    "unknown_result",
  );

  const first = await executeGoogleSheetsApproval({
    identity: fixture.identity,
    operation: fixture.operation,
    storage: fixture.storage,
    client: fixture.client,
  });
  assert.equal(first.action?.type, "external_action_unknown_result");
  assert.equal(fixture.client.calls.create, 1);
  assert.equal(fixture.client.calls.update, 0);
  assert.equal(fixture.client.calls.read, 0);

  const second = await executeGoogleSheetsApproval({
    identity: fixture.identity,
    operation: fixture.operation,
    storage: fixture.storage,
    client: fixture.client,
  });
  assert.equal(second.action?.type, "external_action_unknown_result");
  assert.equal(fixture.client.calls.create, 1);
  assert.equal(fixture.events.filter((event) =>
    event.eventType === "external_action_unknown_result").length, 1);
  await recordAgentWorkActionRejected(
    fixture.identity,
    fixture.operation,
    "unknown_result",
    {
      ...agentWorkAdapters,
      storage: fixture.storage,
      notification: {
        driver: "stub",
        notify: async () => ({ status: "accepted", driver: "stub" }),
      },
    } as typeof agentWorkAdapters,
  );
  assert.equal(fixture.work.status, "needs_review");
  assert.equal(fixture.work.nextRunAt, null);
  assert.equal(recoverGoogleSheetsOperation(
    fixture.events,
    fixture.operation.operationId,
    fixture.operation.args,
  ).state, "unknown_result");
});

test("recovery treats a started step without a receipt as unknown", () => {
  const fixture = makeFixture();
  const firstStep = (fixture.operation.args.steps as Array<Record<string, unknown>>)[0]!;
  const createdAt = new Date();
  const event: AgentWorkEventRecord = {
    id: randomUUID(),
    workId: fixture.work.id,
    runId: fixture.run.id,
    eventType: "external_action_step_started",
    actorType: "system",
    actorId: null,
    summary: "Started",
    metadata: {
      operationId: fixture.operation.operationId,
      actionId: firstStep.actionId,
      actionState: "started",
    },
    dedupeKey: null,
    occurredAt: createdAt,
    createdAt,
  };
  const recovery = recoverGoogleSheetsOperation(
    [event],
    fixture.operation.operationId,
    fixture.operation.args,
  );
  assert.equal(recovery.state, "unknown_result");
});
