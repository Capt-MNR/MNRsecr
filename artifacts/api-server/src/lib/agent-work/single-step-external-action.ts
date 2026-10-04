import { randomUUID } from "node:crypto";
import type { OperationExecutionResult, PendingOperation } from "../secretary-operations";
import {
  createExternalActionIdentity,
  hashExternalActionValue,
} from "./action-contract";
import { appendExternalActionEvent } from "./external-action-events";
import {
  makeExternalActionResult,
  type ExternalActionConnector,
  type ExternalActionConnectorResult,
  type ExternalActionOperationRecovery,
  type ExternalActionStatus,
} from "./external-action";
import type {
  AgentWorkEventRecord,
  AgentWorkIdentity,
  AgentWorkRecord,
  StorageAdapter,
} from "./types";

export type SingleStepProviderOutcome =
  | {
      status: "verified";
      verification: Record<string, unknown>;
      providerReference?: Record<string, unknown>;
    }
  | {
      status: "failed" | "unknown_result";
      error: {
        code: string;
        outcome: "rejected" | "failed" | "unknown_result";
        retryable: boolean;
        reviewRequired: boolean;
      };
      verification?: Record<string, unknown>;
      providerReference?: Record<string, unknown>;
    };

export type SingleStepActionAdapter<TAction extends Record<string, unknown>> = {
  execute(input: {
    identity: AgentWorkIdentity;
    action: TAction;
    stepId: string;
    idempotencyKey: string;
  }): Promise<SingleStepProviderOutcome>;
  /** Reconciliation must be read-only. It must never repeat the action. */
  reconcile(input: {
    identity: AgentWorkIdentity;
    action: TAction;
    stepId: string;
    idempotencyKey: string;
    providerReference?: Record<string, unknown>;
  }): Promise<SingleStepProviderOutcome>;
};

export type SingleStepExternalActionDefinition<
  TAction extends Record<string, unknown>,
  TStoredAction extends TAction & { actionId: string; setupApprovalOperationId: string },
> = {
  provider: string;
  actionType: string;
  approvalToolName: string;
  version: string;
  toolGuidance: string;
  parseAction(value: unknown): TAction | null;
  storeAction(
    action: TAction,
    actionId: string,
    setupApprovalOperationId: string,
  ): TStoredAction | null;
  parseStoredAction(value: unknown): TStoredAction | null;
  display(action: TStoredAction): { title: string; details: string[] };
  evidence(action: TStoredAction): Record<string, unknown>;
  notification(action: TStoredAction): { title: string; body: string };
  adapter: SingleStepActionAdapter<TStoredAction>;
};

type Step = {
  actionId: string;
  stepId: string;
  idempotencyKey: string;
  kind: string;
};

