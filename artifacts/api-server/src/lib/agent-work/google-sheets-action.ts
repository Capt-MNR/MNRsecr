import { z } from "zod";
import type { OperationExecutionResult, PendingOperation } from "../secretary-operations";
import { GoogleSheetsClientError, ReplitGoogleSheetsClient } from "../google-sheets-client";
import type { GoogleSheetsClient } from "../google-sheets-client";
import {
  createExternalActionIdentity,
  hashExternalActionValue,
  type ExternalActionStep,
  type GoogleSheetsCell,
  type GoogleSheetsWorkAction,
} from "./action-contract";
import type {
  AgentWorkEventRecord,
  AgentWorkIdentity,
  AgentWorkRecord,
  AgentWorkRunRecord,
  StorageAdapter,
} from "./types";

export const GOOGLE_SHEETS_APPROVAL_TOOL = "google_sheets_execute";

const cellSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const matrixSchema = z.array(
  z.array(cellSchema).min(1).max(26),
).min(1).max(100).superRefine((rows, context) => {
  const cellCount = rows.reduce((total, row) => total + row.length, 0);
  if (cellCount > 1_000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At most 1000 cells can be written in one range.",
    });
  }
});

const cellAddressSchema = z.string().regex(/^[A-Z]{1,3}[1-9]\d*$/u);

const googleSheetsWorkActionObjectSchema = z.object({
  type: z.literal("google_sheets_create_populate"),
  spreadsheetTitle: z.string().trim().min(1).max(120),
  sheetTitle: z.string().trim().min(1).max(90)
    .refine((value) => !/[:\\/?*\[\]]/u.test(value), "Sheet title contains an unsupported character."),
  initialValues: matrixSchema,
  updates: z.array(z.object({
    range: cellAddressSchema,
    values: matrixSchema,
  }).strict()).max(20).default([]),
}).strict();

function refineGoogleSheetsAction(
  action: z.infer<typeof googleSheetsWorkActionObjectSchema>,
  context: z.RefinementCtx,
): void {
  const occupiedUpdates = new Set<string>();
  let totalCells = action.initialValues.reduce(
    (total, row) => total + row.length,
    0,
  );
  for (const update of action.updates) {
    totalCells += update.values.reduce((total, row) => total + row.length, 0);
    const start = parseCellAddress(update.range);
    if (!start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Update ranges must start at a valid A1 cell.",
      });
      continue;
    }
    const bottom = start.row + update.values.length - 1;
    const right = start.column + Math.max(...update.values.map((row) => row.length)) - 1;
    if (bottom > 100 || right > 26) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Updates must stay within rows 1-100 and columns A-Z.",
      });
    }
    for (let row = 0; row < update.values.length; row += 1) {
      for (let column = 0; column < update.values[row]!.length; column += 1) {
        const key = `${start.row + row}:${start.column + column}`;
        if (occupiedUpdates.has(key)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Update ranges cannot overlap each other.",
          });
        }
        occupiedUpdates.add(key);
      }
    }
  }
  if (totalCells > 1_000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A Google Sheets action can change at most 1000 cells in total.",
    });
  }
}

export const googleSheetsWorkActionInputSchema =
  googleSheetsWorkActionObjectSchema.superRefine(refineGoogleSheetsAction);

export const storedGoogleSheetsWorkActionSchema =
  googleSheetsWorkActionObjectSchema.extend({
    actionId: z.string().uuid(),
    sourceOperationId: z.string().uuid(),
  }).strict().superRefine(refineGoogleSheetsAction);

const stepSchema = z.object({
  actionId: z.string().regex(/^act_[a-f0-9]{48}$/u),
  workId: z.string().uuid(),
  runId: z.string().uuid(),
  idempotencyKey: z.string().regex(/^agent-action:[a-f0-9]{64}$/u),
  kind: z.enum(["create_spreadsheet", "write_values", "update_values", "verify_values"]),
  range: z.string().optional(),
}).strict();

const summarySchema = z.object({
  spreadsheetTitle: z.string(),
  sheetTitle: z.string(),
  initialRows: z.number().int().positive(),
  initialColumns: z.number().int().positive(),
  updateRanges: z.array(z.string()),
}).strict();

const approvalArgsSchema = z.object({
  agentWorkId: z.string().uuid(),
  agentWorkRunId: z.string().uuid(),
  agentWorkActionId: z.string().uuid(),
  sourceOperationId: z.string().uuid(),
  agentWorkSource: z.literal("google_sheets"),
  steps: z.array(stepSchema).min(3).max(22),
  summary: summarySchema,
}).strict();

