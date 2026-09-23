import assert from "node:assert/strict";
import test from "node:test";
import {
  decideDeterministically,
  parseSemanticRequest,
  type SemanticIntent,
} from "../src/lib/deterministic-intelligence.ts";
import { routeLocally } from "../src/lib/local-router.ts";

type CorpusCase = {
  dialect: "egyptian" | "gulf" | "levantine";
  scope:
    | "expense_report"
    | "schedule_read"
    | "create_person"
    | "create_project"
    | "record_expense"
    | "create_reminder"
    | "person_expense_total"
    | "negated_write"
    | "ambiguous"
    | "correction";
  text: string;
  normalizedText: string;
  intent: SemanticIntent;
  decision: "deterministic" | "clarification" | "llm" | "no_op";
  person?: string;
  amountMinor?: number;
  currency?: "EGP" | "USD" | "SAR";
  dayOffset?: number;
  hour?: number;
  minute?: number;
  ambiguous?: boolean;
};

const corpus: CorpusCase[] = [
  {
    dialect: "egyptian",
    scope: "expense_report",
    text: "إجمالي مصاريف الشهر ده كام؟",
    normalizedText: "اجمالي مصروفات الشهر الحالي كم",
    intent: "expense_report",
    decision: "deterministic",
  },
  {
    dialect: "gulf",
    scope: "expense_report",
    text: "كم صرفت هالشهر؟",
    normalizedText: "كم صرفت هالشهر",
    intent: "expense_report",
    decision: "deterministic",
  },
  {
    dialect: "levantine",
    scope: "expense_report",
    text: "قديش المصاريف تبعي؟",
    normalizedText: "كم المصروفات تبعي",
    intent: "expense_report",
    decision: "deterministic",
  },
  {
    dialect: "egyptian",
    scope: "schedule_read",
    text: "هات مواعيدي النهارده",
    normalizedText: "هات مواعيدي اليوم",
    intent: "schedule_read",
    decision: "deterministic",
  },
  {
    dialect: "gulf",
    scope: "schedule_read",
    text: "وش مواعيدي اليوم؟",
    normalizedText: "وش مواعيدي اليوم",
    intent: "schedule_read",
    decision: "deterministic",
  },
  {
    dialect: "levantine",
    scope: "schedule_read",
    text: "شو مواعيدي بكرا؟",
    normalizedText: "شو مواعيدي بكره",
    intent: "schedule_read",
    decision: "deterministic",
  },
  {
    dialect: "egyptian",
    scope: "create_person",
    text: "ضيف شخص اسمه ناصر",
    normalizedText: "ضيف شخص اسمه ناصر",
    intent: "create_person",
    decision: "deterministic",
  },
  {
    dialect: "gulf",
    scope: "create_person",
    text: "أبي أضيف جهة اسمها سالم",
    normalizedText: "ابي اضيف جهه اسمها سالم",
    intent: "create_person",
    decision: "deterministic",
  },
  {
    dialect: "levantine",
    scope: "create_person",
    text: "بدي أضيف شخص اسمه رامي",
    normalizedText: "بدي اضيف شخص اسمه رامي",
    intent: "create_person",
    decision: "deterministic",
  },
  {
    dialect: "egyptian",
    scope: "create_project",
    text: "اعمل مشروع النخيل",
    normalizedText: "اعمل مشروع النخيل",
    intent: "create_project",
    decision: "deterministic",
  },
  {
    dialect: "gulf",
    scope: "create_project",
    text: "أبي أنشئ مشروع الواحة",
    normalizedText: "ابي انشئ مشروع الواحه",
    intent: "create_project",
    decision: "deterministic",
  },
  {
    dialect: "levantine",
    scope: "create_project",
    text: "بدي أعمل مشروع الشام",
    normalizedText: "بدي اعمل مشروع الشام",
    intent: "create_project",
    decision: "deterministic",
  },
  {
    dialect: "egyptian",
    scope: "record_expense",
    text: "دفعت لمحمد 7500 في مشروع المحجر",
    normalizedText: "دفعت لمحمد 7500 في مشروع المحجر",
    intent: "record_expense",
    decision: "deterministic",
    person: "محمد",
    amountMinor: 750_000,
    currency: "EGP",
  },
  {
    dialect: "gulf",
    scope: "record_expense",
    text: "عطيت خالد ١٬٢٠٠ ريال في مشروع البيت",
    normalizedText: "اديت خالد ١٬٢٠٠ ريال في مشروع البيت",
    intent: "record_expense",
    decision: "deterministic",
    person: "خالد",
    amountMinor: 120_000,
    currency: "SAR",
  },
  {
    dialect: "levantine",
    scope: "record_expense",
    text: "دفعت لرامي ٣٠٠ دولار بمشروع الشقة",
    normalizedText: "دفعت لرامي ٣٠٠ دولار بمشروع الشقه",
    intent: "record_expense",
    decision: "deterministic",
    person: "رامي",
    amountMinor: 30_000,
    currency: "USD",
  },
  {
    dialect: "egyptian",
    scope: "create_reminder",
    text: "فكرني بكرة الساعة 5 مساءً أكلم محمد",
    normalizedText: "فكرني بكره الساعه 5 مساء اكلم محمد",
    intent: "create_reminder",
    decision: "deterministic",
    dayOffset: 1,
    hour: 17,
    minute: 0,
  },
  {
    dialect: "gulf",
    scope: "create_reminder",
    text: "ذكرني باچر الساعة ٨ الصبح أتصل على سالم",
    normalizedText: "فكرني بكره الساعه ٨ صباحا اتصل علي سالم",
    intent: "create_reminder",
    decision: "deterministic",
    dayOffset: 1,
    hour: 8,
    minute: 0,
  },
  {
    dialect: "levantine",
    scope: "create_reminder",
    text: "ذكرني بكرا الساعة ٦ المسا احكي مع ليان",
    normalizedText: "فكرني بكره الساعه ٦ مساء احكي مع ليان",
    intent: "create_reminder",
    decision: "deterministic",
    dayOffset: 1,
    hour: 18,
    minute: 0,
  },
  {
    dialect: "egyptian",
    scope: "person_expense_total",
    text: "محمد أخد مني كام؟",
    normalizedText: "محمد اخد مني كم",
    intent: "person_expense_total",
    decision: "deterministic",
    person: "محمد",
  },
  {
    dialect: "gulf",
    scope: "person_expense_total",
    text: "كم أخذ مني خالد؟",
    normalizedText: "كم اخد مني خالد",
    intent: "person_expense_total",
    decision: "deterministic",
    person: "خالد",
  },
  {
    dialect: "levantine",
    scope: "person_expense_total",
    text: "قديش أخد مني رامي؟",
    normalizedText: "كم اخد مني رامي",
    intent: "person_expense_total",
    decision: "deterministic",
    person: "رامي",
  },
  {
    dialect: "egyptian",
    scope: "negated_write",
    text: "ما تسجلش مصروف ٥٠٠ لمحمد",
    normalizedText: "ما تسجلش مصروف ٥٠٠ لمحمد",
    intent: "unknown",
    decision: "no_op",
  },
  {
    dialect: "gulf",
    scope: "negated_write",
    text: "لا تسجل ١٠٠ ريال لخالد",
    normalizedText: "لا تسجل ١٠٠ ريال لخالد",
    intent: "unknown",
    decision: "no_op",
  },
  {
    dialect: "levantine",
    scope: "negated_write",
    text: "مو تسجل ٢٠٠ دولار لرامي",
    normalizedText: "مو تسجل ٢٠٠ دولار لرامي",
    intent: "unknown",
    decision: "no_op",
  },
  {
    dialect: "egyptian",
    scope: "ambiguous",
    text: "سجل مصروف لمحمد ووريني مواعيد بكرة",
    normalizedText: "سجل مصروف لمحمد ووريني مواعيد بكره",
    intent: "record_expense",
    decision: "llm",
    ambiguous: true,
  },
  {
    dialect: "gulf",
    scope: "ambiguous",
    text: "سجل ١٠٠ ريال لخالد ووش مواعيدي بكرا؟",
    normalizedText: "سجل ١٠٠ ريال لخالد ووش مواعيدي بكره",
    intent: "record_expense",
    decision: "llm",
    ambiguous: true,
  },
  {
    dialect: "levantine",
    scope: "ambiguous",
    text: "دفعت لرامي ٢٠٠ دولار وشو مواعيدي بكرا؟",
    normalizedText: "دفعت لرامي ٢٠٠ دولار وشو مواعيدي بكره",
    intent: "record_expense",
    decision: "llm",
    ambiguous: true,
  },
  {
    dialect: "egyptian",
    scope: "correction",
    text: "لا، قصدي وريني مصاريف الشهر ده",
    normalizedText: "لا قصدي وريني مصروفات الشهر الحالي",
    intent: "expense_report",
    decision: "deterministic",
  },
  {
    dialect: "gulf",
    scope: "correction",
    text: "لا قصدي وريني تقرير مصاريف هالشهر",
    normalizedText: "لا قصدي وريني تقرير مصروفات هالشهر",
    intent: "expense_report",
    decision: "deterministic",
  },
  {
    dialect: "levantine",
    scope: "correction",
    text: "قصدي شو مصاريفي هالشهر؟",
    normalizedText: "قصدي شو مصروفاتي هالشهر",
    intent: "expense_report",
    decision: "deterministic",
  },
];

