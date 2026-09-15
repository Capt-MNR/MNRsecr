export type SemanticDomain =
  | "expense"
  | "reminder"
  | "schedule"
  | "person"
  | "project"
  | "memory"
  | "unknown";

export type SemanticIntent =
  | "record_expense"
  | "expense_report"
  | "person_expense_total"
  | "project_people"
  | "create_reminder"
  | "schedule_read"
  | "create_person"
  | "create_project"
  | "memory_recall"
  | "unknown";

export type EntityMention = {
  entityType: "person" | "project";
  query: string;
  confidence: number;
};

export type ParsedDateTime = {
  iso: string;
  dayOffset: number;
  hour: number;
  minute: number;
  confidence: number;
};

export type ParsedAmount = {
  amountMinor: number;
  currency: "EGP" | "USD" | "SAR";
  raw: string;
  confidence: number;
};

export type SemanticParse = {
  originalText: string;
  normalizedText: string;
  tokens: string[];
  domains: SemanticDomain[];
  intent: SemanticIntent;
  confidence: number;
  amount?: ParsedAmount;
  dateTime?: ParsedDateTime;
  entityMentions: EntityMention[];
  hasWriteLanguage: boolean;
  hasReadLanguage: boolean;
  ambiguous: boolean;
};

export type DeterministicDecision =
  | {
      kind: "deterministic";
      intent: SemanticIntent;
      confidence: number;
      requiresApproval: boolean;
      reason: string;
    }
  | {
      kind: "clarification";
      intent: SemanticIntent;
      confidence: number;
      reason: string;
    }
  | {
      kind: "llm";
      intent: "unknown";
      confidence: number;
      reason: string;
    };

export type ValidationIssue = {
  field: string;
  code: string;
  message: string;
};

export type DeterministicValidation = {
  valid: boolean;
  issues: ValidationIssue[];
};

export type DeterministicRequestMetrics = {
  layerVersion: 1;
  normalizationApplied: boolean;
  semanticParsed: boolean;
  resolverUsed: boolean;
  entityMatches: number;
  entityAmbiguities: number;
  validationFailures: number;
  decision: "deterministic" | "clarification" | "llm_fallback" | "not_run";
  solvedWithoutLlm: boolean;
  llmCallsAvoided: number;
  falsePositiveGuard: "passed" | "blocked" | "not_applicable";
};

export type RelationshipRecord = {
  personId: string;
  projectId: string;
  relationship?: string | null;
};

export type ExpensePatternRecord = {
  id: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  personId?: string | null;
  projectId?: string | null;
};

export type PatternInsight = {
  kind: "relationship" | "recurring_expense" | "frequent_entity" | "recent_activity";
  confidence: number;
  qualification: "observed" | "repeated_observation" | "derived_from_saved_rows";
  value: Record<string, unknown>;
};

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const MONEY_WORDS = /جنيه|جنية|دولار|ريال|مصروف|مصاريف|فلوس|دفعت|دفع|صرف|سجل|اديت|أديت|انفقت|أنفقت|حولت|تحويل|خد|اخد|أخد/i;
const REMINDER_WORDS = /فكرني|ذكرني|تذكير|تذكرني|remind|reminder/i;
const READ_WORDS = /إيه|ايه|ما|ماذا|كم|كام|قد\s*إيه|اجمالي|إجمالي|مجموع|تقرير|اعرض|أعرض|وريني|هات|عندي|مين|هل|مواعيد|show|total|list/i;
const WRITE_WORDS = /سجل|سجّل|دفعت|دفع|صرف|اديت|أديت|حولت|تحويل|خد|اخد|أخد|أضف|اضف|ضيف|أنشئ|انشئ|اعمل|عدّل|عدل|غيّر|غير|احذف|امسح|فكرني|ذكرني|create|add|record|update|delete|remind/i;

const SYNONYMS: Array<[RegExp, string]> = [
  [/(?:النهارده|نهارده|اليوم|اليوم ده)/gu, "اليوم"],
  [/(?:بكره|بكرة|غدا|غدًا|غداً)/gu, "بكره"],
  [/(?:الأسبوع ده|الاسبوع ده|الأسبوع الحالي|الاسبوع الحالي)/gu, "الاسبوع الحالي"],
  [/(?:الشهر ده|الشهر الحالي)/gu, "الشهر الحالي"],
  [/(?:قد\s*إيه|قد\s*ايه|كام|كم)/gu, "كم"],
  [/(?:إجمالي|اجمالي|مجموع)/gu, "اجمالي"],
  [/(?:مصروفات|مصاريف|انفاق|إنفاق)/gu, "مصروفات"],
];

