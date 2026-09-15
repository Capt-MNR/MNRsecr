import { and, desc, eq, lt, or } from "drizzle-orm";
import {
  activityEventEntitiesTable,
  activityEventsTable,
  commitmentsTable,
  db,
  expensesTable,
  financialPartiesTable,
  financialPartyPeopleTable,
  financialPartyProjectsTable,
  financialPaymentsTable,
  pool,
  type FinancialParty,
} from "@workspace/db";
import type { ConversationEntity, ConversationState } from "./conversation-memory";
import { normalizeEntityText, resolveEntity, type ResolverResult } from "./entity-resolver";
import { parseArabicAmount } from "./deterministic-intelligence";
import type { Identity } from "./secretary";

export const RELATIONSHIP_CONTEXT_LIMITS = {
  maxEntities: 3,
  maxRelationships: 12,
  maxRecords: 12,
  maxTimelineEvents: 8,
  maxContextChars: 6_000,
} as const;

export type RelationshipIntent =
  | "person_financial_status"
  | "project_expenses"
  | "open_obligations"
  | "recent_payments"
  | "expected_income"
  | "collected_income"
  | "donations"
  | "overdue_commitments"
  | "recent_activity"
  | "entity_context";

export type ContextMoneyTotal = {
  currency: string;
  amountMinor: number;
  count: number;
};

export type ResolvedContextEntity = {
  id: string;
  name: string;
  type: "person" | "project" | "financial_party";
  matchType: "exact" | "alias" | "fuzzy" | "conversation";
  confidence: number;
};

export type RelationshipContext = {
  version: 1;
  intent: RelationshipIntent;
  bounds: typeof RELATIONSHIP_CONTEXT_LIMITS;
  resolvedEntities: ResolvedContextEntity[];
  relevantRelationships: Array<Record<string, unknown>>;
  relevantRecords: Array<Record<string, unknown>>;
  financialSummary: Record<string, ContextMoneyTotal[]>;
  recentActivity: Array<Record<string, unknown>>;
  conversationReferences: Array<{ type: string; id: string; name: string }>;
  uncertainties: string[];
  truncated: boolean;
};

export type RelationshipContextResult = {
  context: RelationshipContext;
  response?: {
    kind: "answer" | "clarification" | "not_found";
    message: string;
    groundedFacts?: Array<{ type: "money" | "count"; value: number; currency?: string; label?: string }>;
  };
};

export type FinancialFollowupAdjustment =
  | {
      status: "ready";
      expenseId: string;
      amountMinor: number;
      currency: string;
      previousAmountMinor: number;
      deltaMinor: number;
    }
  | { status: "missing_referent" }
  | { status: "currency_mismatch" };

type ParsedRelationshipRequest = {
  intent: RelationshipIntent;
  targetType?: "person" | "project";
  targetQuery?: string;
  usesConversationReference: boolean;
  ordinal?: number;
};

type PartyResolution =
  | { status: "selected"; party: FinancialParty; entity?: ResolvedContextEntity }
  | { status: "missing"; query: string }
  | { status: "ambiguous"; query: string; candidates: Array<{ id: string; name: string }> };

function cleanQuery(value: string | undefined): string | undefined {
  const cleaned = value
    ?.replace(/[؟?!.،؛:]+$/u, "")
    .replace(/^(?:ال|يا)\s+/u, "")
    .trim();
  return cleaned && cleaned.length >= 2 ? cleaned : undefined;
}

