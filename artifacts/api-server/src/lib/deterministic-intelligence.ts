export type SemanticDomain =
  | "expense"
  | "reminder"
  | "schedule"
  | "work"
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
  | "create_agent_work"
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
  llmAvoidanceMeasurement: "not_claimed" | "decision_level_estimate";
  falsePositiveGuard: "passed" | "blocked" | "not_applicable";
};

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const MONEY_WORDS = /جنيه|جنية|دولار|ريال|ريالات|مصروف|مصروفات|مصاريف|صرفيه|فلوس|دراهم|دفعت|دفع|صرف|سجل|اديت|أديت|اعطيت|عطيت|انفقت|أنفقت|حولت|تحويل|سددت|سدد|خد|اخد|أخد|استلم/i;
const REMINDER_WORDS = /فكرني|ذكرني|تذكير|تذكرني|remind|reminder/i;
const AGENT_WORK_WORDS = /تابع(?:لي|ي)?|راقب(?:لي|ي)?|خليك\s+متابع|لو\s+حصل|بلغني|كل\s+يوم.*راجع|every\s+day|monitor|watch/i;
const READ_WORDS = /إيه|ايه|ما|ماذا|كم|كام|قد\s*إيه|قديش|شكد|شگد|اجمالي|إجمالي|مجموع|تقرير|اعرض|أعرض|وريني|هات|عندي|مين|هل|مواعيد|شو|ايش|وش|وين|show|total|list/i;
const WRITE_WORDS = /سجل|سجّل|دفعت|دفع|صرف|اديت|أديت|اعطيت|عطيت|حولت|تحويل|سددت|سدد|خد|اخد|أخد|استلم|أضف|اضف|ضيف|أنشئ|انشئ|اعمل|عدّل|عدل|غيّر|غير|احذف|امسح|فكرني|ذكرني|create|add|record|update|delete|remind/i;
const TRAVEL_CONFLICT_WORDS = /مسافر|مسافرة|سفر|السفر|رحلة|رحله|travel|trip/i;
const OBLIGATION_WORDS = /التزام|التزامات|مستحق|واجب|مهمة|مهام|موعد|مواعيد|reminder|task/i;
const CONFLICT_WORDS = /تعارض|يتعارض|تتعارض|يتداخل|تتداخل|متعارض|conflict|overlap/i;

const SYNONYMS: Array<[RegExp, string]> = [
  [/(?:النهارده|نهارده|اليوم|اليوم ده)/gu, "اليوم"],
  [/(?:امبارح|أمبارح|امس|أمس|البارحه|البارحة)/gu, "امبارح"],
  [/(?:بعد بكره|بعد بكرة|بعد غدا|بعد غدًا|بعد غداً)/gu, "بعد بكره"],
  [/(?:بكره|بكرة|بكرا|باچر|باجر|باكر|غدا|غدًا|غداً)/gu, "بكره"],
  [/(?:الأسبوع ده|الاسبوع ده|الأسبوع الحالي|الاسبوع الحالي)/gu, "الاسبوع الحالي"],
  [/(?:الشهر ده|الشهر الحالي)/gu, "الشهر الحالي"],
  [/(?:قد\s*إيه|قد\s*ايه|قديش|شكد|شگد|كام|كم)/gu, "كم"],
  [/(?:إجمالي|اجمالي|مجموع)/gu, "اجمالي"],
  [/(?:مصروفات|مصاريف|انفاق|إنفاق)/gu, "مصروفات"],
  [/(?:ذكّرني|ذكرني|تذكرني|فكّرني|فكرني)/gu, "فكرني"],
  [/(?:انشي)/gu, "انشئ"],
  [/(?:عطيت|اعطيت|اعطيته|عطيتك)/gu, "اديت"],
  [/(?:اخذ)/gu, "اخد"],
  [/(?:حوّلت|حولت|حواله|حوالة)/gu, "حولت"],
  [/(?:ريالات)/gu, "ريال"],
  [/(?:دراهم)/gu, "فلوس"],
  [/(?:الصبح|صبح)/gu, "صباحا"],
  [/(?:المسا|المساء)/gu, "مساء"],
  [/(?:الظهر|ضهر|بعد الظهر)/gu, "ظهر"],
];

