import { MessageCircle, Sparkles } from "lucide-react";

export type GraphEntityType = "person" | "project" | "financial_party";
export type FinancialRecordType = "obligation" | "payment" | "donation" | "receivable";

export function entityPath(entityType: GraphEntityType, id: string) {
  if (entityType === "person") return `/people/${encodeURIComponent(id)}`;
  if (entityType === "project") return `/projects/${encodeURIComponent(id)}`;
  return `/financial/parties/${encodeURIComponent(id)}`;
}

export function recordPath(tab: string, id: string) {
  return `/records?tab=${encodeURIComponent(tab)}&recordId=${encodeURIComponent(id)}`;
}

export function financialRecordPath(type: FinancialRecordType, id: string) {
  return `/records?tab=financial&financialType=${type}&recordId=${encodeURIComponent(id)}`;
}

function askPrompt(entityType: GraphEntityType, name: string) {
  const safeName = name.trim() || "هذا الكيان";
  if (entityType === "person") return `ماذا تعرف عن ${safeName} وما الذي يحتاج إلى انتباهي؟`;
  if (entityType === "project") return `ما آخر ما حدث في مشروع ${safeName} وما الخطوة التالية؟`;
  return `ما التفاصيل المالية المرتبطة بـ ${safeName} وما الذي يحتاج إلى متابعة؟`;
}

export function askAboutEntityHref(entityType: GraphEntityType, id: string, name: string) {
  const params = new URLSearchParams({
    ask: askPrompt(entityType, name),
    entityType,
    entityId: id,
    entityName: name,
  });
  return `/?${params.toString()}`;
}

export function AskSecretaryLink({
  entityType,
  entityId,
  entityName,
  compact = false,
}: {
  entityType: GraphEntityType;
  entityId: string;
  entityName: string;
  compact?: boolean;
}) {
  return (
    <a
      href={askAboutEntityHref(entityType, entityId, entityName)}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3 text-sm font-semibold text-primary transition hover:bg-primary/10 ${compact ? "py-2 text-xs" : "py-2.5"}`}
      aria-label={`اسأل السكرتير عن ${entityName}`}
    >
      {compact ? <MessageCircle className="size-4" /> : <Sparkles className="size-4" />}
      اسأل السكرتير عن هذا الكيان
    </a>
  );
}