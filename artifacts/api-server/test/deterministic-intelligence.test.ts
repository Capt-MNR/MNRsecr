import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeArabicText,
  createDeterministicRequestMetrics,
  decideDeterministically,
  normalizeArabicText,
  parseArabicAmount,
  parseArabicDateTime,
  parseSemanticRequest,
  validateDeterministicPayload,
} from "../src/lib/deterministic-intelligence.ts";
import { buildPatternInsights } from "../src/lib/experimental-pattern-insights.ts";
import { Phase2AgentRuntime, type ModelGateway } from "../src/lib/phase2.ts";
import type { Identity } from "../src/lib/secretary.ts";

test("Arabic normalization handles spelling, punctuation, and Arabic digits", () => {
  assert.equal(normalizeArabicText("  إدفَعْ ١٬٥٠٠ جنيه؟ "), "ادفع ١٬٥٠٠ جنيه");
  assert.equal(canonicalizeArabicText("إجمالي مصروفات النهارده"), "اجمالي مصروفات اليوم");
});

test("amount parsing preserves grouped thousands and minor units", () => {
  assert.deepEqual(parseArabicAmount("دفعت ١١,٥٠٠ جنيه"), {
    amountMinor: 1_150_000,
    currency: "EGP",
    raw: "١١,٥٠٠",
    confidence: 0.99,
  });
  assert.equal(parseArabicAmount("دفعت 7.5 دولار")?.amountMinor, 750);
});

test("semantic layer recognizes expense, totals, schedules, and reminders", () => {
  const expense = parseSemanticRequest("دفعت لمحمد 7500 في مشروع المحجر");
  assert.equal(expense.intent, "record_expense");
  assert.equal(expense.amount?.amountMinor, 750_000);
  assert.deepEqual(
    expense.entityMentions.map((mention) => [mention.entityType, mention.query]),
    [["person", "محمد"], ["project", "المحجر"]],
  );
  assert.equal(decideDeterministically(expense).kind, "deterministic");

  const total = parseSemanticRequest("محمد أخد مني كام؟");
  assert.equal(total.intent, "person_expense_total");
  assert.equal(decideDeterministically(total).kind, "deterministic");

  const reminder = parseSemanticRequest("فكرني بكرة الساعة 5 مساءً أكلم محمد");
  assert.equal(reminder.intent, "create_reminder");
  assert.equal(reminder.dateTime?.hour, 17);
  assert.equal(decideDeterministically(reminder).kind, "deterministic");
});

test("missing information and mixed intents never become writes", () => {
  const missingAmount = parseSemanticRequest("سجل مصروف لمحمد");
  assert.equal(decideDeterministically(missingAmount).kind, "clarification");
  assert.equal(
    validateDeterministicPayload(missingAmount, {
      amountMinor: 0,
      currency: "EGP",
      description: "",
    }).valid,
    false,
  );

  const mixed = parseSemanticRequest("سجل مصروف لمحمد ووريني مواعيد بكرة");
  assert.equal(decideDeterministically(mixed).kind, "llm");
});

test("date parser is deterministic for the supplied Cairo clock", () => {
  const parsed = parseArabicDateTime(
    "بكرة الساعة 9 صباحا",
    new Date("2026-09-15T10:00:00.000Z"),
  );
  assert.ok(parsed);
  assert.equal(new Date(parsed!.iso).toISOString(), "2026-09-16T06:00:00.000Z");
});

test("pattern engine labels observations instead of turning them into facts", () => {
  const insights = buildPatternInsights(
    [{ personId: "p1", projectId: "project-1", relationship: "مقاول" }],
    [
      { id: "e1", amountMinor: 1000, currency: "EGP", occurredAt: "2026-07-01T08:00:00.000Z", personId: "p1", projectId: "project-1" },
      { id: "e2", amountMinor: 1000, currency: "EGP", occurredAt: "2026-08-01T08:00:00.000Z", personId: "p1", projectId: "project-1" },
      { id: "e3", amountMinor: 1000, currency: "EGP", occurredAt: "2026-09-01T08:00:00.000Z", personId: "p1", projectId: "project-1" },
    ],
    new Date("2026-09-15T00:00:00.000Z"),
  );
  assert.equal(insights.some((insight) => insight.kind === "relationship" && insight.confidence === 1), true);
  const recurring = insights.find((insight) => insight.kind === "recurring_expense");
  assert.ok(recurring);
  assert.equal(recurring?.qualification, "repeated_observation");
  assert.equal(Object.prototype.hasOwnProperty.call(recurring?.value ?? {}, "fact"), false);
});

test("request metrics start conservative", () => {
  assert.deepEqual(createDeterministicRequestMetrics(), {
    layerVersion: 1,
    normalizationApplied: false,
    semanticParsed: false,
    resolverUsed: false,
    entityMatches: 0,
    entityAmbiguities: 0,
    validationFailures: 0,
    decision: "not_run",
    solvedWithoutLlm: false,
    llmCallsAvoided: 0,
    llmAvoidanceMeasurement: "not_claimed",
    falsePositiveGuard: "not_applicable",
  });
});

test("Phase2 resolves high-signal reminder and clarification before any provider call", async () => {
  class UnreachableGateway implements ModelGateway {
    readonly provider = "gemini" as const;
    readonly modelName = "unreachable";
    calls = 0;

    async generate(): Promise<never> {
      this.calls += 1;
      throw new Error("provider should not be called");
    }
  }

  const gateway = new UnreachableGateway();
  const runtime = new Phase2AgentRuntime(gateway);
  const identity: Identity = {
    tenantId: `deterministic-test-${process.pid}-${Date.now()}`,
    userId: "deterministic-user",
  };
  const reminder = await runtime.run(identity, {
    message: "فكرني بكرة الساعة 5 مساءً أكلم محمد",
    conversationId: `deterministic-reminder-${Date.now()}`,
  }, { dryRun: true });
  assert.equal(gateway.calls, 0);
  assert.equal(reminder.action?.type, "deterministic_write");
  assert.equal(reminder.response?.kind, "answer");
  assert.equal((reminder.action?.deterministicIntelligence as { llmCallsAvoided?: number } | undefined)?.llmCallsAvoided, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(reminder.action ?? {}, "patternInsights"), false);

  const missing = await runtime.run(identity, {
    message: "سجل مصروف لمحمد",
    conversationId: `deterministic-missing-${Date.now()}`,
  }, { dryRun: true });
  assert.equal(gateway.calls, 0);
  assert.equal(missing.response?.kind, "clarification");
  assert.equal(missing.action?.type, "clarification_needed");
});