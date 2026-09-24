import assert from "node:assert/strict";
import test from "node:test";
import { buildProviderInstructions, classifyToolScope } from "../src/lib/phase2.ts";

function instructionsFor(message: string) {
  return buildProviderInstructions({
    currentUserMessage: message,
    toolScope: classifyToolScope(message),
  });
}

test("keeps unrelated expense, Agent Work, and reminder instructions out of a read-only task query", () => {
  const message = "أحمد كان المفروض يعمل إيه؟";
  const scope = classifyToolScope(message);
  const instructions = instructionsFor(message);

  assert.equal(scope.name, "read_only");
  assert.doesNotMatch(instructions.text, /amountMinor|audit_expense_units|create_agent_work|dueAt/);
  assert.match(instructions.text, /find_person/);
  assert.match(instructions.text, /final_response/);
  assert.equal(
    instructions.text,
    instructions.requestGuidance
      ? `${instructions.systemPrompt}\n${instructions.requestGuidance}`
      : instructions.systemPrompt,
  );
});

test("includes expense reporting guidance for an Egyptian colloquial person-total query", () => {
  const message = "محمد أخد مني كام؟";
  const scope = classifyToolScope(message);
  const instructions = instructionsFor(message);

  assert.equal(scope.name, "read_only");
  assert.match(instructions.text, /audit_expense_units/);
  assert.match(instructions.text, /get_person_expense_total/);
  assert.match(instructions.text, /amountMinor/);
  assert.doesNotMatch(instructions.text, /create_agent_work|dueAt/);
});

test("includes expense write safeguards for a payment record request", () => {
  const message = "دفعت لمحمد 7500";
  const scope = classifyToolScope(message);
  const instructions = instructionsFor(message);

  assert.equal(scope.name, "expense");
  assert.match(instructions.text, /record_expense/);
  assert.match(instructions.text, /amountMinor/);
  assert.match(instructions.text, /الموافقة المعتادة/);
  assert.match(instructions.text, /description/);
});

test("includes person-creation guidance without unrelated financial instructions", () => {
  const message = "أضف شخص اسمه مروان";
  const scope = classifyToolScope(message);
  const instructions = instructionsFor(message);

  assert.equal(scope.name, "person");
  assert.match(instructions.text, /create_person/);
  assert.doesNotMatch(instructions.text, /amountMinor|audit_expense_units|dueAt/);
});

test("keeps the existing-person clarification rule when a person is mentioned as already present", () => {
  const instructions = instructionsFor("محمد موجود بالفعل");

  assert.match(instructions.text, /لا تنشئه/);
  assert.match(instructions.text, /بدل تسجيل مصروف/);
});

test("includes reminder scheduling guidance only for a reminder request", () => {
  const message = "فكرني بكرة الساعة 5";
  const scope = classifyToolScope(message);
  const instructions = instructionsFor(message);

  assert.equal(scope.name, "reminder");
  assert.match(instructions.text, /dueAt/);
  assert.match(instructions.text, /Africa\/Cairo/);
  assert.doesNotMatch(instructions.text, /amountMinor|audit_expense_units/);
});

test("includes GitHub monitoring guidance for Agent Work requests", () => {
  const message = "راقب repository عام على GitHub";
  const scope = classifyToolScope(message);
  const instructions = instructionsFor(message);

  assert.equal(scope.name, "full");
  assert.match(instructions.text, /create_agent_work/);
  assert.match(instructions.text, /github_repository/);
  assert.match(instructions.text, /لا تستخدم URL من المستخدم كمصدر مباشر/);
});

test("includes Agent Work guidance when asked to remember future work", () => {
  const message = "تذكّر العمل لاحقًا";
  const scope = classifyToolScope(message);
  const instructions = instructionsFor(message);

  assert.equal(scope.name, "full");
  assert.match(instructions.text, /create_agent_work/);
});