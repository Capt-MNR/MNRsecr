import { createHash } from "node:crypto";
import { and, eq, inArray, sql, not } from "drizzle-orm";
import { db, tasksTable } from "@workspace/db";
import type { AgentWorkIdentity, AgentWorkRecord } from "./types";

type InternalRecordMetric = "open_task_count";
type ComparisonOperator = "gt" | "gte" | "eq" | "lt" | "lte";

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
  | { ok: true; snapshot: GitHubRepositorySnapshot }
  | { ok: false; reason: "invalid_configuration" | "source_unavailable" | "timeout" | "malformed_response" | "stale_data" };

export type GitHubRepositorySourceOptions = {
  fetchImpl?: typeof fetch;
  now?: Date;
  timeoutMs?: number;
  maxAgeMs?: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function comparisonOperator(value: unknown): ComparisonOperator | null {
  return value === "gt"
    || value === "gte"
    || value === "eq"
    || value === "lt"
    || value === "lte"
    ? value
    : null;
}

function compare(value: number, operator: ComparisonOperator, threshold: number): boolean {
  if (operator === "gt") return value > threshold;
  if (operator === "gte") return value >= threshold;
  if (operator === "eq") return value === threshold;
  if (operator === "lt") return value < threshold;
  return value <= threshold;
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
      conditionMet: compare(value, operator, threshold),
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

  if (!response.ok) {
    return { ok: false, reason: response.status === 408 || response.status === 504 ? "timeout" : "source_unavailable" };
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    return { ok: false, reason: "malformed_response" };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: "malformed_response" };
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
    return { ok: false, reason: "malformed_response" };
  }

  const responseDate = response.headers.get("date");
  if (responseDate) {
    const responseTime = Date.parse(responseDate);
    if (Number.isNaN(responseTime) || now.getTime() - responseTime > maxAgeMs) {
      return { ok: false, reason: "stale_data" };
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
      conditionMet: compare(value, parts.operator, parts.threshold),
      comparisonKnown: true,
      reason: "github_api_read_verified",
    },
  };
}