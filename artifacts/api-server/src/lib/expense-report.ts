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

export function isExpenseTotalCorrectionRequest(message: string): boolean {
  const normalized = normalizeArabic(message);
  return /(?:صفر\s+(?:زائد|زياده)|زائد\s+صفر|الاجمالي\s+(?:غلط|خطا|مش\s+صح|غير\s+صحيح)|الرقم\s+(?:غلط|خطا|مش\s+صح|غير\s+صحيح)|راجع\s+(?:الاجمالي|المجموع)|اتأكد\s+من\s+(?:الاجمالي|المجموع))/.test(normalized);
}