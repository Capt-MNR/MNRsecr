import { and, desc, eq, ilike, or } from "drizzle-orm";
import {
  db,
  secondBrainMemoriesTable,
  secondBrainCandidatesTable,
  type SecondBrainMemory,
  type SecondBrainCandidate,
} from "@workspace/db";
import type { Identity } from "./secretary";

export type SecondBrainKind = "fact" | "preference" | "alias";
export type SecondBrainQueryDomain =
  | "preference"
  | "personal_fact"
  | "entity_resolution"
  | "structured_record_read"
  | "structured_record_mutation"
  | "general_conversation"
  | "memory_recall";

export type SecondBrainRetrievalMode = "none" | "lexical_v1" | "explicit_recall";

export type SecondBrainRetrievalTrace = {
  traceId: string;
  strategy: SecondBrainRetrievalMode;
  triggered: boolean;
  queryDomain: SecondBrainQueryDomain;
  consideredCount: number;
  selected: Array<{
    memoryId: string;
    kind: SecondBrainKind;
    relevanceScore: number;
    confidence: number;
    sourceConversationId: string | null;
    sourceTurnId: string | null;
  }>;
  excluded: Array<{
    memoryId: string;
    reason:
      | "no_match"
      | "limit"
      | "low_confidence"
      | "unrelated"
      | "conflict_structured_record"
      | "missing_entity_association"
      | "type_not_allowed"
      | "budget";
  }>;
  structuredPrecedence: {
    applied: boolean;
    domain: "financial_record" | "operational_record" | null;
    conflicts: string[];
  };
  llmContextIncluded: boolean;
  llmContextReason: string;
};

export type SecondBrainRetrievalResult = {
  memories: SecondBrainMemory[];
  trace: SecondBrainRetrievalTrace;
};

export type SecondBrainCommand =
  | {
      type: "remember";
      memoryKind: SecondBrainKind;
      key: string;
      value: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "recall";
      query: string;
    };

export type SecondBrainCandidateStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "needs_context";

