import { createHash } from "node:crypto";
import { and, eq, inArray, sql, not } from "drizzle-orm";
import { db, tasksTable } from "@workspace/db";
import type { AgentWorkIdentity, AgentWorkRecord } from "./types";
import {
  compareCondition,
  comparisonOperator,
  type ComparisonOperator,
} from "./condition-evaluator";

type InternalRecordMetric = "open_task_count";

export type InternalRecordsSnapshot = {
  sourceType: "internal_records";
  entity: "tasks";
  metric: InternalRecordMetric;
  operator: ComparisonOperator;
  threshold: number;
  value: number;
  currency: null;
  sourceHash: string | null;
  conditionMet: boolean;
  comparisonKnown: boolean;
  reason: string;
};

export type InternalRecordsSourceRead = {
  snapshot: InternalRecordsSnapshot;
};

type GitHubComparisonOperator = ComparisonOperator;

export type GitHubRepositorySnapshot = {
  sourceType: "github_repository";
  provider: "github";
  repository: string;
  repositoryId: number;
  metric: "open_issues_count";
  operator: GitHubComparisonOperator;
  threshold: number;
  value: number;
  updatedAt: string;
  fetchedAt: string;
  responseDate: string | null;
  sourceHash: string;
  conditionMet: boolean;
  comparisonKnown: boolean;
  reason: string;
};

export type GitHubRepositorySourceRead =
  | { ok: true; snapshot: GitHubRepositorySnapshot; cooldownMs?: number }
  | { ok: false; reason: "invalid_configuration" | "source_unavailable" | "timeout" | "malformed_response" | "stale_data"; cooldownMs?: number };

export type GitHubRepositorySourceOptions = {
  fetchImpl?: typeof fetch;
  now?: Date;
  timeoutMs?: number;
  maxAgeMs?: number;
};

const GITHUB_COOLDOWN_DEFAULT_MS = 60_000;
const GITHUB_COOLDOWN_MIN_MS = 1_000;
const GITHUB_COOLDOWN_MAX_MS = 15 * 60_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function boundedCooldownMs(value: number): number {
  if (!Number.isFinite(value)) return GITHUB_COOLDOWN_DEFAULT_MS;
  return Math.min(
    GITHUB_COOLDOWN_MAX_MS,
    Math.max(GITHUB_COOLDOWN_MIN_MS, Math.ceil(value)),
  );
}

function retryAfterMs(response: Response, now: Date): number | null {
  const retryAfter = response.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const retryAt = Date.parse(retryAfter);
    if (!Number.isNaN(retryAt)) return retryAt - now.getTime();
  }

  const remaining = response.headers.get("x-ratelimit-remaining")?.trim();
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (remaining === "0" && Number.isFinite(reset) && reset > 0) {
    return reset * 1_000 - now.getTime();
  }
  return null;
}

function responseCooldownMs(response: Response, now: Date): number | undefined {
  const retryAfter = retryAfterMs(response, now);
  const remaining = response.headers.get("x-ratelimit-remaining")?.trim();
  const rateLimited = response.status === 429
    || remaining === "0"
    || retryAfter !== null;
  return rateLimited
    ? boundedCooldownMs(retryAfter ?? GITHUB_COOLDOWN_DEFAULT_MS)
    : undefined;
}

