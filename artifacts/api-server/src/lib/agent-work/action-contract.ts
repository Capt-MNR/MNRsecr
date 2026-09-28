import { createHash } from "node:crypto";
import type { ExternalActionIdentity } from "./types";

export type ExternalActionStepKind =
  | "create_spreadsheet"
  | "write_values"
  | "update_values"
  | "verify_values";

export type GoogleSheetsCell = string | number | boolean | null;

export type GoogleSheetsValueRange = {
  range: string;
  values: GoogleSheetsCell[][];
};

export type GoogleSheetsWorkAction = {
  type: "google_sheets_create_populate";
  spreadsheetTitle: string;
  sheetTitle: string;
  initialValues: GoogleSheetsCell[][];
  updates: GoogleSheetsValueRange[];
  actionId: string;
  sourceOperationId: string;
};

export type ExternalActionStep = {
  actionId: ExternalActionIdentity["actionId"];
  workId: ExternalActionIdentity["workId"];
  runId: ExternalActionIdentity["runId"];
  operationId: ExternalActionIdentity["operationId"];
  idempotencyKey: ExternalActionIdentity["idempotencyKey"];
  kind: ExternalActionStepKind;
  range?: string;
  values?: GoogleSheetsCell[][];
};

export function createExternalActionId(input: {
  tenantId: string;
  ownerUserId: string;
  workId: string;
  runId: string;
  stepKey: string;
  actionVersion: string;
}): string {
  const material = [
    input.tenantId,
    input.ownerUserId,
    input.workId,
    input.runId,
    input.stepKey,
    input.actionVersion,
  ].join(":");
  return `act_${createHash("sha256").update(material).digest("hex").slice(0, 48)}`;
}

export function createExternalActionIdempotencyKey(input: {
  tenantId: string;
  ownerUserId: string;
  workId: string;
  runId: string;
  actionId: string;
}): string {
  const material = [
    input.tenantId,
    input.ownerUserId,
    input.workId,
    input.runId,
    input.actionId,
  ].join(":");
  return `agent-action:${createHash("sha256").update(material).digest("hex")}`;
}

export function createExternalActionIdentity(input: {
  tenantId: string;
  ownerUserId: string;
  workId: string;
  runId: string;
  operationId: string;
  stepKey: string;
  actionVersion: string;
}): ExternalActionIdentity {
  const actionId = createExternalActionId(input);
  return {
    actionId,
    workId: input.workId,
    runId: input.runId,
    operationId: input.operationId,
    idempotencyKey: createExternalActionIdempotencyKey({
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      workId: input.workId,
      runId: input.runId,
      actionId,
    }),
  };
}

export function hashExternalActionValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}