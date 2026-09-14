import { createHash } from "node:crypto";
import { featureFlags } from "./feature-flags";

export type DecisionCacheKind = "router" | "resolver" | "provider";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const DEFAULT_TTLS: Record<DecisionCacheKind, number> = {
  router: 10 * 60_000,
  resolver: 5 * 60_000,
  provider: 60_000,
};

const cache = new Map<string, CacheEntry<unknown>>();

function ttl(kind: DecisionCacheKind): number {
  const configured = Number.parseInt(process.env[`DECISION_CACHE_${kind.toUpperCase()}_TTL_MS`] ?? "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTLS[kind];
}

export function decisionCacheKey(
  kind: DecisionCacheKind,
  input: unknown,
  scope: { tenantId?: string; userId?: string } = {},
): string {
  const body = JSON.stringify({ kind, input, scope });
  return createHash("sha256").update(body).digest("hex");
}

export function readDecision<T>(key: string): T | undefined {
  if (!featureFlags.decisionCache()) return undefined;
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function writeDecision<T>(
  kind: DecisionCacheKind,
  key: string,
  value: T,
  options: { writable?: boolean } = {},
): boolean {
  if (!featureFlags.decisionCache() || options.writable) return false;
  cache.set(key, { value, expiresAt: Date.now() + ttl(kind) });
  return true;
}

export function invalidateDecision(key: string): void {
  cache.delete(key);
}

export function clearDecisionCache(): void {
  cache.clear();
}