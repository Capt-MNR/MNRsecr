import test from "node:test";
import assert from "node:assert/strict";
import { parseArabicDateTime, parseSemanticRequest } from "../src/lib/deterministic-intelligence";
import {
  createBrainDecisionEnvelope,
} from "../src/lib/brain-contract";

test("parses yesterday with an exact Cairo time", () => {
  const parsed = parseArabicDateTime(
    "امبارح الساعة 5 مساء",
    new Date("2026-09-19T10:00:00.000Z"),
  );
  assert.ok(parsed);
  assert.equal(parsed.dayOffset, -1);
  assert.equal(parsed.hour, 17);
  assert.equal(parsed.minute, 0);
  assert.equal(parsed.confidence, 0.99);
});

test("selects a safe read strategy and excludes unverified claims", () => {
  const semanticParse = parseSemanticRequest("إجمالي مصروفات الأسبوع ده");
  const envelope = createBrainDecisionEnvelope({
    requestId: "request-1",
    conversationId: "conversation-1",
    message: "إجمالي مصروفات الأسبوع ده",
    semanticParse,
    secondBrainTrace: {
      traceId: "trace-1",
      requestId: "request-1",
      conversationId: "conversation-1",
      strategy: "lexical_v1",
      triggered: true,
      queryDomain: "structured_record_read",
      consideredCount: 1,
      selected: [],
      excluded: [],
      structuredPrecedence: { applied: true, domain: "financial_record", conflicts: [] },
      llmContextIncluded: false,
      llmContextReason: "structured_records_take_precedence",
    },
  });
  assert.equal(envelope.strategy.level, "L1");
  assert.equal(envelope.strategy.deterministicExecution, true);
  assert.equal(envelope.intent.name, "expense_report");
  assert.ok(envelope.context.selected.includes("governed_second_brain_context"));
  assert.ok(envelope.context.excluded.includes("unverified_model_claims"));
});

test("holds ambiguous financial writes at contextual reasoning", () => {
  const semanticParse = parseSemanticRequest("دفعت لمحمد 7500 في مشروع النور");
  const envelope = createBrainDecisionEnvelope({
    requestId: "request-2",
    conversationId: "conversation-2",
    message: "دفعت لمحمد 7500 في مشروع النور",
    semanticParse,
    hasConversationContext: false,
  });
  assert.equal(envelope.intent.name, "record_expense");
  assert.equal(envelope.strategy.level, "L2");
  assert.equal(envelope.risk.requiresApproval, true);
  assert.equal(envelope.risk.level, "medium");
});

test("does not allow a relationship clarification to execute", () => {
  const semanticParse = parseSemanticRequest("محمد عليه كام؟");
  const envelope = createBrainDecisionEnvelope({
    requestId: "request-3",
    conversationId: "conversation-3",
    message: "محمد عليه كام؟",
    semanticParse,
    relationshipContext: {
      context: {
        version: 1,
        intent: "person_financial_status",
        bounds: {
          maxEntities: 3,
          maxRelationships: 12,
          maxRecords: 12,
          maxTimelineEvents: 8,
          maxContextChars: 6000,
        },
        resolvedEntities: [],
        relevantRelationships: [],
        relevantRecords: [],
        financialSummary: {},
        recentActivity: [],
        conversationReferences: [],
        uncertainties: ["person_ambiguous"],
        truncated: false,
      },
      response: { kind: "clarification", message: "أي محمد تقصد؟" },
    },
  });
  assert.equal(envelope.state, "clarification");
  assert.equal(envelope.strategy.level, "L0");
  assert.equal(envelope.strategy.deterministicExecution, false);
  assert.ok(envelope.context.ambiguity.includes("person_ambiguous"));
});