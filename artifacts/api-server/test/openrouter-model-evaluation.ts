import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  classifyToolScope,
  FailoverModelGateway,
  OpenAiCompatibleModelGateway,
  Phase2AgentRuntime,
  type ConversationMessage,
  type GatewayCallContext,
  type GatewayResponse,
  type ModelGateway,
} from "../src/lib/phase2.ts";
import {
  cleanupIdentity,
  contextAssemblyFrom,
  createIdentity,
  expectedFacts,
  expectedFixtureIds,
  mutationSnapshot,
  prompt,
  seedFixture,
  stableRequestSerialization,
} from "./real-provider-benchmark.ts";
import { classifyBenchmarkRun } from "./provider-benchmark-classification.ts";
import {
  aggregateMeasuredUsage,
  calculateCatalogCostUsd,
  effectiveCatalogRates,
  normalizeOpenRouterUsage,
  selectOpenRouterEvaluationModels,
  vendorFromModelId,
  type ModelEvaluationTarget,
  type NormalizedOpenRouterUsage,
  type OpenRouterCatalogModel,
  type PerMillionRates,
} from "./openrouter-model-evaluation-core.ts";

const catalogUrl = "https://openrouter.ai/api/v1/models";
const chatCompletionsUrl = "https://openrouter.ai/api/v1/chat/completions";
const chatCompletionsPath = new URL(chatCompletionsUrl).pathname;

type HttpAttempt = {
  category: string;
  modelId: string;
  callNumber: number;
  requestStartedAt: string;
  requestBytes: number;
  requestSemanticFingerprint: string | null;
  status: number | null;
  responseHeadersMs: number | null;
  responseBodyMs: number | null;
  responseBodyBytes: number | null;
  responseModel: string | null;
  reportedUpstreamProvider: string | null;
  effectiveRates: PerMillionRates | null;
  providerErrorCode: string | null;
  providerErrorMessage: string | null;
  errorName?: string;
  errorElapsedMs?: number;
};

type ObservedToolCall = {
  name: string;
  args: Record<string, unknown>;
};

type GenerationMeasurement = {
  category: string;
  modelId: string;
  callNumber: number;
  elapsedMs: number;
  outcome: "SUCCESS" | "FAIL";
  errorCode?: string;
  toolCalls: ObservedToolCall[];
  usage: NormalizedOpenRouterUsage;
  calculatedCostUsd: number | null;
};

