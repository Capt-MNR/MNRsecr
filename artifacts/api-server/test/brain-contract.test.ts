import test from "node:test";
import assert from "node:assert/strict";
import { parseArabicDateTime, parseSemanticRequest } from "../src/lib/deterministic-intelligence";
import {
  createBrainDecisionEnvelope,
} from "../src/lib/brain-contract";
import {
  applySecondBrainPolicy,
  classifySecondBrainQuery,
  emptyRetrievalTrace,
} from "../src/lib/second-brain";
import type { SecondBrainMemory } from "@workspace/db";

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

test("financial memory comparison keeps the fact contextual and structured precedence explicit", () => {
  const message = "في الذاكرة عندي ملاحظة قديمة بتقول إن مصروف مشروع التوسعة كان ٧٠٠ جنيه، قولي القيمة الموجودة في الحسابات وقارنها بالملاحظة القديمة";
  assert.equal(classifySecondBrainQuery(message), "structured_record_comparison");
  const memory = {
    id: "memory-comparison-1",
    kind: "fact",
    confidenceBps: 10000,
    metadata: { source: "explicit_user_instruction" },
  } as unknown as SecondBrainMemory;
  const trace = emptyRetrievalTrace(message, true, "structured_record_comparison");
  trace.selected = [{
    memoryId: memory.id,
    kind: "fact",
    relevanceScore: 0.9,
    confidence: 1,
    association: null,
    provenance: {
      sourceType: "explicit_user_instruction",
      sourceConversationId: null,
      sourceTurnId: null,
    },
    sourceConversationId: null,
    sourceTurnId: null,
  }];
  const governed = applySecondBrainPolicy([memory], trace);
  assert.deepEqual(governed.memories.map((item) => item.id), [memory.id]);
  assert.equal(governed.trace.structuredPrecedence.applied, true);
  assert.equal(governed.trace.structuredPrecedence.domain, "financial_record");
  assert.equal(governed.trace.llmContextIncluded, true);
  assert.equal(governed.trace.llmContextReason, "structured_record_comparison");
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

test("routes a clear single-scope expense to deterministic L0", () => {
  const semanticParse = parseSemanticRequest("دفعت لمحمد 500 جنيه");
  const envelope = createBrainDecisionEnvelope({
    requestId: "request-simple-expense",
    conversationId: "conversation-simple-expense",
    message: "دفعت لمحمد 500 جنيه",
    semanticParse,
  });
  assert.equal(envelope.strategy.level, "L0");
  assert.equal(envelope.strategy.deterministicExecution, true);
  assert.equal(envelope.risk.requiresApproval, true);
});

test("routes a clear amount-only transport expense to deterministic L0", () => {
  const semanticParse = parseSemanticRequest("دفعت 120 جنيه أوبر");
  const envelope = createBrainDecisionEnvelope({
    requestId: "request-transport-expense",
    conversationId: "conversation-transport-expense",
    message: "دفعت 120 جنيه أوبر",
    semanticParse,
  });
  assert.equal(envelope.strategy.level, "L0");
  assert.equal(envelope.strategy.deterministicExecution, true);
  assert.equal(envelope.risk.requiresApproval, true);
});

test("routes a missing expense amount to non-mutating L1 clarification", () => {
  const semanticParse = parseSemanticRequest("دفعت لمحمد");
  const envelope = createBrainDecisionEnvelope({
    requestId: "request-missing-expense-amount",
    conversationId: "conversation-missing-expense-amount",
    message: "دفعت لمحمد",
    semanticParse,
  });
  assert.equal(envelope.intent.name, "record_expense");
  assert.equal(envelope.strategy.level, "L1");
  assert.equal(envelope.strategy.deterministicExecution, false);
  assert.equal(envelope.risk.level, "low");
  assert.equal(envelope.risk.requiresApproval, false);
});

test("does not turn a structured financial read into an approval-gated write", () => {
  const message = "أنا دفعت كام لشركة المحجر؟";
  const semanticParse = parseSemanticRequest(message);
  const envelope = createBrainDecisionEnvelope({
    requestId: "request-financial-read",
    conversationId: "conversation-financial-read",
    message,
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
        resolvedEntities: [{
          id: "party-quarry",
          name: "شركة المحجر",
          type: "financial_party",
          matchType: "exact",
          confidence: 0.98,
        }],
        relevantRelationships: [],
        relevantRecords: [],
        financialSummary: {},
        recentActivity: [],
        conversationReferences: [],
        uncertainties: [],
        truncated: false,
      },
      response: { kind: "answer", message: "structured financial result" },
    },
  });
  assert.equal(envelope.risk.level, "low");
  assert.equal(envelope.risk.requiresApproval, false);
});

test("keeps vague action language in non-mutating clarification", () => {
  const semanticParse = parseSemanticRequest("اعمل حاجة مناسبة لمحمد");
  const envelope = createBrainDecisionEnvelope({
    requestId: "request-vague-action",
    conversationId: "conversation-vague-action",
    message: "اعمل حاجة مناسبة لمحمد",
    semanticParse,
  });
  assert.equal(envelope.intent.name, "unknown");
  assert.equal(envelope.strategy.level, "L1");
  assert.equal(envelope.risk.level, "low");
  assert.equal(envelope.risk.requiresApproval, false);
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