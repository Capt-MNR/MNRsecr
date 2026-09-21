import assert from "node:assert/strict";
import test from "node:test";
import {
  compareReadOnlyEvidence,
  createRunIdempotencyKey,
  isLeaseExpired,
  redactEvidenceSnapshot,
  transitionWork,
} from "../src/lib/agent-work/contract.ts";
import { PostgresBackgroundIdentityAdapter } from "../src/lib/agent-work/development-adapters.ts";

test("Agent Work lifecycle rejects terminal work transitions", () => {
  assert.equal(transitionWork("draft", "active"), "active");
  assert.throws(() => transitionWork("completed", "active"), /INVALID_WORK_TRANSITION/);
  assert.throws(() => transitionWork("active", "draft"), /INVALID_WORK_TRANSITION/);
});

test("run idempotency keys bind tenant, owner, run, attempt, and action version", () => {
  const base = {
    tenantId: "tenant-a",
    ownerUserId: "user-a",
    workId: "work-a",
    runId: "run-a",
    attempt: 1,
    actionKind: "read_api",
    actionVersion: "v1",
  };
  assert.equal(createRunIdempotencyKey(base), createRunIdempotencyKey(base));
  assert.notEqual(
    createRunIdempotencyKey(base),
    createRunIdempotencyKey({ ...base, attempt: 2 }),
  );
});

test("expired leases are explicit and do not depend on a missing timestamp fallback", () => {
  const now = new Date("2026-09-21T00:00:00.000Z");
  assert.equal(isLeaseExpired(now, null), true);
  assert.equal(isLeaseExpired(now, new Date("2026-09-21T00:00:01.000Z")), false);
  assert.equal(isLeaseExpired(now, new Date("2026-09-20T23:59:59.999Z")), true);
});

test("evidence redaction allowlists scalar values and removes credential-shaped fields", () => {
  assert.deepEqual(
    redactEvidenceSnapshot({
      price: 12,
      changed: true,
      note: "safe",
      authorization: "Bearer secret",
      nested: { raw: "payload" },
    }),
    {
      price: 12,
      changed: true,
      note: "safe",
      nested: null,
    },
  );
});

test("uncertain evidence never becomes verified or unchanged", () => {
  assert.equal(compareReadOnlyEvidence({
    previousHash: "a",
    currentHash: null,
    conditionMet: true,
    comparisonKnown: false,
  }).state, "uncertain");
  assert.equal(compareReadOnlyEvidence({
    previousHash: "a",
    currentHash: "b",
    conditionMet: true,
    comparisonKnown: true,
  }).state, "verified");
  assert.equal(compareReadOnlyEvidence({
    previousHash: "a",
    currentHash: "a",
    conditionMet: true,
    comparisonKnown: true,
  }).state, "unchanged");
});

test("production background identity accepts only durable scheduler identities", () => {
  const adapter = new PostgresBackgroundIdentityAdapter();
  assert.deepEqual(
    adapter.resolveBackground({
      tenantId: "tenant-from-agent-work-row",
      userId: "user-from-agent-work-row",
      actor: "scheduler",
    }),
    {
      tenantId: "tenant-from-agent-work-row",
      userId: "user-from-agent-work-row",
    },
  );
  assert.equal(adapter.resolveRequest({ authorization: "Bearer dev-user" }), null);
  assert.equal(adapter.resolveBackground({
    tenantId: "tenant",
    userId: "user",
    actor: "manual",
  }), null);
  assert.equal(adapter.resolveBackground({
    tenantId: "tenant\nforged",
    userId: "user",
    actor: "scheduler",
  }), null);
});