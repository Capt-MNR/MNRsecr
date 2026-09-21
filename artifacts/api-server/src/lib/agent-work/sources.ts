import { createHash } from "node:crypto";
import { and, eq, inArray, sql, not } from "drizzle-orm";
import { db, tasksTable } from "@workspace/db";
import type { AgentWorkIdentity, AgentWorkRecord } from "./types";

type InternalRecordMetric = "open_task_count";
type ComparisonOperator = "gt" | "gte" | "eq" | "lt" | "lte";

export type InternalRecordsSnapshot = {
  sourceType: "internal_records";
  entity: "tasks";
  metric: InternalRecordMetric;
  operator: ComparisonOperator;
  threshold: number;
  value: number;
  currency: null;
  sourceHash: string | null;
  conditionMet: boolean;
  comparisonKnown: boolean;
  reason: string;
};

export type InternalRecordsSourceRead = {
  snapshot: InternalRecordsSnapshot;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function comparisonOperator(value: unknown): ComparisonOperator | null {
  return value === "gt"
    || value === "gte"
    || value === "eq"
    || value === "lt"
    || value === "lte"
    ? value
    : null;
}

function compare(value: number, operator: ComparisonOperator, threshold: number): boolean {
  if (operator === "gt") return value > threshold;
  if (operator === "gte") return value >= threshold;
  if (operator === "eq") return value === threshold;
  if (operator === "lt") return value < threshold;
  return value <= threshold;
}

function hashSnapshot(input: {
  entity: string;
  metric: string;
  value: number;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function invalidSnapshot(
  operator: ComparisonOperator = "gt",
  threshold = 0,
  reason: string,
): InternalRecordsSourceRead {
  return {
    snapshot: {
      sourceType: "internal_records",
      entity: "tasks",
      metric: "open_task_count",
      operator,
      threshold,
      value: 0,
      currency: null,
      sourceHash: null,
      conditionMet: false,
      comparisonKnown: false,
      reason,
    },
  };
}

/**
 * The first production source is deliberately narrow: it reads only the
 * tenant-owned open task count. It never follows URLs, calls providers, or
 * performs a write.
 */
export async function readInternalRecordsSource(
  identity: AgentWorkIdentity,
  work: AgentWorkRecord,
): Promise<InternalRecordsSourceRead> {
  const condition = asRecord(work.condition);
  const entity = condition.entity;
  const metric = condition.metric;
  const operator = comparisonOperator(condition.operator);
  const threshold = Number(condition.threshold);
  if (
    entity !== "tasks"
    || metric !== "open_task_count"
    || !operator
    || !Number.isSafeInteger(threshold)
    || threshold < 0
  ) {
    return invalidSnapshot(operator ?? "gt", Number.isSafeInteger(threshold) && threshold >= 0 ? threshold : 0, "unsupported_condition");
  }

  const [row] = await db.select({
    value: sql<number>`count(*)::int`,
  }).from(tasksTable).where(and(
    eq(tasksTable.tenantId, identity.tenantId),
    eq(tasksTable.ownerUserId, identity.userId),
    not(inArray(tasksTable.status, ["completed", "cancelled"])),
  ));
  const value = Number(row?.value ?? 0);
  return {
    snapshot: {
      sourceType: "internal_records",
      entity: "tasks",
      metric: "open_task_count",
      operator,
      threshold,
      value,
      currency: null,
      sourceHash: hashSnapshot({ entity: "tasks", metric: "open_task_count", value }),
      conditionMet: compare(value, operator, threshold),
      comparisonKnown: true,
      reason: "tenant_scoped_read_verified",
    },
  };
}