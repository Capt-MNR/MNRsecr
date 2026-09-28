import { createHash } from "node:crypto";
import type { OperationExecutionResult, PendingOperation } from "../secretary-operations";
import type { AgentWorkEventRecord, AgentWorkIdentity, AgentWorkRecord, StorageAdapter } from "./types";

export type ExternalActionStatus = "verified" | "failed" | "unknown_result";

export type ExternalActionIdentity = {
  workId: string;
  runId: string;
  approvalOperationId: string;
  actionId: string;
  stepId: string;
  idempotencyKey: string;
};

export type ExternalActionClassifiedError = {
  code: string;
  outcome: "rejected" | "failed" | "unknown_result";
  retryable: boolean;
  reviewRequired: boolean;
};

export type ExternalActionConnectorResult<TExecution = unknown> =
  | {
      status: "verified";
      executionResult: TExecution;
      providerReference?: Record<string, unknown>;
      verification: Record<string, unknown>;
      evidenceReference?: string;
    }
  | {
      status: "failed";
      executionResult?: TExecution;
      providerReference?: Record<string, unknown>;
      verification?: Record<string, unknown>;
      evidenceReference?: string;
      error: ExternalActionClassifiedError;
    }
  | {
      status: "unknown_result";
      executionResult?: TExecution;
      providerReference?: Record<string, unknown>;
      verification?: Record<string, unknown>;
      evidenceReference?: string;
      error: ExternalActionClassifiedError;
      retryable: false;
      reviewRequired: true;
    };

export type ExternalActionOperationRecovery =
  | { state: "verified"; result: OperationExecutionResult }
  | { state: "failed"; reason: string }
  | { state: "unknown_result"; result: OperationExecutionResult }
  | { state: "safe_to_retry" };

export type ExternalActionApprovalPreparation = {
  actionId: string;
  actionType: string;
  idempotencyActionKind: string;
  idempotencyActionVersion: string;
  args: Record<string, unknown>;
  display: { title: string; details: string[] };
  notificationTitle: string;
  notificationBody: string;
  notificationData: Record<string, unknown>;
  evidence: Record<string, unknown>;
};

export type ExternalActionExecutionContext = {
  identity: AgentWorkIdentity;
  operation: PendingOperation;
  storage: StorageAdapter;
};

export interface ExternalActionConnector {
  readonly provider: string;
  readonly actionType: string;
  readonly approvalToolName: string;
  readonly toolGuidance: string;
  validateSetupAction(action: Record<string, unknown>, setupApprovalOperationId: string): Record<string, unknown> | null;
  setupApprovalDisplay(workTitle: string, action: Record<string, unknown>): { title: string; details: string[] };
  prepareApproval(input: {
    identity: AgentWorkIdentity;
    work: AgentWorkRecord;
    runId: string;
  }): ExternalActionApprovalPreparation;
  approvalDisplay(args: Record<string, unknown>): { title: string; details: string[] };
  executeApproved(input: ExternalActionExecutionContext): Promise<ExternalActionConnectorResult<OperationExecutionResult>>;
  recoverOperation(input: {
    events: AgentWorkEventRecord[];
    approvalOperationId: string;
    operationArgs: Record<string, unknown>;
  }): ExternalActionOperationRecovery;
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("EXTERNAL_ACTION_NON_FINITE_NUMBER");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("EXTERNAL_ACTION_NON_PLAIN_OBJECT");
    }
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalValue((value as Record<string, unknown>)[key])]),
    );
  }
  throw new Error("EXTERNAL_ACTION_UNSUPPORTED_CANONICAL_VALUE");
}

export function canonicalExternalActionPayload(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function hashExternalActionPayload(value: unknown): string {
  return createHash("sha256").update(canonicalExternalActionPayload(value)).digest("hex");
}

const sensitiveEvidenceKey =
  /(authorization|cookie|token|secret|password|credential|api[-_]?key|^(?:payload|values|initialvalues|updates|requestbody|responsebody|content|body)$)/iu;

function safeEvidenceValue(value: unknown, depth: number): unknown {
  if (depth > 5) return "[truncated]";
  if (typeof value === "string") {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, "Bearer [redacted]")
      .replace(/\b(api[-_]?key|access[-_]?token|password|secret)\s*[:=]\s*[^\s,;]+/giu, "$1=[redacted]")
      .slice(0, 500);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeEvidenceValue(item, depth + 1));
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !sensitiveEvidenceKey.test(key))
      .slice(0, 32)
      .map(([key, item]) => [key, safeEvidenceValue(item, depth + 1)]),
  );
}

export function sanitizeExternalActionEvidence(
  evidence: Record<string, unknown>,
): Record<string, unknown> {
  return safeEvidenceValue(evidence, 0) as Record<string, unknown>;
}

export function makeExternalActionResult<TExecution>(input: {
  status: ExternalActionStatus;
  executionResult?: TExecution;
  providerReference?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  evidenceReference?: string;
  error?: ExternalActionClassifiedError;
}): ExternalActionConnectorResult<TExecution> {
  if (input.status === "verified") {
    if (input.executionResult === undefined || !input.verification) {
      throw new Error("EXTERNAL_ACTION_VERIFIED_RESULT_INCOMPLETE");
    }
    return {
      status: "verified",
      executionResult: input.executionResult,
      ...(input.providerReference ? { providerReference: input.providerReference } : {}),
      verification: input.verification,
      ...(input.evidenceReference ? { evidenceReference: input.evidenceReference } : {}),
    };
  }
  if (!input.error) throw new Error("EXTERNAL_ACTION_ERROR_REQUIRED");
  if (input.status === "unknown_result") {
    return {
      status: "unknown_result",
      ...(input.executionResult !== undefined ? { executionResult: input.executionResult } : {}),
      ...(input.providerReference ? { providerReference: input.providerReference } : {}),
      ...(input.verification ? { verification: input.verification } : {}),
      ...(input.evidenceReference ? { evidenceReference: input.evidenceReference } : {}),
      error: { ...input.error, outcome: "unknown_result", retryable: false, reviewRequired: true },
      retryable: false,
      reviewRequired: true,
    };
  }
  return {
    status: "failed",
    ...(input.executionResult !== undefined ? { executionResult: input.executionResult } : {}),
    ...(input.providerReference ? { providerReference: input.providerReference } : {}),
    ...(input.verification ? { verification: input.verification } : {}),
    ...(input.evidenceReference ? { evidenceReference: input.evidenceReference } : {}),
    error: { ...input.error, outcome: input.error.outcome === "rejected" ? "rejected" : "failed" },
  };
}

export function externalActionStatusFromResult(value: unknown): ExternalActionStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const result = root.result && typeof root.result === "object" && !Array.isArray(root.result)
    ? root.result as Record<string, unknown>
    : root;
  const action = result.action;
  if (!action || typeof action !== "object" || Array.isArray(action)) return null;
  const externalAction = (action as Record<string, unknown>).externalAction;
  if (!externalAction || typeof externalAction !== "object" || Array.isArray(externalAction)) return null;
  const status = (externalAction as Record<string, unknown>).status;
  return status === "verified" || status === "failed" || status === "unknown_result"
    ? status
    : null;
}