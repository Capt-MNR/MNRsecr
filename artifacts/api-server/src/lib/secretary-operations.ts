import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import {
  activityEventsTable,
  db,
  secretaryOperationsTable,
  type SecretaryOperation,
} from "@workspace/db";
import type { Identity } from "./secretary";
import { persistedApprovalArgs } from "./approval-schemas";

export type OperationStatus =
  | "pending"
  | "executing"
  | "completed"
  | "rejected"
  | "expired"
  | "failed";

export type OperationDisplay = {
  title: string;
  details: string[];
};

export type OperationExecutionResult = {
  conversationId: string;
  turnId?: string;
  assistantMessage: string;
  action?: Record<string, unknown>;
  response?: Record<string, unknown>;
  provider: string;
  model: string;
};

type OperationDbExecutor = Pick<typeof db, "select" | "update">;

export type PendingOperation = {
  operationId: string;
  conversationId: string | null;
  sourceTurnId: string | null;
  toolName: string;
  args: Record<string, unknown>;
  display: OperationDisplay;
  status: OperationStatus;
  updatedAt: Date;
  result?: OperationExecutionResult;
  error?: { message: string };
};

const OPERATION_TTL_MS = 24 * 60 * 60 * 1000;
const EXECUTION_RECOVERY_GRACE_MS = 60 * 1000;

function scopedOperation(identity: Identity, operationId: string) {
  return and(
    eq(secretaryOperationsTable.id, operationId),
    eq(secretaryOperationsTable.tenantId, identity.tenantId),
    eq(secretaryOperationsTable.ownerUserId, identity.userId),
  );
}

function parseDisplay(value: string): OperationDisplay {
  try {
    const parsed = JSON.parse(value) as Partial<OperationDisplay>;
    return {
      title: typeof parsed.title === "string" ? parsed.title : "تغيير محفوظ",
      details: Array.isArray(parsed.details)
        ? parsed.details.filter((detail): detail is string => typeof detail === "string")
        : [],
    };
  } catch {
    return { title: "تغيير محفوظ", details: [] };
  }
}

function toOperation(row: SecretaryOperation): PendingOperation {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(row.argumentsJson) as Record<string, unknown>;
  } catch {
    args = {};
  }
  let result: OperationExecutionResult | undefined;
  if (row.resultJson) {
    try {
      result = JSON.parse(row.resultJson) as OperationExecutionResult;
    } catch {
      result = undefined;
    }
  }
  let error: { message: string } | undefined;
  if (row.errorJson) {
    try {
      const parsed = JSON.parse(row.errorJson) as { message?: unknown };
      if (typeof parsed.message === "string") error = { message: parsed.message };
    } catch {
      error = undefined;
    }
  }
  return {
    operationId: row.id,
    conversationId: row.conversationId,
    sourceTurnId: row.sourceTurnId,
    toolName: row.toolName,
    args,
    display: parseDisplay(row.displayJson),
    status: row.status as OperationStatus,
    updatedAt: row.updatedAt,
    ...(result ? { result } : {}),
    ...(error ? { error } : {}),
  };
}