type GoogleSheetsApprovalArgs = z.infer<typeof approvalArgsSchema>;
type EventStatus = "verified" | "failed" | "unknown_result";

const actionEventTypes = {
  started: "external_action_step_started",
  verified: "external_action_step_verified",
  failed: "external_action_step_failed",
  unknown: "external_action_unknown_result",
  workflowVerified: "external_action_workflow_verified",
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseCellAddress(value: string): { row: number; column: number } | null {
  const match = value.match(/^([A-Z]{1,3})([1-9]\d*)$/u);
  if (!match) return null;
  let column = 0;
  for (const character of match[1]!) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  const row = Number(match[2]);
  if (!Number.isSafeInteger(row) || row > 100 || column > 26) return null;
  return { row, column };
}

function columnName(value: number): string {
  let remaining = value;
  let output = "";
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return output;
}

function makeExpectedGrid(action: GoogleSheetsWorkAction): {
  range: string;
  values: GoogleSheetsCell[][];
} {
  const cells = new Map<string, GoogleSheetsCell>();
  let bottom = action.initialValues.length;
  let right = Math.max(...action.initialValues.map((row) => row.length));
  const write = (startRow: number, startColumn: number, values: GoogleSheetsCell[][]) => {
    values.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
      cells.set(`${startRow + rowIndex}:${startColumn + columnIndex}`, value);
    }));
  };
  write(1, 1, action.initialValues);
  for (const update of action.updates) {
    const start = parseCellAddress(update.range);
    if (!start) throw new Error("INVALID_GOOGLE_SHEETS_RANGE");
    write(start.row, start.column, update.values);
    bottom = Math.max(bottom, start.row + update.values.length - 1);
    right = Math.max(
      right,
      start.column + Math.max(...update.values.map((row) => row.length)) - 1,
    );
  }
  const values = Array.from({ length: bottom }, (_, rowIndex) =>
    Array.from({ length: right }, (_, columnIndex) =>
      cells.get(`${rowIndex + 1}:${columnIndex + 1}`) ?? ""));
  const end = `${columnName(right)}${bottom}`;
  return { range: end === "A1" ? "A1" : `A1:${end}`, values };
}

function normalizedCell(value: unknown): GoogleSheetsCell {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return "";
}

function matricesMatch(
  actual: GoogleSheetsCell[][],
  expected: GoogleSheetsCell[][],
): boolean {
  for (let row = 0; row < expected.length; row += 1) {
    for (let column = 0; column < expected[row]!.length; column += 1) {
      if (normalizedCell(actual[row]?.[column]) !== normalizedCell(expected[row]![column])) {
        return false;
      }
    }
    if (actual[row]?.slice(expected[row]!.length)
      .some((cell) => normalizedCell(cell) !== "")) return false;
  }
  return actual.length <= expected.length
    || actual.slice(expected.length).every((row) => row.every((cell) => normalizedCell(cell) === ""));
}

function matrixForUpdateMatches(
  actual: GoogleSheetsCell[][],
  expected: GoogleSheetsCell[][],
): boolean {
  return matricesMatch(actual, expected);
}

function actionSummary(action: GoogleSheetsWorkAction) {
  return {
    spreadsheetTitle: action.spreadsheetTitle,
    sheetTitle: action.sheetTitle,
    initialRows: action.initialValues.length,
    initialColumns: Math.max(...action.initialValues.map((row) => row.length)),
    updateRanges: action.updates.map((update) => update.range),
  };
}

export function formatGoogleSheetsActionPreview(
  action: Pick<GoogleSheetsWorkAction, "initialValues" | "updates">,
): string {
  const serialized = JSON.stringify({
    initialValues: action.initialValues,
    updates: action.updates,
  });
  const characters = Array.from(serialized);
  const maximumCharacters = 1_600;
  if (characters.length <= maximumCharacters) return serialized;
  const visibleCharacters = maximumCharacters - 70;
  return `${characters.slice(0, visibleCharacters).join("")}… (معاينة مختصرة؛ تم إخفاء ${characters.length - visibleCharacters} حرفًا)`;
}

