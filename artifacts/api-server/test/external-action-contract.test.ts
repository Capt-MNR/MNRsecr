import assert from "node:assert/strict";
import test from "node:test";
import {
  createExternalActionIdentity,
} from "../src/lib/agent-work/action-contract";
import {
  hashExternalActionPayload,
  makeExternalActionResult,
  sanitizeExternalActionEvidence,
} from "../src/lib/agent-work/external-action";

const baseIdentity = {
  tenantId: "tenant-a",
  ownerUserId: "owner-a",
  workId: "work-a",
  runId: "run-a",
  approvalOperationId: "approval-a",
  actionId: "action-a",
  actionVersion: "provider-v1",
};

test("external action identity keeps approval, action, and step IDs distinct", () => {
  const first = createExternalActionIdentity({
    ...baseIdentity,
    stepKey: "write",
  });
  const secondStep = createExternalActionIdentity({
    ...baseIdentity,
    stepKey: "verify",
  });
  const differentRun = createExternalActionIdentity({
    ...baseIdentity,
    runId: "run-b",
    stepKey: "write",
  });

  assert.equal(first.approvalOperationId, "approval-a");
  assert.equal(first.actionId, "action-a");
  assert.notEqual(first.actionId, first.stepId);
  assert.notEqual(first.stepId, secondStep.stepId);
  assert.notEqual(first.idempotencyKey, secondStep.idempotencyKey);
  assert.notEqual(first.stepId, differentRun.stepId);
  assert.notEqual(first.idempotencyKey, differentRun.idempotencyKey);
});

test("canonical external-action hashes ignore object key order but bind content", () => {
  const first = {
    provider: "example",
    action: { title: "Quarterly report", values: [["Name", "Amount"], ["A", 5]] },
    plan: [{ kind: "write", range: "A1:B2" }],
  };
  const reordered = {
    plan: [{ range: "A1:B2", kind: "write" }],
    action: { values: [["Name", "Amount"], ["A", 5]], title: "Quarterly report" },
    provider: "example",
  };
  const changed = {
    ...reordered,
    action: { ...reordered.action, title: "Updated report" },
  };

  assert.equal(hashExternalActionPayload(first), hashExternalActionPayload(reordered));
  assert.notEqual(hashExternalActionPayload(first), hashExternalActionPayload(changed));
});

test("unknown external-action results are review-only and cannot be retried", () => {
  const result = makeExternalActionResult({
    status: "unknown_result",
    error: {
      code: "PROVIDER_TIMEOUT_AFTER_WRITE",
      outcome: "unknown_result",
      retryable: true,
      reviewRequired: false,
    },
  });

  assert.equal(result.status, "unknown_result");
  assert.equal(result.retryable, false);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.error.retryable, false);
  assert.equal(result.error.reviewRequired, true);
});

test("external-action evidence removes sensitive payloads and credentials", () => {
  const safe = sanitizeExternalActionEvidence({
    status: "verified",
    valuesHash: "hash-only",
    payload: { cells: [["private"]] },
    authorization: "Bearer private-token",
    nested: {
      apiKey: "private-key",
      note: "Bearer private-token",
    },
  });
  const serialized = JSON.stringify(safe);

  assert.equal(safe.status, "verified");
  assert.equal(safe.valuesHash, "hash-only");
  assert.equal(JSON.stringify(safe.payload), undefined);
  assert.equal(JSON.stringify(safe.authorization), undefined);
  assert.ok(serialized.includes("Bearer [redacted]"));
  assert.ok(!serialized.includes("private-token"));
  assert.ok(!serialized.includes("private-key"));
  assert.ok(!serialized.includes("private"));
});