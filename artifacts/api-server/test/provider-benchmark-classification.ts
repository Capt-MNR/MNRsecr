export type BenchmarkGenerationOutcome = "SUCCESS" | "FAIL";

export type BenchmarkClassificationInput = {
  httpStatuses: Array<number | null>;
  generationOutcomes: BenchmarkGenerationOutcome[];
  finalResponseCallCount: number;
  finalResponseArgumentsParsed: boolean;
  finalResponseMessagePresent: boolean;
  providerFinalResponseMessagePresent: boolean;
  finalResponseGroundedFactsCount: number;
  nonFinalToolCallCount: number;
  runtimeResponseKind: string | null;
  providerLiteralFactCoverage: boolean[];
  literalFactCoverage: boolean[];
};

export type BenchmarkClassification = {
  providerApi: "SUCCESS" | "RECOVERED" | "FAILURE" | "NOT_SENT";
  providerGeneration: "SUCCESS" | "FAILED" | "NOT_RUN";
  toolCallStatus:
    | "PARSED_FINAL_RESPONSE"
    | "MISSING_FINAL_RESPONSE"
    | "MULTIPLE_FINAL_RESPONSES"
    | "ARGUMENT_PARSE_FAILURE"
    | "INVALID_FINAL_RESPONSE_ARGUMENTS"
    | "NOT_REACHED";
  finalResponseValidation:
    | "ACCEPTED"
    | "RUNTIME_REJECTED"
    | "NOT_REACHED";
  rejectionReason:
    | "UNVERIFIED_GROUNDED_FACTS_WITH_NO_NONFINAL_TOOL_CALLS"
    | "OTHER_RUNTIME_REJECTION"
    | null;
  providerResponseAssertion: "PASS" | "FAIL" | "NOT_APPLICABLE" | "NOT_RUN";
  providerExpectedFactsPassed: number;
  providerExpectedFactsTotal: number;
  benchmarkAssertion: "PASS" | "FAIL" | "NOT_APPLICABLE" | "NOT_RUN";
  expectedFactsPassed: number;
  expectedFactsTotal: number;
  overall:
    | "CORRECT_PROVIDER_RESPONSE"
    | "BENCHMARK_ASSERTION_FAILURE"
    | "FINAL_RESPONSE_SAFETY_REJECTION"
    | "FINAL_RESPONSE_PARSE_FAILURE"
    | "FINAL_RESPONSE_ARGUMENTS_INVALID"
    | "TOOL_CALL_FAILURE"
    | "PROVIDER_RESPONSE_OR_ADAPTER_FAILURE"
    | "PROVIDER_API_FAILURE"
    | "PROVIDER_REQUEST_NOT_SENT";
};

