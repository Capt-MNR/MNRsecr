import assert from "node:assert/strict";
import test from "node:test";
import { classifyBenchmarkRun } from "./provider-benchmark-classification.ts";

test("separates a safety-rejected final response from API and tool-call failures", () => {
  const classification = classifyBenchmarkRun({
    httpStatuses: [200],
    generationOutcomes: ["SUCCESS"],
    finalResponseCallCount: 1,
    finalResponseArgumentsParsed: true,
    finalResponseMessagePresent: true,
    finalResponseGroundedFactsCount: 3,
    nonFinalToolCallCount: 0,
    runtimeResponseKind: "error",
    literalFactCoverage: [false, false, false],
  });

  assert.equal(classification.providerApi, "SUCCESS");
  assert.equal(classification.providerGeneration, "SUCCESS");
  assert.equal(classification.toolCallStatus, "PARSED_FINAL_RESPONSE");
  assert.equal(classification.finalResponseValidation, "RUNTIME_REJECTED");
  assert.equal(
    classification.rejectionReason,
    "UNVERIFIED_GROUNDED_FACTS_WITH_NO_NONFINAL_TOOL_CALLS",
  );
  assert.equal(classification.benchmarkAssertion, "FAIL");
  assert.equal(classification.overall, "FINAL_RESPONSE_SAFETY_REJECTION");
});

test("accepts a parsed, runtime-approved answer when all benchmark facts match", () => {
  const classification = classifyBenchmarkRun({
    httpStatuses: [200],
    generationOutcomes: ["SUCCESS"],
    finalResponseCallCount: 1,
    finalResponseArgumentsParsed: true,
    finalResponseMessagePresent: true,
    finalResponseGroundedFactsCount: 0,
    nonFinalToolCallCount: 0,
    runtimeResponseKind: "answer",
    literalFactCoverage: [true, true, true],
  });

  assert.equal(classification.providerApi, "SUCCESS");
  assert.equal(classification.toolCallStatus, "PARSED_FINAL_RESPONSE");
  assert.equal(classification.finalResponseValidation, "ACCEPTED");
  assert.equal(classification.benchmarkAssertion, "PASS");
  assert.equal(classification.overall, "CORRECT_PROVIDER_RESPONSE");
});

test("keeps API failure distinct from an HTTP-success response that failed generation", () => {
  const apiFailure = classifyBenchmarkRun({
    httpStatuses: [503],
    generationOutcomes: ["FAIL"],
    finalResponseCallCount: 0,
    finalResponseArgumentsParsed: false,
    finalResponseMessagePresent: false,
    finalResponseGroundedFactsCount: 0,
    nonFinalToolCallCount: 0,
    runtimeResponseKind: null,
    literalFactCoverage: [false],
  });
  const adapterFailure = classifyBenchmarkRun({
    httpStatuses: [200],
    generationOutcomes: ["FAIL"],
    finalResponseCallCount: 0,
    finalResponseArgumentsParsed: false,
    finalResponseMessagePresent: false,
    finalResponseGroundedFactsCount: 0,
    nonFinalToolCallCount: 0,
    runtimeResponseKind: null,
    literalFactCoverage: [false],
  });

  assert.equal(apiFailure.overall, "PROVIDER_API_FAILURE");
  assert.equal(adapterFailure.providerApi, "SUCCESS");
  assert.equal(adapterFailure.overall, "PROVIDER_RESPONSE_OR_ADAPTER_FAILURE");
});

test("reports missing tool calls, malformed arguments, and assertion failures separately", () => {
  const missingToolCall = classifyBenchmarkRun({
    httpStatuses: [200],
    generationOutcomes: ["SUCCESS"],
    finalResponseCallCount: 0,
    finalResponseArgumentsParsed: false,
    finalResponseMessagePresent: false,
    finalResponseGroundedFactsCount: 0,
    nonFinalToolCallCount: 1,
    runtimeResponseKind: null,
    literalFactCoverage: [false],
  });
  const malformedArguments = classifyBenchmarkRun({
    httpStatuses: [200],
    generationOutcomes: ["SUCCESS"],
    finalResponseCallCount: 1,
    finalResponseArgumentsParsed: false,
    finalResponseMessagePresent: false,
    finalResponseGroundedFactsCount: 0,
    nonFinalToolCallCount: 0,
    runtimeResponseKind: "error",
    literalFactCoverage: [false],
  });
  const failedAssertion = classifyBenchmarkRun({
    httpStatuses: [200],
    generationOutcomes: ["SUCCESS"],
    finalResponseCallCount: 1,
    finalResponseArgumentsParsed: true,
    finalResponseMessagePresent: true,
    finalResponseGroundedFactsCount: 0,
    nonFinalToolCallCount: 0,
    runtimeResponseKind: "answer",
    literalFactCoverage: [true, false],
  });

  assert.equal(missingToolCall.overall, "TOOL_CALL_FAILURE");
  assert.equal(malformedArguments.overall, "FINAL_RESPONSE_PARSE_FAILURE");
  assert.equal(failedAssertion.finalResponseValidation, "ACCEPTED");
  assert.equal(failedAssertion.benchmarkAssertion, "FAIL");
  assert.equal(failedAssertion.overall, "BENCHMARK_ASSERTION_FAILURE");
});