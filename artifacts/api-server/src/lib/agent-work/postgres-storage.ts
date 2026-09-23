import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  agentWorkEvidenceTable,
  agentWorkEventsTable,
  agentWorkRunsTable,
  agentWorksTable,
  db,
} from "@workspace/db";
import { enqueueMobilePushOutbox } from "../mobile-push";
import { isLeaseExpired, redactEvidenceSnapshot, transitionWork } from "./contract";
import type {
  AgentWorkEventRecord,
  AgentWorkEvidenceRecord,
  AgentWorkIdentity,
  AgentWorkKind,
  AgentWorkRecord,
  AgentWorkRunRecord,
  AgentWorkRunStatus,
  AgentWorkStatus,
  AgentWorkDriver,
  ClaimAgentWorkRunInput,
  CompleteAgentWorkRunInput,
  CompleteAgentWorkRunWithNotificationInput,
  CreateAgentWorkEventInput,
  CreateAgentWorkInput,
  DueAgentWorkRecord,
  EvidenceSnapshotInput,
  EvidenceSnapshotReference,
  ListAgentWorksInput,
  StorageAdapter,
} from "./types";
import type { DbExecutor } from "../entity-graph";

const activeRunStatuses: AgentWorkRunStatus[] = ["claimed", "running", "verifying"];
const defaultLimit = 50;
const maxLimit = 100;

function boundedLimit(limit: number | undefined): number {
  return Math.min(maxLimit, Math.max(1, Math.floor(limit ?? defaultLimit)));
}

