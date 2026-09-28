import { evaluateReadOnlyEvidence, comparisonOperatorLabel } from "./condition-evaluator";
import {
  readGitHubRepositoryWithSafeguards,
  readInternalRecordsSource,
  type GitHubReadContext,
} from "./sources";
import {
  createPendingOperation,
  displayForOperation,
  getOperation,
} from "../secretary-operations";
import type {
  ActionPlan,
  ExecutionOutcome,
  TriggerDefinition,
  WorkIntent,
} from "./contracts";
import { evaluationFromPlan } from "./contracts";
import { createRunIdempotencyKey } from "./contract";
import { externalActionConnectorForProvider } from "./external-action-registry";
import type {
  AgentWorkAdapters,
  AgentWorkRecord,
} from "./types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function zonedParts(value: Date, timezone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function zonedDateTimeToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string,
): Date {
  const targetUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let guess = targetUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = zonedParts(new Date(guess), timezone);
    const observedUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute);
    guess = targetUtc + (guess - observedUtc);
  }
  return new Date(guess);
}

function nextScheduledAt(now: Date, schedule: Record<string, unknown>): Date | null {
  const frequency = typeof schedule.frequency === "string" ? schedule.frequency : null;
  if (frequency === "hourly") return new Date(now.getTime() + 60 * 60_000);
  if (frequency === "daily") {
    const localTime = typeof schedule.localTime === "string"
      ? schedule.localTime.match(/^([01]\d|2[0-3]):([0-5]\d)$/u)
      : null;
    if (localTime) {
      const timezone = typeof schedule.timezone === "string" ? schedule.timezone : "Africa/Cairo";
      const current = zonedParts(now, timezone);
      const today = zonedDateTimeToUtc({
        year: current.year,
        month: current.month,
        day: current.day,
        hour: Number(localTime[1]),
        minute: Number(localTime[2]),
      }, timezone);
      if (today.getTime() > now.getTime()) return today;
      const tomorrow = new Date(Date.UTC(current.year, current.month - 1, current.day + 1));
      const next = zonedParts(tomorrow, timezone);
      return zonedDateTimeToUtc({
        year: next.year,
        month: next.month,
        day: next.day,
        hour: Number(localTime[1]),
        minute: Number(localTime[2]),
      }, timezone);
    }
    return new Date(now.getTime() + 24 * 60 * 60_000);
  }
  if (frequency === "weekly") return new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  if (frequency === "interval") {
    const minutes = Number(schedule.minutes);
    if (Number.isFinite(minutes) && minutes > 0 && minutes <= 31 * 24 * 60) {
      return new Date(now.getTime() + Math.floor(minutes * 60_000));
    }
  }
  return null;
}

function delegatedTaskAction(work: AgentWorkRecord, current: {
  repository: string;
  value: number;
  threshold: number;
  operator: string;
}, runId: string, nextRunAt: Date | null): {
  toolName: "create_task";
  args: Record<string, unknown>;
} | null {
  const action = asRecord(work.action);
  if (action.type !== "create_task" && action.toolName !== "create_task") return null;
  const title = typeof action.title === "string" && action.title.trim()
    ? action.title.trim()
    : `مراجعة GitHub ${current.repository}: العناصر المفتوحة ${current.value}`;
  return {
    toolName: "create_task",
    args: {
      title,
      status: "pending",
      ...(typeof action.dueAt === "string" ? { dueAt: action.dueAt } : {}),
      agentWorkId: work.id,
      agentWorkRunId: runId,
      agentWorkSource: "github_repository",
      agentWorkRepository: current.repository,
      agentWorkConditionValue: current.value,
      agentWorkConditionThreshold: current.threshold,
      agentWorkConditionOperator: current.operator,
      agentWorkResumeAt: nextRunAt?.toISOString() ?? null,
    },
  };
}

