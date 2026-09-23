import { featureFlags } from "../feature-flags";
import { agentWorkAdapters } from "./factory";
import { AgentWorkRuntime } from "./runtime";
import { compareReadOnlyEvidence } from "./contract";
import { readGitHubRepositorySource, readInternalRecordsSource } from "./sources";
import {
  recordAgentWorkActionApproved,
  recordAgentWorkActionRejected,
} from "./delegated-actions";
import {
  createPendingOperation,
  displayForOperation,
  getOperation,
} from "../secretary-operations";
import type {
  AgentWorkAdapters,
  AgentWorkRecord,
  AgentWorkRunRecord,
  AgentWorkRunStatus,
} from "./types";

const DEFAULT_POLL_MS = 15_000;
const DEFAULT_LEASE_MS = 5 * 60_000;
const MAX_DUE_WORKS = 25;
const activeRunStatuses = new Set(["claimed", "running", "verifying"]);

export type AgentWorkRunnerOptions = {
  adapters?: AgentWorkAdapters;
  pollMs?: number;
  leaseMs?: number;
  now?: () => Date;
};

export type AgentWorkRunnerTickResult = {
  enabled: boolean;
  inspected: number;
  claimed: number;
  completed: number;
  skipped: number;
  failed: number;
};

function runnerEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes(
    (process.env.AGENT_WORK_RUNNER_ENABLED ?? "false").trim().toLowerCase(),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function zonedParts(value: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number } {
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
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
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
    const localTime = typeof schedule.localTime === "string" ? schedule.localTime.match(/^([01]\d|2[0-3]):([0-5]\d)$/u) : null;
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

type ExecutionPlan = {
  status: AgentWorkRunStatus;
  workStatus: AgentWorkRecord["status"];
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
): Promise<{ operationId: string; conditionHash: string; status: string } | null> {
  const events = await adapters.storage.listEvents(identity, workId, 30);
  const event = events.find((item) => item.eventType === "approval_requested");
  const metadata = asRecord(event?.metadata);
  if (typeof metadata.operationId !== "string" || typeof metadata.conditionHash !== "string") return null;
  const operation = await getOperation(identity, metadata.operationId);
  return operation
    ? { operationId: operation.operationId, conditionHash: metadata.conditionHash, status: operation.status }
    : null;
}

async function reconcileWaitingApproval(
  adapters: AgentWorkAdapters,
  identity: AgentWorkRecord["identity"],
  work: AgentWorkRecord,
): Promise<boolean> {
  if (work.status !== "waiting") return false;
  const action = asRecord(work.action);
  if (action.type !== "create_task" && action.toolName !== "create_task") return false;
  const latestAction = await findLatestActionEvent(adapters, identity, work.id);
  if (!latestAction) return false;
  const operation = await getOperation(identity, latestAction.operationId);
  if (!operation) return false;
  if (operation.status === "completed" && operation.result) {
    await recordAgentWorkActionApproved(identity, operation, operation.result, adapters);
    return true;
  }
  if (operation.status === "expired" || operation.status === "rejected" || operation.status === "failed") {
    await recordAgentWorkActionRejected(
      identity,
      operation,
      operation.status === "expired" ? "expired" : operation.status === "rejected" ? "rejected" : "failed",
      adapters,
    );
    return true;
  }
  return false;
}

function runIdForApproval(workId: string, now: Date): string {
  return `${workId}:${now.toISOString()}`;
}

async function planExecution(
  adapters: AgentWorkAdapters,
  identity: AgentWorkRecord["identity"],
  work: AgentWorkRecord,
  now: Date,
  runId: string,
): Promise<{ plan: ExecutionPlan; evidence: Record<string, unknown> }> {
  const schedule = asRecord(work.schedule);
  const nextRunAt = nextScheduledAt(now, schedule);
  const recurring = nextRunAt !== null;
  const title = work.title.trim() || "عمل الوكيل";

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

  const source = asRecord(work.source);
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
    const comparison = compareReadOnlyEvidence({
      previousHash,
      currentHash: current.sourceHash,
      previousConditionMet,
      conditionMet: current.conditionMet,
      comparisonKnown: current.comparisonKnown,
    });
    const firstBaseline = previousHash === null && current.comparisonKnown && !current.conditionMet;
    const status = firstBaseline ? "unchanged" : comparison.state;
    const operatorLabel = current.operator === "gt"
      ? "أكبر من"
      : current.operator === "gte"
        ? "أكبر من أو يساوي"
        : current.operator === "eq"
          ? "يساوي"
          : current.operator === "lt"
            ? "أقل من"
            : "أقل من أو يساوي";
    const checkedAt = new Intl.DateTimeFormat("ar-EG", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Cairo",
    }).format(now);
    const conditionText = `عدد المهام المفتوحة ${operatorLabel} ${current.threshold}`;
    const currentValueText = `القيمة الحالية ${current.value}`;
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
          ...comparison,
          ...(firstBaseline ? { reason: "baseline_established" } : {}),
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
    const sourceRead = await readGitHubRepositorySource(identity, work, { now });
    const schedule = asRecord(work.schedule);
    const nextRunAt = nextScheduledAt(now, schedule);
    const recurring = nextRunAt !== null;
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
    const comparison = compareReadOnlyEvidence({
      previousHash: typeof previous?.snapshot.sourceHash === "string" ? previous.snapshot.sourceHash : null,
      currentHash: current.sourceHash,
      previousConditionMet: typeof previous?.snapshot.conditionMet === "boolean" ? previous.snapshot.conditionMet : null,
      conditionMet: current.conditionMet,
      comparisonKnown: current.comparisonKnown,
    });
    const firstBaseline = previous === undefined && !current.conditionMet;
    const status = firstBaseline ? "unchanged" : comparison.state;
    const operatorLabel = current.operator === "gt"
      ? "أكبر من"
      : current.operator === "gte"
        ? "أكبر من أو يساوي"
        : current.operator === "eq"
          ? "يساوي"
          : current.operator === "lt"
            ? "أقل من"
            : "أقل من أو يساوي";
    const checkedAt = new Intl.DateTimeFormat("ar-EG", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Cairo",
    }).format(now);
    const conditionText = `عدد العناصر المفتوحة في ${current.repository} ${operatorLabel} ${current.threshold}`;
    const currentValueText = `القيمة الحالية ${current.value}`;
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

export class AgentWorkRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private readonly adapters: AgentWorkAdapters;
  private readonly pollMs: number;
  private readonly leaseMs: number;
  private readonly now: () => Date;
  private readonly runtime: AgentWorkRuntime;

  constructor(options: AgentWorkRunnerOptions = {}) {
    this.adapters = options.adapters ?? agentWorkAdapters;
    this.pollMs = Math.max(1_000, Math.floor(options.pollMs ?? Number(process.env.AGENT_WORK_RUNNER_POLL_MS ?? DEFAULT_POLL_MS)));
    this.leaseMs = Math.max(10_000, Math.floor(options.leaseMs ?? Number(process.env.AGENT_WORK_RUNNER_LEASE_MS ?? DEFAULT_LEASE_MS)));
    this.now = options.now ?? (() => new Date());
    this.runtime = new AgentWorkRuntime(this.adapters);
  }

  async tick(now = this.now()): Promise<AgentWorkRunnerTickResult> {
    const empty = { enabled: false, inspected: 0, claimed: 0, completed: 0, skipped: 0, failed: 0 };
    if (!featureFlags.agentWork() || !runnerEnabled()) return empty;
    let due: Awaited<ReturnType<AgentWorkAdapters["storage"]["listDueWorks"]>>;
    let waiting: Awaited<ReturnType<AgentWorkAdapters["storage"]["listWaitingWorks"]>>;
    try {
      [due, waiting] = await Promise.all([
        this.adapters.storage.listDueWorks({ now, limit: MAX_DUE_WORKS }),
        this.adapters.storage.listWaitingWorks({ limit: MAX_DUE_WORKS }),
      ]);
    } catch {
      return { ...empty, enabled: true, failed: 1 };
    }
    const candidates = [...due, ...waiting];
    const result: AgentWorkRunnerTickResult = { ...empty, enabled: true, inspected: candidates.length };

    for (const candidate of candidates) {
      let identity: AgentWorkRecord["identity"] | null;
      try {
        identity = this.adapters.identity.resolveBackground({
          tenantId: candidate.identity.tenantId,
          userId: candidate.identity.userId,
          actor: "scheduler",
        });
      } catch {
        result.failed += 1;
        continue;
      }
      if (!identity) {
        result.skipped += 1;
        continue;
      }
      let work: AgentWorkRecord | null;
      try {
        work = await this.adapters.storage.getWork(identity, candidate.workId);
      } catch {
        result.failed += 1;
        continue;
      }
      if (!work) {
        result.skipped += 1;
        continue;
      }
      if (work.status === "waiting") {
        try {
          if (await reconcileWaitingApproval(this.adapters, identity, work)) result.completed += 1;
          else result.skipped += 1;
        } catch {
          result.failed += 1;
        }
        continue;
      }
      if (work.status !== "active") {
        result.skipped += 1;
        continue;
      }
      const slot = candidate.nextRunAt?.toISOString() ?? "immediate";
      const idempotencyKey = `agent-work-run:${candidate.workId}:${slot}`;
      let run: AgentWorkRunRecord | null;
      try {
        run = await this.adapters.storage.claimRun({
          identity,
          workId: candidate.workId,
          now,
          leaseMs: this.leaseMs,
          idempotencyKey,
        });
      } catch {
        result.failed += 1;
        continue;
      }
      if (!run || !run.leaseToken || run.idempotencyKey !== idempotencyKey || !activeRunStatuses.has(run.status)) {
        result.skipped += 1;
        continue;
      }
      result.claimed += 1;
      let approvalEventRecorded = false;
      try {
        const execution = await planExecution(this.adapters, identity, work, now, run.id);
        const plan = execution.plan;
        await this.adapters.storage.storeEvidenceSnapshot({
          identity,
          workId: work.id,
          runId: run.id,
          snapshot: { ...execution.evidence, checkedAt: now.toISOString() },
          retentionClass: "standard",
        });
        if (plan.approvalOperationId) {
          await this.adapters.storage.addEvent({
            identity,
            workId: work.id,
            runId: run.id,
            eventType: "approval_requested",
            actorType: "agent",
            summary: "تحقق الشرط وطلب الوكيل موافقتك على إنشاء المهمة.",
            metadata: {
              operationId: plan.approvalOperationId,
              action: plan.approvalAction ?? "create_task",
              conditionHash: typeof execution.evidence.sourceHash === "string"
                ? execution.evidence.sourceHash
                : null,
            },
            dedupeKey: `agent-work-approval-requested:${plan.approvalOperationId}`,
          });
          approvalEventRecorded = true;
        }
        const notificationEvent = plan.notify
          ? await this.adapters.storage.addEvent({
              identity,
              workId: work.id,
              runId: run.id,
              eventType: "run_notification",
              actorType: "agent",
              summary: plan.notificationBody,
              metadata: { status: plan.status },
              dedupeKey: `agent-work-notification:${run.id}`,
            })
          : null;
        const notificationInput = notificationEvent
          ? {
              eventId: notificationEvent.id,
              title: plan.notificationTitle,
              body: plan.notificationBody,
              data: {
                workId: work.id,
                runId: run.id,
                status: plan.status,
                deepLink: `/main?workId=${encodeURIComponent(work.id)}`,
                ...(plan.notificationData ?? {}),
              },
              dedupeKey: `agent-work-notification:${run.id}`,
              workId: work.id,
              runId: run.id,
            }
          : null;
        const completionInput = {
          identity,
          run,
          status: plan.status,
          verification: plan.verification,
          error: plan.error ?? null,
          nextRunAt: plan.nextRunAt,
          workStatus: plan.workStatus,
          completedAt: this.now(),
        };
        if (notificationInput && this.adapters.storage.completeRunWithNotification) {
          await this.adapters.storage.completeRunWithNotification({
            identity,
            runId: run.id,
            leaseToken: run.leaseToken ?? "",
            status: completionInput.status,
            verification: completionInput.verification,
            error: completionInput.error,
            nextRunAt: completionInput.nextRunAt,
            workStatus: completionInput.workStatus,
            completedAt: completionInput.completedAt,
            notification: notificationInput,
          });
        } else {
          await this.runtime.completeRun(completionInput);
        }
        if (plan.status === "failed") {
          await this.adapters.storage.addEvent({
            identity,
            workId: work.id,
            runId: run.id,
            eventType: "run_failed",
            actorType: "system",
            summary: "فشل الفحص الخارجي، ولم يتم اعتبار الشرط متحققًا.",
            metadata: { status: plan.status, verification: plan.verification, error: plan.error ?? null },
            dedupeKey: `agent-work-failed:${run.id}`,
          });
          result.failed += 1;
          continue;
        }
        if (!plan.notify) {
          await this.adapters.storage.addEvent({
            identity,
            workId: work.id,
            runId: run.id,
            eventType: "run_unchanged",
            actorType: "agent",
            summary: plan.notificationBody,
            metadata: { status: plan.status },
            dedupeKey: `agent-work-unchanged:${run.id}`,
          });
          result.completed += 1;
          continue;
        }
        const delivery = notificationInput && this.adapters.storage.completeRunWithNotification
          ? {
              status: "accepted" as const,
              driver: this.adapters.notification.driver,
              reason: "durable_outbox_queued",
            }
          : await this.adapters.notification.notify({
              identity,
              eventId: notificationInput?.eventId ?? "",
              title: plan.notificationTitle,
              body: plan.notificationBody,
              data: notificationInput?.data ?? {},
              dedupeKey: notificationInput?.dedupeKey ?? `agent-work-notification:${run.id}`,
            });
        await this.adapters.storage.addEvent({
          identity,
          workId: work.id,
          runId: run.id,
          eventType: "notification_delivery",
          actorType: "system",
          summary: delivery.status === "accepted" ? "تم إرسال التنبيه." : "تعذر إرسال التنبيه.",
          metadata: { status: delivery.status, driver: delivery.driver, reason: delivery.reason ?? null },
          dedupeKey: `agent-work-delivery:${run.id}`,
        });
        result.completed += 1;
      } catch (error) {
        result.failed += 1;
        // The approval operation and its durable link must remain resumable
        // if completion lost its lease. Marking the Work failed here would
        // strand a valid approval and make a later retry unsafe.
        if (approvalEventRecorded) continue;
        try {
          await this.runtime.completeRun({
            identity,
            run,
            status: "failed",
            error: error instanceof Error ? error.message.slice(0, 500) : "AGENT_WORK_RUN_FAILED",
            verification: { kind: "runner_failure", safe: false },
            workStatus: "failed",
            nextRunAt: null,
            completedAt: this.now(),
          });
        } catch {
          // The lease/DB failure is already represented by the runner counters.
        }
      }
    }
    return result;
  }

  start(): void {
    if (this.timer || !runnerEnabled()) return;
    this.timer = setInterval(() => {
      if (this.ticking) return;
      this.ticking = true;
      void this.tick().catch(() => undefined).finally(() => {
        this.ticking = false;
      });
    }, this.pollMs);
    void this.tick().catch(() => undefined);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

export const agentWorkRunner = new AgentWorkRunner();