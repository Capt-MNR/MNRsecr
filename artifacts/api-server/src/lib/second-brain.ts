import { and, desc, eq, ilike, or } from "drizzle-orm";
import {
  db,
  secondBrainMemoriesTable,
  type SecondBrainMemory,
} from "@workspace/db";
import type { Identity } from "./secretary";

export type SecondBrainKind = "fact" | "preference" | "alias";

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

export function secondBrainValue(memory: SecondBrainMemory) {
  return {
    id: memory.id,
    kind: memory.kind,
    key: memory.key,
    value: memory.value,
    confidence: memory.confidenceBps / 10000,
    sourceConversationId: memory.sourceConversationId,
    sourceTurnId: memory.sourceTurnId,
    updatedAt: memory.updatedAt.toISOString(),
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

export async function searchSecondBrain(
  identity: Identity,
  query: string,
  limit = 8,
): Promise<SecondBrainMemory[]> {
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

  return ranked
    .filter((item) => terms.length === 0 || broadRecall || item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.memory);
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