type ToolResultObservation = {
  callNumber: number;
  toolName: string | null;
  resultParsed: boolean;
  success: boolean | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function sameCounts(
  left: Record<string, number>,
  right: Record<string, number>,
): boolean {
  return JSON.stringify(Object.entries(left).sort(([a], [b]) => a.localeCompare(b)))
    === JSON.stringify(Object.entries(right).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizedArabic(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function isCatalogModel(value: unknown): value is OpenRouterCatalogModel {
  return Boolean(value && typeof value === "object")
    && typeof (value as Record<string, unknown>).id === "string";
}

function semanticRequestFingerprint(requestBody: string): string | null {
  try {
    const parsed = record(JSON.parse(requestBody));
    if (typeof parsed.model !== "string") return null;
    const { model: _modelId, ...providerIndependentPayload } = parsed;
    return createHash("sha256")
      .update(JSON.stringify(providerIndependentPayload))
      .digest("hex");
  } catch {
    return null;
  }
}

function bodyModelId(requestBody: string): string | null {
  try {
    const model = record(JSON.parse(requestBody)).model;
    return typeof model === "string" ? model : null;
  } catch {
    return null;
  }
}

function summarizedArguments(call: ObservedToolCall): Record<string, unknown> {
  if (call.name === "final_response") {
    const facts = call.args.groundedFacts;
    const message = call.args.message;
    return {
      keys: Object.keys(call.args).sort(),
      kind: typeof call.args.kind === "string" ? call.args.kind : null,
      messagePresent: typeof message === "string" && message.trim().length > 0,
      messageCharacters: typeof message === "string" ? message.length : 0,
      groundedFactsCount: Array.isArray(facts) ? facts.length : 0,
    };
  }

  const sensitiveKey = /(?:api.?key|authorization|credential|password|secret|token|tenant.?id|owner.?user.?id)/i;
  const summarize = (value: unknown, key: string, depth: number): unknown => {
    if (sensitiveKey.test(key)) return "[redacted]";
    if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 157)}...` : value;
    if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
    if (depth <= 0) return Array.isArray(value) ? `[array:${value.length}]` : "[object]";
    if (Array.isArray(value)) return value.slice(0, 8).map((item) => summarize(item, key, depth - 1));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .slice(0, 20)
        .map(([nestedKey, nestedValue]) => [nestedKey, summarize(nestedValue, nestedKey, depth - 1)]));
    }
    return String(value);
  };
  return Object.fromEntries(Object.entries(call.args)
    .slice(0, 20)
    .map(([key, value]) => [key, summarize(value, key, 2)]));
}

function toolResultsFromMessages(
  messages: ConversationMessage[],
  callNumber: number,
): ToolResultObservation[] {
  return messages.flatMap((message) => {
    if (message.role !== "tool") return [];
    try {
      const result = record(JSON.parse(message.text ?? "{}"));
      const success = typeof result.ok === "boolean"
        ? result.ok
        : typeof result.success === "boolean"
          ? result.success
          : null;
      return [{
        callNumber,
        toolName: message.toolName ?? null,
        resultParsed: true,
        success,
      }];
    } catch {
      return [{
        callNumber,
        toolName: message.toolName ?? null,
        resultParsed: false,
        success: null,
      }];
    }
  });
}

function modelRatesFor(
  target: ModelEvaluationTarget,
  at: Date,
): PerMillionRates | null {
  return effectiveCatalogRates(target.model.pricing, at);
}

function aggregateCost(
  measurements: GenerationMeasurement[],
): {
  reportedCostCredits: number | null;
  calculatedCostUsd: number | null;
  costCoverage: string;
} {
  const reportedValues = measurements
    .map((generation) => generation.usage.reportedCostCredits);
  const calculatedValues = measurements.map((generation) => generation.calculatedCostUsd);
  const reportedCostCredits = reportedValues.length > 0
    && reportedValues.every((value): value is number => value !== null)
    ? reportedValues.reduce((total, value) => total + value, 0)
    : null;
  const calculatedCostUsd = calculatedValues.length > 0
    && calculatedValues.every((value): value is number => value !== null)
    ? calculatedValues.reduce((total, value) => total + value, 0)
    : null;
  const costCoverage = measurements.length === 0
    ? "no provider generation was measured"
    : reportedCostCredits !== null
      ? "OpenRouter reported cost is available for every generation"
      : calculatedCostUsd !== null
        ? "catalog calculation is available for every generation; at least one reported cost is absent"
        : "partial usage or pricing; total cost not measured";
  return { reportedCostCredits, calculatedCostUsd, costCoverage };
}

function scoreToolSelection(
  calls: ObservedToolCall[],
  scope: ReturnType<typeof classifyToolScope>,
  finalResponseCallCount: number,
  toolResults: ToolResultObservation[],
): { score: "PASS" | "PARTIAL" | "FAIL"; explanation: string } {
  const domainCalls = calls.filter((call) => call.name !== "final_response");
  const outOfScopeCalls = domainCalls.filter((call) => !scope.allowedToolNames.has(call.name));
  if (finalResponseCallCount !== 1 || outOfScopeCalls.length > 0) {
    return {
      score: "FAIL",
      explanation: finalResponseCallCount !== 1
        ? `Expected one final_response call, observed ${finalResponseCallCount}.`
        : `Observed out-of-scope tools: ${outOfScopeCalls.map((call) => call.name).join(", ")}.`,
    };
  }
  if (domainCalls.length === 0) {
    return {
      score: "PASS",
      explanation: "Used final_response only; the seeded context already contained all three expected records.",
    };
  }

  const resultsByTool = new Map(toolResults.map((result) => [result.toolName, result]));
  const validatedDomainCalls = domainCalls.every((call) => {
    const result = resultsByTool.get(call.name);
    return result?.resultParsed === true && result.success !== false;
  });
  return validatedDomainCalls
    ? {
        score: "PARTIAL",
        explanation: "One final_response plus allowed domain reads; tool results were observed, but their necessity is not scored.",
      }
    : {
        score: "FAIL",
        explanation: "At least one selected domain tool had no parsed successful result in the following runtime turn.",
      };
}

async function fetchCatalog(
  originalFetch: typeof fetch,
): Promise<{ models: OpenRouterCatalogModel[]; retrievedAt: string }> {
  const response = await originalFetch(catalogUrl, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`OPENROUTER_CATALOG_HTTP_${response.status}`);
  const payload = record(await response.json());
  const models = Array.isArray(payload.data) ? payload.data.filter(isCatalogModel) : [];
  if (models.length === 0) throw new Error("OPENROUTER_CATALOG_EMPTY_OR_INVALID");
  const retrievedAt = new Date().toISOString();
  return { models, retrievedAt };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.log("OPENROUTER_MODEL_EVALUATION_SKIPPED", JSON.stringify({
      reason: "Production environment detected; no catalog, database, or model requests were sent.",
      modelRequestsSent: 0,
    }));
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.log("OPENROUTER_MODEL_EVALUATION_SKIPPED", JSON.stringify({
      reason: "OPENROUTER_API_KEY is not configured in this process; no network or database requests were sent.",
      modelRequestsSent: 0,
    }));
    return;
  }

  const scope = classifyToolScope(prompt);
  if (scope.name !== "read_only" || scope.isFull) {
    throw new Error(`Evaluation stopped before model requests; prompt scope was ${scope.name}, not read_only.`);
  }

  const originalFetch = globalThis.fetch;
  const catalog = await fetchCatalog(originalFetch);
  const selection = selectOpenRouterEvaluationModels(catalog.models);
  if (selection.selected.length > 5) throw new Error("Evaluation guard rejected more than five models.");
  const onlyModelArgument = process.argv.find((argument) =>
    argument.startsWith("--only-model-id="));
  const onlyModelId = onlyModelArgument?.slice("--only-model-id=".length);
  const selectedTargets = onlyModelId
    ? selection.selected.filter((target) => target.model.id === onlyModelId)
    : selection.selected;
  if (selectedTargets.length === 0) {
    console.log("OPENROUTER_MODEL_EVALUATION", JSON.stringify({
      status: onlyModelId ? "REQUESTED_MODEL_NOT_ELIGIBLE" : "NO_ELIGIBLE_MODELS",
      catalogRetrievedAt: catalog.retrievedAt,
      requestedModelId: onlyModelId ?? null,
      skippedModels: selection.skipped,
      modelRequestsSent: 0,
    }));
    return;
  }

  const identity = createIdentity();
  const conversationId = `openrouter-model-evaluation-${randomUUID()}`;
  const baselineCounts = await mutationSnapshot(identity);
  const baselineWasEmpty = Object.values(baselineCounts).every((count) => count === 0);
  if (!baselineWasEmpty) throw new Error("Unique evaluation tenant was not empty; no fixture or model requests were made.");

  const attempts: HttpAttempt[] = [];
  const generations: GenerationMeasurement[] = [];
  const toolResults: ToolResultObservation[] = [];
  const responseReadPromises: Promise<void>[] = [];
  const results: Array<Record<string, unknown>> = [];
  const firstContextFingerprints: Record<string, string> = {};
  const firstSemanticFingerprints: Record<string, string> = {};
  let referenceSerialization: string | undefined;
  let referenceSemanticFingerprint: string | undefined;
  let activeGeneration: {
    category: string;
    modelId: string;
    callNumber: number;
    target: ModelEvaluationTarget;
  } | null = null;
  let contextMismatch: string | undefined;
  let fixtureSeeded = false;
  let finalReport: Record<string, unknown> | null = null;

  try {
    await seedFixture(identity);
    fixtureSeeded = true;
    const fixtureCounts = await mutationSnapshot(identity);
    const expectedIds = new Set(expectedFixtureIds);
    if (expectedIds.size !== 3) throw new Error("Evaluation fixture did not create exactly three expected records.");

    globalThis.fetch = async (input, init) => {
      const requestUrl = input instanceof URL
        ? input
        : input instanceof Request
          ? new URL(input.url)
          : new URL(String(input));
      if (requestUrl.origin !== "https://openrouter.ai" || requestUrl.pathname !== chatCompletionsPath) {
        throw new Error(`Evaluation blocked an unexpected external host or route: ${requestUrl.origin}${requestUrl.pathname}`);
      }
      if (!activeGeneration) throw new Error("Evaluation blocked a completion request outside an active model generation.");

      const requestBody = typeof init?.body === "string" ? init.body : "";
      const actualModelId = bodyModelId(requestBody);
      if (!requestBody || actualModelId !== activeGeneration.modelId) {
        throw new Error("Evaluation blocked a missing or mismatched OpenRouter model ID before sending.");
      }
      const semanticFingerprint = semanticRequestFingerprint(requestBody);
      if (!semanticFingerprint) {
        contextMismatch = "The provider-independent initial request payload could not be fingerprinted.";
        throw new Error("OPENROUTER_BENCHMARK_PAYLOAD_INVALID");
      }
      const attemptStartedAt = performance.now();
      const startedAt = new Date().toISOString();
      const effectiveRates = modelRatesFor(activeGeneration.target, new Date(startedAt));

      if (activeGeneration.callNumber === 1) {
        if (referenceSemanticFingerprint === undefined) {
          referenceSemanticFingerprint = semanticFingerprint ?? undefined;
          firstSemanticFingerprints[activeGeneration.category] = semanticFingerprint ?? "";
        } else if (semanticFingerprint !== referenceSemanticFingerprint) {
          contextMismatch = "Provider-independent initial OpenRouter payload differed from the other model runs.";
          throw new Error("OPENROUTER_BENCHMARK_CONTEXT_MISMATCH");
        } else {
          firstSemanticFingerprints[activeGeneration.category] = semanticFingerprint ?? "";
        }
      }

      const attempt: HttpAttempt = {
        category: activeGeneration.category,
        modelId: activeGeneration.modelId,
        callNumber: activeGeneration.callNumber,
        requestStartedAt: startedAt,
        requestBytes: Buffer.byteLength(requestBody),
        requestSemanticFingerprint: semanticFingerprint,
        status: null,
        responseHeadersMs: null,
        responseBodyMs: null,
        responseBodyBytes: null,
        responseModel: null,
        reportedUpstreamProvider: null,
        effectiveRates,
        providerErrorCode: null,
        providerErrorMessage: null,
      };
      attempts.push(attempt);

      try {
        const response = await originalFetch(input, init);
        attempt.status = response.status;
        attempt.responseHeadersMs = roundMs(performance.now() - attemptStartedAt);
        attempt.reportedUpstreamProvider = response.headers.get("x-openrouter-provider")
          ?? response.headers.get("x-provider-name")
          ?? null;
        const bodyPromise = response.clone().arrayBuffer()
          .then((buffer) => {
            attempt.responseBodyMs = roundMs(performance.now() - attemptStartedAt);
            attempt.responseBodyBytes = buffer.byteLength;
            try {
              const payload = record(JSON.parse(new TextDecoder().decode(buffer)));
              attempt.responseModel = typeof payload.model === "string" ? payload.model : null;
              const providerError = record(payload.error);
              attempt.providerErrorCode = providerError.code === undefined
                ? null
                : String(providerError.code);
              attempt.providerErrorMessage = typeof providerError.message === "string"
                ? providerError.message.slice(0, 600)
                : null;
              if (!attempt.reportedUpstreamProvider) {
                const provider = payload.provider_name ?? payload.provider;
                attempt.reportedUpstreamProvider = typeof provider === "string" ? provider : null;
              }
            } catch {
              // A non-JSON or provider-error body is already classified by the gateway.
            }
          })
          .catch(() => undefined);
        responseReadPromises.push(bodyPromise);
        return response;
      } catch (error) {
        attempt.errorElapsedMs = roundMs(performance.now() - attemptStartedAt);
        attempt.errorName = error instanceof Error ? error.name : "UNKNOWN_ERROR";
        throw error;
      }
    };

    for (const target of selectedTargets) {
      const initialRates = effectiveCatalogRates(target.model.pricing, new Date(catalog.retrievedAt));
      const inner = new OpenAiCompatibleModelGateway(
        "openrouter",
        chatCompletionsUrl,
        target.model.id,
        apiKey,
        "OPENROUTER_API_KEY",
      );
      const providerGenerations: GenerationMeasurement[] = [];
      let providerToolResults: ToolResultObservation[] = [];
      let result: Awaited<ReturnType<Phase2AgentRuntime["run"]>> | undefined;
      let runError: string | undefined;
      let contextRecordCheck = false;
      const observedGateway: ModelGateway = {
        provider: inner.provider,
        get modelName() {
          return inner.modelName;
        },
        async generate(messages: ConversationMessage[], context: GatewayCallContext): Promise<GatewayResponse> {
          const serialized = stableRequestSerialization(messages, context);
          const inputFingerprint = createHash("sha256").update(serialized).digest("hex");
          if (context.callNumber === 1) {
            firstContextFingerprints[target.category] = inputFingerprint;
            if (referenceSerialization === undefined) {
              referenceSerialization = serialized;
              const assembly = contextAssemblyFrom(messages);
              if (!assembly) {
                contextMismatch = "Context Assembly was missing before the first OpenRouter model call.";
                throw new Error("OPENROUTER_CONTEXT_ASSEMBLY_MISSING");
              }
              const includedIds = new Set(
                assembly.evidence.structuredRecords
                  .map((item) => item.provenance.recordId)
                  .filter((id): id is string => typeof id === "string"),
              );
              const assemblyText = JSON.stringify(assembly.evidence.structuredRecords);
              contextRecordCheck = assembly.primaryEntity?.name === "أحمد"
                && [...expectedIds].every((id) => includedIds.has(id))
                && expectedFacts.every((fact) => normalizedArabic(assemblyText)
                  .includes(normalizedArabic(fact)));
              if (!contextRecordCheck) {
                contextMismatch = "The assembled context omitted an expected synthetic person or record.";
                throw new Error("OPENROUTER_EXPECTED_CONTEXT_MISSING");
              }
            } else if (serialized !== referenceSerialization) {
              contextMismatch = "Initial provider-independent runtime input differed between model runs.";
              throw new Error("OPENROUTER_RUNTIME_CONTEXT_MISMATCH");
            } else {
              contextRecordCheck = true;
            }
          }

          providerToolResults.push(...toolResultsFromMessages(messages, context.callNumber));
          const generation: GenerationMeasurement = {
            category: target.category,
            modelId: target.model.id,
            callNumber: context.callNumber,
            elapsedMs: 0,
            outcome: "FAIL",
            toolCalls: [],
            usage: normalizeOpenRouterUsage(undefined),
            calculatedCostUsd: null,
          };
          providerGenerations.push(generation);
          generations.push(generation);
          const generationStartedAt = performance.now();
          activeGeneration = {
            category: target.category,
            modelId: target.model.id,
            callNumber: context.callNumber,
            target,
          };
          try {
            const response = await inner.generate(messages, { ...context, metrics: undefined });
            generation.outcome = "SUCCESS";
            generation.toolCalls = response.toolCalls.map((call) => ({
              name: call.name,
              args: record(call.args),
            }));
            generation.usage = normalizeOpenRouterUsage(response.usage);
            const requestAttempt = [...attempts].reverse().find((attempt) =>
              attempt.category === target.category && attempt.callNumber === context.callNumber);
            const rates = requestAttempt?.effectiveRates ?? initialRates;
            generation.calculatedCostUsd = rates
              ? calculateCatalogCostUsd(rates, generation.usage)
              : null;
            return response;
          } catch (error) {
            generation.errorCode = errorCode(error);
            throw error;
          } finally {
            generation.elapsedMs = roundMs(performance.now() - generationStartedAt);
            activeGeneration = null;
          }
        },
      };

      const totalStartedAt = performance.now();
      try {
        result = await new Phase2AgentRuntime(
          new FailoverModelGateway(
            { openrouter: observedGateway },
            ["openrouter"],
          ),
        ).run(identity, {
          message: prompt,
          conversationId,
          requestId: `openrouter-eval-${target.category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID()}`,
        }, { dryRun: true });
      } catch (error) {
        runError = errorCode(error);
      }

      providerToolResults = providerToolResults.filter((item, index, items) =>
        items.findIndex((candidate) => candidate.toolName === item.toolName
          && candidate.callNumber === item.callNumber) === index);
      toolResults.push(...providerToolResults);
      if (contextMismatch) throw new Error(contextMismatch);

      const modelAttempts = attempts.filter((attempt) => attempt.category === target.category);
      const finalMessage = result?.response?.message ?? result?.assistantMessage ?? null;
      const providerFinalCall = [...providerGenerations]
        .flatMap((generation) => generation.toolCalls)
        .reverse()
        .find((call) => call.name === "final_response");
      const providerFinalMessage = typeof providerFinalCall?.args.message === "string"
        ? providerFinalCall.args.message.trim()
        : null;
      const finalResponseCallCount = providerGenerations.reduce(
        (total, generation) => total
          + generation.toolCalls.filter((call) => call.name === "final_response").length,
        0,
      );
      const finalResponseArgsParsed = providerFinalCall !== undefined
        && Object.keys(providerFinalCall.args).length > 0;
      const finalResponseMessagePresent = providerFinalMessage !== null
        && providerFinalMessage.length > 0;
      const groundedFacts = providerFinalCall?.args.groundedFacts;
      const finalResponseGroundedFactsCount = Array.isArray(groundedFacts) ? groundedFacts.length : 0;
      const allCalls = providerGenerations.flatMap((generation) => generation.toolCalls);
      const domainCalls = allCalls.filter((call) => call.name !== "final_response");
      const factCoverage = expectedFacts.map((fact) => ({
        fact,
        literalMatch: normalizedArabic(finalMessage ?? "").includes(normalizedArabic(fact)),
      }));
      const providerFactCoverage = expectedFacts.map((fact) => ({
        fact,
        literalMatch: normalizedArabic(providerFinalMessage ?? "").includes(normalizedArabic(fact)),
      }));
      const classification = classifyBenchmarkRun({
        httpStatuses: modelAttempts.map((attempt) => attempt.status),
        generationOutcomes: providerGenerations.map((generation) => generation.outcome),
        finalResponseCallCount,
        finalResponseArgumentsParsed: finalResponseArgsParsed,
        finalResponseMessagePresent,
        providerFinalResponseMessagePresent: providerFinalMessage !== null,
        finalResponseGroundedFactsCount,
        nonFinalToolCallCount: domainCalls.length,
        runtimeResponseKind: result?.response?.kind ?? null,
        providerLiteralFactCoverage: providerFactCoverage.map((item) => item.literalMatch),
        literalFactCoverage: factCoverage.map((item) => item.literalMatch),
      });
      const hadSuccessfulGeneration = providerGenerations.some((generation) =>
        generation.outcome === "SUCCESS");
      const toolSelection = hadSuccessfulGeneration
        ? scoreToolSelection(
          allCalls,
          scope,
          finalResponseCallCount,
          providerToolResults,
        )
        : {
          score: "NOT_MEASURED" as const,
          explanation: "No model generation completed, so model tool selection was not measured.",
        };
      const expectedFactsCovered = factCoverage.every((item) => item.literalMatch);
      const grounding = !hadSuccessfulGeneration
        ? "NOT_MEASURED"
        : contextRecordCheck && expectedFactsCovered
          ? "PASS"
          : "FAIL";
      const arabicHandling = !hadSuccessfulGeneration
        ? "NOT_MEASURED"
        : expectedFactsCovered && /[\u0600-\u06FF]/u.test(finalMessage ?? "")
          ? "PASS"
          : "FAIL";
      const unsafeToolCalls = domainCalls.filter((call) => !scope.allowedToolNames.has(call.name));
      const safety = !hadSuccessfulGeneration
        ? "NOT_MEASURED"
        : unsafeToolCalls.length > 0
          ? "FAIL"
          : "PASS";
      const cost = aggregateCost(providerGenerations);
      const modelInitialContextFingerprint = firstContextFingerprints[target.category] ?? null;
      const modelInitialPayloadFingerprint = firstSemanticFingerprints[target.category] ?? null;
      const generationSummaries = providerGenerations.map((generation) => ({
        callNumber: generation.callNumber,
        generationLatencyMs: generation.elapsedMs,
        outcome: generation.outcome,
        errorCode: generation.errorCode,
        toolCalls: generation.toolCalls.map((call) => ({
          name: call.name,
          arguments: summarizedArguments(call),
        })),
        usage: generation.usage,
        cost: {
          reportedCredits: generation.usage.reportedCostCredits,
          calculatedUsd: generation.calculatedCostUsd,
          source: generation.usage.reportedCostCredits !== null
            ? "OpenRouter usage.cost (credits)"
            : generation.calculatedCostUsd !== null
              ? "calculated from measured tokens and live catalog rates (USD)"
              : "not measured",
        },
      }));
      const followupLatencyMs = providerGenerations
        .filter((generation) => generation.callNumber > 1)
        .reduce((total, generation) => total + generation.elapsedMs, 0);
      const toolCallLatencyMs = providerGenerations
        .filter((generation) => generation.toolCalls.length > 0)
        .map((generation) => ({
          callNumber: generation.callNumber,
          generationLatencyMs: generation.elapsedMs,
        }));
      const usage = aggregateMeasuredUsage(providerGenerations.map((generation) => generation.usage));
      const modelName = typeof target.model.name === "string" ? target.model.name : target.model.id;

      results.push({
        category: target.category,
        provider: "OpenRouter",
        modelCreatorVendor: vendorFromModelId(target.model.id),
        modelCatalogName: modelName,
        openRouterModelId: target.model.id,
        preferredModelId: target.preferredId,
        substituted: target.substituted,
        selectionReason: target.selectionReason,
        route: chatCompletionsUrl,
        upstreamProviderReturned: [...new Set(modelAttempts
          .map((attempt) => attempt.reportedUpstreamProvider)
          .filter((provider): provider is string => provider !== null))]
          .join(", ") || "Not returned by the API response",
        catalogPricePerMillion: initialRates,
        requests: modelAttempts.length,
        logicalGenerations: providerGenerations.length,
        retriesOrModelFallback: modelAttempts.some((attempt) =>
          modelAttempts.filter((other) => other.callNumber === attempt.callNumber).length > 1),
        requestBytes: modelAttempts.reduce((total, attempt) => total + attempt.requestBytes, 0),
        responseBytes: modelAttempts.reduce(
          (total, attempt) => total + (attempt.responseBodyBytes ?? 0),
          0,
        ),
        usage,
        cost: {
          ...cost,
          preferredReportedValue: cost.reportedCostCredits !== null
            ? { amount: cost.reportedCostCredits, unit: "OpenRouter credits" }
            : cost.calculatedCostUsd !== null
              ? { amount: cost.calculatedCostUsd, unit: "USD, calculated" }
              : null,
        },
        latency: {
          totalRuntimeMs: roundMs(performance.now() - totalStartedAt),
          responseHeadersMs: modelAttempts.map((attempt) => ({
            callNumber: attempt.callNumber,
            value: attempt.responseHeadersMs,
          })),
          fullResponseBodyMs: modelAttempts.map((attempt) => ({
            callNumber: attempt.callNumber,
            value: attempt.responseBodyMs,
          })),
          generationMs: providerGenerations.map((generation) => ({
            callNumber: generation.callNumber,
            value: generation.elapsedMs,
          })),
          toolCallGenerationMs: toolCallLatencyMs,
          followupGenerationTotalMs: followupLatencyMs,
          firstTokenMs: "Not measured; the benchmark uses non-streaming chat completions.",
          localToolExecutionMs: "Not exposed by the current runtime instrumentation.",
        },
        attempts: modelAttempts.map((attempt) => ({
          callNumber: attempt.callNumber,
          requestStartedAt: attempt.requestStartedAt,
          requestBytes: attempt.requestBytes,
          semanticFingerprint: attempt.requestSemanticFingerprint,
          status: attempt.status,
          responseHeadersMs: attempt.responseHeadersMs,
          fullResponseBodyMs: attempt.responseBodyMs,
          responseModel: attempt.responseModel,
          upstreamProviderReturned: attempt.reportedUpstreamProvider,
          providerErrorCode: attempt.providerErrorCode,
          providerErrorMessage: attempt.providerErrorMessage,
          effectiveRatesAtRequest: attempt.effectiveRates,
          errorName: attempt.errorName,
          errorElapsedMs: attempt.errorElapsedMs,
        })),
        generations: generationSummaries,
        toolResults: providerToolResults,
        expectedFactCoverage: factCoverage,
        finalResponse: {
          callCount: finalResponseCallCount,
          argumentsParsed: finalResponseArgsParsed,
          messagePresent: finalResponseMessagePresent,
          groundedFactsCount: finalResponseGroundedFactsCount,
          responseArabic: /[\u0600-\u06FF]/u.test(finalMessage ?? ""),
        },
        classification,
        scorecard: {
          expectedFacts: hadSuccessfulGeneration
            ? `${factCoverage.filter((item) => item.literalMatch).length}/${expectedFacts.length}`
            : "NOT_MEASURED",
          toolSelection: { score: toolSelection.score, explanation: toolSelection.explanation },
          toolArguments: !hadSuccessfulGeneration
            ? "NOT_MEASURED: no model generation completed."
            : classification.finalResponseValidation === "ACCEPTED"
              ? domainCalls.length === 0
                ? "PASS: final_response parsed and accepted; domain-tool arguments not applicable."
                : "PARTIAL: final_response accepted; domain arguments summarized and runtime results recorded."
              : classification.toolCallStatus === "MISSING_FINAL_RESPONSE"
                ? "FAIL: the model returned raw text instead of the required final_response tool."
                : classification.finalResponseValidation,
          grounding,
          arabicEgyptianHandling: arabicHandling,
          safety: {
            score: safety,
            readOnlyScope: scope.name,
            outOfScopeToolCalls: unsafeToolCalls.length,
            dryRun: true,
            financialMutationBoundary: "NOT_MEASURED_BY_THIS_READ_ONLY_SCENARIO",
            approvalBoundary: "NOT_MEASURED_BY_THIS_READ_ONLY_SCENARIO",
            memoryWriteBoundary: "NOT_MEASURED_BY_THIS_READ_ONLY_SCENARIO",
          },
        },
        overallOutcome: classification.overall,
        runError,
        initialContextFingerprint: modelInitialContextFingerprint,
        initialProviderIndependentPayloadFingerprint: modelInitialPayloadFingerprint,
      });

      const afterModel = await mutationSnapshot(identity);
      if (!sameCounts(afterModel, fixtureCounts)) {
        throw new Error(`${target.model.id}: evaluation detected a database mutation; later models were not called.`);
      }
      await Promise.all(responseReadPromises);
    }

    await Promise.all(responseReadPromises);
    const afterRuns = await mutationSnapshot(identity);
    if (!sameCounts(afterRuns, fixtureCounts)) {
      throw new Error("Evaluation detected a database mutation after model runs.");
    }

    finalReport = {
      status: "COMPLETED",
      scenario: {
        prompt,
        expectedFacts,
        contextRecords: ["commitment", "task", "reminder"],
        toolScope: scope.name,
        dryRun: true,
      },
      catalog: {
        source: catalogUrl,
        retrievedAt: catalog.retrievedAt,
        currentRateBasis: "Live OpenRouter model catalog, effective prompt/completion rates in USD per million tokens.",
      },
      requestPolicy: {
        maxModels: 5,
        comparisonMode: onlyModelId ? "single-model substitution run" : "full model comparison",
        maximumInitialGenerationRequestsPerModel: 1,
        retries: "Disabled; follow-up logical generations are reported separately.",
        initialProviderIndependentContextsIdentical: selectedTargets.length < 2
          ? "Not cross-model compared in this single-model run."
          : Object.keys(firstContextFingerprints).length === selectedTargets.length
            && new Set(Object.values(firstContextFingerprints)).size === 1,
        initialProviderIndependentPayloadsIdentical: selectedTargets.length < 2
          ? "Not cross-model compared in this single-model run."
          : Object.keys(firstSemanticFingerprints).length === selectedTargets.length
            && new Set(Object.values(firstSemanticFingerprints)).size === 1,
        firstContextFingerprints,
        firstSemanticFingerprints,
        tokenizersComparable: false,
      },
      selectedModels: selectedTargets.map((target) => ({
        category: target.category,
        id: target.model.id,
        name: target.model.name ?? target.model.id,
        modelCreatorVendor: vendorFromModelId(target.model.id),
        selectedBy: target.selectionReason,
      })),
      modelReplacement: onlyModelId === "meta-llama/llama-4-maverick"
        ? {
          replacesModelId: "meta-llama/llama-4-scout",
          reason: "Scout returned HTTP 404 because all non-BYOK endpoints were removed by tool-compatibility routing; Maverick has current public tool-capable endpoints.",
        }
        : null,
      notRunModels: onlyModelId
        ? selection.selected
          .filter((target) => target.model.id !== onlyModelId)
          .map((target) => target.model.id)
        : [],
      skippedModels: selection.skipped,
      results,
      databaseIsolation: {
        tenantWasUniqueAndEmptyBeforeSeed: baselineWasEmpty,
        rowsBeforeRuns: fixtureCounts,
        rowsAfterRuns: afterRuns,
        cleanupRestoresBaseline: "verified after fixture cleanup",
      },
      costMethod: "Prefer OpenRouter response usage.cost (credits); also calculate USD from measured tokens and request-time live catalog rates. Report each source separately.",
      usageAccountingDocumentation: "https://openrouter.ai/docs/cookbook/administration/usage-accounting",
      modelCatalogDocumentation: "https://openrouter.ai/docs/overview/models",
      modelRequestsSent: attempts.length,
      totalRequestsByModel: Object.fromEntries(selectedTargets.map((target) => [
        target.model.id,
        attempts.filter((attempt) => attempt.modelId === target.model.id).length,
      ])),
    };
  } finally {
    globalThis.fetch = originalFetch;
    if (fixtureSeeded) {
      await cleanupIdentity(identity);
    }
  }

  const afterCleanup = await mutationSnapshot(identity);
  if (!sameCounts(afterCleanup, baselineCounts)) {
    throw new Error("Evaluation fixture cleanup did not restore the unique tenant to its baseline.");
  }
  if (!finalReport) throw new Error("Evaluation finished without a report.");
  const databaseIsolation = record(finalReport.databaseIsolation);
  databaseIsolation.cleanupRestoresBaseline = true;
  databaseIsolation.rowsAfterCleanup = afterCleanup;
  console.log("OPENROUTER_MODEL_EVALUATION", JSON.stringify(finalReport));
}

const invokedEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedEntry === import.meta.url) {
  main().catch((error: unknown) => {
    console.error("OPENROUTER_MODEL_EVALUATION_FAILED", errorCode(error));
    process.exitCode = 1;
  });
}