import { and, asc, eq } from "drizzle-orm";
import {
  db,
  financialPartiesTable,
  peopleTable,
  pool,
  projectsTable,
  type Person,
  type Project,
} from "@workspace/db";
import type { Identity } from "./secretary";
import { logger } from "./logger";
import { featureFlags } from "./feature-flags";
import { listSecondBrainAliases } from "./second-brain";

export type EntityType = "person" | "project" | "financial_party";
export type ResolverMatchType = "exact" | "alias" | "fuzzy" | "ambiguous" | "none";

export type ResolverCandidate = {
  id: string;
  name: string;
  nameKey?: string;
  aliases?: string[];
};

export type ResolverResult = {
  entityType: EntityType;
  query: string;
  selected?: ResolverCandidate;
  candidates: ResolverCandidate[];
  confidence: number;
  matchType: ResolverMatchType;
  wouldChange: boolean;
};

const PERSON_THRESHOLD = 0.88;
const PROJECT_THRESHOLD = 0.92;

export function normalizeEntityText(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .replace(/\u0640/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/[ئىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[،؛؟!.,:()[\]{}]/g, " ")
    .replace(/ى/g, "ي")
    .replace(/[\u064B-\u065F]/g, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ar");
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    for (let column = 0; column <= right.length; column += 1) previous[column] = current[column];
  }
  return previous[right.length];
}

function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}

function candidateScore(query: string, candidate: ResolverCandidate): { score: number; type: ResolverMatchType } {
  const normalizedQuery = normalizeEntityText(query);
  const names = [candidate.name, candidate.nameKey ?? "", ...(candidate.aliases ?? [])]
    .map(normalizeEntityText)
    .filter(Boolean);
  if (names.includes(normalizedQuery)) {
    return {
      score: 1,
      type: names[0] === normalizedQuery ? "exact" : "alias",
    };
  }
  if (names.some((name) => name.startsWith(`${normalizedQuery} `))) {
    return { score: 0.96, type: "alias" };
  }
  const score = Math.max(...names.map((name) => similarity(normalizedQuery, name)));
  return { score, type: score >= 0.9 ? "alias" : "fuzzy" };
}

