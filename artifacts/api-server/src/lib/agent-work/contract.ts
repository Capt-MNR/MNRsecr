import { createHash } from "node:crypto";
import type { AgentWorkRunStatus, AgentWorkStatus } from "./types";

const transitions: Record<AgentWorkStatus, readonly AgentWorkStatus[]> = {
  draft: ["active", "cancelled"],
  active: ["paused", "waiting", "needs_review", "completed", "failed", "cancelled"],
  paused: ["active", "cancelled"],
  waiting: ["active", "paused", "needs_review", "cancelled"],
  needs_review: ["active", "paused", "completed", "cancelled"],
  completed: [],
  failed: ["active", "cancelled"],
  cancelled: [],
};

const terminalRunStates = new Set<AgentWorkRunStatus>([
  "verified",
  "unchanged",
  "failed",
  "uncertain",
  "needs_review",
]);

export type EvidenceComparison = {
  state: Extract<AgentWorkRunStatus, "verified" | "unchanged" | "uncertain" | "needs_review">;
  previousHash: string | null;
  currentHash: string | null;
  reason: string;
};

export function canTransitionWork(
  from: AgentWorkStatus,
  to: AgentWorkStatus,
): boolean {
  return transitions[from].includes(to);
}

export function transitionWork(
  from: AgentWorkStatus,
  to: AgentWorkStatus,
): AgentWorkStatus {
  if (!canTransitionWork(from, to)) {
    throw new Error(`INVALID_WORK_TRANSITION:${from}:${to}`);
  }
  return to;
}

export function isTerminalRunStatus(status: AgentWorkRunStatus): boolean {
  return terminalRunStates.has(status);
}

export function createRunIdempotencyKey(input: {
  tenantId: string;
  ownerUserId: string;
  workId: string;
  runId: string;
  attempt: number;
  actionKind: string;
  actionVersion: string;
}): string {
  const material = [
    input.tenantId,
    input.ownerUserId,
    input.workId,
    input.runId,
    String(input.attempt),
    input.actionKind,
    input.actionVersion,
  ].join(":");
  return createHash("sha256").update(material).digest("hex");
}

export function leaseExpiry(now: Date, leaseMs: number): Date {
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error("INVALID_LEASE_DURATION");
  }
  return new Date(now.getTime() + Math.floor(leaseMs));
}

export function isLeaseExpired(now: Date, leaseExpiresAt: Date | null): boolean {
  return leaseExpiresAt === null || leaseExpiresAt.getTime() <= now.getTime();
}

function safeScalar(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

/**
 * Evidence is deliberately allowlisted and bounded. Raw provider responses,
 * authorization headers, and arbitrary nested source payloads do not cross
 * this boundary.
 */
export function redactEvidenceSnapshot(
  input: Record<string, unknown>,
  maxFields = 32,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => !/(authorization|cookie|token|secret|password|api[-_]?key)/iu.test(key))
      .slice(0, Math.max(1, Math.floor(maxFields)))
      .map(([key, value]) => [key, safeScalar(value)]),
  );
}

export function compareReadOnlyEvidence(input: {
  previousHash?: string | null;
  currentHash?: string | null;
  conditionMet: boolean;
  comparisonKnown: boolean;
}): EvidenceComparison {
  const previousHash = input.previousHash ?? null;
  const currentHash = input.currentHash ?? null;
  if (!input.comparisonKnown || currentHash === null) {
    return {
      state: "uncertain",
      previousHash,
      currentHash,
      reason: "comparison_not_verified",
    };
  }
  if (previousHash !== null && previousHash === currentHash) {
    return {
      state: "unchanged",
      previousHash,
      currentHash,
      reason: "source_unchanged",
    };
  }
  return {
    state: input.conditionMet ? "verified" : "needs_review",
    previousHash,
    currentHash,
    reason: input.conditionMet ? "condition_verified" : "change_requires_review",
  };
}