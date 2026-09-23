import { agentWorkAdapters } from "./factory";
import type { AgentWorkIdentity } from "./types";
import type { OperationExecutionResult, PendingOperation } from "../secretary-operations";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function agentWorkContext(operation: PendingOperation): {
  workId: string;
  runId: string;
} | null {
  const workId = typeof operation.args.agentWorkId === "string" ? operation.args.agentWorkId : null;
  const runId = typeof operation.args.agentWorkRunId === "string" ? operation.args.agentWorkRunId : null;
  return workId && runId ? { workId, runId } : null;
}

async function resumeWork(
  adapters: typeof agentWorkAdapters,
  identity: AgentWorkIdentity,
  workId: string,
  to: "active" | "needs_review",
  reason: string,
): Promise<void> {
  const work = await adapters.storage.getWork(identity, workId);
  if (!work || work.status === to) return;
  if (work.status === "waiting" || (to === "active" && work.status === "needs_review")) {
    await adapters.storage.changeWorkStatus({
      identity,
      workId,
      from: work.status,
      to,
      actorType: "agent",
      actorId: identity.userId,
      reason,
    });
  }
}

export async function recordAgentWorkActionApproved(
  identity: AgentWorkIdentity,
  operation: PendingOperation,
  result: OperationExecutionResult,
  adapters: typeof agentWorkAdapters = agentWorkAdapters,
): Promise<void> {
  const context = agentWorkContext(operation);
  if (!context || operation.toolName !== "create_task") return;
  const action = asRecord(result.action);
  const toolResult = asRecord(action.toolResult);
  const task = asRecord(toolResult.task);
  const verification = asRecord(action.verification);
  await adapters.storage.storeEvidenceSnapshot({
    identity,
    workId: context.workId,
    runId: context.runId,
    retentionClass: "standard",
    snapshot: {
      sourceType: "github_repository",
      actionType: "create_task",
      actionState: "executed_and_verified",
      operationId: operation.operationId,
      taskId: typeof task.id === "string" ? task.id : null,
      verificationState: verification.state ?? "unknown",
      verifiedAt: new Date().toISOString(),
    },
  });
  await adapters.storage.addEvent({
    identity,
    workId: context.workId,
    runId: context.runId,
    eventType: "action_executed",
    actorType: "agent",
    summary: "تم إنشاء المهمة بعد موافقتك والتحقق من النتيجة.",
    metadata: {
      operationId: operation.operationId,
      actionType: "create_task",
      taskId: typeof task.id === "string" ? task.id : null,
      verification,
    },
    dedupeKey: `agent-work-action-executed:${operation.operationId}`,
  });
  await resumeWork(adapters, identity, context.workId, "active", "تم تنفيذ الإجراء بعد موافقة المستخدم.");
  const verifiedEvent = await adapters.storage.addEvent({
    identity,
    workId: context.workId,
    runId: context.runId,
    eventType: "action_verified",
    actorType: "system",
    summary: "تم التحقق من نتيجة الإجراء.",
    metadata: { operationId: operation.operationId, taskId: typeof task.id === "string" ? task.id : null },
    dedupeKey: `agent-work-action-verified:${operation.operationId}`,
  });
  const delivery = await adapters.notification.notify({
    identity,
    eventId: verifiedEvent.id,
    title: "تم تنفيذ إجراء المتابعة",
    body: "تحقق الشرط، وتم إنشاء المهمة بعد موافقتك والتحقق من النتيجة.",
    data: {
      workId: context.workId,
      operationId: operation.operationId,
      action: "create_task",
      deepLink: `/main?workId=${encodeURIComponent(context.workId)}`,
    },
    dedupeKey: `agent-work-action-notification:${operation.operationId}`,
  });
  await adapters.storage.addEvent({
    identity,
    workId: context.workId,
    runId: context.runId,
    eventType: "notification_delivery",
    actorType: "system",
    summary: delivery.status === "accepted" ? "تم إرسال نتيجة الإجراء." : "تعذر إرسال نتيجة الإجراء.",
    metadata: { status: delivery.status, driver: delivery.driver },
    dedupeKey: `agent-work-action-delivery:${operation.operationId}`,
  });
}

export async function recordAgentWorkActionRejected(
  identity: AgentWorkIdentity,
  operation: PendingOperation,
  reason: "rejected" | "failed" | "expired",
  adapters: typeof agentWorkAdapters = agentWorkAdapters,
): Promise<void> {
  const context = agentWorkContext(operation);
  if (!context) return;
  const nextStatus = reason === "failed" ? "needs_review" : "active";
  await adapters.storage.storeEvidenceSnapshot({
    identity,
    workId: context.workId,
    runId: context.runId,
    retentionClass: "standard",
    snapshot: {
      sourceType: "github_repository",
      actionType: operation.toolName,
      actionState: "not_executed",
      operationId: operation.operationId,
      reason,
    },
  });
  await adapters.storage.addEvent({
    identity,
    workId: context.workId,
    runId: context.runId,
    eventType: reason === "rejected"
      ? "action_rejected"
      : reason === "expired"
        ? "action_expired"
        : "action_failed",
    actorType: "system",
    summary: reason === "rejected"
      ? "لم تتم الموافقة، لذلك لم تُنشأ المهمة."
      : reason === "expired"
        ? "انتهت صلاحية الموافقة، لذلك لم تُنشأ المهمة."
        : "فشل تنفيذ الإجراء، ولم تُعتبر المهمة منشأة.",
    metadata: { operationId: operation.operationId, actionType: operation.toolName, reason },
    dedupeKey: `agent-work-action-${reason}:${operation.operationId}`,
  });
  await resumeWork(adapters, identity, context.workId, nextStatus, `حالة موافقة الإجراء: ${reason}.`);
  if (reason === "expired") {
    const notificationEvent = await adapters.storage.addEvent({
      identity,
      workId: context.workId,
      runId: context.runId,
      eventType: "action_expired_notification",
      actorType: "system",
      summary: "انتهت صلاحية الموافقة ولم تُنفذ المهمة.",
      metadata: { operationId: operation.operationId, actionType: operation.toolName },
      dedupeKey: `agent-work-action-expired-notification:${operation.operationId}`,
    });
    if (notificationEvent.created !== false) {
      const delivery = await adapters.notification.notify({
        identity,
        eventId: notificationEvent.id,
        title: "انتهت صلاحية الموافقة",
        body: "انتهت صلاحية الموافقة، لذلك لم تُنشأ المهمة. يمكنك متابعة العمل بعد تحقق الشرط مرة أخرى.",
        data: {
          workId: context.workId,
          operationId: operation.operationId,
          action: operation.toolName,
          deepLink: `/main?workId=${encodeURIComponent(context.workId)}`,
        },
        dedupeKey: `agent-work-action-expired-delivery:${operation.operationId}`,
      });
      await adapters.storage.addEvent({
        identity,
        workId: context.workId,
        runId: context.runId,
        eventType: "notification_delivery",
        actorType: "system",
        summary: delivery.status === "accepted" ? "تم إرسال نتيجة انتهاء الموافقة." : "تعذر إرسال نتيجة انتهاء الموافقة.",
        metadata: { status: delivery.status, driver: delivery.driver },
        dedupeKey: `agent-work-action-expired-delivery-record:${operation.operationId}`,
      });
    }
  }
}