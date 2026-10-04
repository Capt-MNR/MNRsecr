import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  learningSignalEvaluationsTable,
  learningSignalReviewsTable,
} from "@workspace/db";
import type { Identity } from "./secretary";

export const LEARNING_EVALUATOR_VERSION = "candidate-integrity-v1";

const categories = new Set(["amount", "date_time", "person", "project", "intent", "general"]);
const dialects = new Set(["egyptian", "gulf", "levantine", "unknown"]);

export class LearningEvaluationError extends Error {
  constructor(
    readonly statusCode: 404 | 409,
    readonly code: "LEARNING_SIGNAL_NOT_FOUND" | "LEARNING_SIGNAL_NOT_APPROVED",
  ) {
    super(code);
    this.name = "LearningEvaluationError";
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function evaluateCandidate(
  review: typeof learningSignalReviewsTable.$inferSelect,
): Array<{ name: string; passed: boolean; reason: string | null }> {
  const payload = review.benchmarkPayload;
  const confidence = payload.confidence;
  const confidenceMatches = typeof confidence === "number"
    && Number.isFinite(confidence)
    && confidence >= 0
    && confidence <= 1
    && Math.round(confidence * 10_000) === review.confidenceBps;
  const textComplete = typeof payload.userMessage === "string"
    && payload.userMessage.trim().length > 0
    && typeof payload.assistantMessage === "string"
    && payload.assistantMessage.trim().length > 0;

  const checks = [
    {
      name: "approved_review",
      passed: review.status === "approved",
      reason: "The current review must be approved.",
    },
    {
      name: "candidate_identity",
      passed: payload.signalId === review.signalId
        && payload.conversationId === review.conversationId
        && (payload.turnId ?? null) === review.turnId,
      reason: "Candidate IDs must match the reviewed record.",
    },
    {
      name: "correction_text",
      passed: textComplete,
      reason: "The original correction and assistant response must both be present.",
    },
    {
      name: "action_context",
      passed: typeof payload.previousActionType === "string"
        && payload.previousActionType.trim().length > 0,
      reason: "The prior action type is required to interpret the correction.",
    },
    {
      name: "supported_labels",
      passed: categories.has(review.category)
        && typeof payload.dialect === "string"
        && dialects.has(payload.dialect),
      reason: "The category and dialect must use the reviewed vocabulary.",
    },
    {
      name: "confidence_integrity",
      passed: confidenceMatches,
      reason: "The confidence must be finite, bounded, and match the reviewed value.",
    },
    {
      name: "review_only_no_auto_apply",
      passed: payload.reviewOnly === true && payload.autoApply === false,
      reason: "A candidate must remain review-only and must not auto-apply.",
    },
  ];
  return checks.map((check) => ({
    name: check.name,
    passed: check.passed,
    reason: check.passed ? null : check.reason,
  }));
}

export function currentLearningEvaluationState(
  review: typeof learningSignalReviewsTable.$inferSelect | undefined,
  evaluation: typeof learningSignalEvaluationsTable.$inferSelect | undefined,
) {
  if (!review || review.status !== "approved") {
    return {
      evaluationStatus: "blocked" as const,
      promotionEligible: false,
      evaluatedAt: null,
      evaluationChecks: [],
    };
  }

  const isCurrent = evaluation
    && evaluation.reviewId === review.id
    && review.reviewedAt
    && evaluation.reviewedAt.getTime() === review.reviewedAt.getTime();
  if (!isCurrent || !evaluation) {
    return {
      evaluationStatus: "pending" as const,
      promotionEligible: false,
      evaluatedAt: null,
      evaluationChecks: [],
    };
  }

  return {
    evaluationStatus: evaluation.status === "passed" ? "passed" as const : "failed" as const,
    promotionEligible: evaluation.status === "passed",
    evaluatedAt: evaluation.evaluatedAt.toISOString(),
    evaluationChecks: evaluation.checks.map((check) => ({
      name: check.name,
      passed: check.passed,
      reason: check.reason ?? null,
    })),
  };
}

export async function latestLearningEvaluations(
  identity: Identity,
  reviews: Array<typeof learningSignalReviewsTable.$inferSelect>,
) {
  const reviewIds = reviews.map((review) => review.id);
  if (reviewIds.length === 0) return new Map<string, typeof learningSignalEvaluationsTable.$inferSelect>();
  const rows = await db.select().from(learningSignalEvaluationsTable).where(and(
    eq(learningSignalEvaluationsTable.tenantId, identity.tenantId),
    eq(learningSignalEvaluationsTable.ownerUserId, identity.userId),
    inArray(learningSignalEvaluationsTable.reviewId, reviewIds),
  )).orderBy(desc(learningSignalEvaluationsTable.evaluatedAt));
  const latest = new Map<string, typeof learningSignalEvaluationsTable.$inferSelect>();
  for (const row of rows) {
    if (!latest.has(row.reviewId)) latest.set(row.reviewId, row);
  }
  return latest;
}

export async function evaluateLearningSignal(identity: Identity, signalId: string) {
  return db.transaction(async (tx) => {
    const [review] = await tx.select().from(learningSignalReviewsTable).where(and(
      eq(learningSignalReviewsTable.tenantId, identity.tenantId),
      eq(learningSignalReviewsTable.ownerUserId, identity.userId),
      eq(learningSignalReviewsTable.signalId, signalId),
    )).for("update");
    if (!review) throw new LearningEvaluationError(404, "LEARNING_SIGNAL_NOT_FOUND");
    if (review.status !== "approved" || !review.reviewedAt) {
      throw new LearningEvaluationError(409, "LEARNING_SIGNAL_NOT_APPROVED");
    }

    const checks = evaluateCandidate(review);
    const storedChecks = checks.map((check) => ({
      name: check.name,
      passed: check.passed,
      ...(check.reason ? { reason: check.reason } : {}),
    }));
    const status = checks.every((check) => check.passed) ? "passed" : "failed";
    const evaluatedAt = new Date();
    const candidateHash = createHash("sha256")
      .update(JSON.stringify(stableValue(review.benchmarkPayload)))
      .digest("hex");
    const [evaluation] = await tx.insert(learningSignalEvaluationsTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      reviewId: review.id,
      signalId,
      reviewedAt: review.reviewedAt,
      candidateHash,
      evaluatorVersion: LEARNING_EVALUATOR_VERSION,
      status,
      checks: storedChecks,
      evaluatedAt,
    }).returning();

    return {
      evaluationId: evaluation.id,
      signalId,
      status,
      evaluationScope: "candidate_integrity" as const,
      promotionEligible: status === "passed",
      evaluatorVersion: LEARNING_EVALUATOR_VERSION,
      evaluatedAt: evaluatedAt.toISOString(),
      checks,
    };
  });
}