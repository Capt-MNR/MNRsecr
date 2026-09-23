import { and, eq } from "drizzle-orm";
import {
  commitmentsTable,
  db,
  agentWorksTable,
} from "@workspace/db";
import type { DbExecutor } from "./entity-graph";
import {
  compareCondition,
  comparisonOperator,
  type ComparisonOperator,
} from "./agent-work/condition-evaluator";
import type {
  TriggerEvaluation,
  TriggerOutboxEvent,
} from "./trigger-outbox";

export type TriggerEvaluationContext = {
  executor: DbExecutor;
  now: Date;
};

type TriggerEvaluator = (
  event: TriggerOutboxEvent,
  context: TriggerEvaluationContext,
) => Promise<TriggerEvaluation>;

const evaluators = new Map<string, TriggerEvaluator>();

function evaluatorKey(eventType: string, aggregateType: string): string {
  return `${eventType}:${aggregateType}`;
}

function notEligible(
  triggerKey: string,
  reason: string,
): TriggerEvaluation {
  return { eligible: false, triggerKey, reason };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function conditionKey(input: {
  entity: string;
  metric: string;
  operator: ComparisonOperator;
  threshold: number;
}): string {
  return [
    input.entity,
    input.metric,
    input.operator,
    input.threshold,
  ].join(":");
}

async function thresholdEvaluation(
  event: TriggerOutboxEvent,
  context: TriggerEvaluationContext,
): Promise<TriggerEvaluation> {
  const triggerKey = "task-open-count-threshold-v1";
  const payload = event.payload;
  const operator = comparisonOperator(payload.operator);
  const threshold = integerValue(payload.threshold);
  const previousValue = integerValue(payload.previousValue);
  const currentValue = integerValue(payload.currentValue);
  const entity = stringValue(payload.entity);
  const metric = stringValue(payload.metric);
  const transitionKey = stringValue(payload.transitionKey);
  const workId = stringValue(payload.workId);
  const mode = payload.mode === "level" ? "level" : "edge";

  if (
    entity !== "tasks"
    || metric !== "open_task_count"
    || !operator
    || threshold === null
    || threshold < 0
    || previousValue === null
    || currentValue === null
    || !transitionKey
  ) {
    return notEligible(triggerKey, "unsupported_threshold_condition");
  }

  if (workId) {
    const [work] = await context.executor.select({ id: agentWorksTable.id })
      .from(agentWorksTable)
      .where(and(
        eq(agentWorksTable.tenantId, event.tenantId),
        eq(agentWorksTable.ownerUserId, event.ownerUserId),
        eq(agentWorksTable.id, workId),
        eq(agentWorksTable.status, "active"),
      ))
      .limit(1)
      .for("update");
    if (!work) {
      return {
        ...notEligible(triggerKey, "agent_work_not_active"),
        defer: true,
      };
    }
  }

  const previousMet = compareCondition(previousValue, operator, threshold);
  const currentMet = compareCondition(currentValue, operator, threshold);
  const eligible = mode === "level"
    ? currentMet
    : !previousMet && currentMet;
  const key = conditionKey({ entity, metric, operator, threshold });
  if (!eligible) {
    return {
      ...notEligible(
        triggerKey,
        mode === "level"
          ? currentMet ? "threshold_level_already_observed" : "threshold_below_condition"
          : currentMet ? "threshold_did_not_cross" : "threshold_below_condition",
      ),
      workIntentDedupeKey: [
        "trigger-threshold",
        event.tenantId,
        event.ownerUserId,
        workId ?? "global",
        key,
        transitionKey,
      ].join(":"),
    };
  }
  return {
    eligible: true,
    triggerKey,
    reason: mode === "level" ? "threshold_level_true" : "threshold_false_to_true",
    workIntentDedupeKey: [
      "trigger-threshold",
      event.tenantId,
      event.ownerUserId,
      workId ?? "global",
      key,
      transitionKey,
    ].join(":"),
  };
}

async function taskCreatedEvaluation(event: TriggerOutboxEvent): Promise<TriggerEvaluation> {
  const triggerKey = "task-created-to-agent-work-v1";
  if (event.payload.status !== "pending") {
    return notEligible(triggerKey, "task_not_pending");
  }
  return { eligible: true, triggerKey, reason: "task_created_pending" };
}

async function commitmentDeadlineEvaluation(
  event: TriggerOutboxEvent,
  context: TriggerEvaluationContext,
): Promise<TriggerEvaluation> {
  const triggerKey = "commitment-deadline-v1";
  const [commitment] = await context.executor.select().from(commitmentsTable).where(and(
    eq(commitmentsTable.tenantId, event.tenantId),
    eq(commitmentsTable.ownerUserId, event.ownerUserId),
    eq(commitmentsTable.id, event.aggregateId),
  )).limit(1);
  if (!commitment) return notEligible(triggerKey, "commitment_not_found");
  if (["completed", "closed", "cancelled"].includes(commitment.status)) {
    return notEligible(triggerKey, "commitment_already_completed");
  }
  if (!commitment.dueAt) return notEligible(triggerKey, "commitment_has_no_deadline");

  const expectedVersion = integerValue(event.payload.rowVersion);
  const expectedDueAt = stringValue(event.payload.dueAt);
  if (expectedVersion !== commitment.rowVersion) {
    return notEligible(triggerKey, "commitment_deadline_version_changed");
  }
  if (!expectedDueAt || expectedDueAt !== commitment.dueAt.toISOString()) {
    return notEligible(triggerKey, "commitment_deadline_changed");
  }
  if (commitment.dueAt.getTime() > context.now.getTime()) {
    return notEligible(triggerKey, "commitment_deadline_not_reached");
  }
  return {
    eligible: true,
    triggerKey,
    reason: "commitment_deadline_reached",
    workIntentDedupeKey: [
      "trigger-commitment-deadline",
      event.tenantId,
      event.ownerUserId,
      event.aggregateId,
      `v${commitment.rowVersion}`,
    ].join(":"),
  };
}

export function registerTriggerEvaluator(
  eventType: string,
  aggregateType: string,
  evaluator: TriggerEvaluator,
): void {
  evaluators.set(evaluatorKey(eventType, aggregateType), evaluator);
}

export async function evaluateTriggerEvent(
  event: TriggerOutboxEvent,
  context: TriggerEvaluationContext = { executor: db, now: new Date() },
): Promise<TriggerEvaluation> {
  const evaluator = evaluators.get(evaluatorKey(event.eventType, event.aggregateType));
  if (!evaluator) {
    return notEligible("unknown-trigger-v1", "no_matching_trigger");
  }
  return evaluator(event, context);
}

registerTriggerEvaluator("task.created", "task", taskCreatedEvaluation);
registerTriggerEvaluator("commitment.deadline", "commitment", commitmentDeadlineEvaluation);
registerTriggerEvaluator("task.open_count_threshold", "task", thresholdEvaluation);

export type { TriggerEvaluator };