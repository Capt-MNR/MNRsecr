import assert from "node:assert/strict";
import test from "node:test";
import { detectLearningSignal } from "../src/lib/learning-signals.ts";

const previousTurns = [
  {
    turnId: "turn-1",
    userMessage: "سجلت مصروف لمحمد",
    assistantMessage: "تم تسجيله بعد الموافقة.",
    action: { type: "approval_required", toolName: "record_expense" },
  },
];

test("captures an amount correction for review without applying it", () => {
  assert.deepEqual(
    detectLearningSignal("لا، قصدي المبلغ ٧٥٠ ريال", previousTurns),
    {
      kind: "explicit_correction",
      category: "amount",
      confidence: 0.95,
      previousTurnId: "turn-1",
      previousActionType: "record_expense",
      reviewOnly: true,
      autoApply: false,
    },
  );
});

test("classifies dialect date and project corrections", () => {
  assert.equal(
    detectLearningSignal("لا، الموعد بكرا الساعة ٨", previousTurns)?.category,
    "date_time",
  );
  assert.equal(
    detectLearningSignal("مش ده، قصدي المشروع التاني", previousTurns)?.category,
    "project",
  );
});

test("does not create a learning signal without a correction or prior turn", () => {
  assert.equal(detectLearningSignal("دفعت ٥٠٠ ريال", previousTurns), null);
  assert.equal(detectLearningSignal("لا، قصدي المبلغ ٧٥٠ ريال", []), null);
});