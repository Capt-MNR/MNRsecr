function normalizeArabic(value: string): string {
  return value
    .trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u064B-\u065F]/g, "")
    .replace(/[،؛؟!.,:]/g, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ar");
}

export type DeterministicExpensePeriod = "last_month" | "this_month" | "last_week" | "this_week";

/**
 * Broad expense reports are deterministic reads. Keeping this matcher narrow
 * avoids taking scoped requests away from the model's entity-resolution flow.
 */
export function isBroadExpenseReportRequest(message: string): boolean {
  const normalized = normalizeArabic(message);
  return /^(?:(?:عايز|اريد|محتاج|هات|اعمل|اعرض)\s+)?(?:تقرير|ملخص|كشف)(?:\s+(?:شامل|كامل|كل))?\s*(?:(?:ب|عن)\s*)?(?:كل\s*)?(?:ال)?(?:مصروفات|مصاريف|انفاق|الصرف)(?:\s+(?:كلها|كله|كامل|كامله))?$/.test(normalized);
}

export function isGlobalExpenseTotalRequest(message: string): boolean {
  const normalized = normalizeArabic(message);
  return /^(?:(?:عايز|اريد|محتاج|هات|اعرض)\s+)?(?:اجمالي|مجموع)(?:\s+كل)?\s*(?:ال)?(?:مصروفات|مصاريف)(?:\s+(?:كام|كم))?$/.test(normalized)
    || /^(?:كام|كم)\s+(?:اجمالي|مجموع)\s+(?:ال)?(?:مصروفات|مصاريف)$/.test(normalized);
}

/**
 * Period totals are deterministic only when the message is an exact,
 * unscoped amount question. Anything mentioning a person, project, or
 * arbitrary date stays on the model path for entity and date resolution.
 */
export function deterministicExpensePeriod(message: string): DeterministicExpensePeriod | null {
  const normalized = normalizeArabic(message);
  const spendingVerb = "(?:صرفت|صرفنا|انفقت|انفقنا|دفعت|دفعنا)";
  const amountQuestion = "(?:كام|كم)";
  const spendingQuestion = `(?:${spendingVerb}\\s+${amountQuestion}|${amountQuestion}\\s+${spendingVerb})`;
  const expenseWords = "(?:(?:ال)?مصروفات|(?:ال)?مصاريف|انفاق|الصرف)";
  const week = "(?:ال)?اسبوع";
  const month = "(?:ال)?شهر";

  if (
    new RegExp(`^(?:(?:انا|احنا)\\s+)?${spendingQuestion}\\s+(?:في\\s+)?${week}\\s+(?:ده|الحالي)$`).test(normalized)
    || new RegExp(`^(?:(?:اجمالي|مجموع)\\s+)?${expenseWords}\\s+(?:في\\s+)?${week}\\s+(?:ده|الحالي)$`).test(normalized)
  ) {
    return "this_week";
  }
  if (
    new RegExp(`^(?:(?:انا|احنا)\\s+)?${spendingQuestion}\\s+(?:في\\s+)?${week}\\s+(?:اللي\\s+فات|الماضي|السابق)$`).test(normalized)
    || new RegExp(`^(?:(?:اجمالي|مجموع)\\s+)?${expenseWords}\\s+(?:في\\s+)?${week}\\s+(?:اللي\\s+فات|الماضي|السابق)$`).test(normalized)
  ) {
    return "last_week";
  }
  if (
    new RegExp(`^(?:(?:انا|احنا)\\s+)?${spendingQuestion}\\s+(?:في\\s+)?${month}\\s+(?:ده|الحالي)$`).test(normalized)
    || new RegExp(`^(?:(?:اجمالي|مجموع)\\s+)?${expenseWords}\\s+(?:في\\s+)?${month}\\s+(?:ده|الحالي)$`).test(normalized)
  ) {
    return "this_month";
  }
  if (
    new RegExp(`^(?:(?:انا|احنا)\\s+)?${spendingQuestion}\\s+(?:في\\s+)?${month}\\s+(?:اللي\\s+فات|الماضي|السابق)$`).test(normalized)
    || new RegExp(`^(?:(?:اجمالي|مجموع)\\s+)?${expenseWords}\\s+(?:في\\s+)?${month}\\s+(?:اللي\\s+فات|الماضي|السابق)$`).test(normalized)
  ) {
    return "last_month";
  }
  return null;
}

export function isExpenseTotalCorrectionRequest(message: string): boolean {
  const normalized = normalizeArabic(message);
  return /(?:صفر\s+(?:زائد|زياده)|زائد\s+صفر|الاجمالي\s+(?:غلط|خطا|مش\s+صح|غير\s+صحيح)|الرقم\s+(?:غلط|خطا|مش\s+صح|غير\s+صحيح)|راجع\s+(?:الاجمالي|المجموع)|اتأكد\s+من\s+(?:الاجمالي|المجموع))/.test(normalized);
}