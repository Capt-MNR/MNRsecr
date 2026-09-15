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
  decisionCache: () => envFlag("DECISION_CACHE_ENABLED", false),
  providerRouting: () => envFlag("PROVIDER_ROUTING_ENABLED", false),
};