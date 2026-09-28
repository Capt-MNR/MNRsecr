import { agentWorkAdapters } from "./factory";
import type { AgentWorkIdentity } from "./types";
import type { OperationExecutionResult, PendingOperation } from "../secretary-operations";
import { externalActionStatusFromResult } from "./external-action";
import { isExternalActionOperation } from "./external-action-registry";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function agentWorkContext(operation: PendingOperation): {
  workId: string;
  runId: string;
} | null {
  const workId = typeof operation.args.workId === "string"
    ? operation.args.workId
    : typeof operation.args.agentWorkId === "string" ? operation.args.agentWorkId : null;
  const runId = typeof operation.args.runId === "string"
    ? operation.args.runId
    : typeof operation.args.agentWorkRunId === "string" ? operation.args.agentWorkRunId : null;
  return workId && runId ? { workId, runId } : null;
}

async function resumeWork(
  adapters: typeof agentWorkAdapters,
  identity: AgentWorkIdentity,
  workId: string,
  to: "active" | "needs_review" | "completed" | "cancelled",
  reason: string,
  clearNextRunAt = false,
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
      ...(clearNextRunAt ? { nextRunAt: null } : {}),
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
  if (!context) return;
  const action = asRecord(result.action);
  if (externalActionStatusFromResult(result) === "verified") {
    const externalAction = asRecord(action.externalAction);
    const verification = asRecord(externalAction.verification);
    if (externalAction.status !== "verified" || verification.state !== "verified") {
      throw new Error("EXTERNAL_ACTION_RESULT_NOT_VERIFIED");
    }
    const provider = typeof externalAction.provider === "string" ? externalAction.provider : "external";
    const providerReference = asRecord(externalAction.providerReference);
    await adapters.storage.storeEvidenceSnapshot({
      identity,
      workId: context.workId,
      runId: context.runId,
      retentionClass: "standard",
      snapshot: {
        provider,
        actionType: typeof externalAction.actionType === "string" ? externalAction.actionType : "external_action",
        actionState: "executed_and_verified",
        approvalOperationId: operation.operationId,
        actionId: typeof externalAction.actionId === "string" ? externalAction.actionId : null,
        providerReference,
        verificationState: "verified",
        verifiedAt: new Date().toISOString(),
      },
    });
    await adapters.storage.addEvent({
      identity,
      workId: context.workId,
      runId: context.runId,
      eventType: "action_executed",
      actorType: "agent",
      summary: "تم تنفيذ الإجراء الخارجي والتحقق منه بعد موافقتك.",
      metadata: {
        approvalOperationId: operation.operationId,
        provider,
        actionType: typeof externalAction.actionType === "string" ? externalAction.actionType : "external_action",
        actionId: typeof externalAction.actionId === "string" ? externalAction.actionId : null,
        providerReference,
        verification,
      },
      dedupeKey: `agent-work-action-executed:${operation.operationId}`,
    });
    await resumeWork(
      adapters,
      identity,
      context.workId,
      "completed",
      "تم تنفيذ الإجراء الخارجي والتحقق منه بعد الموافقة.",
      true,
    );
    const verifiedEvent = await adapters.storage.addEvent({
      identity,
      workId: context.workId,
      runId: context.runId,
      eventType: "action_verified",
      actorType: "system",
      summary: "تم التحقق من نتيجة الإجراء الخارجي.",
      metadata: {
        approvalOperationId: operation.operationId,
        provider,
        actionId: typeof externalAction.actionId === "string" ? externalAction.actionId : null,
        providerReference,
        verification,
      },
      dedupeKey: `agent-work-action-verified:${operation.operationId}`,
    });
    const delivery = await adapters.notification.notify({
      identity,
      eventId: verifiedEvent.id,
      title: "اكتمل الإجراء الخارجي",
      body: "اكتمل الإجراء الخارجي وتم التحقق من نتيجته بعد موافقتك.",
      data: {
        workId: context.workId,
        approvalOperationId: operation.operationId,
        action: typeof externalAction.actionType === "string" ? externalAction.actionType : operation.toolName,
        provider,
        providerReference,
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
      summary: delivery.status === "accepted" ? "تم إرسال نتيجة الإجراء الخارجي." : "تعذر إرسال نتيجة الإجراء الخارجي.",
      metadata: { status: delivery.status, driver: delivery.driver },
      dedupeKey: `agent-work-action-delivery:${operation.operationId}`,
    });
    return;
  }
  if (operation.toolName !== "create_task") return;
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
  reason: "rejected" | "failed" | "expired" | "unknown_result",
  adapters: typeof agentWorkAdapters = agentWorkAdapters,
): Promise<void> {
  const context = agentWorkContext(operation);
  if (!context) return;
  const isExternalAction = isExternalActionOperation(operation);
  const provider = typeof operation.args.provider === "string" ? operation.args.provider : "external";
  const nextStatus = isExternalAction
    ? reason === "rejected" || reason === "expired"
      ? "cancelled"
      : "needs_review"
    : reason === "failed" || reason === "unknown_result"
      ? "needs_review"
      : "active";
  await adapters.storage.storeEvidenceSnapshot({
    identity,
    workId: context.workId,
    runId: context.runId,
    retentionClass: "standard",
    snapshot: {
      provider: isExternalAction ? provider : "github_repository",
      actionType: operation.toolName,
      actionState: reason === "unknown_result" ? "unknown_result" : "not_executed",
      approvalOperationId: operation.operationId,
      reason,
      automaticRetry: isExternalAction && reason === "unknown_result" ? false : undefined,
    },
  });
  await adapters.storage.addEvent({
    identity,
    workId: context.workId,
    runId: context.runId,
    eventType: reason === "unknown_result"
      ? "action_unknown_result"
      : reason === "rejected"
        ? "action_rejected"
        : reason === "expired"
          ? "action_expired"
          : "action_failed",
    actorType: "system",
    summary: reason === "unknown_result"
      ? "نتيجة الإجراء الخارجي غير مؤكدة؛ أوقفت المتابعة ولم أعد المحاولة."
      : isExternalAction
        ? reason === "rejected"
          ? "لم تتم الموافقة على الإجراء الخارجي؛ لم يبدأ الاتصال بالمزود."
          : reason === "expired"
            ? "انتهت صلاحية الموافقة؛ لم يبدأ الاتصال بالمزود."
            : "تعذر تنفيذ الإجراء الخارجي بصورة مؤكدة."
        : reason === "rejected"
          ? "لم تتم الموافقة، لذلك لم تُنشأ المهمة."
          : reason === "expired"
            ? "انتهت صلاحية الموافقة، لذلك لم تُنشأ المهمة."
            : "فشل تنفيذ الإجراء، ولم تُعتبر المهمة منشأة.",
    metadata: {
      approvalOperationId: operation.operationId,
      actionType: operation.toolName,
      reason,
      ...(isExternalAction && reason === "unknown_result" ? { automaticRetry: false } : {}),
    },
    dedupeKey: `agent-work-action-${reason}:${operation.operationId}`,
  });
  await resumeWork(
    adapters,
    identity,
    context.workId,
    nextStatus,
    `حالة موافقة الإجراء: ${reason}.`,
    isExternalAction,
  );
  if (reason === "expired" || reason === "unknown_result") {
    const notificationEvent = await adapters.storage.addEvent({
      identity,
      workId: context.workId,
      runId: context.runId,
      eventType: reason === "expired" ? "action_expired_notification" : "action_unknown_result_notification",
      actorType: "system",
      summary: reason === "expired"
        ? "انتهت صلاحية الموافقة ولم تُنفذ المهمة."
        : "تعذر تأكيد نتيجة الإجراء الخارجي؛ أوقفت أي إعادة للمحاولة.",
      metadata: { approvalOperationId: operation.operationId, actionType: operation.toolName, provider },
      dedupeKey: `agent-work-action-state-notification:${operation.operationId}:${reason}`,
    });
    if (notificationEvent.created !== false) {
      const delivery = await adapters.notification.notify({
        identity,
        eventId: notificationEvent.id,
        title: reason === "expired" ? "انتهت صلاحية الموافقة" : "نتيجة الإجراء الخارجي غير مؤكدة",
        body: reason === "expired"
          ? "انتهت صلاحية الموافقة، لذلك لم تُنشأ المهمة. يمكنك متابعة العمل بعد تحقق الشرط مرة أخرى."
          : "قد يكون طلب المزود قد نُفذ؛ تحقق من النتيجة قبل بدء إجراء جديد.",
        data: {
          workId: context.workId,
          approvalOperationId: operation.operationId,
          action: isExternalAction ? operation.args.actionType ?? operation.toolName : operation.toolName,
          deepLink: `/main?workId=${encodeURIComponent(context.workId)}`,
        },
        dedupeKey: `agent-work-action-state-delivery:${operation.operationId}:${reason}`,
      });
      await adapters.storage.addEvent({
        identity,
        workId: context.workId,
        runId: context.runId,
        eventType: "notification_delivery",
        actorType: "system",
        summary: delivery.status === "accepted" ? "تم إرسال نتيجة انتهاء الموافقة." : "تعذر إرسال نتيجة انتهاء الموافقة.",
        metadata: { status: delivery.status, driver: delivery.driver },
        dedupeKey: `agent-work-action-state-delivery-record:${operation.operationId}:${reason}`,
      });
    }
  }
}