export function displayForOperation(
  toolName: string,
  args: Record<string, unknown>,
): OperationDisplay {
  const stringArg = (key: string) =>
    typeof args[key] === "string" && args[key].trim() ? args[key].trim() : undefined;
  const amount = typeof args.amountMinor === "number"
    ? new Intl.NumberFormat("ar-EG").format(args.amountMinor / 100)
    : undefined;
  const amountDelta = typeof args.amountDeltaMinor === "number"
    ? new Intl.NumberFormat("ar-EG").format(args.amountDeltaMinor / 100)
    : undefined;
  const currency = stringArg("currency") ?? stringArg("expectedCurrency") ?? "EGP";
  const description = stringArg("description") ?? stringArg("text") ?? stringArg("title");

  switch (toolName) {
    case "record_expense":
      return {
        title: "تسجيل مصروف",
        details: [
          ...(amount ? [`القيمة: ${amount} ${currency}`] : []),
          ...(description ? [`الوصف: ${description}`] : []),
          ...(stringArg("personName") ? [`الشخص: ${stringArg("personName")}`] : []),
          ...(stringArg("projectName") ? [`المشروع: ${stringArg("projectName")}`] : []),
        ],
      };
    case "create_reminder": {
      const dueAt = stringArg("dueAt");
      const dueLabel = dueAt && !Number.isNaN(new Date(dueAt).getTime())
        ? new Intl.DateTimeFormat("ar-EG", {
            timeZone: stringArg("timezone") ?? "Africa/Cairo",
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(dueAt))
        : undefined;
      return {
        title: "إضافة تذكير",
        details: [
          description ?? "تذكير جديد",
          ...(dueLabel ? [`الموعد: ${dueLabel}`] : []),
        ],
      };
    }
    case "create_task":
      return { title: "إضافة مهمة", details: [description ?? "مهمة جديدة"] };
    case "create_commitment":
      return { title: "إضافة التزام", details: [description ?? "التزام جديد"] };
    case "create_person":
      return { title: "إضافة شخص", details: [stringArg("name") ?? "شخص جديد"] };
    case "create_project":
      return { title: "إضافة مشروع", details: [stringArg("name") ?? "مشروع جديد"] };
    case "create_agent_work": {
      const workTitle = stringArg("title") ?? "متابعة جديدة";
      const sourceType = stringArg("sourceType");
      const condition = args.condition && typeof args.condition === "object" && !Array.isArray(args.condition)
        ? args.condition as Record<string, unknown>
        : {};
      const repository = typeof condition.owner === "string" && typeof condition.repository === "string"
        ? `${condition.owner}/${condition.repository}`
        : undefined;
      return {
        title: "إضافة متابعة للوكيل",
        details: [
          workTitle,
          ...(sourceType === "github_repository" && repository ? [`مصدر GitHub: ${repository}`] : []),
          ...(stringArg("description") ? [`التفاصيل: ${stringArg("description")}`] : []),
        ],
      };
    }
    case "delete_person":
      return { title: "حذف شخص", details: [stringArg("personName") ?? "السجل المحدد"] };
    case "delete_project":
      return { title: "حذف مشروع", details: [stringArg("projectName") ?? "السجل المحدد"] };
    case "delete_expense":
      return { title: "حذف مصروف", details: [stringArg("description") ?? "السجل المحدد"] };
    case "update_expense":
      return {
        title: "تعديل مصروف",
        details: [
          ...(amount ? [`القيمة الجديدة: ${amount} ${currency}`] : []),
          ...(amountDelta ? [`زيادة القيمة الحالية بمقدار: ${amountDelta} ${currency}`] : []),
          ...(description ? [`الوصف: ${description}`] : []),
        ],
      };
    default:
      return {
        title: `تأكيد العملية: ${toolName}`,
        details: description ? [description] : ["سيتم تطبيق التغيير على السجل المحدد."],
      };
  }
}

export async function createPendingOperation(
  identity: Identity,
  input: {
    conversationId?: string | null;
    sourceTurnId?: string | null;
    idempotencyKey?: string | null;
    toolName: string;
    args: Record<string, unknown>;
    display?: OperationDisplay;
  },
): Promise<PendingOperation> {
  if (input.idempotencyKey) {
    const [existing] = await db.select().from(secretaryOperationsTable)
      .where(and(
        eq(secretaryOperationsTable.tenantId, identity.tenantId),
        eq(secretaryOperationsTable.ownerUserId, identity.userId),
        eq(secretaryOperationsTable.idempotencyKey, input.idempotencyKey),
      ))
      .limit(1);
    if (existing) return toOperation(existing);
  }
  const [created] = await db.insert(secretaryOperationsTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    conversationId: input.conversationId ?? null,
    sourceTurnId: input.sourceTurnId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    toolName: input.toolName,
    argumentsJson: JSON.stringify(input.args),
    displayJson: JSON.stringify(input.display ?? displayForOperation(input.toolName, input.args)),
    status: "pending",
    expiresAt: new Date(Date.now() + OPERATION_TTL_MS),
  }).onConflictDoNothing().returning();
  if (created) return toOperation(created);
  const [existing] = await db.select().from(secretaryOperationsTable)
    .where(and(
      eq(secretaryOperationsTable.tenantId, identity.tenantId),
      eq(secretaryOperationsTable.ownerUserId, identity.userId),
      eq(secretaryOperationsTable.idempotencyKey, input.idempotencyKey ?? ""),
    ))
    .limit(1);
  if (existing) return toOperation(existing);
  throw new Error("Could not reserve the secretary operation.");
}

