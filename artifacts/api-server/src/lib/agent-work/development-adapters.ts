import { logger } from "../logger";
import { dispatchMobilePush } from "../mobile-push";
import { PostgresAgentWorkStorageAdapter } from "./postgres-storage";
import type {
  AgentWorkIdentity,
  AgentWorkAdapters,
  BackgroundIdentityRequest,
  EvidenceSnapshotInput,
  EvidenceSnapshotReference,
  IdentityRequest,
  NotificationInput,
} from "./types";
import type {
  IdentityAdapter,
  NotificationAdapter,
  SchedulerAdapter,
  StorageAdapter,
} from "./types";

const developmentIdentityEnabled = (): boolean =>
  process.env.NODE_ENV !== "production"
  && ["1", "true", "yes", "on"].includes(
    (process.env.AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY ?? "false").trim().toLowerCase(),
  );

export class DevelopmentSchedulerAdapter implements SchedulerAdapter {
  readonly driver = "development" as const;

  async schedule(): Promise<{ scheduled: false; driver: "development"; reason: string }> {
    return {
      scheduled: false,
      driver: this.driver,
      reason: "scheduler_disabled_until_the_run_contract_is_enabled",
    };
  }

  async cancel(): Promise<void> {
    return undefined;
  }
}

export class StubSchedulerAdapter implements SchedulerAdapter {
  readonly driver = "stub" as const;

  async schedule(): Promise<{ scheduled: false; driver: "stub"; reason: string }> {
    return {
      scheduled: false,
      driver: this.driver,
      reason: "scheduler_driver_not_configured",
    };
  }

  async cancel(): Promise<void> {
    return undefined;
  }
}

export class EnvironmentIdentityAdapter implements IdentityAdapter {
  readonly driver = "development" as const;

  resolveRequest(input: IdentityRequest): AgentWorkIdentity | null {
    if (!developmentIdentityEnabled() || input.authorization !== "Bearer dev-user") return null;
    const tenantId = input.tenantId ?? process.env.SECRETARY_TENANT_ID ?? "development";
    const userId = input.userId ?? process.env.SECRETARY_USER_ID ?? "dev-user";
    if (!tenantId.trim() || !userId.trim()) return null;
    return { tenantId, userId };
  }

  resolveBackground(input: BackgroundIdentityRequest): AgentWorkIdentity | null {
    if (!developmentIdentityEnabled()) return null;
    if (!input.tenantId.trim() || !input.userId.trim()) return null;
    return { tenantId: input.tenantId, userId: input.userId };
  }
}

/**
 * Background identities are supplied by durable agent_works rows, not by a
 * scheduler header or environment variable. Request authentication remains a
 * separate application boundary and is intentionally not guessed here.
 */
export class PostgresBackgroundIdentityAdapter implements IdentityAdapter {
  readonly driver = "postgres" as const;

  resolveRequest(): AgentWorkIdentity | null {
    return null;
  }

  resolveBackground(input: BackgroundIdentityRequest): AgentWorkIdentity | null {
    if (input.actor !== "scheduler" && input.actor !== "recovery") return null;
    const validPart = (value: string): boolean =>
      value.length > 0
      && value.length <= 256
      && !/[\u0000-\u001F\u007F]/u.test(value);
    if (!validPart(input.tenantId) || !validPart(input.userId)) return null;
    return { tenantId: input.tenantId, userId: input.userId };
  }
}

export class StubIdentityAdapter implements IdentityAdapter {
  readonly driver = "stub" as const;

  resolveRequest(): AgentWorkIdentity | null {
    return null;
  }

  resolveBackground(): AgentWorkIdentity | null {
    return null;
  }
}

export class DevelopmentNotificationAdapter implements NotificationAdapter {
  readonly driver = "development" as const;

  async notify(input: NotificationInput) {
    logger.info({
      eventId: input.eventId,
      tenantId: input.identity.tenantId,
      ownerUserId: input.identity.userId,
      dedupeKey: input.dedupeKey,
    }, "agent work notification queued in development adapter");
    return {
      status: "accepted" as const,
      driver: this.driver,
      reason: "development_delivery",
    };
  }
}

export class ExpoNotificationAdapter implements NotificationAdapter {
  readonly driver = "expo" as const;

  async notify(input: NotificationInput) {
    try {
      await dispatchMobilePush(input.identity, {
        title: input.title,
        body: input.body,
        data: input.data,
        dedupeKey: input.dedupeKey,
        sourceEventId: input.eventId,
        workId: typeof input.data.workId === "string" ? input.data.workId : null,
        runId: typeof input.data.runId === "string" ? input.data.runId : null,
        operationId: typeof input.data.operationId === "string" ? input.data.operationId : null,
      });
      return { status: "accepted" as const, driver: this.driver };
    } catch (error) {
      return {
        status: "failed" as const,
        driver: this.driver,
        reason: error instanceof Error ? error.message : "NOTIFICATION_DELIVERY_FAILED",
      };
    }
  }
}

export class StubStorageAdapter implements StorageAdapter {
  readonly driver = "stub" as const;

  createWork(): Promise<never> {
    return Promise.reject(new Error("AGENT_WORK_STORAGE_NOT_CONFIGURED"));
  }

  getWork(): Promise<never> {
    return Promise.reject(new Error("AGENT_WORK_STORAGE_NOT_CONFIGURED"));
  }

  listWorks(): Promise<never> {
    return Promise.reject(new Error("AGENT_WORK_STORAGE_NOT_CONFIGURED"));
  }

  listDueWorks(): Promise<never> {
    return Promise.reject(new Error("AGENT_WORK_STORAGE_NOT_CONFIGURED"));
  }

  listWaitingWorks(): Promise<never> {
    return Promise.reject(new Error("AGENT_WORK_STORAGE_NOT_CONFIGURED"));
  }

  changeWorkStatus(): Promise<never> {
    return Promise.reject(new Error("AGENT_WORK_STORAGE_NOT_CONFIGURED"));
  }

  claimRun(): Promise<never> {
    return Promise.reject(new Error("AGENT_WORK_STORAGE_NOT_CONFIGURED"));
  }

  getRun(): Promise<never> {
    return Promise.reject(new Error("AGENT_WORK_STORAGE_NOT_CONFIGURED"));
  }

  listRuns(): Promise<never> {
    return Promise.reject(new Error("AGENT_WORK_STORAGE_NOT_CONFIGURED"));
  }

  completeRun(): Promise<never> {
    return Promise.reject(new Error("AGENT_WORK_STORAGE_NOT_CONFIGURED"));
  }

  addEvent(): Promise<never> {
    return Promise.reject(new Error("AGENT_WORK_STORAGE_NOT_CONFIGURED"));
  }

  listEvents(): Promise<never> {
    return Promise.reject(new Error("AGENT_WORK_STORAGE_NOT_CONFIGURED"));
  }

  listEvidence(): Promise<never> {
    return Promise.reject(new Error("AGENT_WORK_STORAGE_NOT_CONFIGURED"));
  }

  async storeEvidenceSnapshot(_input: EvidenceSnapshotInput): Promise<EvidenceSnapshotReference> {
    throw new Error("AGENT_WORK_STORAGE_NOT_CONFIGURED");
  }
}

export function createDevelopmentAdapters(): AgentWorkAdapters {
  return {
    scheduler: new DevelopmentSchedulerAdapter(),
    identity: new EnvironmentIdentityAdapter(),
    notification: new DevelopmentNotificationAdapter(),
    storage: new PostgresAgentWorkStorageAdapter(),
  };
}