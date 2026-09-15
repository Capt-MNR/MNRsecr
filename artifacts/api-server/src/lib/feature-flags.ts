const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export function envFlag(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return defaultValue;
  return ENABLED_VALUES.has(value.trim().toLowerCase());
}

export const featureFlags = {
  contextBudgeter: () => envFlag("CTX_BUDGETER_ENABLED", false),
  localRouter: () => envFlag("LOCAL_ROUTER_ENABLED", false),
  resolverShadow: () => envFlag("RESOLVER_SHADOW", true),
  deterministicPlans: () => envFlag("DETERMINISTIC_PLANS_ENABLED", false),
  deterministicIntelligence: () => envFlag("DETERMINISTIC_INTELLIGENCE_ENABLED", true),
  // The production-safe gate is intentionally separate from experimental intelligence.
  experimentalGeneralArabicUnderstanding: () => envFlag("EXPERIMENTAL_GENERAL_ARABIC_UNDERSTANDING_ENABLED", false),
  experimentalMemoryIntelligence: () => envFlag("EXPERIMENTAL_MEMORY_INTELLIGENCE_ENABLED", false),
  experimentalPatternInsights: () => envFlag("EXPERIMENTAL_PATTERN_INSIGHTS_ENABLED", false),
  experimentalProviderClaims: () => envFlag("EXPERIMENTAL_PROVIDER_CLAIMS_ENABLED", false),
  decisionCache: () => envFlag("DECISION_CACHE_ENABLED", false),
  providerRouting: () => envFlag("PROVIDER_ROUTING_ENABLED", false),
};