import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeArabicText,
  createDeterministicRequestMetrics,
  decideDeterministically,
  normalizeArabicText,
  parseArabicAmount,
  parseArabicDateTime,
  parseArabicTimeOfDay,
  parseSemanticRequest,
  isExplicitCancellationRequest,
  validateDeterministicPayload,
} from "../src/lib/deterministic-intelligence.ts";
import { buildPatternInsights } from "../src/lib/experimental-pattern-insights.ts";
import { FailoverModelGateway, Phase2AgentRuntime, type ModelGateway } from "../src/lib/phase2.ts";
import { parseRelationshipRequest } from "../src/lib/relationship-context.ts";
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
  for (const text of [
    "دفعت 5 الاف جنيه",
    "دفعت 5 آلاف جنيه",
    "دفعت ٥ آلاف جنيه",
    "دفعت ٥٠٠٠ جنيه",
    "دفعت خمسة آلاف جنيه",
  ]) {
    assert.equal(parseArabicAmount(text)?.amountMinor, 500_000, text);
  }
});

test("expense negation is non-mutating while positive expense language remains writable", () => {
  for (const text of [
    "مدفعتش ٣٠٠",
    "مش عايز اسجل ٥٠٠",
    "ما تسجلش ٥٠٠",
    "لا تسجل ٥٠٠",
    "مش عايز أسجل ٥٠٠",
  ]) {
    const parsed = parseSemanticRequest(text);
    assert.notEqual(parsed.intent, "record_expense", text);
    assert.notEqual(decideDeterministically(parsed).kind, "deterministic", text);
  }
  assert.equal(parseSemanticRequest("دفعت ٥٠٠ جنيه").intent, "record_expense");
});

test("cancellation matching requires an explicit operation cancellation phrase", () => {
  for (const text of ["خلاص الغي العملية", "غيرت رأيي", "مش عايز العملية دي"]) {
    assert.equal(isExplicitCancellationRequest(text), true, text);
  }
  for (const text of ["مش عايز أنسى أدفع الإيجار", "مش عايز أنسى أدفع لمحمد بكرة"]) {
    assert.equal(isExplicitCancellationRequest(text), false, text);
  }
});

test("provider failover refuses an already-expired total request deadline", async () => {
  let calls = 0;
  const gateway: ModelGateway = {
    provider: "gemini",
    modelName: "deadline-fixture",
    async generate() {
      calls += 1;
      throw new Error("should not be called");
    },
  };
  const failover = new FailoverModelGateway({ gemini: gateway }, ["gemini"]);
  await assert.rejects(
    failover.generate([], {
      requestId: "deadline-fixture",
      callNumber: 1,
      toolCallsExecuted: 0,
      deadlineAt: Date.now() - 1,
    }),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "MODEL_REQUEST_DEADLINE_EXCEEDED"
    ),
  );
  assert.equal(calls, 0);
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

  const missingAmount = parseSemanticRequest("دفعت لمحمد");
  assert.equal(missingAmount.intent, "record_expense");
  assert.equal(decideDeterministically(missingAmount).kind, "clarification");

  const projectExpenseRead = parseSemanticRequest("كام صرفت على مشروع المحجر؟");
  assert.equal(projectExpenseRead.intent, "expense_report");
  assert.equal(projectExpenseRead.ambiguous, false);
});

test("context-recall questions stay distinct from expense reports", () => {
  const contextQuestion = parseSemanticRequest("آخر حاجة سجلناها عن شركة المحجر؟");

  assert.equal(contextQuestion.intent, "memory_recall");
  assert.equal(contextQuestion.domains.includes("memory"), true);
  assert.equal(contextQuestion.intent === "expense_report", false);
  assert.equal(contextQuestion.ambiguous, true);
  assert.equal(parseRelationshipRequest("آخر حاجة سجلناها عن شركة المحجر؟")?.intent, "recent_activity");
});

test("semantic layer recognizes natural delegation requests without opening Works", () => {
  const monitor = parseSemanticRequest("تابعلي المهام المفتوحة ولو زادت عن ٥ بلغني");
  assert.equal(monitor.intent, "create_agent_work");
  assert.equal(decideDeterministically(monitor).kind, "deterministic");

  const recurring = parseSemanticRequest("كل يوم الساعة 9 راجع المهام المفتوحة وقولي النتيجة");
  assert.equal(recurring.intent, "create_agent_work");
  assert.equal(decideDeterministically(recurring).kind, "deterministic");
  assert.deepEqual(parseArabicTimeOfDay("كل يوم الساعة 9"), {
    hour: 9,
    minute: 0,
    confidence: 0.94,
  });
});