export function resolveFromCandidates(
  entityType: EntityType,
  query: string,
  candidates: ResolverCandidate[],
): ResolverResult {
  const threshold = entityType === "project" ? PROJECT_THRESHOLD : PERSON_THRESHOLD;
  const ranked = candidates
    .map((candidate) => ({ candidate, ...candidateScore(query, candidate) }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const second = ranked[1];
  const ambiguous = Boolean(best && second && best.score >= threshold && best.score - second.score < 0.05);
  if (!best || best.score < threshold) {
    return {
      entityType,
      query,
      candidates: candidates.slice(0, 10),
      confidence: best?.score ?? 0,
      matchType: "none",
      wouldChange: false,
    };
  }
  if (ambiguous) {
    return {
      entityType,
      query,
      candidates: ranked.slice(0, 10).map((item) => item.candidate),
      confidence: best.score,
      matchType: "ambiguous",
      wouldChange: false,
    };
  }
  return {
    entityType,
    query,
    selected: best.candidate,
    candidates: ranked.slice(0, 10).map((item) => item.candidate),
    confidence: best.score,
    matchType: best.type,
    wouldChange: true,
  };
}

async function queryCandidates(identity: Identity, entityType: EntityType, query: string): Promise<ResolverCandidate[]> {
  if (entityType === "person") {
    const rows = await db.select().from(peopleTable).where(and(
      eqOwnership(identity, peopleTable),
    )).orderBy(asc(peopleTable.createdAt)).limit(100);
    return addSecondBrainAliases(identity, entityType, rows.map((row: Person) => ({ id: row.id, name: row.name, nameKey: row.nameKey })));
  }
  if (entityType === "financial_party") {
    const rows = await db.select().from(financialPartiesTable).where(and(
      eqOwnership(identity, financialPartiesTable),
    )).orderBy(asc(financialPartiesTable.createdAt)).limit(100);
    return addSecondBrainAliases(identity, entityType, rows.map((row) => ({ id: row.id, name: row.name, nameKey: row.nameKey })));
  }
  const rows = await db.select().from(projectsTable).where(and(
    eqOwnership(identity, projectsTable),
  )).orderBy(asc(projectsTable.createdAt)).limit(100);
  return addSecondBrainAliases(identity, entityType, rows.map((row: Project) => ({ id: row.id, name: row.name, nameKey: row.nameKey })));
}

async function addSecondBrainAliases(
  identity: Identity,
  entityType: EntityType,
  candidates: ResolverCandidate[],
): Promise<ResolverCandidate[]> {
  if (candidates.length === 0) return candidates;
  const aliases = await listSecondBrainAliases(identity, entityType);
  if (aliases.length === 0) return candidates;
  return candidates.map((candidate) => {
    const candidateNames = new Set([
      normalizeEntityText(candidate.name),
      normalizeEntityText(candidate.nameKey ?? ""),
    ]);
    const matchingAliases = aliases
      .filter((item) =>
        item.entityId === candidate.id
        && candidateNames.has(normalizeEntityText(item.canonical)))
      .map((item) => item.alias);
    return matchingAliases.length > 0
      ? { ...candidate, aliases: matchingAliases }
      : candidate;
  });
}

function eqOwnership(identity: Identity, table: { tenantId: any; ownerUserId: any }) {
  return and(
    eq(table.tenantId, identity.tenantId),
    eq(table.ownerUserId, identity.userId),
  );
}

export async function resolveEntity(
  identity: Identity,
  entityType: EntityType,
  query: string,
  candidates?: ResolverCandidate[],
): Promise<ResolverResult> {
  const available = candidates ?? await queryCandidates(identity, entityType, query);
  return resolveFromCandidates(entityType, query, available);
}

function extractMentions(message: string): Array<{ entityType: EntityType; query: string }> {
  const mentions: Array<{ entityType: EntityType; query: string }> = [];
  const person = message.match(/(?:ل|إلى|الى|مع)\s+([\u0600-\u06FF][\u0600-\u06FF\s-]{0,30}?)(?=\s+(?:ب|في|على|من|بمبلغ|[0-9٠-٩]|جنيه|دولار|ريال)|$)/u);
  if (person?.[1]) mentions.push({ entityType: "person", query: person[1].trim() });
  const project = message.match(/(?:مشروع|project)\s+([\u0600-\u06FF][\u0600-\u06FF\s-]{0,35}?)(?=\s+(?:من|على|ب|ل|[0-9٠-٩])|$)/iu);
  if (project?.[1]) mentions.push({ entityType: "project", query: project[1].trim() });
  return mentions.filter((mention) => mention.query.length >= 2);
}

export async function recordResolverShadow(
  identity: Identity,
  message: string,
  context: { requestId?: string; conversationId?: string } = {},
): Promise<void> {
  if (!featureFlags.resolverShadow()) return;
  const mentions = extractMentions(message);
  if (mentions.length === 0) return;
  try {
    for (const mention of mentions) {
      const result = await resolveEntity(identity, mention.entityType, mention.query);
      await pool.query(
        `INSERT INTO resolver_shadow_log
          (tenant_id, owner_user_id, entity_type, query_text, candidate_count, selected_id,
           confidence, match_type, would_change, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
        [
          identity.tenantId,
          identity.userId,
          result.entityType,
          result.query,
          result.candidates.length,
          result.selected?.id ?? null,
          result.confidence,
          result.matchType,
          result.wouldChange,
          JSON.stringify({
            messageLength: message.length,
            requestId: context.requestId ?? null,
            conversationId: context.conversationId ?? null,
            aliasHit: result.matchType === "alias",
            ambiguityPreserved: result.matchType === "ambiguous",
            selected: result.selected ?? null,
            candidates: result.candidates,
          }),
        ],
      );
      logger.info({
        requestId: context.requestId,
        conversationId: context.conversationId,
        entityResolver: "shadow",
        entityType: result.entityType,
        query: result.query,
        selectedId: result.selected?.id ?? null,
        candidateCount: result.candidates.length,
        candidateIds: result.candidates.map((candidate) => candidate.id),
        confidence: result.confidence,
        matchType: result.matchType,
        wouldChange: result.wouldChange,
        aliasHit: result.matchType === "alias",
        ambiguityPreserved: result.matchType === "ambiguous",
      }, "resolver shadow decision");
    }
  } catch (error) {
    logger.warn({ error, entityResolver: "shadow" }, "resolver shadow logging failed");
  }
}

export function resolverShadowEnabled(): boolean {
  return featureFlags.resolverShadow();
}