export function buildGoogleSheetsActionSteps(input: {
  identity: AgentWorkIdentity;
  workId: string;
  runId: string;
  operationId: string;
  action: GoogleSheetsWorkAction;
}): ExternalActionStep[] {
  const expected = makeExpectedGrid(input.action);
  const stepDefinitions: Array<{
    kind: ExternalActionStep["kind"];
    stepKey: string;
    range?: string;
  }> = [
    { kind: "create_spreadsheet", stepKey: "create" },
    { kind: "write_values", stepKey: "initial_values", range: "A1" },
    ...input.action.updates.map((update, index) => ({
      kind: "update_values" as const,
      stepKey: `update_${index + 1}`,
      range: update.range,
    })),
    { kind: "verify_values", stepKey: "verify", range: expected.range },
  ];
  return stepDefinitions.map((definition) => {
    const actionIdentity = createExternalActionIdentity({
      tenantId: input.identity.tenantId,
      ownerUserId: input.identity.userId,
      workId: input.workId,
      runId: input.runId,
      operationId: input.operationId,
      stepKey: `${input.action.actionId}:${definition.stepKey}`,
      actionVersion: "google-sheets-v1",
    });
    return {
      ...actionIdentity,
      kind: definition.kind,
      ...(definition.range ? { range: definition.range } : {}),
    };
  });
}

export function makeGoogleSheetsApprovalArgs(input: {
  identity: AgentWorkIdentity;
  work: AgentWorkRecord;
  run: Pick<AgentWorkRunRecord, "id" | "workId">;
  operationId: string;
  action: GoogleSheetsWorkAction;
}): GoogleSheetsApprovalArgs {
  const steps = buildGoogleSheetsActionSteps({
    identity: input.identity,
    workId: input.work.id,
    runId: input.run.id,
    operationId: input.operationId,
    action: input.action,
  });
  return approvalArgsSchema.parse({
    agentWorkId: input.work.id,
    agentWorkRunId: input.run.id,
    agentWorkActionId: input.action.actionId,
    sourceOperationId: input.action.sourceOperationId,
    agentWorkSource: "google_sheets",
    steps: steps.map(({ actionId, idempotencyKey, kind, range }) => ({
      actionId,
      workId: input.work.id,
      runId: input.run.id,
      idempotencyKey,
      kind,
      ...(range ? { range } : {}),
    })),
    summary: actionSummary(input.action),
  });
}

function resultFor(input: {
  conversationId: string;
  assistantMessage: string;
  action: Record<string, unknown>;
}): OperationExecutionResult {
  return {
    conversationId: input.conversationId,
    assistantMessage: input.assistantMessage,
    action: input.action,
    provider: "google_sheets",
    model: "deterministic-action",
  };
}

function unknownResult(input: {
  operation: PendingOperation;
  workId: string;
  runId: string;
  actionId: string;
  reason: string;
  spreadsheetId?: string | null;
}): OperationExecutionResult {
  return resultFor({
    conversationId: input.operation.conversationId ?? `agent-work:${input.workId}`,
    assistantMessage:
      "لم أتمكن من تأكيد نتيجة الكتابة في Google Sheets. أوقفت أي إعادة تلقائية؛ راجع الجدول قبل بدء إجراء جديد.",
    action: {
      type: "external_action_unknown_result",
      actionState: "unknown_result",
      actionId: input.actionId,
      operationId: input.operation.operationId,
      workId: input.workId,
      runId: input.runId,
      reason: input.reason,
      automaticRetry: false,
      ...(input.spreadsheetId ? { spreadsheetId: input.spreadsheetId } : {}),
      verification: { state: "unknown_result", reason: input.reason },
    },
  });
}

function verifiedResult(input: {
  operation: PendingOperation;
  work: AgentWorkRecord;
  runId: string;
  action: GoogleSheetsWorkAction;
  spreadsheetId: string;
  spreadsheetUrl: string | null;
  verificationHash: string;
  steps: ExternalActionStep[];
}): OperationExecutionResult {
  return resultFor({
    conversationId: input.operation.conversationId ?? `agent-work:${input.work.id}`,
    assistantMessage:
      `تم إنشاء جدول Google Sheets «${input.action.spreadsheetTitle}» وقراءة البيانات مجددًا للتحقق منها.${input.spreadsheetUrl ? ` ${input.spreadsheetUrl}` : ""}`,
    action: {
      type: "google_sheets_workflow_verified",
      actionState: "verified",
      actionId: input.action.actionId,
      operationId: input.operation.operationId,
      workId: input.work.id,
      runId: input.runId,
      spreadsheetId: input.spreadsheetId,
      spreadsheetUrl: input.spreadsheetUrl,
      spreadsheetTitle: input.action.spreadsheetTitle,
      sheetTitle: input.action.sheetTitle,
      verification: {
        state: "verified",
        method: "read_back",
        valuesHash: input.verificationHash,
      },
      stepActionIds: input.steps.map((step) => step.actionId),
    },
  });
}