test("travel and obligation conflict is a read-only planning context without invented dates", () => {
  const parsed = parseSemanticRequest(
    "أنا مسافر الأسبوع الجاي، شوف لو فيه التزامات ممكن تتعارض مع السفر",
  );
  assert.equal(parsed.intent, "schedule_read");
  assert.equal(parsed.confidence, 0.88);
  assert.equal(parsed.domains.includes("schedule"), true);
  assert.equal(parsed.dateTime, undefined);
  assert.equal(parsed.hasWriteLanguage, false);
  assert.equal(decideDeterministically(parsed).kind, "deterministic");
});

test("bare Arabic reminder hour 5 follows the established 17:00 convention", () => {
  const cases = [
    "بكرة الساعة 5",
    "بكرة الساعة 5 مساءً",
    "بكرة الساعة 17",
    "غداً الساعة 5",
  ];
  const expectedHours = [17, 17, 17, 17];
  for (const [index, text] of cases.entries()) {
    const parsed = parseArabicDateTime(text, new Date("2026-09-19T10:00:00.000Z"));
    assert.ok(parsed, text);
    assert.equal(parsed.hour, expectedHours[index], text);
  }
});

test("dialect corpus keeps Egyptian, Gulf, and Levantine requests on the same intents", () => {
  const cases = [
    {
      dialect: "egyptian",
      text: "دفعت لمحمد 7500 في مشروع المحجر",
      intent: "record_expense",
      amountMinor: 750_000,
      currency: "EGP",
      person: "محمد",
    },
    {
      dialect: "gulf",
      text: "عطيت خالد ١٬٢٠٠ ريال في مشروع البيت",
      intent: "record_expense",
      amountMinor: 120_000,
      currency: "SAR",
      person: "خالد",
    },
    {
      dialect: "levantine",
      text: "دفعت لرامي ٣٠٠ دولار بمشروع الشقة",
      intent: "record_expense",
      amountMinor: 30_000,
      currency: "USD",
      person: "رامي",
    },
  ] as const;

  for (const sample of cases) {
    const parsed = parseSemanticRequest(sample.text);
    assert.equal(parsed.intent, sample.intent, sample.dialect);
    assert.equal(parsed.amount?.amountMinor, sample.amountMinor, sample.dialect);
    assert.equal(parsed.amount?.currency, sample.currency, sample.dialect);
    assert.deepEqual(
      parsed.entityMentions.find((mention) => mention.entityType === "person")?.query,
      sample.person,
      sample.dialect,
    );
    assert.equal(decideDeterministically(parsed).kind, "deterministic", sample.dialect);
  }

  const reminders = [
    { dialect: "gulf", text: "ذكرني باچر الساعة ٨ الصبح أتصل على سالم", hour: 8 },
    { dialect: "levantine", text: "ذكرني بكرا الساعة ٦ المسا احكي مع ليان", hour: 18 },
  ] as const;
  for (const sample of reminders) {
    const parsed = parseSemanticRequest(sample.text);
    assert.equal(parsed.intent, "create_reminder", sample.dialect);
    assert.equal(parsed.dateTime?.hour, sample.hour, sample.dialect);
    assert.equal(decideDeterministically(parsed).kind, "deterministic", sample.dialect);
  }

  const total = parseSemanticRequest("قديش أخد مني رامي؟");
  assert.equal(total.intent, "person_expense_total");
  assert.deepEqual(total.entityMentions[0], {
    entityType: "person",
    query: "رامي",
    confidence: 0.94,
  });
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

  const bareHourReminder = await runtime.run(identity, {
    message: "فكرني بكرة الساعة 5 أكلم محمد",
    conversationId: `deterministic-bare-hour-reminder-${Date.now()}`,
  }, { dryRun: true });
  assert.equal(bareHourReminder.action?.type, "deterministic_write");
  assert.equal(bareHourReminder.response?.kind, "answer");

  const missing = await runtime.run(identity, {
    message: "سجل مصروف لمحمد",
    conversationId: `deterministic-missing-${Date.now()}`,
  }, { dryRun: true });
  assert.equal(gateway.calls, 0);
  assert.equal(missing.response?.kind, "clarification");
  assert.equal(missing.action?.type, "clarification_needed");
});

