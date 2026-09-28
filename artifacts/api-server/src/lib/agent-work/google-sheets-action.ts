import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { OperationExecutionResult, PendingOperation } from "../secretary-operations";
import { GoogleSheetsClientError, ReplitGoogleSheetsClient } from "../google-sheets-client";
import type { GoogleSheetsClient } from "../google-sheets-client";
import {
  makeExternalActionResult,
  type ExternalActionConnector,
  type ExternalActionStatus,
} from "./external-action";
import { appendExternalActionEvent } from "./external-action-events";
import {
  createExternalActionIdentity,
  hashExternalActionValue,
} from "./action-contract";
import type {
  GoogleSheetsActionStep,
  GoogleSheetsCell,
  GoogleSheetsWorkAction,
} from "./google-sheets-contract";
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

export const storedGoogleSheetsWorkActionSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const normalized = { ...(value as Record<string, unknown>) };
  if (typeof normalized.setupApprovalOperationId !== "string"
    && typeof normalized.sourceOperationId === "string") {
    normalized.setupApprovalOperationId = normalized.sourceOperationId;
  }
  delete normalized.sourceOperationId;
  return normalized;
}, googleSheetsWorkActionObjectSchema.extend({
  actionId: z.string().uuid(),
  setupApprovalOperationId: z.string().uuid(),
}).strict().superRefine(refineGoogleSheetsAction));

const stepSchema = z.object({
  actionId: z.string().uuid(),
  stepId: z.string().regex(/^step_[a-f0-9]{48}$/u),
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
  workId: z.string().uuid(),
  runId: z.string().uuid(),
  actionId: z.string().uuid(),
  setupApprovalOperationId: z.string().uuid(),
  provider: z.literal("google_sheets"),
  approvedActionHash: z.string().regex(/^[a-f0-9]{64}$/u),
  previewText: z.string().max(1_600),
  steps: z.array(stepSchema).min(3).max(22),
  summary: summarySchema,
}).strict();

type GoogleSheetsApprovalArgs = z.infer<typeof approvalArgsSchema>;
type EventStatus = ExternalActionStatus;

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
  approvalOperationId: string;
  action: GoogleSheetsWorkAction;
}): GoogleSheetsActionStep[] {
  const expected = makeExpectedGrid(input.action);
  const stepDefinitions: Array<{
    kind: GoogleSheetsActionStep["kind"];
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
      approvalOperationId: input.approvalOperationId,
      actionId: input.action.actionId,
      stepKey: definition.stepKey,
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
  action: GoogleSheetsWorkAction;
}): GoogleSheetsApprovalArgs {
  const steps = buildGoogleSheetsActionSteps({
    identity: input.identity,
    workId: input.work.id,
    runId: input.run.id,
    approvalOperationId: "pending",
    action: input.action,
  });
  const approvedActionHash = googleSheetsActionHash(input.action, steps);
  return approvalArgsSchema.parse({
    workId: input.work.id,
    runId: input.run.id,
    actionId: input.action.actionId,
    setupApprovalOperationId: input.action.setupApprovalOperationId,
    provider: "google_sheets",
    approvedActionHash,
    previewText: formatGoogleSheetsActionPreview(input.action),
    steps: steps.map(({ actionId, stepId, idempotencyKey, kind, range }) => ({
      actionId,
      stepId,
      idempotencyKey,
      kind,
      ...(range ? { range } : {}),
    })),
    summary: actionSummary(input.action),
  });
}