function isSuccessfulHttpStatus(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

export function classifyBenchmarkRun(
  input: BenchmarkClassificationInput,
): BenchmarkClassification {
  const successfulHttpAttempts = input.httpStatuses.filter(isSuccessfulHttpStatus).length;
  const providerApi: BenchmarkClassification["providerApi"] =
    input.httpStatuses.length === 0
      ? "NOT_SENT"
      : successfulHttpAttempts === 0
        ? "FAILURE"
        : successfulHttpAttempts === input.httpStatuses.length
          ? "SUCCESS"
          : "RECOVERED";

  const providerGeneration: BenchmarkClassification["providerGeneration"] =
    input.generationOutcomes.includes("SUCCESS")
      ? "SUCCESS"
      : input.generationOutcomes.length > 0
        ? "FAILED"
        : "NOT_RUN";

  let toolCallStatus: BenchmarkClassification["toolCallStatus"];
  if (providerGeneration !== "SUCCESS") {
    toolCallStatus = "NOT_REACHED";
  } else if (input.finalResponseCallCount === 0) {
    toolCallStatus = "MISSING_FINAL_RESPONSE";
  } else if (input.finalResponseCallCount > 1) {
    toolCallStatus = "MULTIPLE_FINAL_RESPONSES";
  } else if (!input.finalResponseArgumentsParsed) {
    toolCallStatus = "ARGUMENT_PARSE_FAILURE";
  } else if (!input.finalResponseMessagePresent) {
    toolCallStatus = "INVALID_FINAL_RESPONSE_ARGUMENTS";
  } else {
    toolCallStatus = "PARSED_FINAL_RESPONSE";
  }

  const finalResponseValidation: BenchmarkClassification["finalResponseValidation"] =
    toolCallStatus !== "PARSED_FINAL_RESPONSE" || input.runtimeResponseKind === null
      ? "NOT_REACHED"
      : input.runtimeResponseKind === "error"
        ? "RUNTIME_REJECTED"
        : "ACCEPTED";

  const rejectionReason: BenchmarkClassification["rejectionReason"] =
    finalResponseValidation !== "RUNTIME_REJECTED"
      ? null
      : input.finalResponseGroundedFactsCount > 0 && input.nonFinalToolCallCount === 0
        ? "UNVERIFIED_GROUNDED_FACTS_WITH_NO_NONFINAL_TOOL_CALLS"
        : "OTHER_RUNTIME_REJECTION";

  const providerExpectedFactsPassed = input.providerLiteralFactCoverage.filter(Boolean).length;
  const providerExpectedFactsTotal = input.providerLiteralFactCoverage.length;
  const providerResponseAssertion: BenchmarkClassification["providerResponseAssertion"] =
    !input.providerFinalResponseMessagePresent
      ? "NOT_RUN"
      : providerExpectedFactsTotal === 0
        ? "NOT_APPLICABLE"
        : providerExpectedFactsPassed === providerExpectedFactsTotal
          ? "PASS"
          : "FAIL";

  const expectedFactsPassed = input.literalFactCoverage.filter(Boolean).length;
  const expectedFactsTotal = input.literalFactCoverage.length;
  const benchmarkAssertion: BenchmarkClassification["benchmarkAssertion"] =
    input.runtimeResponseKind === null
      ? "NOT_RUN"
      : expectedFactsTotal === 0
        ? "NOT_APPLICABLE"
        : expectedFactsPassed === expectedFactsTotal
          ? "PASS"
          : "FAIL";

  let overall: BenchmarkClassification["overall"];
  if (providerApi === "NOT_SENT") {
    overall = "PROVIDER_REQUEST_NOT_SENT";
  } else if (providerApi === "FAILURE") {
    overall = "PROVIDER_API_FAILURE";
  } else if (providerGeneration === "FAILED") {
    overall = "PROVIDER_RESPONSE_OR_ADAPTER_FAILURE";
  } else if (providerGeneration !== "SUCCESS") {
    overall = "PROVIDER_REQUEST_NOT_SENT";
  } else if (toolCallStatus === "ARGUMENT_PARSE_FAILURE") {
    overall = "FINAL_RESPONSE_PARSE_FAILURE";
  } else if (toolCallStatus === "INVALID_FINAL_RESPONSE_ARGUMENTS") {
    overall = "FINAL_RESPONSE_ARGUMENTS_INVALID";
  } else if (toolCallStatus !== "PARSED_FINAL_RESPONSE") {
    overall = "TOOL_CALL_FAILURE";
  } else if (finalResponseValidation === "RUNTIME_REJECTED") {
    overall = "FINAL_RESPONSE_SAFETY_REJECTION";
  } else if (finalResponseValidation !== "ACCEPTED") {
    overall = "TOOL_CALL_FAILURE";
  } else if (benchmarkAssertion === "FAIL" || providerResponseAssertion === "FAIL") {
    overall = "BENCHMARK_ASSERTION_FAILURE";
  } else {
    overall = "CORRECT_PROVIDER_RESPONSE";
  }

  return {
    providerApi,
    providerGeneration,
    toolCallStatus,
    finalResponseValidation,
    rejectionReason,
    providerResponseAssertion,
    providerExpectedFactsPassed,
    providerExpectedFactsTotal,
    benchmarkAssertion,
    expectedFactsPassed,
    expectedFactsTotal,
    overall,
  };
}