import { featureFlags } from "./feature-flags";

export type LocalRouteIntent =
  | "expense"
  | "create_person"
  | "create_reminder"
  | "expense_report"
  | "clarification";

export type LocalRouteDecision = {
  intent: LocalRouteIntent;
  confidence: number;
  toolName?: string;
  args?: Record<string, unknown>;
  reason: string;
  safeToExecute: boolean;
};

const amountPattern = /([0-9٠-٩]+(?:[.,][0-9٠-٩]+)?)/;
const personPattern = /(?:ل|إلى|الى|مع|اسم(?:ه|ها)?|شخص(?:ا|ًا)?\s+اسمه)\s*([\u0600-\u06FF][\u0600-\u06FF\s-]{1,39})/u;

function arabicDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

function cleanName(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[،,.؛:!?؟].*$/u, "").trim();
}

function extractPerson(message: string): string | undefined {
  const match = message.match(personPattern);
  return match?.[1] ? cleanName(match[1]) : undefined;
}

function hasMoneyLanguage(message: string): boolean {
  return /دفعت|دفع|صرف|مصروف|مصاريف|سجل.*مصروف|جنيه|دولار|ريال|فلوس|paid|spent|expense/i.test(message);
}

export function routeLocally(message: string): LocalRouteDecision | null {
  if (!featureFlags.localRouter()) return null;
  const normalized = message.trim();
  if (!normalized) {
    return {
      intent: "clarification",
      confidence: 1,
      reason: "empty_message",
      safeToExecute: false,
    };
  }
  if (/(?:إجمالي|اجمالي|مجموع|تقرير).*(?:مصروف|مصاريف)|(?:total|report).*(?:expense|spend)/i.test(normalized)) {
    return {
      intent: "expense_report",
      confidence: 0.99,
      toolName: "query_expenses",
      args: { limit: 50 },
      reason: "canonical_expense_report",
      safeToExecute: true,
    };
  }
  if (/^(?:محمد|احمد|أحمد|[ء-ي]{2,20})$/u.test(normalized)) {
    return {
      intent: "clarification",
      confidence: 0.97,
      reason: "bare_entity_name",
      safeToExecute: false,
    };
  }
  if (/(?:أضف|اضف|ضيف|أنشئ|انشئ).*(?:شخص|جهة|contact|person)/i.test(normalized)) {
    const name = normalized
      .replace(/.*?(?:شخص|جهة|contact|person)\s*(?:اسمه|اسمها|باسم)?\s*/i, "")
      .replace(/[،,.؛:!?؟].*$/u, "")
      .trim();
    if (name) {
      return {
        intent: "create_person",
        confidence: 0.98,
        toolName: "create_person",
        args: { name },
        reason: "explicit_person_creation",
        safeToExecute: true,
      };
    }
  }
  if (/(?:فكرني|ذكرني|تذكير|remind)/i.test(normalized)) {
    return {
      intent: "create_reminder",
      confidence: 0.9,
      toolName: "create_reminder",
      reason: "explicit_reminder_language_but_missing_structured_time",
      safeToExecute: false,
    };
  }
  if (hasMoneyLanguage(normalized) && amountPattern.test(normalized)) {
    const amountMatch = normalized.match(amountPattern);
    const person = extractPerson(normalized);
    const amount = amountMatch?.[1] ? Number(arabicDigits(amountMatch[1]).replace(",", ".")) : NaN;
    if (Number.isFinite(amount) && person) {
      return {
        intent: "expense",
        confidence: 0.93,
        toolName: "record_expense",
        args: {
          amountMinor: Math.round(amount * 100),
          currency: "EGP",
          description: normalized,
          personName: person,
        },
        reason: "explicit_amount_and_person",
        safeToExecute: true,
      };
    }
  }
  return null;
}