export function parseRelationshipRequest(
  message: string,
  state?: ConversationState,
): ParsedRelationshipRequest | null {
  const normalized = normalizeEntityText(message);
  const projectMatch = message.match(/(?:مشروع|project)\s+(.+?)(?:[؟?!.،؛:]|$)/iu);
  const personDebtPrefix = message.match(/^(.+?)\s+(?:عليه|له|ليه)\s+(?:كام|كم|قد\s*ايه)/iu);
  const personDebtSuffix = message.match(/(?:ليا|لي)\s+(?:كام|كم|قد\s*ايه)\s+عند\s+(.+?)(?:[؟?!.،؛:]|$)/iu);
  const activityPerson = message.match(/(?:اخر|آخر)\s+(?:حاجه|حاجة|شيء)\s+(?:حصلت|حصل)\s+مع\s+(.+?)(?:[؟?!.،؛:]|$)/iu);
  const aboutPerson = message.match(/(?:تفاصيل|ملخص|العلاقات|علاقه|علاقة|عن)\s+(?:الشخص\s+)?(.+?)(?:[؟?!.،؛:]|$)/iu);
  const usesConversationReference = /^(?:طب|طيب|و)?\s*(?:عليه|عندها|عنده|معاه|معها|والمدفوعات|والسلف|والديون|والمشروع|المشروع\s+التاني)/iu.test(message.trim());
  if (/(?:المشروع)\s+(?:التاني|الثاني|2|٢)/u.test(normalized)) {
    return {
      intent: "entity_context",
      targetType: "project",
      usesConversationReference: true,
      ordinal: 2,
    };
  }

  if (/(?:التزامات|الالتزامات).*(?:متاخر|متأخر)|(?:متاخر|متأخر).*(?:التزامات|الالتزامات)/u.test(normalized)) {
    return { intent: "overdue_commitments", usesConversationReference };
  }
  if (/تبرعات|تبرع/u.test(normalized) && /(?:كم|كام|ايه|إيه|اعرض|هات|مرتبط)/u.test(normalized)) {
    return {
      intent: "donations",
      targetType: projectMatch ? "project" : undefined,
      targetQuery: cleanQuery(projectMatch?.[1]),
      usesConversationReference,
    };
  }
  if (/(?:دخل|مستحق).*(?:متوقع|مفتوح)|(?:متوقع).*(?:دخل|مستحق)/u.test(normalized)) {
    return { intent: "expected_income", usesConversationReference };
  }
  if (/(?:تم\s+تحصيل|اتحصل|محصل|دخل\s+محصل)/u.test(normalized)) {
    return { intent: "collected_income", usesConversationReference };
  }
  if (/(?:مدفوعات|دفعات).*(?:اخير|أخير|حديث)|(?:اخر|آخر).*(?:مدفوعات|دفعات)/u.test(normalized)) {
    return { intent: "recent_payments", usesConversationReference };
  }
  if (/(?:سلف|ديون|التزامات\s+ماليه).*(?:مفتوح|قائم)|(?:ايه|إيه|هات|اعرض).*(?:سلف|ديون)/u.test(normalized)) {
    return { intent: "open_obligations", usesConversationReference };
  }
  if (
    projectMatch
    && /(?:مصروفات|دفعت|دفعنا|انفقت|أنفقت|صرفنا|اتصرف).*(?:كم|كام|اجمالي|إجمالي)|(?:كم|كام|اجمالي|إجمالي).*(?:مصروفات|دفعت|دفعنا|انفقت|أنفقت|صرفنا|اتصرف)/u.test(normalized)
  ) {
    return {
      intent: "project_expenses",
      targetType: "project",
      targetQuery: cleanQuery(projectMatch[1]),
      usesConversationReference,
    };
  }
  if (personDebtPrefix?.[1] || personDebtSuffix?.[1] || (usesConversationReference && /عليه|عنده/u.test(normalized))) {
    return {
      intent: "person_financial_status",
      targetType: "person",
      targetQuery: cleanQuery(personDebtPrefix?.[1] ?? personDebtSuffix?.[1]),
      usesConversationReference,
    };
  }
  if (activityPerson?.[1] || /(?:اخر|آخر)\s+(?:نشاط|حاجه|حاجة)/u.test(normalized)) {
    return {
      intent: "recent_activity",
      targetType: activityPerson?.[1] ? "person" : undefined,
      targetQuery: cleanQuery(activityPerson?.[1]),
      usesConversationReference,
    };
  }
  if (
    /(?:تفاصيل|ملخص|العلاقات|علاقه|علاقة|احكي|قول).*(?:عن|مع)|(?:ايه|إيه).*(?:مرتبط|علاق)/u.test(normalized)
    && (aboutPerson?.[1] || state?.lastPerson || state?.lastProject || state?.lastFinancialParty)
  ) {
    return {
      intent: "entity_context",
      targetType: aboutPerson?.[1] ? "person" : undefined,
      targetQuery: cleanQuery(aboutPerson?.[1]),
      usesConversationReference,
    };
  }
  return null;
}

export function parseFinancialFollowupAdjustment(
  message: string,
  state: ConversationState,
): FinancialFollowupAdjustment | null {
  const normalized = normalizeEntityText(message);
  if (!/(?:زود|ضيف|اضف).*(?:عليه|عليهم|للمبلغ)/u.test(normalized)) return null;
  const parsedAmount = parseArabicAmount(message);
  if (!parsedAmount) return null;
  if (!state.lastExpense) return { status: "missing_referent" };
  const mentionsCurrency = /جنيه|جنيهات|دولار|ريال|\b(?:EGP|USD|SAR)\b/iu.test(message);
  if (mentionsCurrency && parsedAmount.currency !== state.lastExpense.currency) {
    return { status: "currency_mismatch" };
  }
  const amountMinor = state.lastExpense.amountMinor + parsedAmount.amountMinor;
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  return {
    status: "ready",
    expenseId: state.lastExpense.id,
    amountMinor,
    currency: state.lastExpense.currency,
    previousAmountMinor: state.lastExpense.amountMinor,
    deltaMinor: parsedAmount.amountMinor,
  };
}

function emptyContext(intent: RelationshipIntent): RelationshipContext {
  return {
    version: 1,
    intent,
    bounds: RELATIONSHIP_CONTEXT_LIMITS,
    resolvedEntities: [],
    relevantRelationships: [],
    relevantRecords: [],
    financialSummary: {},
    recentActivity: [],
    conversationReferences: [],
    uncertainties: [],
    truncated: false,
  };
}

function contextEntity(
  result: ResolverResult,
  fallbackType?: ResolvedContextEntity["type"],
): ResolvedContextEntity | undefined {
  if (!result.selected) return undefined;
  return {
    id: result.selected.id,
    name: result.selected.name,
    type: fallbackType ?? result.entityType,
    matchType: result.matchType === "ambiguous" || result.matchType === "none" ? "fuzzy" : result.matchType,
    confidence: result.confidence,
  };
}

function conversationEntity(entity: ConversationEntity): ResolvedContextEntity {
  return {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    matchType: "conversation",
    confidence: 1,
  };
}