function metadataFor(event: AgentWorkEventRecord): Record<string, unknown> {
  return asRecord(event.metadata);
}

function operationEvents(
  events: AgentWorkEventRecord[],
  operationId: string,
): AgentWorkEventRecord[] {
  return events
    .filter((event) => metadataFor(event).operationId === operationId)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
}

function terminalStepEvents(events: AgentWorkEventRecord[], operationId: string) {
  const terminal = new Map<string, { state: EventStatus; metadata: Record<string, unknown> }>();
  const started = new Set<string>();
  for (const event of operationEvents(events, operationId)) {
    const metadata = metadataFor(event);
    if (typeof metadata.actionId !== "string") continue;
    if (event.eventType === actionEventTypes.started) {
      started.add(metadata.actionId);
    } else if (event.eventType === actionEventTypes.verified) {
      terminal.set(metadata.actionId, { state: "verified", metadata });
    } else if (event.eventType === actionEventTypes.failed) {
      terminal.set(metadata.actionId, { state: "failed", metadata });
    } else if (event.eventType === actionEventTypes.unknown) {
      terminal.set(metadata.actionId, { state: "unknown_result", metadata });
    }
  }
  return { terminal, started };
}

async function addExternalActionEvent(input: {
  storage: StorageAdapter;
  identity: AgentWorkIdentity;
  workId: string;
  runId: string;
  eventType: string;
  summary: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  const operationId = input.metadata.operationId;
  const actionId = input.metadata.actionId;
  await input.storage.addEvent({
    identity: input.identity,
    workId: input.workId,
    runId: input.runId,
    eventType: input.eventType,
    actorType: "system",
    summary: input.summary,
    metadata: input.metadata,
    dedupeKey: typeof operationId === "string" && typeof actionId === "string"
      ? `external-action:${operationId}:${actionId}:${input.eventType}`
      : null,
  });
}

function isUnknownClientError(error: unknown): boolean {
  return error instanceof GoogleSheetsClientError && error.outcome === "unknown_result";
}

function errorCode(error: unknown): string {
  return error instanceof GoogleSheetsClientError
    ? error.code
    : "GOOGLE_SHEETS_REQUEST_FAILED";
}

async function persistStepFailure(input: {
  storage: StorageAdapter;
  identity: AgentWorkIdentity;
  workId: string;
  runId: string;
  operation: PendingOperation;
  step: ExternalActionStep;
  reason: string;
  outcome: EventStatus;
  spreadsheetId?: string | null;
}): Promise<OperationExecutionResult> {
  const result = input.outcome === "unknown_result"
    ? unknownResult({
        operation: input.operation,
        workId: input.workId,
        runId: input.runId,
        actionId: input.step.actionId,
        reason: input.reason,
        spreadsheetId: input.spreadsheetId,
      })
    : resultFor({
        conversationId: input.operation.conversationId ?? `agent-work:${input.workId}`,
        assistantMessage:
          "تعذر تنفيذ إجراء Google Sheets. لم أعتبر الجدول متحققًا، ويمكنك مراجعة تفاصيل العمل لمعرفة الخطوة التي توقفت.",
        action: {
          type: "google_sheets_action_failed",
          actionState: "failed",
          actionId: input.step.actionId,
          operationId: input.operation.operationId,
          workId: input.workId,
          runId: input.runId,
          reason: input.reason,
          ...(input.spreadsheetId ? { spreadsheetId: input.spreadsheetId } : {}),
          verification: { state: "failed", reason: input.reason },
        },
      });
  const eventType = input.outcome === "unknown_result"
    ? actionEventTypes.unknown
    : actionEventTypes.failed;
  await addExternalActionEvent({
    storage: input.storage,
    identity: input.identity,
    workId: input.workId,
    runId: input.runId,
    eventType,
    summary: input.outcome === "unknown_result"
      ? "نتيجة خطوة Google Sheets غير مؤكدة؛ توقفت إعادة المحاولة التلقائية."
      : "تعذر تنفيذ خطوة Google Sheets.",
    metadata: {
      operationId: input.operation.operationId,
      actionId: input.step.actionId,
      idempotencyKey: input.step.idempotencyKey,
      step: input.step.kind,
      actionState: input.outcome,
      reason: input.reason,
      ...(input.spreadsheetId ? { spreadsheetId: input.spreadsheetId } : {}),
      actionResult: result,
    },
  });
  return result;
}

async function persistStepStarted(input: {
  storage: StorageAdapter;
  identity: AgentWorkIdentity;
  workId: string;
  runId: string;
  operation: PendingOperation;
  step: ExternalActionStep;
}): Promise<void> {
  await addExternalActionEvent({
    storage: input.storage,
    identity: input.identity,
    workId: input.workId,
    runId: input.runId,
    eventType: actionEventTypes.started,
    summary: "بدأ تنفيذ خطوة Google Sheets بعد الموافقة.",
    metadata: {
      operationId: input.operation.operationId,
      actionId: input.step.actionId,
      idempotencyKey: input.step.idempotencyKey,
      step: input.step.kind,
      actionState: "started",
    },
  });
}

async function persistStepVerified(input: {
  storage: StorageAdapter;
  identity: AgentWorkIdentity;
  workId: string;
  runId: string;
  operation: PendingOperation;
  step: ExternalActionStep;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await addExternalActionEvent({
    storage: input.storage,
    identity: input.identity,
    workId: input.workId,
    runId: input.runId,
    eventType: actionEventTypes.verified,
    summary: "تم التحقق من خطوة Google Sheets.",
    metadata: {
      operationId: input.operation.operationId,
      actionId: input.step.actionId,
      idempotencyKey: input.step.idempotencyKey,
      step: input.step.kind,
      actionState: "verified",
      ...input.metadata,
    },
  });
}

function verifiedSpreadsheetFromEvents(
  events: AgentWorkEventRecord[],
  operationId: string,
  createStep: ExternalActionStep,
): { spreadsheetId: string; spreadsheetUrl: string | null } | null {
  const receipt = terminalStepEvents(events, operationId).terminal.get(createStep.actionId);
  if (receipt?.state !== "verified") return null;
  const spreadsheetId = receipt.metadata.spreadsheetId;
  if (typeof spreadsheetId !== "string" || !spreadsheetId) return null;
  return {
    spreadsheetId,
    spreadsheetUrl: typeof receipt.metadata.spreadsheetUrl === "string"
      ? receipt.metadata.spreadsheetUrl
      : null,
  };
}

function verifyApprovalContext(input: {
  identity: AgentWorkIdentity;
  operation: PendingOperation;
  args: GoogleSheetsApprovalArgs;
  work: AgentWorkRecord;
  run: AgentWorkRunRecord;
  action: GoogleSheetsWorkAction;
}): ExternalActionStep[] {
  if (input.work.kind !== "external_action"
    || input.work.status !== "waiting"
    || asRecord(input.work.source).type !== "google_sheets"
    || input.work.id !== input.args.agentWorkId
    || input.run.workId !== input.work.id
    || input.run.id !== input.args.agentWorkRunId
    || input.operation.toolName !== GOOGLE_SHEETS_APPROVAL_TOOL
    || input.action.actionId !== input.args.agentWorkActionId
    || input.action.sourceOperationId !== input.args.sourceOperationId) {
    throw new Error("GOOGLE_SHEETS_APPROVAL_CONTEXT_MISMATCH");
  }
  const expected = buildGoogleSheetsActionSteps({
    identity: input.identity,
    workId: input.work.id,
    runId: input.run.id,
    operationId: input.operation.operationId,
    action: input.action,
  });
  const actual = input.args.steps;
  if (actual.length !== expected.length || actual.some((step, index) => {
    const counterpart = expected[index]!;
    return step.actionId !== counterpart.actionId
      || step.workId !== counterpart.workId
      || step.runId !== counterpart.runId
      || step.idempotencyKey !== counterpart.idempotencyKey
      || step.kind !== counterpart.kind
      || step.range !== counterpart.range;
  })) {
    throw new Error("GOOGLE_SHEETS_ACTION_PLAN_MISMATCH");
  }
  return expected;
}

function rangeValuesMatch(
  actual: GoogleSheetsCell[][],
  expected: GoogleSheetsCell[][],
): boolean {
  return matrixForUpdateMatches(actual, expected);
}

function stepAlreadyCompleted(
  states: ReturnType<typeof terminalStepEvents>,
  step: Pick<ExternalActionStep, "actionId">,
): "verified" | "failed" | "unknown_result" | "not_started" {
  const terminal = states.terminal.get(step.actionId);
  if (terminal) return terminal.state;
  return states.started.has(step.actionId) ? "unknown_result" : "not_started";
}

export async function executeGoogleSheetsApproval(input: {
  identity: AgentWorkIdentity;
  operation: PendingOperation;
  storage: StorageAdapter;
  client?: GoogleSheetsClient;
}): Promise<OperationExecutionResult> {
  const args = approvalArgsSchema.parse(input.operation.args);
  const work = await input.storage.getWork(input.identity, args.agentWorkId);
  const run = await input.storage.getRun(input.identity, args.agentWorkRunId);
  if (!work || !run) throw new Error("GOOGLE_SHEETS_AGENT_WORK_MISSING");
  const parsedAction = storedGoogleSheetsWorkActionSchema.parse(work.action);
  const steps = verifyApprovalContext({
    identity: input.identity,
    operation: input.operation,
    args,
    work,
    run,
    action: parsedAction,
  });
  const client = input.client ?? new ReplitGoogleSheetsClient();
  const events = await input.storage.listEvents(input.identity, work.id, 100);
  const states = terminalStepEvents(events, input.operation.operationId);

  for (const step of steps) {
    const state = stepAlreadyCompleted(states, step);
    if (state === "verified") continue;
    if (state === "failed") {
      throw new Error("GOOGLE_SHEETS_STEP_PREVIOUSLY_FAILED");
    }
    if (state === "unknown_result") {
      const priorUnknown = states.terminal.get(step.actionId);
      if (priorUnknown?.state === "unknown_result") {
        const saved = priorUnknown.metadata.actionResult;
        if (saved && typeof saved === "object") return saved as OperationExecutionResult;
      }
      return persistStepFailure({
        storage: input.storage,
        identity: input.identity,
        workId: work.id,
        runId: run.id,
        operation: input.operation,
        step,
        reason: "IN_FLIGHT_STEP_REQUIRES_REVIEW",
        outcome: "unknown_result",
      });
    }
  }

  const createStep = steps[0]!;
  const writeStep = steps[1]!;
  const verifyStep = steps[steps.length - 1]!;
  let spreadsheet = verifiedSpreadsheetFromEvents(events, input.operation.operationId, createStep);

  if (stepAlreadyCompleted(states, createStep) === "not_started") {
    await persistStepStarted({
      storage: input.storage,
      identity: input.identity,
      workId: work.id,
      runId: run.id,
      operation: input.operation,
      step: createStep,
    });
    try {
      const created = await client.createSpreadsheet({
        title: parsedAction.spreadsheetTitle,
        sheetTitle: parsedAction.sheetTitle,
      });
      spreadsheet = created;
      await persistStepVerified({
        storage: input.storage,
        identity: input.identity,
        workId: work.id,
        runId: run.id,
        operation: input.operation,
        step: createStep,
        metadata: {
          spreadsheetId: created.spreadsheetId,
          spreadsheetUrl: created.spreadsheetUrl,
        },
      });
    } catch (error) {
      const outcome = isUnknownClientError(error) ? "unknown_result" : "failed";
      return persistStepFailure({
        storage: input.storage,
        identity: input.identity,
        workId: work.id,
        runId: run.id,
        operation: input.operation,
        step: createStep,
        reason: errorCode(error),
        outcome,
      });
    }
  }
  if (!spreadsheet) {
    return persistStepFailure({
      storage: input.storage,
      identity: input.identity,
      workId: work.id,
      runId: run.id,
      operation: input.operation,
      step: createStep,
      reason: "SPREADSHEET_RECEIPT_MISSING",
      outcome: "unknown_result",
    });
  }

  const writeDefinitions: Array<{
    step: ExternalActionStep;
    range: string;
    values: GoogleSheetsCell[][];
  }> = [
    { step: writeStep, range: "A1", values: parsedAction.initialValues },
    ...parsedAction.updates.map((update, index) => ({
      step: steps[index + 2]!,
      range: update.range,
      values: update.values,
    })),
  ];
  for (const definition of writeDefinitions) {
    if (stepAlreadyCompleted(states, definition.step) === "verified") continue;
    await persistStepStarted({
      storage: input.storage,
      identity: input.identity,
      workId: work.id,
      runId: run.id,
      operation: input.operation,
      step: definition.step,
    });
    let verifiedByReadBack = false;
    try {
      await client.updateValues({
        spreadsheetId: spreadsheet.spreadsheetId,
        sheetTitle: parsedAction.sheetTitle,
        range: definition.range,
        values: definition.values,
      });
    } catch (error) {
      if (!isUnknownClientError(error)) {
        return persistStepFailure({
          storage: input.storage,
          identity: input.identity,
          workId: work.id,
          runId: run.id,
          operation: input.operation,
          step: definition.step,
          reason: errorCode(error),
          outcome: "failed",
          spreadsheetId: spreadsheet.spreadsheetId,
        });
      }
      try {
        const actual = await client.readValues({
          spreadsheetId: spreadsheet.spreadsheetId,
          sheetTitle: parsedAction.sheetTitle,
          range: definition.range,
        });
        verifiedByReadBack = rangeValuesMatch(actual, definition.values);
      } catch {
        verifiedByReadBack = false;
      }
      if (!verifiedByReadBack) {
        return persistStepFailure({
          storage: input.storage,
          identity: input.identity,
          workId: work.id,
          runId: run.id,
          operation: input.operation,
          step: definition.step,
          reason: "WRITE_RESULT_NOT_VERIFIED",
          outcome: "unknown_result",
          spreadsheetId: spreadsheet.spreadsheetId,
        });
      }
    }
    await persistStepVerified({
      storage: input.storage,
      identity: input.identity,
      workId: work.id,
      runId: run.id,
      operation: input.operation,
      step: definition.step,
      metadata: {
        range: definition.range,
        rows: definition.values.length,
        cells: definition.values.reduce((total, row) => total + row.length, 0),
        valuesHash: hashExternalActionValue(definition.values),
        confirmedByReadBack: verifiedByReadBack,
      },
    });
    states.terminal.set(definition.step.actionId, {
      state: "verified",
      metadata: { actionId: definition.step.actionId },
    });
  }

  const expected = makeExpectedGrid(parsedAction);
  if (stepAlreadyCompleted(states, verifyStep) !== "verified") {
    await persistStepStarted({
      storage: input.storage,
      identity: input.identity,
      workId: work.id,
      runId: run.id,
      operation: input.operation,
      step: verifyStep,
    });
    let actual: GoogleSheetsCell[][];
    try {
      actual = await client.readValues({
        spreadsheetId: spreadsheet.spreadsheetId,
        sheetTitle: parsedAction.sheetTitle,
        range: expected.range,
      });
    } catch (error) {
      return persistStepFailure({
        storage: input.storage,
        identity: input.identity,
        workId: work.id,
        runId: run.id,
        operation: input.operation,
        step: verifyStep,
        reason: errorCode(error),
        outcome: "unknown_result",
        spreadsheetId: spreadsheet.spreadsheetId,
      });
    }
    if (!matricesMatch(actual, expected.values)) {
      return persistStepFailure({
        storage: input.storage,
        identity: input.identity,
        workId: work.id,
        runId: run.id,
        operation: input.operation,
        step: verifyStep,
        reason: "READ_BACK_MISMATCH",
        outcome: "unknown_result",
        spreadsheetId: spreadsheet.spreadsheetId,
      });
    }
    const result = verifiedResult({
      operation: input.operation,
      work,
      runId: run.id,
      action: parsedAction,
      spreadsheetId: spreadsheet.spreadsheetId,
      spreadsheetUrl: spreadsheet.spreadsheetUrl,
      verificationHash: hashExternalActionValue(expected.values),
      steps,
    });
    await persistStepVerified({
      storage: input.storage,
      identity: input.identity,
      workId: work.id,
      runId: run.id,
      operation: input.operation,
      step: verifyStep,
      metadata: {
        range: expected.range,
        rows: expected.values.length,
        cells: expected.values.reduce((total, row) => total + row.length, 0),
        valuesHash: hashExternalActionValue(expected.values),
        actionResult: result,
      },
    });
    states.terminal.set(verifyStep.actionId, {
      state: "verified",
      metadata: { actionId: verifyStep.actionId, actionResult: result },
    });
  }

  const verification = states.terminal.get(verifyStep.actionId);
  const verifiedActionResult = verification?.metadata.actionResult;
  const finalResult = verifiedActionResult && typeof verifiedActionResult === "object"
    ? verifiedActionResult as OperationExecutionResult
    : verifiedResult({
        operation: input.operation,
        work,
        runId: run.id,
        action: parsedAction,
        spreadsheetId: spreadsheet.spreadsheetId,
        spreadsheetUrl: spreadsheet.spreadsheetUrl,
        verificationHash: hashExternalActionValue(makeExpectedGrid(parsedAction).values),
        steps,
      });
  await addExternalActionEvent({
    storage: input.storage,
    identity: input.identity,
    workId: work.id,
    runId: run.id,
    eventType: actionEventTypes.workflowVerified,
    summary: "تم إنشاء جدول Google Sheets والتحقق من البيانات المقروءة.",
    metadata: {
      operationId: input.operation.operationId,
      actionId: parsedAction.actionId,
      actionState: "verified",
      spreadsheetId: spreadsheet.spreadsheetId,
      stepActionIds: steps.map((step) => step.actionId),
      actionResult: finalResult,
    },
  });
  return finalResult;
}

export type GoogleSheetsOperationRecovery =
  | { state: "verified"; result: OperationExecutionResult }
  | { state: "unknown_result"; result: OperationExecutionResult }
  | { state: "failed"; reason: string }
  | { state: "safe_to_retry" };

export function recoverGoogleSheetsOperation(
  events: AgentWorkEventRecord[],
  operationId: string,
  operationArgs: Record<string, unknown>,
): GoogleSheetsOperationRecovery {
  const parsed = approvalArgsSchema.safeParse(operationArgs);
  if (!parsed.success) return { state: "unknown_result", result: resultFor({
    conversationId: `agent-work:${String(asRecord(operationArgs).agentWorkId ?? "unknown")}`,
    assistantMessage: "تعذر التحقق من حالة إجراء Google Sheets بعد استعادة التنفيذ. لن تتم إعادته تلقائيًا.",
    action: {
      type: "external_action_unknown_result",
      actionState: "unknown_result",
      operationId,
      reason: "APPROVAL_ARGUMENTS_INVALID",
      automaticRetry: false,
      verification: { state: "unknown_result" },
    },
  }) };
  const args = parsed.data;
  const relevant = operationEvents(events, operationId);
  const workflowEvent = [...relevant].reverse()
    .find((event) => event.eventType === actionEventTypes.workflowVerified);
  const workflowResult = metadataFor(workflowEvent ?? ({} as AgentWorkEventRecord)).actionResult;
  if (workflowEvent && workflowResult && typeof workflowResult === "object") {
    return { state: "verified", result: workflowResult as OperationExecutionResult };
  }
  const stepStates = terminalStepEvents(relevant, operationId);
  for (const step of args.steps) {
    const state = stepAlreadyCompleted(stepStates, step);
    if (state === "unknown_result") {
      const saved = stepStates.terminal.get(step.actionId)?.metadata.actionResult;
      if (saved && typeof saved === "object") {
        return { state: "unknown_result", result: saved as OperationExecutionResult };
      }
      return {
        state: "unknown_result",
        result: resultFor({
          conversationId: `agent-work:${args.agentWorkId}`,
          assistantMessage:
            "تعذر استعادة حالة Google Sheets بعد انقطاع التنفيذ. لن تتم إعادة أي خطوة قد تكون نجحت؛ راجع النتيجة قبل بدء إجراء جديد.",
          action: {
            type: "external_action_unknown_result",
            actionState: "unknown_result",
            actionId: step.actionId,
            operationId,
            workId: args.agentWorkId,
            runId: args.agentWorkRunId,
            reason: "RECOVERY_FOUND_UNCERTAIN_STEP",
            automaticRetry: false,
            verification: { state: "unknown_result" },
          },
        }),
      };
    }
    if (state === "failed") {
      const receipt = stepStates.terminal.get(step.actionId);
      return {
        state: "failed",
        reason: typeof receipt?.metadata.reason === "string"
          ? receipt.metadata.reason
          : "GOOGLE_SHEETS_STEP_FAILED",
      };
    }
  }
  const verifyStep = args.steps[args.steps.length - 1];
  const verifyState = verifyStep ? stepStates.terminal.get(verifyStep.actionId) : undefined;
  const result = verifyState?.metadata.actionResult;
  if (verifyState?.state === "verified" && result && typeof result === "object") {
    return { state: "verified", result: result as OperationExecutionResult };
  }
  return { state: "safe_to_retry" };
}

export function googleSheetsUnknownResult(
  operation: PendingOperation,
): OperationExecutionResult | null {
  const action = asRecord(operation.result?.action);
  return action.type === "external_action_unknown_result"
    ? operation.result ?? null
    : null;
}

export function isGoogleSheetsActionOperation(operation: PendingOperation): boolean {
  return operation.toolName === GOOGLE_SHEETS_APPROVAL_TOOL
    || asRecord(operation.args).agentWorkSource === "google_sheets";
}