import { createHash } from "node:crypto";

export type AuthAttemptKind = "login" | "signup" | "refresh";

type AuthAbuseInput = {
  kind: AuthAttemptKind;
  ip: string;
  identity?: string | null;
  now?: number;
};

type AuthAbuseDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const DEFAULT_WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const rules: Record<AuthAttemptKind, { ip: number; identity: number }> = {
  login: { ip: 30, identity: 8 },
  signup: { ip: 12, identity: 4 },
  refresh: { ip: 30, identity: 10 },
};

const buckets = new Map<string, Bucket>();

function configuredWindowMs(): number {
  const value = Number(process.env.AUTH_ABUSE_WINDOW_MS);
  if (!Number.isFinite(value)) return DEFAULT_WINDOW_MS;
  return Math.min(60 * 60_000, Math.max(1_000, Math.floor(value)));
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function evictExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function consume(key: string, limit: number, now: number, windowMs: number): AuthAbuseDecision {
  const current = buckets.get(key);
  if (current && current.resetAt <= now) {
    buckets.delete(key);
  }
  const bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) {
      return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1_000) };
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (bucket.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function requestIp(input: AuthAbuseInput): string {
  const value = input.ip.trim();
  return value || "unknown";
}

/**
 * A bounded, process-local guard for the current API runtime. It deliberately
 * uses both the observed client address and a hashed login/refresh identity:
 * rotating either dimension alone cannot avoid the other limit. No raw
 * credentials or email values are retained in the map.
 */
export function checkAuthAbuse(input: AuthAbuseInput): AuthAbuseDecision {
  const now = input.now ?? Date.now();
  const windowMs = configuredWindowMs();
  evictExpired(now);
  const rule = rules[input.kind];
  const ipDecision = consume(`${input.kind}:ip:${requestIp(input)}`, rule.ip, now, windowMs);
  if (!ipDecision.allowed) return ipDecision;
  if (!input.identity?.trim()) return ipDecision;
  const identityDecision = consume(
    `${input.kind}:identity:${digest(input.identity.trim().toLowerCase())}`,
    rule.identity,
    now,
    windowMs,
  );
  if (!identityDecision.allowed) return identityDecision;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetAuthAbuseForTests(): void {
  buckets.clear();
}