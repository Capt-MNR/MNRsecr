import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  expensesTable,
  learningSignalEvaluationsTable,
  learningSignalReviewsTable,
} from "@workspace/db";
import {
  currentLearningEvaluationState,
  evaluateLearningSignal,
  latestLearningEvaluations,
  LearningEvaluationError,
} from "../src/lib/learning-evaluation";

const tenantId = `learning-loop-${randomUUID()}`;
const otherTenantId = `learning-loop-other-${randomUUID()}`;
const ownerUserId = `owner-${randomUUID()}`;
const identity = { tenantId, userId: ownerUserId };
const otherIdentity = { tenantId: otherTenantId, userId: ownerUserId };
const signalIds = ["pending", "rejected", "context", "failed", "passed"]
  .map((label) => `${tenantId}:${label}`);

function payload(signalId: string, options: { assistantMessage?: string; autoApply?: boolean } = {}) {
  return {
    signalId,
    conversationId: `conversation-${signalId}`,
    turnId: `turn-${signalId}`,
    category: "amount",
    dialect: "egyptian",
    confidence: 0.95,
    userMessage: "لا، قصدي المبلغ ٥٠٠",
    assistantMessage: options.assistantMessage ?? "تم تسجيل التصحيح للمراجعة.",
    previousActionType: "record_expense",
    reviewOnly: true,
    autoApply: options.autoApply ?? false,
  };
}

async function addReview(
  signalId: string,
  status: string,
  benchmarkPayload: Record<string, unknown> = payload(signalId),
) {
  const reviewedAt = new Date();
  const [review] = await db.insert(learningSignalReviewsTable).values({
    tenantId,
    ownerUserId,
    signalId,
    conversationId: `conversation-${signalId}`,
    turnId: `turn-${signalId}`,
    category: "amount",
    confidenceBps: 9_500,
    status,
    benchmarkPayload,
    reviewedAt,
  }).returning();
  return review;
}

after(async () => {
  const tenants = [tenantId, otherTenantId];
  await db.delete(learningSignalEvaluationsTable).where(and(
    eq(learningSignalEvaluationsTable.ownerUserId, ownerUserId),
    inArray(learningSignalEvaluationsTable.tenantId, tenants),
  ));
  await db.delete(learningSignalReviewsTable).where(and(
    eq(learningSignalReviewsTable.ownerUserId, ownerUserId),
    inArray(learningSignalReviewsTable.tenantId, tenants),
  ));
});

test("reviewed corrections enter evaluation and only a current passing safety report becomes eligible", async () => {
  const pending = await addReview(signalIds[0], "approved");
  const rejected = await addReview(signalIds[1], "rejected");
  const needsContext = await addReview(signalIds[2], "needs_context");
  const failed = await addReview(signalIds[3], "approved", payload(signalIds[3], {
    assistantMessage: "",
  }));
  const passed = await addReview(signalIds[4], "approved");

  assert.equal(currentLearningEvaluationState(pending, undefined).evaluationStatus, "pending");
  assert.equal(currentLearningEvaluationState(pending, undefined).promotionEligible, false);
  assert.equal(currentLearningEvaluationState(rejected, undefined).evaluationStatus, "blocked");
  assert.equal(currentLearningEvaluationState(needsContext, undefined).evaluationStatus, "blocked");

  await assert.rejects(
    evaluateLearningSignal(identity, rejected.signalId),
    (error: unknown) => error instanceof LearningEvaluationError
      && error.statusCode === 409
      && error.code === "LEARNING_SIGNAL_NOT_APPROVED",
  );
  await assert.rejects(
    evaluateLearningSignal(identity, needsContext.signalId),
    (error: unknown) => error instanceof LearningEvaluationError && error.statusCode === 409,
  );
  await assert.rejects(
    evaluateLearningSignal(otherIdentity, passed.signalId),
    (error: unknown) => error instanceof LearningEvaluationError
      && error.statusCode === 404
      && error.code === "LEARNING_SIGNAL_NOT_FOUND",
  );

  const failedResult = await evaluateLearningSignal(identity, failed.signalId);
  assert.equal(failedResult.status, "failed");
  assert.equal(failedResult.promotionEligible, false);
  assert.ok(failedResult.checks.some((check) => check.name === "correction_text" && !check.passed));

  const passedResult = await evaluateLearningSignal(identity, passed.signalId);
  assert.equal(passedResult.status, "passed");
  assert.equal(passedResult.evaluationScope, "candidate_integrity");
  assert.equal(passedResult.promotionEligible, true);

  const reviews = [pending, rejected, needsContext, failed, passed];
  const evaluations = await latestLearningEvaluations(identity, reviews);
  const stateAfterPass = currentLearningEvaluationState(
    passed,
    evaluations.get(passed.id),
  );
  assert.equal(stateAfterPass.evaluationStatus, "passed");
  assert.equal(stateAfterPass.promotionEligible, true);

  const reReviewedAt = new Date(passed.reviewedAt!.getTime() + 1_000);
  const [rejectedAfterPass] = await db.update(learningSignalReviewsTable).set({
    status: "rejected",
    reviewedAt: reReviewedAt,
    updatedAt: reReviewedAt,
  }).where(and(
    eq(learningSignalReviewsTable.tenantId, tenantId),
    eq(learningSignalReviewsTable.ownerUserId, ownerUserId),
    eq(learningSignalReviewsTable.signalId, passed.signalId),
  )).returning();
  assert.equal(
    currentLearningEvaluationState(rejectedAfterPass, evaluations.get(passed.id)).promotionEligible,
    false,
  );

  const [persisted] = await db.select({ status: learningSignalEvaluationsTable.status })
    .from(learningSignalEvaluationsTable).where(and(
      eq(learningSignalEvaluationsTable.tenantId, tenantId),
      eq(learningSignalEvaluationsTable.ownerUserId, ownerUserId),
      eq(learningSignalEvaluationsTable.signalId, passed.signalId),
    ));
  assert.equal(persisted?.status, "passed");

  const financialRecords = await db.select({ id: expensesTable.id }).from(expensesTable).where(and(
    eq(expensesTable.tenantId, tenantId),
    eq(expensesTable.ownerUserId, ownerUserId),
  ));
  assert.deepEqual(financialRecords, []);
});