async function resolveTarget(
  identity: Identity,
  parsed: ParsedRelationshipRequest,
  state: ConversationState,
): Promise<
  | { status: "selected"; entity: ResolvedContextEntity }
  | { status: "missing"; type: "person" | "project"; query: string }
  | { status: "ambiguous"; type: "person" | "project"; query: string; candidates: Array<{ id: string; name: string }> }
  | { status: "none" }
> {
  if (parsed.targetType && parsed.targetQuery) {
    const result = await resolveEntity(identity, parsed.targetType, parsed.targetQuery);
    if (result.matchType === "ambiguous") {
      return {
        status: "ambiguous",
        type: parsed.targetType,
        query: parsed.targetQuery,
        candidates: result.candidates.map(({ id, name }) => ({ id, name })),
      };
    }
    const entity = contextEntity(result);
    return entity
      ? { status: "selected", entity }
      : { status: "missing", type: parsed.targetType, query: parsed.targetQuery };
  }
  if (parsed.usesConversationReference || parsed.intent === "entity_context") {
    if (parsed.targetType === "project" && parsed.ordinal) {
      const candidate = state.candidateProjects[parsed.ordinal - 1];
      if (candidate) return { status: "selected", entity: conversationEntity(candidate) };
      return { status: "none" };
    }
    const previous = parsed.targetType === "project"
      ? state.lastProject
      : parsed.targetType === "person"
        ? state.lastPerson
        : state.lastFinancialParty ?? state.lastProject ?? state.lastPerson;
    if (previous) return { status: "selected", entity: conversationEntity(previous) };
  }
  return { status: "none" };
}

async function linkedParties(
  identity: Identity,
  entity: ResolvedContextEntity,
): Promise<FinancialParty[]> {
  if (entity.type === "financial_party") {
    return db.select().from(financialPartiesTable).where(and(
      eq(financialPartiesTable.tenantId, identity.tenantId),
      eq(financialPartiesTable.ownerUserId, identity.userId),
      eq(financialPartiesTable.id, entity.id),
    )).limit(1);
  }
  if (entity.type === "person") {
    return db.select({ party: financialPartiesTable })
      .from(financialPartyPeopleTable)
      .innerJoin(financialPartiesTable, eq(financialPartyPeopleTable.partyId, financialPartiesTable.id))
      .where(and(
        eq(financialPartyPeopleTable.tenantId, identity.tenantId),
        eq(financialPartyPeopleTable.ownerUserId, identity.userId),
        eq(financialPartiesTable.tenantId, identity.tenantId),
        eq(financialPartiesTable.ownerUserId, identity.userId),
        eq(financialPartyPeopleTable.personId, entity.id),
      ))
      .limit(RELATIONSHIP_CONTEXT_LIMITS.maxRelationships + 1)
      .then((rows) => rows.map((row) => row.party));
  }
  return db.select({ party: financialPartiesTable })
    .from(financialPartyProjectsTable)
    .innerJoin(financialPartiesTable, eq(financialPartyProjectsTable.partyId, financialPartiesTable.id))
    .where(and(
      eq(financialPartyProjectsTable.tenantId, identity.tenantId),
      eq(financialPartyProjectsTable.ownerUserId, identity.userId),
      eq(financialPartiesTable.tenantId, identity.tenantId),
      eq(financialPartiesTable.ownerUserId, identity.userId),
      eq(financialPartyProjectsTable.projectId, entity.id),
    ))
    .limit(RELATIONSHIP_CONTEXT_LIMITS.maxRelationships + 1)
    .then((rows) => rows.map((row) => row.party));
}

async function resolvePartyForEntity(
  identity: Identity,
  entity: ResolvedContextEntity,
): Promise<PartyResolution> {
  const linked = await linkedParties(identity, entity);
  if (linked.length === 1) return { status: "selected", party: linked[0], entity };
  if (linked.length > 1) {
    return {
      status: "ambiguous",
      query: entity.name,
      candidates: linked.map(({ id, name }) => ({ id, name })),
    };
  }
  const result = await resolveEntity(identity, "financial_party", entity.name);
  if (result.matchType === "ambiguous") {
    return {
      status: "ambiguous",
      query: entity.name,
      candidates: result.candidates.map(({ id, name }) => ({ id, name })),
    };
  }
  if (!result.selected) return { status: "missing", query: entity.name };
  if (result.matchType !== "exact") {
    return {
      status: "ambiguous",
      query: entity.name,
      candidates: result.candidates.map(({ id, name }) => ({ id, name })),
    };
  }
  const [party] = await db.select().from(financialPartiesTable).where(and(
    eq(financialPartiesTable.tenantId, identity.tenantId),
    eq(financialPartiesTable.ownerUserId, identity.userId),
    eq(financialPartiesTable.id, result.selected.id),
  )).limit(1);
  return party ? { status: "selected", party, entity } : { status: "missing", query: entity.name };
}

async function rawMoneyTotals(
  text: string,
  values: unknown[],
): Promise<ContextMoneyTotal[]> {
  const result = await pool.query(
    `SELECT currency, amount_minor, count
     FROM (${text}) AS bounded_money_totals
     ORDER BY currency ASC
     LIMIT 10`,
    values,
  );
  return result.rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const currency = typeof item.currency === "string" ? item.currency : "EGP";
    const amountMinor = Number(item.amount_minor ?? 0);
    const count = Number(item.count ?? 0);
    return Number.isFinite(amountMinor) && Number.isFinite(count)
      ? [{ currency: currency.slice(0, 10), amountMinor, count }]
      : [];
  }).slice(0, 10);
}

