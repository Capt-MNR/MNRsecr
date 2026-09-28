import type { ExternalActionIdentity } from "./external-action";

export type GoogleSheetsStepKind =
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
  setupApprovalOperationId: string;
};

export type GoogleSheetsActionStep = Pick<
  ExternalActionIdentity,
  "actionId" | "stepId" | "workId" | "runId" | "approvalOperationId" | "idempotencyKey"
> & {
  kind: GoogleSheetsStepKind;
  range?: string;
  values?: GoogleSheetsCell[][];
};