test("Phase2 turns a natural task monitor into an approval-backed Work", async () => {
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
  const result = await runtime.run({
    tenantId: `natural-work-${process.pid}-${Date.now()}`,
    userId: "natural-work-user",
  }, {
    message: "تابعلي المهام المفتوحة ولو زادت عن ٥ بلغني",
    conversationId: `natural-work-conversation-${Date.now()}`,
  });

  assert.equal(gateway.calls, 0);
  assert.equal(result.response?.kind, "clarification");
  assert.equal(result.action?.type, "approval_required");
  assert.equal(result.action?.toolName, "create_agent_work");
  const args = result.action?.args as {
    sourceType?: string;
    condition?: { entity?: string; metric?: string; threshold?: number };
    action?: { type?: string; deepLink?: string };
  } | undefined;
  assert.equal(args?.sourceType, "internal_records");
  assert.deepEqual(args?.condition, {
    entity: "tasks",
    metric: "open_task_count",
    operator: "gt",
    threshold: 5,
  });
  assert.equal(args?.action?.type, "notify");
  assert.equal(args?.action?.deepLink, "work_detail");
});

test("Phase2 turns a natural GitHub monitor into the existing approval path", async () => {
  class UnreachableGateway implements ModelGateway {
    readonly provider = "gemini" as const;
    readonly modelName = "unreachable";

    async generate(): Promise<never> {
      throw new Error("provider should not be called");
    }
  }

  const runtime = new Phase2AgentRuntime(new UnreachableGateway());
  const result = await runtime.run({
    tenantId: `github-work-${process.pid}-${Date.now()}`,
    userId: "github-work-user",
  }, {
    message: "تابعلي GitHub octocat/Hello-World ولو الـissues المفتوحة زادت عن ٥ بلغني كل يوم",
    conversationId: `github-work-conversation-${Date.now()}`,
  });

  assert.equal(result.response?.kind, "clarification");
  assert.equal(result.action?.type, "approval_required");
  assert.equal(result.action?.toolName, "create_agent_work");
  const args = result.action?.args as {
    sourceType?: string;
    condition?: Record<string, unknown>;
    schedule?: Record<string, unknown>;
  } | undefined;
  assert.equal(args?.sourceType, "github_repository");
  assert.deepEqual(args?.condition, {
    provider: "github",
    entity: "repository",
    metric: "open_issues_count",
    owner: "octocat",
    repository: "Hello-World",
    operator: "gt",
    threshold: 5,
  });
  assert.equal(args?.schedule?.frequency, "daily");
});

test("Phase2 prepares an unlinked expense when the user gives an amount and purpose", async () => {
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
  const result = await runtime.run({
    tenantId: `deterministic-expense-${process.pid}-${Date.now()}`,
    userId: "deterministic-user",
  }, {
    message: "سجل إني دفعت 11,500 جنيه تشطيبات لشركة المحجر.",
    conversationId: `deterministic-expense-${Date.now()}`,
  }, { dryRun: true });

  assert.equal(gateway.calls, 0);
  assert.equal(result.response?.kind, "answer");
  assert.equal(result.action?.type, "deterministic_write");
  assert.equal(
    (result.action?.deterministicIntelligence as { solvedWithoutLlm?: boolean } | undefined)?.solvedWithoutLlm,
    true,
  );
});

test("Phase2 asks for missing context without calling a provider", async () => {
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
    tenantId: `deterministic-context-${process.pid}-${Date.now()}`,
    userId: "deterministic-user",
  };
  for (const [index, message] of [
    "وكان ده الأسبوع اللي فات",
    "لا مش محمد، أحمد",
    "المبلغ 8500 مش 7500",
    "على المشروع التاني",
    "قصدي المصروف اللي فات",
    "لا، سجلها على مشروع التشطيبات",
  ].entries()) {
    const result = await runtime.run(identity, {
      message,
      conversationId: `deterministic-context-missing-${Date.now()}-${index}`,
    }, { dryRun: true });

    assert.equal(result.response?.kind, "clarification", message);
    assert.equal(result.action?.type, "clarification_needed", message);
    assert.equal(
      (result.action?.deterministicIntelligence as { solvedWithoutLlm?: boolean } | undefined)?.solvedWithoutLlm,
      true,
      message,
    );
  }
  assert.equal(gateway.calls, 0);
});