type ApprovalArgs<TAction extends Record<string, unknown>> = {
  workId: string;
  runId: string;
  actionId: string;
  setupApprovalOperationId: string;
  provider: string;
  actionType: string;
  action: TAction;
  approvedActionHash: string;
  step: Step;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const stepIdPattern = /^step_[a-f0-9]{48}$/u;
const idempotencyKeyPattern = /^agent-action:[a-f0-9]{64}$/u;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asOutcome(value: unknown): ExternalActionStatus | null {
  return value === "verified" || value === "failed" || value === "unknown_result"
    ? value
    : null;
}

function eventTypeFor(status: ExternalActionStatus): string {
  if (status === "verified") return "external_action_step_verified";
  if (status === "failed") return "external_action_step_failed";
  return "external_action_unknown_result";
}

function safeError(outcome: SingleStepProviderOutcome): {
  code: string;
  outcome: "rejected" | "failed" | "unknown_result";
  retryable: boolean;
  reviewRequired: boolean;
} | undefined {
  return outcome.status === "verified" ? undefined : outcome.error;
}

export function createSingleStepExternalActionConnector<
  TAction extends Record<string, unknown>,
  TStoredAction extends TAction & { actionId: string; setupApprovalOperationId: string },
>(
  definition: SingleStepExternalActionDefinition<TAction, TStoredAction>,
): ExternalActionConnector {
  function parseStored(value: unknown): TStoredAction {
    const parsed = definition.parseStoredAction(value);
    if (!parsed) throw new Error("EXTERNAL_ACTION_STORED_ACTION_INVALID");
    return parsed;
  }

  function parseArgs(value: unknown): ApprovalArgs<TStoredAction> | null {
    const args = asRecord(value);
    const action = definition.parseStoredAction(args.action);
    const step = asRecord(args.step);
    if (!action
      || typeof args.workId !== "string" || !uuidPattern.test(args.workId)
      || typeof args.runId !== "string" || !uuidPattern.test(args.runId)
      || typeof args.actionId !== "string" || !uuidPattern.test(args.actionId)
      || typeof args.setupApprovalOperationId !== "string"
      || !uuidPattern.test(args.setupApprovalOperationId)
      || args.provider !== definition.provider
      || args.actionType !== definition.actionType
      || action.actionId !== args.actionId
      || action.setupApprovalOperationId !== args.setupApprovalOperationId
      || typeof args.approvedActionHash !== "string"
      || !/^[a-f0-9]{64}$/u.test(args.approvedActionHash)
      || step.actionId !== args.actionId
      || typeof step.stepId !== "string" || !stepIdPattern.test(step.stepId)
      || typeof step.idempotencyKey !== "string" || !idempotencyKeyPattern.test(step.idempotencyKey)
      || step.kind !== definition.actionType) {
      return null;
    }
    return {
      workId: args.workId,
      runId: args.runId,
      actionId: args.actionId,
      setupApprovalOperationId: args.setupApprovalOperationId,
      provider: definition.provider,
      actionType: definition.actionType,
      action,
      approvedActionHash: args.approvedActionHash,
      step: {
        actionId: args.actionId,
        stepId: step.stepId,
        idempotencyKey: step.idempotencyKey,
        kind: definition.actionType,
      },
    };
  }

  function createStep(input: {
    identity: AgentWorkIdentity;
    workId: string;
    runId: string;
    action: TStoredAction;
  }): Step {
    const identity = createExternalActionIdentity({
      tenantId: input.identity.tenantId,
      ownerUserId: input.identity.userId,
      workId: input.workId,
      runId: input.runId,
      approvalOperationId: "pending",
      actionId: input.action.actionId,
      stepKey: definition.actionType,
      actionVersion: definition.version,
    });
    return {
      actionId: input.action.actionId,
      stepId: identity.stepId,
      idempotencyKey: identity.idempotencyKey,
      kind: definition.actionType,
    };
  }

  function approvedHash(action: TStoredAction, step: Step): string {
    return hashExternalActionValue({
      provider: definition.provider,
      actionType: definition.actionType,
      action,
      plan: [step],
    });
  }

  function executionResult(input: {
    operation: PendingOperation;
    args: ApprovalArgs<TStoredAction>;
    outcome: SingleStepProviderOutcome;
    evidenceReference?: string;
  }): OperationExecutionResult {
    const error = safeError(input.outcome);
    const externalAction = {
      provider: definition.provider,
      actionType: definition.actionType,
      status: input.outcome.status,
      workId: input.args.workId,
      runId: input.args.runId,
      approvalOperationId: input.operation.operationId,
      actionId: input.args.actionId,
      stepId: input.args.step.stepId,
      ...(input.outcome.providerReference
        ? { providerReference: input.outcome.providerReference }
        : {}),
      ...(input.outcome.verification ? { verification: input.outcome.verification } : {}),
      ...(input.evidenceReference ? { evidenceReference: input.evidenceReference } : {}),
      ...(error
        ? {
            error,
            ...(input.outcome.status === "unknown_result"
              ? { retryable: false, reviewRequired: true }
              : {}),
          }
        : {}),
    };
    return {
      conversationId: input.operation.conversationId ?? `agent-work:${input.args.workId}`,
      assistantMessage: input.outcome.status === "verified"
        ? "The external action completed and was verified."
        : input.outcome.status === "unknown_result"
          ? "The external result is uncertain. Automatic retry is stopped pending review."
          : "The external action failed and was not verified.",
      action: {
        type: `${definition.provider}_action_${input.outcome.status}`,
        actionState: input.outcome.status,
        operationId: input.operation.operationId,
        workId: input.args.workId,
        runId: input.args.runId,
        actionId: input.args.actionId,
        stepId: input.args.step.stepId,
        externalAction,
      },
      provider: definition.provider,
      model: "external-action-connector",
    };
  }

  function connectorResult(
    result: OperationExecutionResult,
  ): ExternalActionConnectorResult<OperationExecutionResult> {
    const action = asRecord(result.action);
    const external = asRecord(action.externalAction);
    const status = asOutcome(external.status);
    if (!status) {
      return makeExternalActionResult({
        status: "failed",
        executionResult: result,
        error: {
          code: "EXTERNAL_ACTION_RESULT_MISSING_STATUS",
          outcome: "failed",
          retryable: false,
          reviewRequired: true,
        },
      });
    }
    const reference = asRecord(external.providerReference);
    const verification = asRecord(external.verification);
    const error = asRecord(external.error);
    const common = {
      executionResult: result,
      ...(Object.keys(reference).length ? { providerReference: reference } : {}),
      ...(Object.keys(verification).length ? { verification } : {}),
      ...(typeof external.evidenceReference === "string"
        ? { evidenceReference: external.evidenceReference }
        : {}),
    };
    if (status === "verified") {
      return makeExternalActionResult({
        status,
        ...common,
        verification,
      });
    }
    return makeExternalActionResult({
      status,
      ...common,
      error: {
        code: typeof error.code === "string" ? error.code : `EXTERNAL_ACTION_${status.toUpperCase()}`,
        outcome: status === "unknown_result"
          ? "unknown_result"
          : error.outcome === "rejected" ? "rejected" : "failed",
        retryable: false,
        reviewRequired: true,
      },
    });
  }

  function terminalOutcome(event: AgentWorkEventRecord): SingleStepProviderOutcome | null {
    const status = event.eventType === "external_action_step_verified"
      ? "verified"
      : event.eventType === "external_action_step_failed"
        ? "failed"
        : event.eventType === "external_action_unknown_result"
          ? "unknown_result"
          : null;
    if (!status) return null;
    const metadata = asRecord(event.metadata);
    const verification = asRecord(metadata.verification);
    const providerReference = asRecord(metadata.providerReference);
    if (status === "verified") {
      return { status, verification, ...(Object.keys(providerReference).length ? { providerReference } : {}) };
    }
    const error = asRecord(metadata.error);
    return {
      status,
      error: {
        code: typeof error.code === "string" ? error.code : `EXTERNAL_ACTION_${status.toUpperCase()}`,
        outcome: status === "unknown_result"
          ? "unknown_result"
          : error.outcome === "rejected" ? "rejected" : "failed",
        retryable: false,
        reviewRequired: true,
      },
      ...(Object.keys(verification).length ? { verification } : {}),
      ...(Object.keys(providerReference).length ? { providerReference } : {}),
    };
  }

  function recover(input: {
    events: AgentWorkEventRecord[];
    approvalOperationId: string;
    operationArgs: Record<string, unknown>;
  }): ExternalActionOperationRecovery {
    const args = parseArgs(input.operationArgs);
    if (!args) return { state: "failed", reason: "EXTERNAL_ACTION_APPROVAL_ARGS_INVALID" };
    const events = input.events
      .filter((event) => {
        const metadata = asRecord(event.metadata);
        return metadata.approvalOperationId === input.approvalOperationId
          && metadata.stepId === args.step.stepId;
      })
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    const terminal = [...events].reverse()
      .map((event) => ({ event, outcome: terminalOutcome(event) }))
      .find((item) => item.outcome !== null);
    if (terminal?.outcome) {
      const result = executionResult({
        operation: {
          operationId: input.approvalOperationId,
          conversationId: null,
        } as PendingOperation,
        args,
        outcome: terminal.outcome,
        evidenceReference: terminal.event.id,
      });
      if (terminal.outcome.status === "verified") return { state: "verified", result };
      if (terminal.outcome.status === "unknown_result") return { state: "unknown_result", result };
      return {
        state: "failed",
        reason: terminal.outcome.error.code,
      };
    }
    if (events.some((event) => event.eventType === "external_action_step_started")) {
      const outcome: SingleStepProviderOutcome = {
        status: "unknown_result",
        error: {
          code: "EXTERNAL_ACTION_STEP_RECEIPT_MISSING",
          outcome: "unknown_result",
          retryable: false,
          reviewRequired: true,
        },
        verification: { state: "unknown_result", reason: "STEP_RECEIPT_MISSING" },
      };
      return {
        state: "unknown_result",
        result: executionResult({
          operation: {
            operationId: input.approvalOperationId,
            conversationId: null,
          } as PendingOperation,
          args,
          outcome,
        }),
      };
    }
    return { state: "safe_to_retry" };
  }

  async function persistOutcome(input: {
    identity: AgentWorkIdentity;
    storage: StorageAdapter;
    operation: PendingOperation;
    args: ApprovalArgs<TStoredAction>;
    outcome: SingleStepProviderOutcome;
  }): Promise<OperationExecutionResult> {
    const event = await appendExternalActionEvent({
      storage: input.storage,
      identity: input.identity,
      workId: input.args.workId,
      runId: input.args.runId,
      approvalOperationId: input.operation.operationId,
      actionId: input.args.actionId,
      stepId: input.args.step.stepId,
      eventType: eventTypeFor(input.outcome.status),
      summary: `${definition.provider} action ${input.outcome.status}`,
      metadata: {
        idempotencyKey: input.args.step.idempotencyKey,
        actionState: input.outcome.status,
        approvedActionHash: input.args.approvedActionHash,
        ...(input.outcome.providerReference
          ? { providerReference: input.outcome.providerReference }
          : {}),
        ...(input.outcome.verification ? { verification: input.outcome.verification } : {}),
        ...(input.outcome.status !== "verified" ? { error: input.outcome.error } : {}),
      },
    });
    return executionResult({
      operation: input.operation,
      args: input.args,
      outcome: input.outcome,
      evidenceReference: event.id,
    });
  }

  async function reconcileUnknown(input: {
    identity: AgentWorkIdentity;
    storage: StorageAdapter;
    operation: PendingOperation;
    args: ApprovalArgs<TStoredAction>;
    previous: OperationExecutionResult;
  }): Promise<ExternalActionConnectorResult<OperationExecutionResult>> {
    const previousAction = asRecord(input.previous.action);
    const previousExternal = asRecord(previousAction.externalAction);
    const providerReference = asRecord(previousExternal.providerReference);
    let outcome: SingleStepProviderOutcome;
    try {
      outcome = await definition.adapter.reconcile({
        identity: input.identity,
        action: input.args.action,
        stepId: input.args.step.stepId,
        idempotencyKey: input.args.step.idempotencyKey,
        ...(Object.keys(providerReference).length ? { providerReference } : {}),
      });
    } catch {
      return connectorResult(input.previous);
    }
    if (outcome.status !== "verified") {
      return connectorResult(input.previous);
    }
    const result = await persistOutcome({
      identity: input.identity,
      storage: input.storage,
      operation: input.operation,
      args: input.args,
      outcome,
    });
    return connectorResult(result);
  }

  return {
    provider: definition.provider,
    actionType: definition.actionType,
    approvalToolName: definition.approvalToolName,
    toolGuidance: definition.toolGuidance,
    validateSetupAction(action, setupApprovalOperationId) {
      const parsed = definition.parseAction(action);
      if (!parsed || !uuidPattern.test(setupApprovalOperationId)) return null;
      return definition.storeAction(parsed, randomUUID(), setupApprovalOperationId);
    },
    setupApprovalDisplay(workTitle, action) {
      const parsed = definition.parseStoredAction(action);
      return parsed
        ? {
            ...definition.display(parsed),
            title: `Prepare ${definition.provider} action: ${workTitle}`,
          }
        : { title: `Prepare ${definition.provider} action`, details: ["Action details are invalid."] };
    },
    prepareApproval({ identity, work, runId }) {
      const action = parseStored(work.action);
      const step = createStep({ identity, workId: work.id, runId, action });
      const hash = approvedHash(action, step);
      const args: ApprovalArgs<TStoredAction> = {
        workId: work.id,
        runId,
        actionId: action.actionId,
        setupApprovalOperationId: action.setupApprovalOperationId,
        provider: definition.provider,
        actionType: definition.actionType,
        action,
        approvedActionHash: hash,
        step,
      };
      return {
        actionId: action.actionId,
        actionType: definition.actionType,
        idempotencyActionKind: definition.actionType,
        idempotencyActionVersion: definition.version,
        args: args as unknown as Record<string, unknown>,
        display: definition.display(action),
        notificationTitle: definition.notification(action).title,
        notificationBody: definition.notification(action).body,
        notificationData: {
          source: definition.provider,
          workId: work.id,
          actionId: action.actionId,
          deepLink: `/main?workId=${encodeURIComponent(work.id)}`,
        },
        evidence: {
          provider: definition.provider,
          actionType: definition.actionType,
          actionId: action.actionId,
          setupApprovalOperationId: action.setupApprovalOperationId,
          approvedActionHash: hash,
          ...definition.evidence(action),
          status: "approval_requested",
        },
      };
    },
    approvalDisplay(args) {
      const parsed = parseArgs(args);
      return parsed
        ? definition.display(parsed.action)
        : { title: "External action approval", details: ["Action details are invalid; nothing was sent."] };
    },
    async executeApproved(input) {
      const args = parseArgs(input.operation.args);
      if (!args || input.operation.toolName !== definition.approvalToolName) {
        throw new Error("EXTERNAL_ACTION_APPROVAL_ARGS_INVALID");
      }
      const work = await input.storage.getWork(input.identity, args.workId);
      const run = await input.storage.getRun(input.identity, args.runId);
      if (!work || !run) throw new Error("EXTERNAL_ACTION_APPROVAL_CONTEXT_MISSING");
      const storedAction = definition.parseStoredAction(work.action);
      const expectedStep = storedAction
        ? createStep({ identity: input.identity, workId: work.id, runId: run.id, action: storedAction })
        : null;
      if (!storedAction
        || !expectedStep
        || work.kind !== "external_action"
        || work.status !== "waiting"
        || asRecord(work.source).type !== definition.provider
        || run.workId !== work.id
        || args.workId !== work.id
        || args.runId !== run.id
        || args.actionId !== storedAction.actionId
        || args.setupApprovalOperationId !== storedAction.setupApprovalOperationId
        || hashExternalActionValue(args.action) !== hashExternalActionValue(storedAction)
        || hashExternalActionValue(args.step) !== hashExternalActionValue(expectedStep)
        || approvedHash(storedAction, expectedStep) !== args.approvedActionHash) {
        throw new Error("EXTERNAL_ACTION_APPROVAL_CONTEXT_MISMATCH");
      }

      const events = await input.storage.listEvents(input.identity, work.id, 100);
      const recovery = recover({
        events,
        approvalOperationId: input.operation.operationId,
        operationArgs: input.operation.args,
      });
      if (recovery.state === "verified" || recovery.state === "failed") {
        return recovery.state === "verified"
          ? connectorResult(recovery.result)
          : makeExternalActionResult({
              status: "failed",
              error: {
                code: recovery.reason,
                outcome: "failed",
                retryable: false,
                reviewRequired: true,
              },
            });
      }
      if (recovery.state === "unknown_result") {
        return reconcileUnknown({
          identity: input.identity,
          storage: input.storage,
          operation: input.operation,
          args,
          previous: recovery.result,
        });
      }

      await appendExternalActionEvent({
        storage: input.storage,
        identity: input.identity,
        workId: work.id,
        runId: run.id,
        approvalOperationId: input.operation.operationId,
        actionId: args.actionId,
        stepId: args.step.stepId,
        eventType: "external_action_step_started",
        summary: `${definition.provider} action started after approval`,
        metadata: {
          idempotencyKey: args.step.idempotencyKey,
          actionState: "started",
          approvedActionHash: args.approvedActionHash,
        },
      });
      let outcome: SingleStepProviderOutcome;
      try {
        outcome = await definition.adapter.execute({
          identity: input.identity,
          action: storedAction,
          stepId: args.step.stepId,
          idempotencyKey: args.step.idempotencyKey,
        });
      } catch {
        outcome = {
          status: "unknown_result",
          error: {
            code: "EXTERNAL_ACTION_PROVIDER_OUTCOME_UNKNOWN",
            outcome: "unknown_result",
            retryable: false,
            reviewRequired: true,
          },
          verification: { state: "unknown_result", reason: "PROVIDER_EXCEPTION" },
        };
      }
      const result = await persistOutcome({
        identity: input.identity,
        storage: input.storage,
        operation: input.operation,
        args,
        outcome,
      });
      if (outcome.status !== "unknown_result") return connectorResult(result);
      return reconcileUnknown({
        identity: input.identity,
        storage: input.storage,
        operation: input.operation,
        args,
        previous: result,
      });
    },
    recoverOperation: recover,
  };
}