export function arabicDigitsToAscii(value: string): string {
  return value.replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
}

export function normalizeArabicText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\u0640/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/[ئىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[پ]/g, "ب")
    .replace(/[چ]/g, "ج")
    .replace(/[گ]/g, "ك")
    .replace(/[\u064B-\u065F]/g, "")
    .replace(/[،؛؟!.,:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ar");
}

export function canonicalizeArabicText(value: string): string {
  let normalized = normalizeArabicText(value);
  for (const [pattern, replacement] of SYNONYMS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/\s+/g, " ").trim();
}

function cleanMention(value: string): string {
  return value
    .replace(/^(?:ال|يا)\s+/u, "")
    .replace(/\s+(?:بمبلغ|مبلغ|بقيمة|جنيه|جنية|دولار|ريال|على|في|من)\b.*$/iu, "")
    .replace(/[،؛؟!.,:]+$/u, "")
    .trim();
}

function currencyFromText(value: string): ParsedAmount["currency"] {
  const normalized = canonicalizeArabicText(value);
  if (normalized.includes("دولار") || /\busd\b/i.test(normalized)) return "USD";
  if (normalized.includes("ريال") || /\bsar\b/i.test(normalized)) return "SAR";
  return "EGP";
}

function amountNumber(raw: string): number {
  const ascii = arabicDigitsToAscii(raw).replace(/\s/g, "");
  const hasComma = ascii.includes(",");
  const hasDot = ascii.includes(".");
  let numeric = ascii;
  if (hasComma && hasDot) {
    numeric = ascii.lastIndexOf(",") > ascii.lastIndexOf(".")
      ? ascii.replace(/\./g, "").replace(",", ".")
      : ascii.replace(/,/g, "");
  } else if (hasComma || hasDot) {
    const separator = hasComma ? "," : ".";
    const pieces = ascii.split(separator);
    numeric = pieces.length === 2 && pieces[1].length === 3
      ? pieces.join("")
      : ascii.replace(separator, ".");
  }
  return Number(numeric);
}

export function parseArabicAmount(value: string): ParsedAmount | null {
  const normalized = canonicalizeArabicText(value);
  const numeric = value.match(/[\d٠-٩]+(?:[.,][\d٠-٩]+)*/u);
  let amount: number | null = numeric ? amountNumber(numeric[0]) : null;
  let raw = numeric?.[0] ?? "";

  if (amount === null || !Number.isFinite(amount)) {
    const wordAmounts: Record<string, number> = {
      الف: 1000,
      الفين: 2000,
      "ثلاثه الاف": 3000,
      "ثلاث الاف": 3000,
      "خمسه الاف": 5000,
      "خمسه الاف ونصف": 5500,
      "خمسة الاف": 5000,
      "سبعه الاف": 7000,
      "سبعة الاف": 7000,
      "عشره الاف": 10000,
      "عشرة الاف": 10000,
    };
    const matched = Object.entries(wordAmounts).find(([key]) =>
      new RegExp(`(?:^|\\s)${key.replace(/\s+/g, "\\\\s+")}(?=\\s|$)`, "u").test(normalized));
    if (matched) {
      raw = matched[0];
      amount = matched[1];
    }
  }

  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  const thousand = /(?:الف|آلاف|الاف)\b/u.test(normalized) && numeric
    ? amount * 1000
    : amount;
  const amountMinor = Math.round(thousand * 100);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  return {
    amountMinor,
    currency: currencyFromText(value),
    raw,
    confidence: numeric ? 0.99 : 0.93,
  };
}

function cairoDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function cairoOffsetAt(utcGuess: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  ) - utcGuess;
}

function cairoLocalDate(
  parts: { year: number; month: number; day: number },
  hour: number,
  minute: number,
): Date {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute);
  return new Date(utcGuess - cairoOffsetAt(utcGuess));
}

export function parseArabicDateTime(value: string, now = new Date()): ParsedDateTime | null {
  const normalized = canonicalizeArabicText(value);
  const dayOffset = normalized.includes("بكره")
    ? 1
    : normalized.includes("اليوم")
      ? 0
      : null;
  const time = normalized.match(
    /(?:الساعه\s*)?([0-9]{1,2})(?:\s*[:٫]\s*([0-9]{1,2}))?\s*(صباحا|مساء|بالليل|ليل|ظهر)?/u,
  );
  if (dayOffset === null || !time) return null;
  let hour = Number(time[1]);
  const minute = time[2] ? Number(time[2]) : 0;
  const period = time[3] ?? "";
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  if ((period === "مساء" || period === "بالليل" || period === "ليل") && hour < 12) hour += 12;
  if (period === "صباحا" && hour === 12) hour = 0;
  if (period === "ظهر" && hour < 12) hour += 12;
  const today = cairoDateParts(now);
  const date = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset));
  const dateParts = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
  return {
    iso: cairoLocalDate(dateParts, hour, minute).toISOString(),
    dayOffset,
    hour,
    minute,
    confidence: period ? 0.99 : 0.94,
  };
}