function summaryReachedCategoryBound(summary: Record<string, ContextMoneyTotal[]>): boolean {
  return Object.values(summary).some((totals) => totals.length >= 10);
}

async function partyFinancialSummary(
  identity: Identity,
  partyId: string,
): Promise<Record<string, ContextMoneyTotal[]>> {
  const params = [identity.tenantId, identity.userId, partyId];
  const obligationBase = `
    FROM financial_obligations o
    LEFT JOIN (
      SELECT obligation_id, SUM(amount_minor)::bigint AS settled_minor
      FROM obligation_settlements
      WHERE tenant_id = $1 AND owner_user_id = $2
      GROUP BY obligation_id
    ) s ON s.obligation_id = o.id
    WHERE o.tenant_id = $1 AND o.owner_user_id = $2
      AND o.status = 'open'`;
  const [owedBy, owedTo, receivableFrom, receivableTo] = await Promise.all([
    rawMoneyTotals(
      `SELECT o.currency, SUM(GREATEST(o.principal_amount_minor - COALESCE(s.settled_minor, 0), 0))::bigint AS amount_minor, COUNT(*)::int AS count
       ${obligationBase} AND o.borrower_party_id = $3 GROUP BY o.currency
       HAVING SUM(GREATEST(o.principal_amount_minor - COALESCE(s.settled_minor, 0), 0)) > 0`,
      params,
    ),
    rawMoneyTotals(
      `SELECT o.currency, SUM(GREATEST(o.principal_amount_minor - COALESCE(s.settled_minor, 0), 0))::bigint AS amount_minor, COUNT(*)::int AS count
       ${obligationBase} AND o.lender_party_id = $3 GROUP BY o.currency
       HAVING SUM(GREATEST(o.principal_amount_minor - COALESCE(s.settled_minor, 0), 0)) > 0`,
      params,
    ),
    rawMoneyTotals(
      `SELECT currency, SUM(amount_minor)::bigint AS amount_minor, COUNT(*)::int AS count
       FROM income_receivables
       WHERE tenant_id = $1 AND owner_user_id = $2 AND debtor_party_id = $3 AND status = 'open'
       GROUP BY currency`,
      params,
    ),
    rawMoneyTotals(
      `SELECT currency, SUM(amount_minor)::bigint AS amount_minor, COUNT(*)::int AS count
       FROM income_receivables
       WHERE tenant_id = $1 AND owner_user_id = $2 AND creditor_party_id = $3 AND status = 'open'
       GROUP BY currency`,
      params,
    ),
  ]);
  return {
    outstandingObligationsOwedByParty: owedBy,
    outstandingObligationsOwedToParty: owedTo,
    openReceivablesOwedByParty: receivableFrom,
    openReceivablesOwedToParty: receivableTo,
  };
}

function totalsLabel(totals: ContextMoneyTotal[]): string {
  return totals.length === 0
    ? "لا شيء مسجل"
    : totals.map((total) => new Intl.NumberFormat("ar-EG", {
      style: "currency",
      currency: total.currency,
    }).format(total.amountMinor / 100)).join("، ");
}

function groundedMoney(
  summary: Record<string, ContextMoneyTotal[]>,
): Array<{ type: "money"; value: number; currency: string; label: string }> {
  return Object.entries(summary).flatMap(([label, totals]) =>
    totals.map((total) => ({
      type: "money" as const,
      value: total.amountMinor,
      currency: total.currency,
      label,
    })));
}

async function recentPayments(
  identity: Identity,
  partyId?: string,
): Promise<Array<Record<string, unknown>>> {
  const rows = await db.select().from(financialPaymentsTable).where(and(
    eq(financialPaymentsTable.tenantId, identity.tenantId),
    eq(financialPaymentsTable.ownerUserId, identity.userId),
    ...(partyId
      ? [or(
          eq(financialPaymentsTable.payerPartyId, partyId),
          eq(financialPaymentsTable.payeePartyId, partyId),
        )!]
      : []),
  )).orderBy(desc(financialPaymentsTable.occurredAt), desc(financialPaymentsTable.id)).limit(RELATIONSHIP_CONTEXT_LIMITS.maxRecords);
  return rows.map((row) => ({
    id: row.id,
    paymentKind: row.paymentKind,
    amountMinor: row.amountMinor,
    currency: row.currency,
    occurredAt: row.occurredAt.toISOString(),
    payerPartyId: row.payerPartyId,
    payeePartyId: row.payeePartyId,
  }));
}