export async function getOperation(
  identity: Identity,
  operationId: string,
): Promise<PendingOperation | null> {
  const [row] = await db.select().from(secretaryOperationsTable)
    .where(scopedOperation(identity, operationId))
    .limit(1);
  if (!row) return null;
  if (row.status === "pending" && row.expiresAt && row.expiresAt <= new Date()) {
    const [expired] = await db.update(secretaryOperationsTable)
      .set({ status: "expired" })
      .where(and(scopedOperation(identity, operationId), eq(secretaryOperationsTable.status, "pending")))
      .returning();
    return toOperation(expired ?? row);
  }
  return toOperation(row);
}

export type ApprovalOutcome =
  | { kind: "claimed"; operation: PendingOperation }
  | { kind: "existing"; operation: PendingOperation };

function recoveredOperationResult(
  operation: PendingOperation,
  event: typeof activityEventsTable.$inferSelect,
): OperationExecutionResult {
  return {
    conversationId: operation.conversationId ?? "",
    assistantMessage: "تم تنفيذ العملية، واستعدت نتيجتها بعد انقطاع التنفيذ.",
    action: {
      type: "operation_reconciled",
      operationId: operation.operationId,
      toolName: operation.toolName,
      entityId: event.sourceId,
      sourceType: event.sourceType,
      activityEventId: event.id,
      args: persistedApprovalArgs(operation.args),
      verification: {
        state: "verified",
        checks: ["activity_event_receipt"],
      },
    },
    provider: "server",
    model: "approved-operation-reconciliation",
  };
}

async function reconcileExecutingOperation(
  identity: Identity,
  operation: PendingOperation,
): Promise<PendingOperation> {
  return db.transaction(async (tx) => {
    // Re-read and lock the row after any wait caused by an active execution.
    // This prevents a stale snapshot from resetting an operation that has
    // already completed while this reconciliation was waiting.
    const [row] = await tx.select().from(secretaryOperationsTable)
      .where(scopedOperation(identity, operation.operationId))
      .limit(1)
      .for("update");
    if (!row || row.status !== "executing") return row ? toOperation(row) : operation;

    const claimedAt = row.claimedAt?.getTime() ?? 0;
    if (claimedAt > 0 && Date.now() - claimedAt < EXECUTION_RECOVERY_GRACE_MS) {
      return toOperation(row);
    }

    const currentOperation = toOperation(row);
    const [event] = await tx.select().from(activityEventsTable)
      .where(and(
        eq(activityEventsTable.tenantId, identity.tenantId),
        eq(activityEventsTable.ownerUserId, identity.userId),
        eq(activityEventsTable.eventType, `${row.toolName}.completed`),
        sql`${activityEventsTable.metadata}->>'sourceOperationId' = ${row.id}`,
      ))
      .orderBy(desc(activityEventsTable.createdAt))
      .limit(1);

    if (event) {
      const result = recoveredOperationResult(currentOperation, event);
      const [completed] = await tx.update(secretaryOperationsTable)
        .set({
          status: "completed",
          resultJson: JSON.stringify(result),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          scopedOperation(identity, operation.operationId),
          eq(secretaryOperationsTable.status, "executing"),
        ))
        .returning();
      return toOperation(completed ?? row);
    }

    const [reset] = await tx.update(secretaryOperationsTable)
      .set({
        status: "pending",
        approvedAt: null,
        claimedAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        scopedOperation(identity, operation.operationId),
        eq(secretaryOperationsTable.status, "executing"),
      ))
      .returning();
    return toOperation(reset ?? row);
  });
}

export async function lockExecutingOperation(
  identity: Identity,
  operationId: string,
  executor: OperationDbExecutor,
): Promise<void> {
  const [row] = await executor.select().from(secretaryOperationsTable)
    .where(scopedOperation(identity, operationId))
    .limit(1)
    .for("update");
  if (!row) throw new Error("Pending operation was not found.");
  if (row.status !== "executing") {
    throw new Error("Operation is no longer executable.");
  }
}