function extractEntityMentions(message: string): EntityMention[] {
  const mentions: EntityMention[] = [];
  const person = message.match(
    /(?<!\p{L})(?:ل|الى|إلى|مع|لصالح)\s*([\p{L}][\p{L}\s-]{1,40}?)(?=\s+(?:بمبلغ|مبلغ|بقيمة|على|في|جنيه|جنية|دولار|ريال|الف|الفين|ألف|ألفين|امبارح|أمس|اليوم|بكره|[0-9٠-٩])|$)/u,
  );
  if (person?.[1]) {
    const query = cleanMention(person[1]);
    if (query.length >= 2) mentions.push({ entityType: "person", query, confidence: 0.9 });
  }
  const project = message.match(
    /(?:مشروع|project)\s+(?:اسمه\s+)?([\p{L}][\p{L}\s-]{1,50}?)(?=\s+(?:بمبلغ|مبلغ|بقيمة|جنيه|جنية|دولار|ريال|الف|الفين|ألف|ألفين|امبارح|أمس|اليوم|بكره|[0-9٠-٩])|$)/iu,
  );
  if (project?.[1]) {
    const query = cleanMention(project[1]);
    if (query.length >= 2) mentions.push({ entityType: "project", query, confidence: 0.92 });
  }
  return mentions;
}

export function parseSemanticRequest(message: string): SemanticParse {
  const originalText = message.trim();
  const normalizedText = canonicalizeArabicText(originalText);
  const tokens = normalizedText.split(/\s+/u).filter(Boolean);
  const hasWriteLanguage = WRITE_WORDS.test(originalText);
  const hasReadLanguage = READ_WORDS.test(originalText);
  const amount = REMINDER_WORDS.test(originalText) ? undefined : parseArabicAmount(originalText);
  const entityMentions = extractEntityMentions(originalText);
  const personTotal = originalText.match(/^(.+?)\s+(?:اخد|أخد)\s+مني\s+(?:كام|كم)/iu);
  const personReceived = originalText.match(/^([\p{L}][\p{L}\s-]{1,40}?)\s+(?:خد|اخد|أخد)\s+مني(?=\s|$)/iu);
  if (personTotal?.[1]?.trim() && !entityMentions.some((item) => item.entityType === "person")) {
    entityMentions.push({
      entityType: "person",
      query: personTotal[1].trim(),
      confidence: 0.94,
    });
  }
  if (personReceived?.[1]?.trim() && !entityMentions.some((item) => item.entityType === "person")) {
    entityMentions.push({
      entityType: "person",
      query: personReceived[1].trim(),
      confidence: 0.94,
    });
  }
  const explicitExpenseWrite = Boolean(amount && hasWriteLanguage)
    || /(?:سجل|سجّل)\s+(?:لي\s+)?(?:مصروف|مصاريف)|record\s+expense/iu.test(originalText);
  const domains = new Set<SemanticDomain>();
  if (MONEY_WORDS.test(originalText) || amount || personTotal) domains.add("expense");
  if (REMINDER_WORDS.test(originalText)) domains.add("reminder");
  if (/موعد|مواعيد|ميعاد|مهمه|مهام|schedule|task/i.test(originalText)) domains.add("schedule");
  if (/شخص|جهة|contact|person|مين/i.test(originalText)) domains.add("person");
  if (/مشروع|project/i.test(originalText)) domains.add("project");
  if (/فاكر|آخر|اخر|سجلنا|المحفوظ|memory|remember/i.test(originalText)) domains.add("memory");

  let intent: SemanticIntent = "unknown";
  let confidence = 0.35;
  const negativePersonCreation = /(?:ما|مش|من\s+غير)\s+.*?(?:تضيف\w*|ضيف\w*|تعمل\w*|اعمل\w*|أعمل\w*|تسجل\w*|سجل\w*).*?(?:شخص|جهة|person|contact)/iu.test(originalText);
  const createPersonSignal = !negativePersonCreation && /(?:(?:^|\s)(?:أضف|اضف|أضيف|اضيف|ضيف|أنشئ|انشئ|اعمل|سجل|سجّل|add|create|record)(?=\s|$).*(?:شخص|جهة|person|contact)|(?:شخص|جهة|person|contact).*(?:اسمه|جديد))/iu.test(originalText);
  const createProjectSignal = /(?:بدأت|انشئ|أنشئ|اعمل|create).*(?:مشروع|project)/iu.test(originalText);
  if (createPersonSignal) {
    intent = "create_person";
    confidence = 0.93;
  } else if (createProjectSignal) {
    intent = "create_project";
    confidence = 0.93;
  } else if (REMINDER_WORDS.test(originalText)) {
    intent = "create_reminder";
    confidence = 0.9;
  } else if (domains.has("expense") && hasReadLanguage && !explicitExpenseWrite) {
    intent = entityMentions.some((item) => item.entityType === "person")
      ? "person_expense_total"
      : "expense_report";
    confidence = 0.91;
  } else if (/مين.*(?:مشروع|project)|(?:الناس|اشخاص).*(?:مشروع|project)/iu.test(originalText)) {
    intent = "project_people";
    confidence = 0.91;
  } else if (domains.has("expense") && explicitExpenseWrite) {
    intent = "record_expense";
    confidence = amount
      ? entityMentions.length > 0 ? 0.93 : 0.82
      : 0.78;
  } else if (domains.has("schedule") && hasReadLanguage && !hasWriteLanguage) {
    intent = "schedule_read";
    confidence = 0.9;
  } else if (domains.has("memory")) {
    intent = "memory_recall";
    confidence = 0.72;
  }

  const domainList = [...domains];
  const intentHasCompatibleDomains = (
    (intent === "record_expense" && domainList.every((domain) => domain === "expense" || domain === "person" || domain === "project"))
    || (intent === "create_person" && domainList.every((domain) => domain === "expense" || domain === "person"))
    || (intent === "create_project" && domainList.every((domain) => domain === "expense" || domain === "project"))
  );
  const ambiguous = domainList.length > 1 && !intentHasCompatibleDomains;
  return {
    originalText,
    normalizedText,
    tokens,
    domains: domainList.length > 0 ? domainList : ["unknown"],
    intent,
    confidence,
    ...(amount ? { amount } : {}),
    ...(REMINDER_WORDS.test(originalText) ? { dateTime: parseArabicDateTime(originalText) ?? undefined } : {}),
    entityMentions,
    hasWriteLanguage,
    hasReadLanguage,
    ambiguous,
  };
}