async function recentEntityActivity(
  identity: Identity,
  entity?: ResolvedContextEntity,
): Promise<Array<Record<string, unknown>>> {
  if (!entity) {
    const events = await db.select().from(activityEventsTable).where(and(
      eq(activityEventsTable.tenantId, identity.tenantId),
      eq(activityEventsTable.ownerUserId, identity.userId),
    )).orderBy(desc(activityEventsTable.occurredAt), desc(activityEventsTable.id)).limit(RELATIONSHIP_CONTEXT_LIMITS.maxTimelineEvents);
    return events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      summary: event.summary,
      occurredAt: event.occurredAt.toISOString(),
    }));
  }
  const events = await db.select({ event: activityEventsTable })
    .from(activityEventEntitiesTable)
    .innerJoin(activityEventsTable, eq(activityEventEntitiesTable.eventId, activityEventsTable.id))
    .where(and(
      eq(activityEventEntitiesTable.tenantId, identity.tenantId),
      eq(activityEventEntitiesTable.ownerUserId, identity.userId),
      eq(activityEventsTable.tenantId, identity.tenantId),
      eq(activityEventsTable.ownerUserId, identity.userId),
      eq(activityEventEntitiesTable.entityType, entity.type),
      eq(activityEventEntitiesTable.entityId, entity.id),
    ))
    .orderBy(desc(activityEventsTable.occurredAt), desc(activityEventsTable.id))
    .limit(RELATIONSHIP_CONTEXT_LIMITS.maxTimelineEvents);
  return events.map(({ event }) => ({
    id: event.id,
    eventType: event.eventType,
    summary: event.summary,
    occurredAt: event.occurredAt.toISOString(),
  }));
}

async function projectExpenseContext(
  identity: Identity,
  project: ResolvedContextEntity,
): Promise<{ totals: ContextMoneyTotal[]; records: Array<Record<string, unknown>> }> {
  const [totals, records] = await Promise.all([
    rawMoneyTotals(
      `SELECT currency, SUM(amount_minor)::bigint AS amount_minor, COUNT(*)::int AS count
       FROM expenses
       WHERE tenant_id = $1 AND owner_user_id = $2 AND project_id = $3
       GROUP BY currency`,
      [identity.tenantId, identity.userId, project.id],
    ),
    db.select().from(expensesTable).where(and(
      eq(expensesTable.tenantId, identity.tenantId),
      eq(expensesTable.ownerUserId, identity.userId),
      eq(expensesTable.projectId, project.id),
    )).orderBy(desc(expensesTable.occurredAt), desc(expensesTable.id)).limit(RELATIONSHIP_CONTEXT_LIMITS.maxRecords),
  ]);
  return {
    totals,
    records: records.map((row) => ({
      id: row.id,
      description: row.description,
      amountMinor: row.amountMinor,
      currency: row.currency,
      occurredAt: row.occurredAt.toISOString(),
    })),
  };
}

async function globalFinancialSummary(
  identity: Identity,
  intent: RelationshipIntent,
): Promise<{ summary: Record<string, ContextMoneyTotal[]>; records: Array<Record<string, unknown>> }> {
  if (intent === "recent_payments") {
    const records = await recentPayments(identity);
    const totals = new Map<string, ContextMoneyTotal>();
    for (const record of records) {
      const currency = String(record.currency);
      const current = totals.get(currency) ?? { currency, amountMinor: 0, count: 0 };
      current.amountMinor += Number(record.amountMinor);
      current.count += 1;
      totals.set(currency, current);
    }
    return { summary: { recentPayments: [...totals.values()] }, records };
  }
  if (intent === "open_obligations") {
    const totals = await rawMoneyTotals(
      `SELECT o.currency, SUM(GREATEST(o.principal_amount_minor - COALESCE(s.settled_minor, 0), 0))::bigint AS amount_minor, COUNT(*)::int AS count
       FROM financial_obligations o
       LEFT JOIN (
         SELECT obligation_id, SUM(amount_minor)::bigint AS settled_minor
         FROM obligation_settlements
         WHERE tenant_id = $1 AND owner_user_id = $2
         GROUP BY obligation_id
       ) s ON s.obligation_id = o.id
       WHERE o.tenant_id = $1 AND o.owner_user_id = $2 AND o.status = 'open'
       GROUP BY o.currency`,
      [identity.tenantId, identity.userId],
    );
    return { summary: { openObligations: totals }, records: [] };
  }
  if (intent === "expected_income" || intent === "collected_income") {
    const status = intent === "expected_income" ? "open" : "settled";
    const totals = await rawMoneyTotals(
      `SELECT currency, SUM(amount_minor)::bigint AS amount_minor, COUNT(*)::int AS count
       FROM income_receivables
       WHERE tenant_id = $1 AND owner_user_id = $2 AND status = $3
       GROUP BY currency`,
      [identity.tenantId, identity.userId, status],
    );
    return { summary: { [intent === "expected_income" ? "expectedIncome" : "collectedIncome"]: totals }, records: [] };
  }
  if (intent === "donations") {
    const totals = await rawMoneyTotals(
      `SELECT currency, SUM(amount_minor)::bigint AS amount_minor, COUNT(*)::int AS count
       FROM donations
       WHERE tenant_id = $1 AND owner_user_id = $2 AND status <> 'cancelled'
       GROUP BY currency`,
      [identity.tenantId, identity.userId],
    );
    return { summary: { donations: totals }, records: [] };
  }
  return { summary: {}, records: [] };
}