const MAX_MEMORY_VALUE_CHARS = 320;
const MAX_CONTEXT_CHARS = 2800;
const RECALL_WORDS = /(?:فاكر|تفتكر|اللي\s+فاكره|ماذا\s+تعرف\s+عني|ذاكرتك|المحفوظ|remember|recall|memory)/iu;
const MEMORY_CONTEXT_WORDS = /(?:زي\s+ما\s+اتفقنا|المعتاد|تفضيل|أفضل|بفضل|بحب|فاكر|ذاكرة|remember|preference)/iu;

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\u0640/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u065F]/g, "")
    .replace(/[،؛؟!.,:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ar");
}

function compact(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length <= MAX_MEMORY_VALUE_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_MEMORY_VALUE_CHARS - 1)}…`;
}

function keyFor(kind: SecondBrainKind, value: string, alias?: string): string {
  const normalizedValue = normalize(alias ?? value).slice(0, 140);
  return kind === "preference"
    ? `preference:${normalizedValue}`
    : kind === "alias"
      ? `alias:${normalizedValue}`
    : `note:${normalizedValue}`;
}

export function parseSecondBrainCommand(message: string): SecondBrainCommand | null {
  const text = message.trim();
  if (!text) return null;

  const preference = text.match(
    /^(?:انا|أنا)\s+(?:بفضل|أفضل|بحب|أحب|ما\s+بحبش|مش\s+بحب)\s+(.+)$/iu,
  );
  if (preference?.[1]?.trim()) {
    const value = compact(text);
    return {
      type: "remember",
      memoryKind: "preference",
      key: keyFor("preference", value),
      value,
    };
  }

  const alias = text.match(
    /^(?:افتكر|إفتكر|خلي\s+بالك|احفظ|سجل\s+في\s+ذاكرتك|remember(?:\s+that)?|keep\s+in\s+mind)\s*(?:إن|ان|أن|:)?\s*اسم\s+(?:(الشخص|المشروع|الطرف)\s+)?(.+?)\s+(?:هو|هي|يعني)\s+(.+)$/iu,
  );
  if (alias?.[2]?.trim() && alias[3]?.trim()) {
    const aliasName = alias[2].trim().replace(/^["'«“]|["'»”]$/g, "");
    const canonicalName = alias[3].trim().replace(/^["'«“]|["'»”]$/g, "");
    const entityType = alias[1]?.toLocaleLowerCase("ar") === "المشروع"
      ? "project"
      : alias[1]?.toLocaleLowerCase("ar") === "الطرف"
        ? "financial_party"
        : alias[1]
          ? "person"
          : undefined;
    if (aliasName && canonicalName) {
      return {
        type: "remember",
        memoryKind: "alias",
        key: keyFor("alias", canonicalName, aliasName),
        value: compact(canonicalName),
        metadata: {
          alias: compact(aliasName),
          canonical: compact(canonicalName),
          ...(entityType ? { entityType } : {}),
        },
      };
    }
  }

  const remember = text.match(
    /^(?:افتكر|إفتكر|خلي\s+بالك|احفظ|سجل\s+في\s+ذاكرتك|remember(?:\s+that)?|keep\s+in\s+mind)\s*(?:إن|ان|أن|:)?\s*(.+)$/iu,
  );
  if (remember?.[1]?.trim()) {
    const value = compact(remember[1]);
    return {
      type: "remember",
      memoryKind: "fact",
      key: keyFor("fact", value),
      value,
    };
  }

  if (RECALL_WORDS.test(text)) {
    return {
      type: "recall",
      query: text,
    };
  }

  return null;
}

export function shouldSearchSecondBrain(message: string): boolean {
  return MEMORY_CONTEXT_WORDS.test(message);
}

export function classifySecondBrainQuery(message: string): SecondBrainQueryDomain {
  const text = normalize(message);
  if (RECALL_WORDS.test(message)) return "memory_recall";
  if (/(?:بحب|بفضل|أفضل|تفضيل|ردود|مختصر|مختصرة|لهجه|لغة|شكل)/iu.test(text)) {
    return "preference";
  }
  if (/(?:مين|اسم|شخص|مشروع|طرف|alias|اسم\s+بديل)/iu.test(text)) {
    return "entity_resolution";
  }
  if (/(?:مصروف|مصاريف|مدفوع|مدفوعات|دفع|فلوس|مبلغ|جنيه|دولار|ريال|دين|سلف|التزام|مستحق|دخل|تبرع|موعد|تذكير|مهمة|سجل|record)/iu.test(text)) {
    return /(?:ضيف|زود|عدل|عدّل|غير|غيّر|سجل|احفظ|دفع|ادفع|أنشئ|اعمل|create|update|record)/iu.test(text)
      ? "structured_record_mutation"
      : "structured_record_read";
  }
  if (/(?:فاكر|تفتكر|ذاكرة|المعتاد|remember|recall|memory)/iu.test(text)) {
    return "personal_fact";
  }
  return "general_conversation";
}

export function emptyRetrievalTrace(
  message: string,
  triggered: boolean,
  queryDomain = classifySecondBrainQuery(message),
): SecondBrainRetrievalTrace {
  return {
    traceId: crypto.randomUUID(),
    strategy: triggered ? "lexical_v1" : "none",
    triggered,
    queryDomain,
    consideredCount: 0,
    selected: [],
    excluded: [],
    structuredPrecedence: {
      applied: false,
      domain: null,
      conflicts: [],
    },
    llmContextIncluded: false,
    llmContextReason: triggered ? "no_matches" : "not_triggered",
  };
}

export function secondBrainValue(memory: SecondBrainMemory) {
  return {
    id: memory.id,
    kind: memory.kind,
    key: memory.key,
    value: memory.value,
    confidence: memory.confidenceBps / 10000,
    status: memory.status,
    sourceConversationId: memory.sourceConversationId,
    sourceTurnId: memory.sourceTurnId,
    updatedAt: memory.updatedAt.toISOString(),
    lastConfirmedAt: memory.lastConfirmedAt?.toISOString() ?? null,
  };
}

export async function rememberSecondBrain(
  identity: Identity,
  input: {
    memoryKind: SecondBrainKind;
    key: string;
    value: string;
    metadata?: Record<string, unknown>;
    conversationId?: string | null;
    turnId?: string | null;
  },
): Promise<SecondBrainMemory> {
  const value = compact(input.value);
  const normalizedValue = normalize(value);
  const [memory] = await db
    .insert(secondBrainMemoriesTable)
    .values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      kind: input.memoryKind,
      key: input.key,
      value,
      normalizedValue,
      confidenceBps: 10000,
      status: "active",
      sourceConversationId: input.conversationId ?? null,
      sourceTurnId: input.turnId ?? null,
      metadata: {
        source: "explicit_user_instruction",
        ...(input.metadata ?? {}),
      },
      lastConfirmedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        secondBrainMemoriesTable.tenantId,
        secondBrainMemoriesTable.ownerUserId,
        secondBrainMemoriesTable.kind,
        secondBrainMemoriesTable.key,
      ],
      set: {
        value,
        normalizedValue,
        confidenceBps: 10000,
        status: "active",
        sourceConversationId: input.conversationId ?? null,
        sourceTurnId: input.turnId ?? null,
        metadata: {
          source: "explicit_user_instruction",
          ...(input.metadata ?? {}),
        },
        lastConfirmedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!memory) throw new Error("Second Brain memory was not saved.");
  return memory;
}

export async function createSecondBrainCandidate(
  identity: Identity,
  input: {
    memoryKind: SecondBrainKind;
    key: string;
    value: string;
    confidenceBps: number;
    metadata?: Record<string, unknown>;
    conversationId?: string | null;
    turnId?: string | null;
  },
): Promise<SecondBrainCandidate> {
  const [candidate] = await db
    .insert(secondBrainCandidatesTable)
    .values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      kind: input.memoryKind,
      key: input.key,
      value: compact(input.value),
      normalizedValue: normalize(input.value),
      confidenceBps: Math.max(0, Math.min(10000, Math.round(input.confidenceBps))),
      status: "pending_review",
      sourceConversationId: input.conversationId ?? null,
      sourceTurnId: input.turnId ?? null,
      metadata: input.metadata ?? {},
    })
    .returning();
  if (!candidate) throw new Error("Second Brain candidate was not saved.");
  return candidate;
}

export async function listSecondBrainCandidates(
  identity: Identity,
  status?: SecondBrainCandidateStatus,
): Promise<SecondBrainCandidate[]> {
  return db
    .select()
    .from(secondBrainCandidatesTable)
    .where(and(
      eq(secondBrainCandidatesTable.tenantId, identity.tenantId),
      eq(secondBrainCandidatesTable.ownerUserId, identity.userId),
      ...(status ? [eq(secondBrainCandidatesTable.status, status)] : []),
    ))
    .orderBy(desc(secondBrainCandidatesTable.updatedAt))
    .limit(100);
}

export async function reviewSecondBrainCandidate(
  identity: Identity,
  candidateId: string,
  input: {
    status: Exclude<SecondBrainCandidateStatus, "pending_review">;
    note?: string | null;
  },
): Promise<{ candidate: SecondBrainCandidate; memory: SecondBrainMemory | null } | null> {
  const [candidate] = await db
    .select()
    .from(secondBrainCandidatesTable)
    .where(and(
      eq(secondBrainCandidatesTable.id, candidateId),
      eq(secondBrainCandidatesTable.tenantId, identity.tenantId),
      eq(secondBrainCandidatesTable.ownerUserId, identity.userId),
    ))
    .limit(1);
  if (!candidate) return null;
  if (candidate.status === "approved" && input.status === "approved") {
    const [memory] = candidate.promotedMemoryId
      ? await db
        .select()
        .from(secondBrainMemoriesTable)
        .where(and(
          eq(secondBrainMemoriesTable.id, candidate.promotedMemoryId),
          eq(secondBrainMemoriesTable.tenantId, identity.tenantId),
          eq(secondBrainMemoriesTable.ownerUserId, identity.userId),
        ))
        .limit(1)
      : [];
    return { candidate, memory: memory ?? null };
  }

  const now = new Date();
  if (input.status !== "approved") {
    const [updated] = await db
      .update(secondBrainCandidatesTable)
      .set({
        status: input.status,
        reviewerNote: input.note ?? null,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(secondBrainCandidatesTable.id, candidateId),
        eq(secondBrainCandidatesTable.tenantId, identity.tenantId),
        eq(secondBrainCandidatesTable.ownerUserId, identity.userId),
      ))
      .returning();
    return updated ? { candidate: updated, memory: null } : null;
  }

  const [memory] = await db
    .insert(secondBrainMemoriesTable)
    .values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      kind: candidate.kind,
      key: candidate.key,
      value: candidate.value,
      normalizedValue: candidate.normalizedValue,
      confidenceBps: candidate.confidenceBps,
      status: "active",
      sourceConversationId: candidate.sourceConversationId,
      sourceTurnId: candidate.sourceTurnId,
      metadata: {
        ...candidate.metadata,
        source: "reviewed_memory_candidate",
        candidateId: candidate.id,
      },
      lastConfirmedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        secondBrainMemoriesTable.tenantId,
        secondBrainMemoriesTable.ownerUserId,
        secondBrainMemoriesTable.kind,
        secondBrainMemoriesTable.key,
      ],
      set: {
        value: candidate.value,
        normalizedValue: candidate.normalizedValue,
        confidenceBps: candidate.confidenceBps,
        status: "active",
        sourceConversationId: candidate.sourceConversationId,
        sourceTurnId: candidate.sourceTurnId,
        metadata: {
          ...candidate.metadata,
          source: "reviewed_memory_candidate",
          candidateId: candidate.id,
        },
        lastConfirmedAt: now,
        updatedAt: now,
      },
    })
    .returning();
  if (!memory) throw new Error("Second Brain candidate promotion failed.");

  const [updated] = await db
    .update(secondBrainCandidatesTable)
    .set({
      status: "approved",
      reviewerNote: input.note ?? null,
      promotedMemoryId: memory.id,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(secondBrainCandidatesTable.id, candidateId),
      eq(secondBrainCandidatesTable.tenantId, identity.tenantId),
      eq(secondBrainCandidatesTable.ownerUserId, identity.userId),
    ))
    .returning();
  return updated ? { candidate: updated, memory } : null;
}

export async function searchSecondBrain(
  identity: Identity,
  query: string,
  limit = 8,
): Promise<SecondBrainMemory[]> {
  const result = await retrieveSecondBrain(identity, query, {
    limit,
    mode: "explicit_recall",
  });
  return result.memories;
}

export async function retrieveSecondBrain(
  identity: Identity,
  query: string,
  options: {
    limit?: number;
    mode?: SecondBrainRetrievalMode;
    queryDomain?: SecondBrainQueryDomain;
  } = {},
): Promise<SecondBrainRetrievalResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 8, 8));
  const mode = options.mode ?? "lexical_v1";
  const queryDomain = options.queryDomain ?? classifySecondBrainQuery(query);
  const rows = await db
    .select()
    .from(secondBrainMemoriesTable)
    .where(and(
      eq(secondBrainMemoriesTable.tenantId, identity.tenantId),
      eq(secondBrainMemoriesTable.ownerUserId, identity.userId),
      eq(secondBrainMemoriesTable.status, "active"),
    ))
    .orderBy(desc(secondBrainMemoriesTable.updatedAt))
    .limit(80);

  const normalizedQuery = normalize(query);
  const broadRecall = /^(?:فاكر|تفتكر)\s+(?:ايه|إيه|ماذا|ما)\s+(?:اللي\s+)?(?:حفظته|فاكره|عندك)/iu.test(normalizedQuery)
    || /^(?:what\s+do\s+you\s+remember|show\s+my\s+memories)/iu.test(normalizedQuery);
  const terms = normalize(query)
    .split(" ")
    .filter((term) => term.length >= 3 && ![
      "فاكر",
      "ايه",
      "إيه",
      "اللي",
      "عن",
      "عني",
      "عندك",
      "حفظته",
      "فاكره",
      "ماذا",
      "what",
      "show",
      "my",
      "memories",
      "do",
      "you",
      "remember",
    ].includes(term));

  const ranked = rows.map((memory, index) => {
    const haystack = `${normalize(memory.key)} ${memory.normalizedValue}`;
    const matches = terms.filter((term) => haystack.includes(term)).length;
    return { memory, score: matches * 10 + (terms.length === 0 || broadRecall ? 1 : 0) - index / 1000 };
  });

  const matching = ranked
    .filter((item) => terms.length === 0 || broadRecall || item.score > 0)
    .sort((left, right) => right.score - left.score)
  const selected = matching.slice(0, limit);
  const trace = emptyRetrievalTrace(query, true, queryDomain);
  trace.strategy = mode;
  trace.consideredCount = rows.length;
  trace.excluded.push(
    ...ranked
      .filter((item) => !matching.includes(item))
      .map((item) => ({
        memoryId: item.memory.id,
        reason: "no_match" as const,
      })),
    ...matching.slice(limit).map((item) => ({
      memoryId: item.memory.id,
      reason: "limit" as const,
    })),
  );
  trace.selected = selected.map((item) => ({
    memoryId: item.memory.id,
    kind: item.memory.kind as SecondBrainKind,
    relevanceScore: Math.max(0, Math.min(1, item.score / 10)),
    confidence: item.memory.confidenceBps / 10000,
    sourceConversationId: item.memory.sourceConversationId,
    sourceTurnId: item.memory.sourceTurnId,
  }));
  trace.llmContextReason = selected.length > 0 ? "retrieved_matches" : "no_matches";
  return {
    memories: selected.map((item) => item.memory),
    trace,
  };
}

export function applySecondBrainPolicy(
  memories: SecondBrainMemory[],
  trace: SecondBrainRetrievalTrace,
): SecondBrainRetrievalResult {
  const structuredDomain = trace.queryDomain === "structured_record_read"
    || trace.queryDomain === "structured_record_mutation";
  const allowed = memories.filter((memory) => {
    if (structuredDomain) {
      trace.excluded.push({
        memoryId: memory.id,
        reason: "conflict_structured_record",
      });
      return false;
    }
    if (memory.kind === "alias" && trace.queryDomain !== "memory_recall") {
      trace.excluded.push({
        memoryId: memory.id,
        reason: "type_not_allowed",
      });
      return false;
    }
    if (memory.confidenceBps < 8000) {
      trace.excluded.push({
        memoryId: memory.id,
        reason: "low_confidence",
      });
      return false;
    }
    return true;
  });

  const selectedIds = new Set(allowed.map((memory) => memory.id));
  trace.selected = trace.selected.filter((item) => selectedIds.has(item.memoryId));
  trace.structuredPrecedence = {
    applied: structuredDomain,
    domain: structuredDomain
      ? trace.queryDomain === "structured_record_mutation"
        ? "operational_record"
        : "financial_record"
      : null,
    conflicts: structuredDomain ? memories.map((memory) => memory.id) : [],
  };
  trace.llmContextIncluded = allowed.length > 0;
  trace.llmContextReason = structuredDomain
    ? "structured_record_precedence"
    : allowed.length > 0
      ? "policy_gates_passed"
      : "policy_excluded_all";
  return { memories: allowed, trace };
}

export async function listSecondBrainMemories(
  identity: Identity,
  options: {
    search?: string;
    kind?: SecondBrainKind;
    status?: "active" | "archived";
  } = {},
): Promise<SecondBrainMemory[]> {
  const search = options.search?.trim();
  const normalizedSearch = search ? normalize(search) : "";
  const searchPattern = normalizedSearch
    ? `%${normalizedSearch.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
    : null;
  const valuePattern = search
    ? `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
    : null;
  return db
    .select()
    .from(secondBrainMemoriesTable)
    .where(and(
      eq(secondBrainMemoriesTable.tenantId, identity.tenantId),
      eq(secondBrainMemoriesTable.ownerUserId, identity.userId),
      eq(secondBrainMemoriesTable.status, options.status ?? "active"),
      ...(options.kind ? [eq(secondBrainMemoriesTable.kind, options.kind)] : []),
      ...(searchPattern && valuePattern
        ? [or(
            ilike(secondBrainMemoriesTable.normalizedValue, searchPattern),
            ilike(secondBrainMemoriesTable.value, valuePattern),
            ilike(secondBrainMemoriesTable.key, searchPattern),
          )]
        : []),
    ))
    .orderBy(desc(secondBrainMemoriesTable.updatedAt))
    .limit(100);
}

export async function archiveSecondBrainMemory(
  identity: Identity,
  memoryId: string,
): Promise<SecondBrainMemory | null> {
  const [memory] = await db
    .update(secondBrainMemoriesTable)
    .set({
      status: "archived",
      updatedAt: new Date(),
    })
    .where(and(
      eq(secondBrainMemoriesTable.id, memoryId),
      eq(secondBrainMemoriesTable.tenantId, identity.tenantId),
      eq(secondBrainMemoriesTable.ownerUserId, identity.userId),
      eq(secondBrainMemoriesTable.status, "active"),
    ))
    .returning();
  return memory ?? null;
}

export async function restoreSecondBrainMemory(
  identity: Identity,
  memoryId: string,
): Promise<SecondBrainMemory | null> {
  const [memory] = await db
    .update(secondBrainMemoriesTable)
    .set({
      status: "active",
      updatedAt: new Date(),
    })
    .where(and(
      eq(secondBrainMemoriesTable.id, memoryId),
      eq(secondBrainMemoriesTable.tenantId, identity.tenantId),
      eq(secondBrainMemoriesTable.ownerUserId, identity.userId),
      eq(secondBrainMemoriesTable.status, "archived"),
    ))
    .returning();
  return memory ?? null;
}

export function publicSecondBrainMemory(memory: SecondBrainMemory) {
  return {
    id: memory.id,
    kind: memory.kind,
    key: memory.key,
    value: memory.value,
    confidence: memory.confidenceBps / 10000,
    status: memory.status,
    sourceConversationId: memory.sourceConversationId,
    sourceTurnId: memory.sourceTurnId,
    updatedAt: memory.updatedAt.toISOString(),
    lastConfirmedAt: memory.lastConfirmedAt?.toISOString() ?? null,
  };
}

export function publicSecondBrainCandidate(candidate: SecondBrainCandidate) {
  return {
    id: candidate.id,
    kind: candidate.kind,
    key: candidate.key,
    value: candidate.value,
    confidence: candidate.confidenceBps / 10000,
    status: candidate.status,
    sourceConversationId: candidate.sourceConversationId,
    sourceTurnId: candidate.sourceTurnId,
    reviewerNote: candidate.reviewerNote,
    promotedMemoryId: candidate.promotedMemoryId,
    createdAt: candidate.createdAt.toISOString(),
    updatedAt: candidate.updatedAt.toISOString(),
    reviewedAt: candidate.reviewedAt?.toISOString() ?? null,
  };
}

export async function listSecondBrainAliases(
  identity: Identity,
  entityType?: "person" | "project" | "financial_party",
): Promise<Array<{ alias: string; canonical: string }>> {
  const rows = await db
    .select()
    .from(secondBrainMemoriesTable)
    .where(and(
      eq(secondBrainMemoriesTable.tenantId, identity.tenantId),
      eq(secondBrainMemoriesTable.ownerUserId, identity.userId),
      eq(secondBrainMemoriesTable.kind, "alias"),
      eq(secondBrainMemoriesTable.status, "active"),
    ))
    .orderBy(desc(secondBrainMemoriesTable.updatedAt))
    .limit(100);

  return rows
    .filter((row) => {
      const rowEntityType = row.metadata?.entityType;
      return !entityType || !rowEntityType || rowEntityType === entityType;
    })
    .map((row) => ({
      alias: typeof row.metadata?.alias === "string"
        ? row.metadata.alias
        : row.key.replace(/^alias:/, ""),
      canonical: row.value,
    }));
}

export function formatSecondBrainContext(memories: SecondBrainMemory[]): string | null {
  if (memories.length === 0) return null;
  const payload = memories.map(secondBrainValue);
  const text = `[Second Brain — معرفة شخصية صريحة، ليست مصدرًا قانونيًا للبيانات]\n${JSON.stringify(payload)}`;
  return text.length <= MAX_CONTEXT_CHARS
    ? text
    : `${text.slice(0, MAX_CONTEXT_CHARS - 1)}…`;
}

export function secondBrainRecallMessage(memories: SecondBrainMemory[]): string {
  if (memories.length === 0) return "لسه ما عنديش ملاحظات شخصية محفوظة عنك.";
  return `فاكر عنك: ${memories.map((memory) => memory.value).join("؛ ")}.`;
}