export function decideDeterministically(parsed: SemanticParse): DeterministicDecision {
  if (parsed.ambiguous) {
    return { kind: "llm", intent: "unknown", confidence: parsed.confidence, reason: "multiple_domains_need_context" };
  }
  if (parsed.intent === "record_expense") {
    return parsed.amount
      ? {
          kind: "deterministic",
          intent: parsed.intent,
          confidence: parsed.confidence,
          requiresApproval: true,
          reason: "high_signal_expense_with_amount",
        }
      : {
          kind: "clarification",
          intent: parsed.intent,
          confidence: parsed.confidence,
          reason: "expense_amount_missing",
        };
  }
  if (parsed.intent === "create_reminder") {
    return parsed.dateTime
      ? {
          kind: "deterministic",
          intent: parsed.intent,
          confidence: parsed.confidence,
          requiresApproval: true,
          reason: "high_signal_reminder_with_date_time",
        }
      : {
          kind: "clarification",
          intent: parsed.intent,
          confidence: parsed.confidence,
          reason: "reminder_date_or_time_missing",
        };
  }
  if ([
    "expense_report",
    "person_expense_total",
    "project_people",
    "schedule_read",
  ].includes(parsed.intent)) {
    return {
      kind: "deterministic",
      intent: parsed.intent,
      confidence: parsed.confidence,
      requiresApproval: false,
      reason: "scoped_read_only_request",
    };
  }
  if (parsed.intent === "create_person" || parsed.intent === "create_project") {
    return {
      kind: "deterministic",
      intent: parsed.intent,
      confidence: parsed.confidence,
      requiresApproval: true,
      reason: "explicit_entity_creation",
    };
  }
  return { kind: "llm", intent: "unknown", confidence: parsed.confidence, reason: "insufficient_deterministic_confidence" };
}

