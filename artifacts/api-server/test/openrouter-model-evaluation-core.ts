export type OpenRouterModelPricing = {
  prompt?: unknown;
  completion?: unknown;
  input_cache_read?: unknown;
  input_cache_write?: unknown;
  overrides?: unknown;
};

export type OpenRouterCatalogModel = {
  id: string;
  name?: string;
  description?: string;
  created?: number;
  pricing?: OpenRouterModelPricing;
  supported_parameters?: string[];
  context_length?: number;
  top_provider?: Record<string, unknown> | null;
};

export type ModelEvaluationTarget = {
  category: string;
  preferredId: string;
  model: OpenRouterCatalogModel;
  substituted: boolean;
  selectionReason: string;
};

export type SkippedModelTarget = {
  category: string;
  preferredId: string;
  reason: string;
};

export type PerMillionRates = {
  input: number;
  output: number;
  cachedInput: number;
  cacheWrite: number;
  effectiveAt: string;
  source: "catalog_base" | "catalog_override";
};

export type NormalizedOpenRouterUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  reasoningTokens: number | null;
  reportedCostCredits: number | null;
};

type TargetRule = {
  category: string;
  preferredId: string;
  matches: (model: OpenRouterCatalogModel) => boolean;
  fallbackPreference: (model: OpenRouterCatalogModel) => number;
};

