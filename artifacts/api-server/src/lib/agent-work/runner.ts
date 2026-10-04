import { featureFlags } from "../feature-flags";
import { logger } from "../logger";
import { agentWorkAdapters } from "./factory";
import { AgentWorkRuntime } from "./runtime";
import type { GitHubReadContext } from "./sources";
import { planExecution } from "./execution-planner";
import {
  timeDueTriggerEvent,
  triggerDefinitionForWork,
  type WorkIntent,
} from "./contracts";
import {
  recordAgentWorkActionApproved,
  recordAgentWorkActionRejected,
} from "./delegated-actions";
import { externalActionStatusFromResult } from "./external-action";
import {
  getOperation,
} from "../secretary-operations";
import type {
  AgentWorkAdapters,
  AgentWorkRecord,
  AgentWorkRunRecord,
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

async function findLatestActionEvent(
  adapters: AgentWorkAdapters,
  identity: AgentWorkRecord["identity"],
  workId: string,
): Promise<{
  operationId: string;
  conditionHash: string | null;
  status: string;
  operation: NonNullable<Awaited<ReturnType<typeof getOperation>>>;
} | null> {
  const events = await adapters.storage.listEvents(identity, workId, 30);
  const event = events.find((item) => item.eventType === "approval_requested");
  const metadata = asRecord(event?.metadata);
  const operationId = typeof metadata.approvalOperationId === "string"
    ? metadata.approvalOperationId
    : metadata.operationId;
  if (typeof operationId !== "string") return null;
  const operation = await getOperation(identity, operationId);
  return operation
    ? {
        operationId: operation.operationId,
        conditionHash: typeof metadata.conditionHash === "string" ? metadata.conditionHash : null,
        status: operation.status,
        operation,
      }
    : null;
}

async function reconcileWaitingApproval(
  adapters: AgentWorkAdapters,
  identity: AgentWorkRecord["identity"],
  work: AgentWorkRecord,
): Promise<boolean> {
  if (work.status !== "waiting") return false;
  const action = asRecord(work.action);
  const isExternalAction = work.kind === "external_action";
  if (!isExternalAction && action.type !== "create_task" && action.toolName !== "create_task") {
    return false;
  }
  const latestAction = await findLatestActionEvent(adapters, identity, work.id);
  if (!latestAction) return false;
  const operation = latestAction.operation;
  if (isExternalAction && externalActionStatusFromResult(operation) === "unknown_result") {
    await recordAgentWorkActionRejected(identity, operation, "unknown_result", adapters);
    return true;
  }
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
  if (isExternalAction && operation.status === "executing") {
    const events = await adapters.storage.listEvents(identity, work.id, 100);
    const operationEvents = events.filter((event) =>
      asRecord(event.metadata).approvalOperationId === operation.operationId
      || asRecord(event.metadata).operationId === operation.operationId);
    const terminalStepIds = new Set(
      operationEvents
        .filter((event) => [
          "external_action_step_verified",
          "external_action_step_failed",
          "external_action_unknown_result",
        ].includes(event.eventType))
        .map((event) => asRecord(event.metadata).stepId ?? asRecord(event.metadata).actionId)
        .filter((stepId): stepId is string => typeof stepId === "string"),
    );
    const staleUnconfirmedStart = operationEvents.find((event) =>
      event.eventType === "external_action_step_started"
      && typeof (asRecord(event.metadata).stepId ?? asRecord(event.metadata).actionId) === "string"
      && !terminalStepIds.has(String(asRecord(event.metadata).stepId ?? asRecord(event.metadata).actionId))
      && Date.now() - event.createdAt.getTime() >= 60_000);
    const hasUnknownReceipt = operationEvents.some((event) =>
      event.eventType === "external_action_unknown_result");
    if (hasUnknownReceipt || staleUnconfirmedStart) {
      await recordAgentWorkActionRejected(identity, operation, "unknown_result", adapters);
      return true;
    }
  }
  return false;
}

export class AgentWorkRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private readonly adapters: AgentWorkAdapters;
  private readonly pollMs: number;
  private readonly leaseMs: number;
  private readonly now: () => Date;
  private readonly runtime: AgentWorkRuntime;
  private readonly githubCooldowns = new Map<string, number>();

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
    const githubReadContext: GitHubReadContext = {
      cooldowns: this.githubCooldowns,
      reads: new Map(),
    };

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
        const intent: WorkIntent = {
          identity,
          work,
          run,
          trigger: triggerDefinitionForWork(work),
          event: timeDueTriggerEvent(work, run, now),
        };
        const execution = await planExecution(this.adapters, intent, githubReadContext);
        const plan = execution.plan;
        const sourceEventId = typeof work.source.eventId === "string"
          ? work.source.eventId
          : undefined;
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
            summary: plan.approvalAction && plan.approvalAction !== "create_task"
              ? "جهز الوكيل إجراءً خارجيًا وطلب موافقتك قبل الاتصال بالمزود."
              : "تحقق الشرط وطلب الوكيل موافقتك على إنشاء المهمة.",
            metadata: {
              approvalOperationId: plan.approvalOperationId,
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
              metadata: {
                status: plan.status,
                ...(sourceEventId ? { sourceEventId } : {}),
              },
              dedupeKey: `agent-work-notification:${run.id}`,
            })
          : null;
        const notificationInput = notificationEvent
          ? {
              eventId: notificationEvent.id,
              title: plan.notificationTitle,
              body: plan.notificationBody,
              data: {
                kind: "secretary-event",
                workId: work.id,
                runId: run.id,
                status: plan.status,
                deepLink: `/main?workId=${encodeURIComponent(work.id)}`,
                ...(plan.notificationData ?? {}),
                ...(sourceEventId ? { triggerEventId: sourceEventId } : {}),
              },
              ...(sourceEventId ? { sourceEventId } : {}),
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
          summary: delivery.status !== "accepted"
            ? "تعذر إرسال التنبيه."
            : delivery.reason === "durable_outbox_queued"
              ? "وُضع التنبيه في قائمة التسليم؛ لم يتأكد وصوله للجهاز بعد."
              : "قبل مزود التنبيهات الطلب؛ وصوله للجهاز غير مؤكد.",
            metadata: {
              status: delivery.status,
              driver: delivery.driver,
              reason: delivery.reason ?? null,
              ...(sourceEventId ? { sourceEventId } : {}),
            },
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
    const run = () => {
      if (this.ticking) return;
      this.ticking = true;
      const startedAt = Date.now();
      void this.tick().then((result) => {
        if (result.claimed > 0 || result.failed > 0) {
          logger.info({
            ...result,
            durationMs: Date.now() - startedAt,
          }, "agent work runner tick completed");
        }
      }).catch((error) => {
        logger.error({
          errorType: error instanceof Error ? error.name : "unknown",
          durationMs: Date.now() - startedAt,
        }, "agent work runner tick failed");
      }).finally(() => {
        this.ticking = false;
      });
    };
    this.timer = setInterval(run, this.pollMs);
    run();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

export const agentWorkRunner = new AgentWorkRunner();
