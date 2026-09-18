import assert from "node:assert/strict";
import test from "node:test";
import { evaluationContractV1 } from "./contract-v1";
import { evaluateAll, evaluateScenario } from "./evaluator";

test("Evaluation Contract v1 contains exactly the fixed scenarios 01–30", () => {
  assert.equal(evaluationContractV1.length, 30);
  assert.deepEqual(
    evaluationContractV1.map((scenario) => scenario.scenarioId),
    Array.from({ length: 30 }, (_, index) => String(index + 1).padStart(2, "0")),
  );
  assert.equal(evaluationContractV1[23]?.title, "Provider failure during expense creation");
  assert.equal(evaluationContractV1[24]?.title, "Approval expired");
  assert.equal(evaluationContractV1[25]?.title, "Verification failure after execution attempt");
  assert.equal(evaluationContractV1[26]?.title, "User changes mind");
  assert.equal(evaluationContractV1[27]?.title, "Debt / relationship question");
  assert.equal(evaluationContractV1[28]?.title, "Project alias without canonical association");
  assert.equal(evaluationContractV1[29]?.title, "Proactive obligation synthesis");
});

test("every scenario captures the required ground-truth dimensions", () => {
  for (const scenario of evaluationContractV1) {
    const expected = scenario.expectation;
    assert.ok(expected.primaryIntent, scenario.scenarioId);
    assert.ok(Array.isArray(expected.secondaryIntents), scenario.scenarioId);
    assert.ok(Array.isArray(expected.mentionedEntities), scenario.scenarioId);
    assert.ok(Array.isArray(expected.requiredContext), scenario.scenarioId);
    assert.ok(Array.isArray(expected.authoritativeSources), scenario.scenarioId);
    assert.ok(Array.isArray(expected.excludedSources), scenario.scenarioId);
    assert.ok(expected.selectedStrategy, scenario.scenarioId);
    assert.ok(expected.verificationPlan, scenario.scenarioId);
    assert.ok(expected.expectedOutcome, scenario.scenarioId);
    assert.ok(expected.forbidden.length > 0, scenario.scenarioId);
  }
});

test("runner invokes the current Brain envelope path and never executes writes", () => {
  const records = evaluateAll();
  assert.equal(records.length, 30);
  assert.ok(records.every((record) => record.envelope));
  assert.ok(records.every((record) => record.instrumentation.logicalLlmCalls === 0));
  assert.ok(records.every((record) => record.observed.actualOutcome.includes("no provider or mutation executed")));
});

test("fixed clock makes temporal observations reproducible", () => {
  const reminder = evaluateScenario(evaluationContractV1.find((scenario) => scenario.scenarioId === "22")!);
  assert.equal(reminder.semanticParse?.dateTime?.dayOffset, 1);
  assert.equal(reminder.semanticParse?.dateTime?.hour, 17);
  assert.equal(reminder.semanticParse?.dateTime?.minute, 0);
});