type AccuracyMetric = "normalization" | "intent" | "person" | "amount" | "currency" | "time";

function accuracy(correct: number, total: number): string {
  return `${correct}/${total} (${total === 0 ? "N/A" : `${Math.round((correct / total) * 100)}%`})`;
}

const expectedDialectCorpusSize: Record<CorpusCase["dialect"], number> = {
  egyptian: 10,
  gulf: 10,
  levantine: 10,
};

test("broader Arabic dialect corpus covers every core scope", () => {
  for (const sample of corpus) {
    const parsed = parseSemanticRequest(sample.text);
    assert.equal(parsed.normalizedText, sample.normalizedText, `${sample.dialect}: normalization: ${sample.text}`);
    assert.equal(parsed.intent, sample.intent, `${sample.dialect}: ${sample.text}`);
    assert.equal(
      decideDeterministically(parsed).kind,
      sample.decision,
      `${sample.dialect}: ${sample.text}`,
    );
    if (sample.ambiguous !== undefined) {
      assert.equal(parsed.ambiguous, sample.ambiguous, `${sample.dialect}: ambiguity: ${sample.text}`);
    }
    if (sample.person !== undefined) {
      assert.equal(
        parsed.entityMentions.find((mention) => mention.entityType === "person")?.query,
        sample.person,
        `${sample.dialect}: person: ${sample.text}`,
      );
    }
    if (sample.amountMinor !== undefined) {
      assert.equal(parsed.amount?.amountMinor, sample.amountMinor, `${sample.dialect}: amount: ${sample.text}`);
    }
    if (sample.currency !== undefined) {
      assert.equal(parsed.amount?.currency, sample.currency, `${sample.dialect}: currency: ${sample.text}`);
    }
    if (sample.hour !== undefined || sample.dayOffset !== undefined) {
      assert.equal(parsed.dateTime?.hour, sample.hour, `${sample.dialect}: hour: ${sample.text}`);
      assert.equal(parsed.dateTime?.minute, sample.minute, `${sample.dialect}: minute: ${sample.text}`);
      assert.equal(parsed.dateTime?.dayOffset, sample.dayOffset, `${sample.dialect}: day: ${sample.text}`);
    }
  }
});

