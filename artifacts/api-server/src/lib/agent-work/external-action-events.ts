import type { StorageAdapter, AgentWorkIdentity } from "./types";
import { sanitizeExternalActionEvidence } from "./external-action";

export async function appendExternalActionEvent(input: {
  storage: StorageAdapter;
  identity: AgentWorkIdentity;
  workId: string;
  runId: string;
  approvalOperationId: string;
  actionId: string;
  stepId?: string;
  eventType: string;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  const safeMetadata = sanitizeExternalActionEvidence({
    ...(input.metadata ?? {}),
    approvalOperationId: input.approvalOperationId,
    actionId: input.actionId,
    ...(input.stepId ? { stepId: input.stepId } : {}),
  });
  return input.storage.addEvent({
    identity: input.identity,
    workId: input.workId,
    runId: input.runId,
    eventType: input.eventType,
    actorType: "system",
    summary: input.summary.slice(0, 300),
    metadata: safeMetadata,
    dedupeKey: `external-action:${input.approvalOperationId}:${input.stepId ?? input.actionId}:${input.eventType}`,
  });
}