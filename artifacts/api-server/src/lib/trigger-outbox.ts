import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  gte,
  gt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  agentWorksTable,
  triggerOutboxTable,
} from "@workspace/db";
import type { DbExecutor, Identity } from "./entity-graph";
import { logger } from "./logger";
import { featureFlags } from "./feature-flags";
import { agentWorkRuntime } from "./agent-work/runtime";

export type TriggerOutboxStatus = "pending" | "claimed" | "processed" | "quarantined";

export type TriggerOutboxEvent = {
  eventId: string;
  tenantId: string;
  ownerUserId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  schemaVersion: number;
  occurredAt: Date;
  payload: Record<string, unknown>;
  dedupeKey: string;
  status: TriggerOutboxStatus;
  attemptCount: number;
  availableAt: Date;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  lastError: string | null;
  processedAt: Date | null;
  quarantinedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EnqueueTriggerOutboxInput = {
  identity: Identity;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  schemaVersion?: number;
  occurredAt?: Date;
  payload?: Record<string, unknown>;
  dedupeKey: string;
};

export type EnqueueTriggerOutboxResult = {
  event: TriggerOutboxEvent;
  created: boolean;
};

export type TriggerEvaluation = {
  eligible: boolean;
  triggerKey: string;
  reason: string;
};

type TriggerOutboxRow = typeof triggerOutboxTable.$inferSelect;

function mapEvent(row: TriggerOutboxRow): TriggerOutboxEvent {
  return {
    eventId: row.id,
    tenantId: row.tenantId,
    ownerUserId: row.ownerUserId,
    eventType: row.eventType,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    schemaVersion: row.schemaVersion,
    occurredAt: row.occurredAt,
    payload: row.payload,
    dedupeKey: row.dedupeKey,
    status: row.status as TriggerOutboxStatus,
    attemptCount: row.attemptCount,
    availableAt: row.availableAt,
    leaseToken: row.leaseToken,
    leaseExpiresAt: row.leaseExpiresAt,
    lastError: row.lastError,
    processedAt: row.processedAt,
    quarantinedAt: row.quarantinedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function enqueueTriggerOutbox(
  input: EnqueueTriggerOutboxInput,
  executor: DbExecutor = db,
): Promise<EnqueueTriggerOutboxResult> {
  const [created] = await executor.insert(triggerOutboxTable).values({
    tenantId: input.identity.tenantId,
    ownerUserId: input.identity.userId,
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    schemaVersion: input.schemaVersion ?? 1,
    occurredAt: input.occurredAt ?? new Date(),
    payload: input.payload ?? {},
    dedupeKey: input.dedupeKey,
  }).onConflictDoNothing({
    target: [
      triggerOutboxTable.tenantId,
      triggerOutboxTable.ownerUserId,
      triggerOutboxTable.dedupeKey,
    ],
  }).returning();

  if (created) {
    const event = mapEvent(created);
    logger.info({
      eventId: event.eventId,
      tenantId: event.tenantId,
      ownerUserId: event.ownerUserId,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
    }, "trigger outbox event created");
    return { event, created: true };
  }

  const [existing] = await executor.select().from(triggerOutboxTable).where(and(
    eq(triggerOutboxTable.tenantId, input.identity.tenantId),
    eq(triggerOutboxTable.ownerUserId, input.identity.userId),
    eq(triggerOutboxTable.dedupeKey, input.dedupeKey),
  )).limit(1);
  if (!existing) throw new Error("TRIGGER_OUTBOX_DEDUPE_LOOKUP_FAILED");
  logger.info({
    eventId: existing.id,
    tenantId: existing.tenantId,
    ownerUserId: existing.ownerUserId,
    dedupeKey: existing.dedupeKey,
  }, "trigger outbox event coalesced");
  return { event: mapEvent(existing), created: false };
}

export function evaluateTriggerEvent(event: TriggerOutboxEvent): TriggerEvaluation {
  const triggerKey = "task-created-to-agent-work-v1";
  if (event.eventType !== "task.created" || event.aggregateType !== "task") {
    return { eligible: false, triggerKey, reason: "no_matching_trigger" };
  }
  if (event.payload.status !== "pending") {
    return { eligible: false, triggerKey, reason: "task_not_pending" };
  }
  return { eligible: true, triggerKey, reason: "task_created_pending" };
}

function workIntentDedupeKey(event: TriggerOutboxEvent, triggerKey: string): string {
  return [
    "trigger-work-intent",
    triggerKey,
    event.tenantId,
    event.ownerUserId,
    event.eventId,
    event.aggregateType,
    event.aggregateId,
  ].join(":");
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(60_000, Math.max(1_000, 2 ** Math.max(0, attemptCount - 1) * 1_000));
}

async function claimNextTriggerOutbox(input: {
  now: Date;
  leaseMs: number;
  maxAttempts: number;
}): Promise<TriggerOutboxEvent | null> {
  return db.transaction(async (tx) => {
    await tx.update(triggerOutboxTable).set({
      status: "quarantined",
      quarantinedAt: input.now,
      updatedAt: input.now,
      lastError: "TRIGGER_OUTBOX_MAX_ATTEMPTS_AFTER_LEASE_EXPIRY",
      leaseToken: null,
      leaseExpiresAt: null,
    }).where(and(
      eq(triggerOutboxTable.status, "claimed"),
      lte(triggerOutboxTable.leaseExpiresAt, input.now),
      gte(triggerOutboxTable.attemptCount, input.maxAttempts),
    ));

    const [row] = await tx.select().from(triggerOutboxTable).where(or(
      and(
        eq(triggerOutboxTable.status, "pending"),
        lte(triggerOutboxTable.availableAt, input.now),
        sql`${triggerOutboxTable.attemptCount} < ${input.maxAttempts}`,
      ),
      and(
        eq(triggerOutboxTable.status, "claimed"),
        lte(triggerOutboxTable.leaseExpiresAt, input.now),
        sql`${triggerOutboxTable.attemptCount} < ${input.maxAttempts}`,
      ),
    )).orderBy(
      asc(triggerOutboxTable.availableAt),
      asc(triggerOutboxTable.createdAt),
    ).limit(1).for("update", { skipLocked: true });
    if (!row) return null;

    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
    const [claimed] = await tx.update(triggerOutboxTable).set({
      status: "claimed",
      attemptCount: sql`${triggerOutboxTable.attemptCount} + 1`,
      availableAt: input.now,
      leaseToken,
      leaseExpiresAt,
      updatedAt: input.now,
      lastError: null,
    }).where(and(
      eq(triggerOutboxTable.id, row.id),
      eq(triggerOutboxTable.status, row.status),
      or(
        eq(triggerOutboxTable.status, "pending"),
        lte(triggerOutboxTable.leaseExpiresAt, input.now),
      ),
    )).returning();
    if (!claimed) return null;
    const event = mapEvent(claimed);
    logger.info({
      eventId: event.eventId,
      tenantId: event.tenantId,
      ownerUserId: event.ownerUserId,
      attempt: event.attemptCount,
      leaseExpiresAt: event.leaseExpiresAt?.toISOString() ?? null,
    }, "trigger outbox event claimed");
    return event;
  });
}

async function processClaimedEvent(event: TriggerOutboxEvent, now: Date): Promise<"processed" | "coalesced"> {
  if (!event.leaseToken) throw new Error("TRIGGER_OUTBOX_LEASE_MISSING");
  const leaseToken = event.leaseToken;
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(triggerOutboxTable).where(and(
      eq(triggerOutboxTable.id, event.eventId),
      eq(triggerOutboxTable.tenantId, event.tenantId),
      eq(triggerOutboxTable.ownerUserId, event.ownerUserId),
      eq(triggerOutboxTable.status, "claimed"),
      eq(triggerOutboxTable.leaseToken, leaseToken),
      gt(triggerOutboxTable.leaseExpiresAt, now),
    )).for("update");
    if (!current) throw new Error("TRIGGER_OUTBOX_LEASE_LOST");

    const currentEvent = mapEvent(current);
    const evaluation = evaluateTriggerEvent(currentEvent);
    let outcome: "processed" | "coalesced" = "processed";
    if (evaluation.eligible) {
      const identity = { tenantId: currentEvent.tenantId, userId: currentEvent.ownerUserId };
      const dedupeKey = workIntentDedupeKey(currentEvent, evaluation.triggerKey);
      const [existing] = await tx.select({ id: agentWorksTable.id })
        .from(agentWorksTable)
        .where(and(
          eq(agentWorksTable.tenantId, identity.tenantId),
          eq(agentWorksTable.ownerUserId, identity.userId),
          eq(agentWorksTable.dedupeKey, dedupeKey),
        )).limit(1);
      outcome = existing ? "coalesced" : "processed";
      await agentWorkRuntime.createWork({
        identity,
        kind: "workflow",
        title: `Trigger: ${currentEvent.eventType}`,
        description: `تم إنشاء WorkIntent من ${currentEvent.eventType}.`,
        status: "active",
        dedupeKey,
        source: {
          type: "trigger_outbox",
          eventId: currentEvent.eventId,
          eventType: currentEvent.eventType,
          aggregateType: currentEvent.aggregateType,
          aggregateId: currentEvent.aggregateId,
          triggerKey: evaluation.triggerKey,
        },
        condition: {
          type: "trigger_event",
          eventId: currentEvent.eventId,
          eventType: currentEvent.eventType,
          aggregateType: currentEvent.aggregateType,
          aggregateId: currentEvent.aggregateId,
        },
        action: { type: "none" },
        schedule: { frequency: "once" },
        nextRunAt: currentEvent.occurredAt,
        transactionExecutor: tx,
      });
    }

    const [processed] = await tx.update(triggerOutboxTable).set({
      status: "processed",
      processedAt: now,
      updatedAt: now,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: evaluation.eligible ? null : evaluation.reason,
    }).where(and(
      eq(triggerOutboxTable.id, currentEvent.eventId),
      eq(triggerOutboxTable.status, "claimed"),
      eq(triggerOutboxTable.leaseToken, leaseToken),
      gt(triggerOutboxTable.leaseExpiresAt, now),
    )).returning();
    if (!processed) throw new Error("TRIGGER_OUTBOX_LEASE_LOST");
    logger.info({
      eventId: currentEvent.eventId,
      tenantId: currentEvent.tenantId,
      ownerUserId: currentEvent.ownerUserId,
      triggerKey: evaluation.triggerKey,
      reason: evaluation.reason,
      outcome,
    }, outcome === "coalesced" ? "trigger outbox work intent coalesced" : "trigger outbox event processed");
    return outcome;
  });
}

async function failClaimedEvent(event: TriggerOutboxEvent, error: unknown, now: Date, maxAttempts: number): Promise<void> {
  if (!event.leaseToken) return;
  const leaseToken = event.leaseToken;
  const message = error instanceof Error ? error.message.slice(0, 500) : "TRIGGER_OUTBOX_DISPATCH_FAILED";
  await db.transaction(async (tx) => {
    const terminal = event.attemptCount >= maxAttempts;
    const [updated] = await tx.update(triggerOutboxTable).set({
      status: terminal ? "quarantined" : "pending",
      availableAt: terminal ? now : new Date(now.getTime() + retryDelayMs(event.attemptCount)),
      lastError: message,
      quarantinedAt: terminal ? now : null,
      updatedAt: now,
      leaseToken: null,
      leaseExpiresAt: null,
    }).where(and(
      eq(triggerOutboxTable.id, event.eventId),
      eq(triggerOutboxTable.status, "claimed"),
      eq(triggerOutboxTable.leaseToken, leaseToken),
      gt(triggerOutboxTable.leaseExpiresAt, now),
    )).returning();
    if (!updated) return;
    logger.error({
      eventId: event.eventId,
      tenantId: event.tenantId,
      ownerUserId: event.ownerUserId,
      attempt: event.attemptCount,
      status: updated.status,
      error: message,
    }, terminal ? "trigger outbox event quarantined" : "trigger outbox event scheduled for retry");
  });
}

export type TriggerOutboxDispatcherTickResult = {
  enabled: boolean;
  inspected: number;
  processed: number;
  coalesced: number;
  retried: number;
  quarantined: number;
};

export class TriggerOutboxDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private readonly pollMs: number;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => Date;

  constructor(options: {
    pollMs?: number;
    leaseMs?: number;
    maxAttempts?: number;
    now?: () => Date;
  } = {}) {
    this.pollMs = Math.max(1_000, Math.floor(options.pollMs ?? Number(process.env.TRIGGER_OUTBOX_POLL_MS ?? 5_000)));
    this.leaseMs = Math.max(10_000, Math.floor(options.leaseMs ?? Number(process.env.TRIGGER_OUTBOX_LEASE_MS ?? 30_000)));
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? Number(process.env.TRIGGER_OUTBOX_MAX_ATTEMPTS ?? 3)));
    this.now = options.now ?? (() => new Date());
  }

  async tick(now = this.now(), limit = 20): Promise<TriggerOutboxDispatcherTickResult> {
    const empty = { enabled: false, inspected: 0, processed: 0, coalesced: 0, retried: 0, quarantined: 0 };
    if (!featureFlags.agentWork()) return empty;
    const result: TriggerOutboxDispatcherTickResult = { ...empty, enabled: true };
    for (let index = 0; index < Math.max(1, limit); index += 1) {
      const event = await claimNextTriggerOutbox({
        now,
        leaseMs: this.leaseMs,
        maxAttempts: this.maxAttempts,
      });
      if (!event) break;
      result.inspected += 1;
      try {
        const outcome = await processClaimedEvent(event, now);
        if (outcome === "coalesced") result.coalesced += 1;
        else result.processed += 1;
      } catch (error) {
        await failClaimedEvent(event, error, now, this.maxAttempts);
        if (event.attemptCount >= this.maxAttempts) result.quarantined += 1;
        else result.retried += 1;
      }
    }
    return result;
  }

  start(): void {
    if (this.timer || !featureFlags.agentWork()) return;
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

export const triggerOutboxDispatcher = new TriggerOutboxDispatcher();
