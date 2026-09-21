import { logger } from "../logger";
import { dispatchMobilePush } from "../mobile-push";
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

  async storeEvidenceSnapshot(_input: EvidenceSnapshotInput): Promise<EvidenceSnapshotReference> {
    throw new Error("AGENT_WORK_STORAGE_NOT_CONFIGURED");
  }
}

export function createDevelopmentAdapters(): AgentWorkAdapters {
  return {
    scheduler: new DevelopmentSchedulerAdapter(),
    identity: new EnvironmentIdentityAdapter(),
    notification: new DevelopmentNotificationAdapter(),
    storage: new StubStorageAdapter(),
  };
}