const targets: TargetRule[] = [
  {
    category: "OpenAI GPT-OSS",
    preferredId: "openai/gpt-oss-20b",
    matches: (model) => model.id.startsWith("openai/") && /gpt[- ]oss/i.test(model.id + " " + model.name),
    fallbackPreference: () => 0,
  },
  {
    category: "Google Gemini Flash",
    preferredId: "google/gemini-3.1-flash-lite",
    matches: (model) => model.id.startsWith("google/") && /gemini/i.test(model.id + " " + model.name)
      && /flash/i.test(model.id + " " + model.name),
    fallbackPreference: (model) => /flash[\s-]*lite/i.test(model.id + " " + model.name) ? 2 : 1,
  },
  {
    category: "DeepSeek",
    preferredId: "deepseek/deepseek-v4.1-flash",
    matches: (model) => model.id.startsWith("deepseek/") && /deepseek/i.test(model.id + " " + model.name),
    fallbackPreference: (model) => /flash/i.test(model.id + " " + model.name) ? 2 : 1,
  },
  {
    category: "Qwen",
    preferredId: "qwen/qwen3.8-flash",
    matches: (model) => model.id.startsWith("qwen/") && /qwen/i.test(model.id + " " + model.name),
    fallbackPreference: (model) => /flash/i.test(model.id + " " + model.name) ? 2 : 1,
  },
  {
    category: "Meta Llama",
    preferredId: "meta-llama/llama-4-maverick",
    matches: (model) => model.id.startsWith("meta-llama/") && /llama/i.test(model.id + " " + model.name)
      && !/guard|moderation|embedding|rerank/i.test(model.id + " " + model.name),
    fallbackPreference: (model) => /instruct|chat|scout|maverick/i.test(
      model.id + " " + model.name + " " + model.description,
    ) ? 2 : 1,
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isStableCatalogEntry(model: OpenRouterCatalogModel): boolean {
  const description = model.description ?? "";
  return !/(?:preview|experimental|deprecated|beta|:batch|:free|\bexp\b)/i.test(
    `${model.id} ${model.name ?? ""} ${description}`,
  );
}

function hasToolSupport(model: OpenRouterCatalogModel): boolean {
  return model.supported_parameters?.includes("tools") === true;
}

function hasCatalogPricing(model: OpenRouterCatalogModel): boolean {
  const prompt = finiteNumber(model.pricing?.prompt);
  const completion = finiteNumber(model.pricing?.completion);
  return prompt !== null && prompt > 0 && completion !== null && completion > 0;
}

function isEligible(model: OpenRouterCatalogModel): boolean {
  return isStableCatalogEntry(model) && hasToolSupport(model) && hasCatalogPricing(model);
}

export function selectOpenRouterEvaluationModels(
  catalog: OpenRouterCatalogModel[],
): { selected: ModelEvaluationTarget[]; skipped: SkippedModelTarget[] } {
  const selected: ModelEvaluationTarget[] = [];
  const skipped: SkippedModelTarget[] = [];
  const usedIds = new Set<string>();

  for (const target of targets) {
    const preferred = catalog.find((model) => model.id === target.preferredId);
    if (preferred && isEligible(preferred) && !usedIds.has(preferred.id)) {
      selected.push({
        category: target.category,
        preferredId: target.preferredId,
        model: preferred,
        substituted: false,
        selectionReason: "Exact preferred model ID is current, stable, tool-capable, and priced.",
      });
      usedIds.add(preferred.id);
      continue;
    }

    const exactIssue = !preferred
      ? "preferred ID is absent from the live catalog"
      : !isStableCatalogEntry(preferred)
        ? "preferred ID is marked preview, experimental, beta, deprecated, batch, or free"
        : !hasToolSupport(preferred)
          ? "preferred ID does not advertise tool support"
          : !hasCatalogPricing(preferred)
            ? "preferred ID has no positive input/output catalog rates"
            : "preferred ID was already selected for another category";

    const candidates = catalog
      .filter((model) => target.matches(model) && isEligible(model) && !usedIds.has(model.id))
      .sort((left, right) => {
        const preference = target.fallbackPreference(right) - target.fallbackPreference(left);
        if (preference !== 0) return preference;
        return (right.created ?? 0) - (left.created ?? 0);
      });
    const fallback = candidates[0];
    if (!fallback) {
      skipped.push({
        category: target.category,
        preferredId: target.preferredId,
        reason: `${exactIssue}; no stable, priced, tool-capable catalog substitute was available.`,
      });
      continue;
    }

    selected.push({
      category: target.category,
      preferredId: target.preferredId,
      model: fallback,
      substituted: true,
      selectionReason: `${exactIssue}; selected the closest stable catalog match ${fallback.id}.`,
    });
    usedIds.add(fallback.id);
  }

  return { selected: selected.slice(0, 5), skipped };
}

const utcWeekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function overrideMatches(override: Record<string, unknown>, at: Date): boolean {
  const days = Array.isArray(override.utc_days)
    ? override.utc_days.filter((day): day is string => typeof day === "string").map((day) => day.toLowerCase())
    : null;
  const weekday = utcWeekdays[at.getUTCDay()];
  if (days && !days.includes(weekday)) return false;

  const start = finiteNumber(override.utc_start);
  const end = finiteNumber(override.utc_end);
  if (start === null || end === null) return true;
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes();
  if (start === end) return true;
  return start < end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}

export function effectiveCatalogRates(
  pricing: OpenRouterModelPricing | undefined,
  at: Date,
): PerMillionRates | null {
  const basePrompt = finiteNumber(pricing?.prompt);
  const baseCompletion = finiteNumber(pricing?.completion);
  if (basePrompt === null || baseCompletion === null) return null;

  const overrides = Array.isArray(pricing?.overrides)
    ? pricing.overrides.map(asRecord)
    : [];
  const matchingOverride = overrides.find((override) => overrideMatches(override, at));
  const prompt = matchingOverride
    ? finiteNumber(matchingOverride.prompt) ?? basePrompt
    : basePrompt;
  const completion = matchingOverride
    ? finiteNumber(matchingOverride.completion) ?? baseCompletion
    : baseCompletion;
  const cachedInput = matchingOverride
    ? finiteNumber(matchingOverride.input_cache_read)
      ?? finiteNumber(pricing?.input_cache_read)
      ?? prompt
    : finiteNumber(pricing?.input_cache_read) ?? prompt;
  const cacheWrite = matchingOverride
    ? finiteNumber(matchingOverride.input_cache_write)
      ?? finiteNumber(pricing?.input_cache_write)
      ?? prompt
    : finiteNumber(pricing?.input_cache_write) ?? prompt;

  return {
    input: prompt * 1_000_000,
    output: completion * 1_000_000,
    cachedInput: cachedInput * 1_000_000,
    cacheWrite: cacheWrite * 1_000_000,
    effectiveAt: at.toISOString(),
    source: matchingOverride ? "catalog_override" : "catalog_base",
  };
}

export function normalizeOpenRouterUsage(value: unknown): NormalizedOpenRouterUsage {
  const usage = asRecord(value);
  const promptDetails = asRecord(usage.prompt_tokens_details);
  const completionDetails = asRecord(usage.completion_tokens_details);
  const inputTokens = finiteNumber(usage.prompt_tokens) ?? finiteNumber(usage.input_tokens);
  const outputTokens = finiteNumber(usage.completion_tokens) ?? finiteNumber(usage.output_tokens);
  const totalTokens = finiteNumber(usage.total_tokens)
    ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens: finiteNumber(promptDetails.cached_tokens)
      ?? finiteNumber(usage.cached_tokens),
    cacheWriteInputTokens: finiteNumber(promptDetails.cache_write_tokens),
    reasoningTokens: finiteNumber(completionDetails.reasoning_tokens),
    reportedCostCredits: finiteNumber(usage.cost),
  };
}

export function calculateCatalogCostUsd(
  rates: PerMillionRates,
  usage: NormalizedOpenRouterUsage,
): number | null {
  if (usage.inputTokens === null || usage.outputTokens === null) return null;
  const cached = Math.min(usage.inputTokens, usage.cachedInputTokens ?? 0);
  const cacheWrite = Math.min(
    Math.max(0, usage.inputTokens - cached),
    usage.cacheWriteInputTokens ?? 0,
  );
  const uncached = Math.max(0, usage.inputTokens - cached - cacheWrite);
  const inputCost = (
    uncached * rates.input
    + cached * rates.cachedInput
    + cacheWrite * rates.cacheWrite
  ) / 1_000_000;
  const outputCost = usage.outputTokens * rates.output / 1_000_000;
  return inputCost + outputCost;
}

export function aggregateMeasuredUsage(usages: NormalizedOpenRouterUsage[]): NormalizedOpenRouterUsage {
  const sum = (key: keyof NormalizedOpenRouterUsage): number | null => {
    const values = usages.map((usage) => usage[key]);
    if (values.length === 0 || values.some((value) => typeof value !== "number")) return null;
    return values.reduce((total, value) => total + (value as number), 0);
  };
  return {
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    totalTokens: sum("totalTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    cacheWriteInputTokens: sum("cacheWriteInputTokens"),
    reasoningTokens: sum("reasoningTokens"),
    reportedCostCredits: sum("reportedCostCredits"),
  };
}

export function vendorFromModelId(id: string): string {
  const prefix = id.split("/", 1)[0]?.toLowerCase();
  const vendors: Record<string, string> = {
    openai: "OpenAI",
    google: "Google",
    deepseek: "DeepSeek",
    qwen: "Qwen / Alibaba",
    "meta-llama": "Meta",
  };
  return prefix ? vendors[prefix] ?? "Not identified by catalog namespace" : "Not identified by catalog namespace";
}