export type ContextEntityType = "person" | "project" | "financial_party";

export function entityPath(entityType: ContextEntityType, id: string) {
  if (entityType === "person") return `/people/${encodeURIComponent(id)}`;
  if (entityType === "project") return `/projects/${encodeURIComponent(id)}`;
  return `/financial/parties/${encodeURIComponent(id)}`;
}

export function recordContextPath(tab: string, id: string) {
  return `/records?tab=${encodeURIComponent(tab)}&contextId=${encodeURIComponent(id)}`;
}

export function askAboutRecordHref(recordType: string, recordId: string, title: string) {
  const safeTitle = title.trim() || "هذا السجل";
  const params = new URLSearchParams({
    ask: `اسألني عن ${safeTitle}`,
    entityType: recordType,
    entityId: recordId,
    entityName: safeTitle,
  });
  return `/ask?${params.toString()}`;
}
