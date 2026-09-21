import { randomUUID } from "node:crypto";
import { featureFlags } from "../feature-flags";
import { agentWorkAdapters } from "./factory";
import type {
  AgentWorkAdapters,
  AgentWorkRecord,
  AgentWorkRunRecord,
  AgentWorkStatus,
  CreateAgentWorkInput,
  AgentWorkEventRecord,
  AgentWorkEvidenceRecord,
} from "./types";

export type AgentWorkDetails = {
  work: AgentWorkRecord;
  runs: AgentWorkRunRecord[];
  events: AgentWorkEventRecord[];
  evidence: AgentWorkEvidenceRecord[];
};

function assertEnabled(): void {
  if (!featureFlags.agentWork()) {
    throw new Error("AGENT_WORK_DISABLED");
  }
}

export class AgentWorkRuntime {
  constructor(private readonly adapters: AgentWorkAdapters) {}

  async createWork(input: CreateAgentWorkInput): Promise<AgentWorkRecord> {
    assertEnabled();
    return this.adapters.storage.createWork(input);
  }

  async listWorks(input: Parameters<AgentWorkAdapters["storage"]["listWorks"]>[0]) {
    assertEnabled();
    return this.adapters.storage.listWorks(input);
  }

  async getDetails(identity: CreateAgentWorkInput["identity"], workId: string): Promise<AgentWorkDetails | null> {
    assertEnabled();
    const work = await this.adapters.storage.getWork(identity, workId);
    if (!work) return null;
    const [runs, events, evidence] = await Promise.all([
      this.adapters.storage.listRuns(identity, workId),
      this.adapters.storage.listEvents(identity, workId),
      this.adapters.storage.listEvidence(identity, workId),
    ]);
    return { work, runs, events, evidence };
  }

  async changeStatus(input: {
    identity: CreateAgentWorkInput["identity"];
    workId: string;
    from: AgentWorkStatus;
    to: AgentWorkStatus;
    reason?: string;
  }): Promise<AgentWorkRecord> {
    assertEnabled();
    return this.adapters.storage.changeWorkStatus({
      ...input,
      actorType: "user",
      actorId: input.identity.userId,
    });
  }

  async claimRun(input: {
    identity: CreateAgentWorkInput["identity"];
    workId: string;
    now?: Date;
    leaseMs?: number;
  }): Promise<AgentWorkRunRecord | null> {
    assertEnabled();
    const now = input.now ?? new Date();
    const runId = randomUUID();
    return this.adapters.storage.claimRun({
      identity: input.identity,
      workId: input.workId,
      now,
      leaseMs: input.leaseMs ?? 5 * 60 * 1000,
      idempotencyKey: `${input.identity.tenantId}:${input.identity.userId}:${input.workId}:${runId}`,
    });
  }

  async completeRun(input: {
    identity: CreateAgentWorkInput["identity"];
    run: AgentWorkRunRecord;
    status: AgentWorkRunRecord["status"];
    verification?: Record<string, unknown> | null;
    error?: string | null;
  }): Promise<AgentWorkRunRecord> {
    assertEnabled();
    if (!input.run.leaseToken) throw new Error("AGENT_WORK_RUN_LEASE_MISSING");
    return this.adapters.storage.completeRun({
      identity: input.identity,
      runId: input.run.id,
      leaseToken: input.run.leaseToken,
      status: input.status,
      verification: input.verification,
      error: input.error,
      completedAt: new Date(),
    });
  }
}

export const agentWorkRuntime = new AgentWorkRuntime(agentWorkAdapters);