export function validateDeterministicPayload(
  parsed: SemanticParse,
  args: Record<string, unknown>,
): DeterministicValidation {
  const issues: ValidationIssue[] = [];
  if (parsed.intent === "record_expense") {
    const amountMinor = args.amountMinor;
    if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      issues.push({ field: "amountMinor", code: "INVALID_AMOUNT", message: "المبلغ غير صالح." });
    }
    if (typeof args.currency !== "string" || !["EGP", "USD", "SAR"].includes(args.currency)) {
      issues.push({ field: "currency", code: "INVALID_CURRENCY", message: "العملة غير مدعومة." });
    }
    if (typeof args.description !== "string" || !args.description.trim()) {
      issues.push({ field: "description", code: "MISSING_DESCRIPTION", message: "وصف المصروف مطلوب." });
    }
  }
  if (parsed.intent === "create_reminder") {
    const dueAt = typeof args.dueAt === "string" ? new Date(args.dueAt) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) {
      issues.push({ field: "dueAt", code: "INVALID_DATETIME", message: "موعد التذكير غير صالح." });
    } else if (dueAt.getTime() <= Date.now()) {
      issues.push({ field: "dueAt", code: "PAST_DATETIME", message: "موعد التذكير يجب أن يكون في المستقبل." });
    }
  }
  if (parsed.intent === "create_person" || parsed.intent === "create_project") {
    if (typeof args.name !== "string" || args.name.trim().length < 2) {
      issues.push({ field: "name", code: "MISSING_ENTITY_NAME", message: "اسم الكيان مطلوب." });
    }
  }
  return { valid: issues.length === 0, issues };
}

export function createDeterministicRequestMetrics(): DeterministicRequestMetrics {
  return {
    layerVersion: 1,
    normalizationApplied: false,
    semanticParsed: false,
    resolverUsed: false,
    entityMatches: 0,
    entityAmbiguities: 0,
    validationFailures: 0,
    decision: "not_run",
    solvedWithoutLlm: false,
    llmCallsAvoided: 0,
    falsePositiveGuard: "not_applicable",
  };
}

export function buildPatternInsights(
  relationships: RelationshipRecord[],
  expenses: ExpensePatternRecord[],
  now = new Date(),
): PatternInsight[] {
  const insights: PatternInsight[] = [];
  for (const relationship of relationships) {
    if (!relationship.personId || !relationship.projectId) continue;
    insights.push({
      kind: "relationship",
      confidence: 1,
      qualification: "derived_from_saved_rows",
      value: {
        personId: relationship.personId,
        projectId: relationship.projectId,
        relationship: relationship.relationship ?? null,
      },
    });
  }

  const entityCounts = new Map<string, number>();
  for (const expense of expenses) {
    for (const key of [expense.personId ? `person:${expense.personId}` : "", expense.projectId ? `project:${expense.projectId}` : ""]) {
      if (key) entityCounts.set(key, (entityCounts.get(key) ?? 0) + 1);
    }
    const ageMs = now.getTime() - new Date(expense.occurredAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 7 * 24 * 60 * 60 * 1000) {
      insights.push({
        kind: "recent_activity",
        confidence: 1,
        qualification: "derived_from_saved_rows",
        value: { expenseId: expense.id, occurredAt: expense.occurredAt },
      });
    }
  }

  for (const [entity, count] of entityCounts) {
    if (count < 2) continue;
    insights.push({
      kind: "frequent_entity",
      confidence: Math.min(0.99, 0.6 + count / 20),
      qualification: "repeated_observation",
      value: { entity, observations: count },
    });
  }

  const recurrenceGroups = new Map<string, ExpensePatternRecord[]>();
  for (const expense of expenses) {
    const key = [
      expense.amountMinor,
      expense.currency.toUpperCase(),
      expense.personId ?? "",
      expense.projectId ?? "",
    ].join("|");
    recurrenceGroups.set(key, [...(recurrenceGroups.get(key) ?? []), expense]);
  }
  for (const [key, rows] of recurrenceGroups) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const gaps = sorted.slice(1).map((row, index) =>
      Math.abs(new Date(row.occurredAt).getTime() - new Date(sorted[index].occurredAt).getTime())
      / (24 * 60 * 60 * 1000),
    );
    if (gaps.length > 0 && gaps.every((gap) => gap >= 25 && gap <= 35)) {
      insights.push({
        kind: "recurring_expense",
        confidence: Math.min(0.98, 0.7 + rows.length / 20),
        qualification: "repeated_observation",
        value: { key, observations: rows.length, averageGapDays: gaps.reduce((a, b) => a + b, 0) / gaps.length },
      });
    }
  }
  return insights;
}