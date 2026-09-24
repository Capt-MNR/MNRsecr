import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateMeasuredUsage,
  calculateCatalogCostUsd,
  effectiveCatalogRates,
  normalizeOpenRouterUsage,
  selectOpenRouterEvaluationModels,
  type OpenRouterCatalogModel,
} from "./openrouter-model-evaluation-core.ts";

const preferredIds = [
  "openai/gpt-oss-20b",
  "google/gemini-3.1-flash-lite",
  "deepseek/deepseek-v4.1-flash",
  "qwen/qwen3.8-flash",
  "meta-llama/llama-4-maverick",
];

function model(
  id: string,
  options: Partial<OpenRouterCatalogModel> = {},
): OpenRouterCatalogModel {
  return {
    id,
    name: id,
    created: 100,
    pricing: { prompt: "0.000001", completion: "0.000002" },
    supported_parameters: ["tools"],
    ...options,
  };
}

test("selects the five currently preferred, stable, priced tool models in priority order", () => {
  const selection = selectOpenRouterEvaluationModels(preferredIds.map((id) => model(id)));

  assert.deepEqual(selection.selected.map((item) => item.model.id), preferredIds);
  assert.deepEqual(selection.skipped, []);
  assert.equal(selection.selected.every((item) => !item.substituted), true);
});

test("uses the closest live stable substitute when an exact model lacks tool support", () => {
  const catalog = [
    model("openai/gpt-oss-20b"),
    model("google/gemini-3.1-flash-lite", { supported_parameters: [] }),
    model("google/gemini-3.5-flash-lite", { created: 200 }),
    model("google/gemini-3.8-flash", { created: 300 }),
    model("deepseek/deepseek-v4.1-flash"),
    model("qwen/qwen3.8-flash"),
    model("meta-llama/llama-4-scout"),
  ];
  const selection = selectOpenRouterEvaluationModels(catalog);
  const gemini = selection.selected.find((item) => item.category === "Google Gemini Flash");

  assert.equal(gemini?.model.id, "google/gemini-3.5-flash-lite");
  assert.equal(gemini?.substituted, true);
  assert.match(gemini?.selectionReason ?? "", /does not advertise tool support/);
});

test("skips catalog entries that are preview, batch, free, unpriced, or not tool-capable", () => {
  const catalog = [
    model("google/gemini-3.1-flash-lite:batch"),
    model("google/gemini-3.5-flash-preview"),
    model("deepseek/deepseek-v4.1-flash", { supported_parameters: [] }),
    model("qwen/qwen3.8-flash", { pricing: { prompt: "0", completion: "0" } }),
    model("meta-llama/llama-4-scout:free"),
  ];
  const selection = selectOpenRouterEvaluationModels(catalog);

  assert.equal(selection.selected.length, 0);
  assert.equal(selection.skipped.length, 5);
  assert.ok(selection.skipped.every((item) => item.reason.includes("no stable")));
});

test("applies the live catalog's UTC time-of-day price overrides", () => {
  const pricing = {
    prompt: "0.00000015",
    completion: "0.0000006",
    input_cache_read: "0.000000003",
    overrides: [
      {
        utc_days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        utc_start: 100,
        utc_end: 400,
        prompt: "0.0000003",
        completion: "0.0000012",
        input_cache_read: "0.000000006",
      },
    ],
  };

  const offPeak = effectiveCatalogRates(pricing, new Date("2026-09-24T23:04:00.000Z"));
  const peak = effectiveCatalogRates(pricing, new Date("2026-09-25T02:00:00.000Z"));

  assert.equal(offPeak?.source, "catalog_base");
  assert.equal(offPeak?.input, 0.15);
  assert.equal(offPeak?.output, 0.6);
  assert.equal(peak?.source, "catalog_override");
  assert.equal(peak?.input, 0.3);
  assert.equal(peak?.output, 1.2);
  assert.equal(peak?.cachedInput, 0.006);
});

test("normalizes OpenRouter token, cache, reasoning, and reported credit usage", () => {
  const usage = normalizeOpenRouterUsage({
    prompt_tokens: 100,
    completion_tokens: 40,
    total_tokens: 140,
    prompt_tokens_details: {
      cached_tokens: 20,
      cache_write_tokens: 10,
    },
    completion_tokens_details: { reasoning_tokens: 5 },
    cost: 0.00042,
  });

  assert.deepEqual(usage, {
    inputTokens: 100,
    outputTokens: 40,
    totalTokens: 140,
    cachedInputTokens: 20,
    cacheWriteInputTokens: 10,
    reasoningTokens: 5,
    reportedCostCredits: 0.00042,
  });
});

test("calculates catalog cost using cached-token rates and aggregates measured calls", () => {
  const rates = {
    input: 0.15,
    output: 0.6,
    cachedInput: 0.003,
    cacheWrite: 0.15,
    effectiveAt: "2026-09-24T23:04:00.000Z",
    source: "catalog_base" as const,
  };
  const first = normalizeOpenRouterUsage({
    prompt_tokens: 100,
    completion_tokens: 40,
    prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
    completion_tokens_details: { reasoning_tokens: 5 },
  });
  const second = normalizeOpenRouterUsage({
    prompt_tokens: 50,
    completion_tokens: 10,
  });

  assert.ok(Math.abs((calculateCatalogCostUsd(rates, first) ?? 0) - 0.00003606) < 1e-12);
  assert.deepEqual(aggregateMeasuredUsage([first, second]), {
    inputTokens: 150,
    outputTokens: 50,
    totalTokens: 200,
    cachedInputTokens: null,
    cacheWriteInputTokens: null,
    reasoningTokens: null,
    reportedCostCredits: null,
  });
});

test("marks aggregate usage unavailable when any generation omitted a measure", () => {
  const complete = normalizeOpenRouterUsage({
    prompt_tokens: 100,
    completion_tokens: 10,
    cost: 0.001,
  });
  const incomplete = normalizeOpenRouterUsage({ prompt_tokens: 50 });
  const aggregate = aggregateMeasuredUsage([complete, incomplete]);

  assert.equal(aggregate.inputTokens, 150);
  assert.equal(aggregate.outputTokens, null);
  assert.equal(aggregate.totalTokens, null);
  assert.equal(aggregate.reportedCostCredits, null);
});