async function scopedFinancialSummary(
  identity: Identity,
  intent: RelationshipIntent,
  partyId?: string,
  projectId?: string,
): Promise<{ summary: Record<string, ContextMoneyTotal[]>; records: Array<Record<string, unknown>> }> {
  if (!partyId && !projectId) return globalFinancialSummary(identity, intent);
  if (intent === "recent_payments" && partyId) {
    const records = await recentPayments(identity, partyId);
    const paidBy = new Map<string, ContextMoneyTotal>();
    const receivedBy = new Map<string, ContextMoneyTotal>();
    for (const record of records) {
      const currency = String(record.currency).slice(0, 10);
      const target = record.payerPartyId === partyId ? paidBy : receivedBy;
      const total = target.get(currency) ?? { currency, amountMinor: 0, count: 0 };
      total.amountMinor += Number(record.amountMinor);
      total.count += 1;
      target.set(currency, total);
    }
    return {
      summary: {
        recentPaymentsPaidByParty: [...paidBy.values()],
        recentPaymentsReceivedByParty: [...receivedBy.values()],
      },
      records,
    };
  }
  if (intent === "open_obligations" && partyId) {
    return { summary: await partyFinancialSummary(identity, partyId), records: [] };
  }
  if ((intent === "expected_income" || intent === "collected_income") && partyId) {
    const status = intent === "expected_income" ? "open" : "settled";
    const [owedBy, owedTo] = await Promise.all([
      rawMoneyTotals(
        `SELECT currency, SUM(amount_minor)::bigint AS amount_minor, COUNT(*)::int AS count
         FROM income_receivables
         WHERE tenant_id = $1 AND owner_user_id = $2 AND status = $3 AND debtor_party_id = $4
         GROUP BY currency`,
        [identity.tenantId, identity.userId, status, partyId],
      ),
      rawMoneyTotals(
        `SELECT currency, SUM(amount_minor)::bigint AS amount_minor, COUNT(*)::int AS count
         FROM income_receivables
         WHERE tenant_id = $1 AND owner_user_id = $2 AND status = $3 AND creditor_party_id = $4
         GROUP BY currency`,
        [identity.tenantId, identity.userId, status, partyId],
      ),
    ]);
    return {
      summary: {
        receivablesOwedByParty: owedBy,
        receivablesOwedToParty: owedTo,
      },
      records: [],
    };
  }
  if (intent === "donations") {
    if (projectId) {
      const totals = await rawMoneyTotals(
        `SELECT currency, SUM(amount_minor)::bigint AS amount_minor, COUNT(*)::int AS count
         FROM donations
         WHERE tenant_id = $1 AND owner_user_id = $2 AND status <> 'cancelled' AND project_id = $3
         GROUP BY currency`,
        [identity.tenantId, identity.userId, projectId],
      );
      return { summary: { projectDonations: totals }, records: [] };
    }
    if (partyId) {
      const [sent, received] = await Promise.all([
        rawMoneyTotals(
          `SELECT currency, SUM(amount_minor)::bigint AS amount_minor, COUNT(*)::int AS count
           FROM donations
           WHERE tenant_id = $1 AND owner_user_id = $2 AND status <> 'cancelled' AND donor_party_id = $3
           GROUP BY currency`,
          [identity.tenantId, identity.userId, partyId],
        ),
        rawMoneyTotals(
          `SELECT currency, SUM(amount_minor)::bigint AS amount_minor, COUNT(*)::int AS count
           FROM donations
           WHERE tenant_id = $1 AND owner_user_id = $2 AND status <> 'cancelled' AND recipient_party_id = $3
           GROUP BY currency`,
          [identity.tenantId, identity.userId, partyId],
        ),
      ]);
      return { summary: { donationsSentByParty: sent, donationsReceivedByParty: received }, records: [] };
    }
  }
  return globalFinancialSummary(identity, intent);
}

const SUMMARY_LABELS: Record<string, string> = {
  outstandingObligationsOwedByParty: "التزامات عليه",
  outstandingObligationsOwedToParty: "التزامات له",
  openReceivablesOwedByParty: "مستحقات عليه",
  openReceivablesOwedToParty: "مستحقات له",
  recentPaymentsPaidByParty: "مدفوعات دفعها",
  recentPaymentsReceivedByParty: "مدفوعات استلمها",
  receivablesOwedByParty: "مستحقات عليه",
  receivablesOwedToParty: "مستحقات له",
  donationsSentByParty: "تبرعات أرسلها",
  donationsReceivedByParty: "تبرعات استلمها",
  projectDonations: "تبرعات المشروع",
  openObligations: "التزامات مفتوحة",
  recentPayments: "مدفوعات حديثة",
  expectedIncome: "دخل متوقع",
  collectedIncome: "دخل محصل",
  donations: "تبرعات",
};

function labeledSummary(summary: Record<string, ContextMoneyTotal[]>): string {
  return Object.entries(summary)
    .filter(([, totals]) => totals.length > 0)
    .map(([key, totals]) => `${SUMMARY_LABELS[key] ?? key}: ${totalsLabel(totals)}`)
    .join("؛ ");
}

function ambiguityResult(
  context: RelationshipContext,
  query: string,
  candidates: Array<{ id: string; name: string }>,
): RelationshipContextResult {
  context.uncertainties.push("ambiguous_entity");
  context.relevantRecords = candidates.slice(0, 10).map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    candidate: true,
  }));
  return {
    context,
    response: {
      kind: "clarification",
      message: `وجدت أكثر من نتيجة لـ«${query}». حدّد المقصود بالاسم الكامل أو من صفحة السجلات.`,
    },
  };
}

function noTargetResult(
  context: RelationshipContext,
  target: { type?: string; query?: string },
): RelationshipContextResult {
  context.uncertainties.push("entity_not_resolved");
  return {
    context,
    response: {
      kind: "clarification",
      message: target.query
        ? `لم أجد ${target.type === "project" ? "مشروعًا" : "شخصًا"} مطابقًا لـ«${target.query}».`
        : "حدّد الشخص أو المشروع المقصود.",
    },
  };
}