function mapWork(row: typeof agentWorksTable.$inferSelect): AgentWorkRecord {
  return {
    id: row.id,
    identity: { tenantId: row.tenantId, userId: row.ownerUserId },
    kind: row.kind as AgentWorkKind,
    title: row.title,
    description: row.description,
    status: row.status as AgentWorkStatus,
    source: row.source,
    condition: row.condition,
    action: row.action,
    schedule: row.schedule,
    dedupeKey: row.dedupeKey,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    lastRunStatus: row.lastRunStatus as AgentWorkRunStatus | null,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRun(row: typeof agentWorkRunsTable.$inferSelect): AgentWorkRunRecord {
  return {
    id: row.id,
    workId: row.workId,
    identity: { tenantId: row.tenantId, userId: row.ownerUserId },
    attempt: row.attempt,
    status: row.status as AgentWorkRunStatus,
    idempotencyKey: row.idempotencyKey,
    leaseToken: row.leaseToken,
    leaseExpiresAt: row.leaseExpiresAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    verification: row.verification,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapEvent(row: typeof agentWorkEventsTable.$inferSelect): AgentWorkEventRecord {
  return {
    id: row.id,
    workId: row.workId,
    runId: row.runId,
    eventType: row.eventType,
    actorType: row.actorType,
    actorId: row.actorId,
    summary: row.summary,
    metadata: row.metadata,
    dedupeKey: row.dedupeKey,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}

function mapEvidence(row: typeof agentWorkEvidenceTable.$inferSelect): AgentWorkEvidenceRecord {
  return {
    id: row.id,
    workId: row.workId,
    runId: row.runId,
    snapshotHash: row.snapshotHash,
    snapshot: row.snapshot,
    retentionClass: row.retentionClass as "standard" | "sensitive",
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

function ownerWhere(identity: AgentWorkIdentity, table: {
  tenantId: typeof agentWorksTable.tenantId;
  ownerUserId: typeof agentWorksTable.ownerUserId;
}) {
  return and(
    eq(table.tenantId, identity.tenantId),
    eq(table.ownerUserId, identity.userId),
  );
}

function stableHash(value: Record<string, unknown>): string {
  const serialized = JSON.stringify(
    Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
      result[key] = value[key];
      return result;
    }, {}),
  );
  return createHash("sha256").update(serialized).digest("hex");
}

export class PostgresAgentWorkStorageAdapter implements StorageAdapter {
  readonly driver: AgentWorkDriver = "postgres";

  async createWork(input: CreateAgentWorkInput): Promise<AgentWorkRecord> {
    const create = async (tx: DbExecutor): Promise<AgentWorkRecord> => {
      const [row] = await tx.insert(agentWorksTable).values({
        tenantId: input.identity.tenantId,
        ownerUserId: input.identity.userId,
        kind: input.kind,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? "draft",
        source: input.source ?? {},
        condition: input.condition ?? {},
        action: input.action ?? {},
        schedule: input.schedule ?? {},
        dedupeKey: input.dedupeKey ?? null,
        nextRunAt: input.nextRunAt ?? null,
      }).onConflictDoNothing({
        target: [
          agentWorksTable.tenantId,
          agentWorksTable.ownerUserId,
          agentWorksTable.dedupeKey,
        ],
      }).returning();
      if (!row && input.dedupeKey) {
        const [existing] = await tx.select().from(agentWorksTable).where(and(
          ownerWhere(input.identity, agentWorksTable),
          eq(agentWorksTable.dedupeKey, input.dedupeKey),
        )).for("update");
        if (existing) return mapWork(existing);
      }
      if (!row) throw new Error("AGENT_WORK_CREATE_FAILED");
      await tx.insert(agentWorkEventsTable).values({
        tenantId: input.identity.tenantId,
        ownerUserId: input.identity.userId,
        workId: row.id,
        eventType: "work_created",
        actorType: "user",
        actorId: input.identity.userId,
        summary: "تم إنشاء عمل جديد للوكيل.",
        metadata: { kind: input.kind },
      });
      return mapWork(row);
    };
    return input.transactionExecutor
      ? create(input.transactionExecutor)
      : db.transaction((tx) => create(tx));
  }

  async getWork(identity: AgentWorkIdentity, workId: string): Promise<AgentWorkRecord | null> {
    const [row] = await db.select().from(agentWorksTable).where(and(
      ownerWhere(identity, agentWorksTable),
      eq(agentWorksTable.id, workId),
    ));
    return row ? mapWork(row) : null;
  }

  async listWorks(input: ListAgentWorksInput): Promise<AgentWorkRecord[]> {
    const rows = await db.select().from(agentWorksTable).where(and(
      ownerWhere(input.identity, agentWorksTable),
      input.status ? eq(agentWorksTable.status, input.status) : undefined,
    )).orderBy(desc(agentWorksTable.updatedAt)).limit(boundedLimit(input.limit));
    return rows.map(mapWork);
  }

  async listDueWorks(input: { now: Date; limit?: number }): Promise<DueAgentWorkRecord[]> {
    const rows = await db.select({
      workId: agentWorksTable.id,
      tenantId: agentWorksTable.tenantId,
      ownerUserId: agentWorksTable.ownerUserId,
      nextRunAt: agentWorksTable.nextRunAt,
    }).from(agentWorksTable).where(and(
      eq(agentWorksTable.status, "active"),
      or(isNull(agentWorksTable.nextRunAt), lte(agentWorksTable.nextRunAt, input.now)),
    )).orderBy(
      sql`${agentWorksTable.nextRunAt} asc nulls first`,
      asc(agentWorksTable.updatedAt),
    ).limit(boundedLimit(input.limit));
    return rows.map((row) => ({
      identity: { tenantId: row.tenantId, userId: row.ownerUserId },
      workId: row.workId,
      nextRunAt: row.nextRunAt,
    }));
  }

  async listWaitingWorks(input: { limit?: number } = {}): Promise<DueAgentWorkRecord[]> {
    const rows = await db.select({
      workId: agentWorksTable.id,
      tenantId: agentWorksTable.tenantId,
      ownerUserId: agentWorksTable.ownerUserId,
      nextRunAt: agentWorksTable.nextRunAt,
    }).from(agentWorksTable).where(
      eq(agentWorksTable.status, "waiting"),
    ).orderBy(
      asc(agentWorksTable.updatedAt),
    ).limit(boundedLimit(input.limit));
    return rows.map((row) => ({
      identity: { tenantId: row.tenantId, userId: row.ownerUserId },
      workId: row.workId,
      nextRunAt: row.nextRunAt,
    }));
  }

  async changeWorkStatus(input: {
    identity: AgentWorkIdentity;
    workId: string;
    from: AgentWorkStatus;
    to: AgentWorkStatus;
    actorType: "user" | "agent" | "system";
    actorId?: string | null;
    reason?: string;
  }): Promise<AgentWorkRecord> {
    transitionWork(input.from, input.to);
    return db.transaction(async (tx) => {
      const [row] = await tx.update(agentWorksTable)
        .set({
          status: input.to,
          updatedAt: new Date(),
          rowVersion: sql`${agentWorksTable.rowVersion} + 1`,
        })
        .where(and(
          ownerWhere(input.identity, agentWorksTable),
          eq(agentWorksTable.id, input.workId),
          eq(agentWorksTable.status, input.from),
        ))
        .returning();
      if (!row) throw new Error("AGENT_WORK_STATUS_CONFLICT");
      await tx.insert(agentWorkEventsTable).values({
        tenantId: input.identity.tenantId,
        ownerUserId: input.identity.userId,
        workId: input.workId,
        eventType: "work_status_changed",
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        summary: input.reason ?? `تغيرت حالة العمل إلى ${input.to}.`,
        metadata: { from: input.from, to: input.to },
      });
      return mapWork(row);
    });
  }

  async claimRun(input: ClaimAgentWorkRunInput): Promise<AgentWorkRunRecord | null> {
    return db.transaction(async (tx) => {
      const [initialExisting] = await tx.select().from(agentWorkRunsTable).where(and(
        eq(agentWorkRunsTable.tenantId, input.identity.tenantId),
        eq(agentWorkRunsTable.ownerUserId, input.identity.userId),
        eq(agentWorkRunsTable.idempotencyKey, input.idempotencyKey),
      ));
      if (initialExisting && !activeRunStatuses.includes(initialExisting.status as AgentWorkRunStatus)) {
        return mapRun(initialExisting);
      }

      const [work] = await tx.select().from(agentWorksTable).where(and(
        ownerWhere(input.identity, agentWorksTable),
        eq(agentWorksTable.id, input.workId),
      )).for("update");
      if (!work || work.status !== "active") return null;
      if (work.nextRunAt && work.nextRunAt.getTime() > input.now.getTime()) return null;

      // Re-read after the Work lock. A concurrent worker may have inserted
      // the idempotent run while this transaction was waiting.
      const [existing] = await tx.select().from(agentWorkRunsTable).where(and(
        eq(agentWorkRunsTable.tenantId, input.identity.tenantId),
        eq(agentWorkRunsTable.ownerUserId, input.identity.userId),
        eq(agentWorkRunsTable.idempotencyKey, input.idempotencyKey),
      )).for("update");
      if (existing && !activeRunStatuses.includes(existing.status as AgentWorkRunStatus)) {
        return mapRun(existing);
      }

      const activeRuns = await tx.select().from(agentWorkRunsTable).where(and(
        eq(agentWorkRunsTable.tenantId, input.identity.tenantId),
        eq(agentWorkRunsTable.ownerUserId, input.identity.userId),
        eq(agentWorkRunsTable.workId, input.workId),
        inArray(agentWorkRunsTable.status, activeRunStatuses),
      )).for("update");

      const recoveredRuns: typeof activeRuns = [];
      for (const activeRun of activeRuns) {
        if (!isLeaseExpired(input.now, activeRun.leaseExpiresAt)) continue;
        const [recovered] = await tx.update(agentWorkRunsTable).set({
          status: "uncertain",
          verification: {
            kind: "lease_expired_recovery",
            safe: false,
            previousStatus: activeRun.status,
          },
          error: "AGENT_WORK_RUN_LEASE_EXPIRED_UNCERTAIN",
          completedAt: input.now,
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: input.now,
        }).where(and(
          eq(agentWorkRunsTable.tenantId, input.identity.tenantId),
          eq(agentWorkRunsTable.ownerUserId, input.identity.userId),
          eq(agentWorkRunsTable.id, activeRun.id),
          inArray(agentWorkRunsTable.status, activeRunStatuses),
          or(isNull(agentWorkRunsTable.leaseExpiresAt), lte(agentWorkRunsTable.leaseExpiresAt, input.now)),
        )).returning();
        if (!recovered) continue;
        recoveredRuns.push(recovered);
        await tx.update(agentWorksTable).set({
          status: "needs_review",
          lastRunAt: input.now,
          lastRunStatus: "uncertain",
          updatedAt: input.now,
          rowVersion: sql`${agentWorksTable.rowVersion} + 1`,
        }).where(and(
          ownerWhere(input.identity, agentWorksTable),
          eq(agentWorksTable.id, work.id),
          eq(agentWorksTable.status, "active"),
        ));
        await tx.insert(agentWorkEventsTable).values({
          tenantId: input.identity.tenantId,
          ownerUserId: input.identity.userId,
          workId: work.id,
          runId: recovered.id,
          eventType: "run_lease_expired",
          actorType: "recovery",
          summary: "انتهت مهلة تنفيذ العمل قبل معرفة نتيجته؛ أوقفته للمراجعة لمنع تكرار الأثر.",
          metadata: {
            status: "uncertain",
            safeToRetry: false,
            leaseExpiresAt: activeRun.leaseExpiresAt?.toISOString() ?? null,
          },
          dedupeKey: `agent-work-lease-expired:${recovered.id}`,
        }).onConflictDoNothing();
      }
      if (recoveredRuns.length > 0) return mapRun(recoveredRuns[0]);

      const activeRun = activeRuns[0];
      if (activeRun) return mapRun(activeRun);

      const [latest] = await tx.select({ attempt: agentWorkRunsTable.attempt })
        .from(agentWorkRunsTable)
        .where(and(
          eq(agentWorkRunsTable.tenantId, input.identity.tenantId),
          eq(agentWorkRunsTable.ownerUserId, input.identity.userId),
          eq(agentWorkRunsTable.workId, input.workId),
        ))
        .orderBy(desc(agentWorkRunsTable.attempt))
        .limit(1);
      const now = input.now;
      const leaseExpiresAt = new Date(now.getTime() + Math.floor(input.leaseMs));
      const [run] = await tx.insert(agentWorkRunsTable).values({
        tenantId: input.identity.tenantId,
        ownerUserId: input.identity.userId,
        workId: input.workId,
        attempt: (latest?.attempt ?? 0) + 1,
        status: "claimed",
        idempotencyKey: input.idempotencyKey,
        leaseToken: randomUUID(),
        leaseExpiresAt,
        startedAt: now,
      }).returning();
      if (!run) throw new Error("AGENT_WORK_RUN_CREATE_FAILED");
      await tx.update(agentWorksTable).set({
        lastRunAt: now,
        lastRunStatus: "claimed",
        updatedAt: now,
      }).where(eq(agentWorksTable.id, work.id));
      await tx.insert(agentWorkEventsTable).values({
        tenantId: input.identity.tenantId,
        ownerUserId: input.identity.userId,
        workId: input.workId,
        runId: run.id,
        eventType: "run_claimed",
        actorType: "system",
        summary: "بدأ الوكيل محاولة عمل جديدة.",
        metadata: { attempt: run.attempt, leaseExpiresAt: leaseExpiresAt.toISOString() },
      });
      return mapRun(run);
    });
  }

  async getRun(identity: AgentWorkIdentity, runId: string): Promise<AgentWorkRunRecord | null> {
    const [row] = await db.select().from(agentWorkRunsTable).where(and(
      eq(agentWorkRunsTable.tenantId, identity.tenantId),
      eq(agentWorkRunsTable.ownerUserId, identity.userId),
      eq(agentWorkRunsTable.id, runId),
    ));
    return row ? mapRun(row) : null;
  }

  async listRuns(identity: AgentWorkIdentity, workId: string, limit = defaultLimit): Promise<AgentWorkRunRecord[]> {
    const rows = await db.select().from(agentWorkRunsTable).where(and(
      eq(agentWorkRunsTable.tenantId, identity.tenantId),
      eq(agentWorkRunsTable.ownerUserId, identity.userId),
      eq(agentWorkRunsTable.workId, workId),
    )).orderBy(desc(agentWorkRunsTable.createdAt)).limit(boundedLimit(limit));
    return rows.map(mapRun);
  }

  async completeRun(input: CompleteAgentWorkRunInput): Promise<AgentWorkRunRecord> {
    return db.transaction(async (tx) => {
      // Recovery and completion use the same lock order (Work, then Run).
      // This makes an expired lease a real fence: an old worker cannot
      // complete after a recovery transaction has classified its run.
      const [identityRun] = await tx.select({ workId: agentWorkRunsTable.workId })
        .from(agentWorkRunsTable)
        .where(and(
          eq(agentWorkRunsTable.tenantId, input.identity.tenantId),
          eq(agentWorkRunsTable.ownerUserId, input.identity.userId),
          eq(agentWorkRunsTable.id, input.runId),
        ))
        .limit(1);
      if (!identityRun) throw new Error("AGENT_WORK_RUN_LEASE_CONFLICT");

      const [work] = await tx.select().from(agentWorksTable).where(and(
        ownerWhere(input.identity, agentWorksTable),
        eq(agentWorksTable.id, identityRun.workId),
      )).for("update");
      if (!work) throw new Error("AGENT_WORK_RUN_LEASE_CONFLICT");

      const [currentRun] = await tx.select().from(agentWorkRunsTable).where(and(
        eq(agentWorkRunsTable.tenantId, input.identity.tenantId),
        eq(agentWorkRunsTable.ownerUserId, input.identity.userId),
        eq(agentWorkRunsTable.id, input.runId),
      )).for("update");
      if (
        !currentRun
        || !activeRunStatuses.includes(currentRun.status as AgentWorkRunStatus)
        || currentRun.leaseToken !== input.leaseToken
        || isLeaseExpired(input.completedAt, currentRun.leaseExpiresAt)
      ) {
        throw new Error("AGENT_WORK_RUN_LEASE_CONFLICT");
      }

      const [run] = await tx.update(agentWorkRunsTable).set({
        status: input.status,
        verification: input.verification ?? null,
        error: input.error ?? null,
        completedAt: input.completedAt,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: input.completedAt,
      }).where(and(
        eq(agentWorkRunsTable.tenantId, input.identity.tenantId),
        eq(agentWorkRunsTable.ownerUserId, input.identity.userId),
        eq(agentWorkRunsTable.id, input.runId),
        eq(agentWorkRunsTable.leaseToken, input.leaseToken),
        inArray(agentWorkRunsTable.status, activeRunStatuses),
        gt(agentWorkRunsTable.leaseExpiresAt, input.completedAt),
      )).returning();
      if (!run) throw new Error("AGENT_WORK_RUN_LEASE_CONFLICT");
      await tx.update(agentWorksTable).set({
        lastRunAt: input.completedAt,
        lastRunStatus: input.status,
        ...(Object.prototype.hasOwnProperty.call(input, "nextRunAt")
          ? { nextRunAt: input.nextRunAt ?? null }
          : {}),
        ...(input.workStatus ? { status: input.workStatus } : {}),
        updatedAt: input.completedAt,
        rowVersion: sql`${agentWorksTable.rowVersion} + 1`,
      }).where(and(
        eq(agentWorksTable.tenantId, input.identity.tenantId),
        eq(agentWorksTable.ownerUserId, input.identity.userId),
        eq(agentWorksTable.id, run.workId),
      ));
      await tx.insert(agentWorkEventsTable).values({
        tenantId: input.identity.tenantId,
        ownerUserId: input.identity.userId,
        workId: run.workId,
        runId: run.id,
        eventType: "run_completed",
        actorType: "system",
        summary: `انتهت المحاولة بحالة ${input.status}.`,
        metadata: {
          status: input.status,
          ...(input.verification ? { verification: input.verification } : {}),
          ...(input.error ? { error: input.error } : {}),
        },
      });
      return mapRun(run);
    });
  }

  async completeRunWithNotification(
    input: CompleteAgentWorkRunWithNotificationInput,
  ): Promise<AgentWorkRunRecord> {
    return db.transaction(async (tx) => {
      const [identityRun] = await tx.select({ workId: agentWorkRunsTable.workId })
        .from(agentWorkRunsTable)
        .where(and(
          eq(agentWorkRunsTable.tenantId, input.identity.tenantId),
          eq(agentWorkRunsTable.ownerUserId, input.identity.userId),
          eq(agentWorkRunsTable.id, input.runId),
        ))
        .limit(1);
      if (!identityRun) throw new Error("AGENT_WORK_RUN_LEASE_CONFLICT");

      const [work] = await tx.select().from(agentWorksTable).where(and(
        ownerWhere(input.identity, agentWorksTable),
        eq(agentWorksTable.id, identityRun.workId),
      )).for("update");
      if (!work) throw new Error("AGENT_WORK_RUN_LEASE_CONFLICT");

      const [currentRun] = await tx.select().from(agentWorkRunsTable).where(and(
        eq(agentWorkRunsTable.tenantId, input.identity.tenantId),
        eq(agentWorkRunsTable.ownerUserId, input.identity.userId),
        eq(agentWorkRunsTable.id, input.runId),
      )).for("update");
      if (
        !currentRun
        || !activeRunStatuses.includes(currentRun.status as AgentWorkRunStatus)
        || currentRun.leaseToken !== input.leaseToken
        || isLeaseExpired(input.completedAt, currentRun.leaseExpiresAt)
      ) {
        throw new Error("AGENT_WORK_RUN_LEASE_CONFLICT");
      }

      await enqueueMobilePushOutbox(tx, input.identity, {
        title: input.notification.title,
        body: input.notification.body,
        data: input.notification.data,
        dedupeKey: input.notification.dedupeKey,
        workId: input.notification.workId,
        runId: input.notification.runId,
        sourceEventId: input.notification.eventId,
      });

      const [run] = await tx.update(agentWorkRunsTable).set({
        status: input.status,
        verification: input.verification ?? null,
        error: input.error ?? null,
        completedAt: input.completedAt,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: input.completedAt,
      }).where(and(
        eq(agentWorkRunsTable.tenantId, input.identity.tenantId),
        eq(agentWorkRunsTable.ownerUserId, input.identity.userId),
        eq(agentWorkRunsTable.id, input.runId),
        eq(agentWorkRunsTable.leaseToken, input.leaseToken),
        inArray(agentWorkRunsTable.status, activeRunStatuses),
        gt(agentWorkRunsTable.leaseExpiresAt, input.completedAt),
      )).returning();
      if (!run) throw new Error("AGENT_WORK_RUN_LEASE_CONFLICT");
      await tx.update(agentWorksTable).set({
        lastRunAt: input.completedAt,
        lastRunStatus: input.status,
        ...(Object.prototype.hasOwnProperty.call(input, "nextRunAt")
          ? { nextRunAt: input.nextRunAt ?? null }
          : {}),
        ...(input.workStatus ? { status: input.workStatus } : {}),
        updatedAt: input.completedAt,
        rowVersion: sql`${agentWorksTable.rowVersion} + 1`,
      }).where(and(
        eq(agentWorksTable.tenantId, input.identity.tenantId),
        eq(agentWorksTable.ownerUserId, input.identity.userId),
        eq(agentWorksTable.id, run.workId),
      ));
      await tx.insert(agentWorkEventsTable).values({
        tenantId: input.identity.tenantId,
        ownerUserId: input.identity.userId,
        workId: run.workId,
        runId: run.id,
        eventType: "run_completed",
        actorType: "system",
        summary: `انتهت المحاولة بحالة ${input.status}.`,
        metadata: {
          status: input.status,
          ...(input.verification ? { verification: input.verification } : {}),
          ...(input.error ? { error: input.error } : {}),
        },
      });
      return mapRun(run);
    });
  }

  async addEvent(input: CreateAgentWorkEventInput): Promise<AgentWorkEventRecord> {
    const [row] = await db.insert(agentWorkEventsTable).values({
      tenantId: input.identity.tenantId,
      ownerUserId: input.identity.userId,
      workId: input.workId,
      runId: input.runId ?? null,
      eventType: input.eventType,
      actorType: input.actorType ?? "agent",
      actorId: input.actorId ?? null,
      summary: input.summary,
      metadata: input.metadata ?? {},
      dedupeKey: input.dedupeKey ?? null,
    }).onConflictDoNothing().returning();
    if (row) return { ...mapEvent(row), created: true };
    const [existing] = await db.select().from(agentWorkEventsTable).where(and(
      eq(agentWorkEventsTable.tenantId, input.identity.tenantId),
      eq(agentWorkEventsTable.ownerUserId, input.identity.userId),
      eq(agentWorkEventsTable.dedupeKey, input.dedupeKey ?? ""),
    ));
    if (!existing) throw new Error("AGENT_WORK_EVENT_CREATE_FAILED");
    return { ...mapEvent(existing), created: false };
  }

  async listEvents(identity: AgentWorkIdentity, workId: string, limit = defaultLimit): Promise<AgentWorkEventRecord[]> {
    const rows = await db.select().from(agentWorkEventsTable).where(and(
      eq(agentWorkEventsTable.tenantId, identity.tenantId),
      eq(agentWorkEventsTable.ownerUserId, identity.userId),
      eq(agentWorkEventsTable.workId, workId),
    )).orderBy(desc(agentWorkEventsTable.occurredAt)).limit(boundedLimit(limit));
    return rows.map(mapEvent);
  }

  async listEvidence(identity: AgentWorkIdentity, workId: string, limit = defaultLimit): Promise<AgentWorkEvidenceRecord[]> {
    const rows = await db.select().from(agentWorkEvidenceTable).where(and(
      eq(agentWorkEvidenceTable.tenantId, identity.tenantId),
      eq(agentWorkEvidenceTable.ownerUserId, identity.userId),
      eq(agentWorkEvidenceTable.workId, workId),
    )).orderBy(desc(agentWorkEvidenceTable.createdAt)).limit(boundedLimit(limit));
    return rows.map(mapEvidence);
  }

  async storeEvidenceSnapshot(input: EvidenceSnapshotInput): Promise<EvidenceSnapshotReference> {
    const snapshot = redactEvidenceSnapshot(input.snapshot);
    const snapshotHash = stableHash(snapshot);
    const expiresAt = input.expiresAt
      ?? new Date(Date.now() + (input.retentionClass === "sensitive" ? 7 : 30) * 24 * 60 * 60 * 1000);
    const [row] = await db.insert(agentWorkEvidenceTable).values({
      tenantId: input.identity.tenantId,
      ownerUserId: input.identity.userId,
      workId: input.workId,
      runId: input.runId,
      snapshotHash,
      snapshot,
      retentionClass: input.retentionClass,
      expiresAt,
    }).onConflictDoNothing().returning();
    if (row) {
      return {
        reference: `agent-work-evidence:${row.id}`,
        stored: true,
        driver: this.driver,
      };
    }
    const [existing] = await db.select().from(agentWorkEvidenceTable).where(and(
      eq(agentWorkEvidenceTable.tenantId, input.identity.tenantId),
      eq(agentWorkEvidenceTable.ownerUserId, input.identity.userId),
      eq(agentWorkEvidenceTable.workId, input.workId),
      eq(agentWorkEvidenceTable.runId, input.runId),
      eq(agentWorkEvidenceTable.snapshotHash, snapshotHash),
    ));
    if (!existing) throw new Error("AGENT_WORK_EVIDENCE_CREATE_FAILED");
    return {
      reference: `agent-work-evidence:${existing.id}`,
      stored: false,
      driver: this.driver,
    };
  }
}