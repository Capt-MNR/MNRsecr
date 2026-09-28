import { createHash } from "node:crypto";
import type { ExternalActionIdentity } from "./external-action";
import { hashExternalActionPayload } from "./external-action";

export function createExternalActionStepId(input: {
  tenantId: string;
  ownerUserId: string;
  workId: string;
  runId: string;
  actionId: string;
  stepKey: string;
  actionVersion: string;
}): string {
  const material = [
    input.tenantId,
    input.ownerUserId,
    input.workId,
    input.runId,
    input.actionId,
    input.stepKey,
    input.actionVersion,
  ].join(":");
  return `step_${createHash("sha256").update(material).digest("hex").slice(0, 48)}`;
}

export function createExternalActionIdempotencyKey(input: {
  tenantId: string;
  ownerUserId: string;
  workId: string;
  runId: string;
  stepId: string;
}): string {
  const material = [
    input.tenantId,
    input.ownerUserId,
    input.workId,
    input.runId,
    input.stepId,
  ].join(":");
  return `agent-action:${createHash("sha256").update(material).digest("hex")}`;
}

export function createExternalActionIdentity(input: {
  tenantId: string;
  ownerUserId: string;
  workId: string;
  runId: string;
  approvalOperationId: string;
  actionId: string;
  stepKey: string;
  actionVersion: string;
}): ExternalActionIdentity {
  const stepId = createExternalActionStepId(input);
  return {
    actionId: input.actionId,
    stepId,
    workId: input.workId,
    runId: input.runId,
    approvalOperationId: input.approvalOperationId,
    idempotencyKey: createExternalActionIdempotencyKey({
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      workId: input.workId,
      runId: input.runId,
      stepId,
    }),
  };
}

export function hashExternalActionValue(value: unknown): string {
  return hashExternalActionPayload(value);
}