export async function retrieveRelationshipContext(
  identity: Identity,
  message: string,
  state: ConversationState,
): Promise<RelationshipContextResult | null> {
  const parsed = parseRelationshipRequest(message, state);
  if (!parsed) return null;
  const context = emptyContext(parsed.intent);
  const target = await resolveTarget(identity, parsed, state);
  if (target.status === "ambiguous") return ambiguityResult(context, target.query, target.candidates);
  if (target.status === "missing") return noTargetResult(context, target);
  const entity = target.status === "selected" ? target.entity : undefined;
  if (entity) {
    context.resolvedEntities.push(entity);
    if (entity.matchType === "conversation") {
      context.conversationReferences.push({ type: entity.type, id: entity.id, name: entity.name });
    }
  }

  if (parsed.intent === "person_financial_status") {
    if (!entity) return noTargetResult(context, {});
    const partyResult = await resolvePartyForEntity(identity, entity);
    if (partyResult.status === "ambiguous") return ambiguityResult(context, partyResult.query, partyResult.candidates);
    if (partyResult.status === "missing") {
      context.uncertainties.push("financial_party_not_linked");
      return {
        context,
        response: {
          kind: "not_found",
          message: `وجدت ${entity.name}، لكن لا يوجد طرف مالي مرتبط به.`,
        },
      };
    }
    const partyEntity: ResolvedContextEntity = {
      id: partyResult.party.id,
      name: partyResult.party.name,
      type: "financial_party",
      matchType: partyResult.entity?.matchType ?? "exact",
      confidence: partyResult.entity?.confidence ?? 1,
    };
    context.resolvedEntities.push(partyEntity);
    context.relevantRelationships.push({
      fromType: entity.type,
      fromId: entity.id,
      toType: "financial_party",
      toId: partyEntity.id,
    });
    context.financialSummary = await partyFinancialSummary(identity, partyEntity.id);
    context.truncated = summaryReachedCategoryBound(context.financialSummary);
    const owed = [
      ...(context.financialSummary.outstandingObligationsOwedByParty ?? []),
      ...(context.financialSummary.openReceivablesOwedByParty ?? []),
    ];
    const owedTo = [
      ...(context.financialSummary.outstandingObligationsOwedToParty ?? []),
      ...(context.financialSummary.openReceivablesOwedToParty ?? []),
    ];
    return {
      context,
      response: {
        kind: owed.length > 0 || owedTo.length > 0 ? "answer" : "not_found",
        message: owed.length > 0 || owedTo.length > 0
          ? `${entity.name}: عليه مسجل ${totalsLabel(owed)}، وله مسجل ${totalsLabel(owedTo)}. عرضت الفئات كما هي بدون حساب صافي بينها.`
          : `لا توجد التزامات أو مستحقات مفتوحة مرتبطة بـ${entity.name}.`,
        groundedFacts: groundedMoney(context.financialSummary),
      },
    };
  }

  if (parsed.intent === "project_expenses") {
    if (!entity || entity.type !== "project") return noTargetResult(context, { type: "project" });
    const expenseContext = await projectExpenseContext(identity, entity);
    context.financialSummary = { projectExpenses: expenseContext.totals };
    context.truncated = summaryReachedCategoryBound(context.financialSummary);
    context.relevantRecords = expenseContext.records;
    return {
      context,
      response: {
        kind: expenseContext.totals.length > 0 ? "answer" : "not_found",
        message: expenseContext.totals.length > 0
          ? `مصروفات مشروع ${entity.name}: ${totalsLabel(expenseContext.totals)} عبر ${expenseContext.totals.reduce((sum, total) => sum + total.count, 0)} سجل.`
          : `لا توجد مصروفات مسجلة لمشروع ${entity.name}.`,
        groundedFacts: groundedMoney(context.financialSummary),
      },
    };
  }

  if (parsed.intent === "recent_activity") {
    context.recentActivity = await recentEntityActivity(identity, entity);
    return {
      context,
      response: {
        kind: context.recentActivity.length > 0 ? "answer" : "not_found",
        message: context.recentActivity.length > 0
          ? `آخر نشاط${entity ? ` مرتبط بـ${entity.name}` : ""}: ${context.recentActivity.map((event) => event.summary).join("، ")}.`
          : `لا يوجد نشاط مسجل${entity ? ` مرتبط بـ${entity.name}` : ""}.`,
        groundedFacts: [{ type: "count", value: context.recentActivity.length, label: "عدد الأحداث المعروضة" }],
      },
    };
  }

  if (parsed.intent === "overdue_commitments") {
    const now = new Date();
    const rows = await db.select().from(commitmentsTable).where(and(
      eq(commitmentsTable.tenantId, identity.tenantId),
      eq(commitmentsTable.ownerUserId, identity.userId),
      eq(commitmentsTable.status, "open"),
      lt(commitmentsTable.dueAt, now),
    )).orderBy(desc(commitmentsTable.dueAt), desc(commitmentsTable.id)).limit(RELATIONSHIP_CONTEXT_LIMITS.maxRecords + 1);
    const overdue = rows.slice(0, RELATIONSHIP_CONTEXT_LIMITS.maxRecords);
    context.relevantRecords = overdue.map((row) => ({
      id: row.id,
      title: row.title,
      dueAt: row.dueAt?.toISOString(),
      status: row.status,
    }));
    context.truncated = rows.length > RELATIONSHIP_CONTEXT_LIMITS.maxRecords;
    return {
      context,
      response: {
        kind: overdue.length > 0 ? "answer" : "not_found",
        message: overdue.length > 0
          ? `عندك ${overdue.length} التزام متأخر معروض: ${overdue.map((row) => row.title).join("، ")}.`
          : "لا توجد التزامات متأخرة مفتوحة.",
        groundedFacts: [{ type: "count", value: overdue.length, label: "الالتزامات المتأخرة المعروضة" }],
      },
    };
  }

  if (parsed.intent === "entity_context") {
    if (!entity) return noTargetResult(context, {});
    context.recentActivity = await recentEntityActivity(identity, entity);
    if (entity.type !== "financial_party") {
      const parties = await linkedParties(identity, entity);
      context.relevantRelationships = parties.slice(0, RELATIONSHIP_CONTEXT_LIMITS.maxRelationships).map((party) => ({
        entityType: entity.type,
        entityId: entity.id,
        relatedType: "financial_party",
        relatedId: party.id,
        relatedName: party.name,
      }));
      context.truncated = parties.length > RELATIONSHIP_CONTEXT_LIMITS.maxRelationships;
    }
    return { context };
  }

  let partyId: string | undefined;
  if (entity && !(parsed.intent === "donations" && entity.type === "project")) {
    const partyResult = await resolvePartyForEntity(identity, entity);
    if (partyResult.status === "ambiguous") return ambiguityResult(context, partyResult.query, partyResult.candidates);
    if (partyResult.status === "missing") {
      context.uncertainties.push("financial_party_not_linked");
      return {
        context,
        response: {
          kind: "not_found",
          message: `لا يوجد طرف مالي مرتبط بـ${entity.name}، لذلك لم أستخدم بيانات مالية عامة بدلًا منه.`,
        },
      };
    }
    if (partyResult.status === "selected") {
      partyId = partyResult.party.id;
      context.resolvedEntities.push({
        id: partyResult.party.id,
        name: partyResult.party.name,
        type: "financial_party",
        matchType: entity.matchType,
        confidence: entity.confidence,
      });
    }
  }
  const scoped = await scopedFinancialSummary(
    identity,
    parsed.intent,
    partyId,
    entity?.type === "project" ? entity.id : undefined,
  );
  context.financialSummary = scoped.summary;
  context.relevantRecords = scoped.records;
  context.truncated = context.truncated || summaryReachedCategoryBound(context.financialSummary);
  const totals = Object.values(context.financialSummary).flat();
  const label = parsed.intent === "open_obligations"
    ? "السلف والديون المفتوحة"
    : parsed.intent === "recent_payments"
      ? "المدفوعات الأخيرة"
      : parsed.intent === "expected_income"
        ? "الدخل والمستحقات المتوقعة"
        : parsed.intent === "collected_income"
          ? "الدخل المحصل"
          : "التبرعات";
  return {
    context,
    response: {
      kind: totals.length > 0 ? "answer" : "not_found",
      message: totals.length > 0
        ? `${label}${partyId && entity ? ` للطرف المرتبط بـ${entity.name}` : ""}: ${labeledSummary(context.financialSummary)}.`
        : `لا توجد بيانات مسجلة ضمن ${label}.`,
      groundedFacts: groundedMoney(context.financialSummary),
    },
  };
}

