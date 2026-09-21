export type AgentWorkDriver = "development" | "replit" | "expo" | "stub";

export type AgentWorkIdentity = {
  tenantId: string;
  userId: string;
};

export type AgentWorkStatus =
  | "draft"
  | "active"
  | "paused"
  | "waiting"
  | "needs_review"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentWorkRunStatus =
  | "queued"
  | "claimed"
  | "running"
  | "verifying"
  | "verified"
  | "unchanged"
  | "failed"
  | "uncertain"
  | "needs_review";

export type AgentWorkNotificationStatus = "queued" | "sent" | "accepted" | "failed";

export type AgentWorkScheduleInput = {
  workId: string;
  tenantId: string;
  ownerUserId: string;
  nextRunAt: Date;
  idempotencyKey: string;
};

export type AgentWorkScheduleResult = {
  scheduled: boolean;
  driver: AgentWorkDriver;
  reason: string;
};

export interface SchedulerAdapter {
  readonly driver: AgentWorkDriver;
  schedule(input: AgentWorkScheduleInput): Promise<AgentWorkScheduleResult>;
  cancel(input: { workId: string; tenantId: string; ownerUserId: string }): Promise<void>;
}

export type IdentityRequest = {
  authorization?: string | null;
  tenantId?: string | null;
  userId?: string | null;
};

export type BackgroundIdentityRequest = {
  tenantId: string;
  userId: string;
  actor: "scheduler" | "manual" | "recovery";
};

export interface IdentityAdapter {
  readonly driver: AgentWorkDriver;
  resolveRequest(input: IdentityRequest): AgentWorkIdentity | null;
  resolveBackground(input: BackgroundIdentityRequest): AgentWorkIdentity | null;
}

export type NotificationInput = {
  identity: AgentWorkIdentity;
  eventId: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  dedupeKey: string;
};

export type NotificationDelivery = {
  status: Extract<AgentWorkNotificationStatus, "accepted" | "failed">;
  driver: AgentWorkDriver;
  reason?: string;
};

export interface NotificationAdapter {
  readonly driver: AgentWorkDriver;
  notify(input: NotificationInput): Promise<NotificationDelivery>;
}

export type EvidenceSnapshotInput = {
  identity: AgentWorkIdentity;
  workId: string;
  runId: string;
  snapshot: Record<string, unknown>;
  retentionClass: "standard" | "sensitive";
};

export type EvidenceSnapshotReference = {
  reference: string;
  stored: boolean;
  driver: AgentWorkDriver;
};

/**
 * Storage is intentionally a stub in the first rollout. Agent Work must not
 * silently persist raw provider/source payloads until retention and redaction
 * rules are approved.
 */
export interface StorageAdapter {
  readonly driver: AgentWorkDriver;
  storeEvidenceSnapshot(input: EvidenceSnapshotInput): Promise<EvidenceSnapshotReference>;
}

export type AgentWorkAdapters = {
  scheduler: SchedulerAdapter;
  identity: IdentityAdapter;
  notification: NotificationAdapter;
  storage: StorageAdapter;
};