test("negative write requests never become deterministic writes", () => {
  const previousLocalRouterFlag = process.env.LOCAL_ROUTER_ENABLED;
  process.env.LOCAL_ROUTER_ENABLED = "true";
  for (const sample of corpus.filter((item) => item.scope === "negated_write" || item.scope === "ambiguous")) {
    const parsed = parseSemanticRequest(sample.text);
    const decision = decideDeterministically(parsed);
    assert.notEqual(decision.kind, "deterministic", `${sample.dialect}: ${sample.text}`);
    const localDecision = routeLocally(sample.text);
    if (sample.scope === "ambiguous") {
      assert.ok(localDecision, `${sample.dialect}: local route: ${sample.text}`);
      assert.equal(localDecision.safeToExecute, false, `${sample.dialect}: local safety: ${sample.text}`);
    } else {
      assert.equal(localDecision, null, `${sample.dialect}: local route: ${sample.text}`);
    }
  }
  if (previousLocalRouterFlag === undefined) delete process.env.LOCAL_ROUTER_ENABLED;
  else process.env.LOCAL_ROUTER_ENABLED = previousLocalRouterFlag;
});

test("Arabic dialect accuracy report stays separate by parsing field", () => {
  const metrics: Record<AccuracyMetric, { correct: number; total: number }> = {
    normalization: { correct: 0, total: 0 },
    intent: { correct: 0, total: 0 },
    person: { correct: 0, total: 0 },
    amount: { correct: 0, total: 0 },
    currency: { correct: 0, total: 0 },
    time: { correct: 0, total: 0 },
  };
  const dialectMetrics: Record<CorpusCase["dialect"], { correct: number; total: number }> = {
    egyptian: { correct: 0, total: 0 },
    gulf: { correct: 0, total: 0 },
    levantine: { correct: 0, total: 0 },
  };

  for (const sample of corpus) {
    const parsed = parseSemanticRequest(sample.text);
    const dialectMetric = dialectMetrics[sample.dialect];
    dialectMetric.total += 1;
    dialectMetric.correct += Number(
      parsed.normalizedText === sample.normalizedText
        && parsed.intent === sample.intent
        && decideDeterministically(parsed).kind === sample.decision,
    );
    metrics.normalization.total += 1;
    metrics.normalization.correct += Number(parsed.normalizedText === sample.normalizedText);
    metrics.intent.total += 1;
    metrics.intent.correct += Number(parsed.intent === sample.intent);
    if (sample.person !== undefined) {
      metrics.person.total += 1;
      metrics.person.correct += Number(
        parsed.entityMentions.find((mention) => mention.entityType === "person")?.query === sample.person,
      );
    }
    if (sample.amountMinor !== undefined) {
      metrics.amount.total += 1;
      metrics.amount.correct += Number(parsed.amount?.amountMinor === sample.amountMinor);
    }
    if (sample.currency !== undefined) {
      metrics.currency.total += 1;
      metrics.currency.correct += Number(parsed.amount?.currency === sample.currency);
    }
    if (sample.hour !== undefined) {
      metrics.time.total += 1;
      metrics.time.correct += Number(
        parsed.dateTime?.hour === sample.hour
          && parsed.dateTime.minute === sample.minute
          && parsed.dateTime.dayOffset === sample.dayOffset,
      );
    }
  }

  const report = Object.fromEntries(
    Object.entries(metrics).map(([metric, result]) => [
      metric,
      accuracy(result.correct, result.total),
    ]),
  );
  console.log(`Arabic dialect accuracy report: ${JSON.stringify(report)}`);

  for (const [metric, result] of Object.entries(metrics)) {
    assert.equal(result.correct, result.total, `${metric} accuracy: ${accuracy(result.correct, result.total)}`);
  }
  for (const [dialect, result] of Object.entries(dialectMetrics) as Array<
    [CorpusCase["dialect"], { correct: number; total: number }]
  >) {
    assert.equal(result.total, expectedDialectCorpusSize[dialect], `${dialect} corpus coverage`);
    assert.equal(result.correct, result.total, `${dialect} core accuracy: ${accuracy(result.correct, result.total)}`);
  }
});