export function serializeRelationshipContext(context: RelationshipContext): string {
  const serialized = JSON.stringify(context);
  if (serialized.length <= RELATIONSHIP_CONTEXT_LIMITS.maxContextChars) return serialized;
  const compact: RelationshipContext = {
    ...context,
    relevantRelationships: context.relevantRelationships.slice(0, 4),
    relevantRecords: context.relevantRecords.slice(0, 4),
    recentActivity: context.recentActivity.slice(0, 4),
    truncated: true,
  };
  const compactSerialized = JSON.stringify(compact);
  return compactSerialized.length <= RELATIONSHIP_CONTEXT_LIMITS.maxContextChars
    ? compactSerialized
    : (() => {
        const reduced = JSON.stringify({
          version: compact.version,
          intent: compact.intent,
          bounds: compact.bounds,
          resolvedEntities: compact.resolvedEntities.slice(0, RELATIONSHIP_CONTEXT_LIMITS.maxEntities).map((entity) => ({
            ...entity,
            name: entity.name.slice(0, 120),
          })),
          financialSummary: Object.fromEntries(
            Object.entries(compact.financialSummary).slice(0, 8).map(([key, totals]) => [
              key.slice(0, 80),
              totals.slice(0, 8).map((total) => ({
                ...total,
                currency: total.currency.slice(0, 10),
              })),
            ]),
          ),
          uncertainties: ["context_size_reduced"],
          truncated: true,
        });
        return reduced.length <= RELATIONSHIP_CONTEXT_LIMITS.maxContextChars
          ? reduced
          : JSON.stringify({
              version: compact.version,
              intent: compact.intent,
              bounds: compact.bounds,
              uncertainties: ["context_size_reduced"],
              truncated: true,
            });
      })();
}