async function findLatestActionEvent(
  adapters: AgentWorkAdapters,
  identity: AgentWorkRecord["identity"],
  workId: string,
): Promise<{
  operationId: string;
  conditionHash: string;
  status: string;
  operation: NonNullable<Awaited<ReturnType<typeof getOperation>>>;
} | null> {
  const events = await adapters.storage.listEvents(identity, workId, 30);
  const event = events.find((item) => item.eventType === "approval_requested");
  const metadata = asRecord(event?.metadata);
  if (typeof metadata.operationId !== "string" || typeof metadata.conditionHash !== "string") return null;
  const operation = await getOperation(identity, metadata.operationId);
  return operation
    ? {
        operationId: operation.operationId,
        conditionHash: metadata.conditionHash,
        status: operation.status,
        operation,
      }
    : null;
}

function runIdForApproval(workId: string, now: Date): string {
  return `${workId}:${now.toISOString()}`;
}

async function buildActionPlan(
  adapters: AgentWorkAdapters,
  identity: AgentWorkRecord["identity"],
  work: AgentWorkRecord,
  trigger: TriggerDefinition,
  now: Date,
  runId: string,
  githubReadContext?: GitHubReadContext,
): Promise<{ plan: ActionPlan; evidence: Record<string, unknown> }> {
  const schedule = asRecord(trigger.schedule);
  const nextRunAt = nextScheduledAt(now, schedule);
  const recurring = nextRunAt !== null;
  const title = trigger.title.trim() || "عمل الوكيل";

  if (work.kind === "reminder") {
    return {
      plan: {
        status: "verified",
        workStatus: recurring ? "active" : "completed",
        nextRunAt,
        verification: { kind: "reminder_due", source: "agent_work_runner" },
        notificationTitle: title,
        notificationBody: work.description?.trim() || "حان وقت هذا التذكير.",
        notify: true,
      },
      evidence: { workKind: work.kind, status: "verified", source: "agent_work_runner" },
    };
  }

  if (work.kind === "recurring_task" && recurring) {
    return {
      plan: {
        status: "verified",
        workStatus: "active",
        nextRunAt,
        verification: { kind: "recurring_task_due", source: "agent_work_runner" },
        notificationTitle: title,
        notificationBody: work.description?.trim() || "حان وقت متابعة هذا العمل.",
        notify: true,
      },
      evidence: { workKind: work.kind, status: "verified", source: "agent_work_runner" },
    };
  }

  const source = asRecord(trigger.source);
  if (source.type === "trigger_outbox") {
    const action = asRecord(work.action);
    const notificationData = asRecord(action.data);
    const proactive = action.type === "proactive_message";
    return {
      plan: {
        status: "verified",
        workStatus: "completed",
        nextRunAt: null,
        verification: {
          kind: "trigger_work_intent_handoff",
          source: "trigger_outbox",
          eventId: typeof source.eventId === "string" ? source.eventId : null,
          triggerKey: typeof source.triggerKey === "string" ? source.triggerKey : null,
        },
        notificationTitle: typeof action.title === "string" ? action.title : title,
        notificationBody: proactive && typeof action.body === "string" ? action.body : "",
        notificationData: proactive ? notificationData : undefined,
        notify: proactive,
      },
      evidence: {
        workKind: work.kind,
        status: "verified",
        source: "trigger_outbox",
        eventId: typeof source.eventId === "string" ? source.eventId : null,
      },
    };
  }
  if (source.type === "clock" || source.type === "heartbeat") {
    return {
      plan: {
        status: "verified",
        workStatus: recurring ? "active" : "completed",
        nextRunAt,
        verification: {
          kind: "safe_clock_check",
          source: source.type,
          checkedAt: now.toISOString(),
        },
        notificationTitle: title,
        notificationBody: work.description?.trim() || "اكتملت متابعة العمل.",
        notify: true,
      },
      evidence: { workKind: work.kind, status: "verified", source: source.type },
    };
  }

  const workSource = asRecord(work.source);
  const provider = typeof source.type === "string" ? source.type : workSource.type;
  const externalActionConnector = externalActionConnectorForProvider(
    typeof provider === "string" ? provider : null,
  );
  if (externalActionConnector) {
    if (work.kind !== "external_action") {
      return {
        plan: {
          status: "needs_review",
          workStatus: "needs_review",
          nextRunAt: null,
          verification: { kind: "external_action_invalid", provider, safe: false },
          error: "AGENT_WORK_EXTERNAL_ACTION_INVALID",
          notificationTitle: "مراجعة مطلوبة: إجراء خارجي",
          notificationBody: "توقفت المتابعة لأن إعداد الإجراء الخارجي غير صالح.",
          notify: true,
        },
        evidence: { provider, status: "needs_review", safe: false },
      };
    }

    const previousEvents = await adapters.storage.listEvents(identity, work.id, 100);
    const hasExternalAttempt = previousEvents.some((event) =>
      event.eventType === "external_action_step_started"
      || event.eventType === "external_action_step_failed"
      || event.eventType === "external_action_unknown_result"
      || event.eventType === "external_action_workflow_verified");
    if (hasExternalAttempt) {
      return {
        plan: {
          status: "needs_review",
          workStatus: "needs_review",
          nextRunAt: null,
          verification: { kind: "external_action_already_attempted", provider, safe: false },
          error: "AGENT_WORK_EXTERNAL_ACTION_ALREADY_ATTEMPTED",
          notificationTitle: "مراجعة مطلوبة: إجراء خارجي",
          notificationBody: "توجد محاولة سابقة لهذا الإجراء؛ لم أبدأ محاولة أخرى.",
          notify: true,
        },
        evidence: { provider, status: "needs_review", reason: "previous_external_attempt" },
      };
    }

    let prepared;
    try {
      prepared = externalActionConnector.prepareApproval({
        identity,
        work,
        runId,
      });
    } catch {
      return {
        plan: {
          status: "needs_review",
          workStatus: "needs_review",
          nextRunAt: null,
          verification: { kind: "external_action_invalid", provider, safe: false },
          error: "AGENT_WORK_EXTERNAL_ACTION_INVALID",
          notificationTitle: "مراجعة مطلوبة: إجراء خارجي",
          notificationBody: "توقفت المتابعة لأن إعداد الإجراء لم يجتز التحقق.",
          notify: true,
        },
        evidence: { provider, status: "needs_review", safe: false },
      };
    }

    const pending = await createPendingOperation(identity, {
      conversationId: typeof workSource.conversationId === "string" ? workSource.conversationId : null,
      sourceTurnId: typeof workSource.sourceTurnId === "string"
        ? workSource.sourceTurnId
        : `agent-work:${work.id}`,
      idempotencyKey: createRunIdempotencyKey({
        tenantId: identity.tenantId,
        ownerUserId: identity.userId,
        workId: work.id,
        runId,
        attempt: 1,
        actionKind: prepared.idempotencyActionKind,
        actionVersion: prepared.idempotencyActionVersion,
      }),
      toolName: externalActionConnector.approvalToolName,
      args: prepared.args,
      display: prepared.display,
    });
    if (pending.status !== "pending") {
      return {
        plan: {
          status: "needs_review",
          workStatus: "needs_review",
          nextRunAt: null,
          verification: {
            kind: "external_action_approval_unavailable",
            provider,
            approvalOperationId: pending.operationId,
            operationStatus: pending.status,
            safe: false,
          },
          error: "AGENT_WORK_EXTERNAL_ACTION_APPROVAL_NOT_PENDING",
          notificationTitle: "مراجعة مطلوبة: إجراء خارجي",
          notificationBody: "تعذر تجهيز موافقة جديدة؛ لم يتم الاتصال بالمزود.",
          notify: true,
        },
        evidence: {
          ...prepared.evidence,
          approvalOperationId: pending.operationId,
          operationStatus: pending.status,
          status: "needs_review",
        },
      };
    }

    return {
      plan: {
        status: "needs_review",
        workStatus: "waiting",
        nextRunAt: null,
        verification: {
          kind: "external_action_approval",
          provider,
          actionId: prepared.actionId,
          approvalOperationId: pending.operationId,
          state: "approval_requested",
        },
        notificationTitle: prepared.notificationTitle,
        notificationBody: prepared.notificationBody,
        notificationData: {
          ...prepared.notificationData,
          provider,
          workId: work.id,
          approvalOperationId: pending.operationId,
        },
        notify: true,
        approvalOperationId: pending.operationId,
        approvalAction: externalActionConnector.approvalToolName,
      },
      evidence: {
        ...prepared.evidence,
        provider,
        actionDecision: "approval_requested",
        approvalOperationId: pending.operationId,
        status: "needs_review",
      },
    };
  }

  if (source.type === "internal_records") {
    const sourceRead = await readInternalRecordsSource(identity, work);
    const current = sourceRead.snapshot;
    const priorEvidence = await adapters.storage.listEvidence(identity, work.id, 10);
    const previousHash = priorEvidence
      .map((item) => item.snapshot.sourceHash)
      .find((value): value is string => typeof value === "string") ?? null;
    const previousConditionMet = priorEvidence
      .map((item) => item.snapshot.conditionMet)
      .find((value): value is boolean => typeof value === "boolean") ?? null;
    const comparison = evaluateReadOnlyEvidence({
      previousHash,
      currentHash: current.sourceHash,
      previousConditionMet,
      conditionMet: current.conditionMet,
      comparisonKnown: current.comparisonKnown,
    });
    const firstBaseline = previousHash === null && current.comparisonKnown && !current.conditionMet;
    const status = firstBaseline ? "unchanged" : comparison.state;
    const conditionText = `عدد المهام المفتوحة ${comparisonOperatorLabel(current.operator)} ${current.threshold}`;
    const currentValueText = `القيمة الحالية ${current.value}`;
    const checkedAt = new Intl.DateTimeFormat("ar-EG", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Cairo",
    }).format(now);
    const notificationBody = status === "verified"
      ? `تغيرت متابعة «${title}»: ${currentValueText}، والشرط تحقق (${conditionText}). تم التحقق ${checkedAt}.`
      : status === "needs_review"
        ? `تغيرت متابعة «${title}»: ${currentValueText}، لكن النتيجة تحتاج مراجعتك. تم التحقق ${checkedAt}.`
        : status === "uncertain"
          ? `تعذر التحقق من «${title}» بشكل موثوق. آخر قيمة معروفة ${current.value}. تم التحقق ${checkedAt}.`
          : `لم تتغير متابعة «${title}»: ${currentValueText}، والشرط هو ${conditionText}. آخر فحص ${checkedAt}.`;
    return {
      plan: {
        status,
        workStatus: recurring ? "active" : "completed",
        nextRunAt,
        verification: {
          kind: "read_only_monitor",
          source: "internal_records",
          ...(firstBaseline
            ? { state: "unchanged", reason: "baseline_established" }
            : comparison),
          conditionMet: current.conditionMet,
          comparisonKnown: current.comparisonKnown,
        },
        notificationTitle: title,
        notificationBody,
        notificationData: {
          source: current.sourceType,
          value: current.value,
          threshold: current.threshold,
          operator: current.operator,
          checkedAt: now.toISOString(),
          deepLink: `/main?workId=${encodeURIComponent(work.id)}`,
        },
        notify: status !== "unchanged",
      },
      evidence: {
        sourceType: current.sourceType,
        entity: current.entity,
        metric: current.metric,
        operator: current.operator,
        threshold: current.threshold,
        value: current.value,
        currency: current.currency,
        sourceHash: current.sourceHash,
        conditionMet: current.conditionMet,
        comparisonKnown: current.comparisonKnown,
      },
    };
  }

  if (source.type === "github_repository") {
    const sourceRead = await readGitHubRepositoryWithSafeguards(
      identity,
      work,
      now,
      githubReadContext,
    );
    if (!sourceRead.ok) {
      const checkedAt = new Intl.DateTimeFormat("ar-EG", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Africa/Cairo",
      }).format(now);
      return {
        plan: {
          status: "failed",
          workStatus: recurring ? "active" : "failed",
          nextRunAt,
          verification: {
            kind: "external_read_failed",
            source: "github_repository",
            reason: sourceRead.reason,
            safe: false,
          },
          error: `GITHUB_MONITOR_${sourceRead.reason.toUpperCase()}`,
          notificationTitle: `تعذر فحص ${title}`,
          notificationBody: `لم أرسل تنبيهًا لأن فحص GitHub لم يكتمل بشكل موثوق. وقت المحاولة: ${checkedAt}.`,
          notify: false,
        },
        evidence: {
          sourceType: "github_repository",
          status: "failed",
          reason: sourceRead.reason,
          checkedAt: now.toISOString(),
        },
      };
    }
    const current = sourceRead.snapshot;
    const priorEvidence = await adapters.storage.listEvidence(identity, work.id, 10);
    const previous = priorEvidence.find((item) =>
      typeof item.snapshot.sourceHash === "string"
      && typeof item.snapshot.conditionMet === "boolean");
    const comparison = evaluateReadOnlyEvidence({
      previousHash: typeof previous?.snapshot.sourceHash === "string" ? previous.snapshot.sourceHash : null,
      currentHash: current.sourceHash,
      previousConditionMet: typeof previous?.snapshot.conditionMet === "boolean" ? previous.snapshot.conditionMet : null,
      conditionMet: current.conditionMet,
      comparisonKnown: current.comparisonKnown,
    });
    const firstBaseline = previous === undefined && !current.conditionMet;
    const status = firstBaseline ? "unchanged" : comparison.state;
    const conditionText = `عدد العناصر المفتوحة في ${current.repository} ${comparisonOperatorLabel(current.operator)} ${current.threshold}`;
    const currentValueText = `القيمة الحالية ${current.value}`;
    const checkedAt = new Intl.DateTimeFormat("ar-EG", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Cairo",
    }).format(now);
    const action = delegatedTaskAction(work, current, runId, nextRunAt);
    const conditionHash = current.sourceHash;
    const latestAction = action ? await findLatestActionEvent(adapters, identity, work.id) : null;
    const conditionTriggered = current.conditionMet && previous?.snapshot.conditionMet !== true;
    let approvalOperationId: string | undefined;
    let approvalAction: string | undefined;
    let approvalRequested = false;
    if (action && current.conditionMet && conditionTriggered) {
      const pending = await createPendingOperation(identity, {
        conversationId: typeof work.source.conversationId === "string" ? work.source.conversationId : null,
        sourceTurnId: typeof work.source.sourceTurnId === "string" ? work.source.sourceTurnId : `agent-work:${work.id}`,
        idempotencyKey: `agent-work-action:${work.id}:${conditionHash}:${runIdForApproval(work.id, now)}`,
        toolName: action.toolName,
        args: action.args,
        display: displayForOperation(action.toolName, action.args),
      });
      approvalOperationId = pending.operationId;
      approvalAction = action.toolName;
      approvalRequested = pending.status === "pending";
    }
    const actionWaiting = Boolean(action && current.conditionMet && (
      approvalRequested
      || (
        latestAction?.conditionHash === conditionHash
        && (latestAction.status === "pending" || latestAction.status === "executing")
      )
    ));
    const effectiveStatus = actionWaiting ? "needs_review" : status;
    const effectiveWorkStatus = actionWaiting ? "waiting" : "active";
    const actionText = action
      ? `الإجراء المقترح: إنشاء مهمة داخلية لمراجعة ${current.repository}.`
      : "";
    const notificationBody = status === "verified"
      ? actionWaiting
        ? `تحقق الشرط الذي طلبته في ${current.repository}: ${currentValueText}. ${actionText} وافق على الطلب من تفاصيل العمل.`
        : `تحقق الشرط الذي طلبته في ${current.repository}: ${currentValueText}، والشرط هو ${conditionText}. تم التحقق ${checkedAt}.`
      : status === "uncertain"
        ? `تعذر التحقق من ${current.repository} بشكل موثوق. لم يتم إرسال تنبيه. تم الفحص ${checkedAt}.`
        : `لم يتغير شرط متابعة ${current.repository}: ${currentValueText}، والشرط هو ${conditionText}. آخر فحص ${checkedAt}.`;
    return {
      plan: {
        status: effectiveStatus,
        workStatus: effectiveWorkStatus,
        nextRunAt,
        verification: {
          kind: "read_only_monitor",
          source: "github_repository",
          repository: current.repository,
          ...comparison,
          ...(firstBaseline ? { reason: "baseline_established" } : {}),
          conditionMet: current.conditionMet,
          comparisonKnown: current.comparisonKnown,
          checkedAt: current.fetchedAt,
          ...(approvalOperationId ? { approvalOperationId, action: approvalAction } : {}),
        },
        notificationTitle: actionWaiting
          ? `موافقة مطلوبة: ${current.repository}`
          : status === "verified"
            ? `تحقق شرط GitHub: ${current.repository}`
            : `متابعة GitHub: ${current.repository}`,
        notificationBody,
        notificationData: {
          source: current.sourceType,
          provider: current.provider,
          repository: current.repository,
          value: current.value,
          threshold: current.threshold,
          operator: current.operator,
          checkedAt: current.fetchedAt,
          deepLink: `/main?workId=${encodeURIComponent(work.id)}`,
        },
        notify: status === "verified" || actionWaiting,
        ...(approvalOperationId ? { approvalOperationId, approvalAction } : {}),
      },
      evidence: {
        sourceType: current.sourceType,
        provider: current.provider,
        repository: current.repository,
        repositoryId: current.repositoryId,
        metric: current.metric,
        operator: current.operator,
        threshold: current.threshold,
        value: current.value,
        updatedAt: current.updatedAt,
        responseDate: current.responseDate,
        sourceHash: current.sourceHash,
        conditionMet: current.conditionMet,
        comparisonKnown: current.comparisonKnown,
        checkedAt: current.fetchedAt,
        reason: current.reason,
        ...(approvalOperationId ? {
          approvalOperationId,
          action: approvalAction,
          actionDecision: "approval_requested",
        } : {}),
      },
    };
  }

  return {
    plan: {
      status: "needs_review",
      workStatus: "needs_review",
      nextRunAt: null,
      verification: {
        kind: "unsupported_source",
        sourceType: typeof source.type === "string" ? source.type : "unknown",
        safe: false,
      },
      error: "AGENT_WORK_SOURCE_REQUIRES_REVIEW",
      notificationTitle: `مراجعة مطلوبة: ${title}`,
      notificationBody: "توقفت المتابعة لأن هذا النوع من المصدر لم يُسمح به بعد.",
      notify: true,
    },
    evidence: { workKind: work.kind, status: "needs_review", safe: false },
  };
}

export async function planExecution(
  adapters: AgentWorkAdapters,
  intent: WorkIntent,
  githubReadContext?: GitHubReadContext,
): Promise<ExecutionOutcome> {
  const result = await buildActionPlan(
    adapters,
    intent.identity,
    intent.work,
    intent.trigger,
    intent.event.occurredAt,
    intent.run.id,
    githubReadContext,
  );
  return {
    ...result,
    evaluation: evaluationFromPlan(result.plan, result.evidence),
  };
}