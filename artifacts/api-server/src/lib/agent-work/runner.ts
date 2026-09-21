import { featureFlags } from "../feature-flags";
import { agentWorkAdapters } from "./factory";
import { AgentWorkRuntime } from "./runtime";
import { compareReadOnlyEvidence } from "./contract";
import { readInternalRecordsSource } from "./sources";
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

function nextScheduledAt(now: Date, schedule: Record<string, unknown>): Date | null {
  const frequency = typeof schedule.frequency === "string" ? schedule.frequency : null;
  if (frequency === "hourly") return new Date(now.getTime() + 60 * 60_000);
  if (frequency === "daily") return new Date(now.getTime() + 24 * 60 * 60_000);
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
  notify: boolean;
};

async function planExecution(
  adapters: AgentWorkAdapters,
  identity: AgentWorkRecord["identity"],
  work: AgentWorkRecord,
  now: Date,
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
    const comparison = compareReadOnlyEvidence({
      previousHash,
      currentHash: current.sourceHash,
      conditionMet: current.conditionMet,
      comparisonKnown: current.comparisonKnown,
    });
    const firstBaseline = previousHash === null && current.comparisonKnown && !current.conditionMet;
    const status = firstBaseline ? "unchanged" : comparison.state;
    const notificationBody = status === "verified"
      ? `تحقق شرط المتابعة في «${title}».`
      : status === "needs_review"
        ? `تغيرت بيانات «${title}» لكن النتيجة تحتاج مراجعتك.`
        : status === "uncertain"
          ? `تعذر التحقق من «${title}» بشكل موثوق.`
          : `لم يتغير شرط المتابعة في «${title}».`;
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
    const due = await this.adapters.storage.listDueWorks({ now, limit: MAX_DUE_WORKS });
    const result: AgentWorkRunnerTickResult = { ...empty, enabled: true, inspected: due.length };

    for (const candidate of due) {
      const identity = this.adapters.identity.resolveBackground({
        tenantId: candidate.identity.tenantId,
        userId: candidate.identity.userId,
        actor: "scheduler",
      });
      if (!identity) {
        result.skipped += 1;
        continue;
      }
      const work = await this.adapters.storage.getWork(identity, candidate.workId);
      if (!work || work.status !== "active") {
        result.skipped += 1;
        continue;
      }
      const slot = candidate.nextRunAt?.toISOString() ?? "immediate";
      const idempotencyKey = `agent-work-run:${candidate.workId}:${slot}`;
      const run = await this.adapters.storage.claimRun({
        identity,
        workId: candidate.workId,
        now,
        leaseMs: this.leaseMs,
        idempotencyKey,
      });
      if (!run || !run.leaseToken || run.idempotencyKey !== idempotencyKey || !activeRunStatuses.has(run.status)) {
        result.skipped += 1;
        continue;
      }
      result.claimed += 1;
      try {
        const execution = await planExecution(this.adapters, identity, work, now);
        const plan = execution.plan;
        await this.adapters.storage.storeEvidenceSnapshot({
          identity,
          workId: work.id,
          runId: run.id,
          snapshot: { ...execution.evidence, checkedAt: now.toISOString() },
          retentionClass: "standard",
        });
        await this.runtime.completeRun({
          identity,
          run,
          status: plan.status,
          verification: plan.verification,
          error: plan.error ?? null,
          nextRunAt: plan.nextRunAt,
          workStatus: plan.workStatus,
        });
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
        const notificationEvent = await this.adapters.storage.addEvent({
          identity,
          workId: work.id,
          runId: run.id,
          eventType: "run_notification",
          actorType: "agent",
          summary: plan.notificationBody,
          metadata: { status: plan.status },
          dedupeKey: `agent-work-notification:${run.id}`,
        });
        const delivery = await this.adapters.notification.notify({
          identity,
          eventId: notificationEvent.id,
          title: plan.notificationTitle,
          body: plan.notificationBody,
          data: { workId: work.id, runId: run.id, status: plan.status },
          dedupeKey: `agent-work-notification:${run.id}`,
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
        try {
          await this.runtime.completeRun({
            identity,
            run,
            status: "failed",
            error: error instanceof Error ? error.message.slice(0, 500) : "AGENT_WORK_RUN_FAILED",
            verification: { kind: "runner_failure", safe: false },
            workStatus: "failed",
            nextRunAt: null,
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