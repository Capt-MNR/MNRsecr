import assert from "node:assert/strict";
import test from "node:test";
import { evaluationContractV1 } from "./contract-v1";
import { evaluateAll, evaluateAllIsolated, evaluateScenario } from "./evaluator";
import { parseSemanticRequest } from "../../src/lib/deterministic-intelligence";
import { buildRecallPlan } from "../../src/lib/recall-plan";
import { classifySecondBrainQuery } from "../../src/lib/second-brain";
import {
  collectIsolatedScenarioEvidence,
  createEvidenceRunId,
} from "./isolated-evidence";

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

test("memory conflicts and obligation plans use explicit read-only intent routes", () => {
  const conflict = "فاكر إن مصروف المحجر كان 5000 جنيه";
  const conflictParse = parseSemanticRequest(conflict);
  assert.equal(conflictParse.intent, "memory_financial_conflict");
  assert.equal(conflictParse.ambiguous, false);
  assert.deepEqual(
    conflictParse.entityMentions.find((entity) => entity.entityType === "project"),
    { entityType: "project", query: "المحجر", confidence: 0.9 },
  );
  assert.equal(classifySecondBrainQuery(conflict), "structured_record_comparison");
  const recallPlan = buildRecallPlan(conflict);
  assert.ok(recallPlan.sources.includes("structured_records"));
  assert.ok(recallPlan.sources.includes("second_brain"));

  const planningScenario = evaluationContractV1.find((scenario) => scenario.scenarioId === "19")!;
  const travelScenario = evaluationContractV1.find((scenario) => scenario.scenarioId === "20")!;
  assert.equal(parseSemanticRequest(planningScenario.input).intent, "planning");
  assert.equal(parseSemanticRequest(travelScenario.input).intent, "planning");
  assert.equal(evaluateScenario(planningScenario).envelope?.strategy.level, "L3");
  assert.equal(evaluateScenario(travelScenario).envelope?.strategy.level, "L3");

  const unresolvedProject = parseSemanticRequest("المشروع الكبير مصاريفه كام؟");
  assert.equal(unresolvedProject.intent, "project_expenses");
  assert.ok(unresolvedProject.entityMentions.some((entity) =>
    entity.entityType === "project" && entity.query === "المشروع الكبير"));
});

test("runner invokes the current Brain envelope path and never executes writes", () => {
  const records = evaluateAll();
  assert.equal(records.length, 30);
  assert.ok(records.every((record) => record.envelope));
  assert.ok(records.every((record) => record.instrumentation.logicalLlmCalls === 0));
  assert.ok(records.every((record) =>
    record.observed.actualOutcome.includes("no provider or mutation executed")
    || record.observed.actualOutcome.includes("no mutation executed"),
  ));
});

test("every scenario exposes isolated safety evidence fields", () => {
  const records = evaluateAll();
  assert.equal(new Set(records.map((record) => record.correlationId)).size, 30);
  for (const record of records) {
    assert.equal(record.expectedOutcome, record.expected.expectedOutcome);
    assert.equal(typeof record.observedOutcome, "string");
    assert.equal(typeof record.mutationCount, "number");
    assert.ok(record.verificationState);
    assert.equal(record.providerStatus, "not_called");
    assert.equal(record.isolation.cleanupCompleted, true);
  }
});

test("fixed clock makes temporal observations reproducible", () => {
  const reminder = evaluateScenario(evaluationContractV1.find((scenario) => scenario.scenarioId === "22")!);
  assert.equal(reminder.semanticParse?.dateTime?.dayOffset, 1);
  assert.equal(reminder.semanticParse?.dateTime?.hour, 17);
  assert.doesNotMatch(reminder.passFail.mismatchReason ?? "", /tomorrow at 17:00/);
  assert.equal(reminder.status, "PASS");
});

test("only the five approved primary-intent label pairs are normalized", () => {
  const cases = [
    ["05", "person_financial_status"],
    ["06", "recent_activity"],
    ["13", "project_expenses"],
    ["21", "unknown"],
    ["28", "person_financial_status"],
  ] as const;
  for (const [scenarioId, rawIntent] of cases) {
    const scenario = evaluationContractV1.find((item) => item.scenarioId === scenarioId)!;
    const record = evaluateScenario(scenario);
    assert.equal(record.status, "PASS", scenarioId);
    assert.equal(record.observed.primaryIntent, rawIntent, scenarioId);
    assert.equal(record.passFail.normalizationsApplied.length, 1, scenarioId);
  }
});