function hashSnapshot(input: {
  entity: string;
  metric: string;
  value: number;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function invalidSnapshot(
  operator: ComparisonOperator = "gt",
  threshold = 0,
  reason: string,
): InternalRecordsSourceRead {
  return {
    snapshot: {
      sourceType: "internal_records",
      entity: "tasks",
      metric: "open_task_count",
      operator,
      threshold,
      value: 0,
      currency: null,
      sourceHash: null,
      conditionMet: false,
      comparisonKnown: false,
      reason,
    },
  };
}

/**
 * The first production source is deliberately narrow: it reads only the
 * tenant-owned open task count. It never follows URLs, calls providers, or
 * performs a write.
 */
export async function readInternalRecordsSource(
  identity: AgentWorkIdentity,
  work: AgentWorkRecord,
): Promise<InternalRecordsSourceRead> {
  const condition = asRecord(work.condition);
  const entity = condition.entity;
  const metric = condition.metric;
  const operator = comparisonOperator(condition.operator);
  const threshold = Number(condition.threshold);
  if (
    entity !== "tasks"
    || metric !== "open_task_count"
    || !operator
    || !Number.isSafeInteger(threshold)
    || threshold < 0
  ) {
    return invalidSnapshot(operator ?? "gt", Number.isSafeInteger(threshold) && threshold >= 0 ? threshold : 0, "unsupported_condition");
  }

  const [row] = await db.select({
    value: sql<number>`count(*)::int`,
  }).from(tasksTable).where(and(
    eq(tasksTable.tenantId, identity.tenantId),
    eq(tasksTable.ownerUserId, identity.userId),
    not(inArray(tasksTable.status, ["completed", "cancelled"])),
  ));
  const value = Number(row?.value ?? 0);
  return {
    snapshot: {
      sourceType: "internal_records",
      entity: "tasks",
      metric: "open_task_count",
      operator,
      threshold,
      value,
      currency: null,
      sourceHash: hashSnapshot({ entity: "tasks", metric: "open_task_count", value }),
        conditionMet: compareCondition(value, operator, threshold),
      comparisonKnown: true,
      reason: "tenant_scoped_read_verified",
    },
  };
}

function githubRepositoryParts(work: AgentWorkRecord): {
  owner: string;
  repository: string;
  operator: ComparisonOperator;
  threshold: number;
} | null {
  const condition = asRecord(work.condition);
  const owner = typeof condition.owner === "string" ? condition.owner.trim() : "";
  const repository = typeof condition.repository === "string" ? condition.repository.trim() : "";
  const operator = comparisonOperator(condition.operator);
  const threshold = Number(condition.threshold);
  if (
    condition.provider !== "github"
    || condition.entity !== "repository"
    || condition.metric !== "open_issues_count"
    || !/^[A-Za-z0-9_.-]+$/u.test(owner)
    || !/^[A-Za-z0-9_.-]+$/u.test(repository)
    || !operator
    || !Number.isSafeInteger(threshold)
    || threshold < 0
  ) {
    return null;
  }
  return { owner, repository, operator, threshold };
}

export function applyGitHubRepositoryCondition(
  sourceRead: GitHubRepositorySourceRead,
  work: AgentWorkRecord,
): GitHubRepositorySourceRead {
  const parts = githubRepositoryParts(work);
  if (!parts) return { ok: false, reason: "invalid_configuration" };
  if (!sourceRead.ok) return sourceRead;
  return {
    ...sourceRead,
    snapshot: {
      ...sourceRead.snapshot,
      operator: parts.operator,
      threshold: parts.threshold,
       conditionMet: compareCondition(sourceRead.snapshot.value, parts.operator, parts.threshold),
    },
  };
}

/**
 * The external vertical slice is intentionally limited to GitHub's official
 * repository endpoint. It reads public repository metadata only and never
 * follows a user-provided URL or sends a mutation.
 */
export async function readGitHubRepositorySource(
  identity: AgentWorkIdentity,
  work: AgentWorkRecord,
  options: GitHubRepositorySourceOptions = {},
): Promise<GitHubRepositorySourceRead> {
  void identity;
  if (asRecord(work.source).type !== "github_repository") {
    return { ok: false, reason: "invalid_configuration" };
  }
  const parts = githubRepositoryParts(work);
  if (!parts) return { ok: false, reason: "invalid_configuration" };

  const now = options.now ?? new Date();
  const timeoutMs = Math.max(1_000, Math.floor(options.timeoutMs ?? 10_000));
  const maxAgeMs = Math.max(1_000, Math.floor(options.maxAgeMs ?? Number(process.env.GITHUB_MONITOR_MAX_AGE_MS ?? 10 * 60_000)));
  const repository = `${parts.owner}/${parts.repository}`;
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(parts.owner)}/${encodeURIComponent(parts.repository)}`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "Cache-Control": "no-cache",
        "User-Agent": "personal-secretary-agent-work-monitor",
      },
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    return { ok: false, reason: controller.signal.aborted || message.includes("timeout") ? "timeout" : "source_unavailable" };
  }
  clearTimeout(timeout);
  const cooldownMs = responseCooldownMs(response, now);

  if (!response.ok) {
    return {
      ok: false,
      reason: response.status === 408 || response.status === 504 ? "timeout" : "source_unavailable",
      ...(cooldownMs ? { cooldownMs } : {}),
    };
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    return {
      ok: false,
      reason: "malformed_response",
      ...(cooldownMs ? { cooldownMs } : {}),
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      reason: "malformed_response",
      ...(cooldownMs ? { cooldownMs } : {}),
    };
  }
  const body = asRecord(payload);
  const repositoryId = Number(body.id);
  const fullName = typeof body.full_name === "string" ? body.full_name : "";
  const value = Number(body.open_issues_count);
  const updatedAt = typeof body.updated_at === "string" ? body.updated_at : "";
  const updatedTime = Date.parse(updatedAt);
  if (
    !Number.isSafeInteger(repositoryId)
    || repositoryId <= 0
    || fullName.toLowerCase() !== repository.toLowerCase()
    || !Number.isSafeInteger(value)
    || value < 0
    || !updatedAt
    || Number.isNaN(updatedTime)
  ) {
    return {
      ok: false,
      reason: "malformed_response",
      ...(cooldownMs ? { cooldownMs } : {}),
    };
  }

  const responseDate = response.headers.get("date");
  if (responseDate) {
    const responseTime = Date.parse(responseDate);
    if (Number.isNaN(responseTime) || now.getTime() - responseTime > maxAgeMs) {
      return {
        ok: false,
        reason: "stale_data",
        ...(cooldownMs ? { cooldownMs } : {}),
      };
    }
  }

  const sourceHash = hashSnapshot({
    entity: repository,
    metric: "open_issues_count",
    value,
  });
  return {
    ok: true,
    snapshot: {
      sourceType: "github_repository",
      provider: "github",
      repository,
      repositoryId,
      metric: "open_issues_count",
      operator: parts.operator,
      threshold: parts.threshold,
      value,
      updatedAt,
      fetchedAt: now.toISOString(),
      responseDate,
      sourceHash,
       conditionMet: compareCondition(value, parts.operator, parts.threshold),
      comparisonKnown: true,
      reason: "github_api_read_verified",
    },
    ...(cooldownMs ? { cooldownMs } : {}),
  };
}

export type GitHubReadContext = {
  cooldowns: Map<string, number>;
  reads: Map<string, Promise<GitHubRepositorySourceRead>>;
};

function githubRepositoryReadKey(
  identity: AgentWorkIdentity,
  work: AgentWorkRecord,
): string {
  const condition = asRecord(work.condition);
  const operator = typeof condition.operator === "string" && comparisonOperator(condition.operator)
    ? "__valid_operator__"
    : condition.operator;
  const threshold = Number(condition.threshold);
  const thresholdKey = Number.isSafeInteger(threshold) && threshold >= 0
    ? "__valid_threshold__"
    : condition.threshold;
  return JSON.stringify([
    identity.tenantId,
    identity.userId,
    condition.provider,
    condition.entity,
    condition.metric,
    typeof condition.owner === "string" ? condition.owner.trim().toLowerCase() : "",
    typeof condition.repository === "string" ? condition.repository.trim().toLowerCase() : "",
    operator,
    thresholdKey,
  ]);
}

export async function readGitHubRepositoryWithSafeguards(
  identity: AgentWorkIdentity,
  work: AgentWorkRecord,
  now: Date,
  context?: GitHubReadContext,
): Promise<GitHubRepositorySourceRead> {
  if (!context) return readGitHubRepositorySource(identity, work, { now });

  const key = githubRepositoryReadKey(identity, work);
  const nowMs = now.getTime();
  let read = context.reads.get(key);
  if (read) {
    const sourceRead = await read;
    if (sourceRead.cooldownMs) {
      const nextCooldownUntil = nowMs + sourceRead.cooldownMs;
      const currentCooldownUntil = context.cooldowns.get(key) ?? 0;
      context.cooldowns.set(key, Math.max(currentCooldownUntil, nextCooldownUntil));
    }
    return applyGitHubRepositoryCondition(sourceRead, work);
  }

  const cooldownUntil = context.cooldowns.get(key);
  if (cooldownUntil !== undefined) {
    if (cooldownUntil > nowMs) {
      return { ok: false, reason: "source_unavailable" };
    }
    context.cooldowns.delete(key);
  }

  read = readGitHubRepositorySource(identity, work, { now });
  context.reads.set(key, read);
  const sourceRead = await read;
  if (sourceRead.cooldownMs) {
    const nextCooldownUntil = nowMs + sourceRead.cooldownMs;
    const currentCooldownUntil = context.cooldowns.get(key) ?? 0;
    context.cooldowns.set(key, Math.max(currentCooldownUntil, nextCooldownUntil));
  }
  return applyGitHubRepositoryCondition(sourceRead, work);
}