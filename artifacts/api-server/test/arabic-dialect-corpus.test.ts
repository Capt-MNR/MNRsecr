import assert from "node:assert/strict";
import test from "node:test";
import {
  decideDeterministically,
  parseSemanticRequest,
  type SemanticIntent,
} from "../src/lib/deterministic-intelligence.ts";

type CorpusCase = {
  dialect: "egyptian" | "gulf" | "levantine";
  text: string;
  intent: SemanticIntent;
  decision: "deterministic" | "clarification" | "llm";
};

const corpus: CorpusCase[] = [
  { dialect: "egyptian", text: "إجمالي مصاريف الشهر ده كام؟", intent: "expense_report", decision: "deterministic" },
  { dialect: "gulf", text: "كم صرفت هالشهر؟", intent: "expense_report", decision: "deterministic" },
  { dialect: "levantine", text: "قديش المصاريف تبعي؟", intent: "expense_report", decision: "deterministic" },
  { dialect: "egyptian", text: "هات مواعيدي النهارده", intent: "schedule_read", decision: "deterministic" },
  { dialect: "gulf", text: "وش مواعيدي اليوم؟", intent: "schedule_read", decision: "deterministic" },
  { dialect: "levantine", text: "شو مواعيدي بكرا؟", intent: "schedule_read", decision: "deterministic" },
  { dialect: "egyptian", text: "ضيف شخص اسمه ناصر", intent: "create_person", decision: "deterministic" },
  { dialect: "gulf", text: "أبي أضيف جهة اسمها سالم", intent: "create_person", decision: "deterministic" },
  { dialect: "levantine", text: "بدي أضيف شخص اسمه رامي", intent: "create_person", decision: "deterministic" },
  { dialect: "egyptian", text: "اعمل مشروع النخيل", intent: "create_project", decision: "deterministic" },
  { dialect: "gulf", text: "أبي أنشئ مشروع الواحة", intent: "create_project", decision: "deterministic" },
  { dialect: "levantine", text: "بدي أعمل مشروع الشام", intent: "create_project", decision: "deterministic" },
  { dialect: "egyptian", text: "ما تسجلش مصروف ٥٠٠ لمحمد", intent: "unknown", decision: "llm" },
  { dialect: "gulf", text: "لا تسجل ١٠٠ ريال لخالد", intent: "unknown", decision: "llm" },
  { dialect: "levantine", text: "مو تسجل ٢٠٠ دولار لرامي", intent: "unknown", decision: "llm" },
];

test("broader Arabic dialect corpus covers read, entity, and project intents", () => {
  for (const sample of corpus) {
    const parsed = parseSemanticRequest(sample.text);
    assert.equal(parsed.intent, sample.intent, `${sample.dialect}: ${sample.text}`);
    assert.equal(
      decideDeterministically(parsed).kind,
      sample.decision,
      `${sample.dialect}: ${sample.text}`,
    );
  }
});

test("negative write requests never become deterministic writes", () => {
  for (const sample of corpus.filter((item) => item.intent === "unknown")) {
    const parsed = parseSemanticRequest(sample.text);
    const decision = decideDeterministically(parsed);
    assert.notEqual(decision.kind, "deterministic", `${sample.dialect}: ${sample.text}`);
    assert.notEqual(decision.intent, "record_expense", `${sample.dialect}: ${sample.text}`);
  }
});