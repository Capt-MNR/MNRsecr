import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  db,
  secondBrainMemoriesTable,
  secondBrainCandidatesTable,
  peopleTable,
  projectsTable,
  financialPartiesTable,
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
  | "structured_record_comparison"
  | "general_conversation"
  | "memory_recall";

export type SecondBrainRetrievalMode = "none" | "lexical_v1" | "explicit_recall";
export type SecondBrainRetrievalOutcome =
  | "not_triggered"
  | "no_matches"
  | "excluded_matches"
  | "selected_context";

type SecondBrainTraceAssociation = {
  entityType: string;
  entityId: string;
} | null;

type SecondBrainTraceProvenance = {
  sourceType: string;
  sourceConversationId: string | null;
  sourceTurnId: string | null;
};

type SecondBrainTraceMemory = {
  memoryId: string;
  kind: SecondBrainKind;
  relevanceScore: number;
  confidence: number;
  association: SecondBrainTraceAssociation;
  provenance: SecondBrainTraceProvenance;
};

export type SecondBrainRetrievalTrace = {
  traceId: string;
  requestId: string | null;
  conversationId: string | null;
  strategy: SecondBrainRetrievalMode;
  triggered: boolean;
  outcome: SecondBrainRetrievalOutcome;
  queryDomain: SecondBrainQueryDomain;
  consideredCount: number;
  selected: Array<SecondBrainTraceMemory & {
    selectionReason?: "relevant_match" | "explicit_recall" | "policy_allowed";
    sourceConversationId?: string | null;
    sourceTurnId?: string | null;
  }>;
  excluded: Array<Partial<SecondBrainTraceMemory> & {
    memoryId: string;
    reason:
      | "no_match"
      | "limit"
      | "low_confidence"
      | "unrelated"
      | "conflict_structured_record"
      | "missing_entity_association"
      | "type_not_allowed"
      | "budget"
      | "archived_not_requested";
  }>;
  structuredPrecedence: {
    applied: boolean;
    domain: "financial_record" | "operational_record" | null;
    conflicts: string[];
  };
  llmContextIncluded: boolean;
  llmContextReason: string;
  archivedRequested: boolean;
  archivedIncluded: boolean;
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

export type SecondBrainCandidateSuggestion = {
  memoryKind: SecondBrainKind;
  key: string;
  value: string;
  confidenceBps: number;
  metadata: Record<string, unknown>;
};

export type SecondBrainCandidateStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "needs_context";

export class SecondBrainCandidateReviewError extends Error {
  readonly code:
    | "SECOND_BRAIN_ALIAS_ASSOCIATION_REQUIRED"
    | "SECOND_BRAIN_ALIAS_ASSOCIATION_INVALID"
    | "SECOND_BRAIN_CANDIDATE_STATE_CONFLICT";

  constructor(
    message = "An alias candidate must be associated with a canonical entity before approval.",
    code: SecondBrainCandidateReviewError["code"] = "SECOND_BRAIN_ALIAS_ASSOCIATION_REQUIRED",
  ) {
    super(message);
    this.name = "SecondBrainCandidateReviewError";
    this.code = code;
  }
}

export class SecondBrainCandidateAssociationError extends Error {
  constructor(
    readonly code:
      | "SECOND_BRAIN_CANDIDATE_NOT_ASSOCIABLE"
      | "INVALID_MEMORY_CANDIDATE_ENTITY"
      | "MEMORY_CANDIDATE_ENTITY_NOT_FOUND"
      | "MEMORY_CANDIDATE_ENTITY_NAME_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "SecondBrainCandidateAssociationError";
  }
}

const MAX_MEMORY_VALUE_CHARS = 320;
const MAX_CONTEXT_CHARS = 2800;
const MAX_RETRIEVAL_TRACE_EXCLUSIONS = 128;
const RECALL_WORDS = /(?:فاكر|تفتكر|اللي\s+فاكره|ماذا\s+تعرف\s+عني|ذاكرتك|المحفوظ|remember|recall|memory)/iu;
const MEMORY_CONTEXT_WORDS = /(?:زي\s+ما\s+اتفقنا|المعتاد|تفضيل|أفضل|بفضل|بحب|فاكر|ذاكرة|remember|preference)/iu;
const FINANCIAL_COMPARISON_WORDS = /(?:قارن|مقارنة|مقابل|الفرق|تعارض|متعارض|compare|comparison|versus|vs)/iu;
const FINANCIAL_RECORD_WORDS = /(?:مصروف|مصاريف|مدفوع|مدفوعات|دفع|فلوس|مبلغ|جنيه|دولار|ريال|دين|سلف|التزام|مستحق|دخل|تبرع|حسابات|سجل|record)/iu;
const EXPLICIT_MEMORY_WORDS = /(?:الذاكره|ذاكرة|ملاحظه\s+(?:قديمه|شخصيه)|معلومة\s+شخصية|معلومه\s+شخصيه|فاكر|تفتكر|memory|remember)/iu;

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

  const alias = text.match(
    /^(?:افتكر|إفتكر|خلي\s+بالك|احفظ|سجل\s+في\s+ذاكرتك|remember(?:\s+that)?|keep\s+in\s+mind)\s*(?:إن|ان|أن|:)?\s*اسم\s+(?:(الشخص|المشروع|الطرف)\s+)?(.+?)\s+(?:هو|هي|يعني)\s+(.+)$/iu,
  );
  if (alias?.[1] && alias[2]?.trim() && alias[3]?.trim()) {
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

  const bareAlias = text.match(
    /^(?:افتكر|إفتكر|خلي\s+بالك|احفظ|سجل\s+في\s+ذاكرتك|remember(?:\s+that)?|keep\s+in\s+mind)\s*(?:إن|ان|أن|:)?\s*(?!اسم\s)(.+?)\s+(?:هو|هي|يعني)\s+(.+)$/iu,
  );
  if (bareAlias?.[1]?.trim() && bareAlias[2]?.trim()) {
    const aliasName = bareAlias[1].trim().replace(/^["'«“]|["'»”]$/g, "");
    const canonicalName = bareAlias[2].trim().replace(/^["'«“]|["'»”]$/g, "");
    if (!/^اسم\s+/iu.test(aliasName)) {
      return {
        type: "remember",
        memoryKind: "alias",
        key: keyFor("alias", canonicalName, aliasName),
        value: compact(canonicalName),
        metadata: {
          alias: compact(aliasName),
          canonical: compact(canonicalName),
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

export function parseSecondBrainCandidate(
  message: string,
): SecondBrainCandidateSuggestion | null {
  const text = message.trim();
  if (!text) return null;
  if (
    /[؟?]/u.test(text)
    || /(?:^|\s)(?:ازاي|إزاي|ازاى|كيف|ليه|لماذا|ايه|إيه|how|what|why)\s*$/iu.test(text)
  ) {
    return null;
  }
  const preference = text.match(
    /^(?:انا|أنا)\s+(?:بفضل|أفضل|بحب|أحب|ما\s+بحبش|مش\s+بحب)\s+(.+)$/iu,
  );
  if (!preference?.[1]?.trim()) return null;
  const value = compact(text);
  return {
    memoryKind: "preference",
    key: keyFor("preference", value),
    value,
    confidenceBps: 7000,
    metadata: {
      source: "inferred_user_statement",
      suggestionType: "preference",
    },
  };
}

export function shouldSearchSecondBrain(message: string): boolean {
  return MEMORY_CONTEXT_WORDS.test(message);
}

export function classifySecondBrainQuery(message: string): SecondBrainQueryDomain {
  const text = normalize(message);
  if (
    EXPLICIT_MEMORY_WORDS.test(text)
    && FINANCIAL_COMPARISON_WORDS.test(text)
    && FINANCIAL_RECORD_WORDS.test(text)
  ) {
    return "structured_record_comparison";
  }
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
  options: {
    requestId?: string | null;
    conversationId?: string | null;
  } = {},
): SecondBrainRetrievalTrace {
  return {
    traceId: crypto.randomUUID(),
    requestId: options.requestId ?? null,
    conversationId: options.conversationId ?? null,
    strategy: triggered ? "lexical_v1" : "none",
    triggered,
    outcome: triggered ? "no_matches" : "not_triggered",
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
    archivedRequested: false,
    archivedIncluded: false,
  };
}

function traceMemoryDetails(
  memory: SecondBrainMemory,
  relevanceScore = 0,
): SecondBrainTraceMemory {
  const safeIdentifier = (value: unknown, maxLength: number): string | null =>
    typeof value === "string"
      && value.length > 0
      && value.length <= maxLength
      && /^[a-z0-9][a-z0-9_.:-]*$/iu.test(value)
      ? value
      : null;
  const sourceType = typeof memory.metadata?.source === "string"
    && /^[a-z0-9_.-]{1,64}$/iu.test(memory.metadata.source)
    ? memory.metadata.source
    : "unknown";
  const entityId = safeIdentifier(memory.metadata?.entityId, 128);
  const entityType = safeIdentifier(memory.metadata?.entityType, 64);
  const association = entityId && entityType
    ? {
        entityType,
        entityId,
      }
    : null;
  return {
    memoryId: memory.id,
    kind: memory.kind as SecondBrainKind,
    relevanceScore: Math.max(0, Math.min(1, relevanceScore)),
    confidence: Math.max(0, Math.min(1, memory.confidenceBps / 10000)),
    association,
    provenance: {
      sourceType,
      sourceConversationId: safeIdentifier(memory.sourceConversationId, 128),
      sourceTurnId: safeIdentifier(memory.sourceTurnId, 128),
    },
  };
}

function boundRetrievalTrace(trace: SecondBrainRetrievalTrace): SecondBrainRetrievalTrace {
  trace.excluded = trace.excluded.slice(0, MAX_RETRIEVAL_TRACE_EXCLUSIONS);
  return trace;
}

function addTraceExclusion(
  trace: SecondBrainRetrievalTrace,
  memory: SecondBrainMemory,
  reason: SecondBrainRetrievalTrace["excluded"][number]["reason"],
  relevanceScore = 0,
) {
  trace.excluded.push({
    ...traceMemoryDetails(memory, relevanceScore),
    reason,
  });
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
  return db.transaction(async (tx) => {
    const lockKey = JSON.stringify([
      identity.tenantId,
      identity.userId,
      "second-brain-candidate-create",
      input.memoryKind,
      input.key,
    ]);
    await tx.execute(sql`
      select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `);

    const [existing] = await tx
      .select()
      .from(secondBrainCandidatesTable)
      .where(and(
        eq(secondBrainCandidatesTable.tenantId, identity.tenantId),
        eq(secondBrainCandidatesTable.ownerUserId, identity.userId),
        eq(secondBrainCandidatesTable.kind, input.memoryKind),
        eq(secondBrainCandidatesTable.key, input.key),
        eq(secondBrainCandidatesTable.status, "pending_review"),
      ))
      .limit(1);
    if (existing) return existing;

    const metadata = { ...(input.metadata ?? {}) };
    // Association can only be established through the owner-scoped associate route.
    delete metadata.entityId;
    const [candidate] = await tx
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
        metadata,
      })
      .returning();
    if (!candidate) throw new Error("Second Brain candidate was not saved.");
    return candidate;
  });
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

export async function associateSecondBrainCandidate(
  identity: Identity,
  candidateId: string,
  input: {
    entityType: "person" | "project" | "financial_party";
    entityId: string;
  },
): Promise<SecondBrainCandidate | null> {
  return db.transaction(async (tx) => {
    const lockKey = JSON.stringify([
      identity.tenantId,
      identity.userId,
      "second-brain-candidate",
      candidateId,
    ]);
    await tx.execute(sql`
      select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `);

    const [candidate] = await tx
      .select()
      .from(secondBrainCandidatesTable)
      .where(and(
        eq(secondBrainCandidatesTable.id, candidateId),
        eq(secondBrainCandidatesTable.tenantId, identity.tenantId),
        eq(secondBrainCandidatesTable.ownerUserId, identity.userId),
      ))
      .limit(1);
    if (!candidate) return null;
    if (
      candidate.kind !== "alias"
      || (candidate.status !== "pending_review" && candidate.status !== "needs_context")
    ) {
      throw new SecondBrainCandidateAssociationError(
        "SECOND_BRAIN_CANDIDATE_NOT_ASSOCIABLE",
        "Only pending alias candidates can be associated with an entity.",
      );
    }

    const table = input.entityType === "person"
      ? peopleTable
      : input.entityType === "project"
        ? projectsTable
        : financialPartiesTable;
    const [entity] = await tx
      .select({ id: table.id, name: table.name, nameKey: table.nameKey })
      .from(table)
      .where(and(
        eq(table.id, input.entityId),
        eq(table.tenantId, identity.tenantId),
        eq(table.ownerUserId, identity.userId),
      ))
      .limit(1);
    if (!entity) {
      throw new SecondBrainCandidateAssociationError(
        "MEMORY_CANDIDATE_ENTITY_NOT_FOUND",
        "The selected entity was not found in your workspace.",
      );
    }
    const canonical = normalize(candidate.value);
    if (
      canonical !== normalize(entity.name)
      && canonical !== normalize(entity.nameKey ?? "")
    ) {
      throw new SecondBrainCandidateAssociationError(
        "MEMORY_CANDIDATE_ENTITY_NAME_MISMATCH",
        "The selected entity does not match the candidate's canonical name.",
      );
    }

    const [updated] = await tx
      .update(secondBrainCandidatesTable)
      .set({
        metadata: {
          ...candidate.metadata,
          entityType: input.entityType,
          entityId: input.entityId,
        },
        updatedAt: new Date(),
      })
      .where(and(
        eq(secondBrainCandidatesTable.id, candidateId),
        eq(secondBrainCandidatesTable.tenantId, identity.tenantId),
        eq(secondBrainCandidatesTable.ownerUserId, identity.userId),
        eq(secondBrainCandidatesTable.status, candidate.status),
      ))
      .returning();
    return updated ?? null;
  });
}

export async function reviewSecondBrainCandidate(
  identity: Identity,
  candidateId: string,
  input: {
    status: Exclude<SecondBrainCandidateStatus, "pending_review">;
    note?: string | null;
  },
): Promise<{ candidate: SecondBrainCandidate; memory: SecondBrainMemory | null } | null> {
  return db.transaction(async (tx) => {
    const lockKey = JSON.stringify([
      identity.tenantId,
      identity.userId,
      "second-brain-candidate",
      candidateId,
    ]);
    await tx.execute(sql`
      select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `);

    const [candidate] = await tx
      .select()
      .from(secondBrainCandidatesTable)
      .where(and(
        eq(secondBrainCandidatesTable.id, candidateId),
        eq(secondBrainCandidatesTable.tenantId, identity.tenantId),
        eq(secondBrainCandidatesTable.ownerUserId, identity.userId),
      ))
      .limit(1);
    if (!candidate) return null;

    if (candidate.status === "approved") {
      if (input.status !== "approved") {
        throw new SecondBrainCandidateReviewError(
          "An approved memory candidate cannot be changed to another review status.",
          "SECOND_BRAIN_CANDIDATE_STATE_CONFLICT",
        );
      }
      const [memory] = candidate.promotedMemoryId
        ? await tx
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
    if (candidate.status === input.status && input.status !== "approved") {
      return { candidate, memory: null };
    }

    const now = new Date();
    if (input.status === "approved" && candidate.kind === "alias") {
      const entityType = candidate.metadata?.entityType;
      const entityId = candidate.metadata?.entityId;
      if (
        (entityType !== "person" && entityType !== "project" && entityType !== "financial_party")
        || typeof entityId !== "string"
      ) {
        throw new SecondBrainCandidateReviewError();
      }
      const table = entityType === "person"
        ? peopleTable
        : entityType === "project"
          ? projectsTable
          : financialPartiesTable;
      const [entity] = await tx
        .select({ id: table.id, name: table.name, nameKey: table.nameKey })
        .from(table)
        .where(and(
          eq(table.id, entityId),
          eq(table.tenantId, identity.tenantId),
          eq(table.ownerUserId, identity.userId),
        ))
        .limit(1);
      if (!entity) {
        throw new SecondBrainCandidateReviewError(
          "The alias candidate is not associated with an entity in your workspace.",
          "SECOND_BRAIN_ALIAS_ASSOCIATION_INVALID",
        );
      }
      const canonical = normalize(candidate.value);
      if (
        canonical !== normalize(entity.name)
        && canonical !== normalize(entity.nameKey ?? "")
      ) {
        throw new SecondBrainCandidateReviewError(
          "The associated entity does not match the alias candidate's canonical name.",
          "SECOND_BRAIN_ALIAS_ASSOCIATION_INVALID",
        );
      }
    }
    if (input.status !== "approved") {
      const [updated] = await tx
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
          eq(secondBrainCandidatesTable.status, candidate.status),
        ))
        .returning();
      if (!updated) {
        throw new SecondBrainCandidateReviewError(
          "The candidate changed during review. Reload it and try again.",
          "SECOND_BRAIN_CANDIDATE_STATE_CONFLICT",
        );
      }
      return updated ? { candidate: updated, memory: null } : null;
    }

    const [memory] = await tx
      .insert(secondBrainMemoriesTable)
      .values({
        tenantId: identity.tenantId,
        ownerUserId: identity.userId,
        kind: candidate.kind,
        key: candidate.key,
        value: candidate.value,
        normalizedValue: candidate.normalizedValue,
        confidenceBps: 10000,
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
          confidenceBps: 10000,
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

    const [updated] = await tx
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
        eq(secondBrainCandidatesTable.status, candidate.status),
      ))
      .returning();
    if (!updated) {
      throw new SecondBrainCandidateReviewError(
        "The candidate changed during review. Reload it and try again.",
        "SECOND_BRAIN_CANDIDATE_STATE_CONFLICT",
      );
    }
    return { candidate: updated, memory };
  });
}

export async function searchSecondBrain(
  identity: Identity,
  query: string,
  limit = 8,
): Promise<SecondBrainMemory[]> {
  const result = await retrieveSecondBrain(identity, query, {
    limit,
    mode: "explicit_recall",
    queryDomain: "memory_recall",
    includeArchived: false,
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
    requestId?: string | null;
    conversationId?: string | null;
    includeArchived?: boolean;
  } = {},
): Promise<SecondBrainRetrievalResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 8, 8));
  const mode = options.mode ?? "lexical_v1";
  const queryDomain = options.queryDomain ?? classifySecondBrainQuery(query);
  const archivedRequested = options.includeArchived === true;
  const archivedIncluded = archivedRequested && mode === "explicit_recall";
  const [activeRows, archivedRows] = await Promise.all([
    db
      .select()
      .from(secondBrainMemoriesTable)
      .where(and(
        eq(secondBrainMemoriesTable.tenantId, identity.tenantId),
        eq(secondBrainMemoriesTable.ownerUserId, identity.userId),
        eq(secondBrainMemoriesTable.status, "active"),
      ))
      .orderBy(desc(secondBrainMemoriesTable.updatedAt))
      .limit(80),
    db
      .select()
      .from(secondBrainMemoriesTable)
      .where(and(
        eq(secondBrainMemoriesTable.tenantId, identity.tenantId),
        eq(secondBrainMemoriesTable.ownerUserId, identity.userId),
        eq(secondBrainMemoriesTable.status, "archived"),
      ))
      .orderBy(desc(secondBrainMemoriesTable.updatedAt))
      .limit(80),
  ]);
  const rows = archivedIncluded
    ? [...activeRows, ...archivedRows]
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(0, 80)
    : activeRows;

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
  const trace = emptyRetrievalTrace(query, true, queryDomain, {
    requestId: options.requestId,
    conversationId: options.conversationId,
  });
  trace.strategy = mode;
  trace.archivedRequested = archivedRequested;
  trace.archivedIncluded = archivedIncluded;
  trace.consideredCount = rows.length;
  if (!archivedIncluded) {
    for (const memory of archivedRows) {
      addTraceExclusion(trace, memory, "archived_not_requested");
    }
  }
  for (const item of ranked.filter((candidate) => !matching.includes(candidate))) {
    addTraceExclusion(trace, item.memory, "no_match", item.score / 10);
  }
  for (const item of matching.slice(limit)) {
    addTraceExclusion(trace, item.memory, "limit", item.score / 10);
  }
  trace.selected = selected.map((item) => ({
    ...traceMemoryDetails(item.memory, item.score / 10),
    selectionReason: mode === "explicit_recall" ? "explicit_recall" : "relevant_match",
    sourceConversationId: item.memory.sourceConversationId,
    sourceTurnId: item.memory.sourceTurnId,
  }));
  trace.llmContextReason = selected.length > 0 ? "retrieved_matches" : "no_matches";
  trace.outcome = selected.length > 0 ? "selected_context" : "no_matches";
  return {
    memories: selected.map((item) => item.memory),
    trace: boundRetrievalTrace(trace),
  };
}

export function applySecondBrainPolicy(
  memories: SecondBrainMemory[],
  trace: SecondBrainRetrievalTrace,
): SecondBrainRetrievalResult {
  const structuredDomain = trace.queryDomain === "structured_record_read"
    || trace.queryDomain === "structured_record_mutation";
  const structuredComparison = trace.queryDomain === "structured_record_comparison";
  const selectedById = new Map(trace.selected.map((item) => [item.memoryId, item]));
  const expectedKind = trace.queryDomain === "preference"
    ? "preference"
    : trace.queryDomain === "personal_fact"
      ? "fact"
      : trace.queryDomain === "entity_resolution"
        ? "alias"
        : trace.queryDomain === "structured_record_comparison"
          ? "fact"
        : null;
  const allowed = memories.filter((memory) => {
    if (structuredDomain) {
      addTraceExclusion(trace, memory, "conflict_structured_record", selectedById.get(memory.id)?.relevanceScore);
      return false;
    }
    if (expectedKind && memory.kind !== expectedKind) {
      addTraceExclusion(trace, memory, "type_not_allowed", selectedById.get(memory.id)?.relevanceScore);
      return false;
    }
    if (memory.confidenceBps < 8000) {
      addTraceExclusion(trace, memory, "low_confidence", selectedById.get(memory.id)?.relevanceScore);
      return false;
    }
    if (memory.kind === "alias" && memory.confidenceBps < 9500) {
      addTraceExclusion(trace, memory, "low_confidence", selectedById.get(memory.id)?.relevanceScore);
      return false;
    }
    if (
      memory.kind === "alias"
      && trace.queryDomain === "entity_resolution"
      && typeof memory.metadata?.entityId !== "string"
    ) {
      addTraceExclusion(trace, memory, "missing_entity_association", selectedById.get(memory.id)?.relevanceScore);
      return false;
    }
    const relevance = selectedById.get(memory.id)?.relevanceScore ?? 0;
    if (trace.queryDomain !== "memory_recall" && relevance <= 0) {
      addTraceExclusion(trace, memory, "unrelated", relevance);
      return false;
    }
    return true;
  });

  const selectedIds = new Set(allowed.map((memory) => memory.id));
  trace.selected = trace.selected.filter((item) => selectedIds.has(item.memoryId));
  trace.structuredPrecedence = {
    applied: structuredDomain || structuredComparison,
    domain: structuredDomain || structuredComparison
      ? trace.queryDomain === "structured_record_mutation"
        ? "operational_record"
        : "financial_record"
      : null,
    conflicts: structuredDomain || structuredComparison ? memories.map((memory) => memory.id) : [],
  };
  trace.llmContextIncluded = allowed.length > 0;
  if (!trace.triggered) {
    trace.llmContextReason = "not_triggered";
    trace.outcome = "not_triggered";
  } else if (allowed.length > 0) {
    trace.llmContextReason = structuredComparison
      ? "structured_record_comparison"
      : structuredDomain
        ? "structured_record_precedence"
        : "policy_gates_passed";
    trace.outcome = "selected_context";
  } else if (memories.length === 0) {
    trace.llmContextReason = "no_matches";
    trace.outcome = "no_matches";
  } else {
    trace.llmContextReason = "policy_excluded_all";
    trace.outcome = "excluded_matches";
  }
  return { memories: allowed, trace: boundRetrievalTrace(trace) };
}

function secondBrainHeader(queryDomain?: SecondBrainQueryDomain): string {
  return queryDomain === "structured_record_comparison"
    ? "[Second Brain — مطالبة شخصية فقط؛ قارنها بالسجل المالي الرسمي ولا تعتبرها حقيقة مالية]\n"
    : "[Second Brain — معرفة شخصية صريحة، ليست مصدرًا قانونيًا للبيانات]\n";
}

export function applySecondBrainContextBudget(
  memories: SecondBrainMemory[],
  trace: SecondBrainRetrievalTrace,
  queryDomain = trace.queryDomain,
): SecondBrainMemory[] {
  const header = secondBrainHeader(queryDomain);
  const selected: SecondBrainMemory[] = [];
  const payload: ReturnType<typeof secondBrainValue>[] = [];

  for (const memory of memories) {
    const nextText = `${header}${JSON.stringify([...payload, secondBrainValue(memory)])}`;
    if (nextText.length > MAX_CONTEXT_CHARS) {
      addTraceExclusion(trace, memory, "budget");
      continue;
    }
    selected.push(memory);
    payload.push(secondBrainValue(memory));
  }

  const selectedIds = new Set(selected.map((memory) => memory.id));
  trace.selected = trace.selected.filter((item) => selectedIds.has(item.memoryId));
  trace.llmContextIncluded = selected.length > 0;
  if (selected.length === 0 && memories.length > 0) {
    trace.llmContextReason = "budget_excluded_all";
  } else if (selected.length < memories.length) {
    trace.llmContextReason = "budget_bounded";
  }
  if (trace.triggered) {
    trace.outcome = selected.length > 0
      ? "selected_context"
      : memories.length > 0
        ? "excluded_matches"
        : "no_matches";
  } else {
    trace.outcome = "not_triggered";
  }
  boundRetrievalTrace(trace);
  return selected;
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
    entityAssociated: typeof candidate.metadata?.entityId === "string",
    entityType: typeof candidate.metadata?.entityType === "string"
      ? candidate.metadata.entityType
      : null,
    entityId: typeof candidate.metadata?.entityId === "string"
      ? candidate.metadata.entityId
      : null,
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
): Promise<Array<{ alias: string; canonical: string; entityId: string }>> {
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
      return typeof row.metadata?.entityId === "string"
        && typeof rowEntityType === "string"
        && (!entityType || rowEntityType === entityType);
    })
    .map((row) => ({
      alias: typeof row.metadata?.alias === "string"
        ? row.metadata.alias
        : row.key.replace(/^alias:/, ""),
      canonical: row.value,
      entityId: row.metadata.entityId as string,
    }));
}

export function formatSecondBrainContext(
  memories: SecondBrainMemory[],
  queryDomain?: SecondBrainQueryDomain,
): string | null {
  if (memories.length === 0) return null;
  const payload = memories.map(secondBrainValue);
  const text = `${secondBrainHeader(queryDomain)}${JSON.stringify(payload)}`;
  return text.length <= MAX_CONTEXT_CHARS
    ? text
    : `${text.slice(0, MAX_CONTEXT_CHARS - 1)}…`;
}

export function secondBrainRecallMessage(memories: SecondBrainMemory[]): string {
  if (memories.length === 0) return "لسه ما عنديش ملاحظات شخصية محفوظة عنك.";
  return `فاكر عنك: ${memories.map((memory) => memory.value).join("؛ ")}.`;
}