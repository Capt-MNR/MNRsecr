import { featureFlags } from "./feature-flags";
import { routeLocally, type LocalRouteDecision } from "./local-router";

export type DeterministicPlan = {
  kind: "tool" | "clarification" | "none";
  toolName?: string;
  args?: Record<string, unknown>;
  confidence: number;
  explanation: string;
  source: "deterministic";
};

export function buildDeterministicPlan(message: string): DeterministicPlan | null {
  if (!featureFlags.deterministicPlans()) return null;
  const route: LocalRouteDecision | null = routeLocally(message);
  if (!route) return null;
  if (route.intent === "clarification") {
    return {
      kind: "clarification",
      confidence: route.confidence,
      explanation: route.reason,
      source: "deterministic",
    };
  }
  if (!route.safeToExecute || !route.toolName) {
    return {
      kind: "none",
      confidence: route.confidence,
      explanation: route.reason,
      source: "deterministic",
    };
  }
  return {
    kind: "tool",
    toolName: route.toolName,
    args: route.args,
    confidence: route.confidence,
    explanation: route.reason,
    source: "deterministic",
  };
}

export function deterministicPlanKey(plan: DeterministicPlan): string {
  return JSON.stringify({
    kind: plan.kind,
    toolName: plan.toolName,
    args: plan.args,
  });
}