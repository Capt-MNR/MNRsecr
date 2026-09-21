import type { AgentWorkAdapters, AgentWorkDriver } from "./types";
import {
  createDevelopmentAdapters,
  DevelopmentSchedulerAdapter,
  EnvironmentIdentityAdapter,
  ExpoNotificationAdapter,
  PostgresBackgroundIdentityAdapter,
  StubIdentityAdapter,
  StubSchedulerAdapter,
  StubStorageAdapter,
} from "./development-adapters";
import { PostgresAgentWorkStorageAdapter } from "./postgres-storage";

function driverFromEnvironment(name: string, fallback: AgentWorkDriver): AgentWorkDriver {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === "development" || value === "postgres" || value === "replit" || value === "expo" || value === "stub") {
    return value;
  }
  return fallback;
}

/**
 * The factory is the only default wiring point. Tests and worker bootstrap
 * code can inject a complete adapter set without importing provider-specific
 * implementations.
 */
export function createAgentWorkAdapters(overrides: Partial<AgentWorkAdapters> = {}): AgentWorkAdapters {
  const defaults = createDevelopmentAdapters();
  const scheduler = overrides.scheduler ?? (() => {
    const schedulerDriver = driverFromEnvironment(
      "AGENT_WORK_SCHEDULER_DRIVER",
      defaults.scheduler.driver,
    );
    if (schedulerDriver === "stub") return new StubSchedulerAdapter();
    if (schedulerDriver === "development") return new DevelopmentSchedulerAdapter();
    throw new Error(`AGENT_WORK_SCHEDULER_DRIVER_UNSUPPORTED:${schedulerDriver}`);
  })();
  const identity = overrides.identity ?? (() => {
    const defaultIdentityDriver: AgentWorkDriver =
      process.env.NODE_ENV === "production" ? "postgres" : defaults.identity.driver;
    const identityDriver = driverFromEnvironment(
      "AGENT_WORK_IDENTITY_DRIVER",
      defaultIdentityDriver,
    );
    if (identityDriver === "stub") return new StubIdentityAdapter();
    if (identityDriver === "development") return new EnvironmentIdentityAdapter();
    if (identityDriver === "postgres") return new PostgresBackgroundIdentityAdapter();
    throw new Error(`AGENT_WORK_IDENTITY_DRIVER_UNSUPPORTED:${identityDriver}`);
  })();
  const notification = overrides.notification ?? (() => {
    const notificationDriver = driverFromEnvironment(
      "AGENT_WORK_NOTIFICATION_DRIVER",
      defaults.notification.driver,
    );
    if (notificationDriver === "expo") return new ExpoNotificationAdapter();
    if (notificationDriver === "development") return defaults.notification;
    throw new Error(`AGENT_WORK_NOTIFICATION_DRIVER_UNSUPPORTED:${notificationDriver}`);
  })();
  const storage = overrides.storage ?? (() => {
    const storageDriver = driverFromEnvironment("AGENT_WORK_STORAGE_DRIVER", defaults.storage.driver);
    if (storageDriver === "stub") return new StubStorageAdapter();
    if (storageDriver === "postgres") return new PostgresAgentWorkStorageAdapter();
    throw new Error(`AGENT_WORK_STORAGE_DRIVER_UNSUPPORTED:${storageDriver}`);
  })();
  return {
    ...defaults,
    ...overrides,
    scheduler,
    identity,
    notification,
    storage,
  };
}

export const agentWorkAdapters = createAgentWorkAdapters();