export function googleSheetsActionHash(
  action: GoogleSheetsWorkAction,
  steps: GoogleSheetsActionStep[],
): string {
  return hashExternalActionValue({
    provider: "google_sheets",
    actionType: action.type,
    action,
    plan: steps.map(({ actionId, stepId, idempotencyKey, kind, range }) => ({
      actionId,
      stepId,
      idempotencyKey,
      kind,
      ...(range ? { range } : {}),
    })),
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
  stepId?: string;
  reason: string;
  spreadsheetId?: string | null;
}): OperationExecutionResult {
  const contractResult = makeExternalActionResult<OperationExecutionResult>({
    status: "unknown_result",
    error: {
      code: input.reason,
      outcome: "unknown_result",
      retryable: false,
      reviewRequired: true,
    },
  });
  return resultFor({
    conversationId: input.operation.conversationId ?? `agent-work:${input.workId}`,
    assistantMessage:
      "لم أتمكن من تأكيد نتيجة الكتابة في Google Sheets. أوقفت أي إعادة تلقائية؛ راجع الجدول قبل بدء إجراء جديد.",
    action: {
      type: "external_action_unknown_result",
      actionState: "unknown_result",
      actionId: input.actionId,
      ...(input.stepId ? { stepId: input.stepId } : {}),
      operationId: input.operation.operationId,
      workId: input.workId,
      runId: input.runId,
      reason: input.reason,
      automaticRetry: false,
      ...(input.spreadsheetId ? { spreadsheetId: input.spreadsheetId } : {}),
      verification: { state: "unknown_result", reason: input.reason },
      externalAction: {
        provider: "google_sheets",
        actionType: "google_sheets_create_populate",
        status: contractResult.status,
        actionId: input.actionId,
        ...(input.stepId ? { stepId: input.stepId } : {}),
        workId: input.workId,
        runId: input.runId,
        approvalOperationId: input.operation.operationId,
        ...(input.spreadsheetId ? { providerReference: { spreadsheetId: input.spreadsheetId } } : {}),
        verification: { state: "unknown_result", reason: input.reason },
        error: {
          code: input.reason,
          outcome: "unknown_result",
          retryable: false,
          reviewRequired: true,
        },
        retryable: false,
        reviewRequired: true,
      },
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
  steps: GoogleSheetsActionStep[];
  evidenceReference?: string;
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
      stepIds: input.steps.map((step) => step.stepId),
      spreadsheetTitle: input.action.spreadsheetTitle,
      sheetTitle: input.action.sheetTitle,
      verification: {
        state: "verified",
        method: "read_back",
        valuesHash: input.verificationHash,
      },
      externalAction: {
        provider: "google_sheets",
        actionType: input.action.type,
        status: "verified",
        actionId: input.action.actionId,
        workId: input.work.id,
        runId: input.runId,
        approvalOperationId: input.operation.operationId,
        providerReference: {
          spreadsheetId: input.spreadsheetId,
          ...(input.spreadsheetUrl ? { spreadsheetUrl: input.spreadsheetUrl } : {}),
        },
        verification: {
          state: "verified",
          method: "read_back",
          valuesHash: input.verificationHash,
        },
        ...(input.evidenceReference ? { evidenceReference: input.evidenceReference } : {}),
      },
    },
  });
}

function metadataFor(event: AgentWorkEventRecord): Record<string, unknown> {
  return asRecord(event.metadata);
}

function operationEvents(
  events: AgentWorkEventRecord[],
  approvalOperationId: string,
): AgentWorkEventRecord[] {
  return events
    .filter((event) => metadataFor(event).approvalOperationId === approvalOperationId
      || metadataFor(event).operationId === approvalOperationId)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
}

function terminalStepEvents(events: AgentWorkEventRecord[], operationId: string) {
  const terminal = new Map<string, { state: EventStatus; metadata: Record<string, unknown> }>();
  const started = new Set<string>();
  for (const event of operationEvents(events, operationId)) {
    const metadata = metadataFor(event);
    const stepId = typeof metadata.stepId === "string"
      ? metadata.stepId
      : typeof metadata.actionId === "string"
        ? metadata.actionId
        : null;
    if (!stepId) continue;
    if (event.eventType === actionEventTypes.started) {
      started.add(stepId);
    } else if (event.eventType === actionEventTypes.verified) {
      terminal.set(stepId, { state: "verified", metadata });
    } else if (event.eventType === actionEventTypes.failed) {
      terminal.set(stepId, { state: "failed", metadata });
    } else if (event.eventType === actionEventTypes.unknown) {
      terminal.set(stepId, { state: "unknown_result", metadata });
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
  const approvalOperationId = input.metadata.approvalOperationId ?? input.metadata.operationId;
  const actionId = input.metadata.actionId;
  if (typeof approvalOperationId !== "string" || typeof actionId !== "string") {
    throw new Error("EXTERNAL_ACTION_EVENT_IDENTITY_REQUIRED");
  }
  const {
    operationId: _legacyOperationId,
    approvalOperationId: _approvalOperationId,
    actionId: _actionId,
    stepId,
    ...metadata
  } = input.metadata;
  await appendExternalActionEvent({
    storage: input.storage,
    identity: input.identity,
    workId: input.workId,
    runId: input.runId,
    approvalOperationId,
    actionId,
    ...(typeof stepId === "string" ? { stepId } : {}),
    eventType: input.eventType,
    summary: input.summary,
    metadata,
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
  step: GoogleSheetsActionStep;
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
        stepId: input.step.stepId,
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
          stepId: input.step.stepId,
          operationId: input.operation.operationId,
          workId: input.workId,
          runId: input.runId,
          reason: input.reason,
          ...(input.spreadsheetId ? { spreadsheetId: input.spreadsheetId } : {}),
          verification: { state: "failed", reason: input.reason },
          externalAction: {
            provider: "google_sheets",
            actionType: "google_sheets_create_populate",
            status: "failed",
            actionId: input.step.actionId,
            stepId: input.step.stepId,
            workId: input.workId,
            runId: input.runId,
            approvalOperationId: input.operation.operationId,
            ...(input.spreadsheetId ? { providerReference: { spreadsheetId: input.spreadsheetId } } : {}),
            verification: { state: "failed", reason: input.reason },
            error: {
              code: input.reason,
              outcome: "failed",
              retryable: false,
              reviewRequired: true,
            },
          },
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
      approvalOperationId: input.operation.operationId,
      actionId: input.step.actionId,
      stepId: input.step.stepId,
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
  step: GoogleSheetsActionStep;
}): Promise<void> {
  await addExternalActionEvent({
    storage: input.storage,
    identity: input.identity,
    workId: input.workId,
    runId: input.runId,
    eventType: actionEventTypes.started,
    summary: "بدأ تنفيذ خطوة Google Sheets بعد الموافقة.",
    metadata: {
      approvalOperationId: input.operation.operationId,
      actionId: input.step.actionId,
      stepId: input.step.stepId,
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
  step: GoogleSheetsActionStep;
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
      approvalOperationId: input.operation.operationId,
      actionId: input.step.actionId,
      stepId: input.step.stepId,
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
  createStep: GoogleSheetsActionStep,
): { spreadsheetId: string; spreadsheetUrl: string | null } | null {
  const receipt = terminalStepEvents(events, operationId).terminal.get(createStep.stepId);
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
}): GoogleSheetsActionStep[] {
  if (input.work.kind !== "external_action"
    || input.work.status !== "waiting"
    || asRecord(input.work.source).type !== "google_sheets"
    || input.work.id !== input.args.workId
    || input.run.workId !== input.work.id
    || input.run.id !== input.args.runId
    || input.operation.toolName !== GOOGLE_SHEETS_APPROVAL_TOOL
    || input.action.actionId !== input.args.actionId
    || input.action.setupApprovalOperationId !== input.args.setupApprovalOperationId
    || input.args.provider !== "google_sheets") {
    throw new Error("GOOGLE_SHEETS_APPROVAL_CONTEXT_MISMATCH");
  }
  const expected = buildGoogleSheetsActionSteps({
    identity: input.identity,
    workId: input.work.id,
    runId: input.run.id,
    approvalOperationId: input.operation.operationId,
    action: input.action,
  });
  const actual = input.args.steps;
  if (actual.length !== expected.length || actual.some((step, index) => {
    const counterpart = expected[index]!;
    return step.actionId !== counterpart.actionId
      || step.stepId !== counterpart.stepId
      || step.idempotencyKey !== counterpart.idempotencyKey
      || step.kind !== counterpart.kind
      || step.range !== counterpart.range;
  })) {
    throw new Error("GOOGLE_SHEETS_ACTION_PLAN_MISMATCH");
  }
  if (googleSheetsActionHash(input.action, expected) !== input.args.approvedActionHash) {
    throw new Error("GOOGLE_SHEETS_APPROVED_CONTENT_HASH_MISMATCH");
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
  step: Pick<GoogleSheetsActionStep, "actionId" | "stepId">,
): "verified" | "failed" | "unknown_result" | "not_started" {
  const terminal = states.terminal.get(step.stepId);
  if (terminal) return terminal.state;
  return states.started.has(step.stepId) ? "unknown_result" : "not_started";
}

export async function executeGoogleSheetsApproval(input: {
  identity: AgentWorkIdentity;
  operation: PendingOperation;
  storage: StorageAdapter;
  client?: GoogleSheetsClient;
}): Promise<OperationExecutionResult> {
  const args = approvalArgsSchema.parse(input.operation.args);
  const work = await input.storage.getWork(input.identity, args.workId);
  const run = await input.storage.getRun(input.identity, args.runId);
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
      const priorUnknown = states.terminal.get(step.stepId);
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
    step: GoogleSheetsActionStep;
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
    states.terminal.set(definition.step.stepId, {
      state: "verified",
      metadata: { actionId: definition.step.actionId, stepId: definition.step.stepId },
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
    states.terminal.set(verifyStep.stepId, {
      state: "verified",
      metadata: { actionId: verifyStep.actionId, stepId: verifyStep.stepId, actionResult: result },
    });
  }

  const verification = states.terminal.get(verifyStep.stepId);
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
      stepIds: steps.map((step) => step.stepId),
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
    conversationId: `agent-work:${String(asRecord(operationArgs).workId ?? "unknown")}`,
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
      const saved = stepStates.terminal.get(step.stepId)?.metadata.actionResult;
      if (saved && typeof saved === "object") {
        return { state: "unknown_result", result: saved as OperationExecutionResult };
      }
      return {
        state: "unknown_result",
        result: resultFor({
          conversationId: `agent-work:${args.workId}`,
          assistantMessage:
            "تعذر استعادة حالة Google Sheets بعد انقطاع التنفيذ. لن تتم إعادة أي خطوة قد تكون نجحت؛ راجع النتيجة قبل بدء إجراء جديد.",
          action: {
            type: "external_action_unknown_result",
            actionState: "unknown_result",
            actionId: step.actionId,
            stepId: step.stepId,
            operationId,
            workId: args.workId,
            runId: args.runId,
            reason: "RECOVERY_FOUND_UNCERTAIN_STEP",
            automaticRetry: false,
            verification: { state: "unknown_result" },
          },
        }),
      };
    }
    if (state === "failed") {
      const receipt = stepStates.terminal.get(step.stepId);
      return {
        state: "failed",
        reason: typeof receipt?.metadata.reason === "string"
          ? receipt.metadata.reason
          : "GOOGLE_SHEETS_STEP_FAILED",
      };
    }
  }
  const verifyStep = args.steps[args.steps.length - 1];
  const verifyState = verifyStep ? stepStates.terminal.get(verifyStep.stepId) : undefined;
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

function sheetsSetupDisplay(
  workTitle: string,
  action: Record<string, unknown>,
): { title: string; details: string[] } {
  const parsed = googleSheetsWorkActionInputSchema.safeParse(action);
  const values = Array.isArray(action.initialValues) ? action.initialValues : [];
  const updates = Array.isArray(action.updates) ? action.updates : [];
  return {
    title: "إعداد إجراء Google Sheets",
    details: [
      workTitle,
      "هذه الموافقة تحفظ إعداد العمل فقط؛ لن يتم الاتصال بـ Google Sheets قبل موافقة ثانية.",
      ...(typeof action.spreadsheetTitle === "string" ? [`اسم الجدول: ${action.spreadsheetTitle}`] : []),
      ...(typeof action.sheetTitle === "string" ? [`اسم الورقة: ${action.sheetTitle}`] : []),
      `البيانات الأولية: ${values.length} صف`,
      ...updates.map((update) => {
        const record = update && typeof update === "object" ? update as Record<string, unknown> : {};
        return `نطاق التعديل: ${typeof record.range === "string" ? record.range : "غير محدد"}`;
      }),
      ...(parsed.success ? [`معاينة القيم: ${formatGoogleSheetsActionPreview(parsed.data)}`] : []),
    ],
  };
}

function sheetsApprovalDisplay(args: Record<string, unknown>): { title: string; details: string[] } {
  const parsed = approvalArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      title: "موافقة مطلوبة على إجراء Google Sheets",
      details: ["تعذر قراءة تفاصيل الإجراء؛ لن يبدأ التنفيذ قبل مراجعة البيانات."],
    };
  }
  const { summary, previewText } = parsed.data;
  return {
    title: "إنشاء وكتابة بيانات في Google Sheets",
    details: [
      `اسم الجدول: ${summary.spreadsheetTitle}`,
      `اسم الورقة: ${summary.sheetTitle}`,
      `البيانات الأولية: ${summary.initialRows} صف`,
      `عدد الأعمدة الأولية: ${summary.initialColumns}`,
      ...(summary.updateRanges.length ? [`نطاقات التعديل: ${summary.updateRanges.join("، ")}`] : []),
      `معاينة القيم: ${previewText}`,
      "ستُكتب القيم كما هي ثم تُقرأ مجددًا للتحقق من النتيجة.",
    ],
  };
}

function externalActionFromExecutionResult(result: OperationExecutionResult): Record<string, unknown> {
  return asRecord(asRecord(result.action).externalAction);
}

export const googleSheetsExternalActionConnector: ExternalActionConnector = {
  provider: "google_sheets",
  actionType: "google_sheets_create_populate",
  approvalToolName: GOOGLE_SHEETS_APPROVAL_TOOL,
  toolGuidance:
    "Google Sheets is one-time external_action work. Use action.type google_sheets_create_populate with spreadsheetTitle, sheetTitle, bounded initialValues and explicit updates. The first approval only saves the Work; a second approval is required before any provider request.",
  validateSetupAction(action, setupApprovalOperationId) {
    const parsed = googleSheetsWorkActionInputSchema.safeParse(action);
    if (!parsed.success) return null;
    const stored = storedGoogleSheetsWorkActionSchema.safeParse({
      ...parsed.data,
      actionId: randomUUID(),
      setupApprovalOperationId,
    });
    return stored.success ? stored.data as unknown as Record<string, unknown> : null;
  },
  setupApprovalDisplay: sheetsSetupDisplay,
  prepareApproval({ identity, work, runId }) {
    const action = storedGoogleSheetsWorkActionSchema.parse(work.action);
    const args = makeGoogleSheetsApprovalArgs({
      identity,
      work,
      run: { id: runId, workId: work.id },
      action,
    });
    const display = sheetsApprovalDisplay(args as unknown as Record<string, unknown>);
    return {
      actionId: action.actionId,
      actionType: action.type,
      idempotencyActionKind: action.type,
      idempotencyActionVersion: action.actionId,
      args: args as unknown as Record<string, unknown>,
      display,
      notificationTitle: `موافقة مطلوبة: ${action.spreadsheetTitle}`,
      notificationBody:
        `جهزت إنشاء جدول «${action.spreadsheetTitle}» وكتابة ${action.initialValues.length} صفًا${action.updates.length ? ` مع ${action.updates.length} تعديل إضافي` : ""}. لم أتصل بـ Google Sheets؛ راجع التفاصيل ووافق على الإجراء.`,
      notificationData: {
        source: this.provider,
        workId: work.id,
        actionId: action.actionId,
        spreadsheetTitle: action.spreadsheetTitle,
        deepLink: `/main?workId=${encodeURIComponent(work.id)}`,
      },
      evidence: {
        provider: this.provider,
        actionType: action.type,
        actionId: action.actionId,
        setupApprovalOperationId: action.setupApprovalOperationId,
        approvedActionHash: args.approvedActionHash,
        rows: action.initialValues.length,
        updateCount: action.updates.length,
        status: "approval_requested",
      },
    };
  },
  approvalDisplay: sheetsApprovalDisplay,
  async executeApproved(input) {
    const executionResult = await executeGoogleSheetsApproval(input);
    const externalAction = externalActionFromExecutionResult(executionResult);
    const status = externalAction.status;
    if (status !== "verified" && status !== "failed" && status !== "unknown_result") {
      return makeExternalActionResult({
        status: "failed",
        executionResult,
        error: {
          code: "EXTERNAL_ACTION_RESULT_MISSING_STATUS",
          outcome: "failed",
          retryable: false,
          reviewRequired: true,
        },
      });
    }
    const providerReference = asRecord(externalAction.providerReference);
    const verification = asRecord(externalAction.verification);
    const externalError = asRecord(externalAction.error);
    const workId = typeof input.operation.args.workId === "string"
      ? input.operation.args.workId
      : typeof input.operation.args.agentWorkId === "string"
        ? input.operation.args.agentWorkId
        : "";
    const events = workId ? await input.storage.listEvents(input.identity, workId, 100) : [];
    const event = [...events].reverse().find((item) =>
      asRecord(item.metadata).approvalOperationId === input.operation.operationId
      && (item.eventType === actionEventTypes.verified
        || item.eventType === actionEventTypes.failed
        || item.eventType === actionEventTypes.unknown));
    const evidenceReference = typeof externalAction.evidenceReference === "string"
      ? externalAction.evidenceReference
      : event?.id;
    const common = {
      executionResult,
      ...(Object.keys(providerReference).length ? { providerReference } : {}),
      ...(Object.keys(verification).length ? { verification } : {}),
      ...(evidenceReference ? { evidenceReference } : {}),
    };
    if (status === "verified") {
      return makeExternalActionResult({ status, ...common, verification });
    }
    return makeExternalActionResult({
      status,
      ...common,
      error: {
        code: typeof externalError.code === "string"
          ? externalError.code
          : typeof externalAction.reason === "string" ? externalAction.reason : status,
        outcome: status === "unknown_result"
          ? "unknown_result"
          : externalError.outcome === "rejected" ? "rejected" : "failed",
        retryable: externalError.retryable === true,
        reviewRequired: externalError.reviewRequired !== false,
      },
    });
  },
  recoverOperation({ events, approvalOperationId, operationArgs }) {
    return recoverGoogleSheetsOperation(events, approvalOperationId, operationArgs);
  },
};