export async function claimOperation(
  identity: Identity,
  operationId: string,
  argsOverride?: Record<string, unknown>,
): Promise<ApprovalOutcome> {
  const now = new Date();
  const storedArgs = argsOverride ? persistedApprovalArgs(argsOverride) : undefined;
  const [current] = storedArgs
    ? await db.select({
        toolName: secretaryOperationsTable.toolName,
      }).from(secretaryOperationsTable)
        .where(scopedOperation(identity, operationId))
        .limit(1)
    : [];
  const [claimed] = await db.update(secretaryOperationsTable)
    .set({
      status: "executing",
      approvedAt: now,
      claimedAt: now,
      updatedAt: now,
      ...(storedArgs
        ? {
            argumentsJson: JSON.stringify(storedArgs),
            ...(current
              ? { displayJson: JSON.stringify(displayForOperation(current.toolName, storedArgs)) }
              : {}),
          }
        : {}),
    })
    .where(and(
      scopedOperation(identity, operationId),
      eq(secretaryOperationsTable.status, "pending"),
      or(isNull(secretaryOperationsTable.expiresAt), gt(secretaryOperationsTable.expiresAt, now)),
    ))
    .returning();
  if (claimed) {
    const operation = toOperation(claimed);
    return {
      kind: "claimed",
      operation: storedArgs ? { ...operation, args: storedArgs } : operation,
    };
  }
  const operation = await getOperation(identity, operationId);
  if (!operation) throw new Error("Pending operation was not found.");
  if (operation.status === "executing") {
    const reconciled = await reconcileExecutingOperation(identity, operation);
    if (reconciled.status === "pending") {
      return claimOperation(identity, operationId, argsOverride);
    }
    return { kind: "existing", operation: reconciled };
  }
  return { kind: "existing", operation };
}

export async function rejectOperation(
  identity: Identity,
  operationId: string,
): Promise<PendingOperation> {
  const [rejected] = await db.update(secretaryOperationsTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(
      scopedOperation(identity, operationId),
      eq(secretaryOperationsTable.status, "pending"),
    ))
    .returning();
  if (rejected) return toOperation(rejected);
  const operation = await getOperation(identity, operationId);
  if (!operation) throw new Error("Pending operation was not found.");
  return operation;
}

export async function rejectPendingOperationForConversation(
  identity: Identity,
  conversationId: string,
): Promise<PendingOperation | null> {
  const [row] = await db.select().from(secretaryOperationsTable)
    .where(and(
      eq(secretaryOperationsTable.tenantId, identity.tenantId),
      eq(secretaryOperationsTable.ownerUserId, identity.userId),
      eq(secretaryOperationsTable.conversationId, conversationId),
      eq(secretaryOperationsTable.status, "pending"),
    ))
    .orderBy(desc(secretaryOperationsTable.updatedAt))
    .limit(1);
  if (!row) return null;
  const operation = await getOperation(identity, row.id);
  if (!operation || operation.status !== "pending") return null;
  return rejectOperation(identity, operation.operationId);
}

export async function completeOperation(
  identity: Identity,
  operationId: string,
  result: OperationExecutionResult,
): Promise<PendingOperation> {
  return completeOperationWithExecutor(identity, operationId, result, db);
}

export async function completeOperationWithExecutor(
  identity: Identity,
  operationId: string,
  result: OperationExecutionResult,
  executor: OperationDbExecutor,
  requireExecuting = false,
): Promise<PendingOperation> {
  const [completed] = await executor.update(secretaryOperationsTable)
    .set({
      status: "completed",
      resultJson: JSON.stringify(result),
      completedAt: new Date(),
        updatedAt: new Date(),
    })
    .where(and(
      scopedOperation(identity, operationId),
      eq(secretaryOperationsTable.status, "executing"),
    ))
    .returning();
  if (completed) return toOperation(completed);
  const [row] = await executor.select().from(secretaryOperationsTable)
    .where(scopedOperation(identity, operationId))
    .limit(1);
  const operation = row ? toOperation(row) : null;
  if (!operation) throw new Error("Operation disappeared during execution.");
  if (requireExecuting) {
    throw new Error("Operation state changed before atomic completion.");
  }
  return operation;
}

export async function failOperation(
  identity: Identity,
  operationId: string,
  message: string,
): Promise<PendingOperation> {
  const [failed] = await db.update(secretaryOperationsTable)
    .set({
      status: "failed",
      errorJson: JSON.stringify({ message }),
      completedAt: new Date(),
        updatedAt: new Date(),
    })
    .where(and(
      scopedOperation(identity, operationId),
      eq(secretaryOperationsTable.status, "executing"),
    ))
    .returning();
  if (failed) return toOperation(failed);
  const operation = await getOperation(identity, operationId);
  if (!operation) throw new Error("Operation disappeared during execution.");
  return operation;
}