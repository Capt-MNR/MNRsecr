export type AgentWorkDriver = "development" | "postgres" | "replit" | "expo" | "stub";

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

export type AgentWorkKind =
  | "monitor"
  | "reminder"
  | "recurring_task"
  | "external_action"
  | "research"
  | "workflow";

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
  expiresAt?: Date | null;
};

export type EvidenceSnapshotReference = {
  reference: string;
  stored: boolean;
  driver: AgentWorkDriver;
};

export type AgentWorkRecord = {
  id: string;
  identity: AgentWorkIdentity;
  kind: AgentWorkKind;
  title: string;
  description: string | null;
  status: AgentWorkStatus;
  source: Record<string, unknown>;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  schedule: Record<string, unknown>;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastRunStatus: AgentWorkRunStatus | null;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentWorkRunRecord = {
  id: string;
  workId: string;
  identity: AgentWorkIdentity;
  attempt: number;
  status: AgentWorkRunStatus;
  idempotencyKey: string;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  verification: Record<string, unknown> | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentWorkEventRecord = {
  id: string;
  workId: string;
  runId: string | null;
  eventType: string;
  actorType: string;
  actorId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  dedupeKey: string | null;
  occurredAt: Date;
  createdAt: Date;
};

export type AgentWorkEvidenceRecord = {
  id: string;
  workId: string;
  runId: string;
  snapshotHash: string;
  snapshot: Record<string, unknown>;
  retentionClass: "standard" | "sensitive";
  expiresAt: Date | null;
  createdAt: Date;
};

export type CreateAgentWorkInput = {
  identity: AgentWorkIdentity;
  kind: AgentWorkKind;
  title: string;
  description?: string | null;
  source?: Record<string, unknown>;
  condition?: Record<string, unknown>;
  action?: Record<string, unknown>;
  schedule?: Record<string, unknown>;
  nextRunAt?: Date | null;
};

export type AgentWorkStatusChange = {
  identity: AgentWorkIdentity;
  workId: string;
  from: AgentWorkStatus;
  to: AgentWorkStatus;
  actorType: "user" | "agent" | "system";
  actorId?: string | null;
  reason?: string;
};

export type ClaimAgentWorkRunInput = {
  identity: AgentWorkIdentity;
  workId: string;
  now: Date;
  leaseMs: number;
  idempotencyKey: string;
};

export type CompleteAgentWorkRunInput = {
  identity: AgentWorkIdentity;
  runId: string;
  status: AgentWorkRunStatus;
  leaseToken: string;
  verification?: Record<string, unknown> | null;
  error?: string | null;
  completedAt: Date;
  nextRunAt?: Date | null;
  workStatus?: AgentWorkStatus;
};

export type CreateAgentWorkEventInput = {
  identity: AgentWorkIdentity;
  workId: string;
  runId?: string | null;
  eventType: string;
  actorType?: string;
  actorId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string | null;
};

export type ListAgentWorksInput = {
  identity: AgentWorkIdentity;
  status?: AgentWorkStatus;
  limit?: number;
};

export type DueAgentWorkRecord = {
  identity: AgentWorkIdentity;
  workId: string;
  nextRunAt: Date | null;
};

export interface StorageAdapter {
  readonly driver: AgentWorkDriver;
  createWork(input: CreateAgentWorkInput): Promise<AgentWorkRecord>;
  getWork(identity: AgentWorkIdentity, workId: string): Promise<AgentWorkRecord | null>;
  listWorks(input: ListAgentWorksInput): Promise<AgentWorkRecord[]>;
  listDueWorks(input: { now: Date; limit?: number }): Promise<DueAgentWorkRecord[]>;
  changeWorkStatus(input: AgentWorkStatusChange): Promise<AgentWorkRecord>;
  claimRun(input: ClaimAgentWorkRunInput): Promise<AgentWorkRunRecord | null>;
  getRun(identity: AgentWorkIdentity, runId: string): Promise<AgentWorkRunRecord | null>;
  listRuns(identity: AgentWorkIdentity, workId: string, limit?: number): Promise<AgentWorkRunRecord[]>;
  completeRun(input: CompleteAgentWorkRunInput): Promise<AgentWorkRunRecord>;
  addEvent(input: CreateAgentWorkEventInput): Promise<AgentWorkEventRecord>;
  listEvents(identity: AgentWorkIdentity, workId: string, limit?: number): Promise<AgentWorkEventRecord[]>;
  listEvidence(identity: AgentWorkIdentity, workId: string, limit?: number): Promise<AgentWorkEvidenceRecord[]>;
  storeEvidenceSnapshot(input: EvidenceSnapshotInput): Promise<EvidenceSnapshotReference>;
}

export type AgentWorkAdapters = {
  scheduler: SchedulerAdapter;
  identity: IdentityAdapter;
  notification: NotificationAdapter;
  storage: StorageAdapter;
};