export function arabicDigitsToAscii(value: string): string {
  return value.replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
}

export function normalizeArabicClockHour(hour: number, period = ""): number {
  if ((period === "مساء" || period === "بالليل" || period === "ليل") && hour < 12) {
    return hour + 12;
  }
  if (period === "صباحا" && hour === 12) return 0;
  if (period === "ظهر" && hour < 12) return hour + 12;
  // In the secretary's established Egyptian conversational convention,
  // an unqualified "الساعة 5" in a relative reminder means 17:00.
  if (!period && hour === 5) return 17;
  return hour;
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

function canonicalizeArabicTimeText(value: string): string {
  const timeSeparator = "\uE000";
  return canonicalizeArabicText(value.replace(/[:٫]/gu, timeSeparator))
    .replaceAll(timeSeparator, ":");
}

function cleanMention(value: string): string {
  return value
    .replace(/^(?:ال|يا)\s+/u, "")
    .replace(/\s+(?:بمبلغ|مبلغ|بقيمة|جنيه|جنية|دولار|ريال|على|في|من)\b.*$/iu, "")
    .replace(/[،؛؟!.,:]+$/u, "")
    .trim();
}

function isNonPersonMention(value: string): boolean {
  const normalized = canonicalizeArabicText(value);
  return /^(?:على\s+)?(?:مشروع|project)(?:\s|$)/u.test(normalized)
    || /^[\d٠-٩]/u.test(normalized)
    || /(?:الف|الاف|آلاف|الفين|ألف|ألفين|ونص|ونصف|نص|نصف)/u.test(normalized)
    || /^(?:واحد|واحده|اثنين|اتنين|ثلاثه|ثلاثة|اربعه|أربعة|خمسه|خمسة|سته|ستة|سبعه|سبعة|تمانيه|ثمانية|تسعه|تسعة|عشره|عشرة)(?:\s|$)/u.test(normalized);
}

function currencyFromText(value: string): ParsedAmount["currency"] {
  const normalized = canonicalizeArabicText(value);
  if (normalized.includes("دولار") || /\busd\b/i.test(normalized)) return "USD";
  if (normalized.includes("ريال") || /\bsar\b/i.test(normalized)) return "SAR";
  return "EGP";
}

function amountNumber(raw: string): number {
  const ascii = arabicDigitsToAscii(raw)
    .replace(/٬/g, ",")
    .replace(/٫/g, ".")
    .replace(/\s/g, "");
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
  const numeric = value.match(/[\d٠-٩]+(?:[.,٬٫][\d٠-٩]+)*/u);
  let amount: number | null = numeric ? amountNumber(numeric[0]) : null;
  let raw = numeric?.[0] ?? "";
  let amountIncludesThousands = false;
  let amountIncludesHalfThousand = false;

  // Arabic speakers commonly say "11 ألف ونص" or "7 آلاف ونصف".
  // The numeric token is valid by itself, but the unit and half-thousand
  // suffix are part of the amount and must be consumed before converting to
  // minor units.
  const numericThousands = normalized.match(
    /([\d٠-٩]+(?:[.,٬٫][\d٠-٩]+)?)\s*(?:الفين|الف|الاف|آلاف)(?=\s|$)(?:\s+و?(نص|نصف)(?=\s|$))?/u,
  );
  if (numericThousands) {
    amount = amountNumber(numericThousands[1]) * 1000;
    amountIncludesThousands = true;
    amountIncludesHalfThousand = Boolean(numericThousands[2]);
    raw = numericThousands[0];
  }

  if (amount === null || !Number.isFinite(amount)) {
    const wordAmounts: Record<string, number> = {
      الف: 1000,
      الفين: 2000,
      "ثلاثه الاف": 3000,
      "ثلاث الاف": 3000,
      "خمسه الاف": 5000,
      "خمسة الاف": 5000,
      "سبعه الاف": 7000,
      "سبعة الاف": 7000,
      "عشره الاف": 10000,
      "عشرة الاف": 10000,
    };
    const normalizedWords = normalized.split(/\s+/u);
    const matched = Object.entries(wordAmounts).find(([key]) => {
      const keyWords = key.split(/\s+/u);
      return normalizedWords.some((_, index) =>
        keyWords.every((word, offset) => normalizedWords[index + offset] === word));
    });
    if (matched) {
      raw = matched[0];
      amount = matched[1];
      const matchedWords = matched[0].split(/\s+/u);
      const matchedStart = normalizedWords.findIndex((word, index) =>
        matchedWords.every((matchedWord, offset) => normalizedWords[index + offset] === matchedWord),
      );
      amountIncludesHalfThousand = matchedStart >= 0
        && /^(?:ونص|ونصف|نص|نصف)$/u.test(normalizedWords[matchedStart + matchedWords.length] ?? "");
    }
  }

  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  const majorAmount = (amountIncludesThousands ? amount : amount)
    + (amountIncludesHalfThousand ? 500 : 0);
  const amountMinor = Math.round(majorAmount * 100);
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
  const normalized = canonicalizeArabicTimeText(value);
  const dayOffset = normalized.includes("امبارح")
    ? -1
    : normalized.includes("بعد بكره")
    ? 2
    : normalized.includes("بكره")
      ? 1
      : normalized.includes("اليوم")
        ? 0
        : null;
  const time = normalized.match(
    /(?:الساعه\s*)?([0-9٠-٩]{1,2})(?:\s*[:٫]\s*([0-9٠-٩]{1,2}))?\s*(صباحا|مساء|بالليل|ليل|ظهر)?(?=\s|$)/u,
  );
  if (dayOffset === null || !time) return null;
  let hour = Number(arabicDigitsToAscii(time[1]));
  const minute = time[2] ? Number(arabicDigitsToAscii(time[2])) : 0;
  const period = time[3] ?? "";
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  hour = normalizeArabicClockHour(hour, period);
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

export type ParsedTimeOfDay = {
  hour: number;
  minute: number;
  confidence: number;
};

export function parseArabicTimeOfDay(value: string): ParsedTimeOfDay | null {
  const normalized = canonicalizeArabicTimeText(value);
  const time = normalized.match(
    /(?:الساعه\s*)?([0-9٠-٩]{1,2})(?:\s*[:٫]\s*([0-9٠-٩]{1,2}))?\s*(صباحا|مساء|بالليل|ليل|ظهر)?(?=\s|$)/u,
  );
  if (!time) return null;
  let hour = Number(arabicDigitsToAscii(time[1]));
  const minute = time[2] ? Number(arabicDigitsToAscii(time[2])) : 0;
  const period = time[3] ?? "";
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  hour = normalizeArabicClockHour(hour, period);
  return { hour, minute, confidence: period ? 0.99 : 0.94 };
}

function extractEntityMentions(message: string): EntityMention[] {
  const mentions: EntityMention[] = [];
  const person = message.match(
    /(?<!\p{L})(?:(?:دفعت|دفع(?:ت)?|صرف(?:ت)?|حولت|سددت)\s+(?:ل|الى|إلى|مع|لصالح|على)\s*|(?:اديت|أديت|اعطيت|عطيت)\s+(?:ل|الى|إلى|مع|لصالح)?\s*)([\p{L}][\p{L}\s-]{1,40}?)(?=\s+(?:بمبلغ|مبلغ|بقيمة|على|في|بمشروع|جنيه|جنية|دولار|ريال|الف|الفين|ألف|ألفين|امبارح|أمس|اليوم|بكره|بعد\s+بكره|[0-9٠-٩])|[،؛؟!.,]|$)/u,
  );
  if (person?.[1]) {
    const query = cleanMention(person[1]);
    if (query.length >= 2 && !isNonPersonMention(query)) {
      mentions.push({ entityType: "person", query, confidence: 0.9 });
    }
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

function hasNegativeWriteLanguage(value: string): boolean {
  return /(?:^|\s)(?:مدفعتش|مش\s+عايز(?:\s+\S+){0,3}\s+(?:ا?سجل\p{L}*|ا?دفع\p{L}*|ا?صرف\p{L}*)|(?:ما|لا|مش|مو|من\s+غير)(?:\s+\S+){0,3}\s+(?:سجل\p{L}*|تسجل\p{L}*|دفعتش|دفعت\p{L}*|دفع\p{L}*|تدفع\p{L}*|صرف\p{L}*|تصرف\p{L}*|اديت\p{L}*|اعطيت\p{L}*|عطيت\p{L}*|حولت\p{L}*|سددت\p{L}*))/iu.test(value);
}

export function isExplicitCancellationRequest(value: string): boolean {
  const normalized = canonicalizeArabicText(value);
  return /(?:^|\s)(?:غيرت\s+رايي|خلاص\s+الغي\s+(?:ال)?عمليه|مش\s+عايز\s+(?:ال)?عمليه(?:\s+دي)?|لا\s+خلاص)(?:\s|$)/u.test(normalized);
}

export function parseSemanticRequest(message: string): SemanticParse {
  const originalText = message.trim();
  const normalizedText = canonicalizeArabicText(originalText);
  const tokens = normalizedText.split(/\s+/u).filter(Boolean);
  const hasWriteLanguage = WRITE_WORDS.test(normalizedText);
  const hasReadLanguage = READ_WORDS.test(normalizedText);
  const travelConflictRequest = TRAVEL_CONFLICT_WORDS.test(normalizedText)
    && OBLIGATION_WORDS.test(normalizedText)
    && CONFLICT_WORDS.test(normalizedText);
  const amount = REMINDER_WORDS.test(originalText) ? undefined : parseArabicAmount(originalText);
  const entityMentions = extractEntityMentions(originalText);
  const personTotal = normalizedText.match(/^(.+?)\s+(?:اخد)\s+مني\s+(?:كم)/iu)
    ?? normalizedText.match(/^كم\s+(?:اخد)\s+مني\s+(.+?)$/iu);
  const personReceived = normalizedText.match(/^([\p{L}][\p{L}\s-]{1,40}?)\s+(?:خد|اخد|استلم)\s+(?:مني|عندي)(?=\s|$)/iu);
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
  const expenseWriteWithoutAmount = !hasReadLanguage
    && /(?:دفعت|دفع|صرف|اديت|أديت|اعطيت|عطيت|حولت|سددت|سجل(?:\s+لي)?\s+(?:مصروف|مصاريف)|record\s+expense)/iu.test(normalizedText);
  const explicitExpenseWrite = Boolean(amount && hasWriteLanguage)
    || expenseWriteWithoutAmount
    || /(?:سجل)\s+(?:لي\s+)?(?:مصروف|مصاريف)|record\s+expense/iu.test(normalizedText);
  const negativeWriteLanguage = hasNegativeWriteLanguage(normalizedText);
  const safeExpenseWrite = !negativeWriteLanguage && explicitExpenseWrite;
  const domains = new Set<SemanticDomain>();
  if (MONEY_WORDS.test(normalizedText) || amount || personTotal) domains.add("expense");
  if (REMINDER_WORDS.test(normalizedText)) domains.add("reminder");
  if (/موعد|مواعيد|ميعاد|مهمه|مهام|schedule|task/i.test(normalizedText)) domains.add("schedule");
  if (AGENT_WORK_WORDS.test(normalizedText)) domains.add("work");
  if (travelConflictRequest) domains.add("schedule");
  if (/شخص|جهة|contact|person|مين/i.test(normalizedText)) domains.add("person");
  if (/مشروع|project/i.test(normalizedText)) domains.add("project");
  if (/فاكر|آخر|اخر|سجلنا|المحفوظ|memory|remember/i.test(normalizedText)) domains.add("memory");

  let intent: SemanticIntent = "unknown";
  let confidence = 0.35;
  const negativePersonCreation = /(?:ما|مش|من\s+غير)\s+.*?(?:تضيف\w*|ضيف\w*|تعمل\w*|اعمل\w*|تسجل\w*|سجل\w*).*?(?:شخص|جهة|person|contact)/iu.test(normalizedText);
  const createPersonSignal = !negativePersonCreation && /(?:(?:^|\s)(?:اضف|اضيف|ضيف|انشئ|اعمل|سجل|add|create|record)(?=\s|$).*(?:شخص|جهة|جهه|person|contact)|(?:شخص|جهة|جهه|person|contact).*(?:اسمه|جديد))/iu.test(normalizedText);
  const createProjectSignal = /(?:بدأت|بدات|انشئ|اعمل|create).*(?:مشروع|project)/iu.test(normalizedText);
  if (createPersonSignal) {
    intent = "create_person";
    confidence = 0.93;
  } else if (createProjectSignal) {
    intent = "create_project";
    confidence = 0.93;
  } else if (REMINDER_WORDS.test(normalizedText)) {
    intent = "create_reminder";
    confidence = 0.9;
  } else if (AGENT_WORK_WORDS.test(normalizedText)) {
    intent = "create_agent_work";
    confidence = 0.88;
  } else if (domains.has("expense") && hasReadLanguage && !explicitExpenseWrite) {
    intent = entityMentions.some((item) => item.entityType === "person")
      ? "person_expense_total"
      : "expense_report";
    confidence = 0.91;
  } else if (/مين.*(?:مشروع|project)|(?:الناس|اشخاص).*(?:مشروع|project)/iu.test(normalizedText)) {
    intent = "project_people";
    confidence = 0.91;
  } else if (domains.has("expense") && safeExpenseWrite) {
    intent = "record_expense";
    confidence = amount
      ? entityMentions.length > 0 ? 0.93 : 0.82
      : 0.78;
  } else if (travelConflictRequest && hasReadLanguage && !hasWriteLanguage) {
    // Identify a read-only planning context without inventing a travel interval.
    intent = "schedule_read";
    confidence = 0.88;
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
    || (["expense_report", "person_expense_total"].includes(intent)
      && domainList.every((domain) => domain === "expense" || domain === "person" || domain === "project"))
    || (intent === "create_person" && domainList.every((domain) => domain === "expense" || domain === "person"))
    || (intent === "create_project" && domainList.every((domain) => domain === "expense" || domain === "project"))
    || (intent === "create_agent_work" && domainList.every((domain) =>
      domain === "work"
      || domain === "schedule"
      || domain === "expense"
      || domain === "unknown"))
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
    ...(REMINDER_WORDS.test(normalizedText) ? { dateTime: parseArabicDateTime(normalizedText) ?? undefined } : {}),
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
  if (parsed.intent === "create_agent_work") {
    return {
      kind: "deterministic",
      intent: parsed.intent,
      confidence: parsed.confidence,
      requiresApproval: true,
      reason: "natural_agent_work_request",
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

/**
 * Production intentionally keeps this allowlist small. The parser can recognize
 * more read intents for experiments, but those intents must not silently become
 * a production decision gate until they have provider-level evidence.
 */
export function isProductionDeterministicIntent(intent: SemanticIntent): boolean {
  return [
    "record_expense",
    "create_reminder",
    "create_agent_work",
    "create_person",
    "create_project",
  ].includes(intent);
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
    llmAvoidanceMeasurement: "not_claimed",
    falsePositiveGuard: "not_applicable",
  };
}