test("a completed expense clarification is L1 and has no pending approval", () => {
  const scenario = evaluationContractV1.find((item) => item.scenarioId === "03")!;
  const record = evaluateScenario(scenario, undefined, "clarification");
  assert.equal(record.status, "PASS");
  assert.equal(record.envelope?.strategy.level, "L1");
  assert.equal(record.envelope?.risk.requiresApproval, false);
  assert.equal(record.envelope?.verification.required, false);
});

test("production Phase2 stops an ambiguous named-person expense before the model gateway", async () => {
  const scenario = evaluationContractV1.find((item) => item.scenarioId === "03")!;
  const evidence = await collectIsolatedScenarioEvidence(scenario, createEvidenceRunId());
  assert.equal(evidence.cleanupCompleted, true);
  assert.equal(evidence.fixtureCheck?.status, "PASS", evidence.fixtureCheck?.mismatchReason ?? undefined);
  assert.equal(evidence.fixtureCheck?.details.gatewayCalls, 0);
  assert.equal(evidence.fixtureCheck?.details.newExpenses, 0);
  assert.equal(evidence.fixtureCheck?.details.newOperations, 0);
});

test("project alias fixtures distinguish direct resolution from Phase2 routing", async () => {
  const runId = createEvidenceRunId();
  const scenario12 = evaluationContractV1.find((item) => item.scenarioId === "12")!;
  const associated = await collectIsolatedScenarioEvidence(scenario12, runId);
  assert.equal(associated.cleanupCompleted, true);
  assert.equal(associated.fixtureCheck?.status, "PASS", associated.fixtureCheck?.mismatchReason ?? undefined);
  assert.equal(associated.fixtureCheck?.details.matchType, "alias");
  assert.equal(associated.fixtureCheck?.details.selectedProjectId, associated.fixtureCheck?.details.canonicalProjectId);
  assert.equal(associated.fixtureCheck?.details.phase2ActionType, "project_reference");
  assert.equal(associated.fixtureCheck?.details.phase2Intent, "project_reference");
  assert.equal(associated.fixtureCheck?.details.phase2StrategyLevel, "L0");
  assert.equal(associated.fixtureCheck?.details.phase2GatewayCalls, 0);
  assert.equal(associated.fixtureCheck?.details.phase2ResolvesCanonical, true);
  assert.equal(associated.fixtureCheck?.details.noDomainMutation, true);
  assert.equal(associated.failureClassification, null);

  const scenario15 = evaluationContractV1.find((item) => item.scenarioId === "15")!;
  const missingAgreement = await collectIsolatedScenarioEvidence(scenario15, runId);
  assert.equal(missingAgreement.fixtureCheck?.status, "BLOCKED_BY_INFRASTRUCTURE");
  assert.equal(missingAgreement.correctnessScoring, "not_executable");

  const scenario29 = evaluationContractV1.find((item) => item.scenarioId === "29")!;
  const unassociated = await collectIsolatedScenarioEvidence(scenario29, runId);
  assert.equal(unassociated.cleanupCompleted, true);
  assert.equal(unassociated.fixtureCheck?.status, "PASS");
  assert.equal(unassociated.failureClassification, null);
  assert.equal(unassociated.fixtureCheck?.details.resolverMatchType, "none");
  assert.equal(unassociated.fixtureCheck?.details.semanticIntent, "project_expenses");
  assert.equal(unassociated.fixtureCheck?.details.semanticEntityType, "project");
  assert.equal(unassociated.fixtureCheck?.details.relationshipContextRecognized, true);
  assert.equal(unassociated.fixtureCheck?.details.responseKind, "clarification");
  assert.equal(unassociated.fixtureCheck?.details.gatewayCalls, 0);
  assert.equal(unassociated.fixtureCheck?.details.financialRecordCount, 0);
  assert.equal(unassociated.fixtureCheck?.details.noDomainMutation, true);
  assert.equal(unassociated.safetyPass, true);
});

test("an approved project alias passes only after Phase2 completes the canonical reference", async () => {
  const scenario = evaluationContractV1.find((item) => item.scenarioId === "12")!;
  const envelopeOnly = evaluateScenario(scenario);
  assert.equal(envelopeOnly.status, "FAIL");

  const records = await evaluateAllIsolated();
  const associatedAlias = records.find((record) => record.scenarioId === "12");
  assert.ok(associatedAlias);
  assert.equal(associatedAlias.fixtureCheck?.status, "PASS");
  assert.equal(associatedAlias.status, "PASS");
  assert.equal(associatedAlias.observed.primaryIntent, "project_reference");
  assert.equal(associatedAlias.observed.intelligenceLevel, "L0");
  assert.equal(associatedAlias.passFail.pass, true);
  assert.equal(associatedAlias.fixtureCheck?.details.phase2ContractSatisfied, true);
});