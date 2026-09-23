import type {
  AgentWorkIdentity,
  AgentWorkKind,
  AgentWorkRecord,
  AgentWorkRunRecord,
  AgentWorkRunStatus,
  AgentWorkStatus,
} from "./types";

export type TriggerDefinition = {
  workId: string;
  kind: AgentWorkKind;
  title: string;
  source: Record<string, unknown>;
  condition: Record<string, unknown>;
  schedule: Record<string, unknown>;
  nextRunAt: Date | null;
};

export type TriggerEventKind = "time_due" | "waiting_reconciliation";

export type TriggerEvent = {
  kind: TriggerEventKind;
  workId: string;
  runId: string | null;
  occurredAt: Date;
  reason: string;
};

export type TriggerConditionState =
  | "verified"
  | "unchanged"
  | "uncertain"
  | "needs_review";

export type TriggerEvaluation = {
  state: TriggerConditionState;
  status: AgentWorkRunStatus;
  workStatus: AgentWorkStatus;
  nextRunAt: Date | null;
  verification: Record<string, unknown>;
  evidence: Record<string, unknown>;
  reason: string;
};

export type WorkIntent = {
  identity: AgentWorkIdentity;
  work: AgentWorkRecord;
  run: AgentWorkRunRecord;
  trigger: TriggerDefinition;
  event: TriggerEvent;
};

export type ActionPlan = {
  status: AgentWorkRunStatus;
  workStatus: AgentWorkStatus;
  nextRunAt: Date | null;
  verification: Record<string, unknown>;
  error?: string;
  notificationTitle: string;
  notificationBody: string;
  notificationData?: Record<string, unknown>;
  notify: boolean;
  approvalOperationId?: string;
  approvalAction?: string;
};

export type ExecutionOutcome = {
  evaluation: TriggerEvaluation;
  plan: ActionPlan;
  evidence: Record<string, unknown>;
};

export function triggerDefinitionForWork(work: AgentWorkRecord): TriggerDefinition {
  return {
    workId: work.id,
    kind: work.kind,
    title: work.title,
    source: work.source,
    condition: work.condition,
    schedule: work.schedule,
    nextRunAt: work.nextRunAt,
  };
}

export function timeDueTriggerEvent(
  work: AgentWorkRecord,
  run: AgentWorkRunRecord,
  occurredAt: Date,
): TriggerEvent {
  return {
    kind: "time_due",
    workId: work.id,
    runId: run.id,
    occurredAt,
    reason: "work_next_run_at_reached",
  };
}

export function waitingReconciliationEvent(
  work: AgentWorkRecord,
  occurredAt: Date,
): TriggerEvent {
  return {
    kind: "waiting_reconciliation",
    workId: work.id,
    runId: null,
    occurredAt,
    reason: "approval_result_requires_reconciliation",
  };
}

export function evaluationFromPlan(
  plan: ActionPlan,
  evidence: Record<string, unknown>,
): TriggerEvaluation {
  const state: TriggerConditionState = plan.status === "verified"
    || plan.status === "unchanged"
    || plan.status === "uncertain"
    || plan.status === "needs_review"
    ? plan.status
    : "needs_review";
  return {
    state,
    status: plan.status,
    workStatus: plan.workStatus,
    nextRunAt: plan.nextRunAt,
    verification: plan.verification,
    evidence,
    reason: typeof plan.verification.reason === "string"
      ? plan.verification.reason
      : String(plan.verification.kind ?? "trigger_evaluated"),
  };
}