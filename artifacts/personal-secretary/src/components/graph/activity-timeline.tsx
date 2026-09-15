import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CircleAlert, Clock3, LoaderCircle, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { GraphSection } from "./graph-section";
import { financialRecordPath, recordPath } from "./context-link";

export type ActivityTimelineEvent = {
  id: string;
  eventType?: string;
  sourceType?: string;
  sourceId?: string | null;
  summary?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
  createdAt?: string;
};

type TimelineEntityType = "person" | "project" | "financial_party";

const PAGE_SIZE = 50;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : "";
}

function eventArgs(event: ActivityTimelineEvent) {
  return asRecord(asRecord(event.metadata).args);
}

function titleForEvent(event: ActivityTimelineEvent) {
  const toolName = stringValue(asRecord(event.metadata).toolName) || stringValue(event.eventType);
  const labels: Record<string, string> = {
    record_expense: "تم تسجيل مصروف",
    create_expense: "تم تسجيل مصروف",
    update_expense: "تم تصحيح مصروف",
    delete_expense: "تم حذف مصروف",
    create_person: "تمت إضافة شخص",
    update_person: "تم تصحيح بيانات شخص",
    create_project: "تمت إضافة مشروع",
    update_project: "تم تصحيح مشروع",
    create_task: "تم إنشاء مهمة",
    update_task: "تم تحديث مهمة",
    create_reminder: "تم جدولة تذكير",
    update_reminder: "تم تحديث تذكير",
    create_commitment: "تم إنشاء التزام",
    update_commitment: "تم تحديث التزام",
    create_financial_obligation: "تم إنشاء التزام مالي",
    update_financial_obligation: "تم تصحيح التزام مالي",
    create_financial_payment: "تم تسجيل دفعة",
    update_financial_payment: "تم تصحيح دفعة",
    create_donation: "تم تسجيل تبرع",
    update_donation: "تم تصحيح تبرع",
    create_income_receivable: "تم تسجيل مستحق",
    update_income_receivable: "تم تصحيح مستحق",
    settle_financial_obligation: "تم تطبيق تسوية مالية",
    link_person_to_project: "تم ربط شخص بمشروع",
    update_person_project_relationship: "تم تحديث علاقة شخص بمشروع",
    create_typed_relationship: "تم إنشاء علاقة",
    delete_typed_relationship: "تم حذف علاقة",
  };
  return labels[toolName] ?? (stringValue(event.summary) || "حدث نشاط");
}

function targetForEvent(event: ActivityTimelineEvent, currentType: TimelineEntityType, currentId: string) {
  const sourceType = stringValue(event.sourceType);
  const sourceId = stringValue(event.sourceId);
  const args = eventArgs(event);
  const target = (type: string, id: string) => {
    if (!id) return null;
    if (type === "person" || type === "project" || type === "financial_party") {
      return type === currentType && id === currentId ? null : type === "person" ? `/people/${encodeURIComponent(id)}` : type === "project" ? `/projects/${encodeURIComponent(id)}` : `/financial/parties/${encodeURIComponent(id)}`;
    }
    if (type === "expense") return recordPath("expenses", id);
    if (type === "task") return recordPath("tasks", id);
    if (type === "reminder") return recordPath("reminders", id);
    if (type === "commitment") return recordPath("commitments", id);
    if (type === "financial_obligation") return financialRecordPath("obligation", id);
    if (type === "financial_payment") return financialRecordPath("payment", id);
    if (type === "donation") return financialRecordPath("donation", id);
    if (type === "income_receivable") return financialRecordPath("receivable", id);
    return null;
  };

  const toolName = stringValue(asRecord(event.metadata).toolName);
  if (toolName === "settle_financial_obligation") {
    const obligationTarget = target("financial_obligation", stringValue(args.obligationId));
    if (obligationTarget) return obligationTarget;
    const paymentTarget = target("financial_payment", stringValue(args.paymentId));
    if (paymentTarget) return paymentTarget;
  }
  const sourceTarget = target(sourceType, sourceId);
  if (sourceTarget) return sourceTarget;
  const knownArgs: Array<[string, string]> = [
    ["expense", "expenseId"],
    ["task", "taskId"],
    ["reminder", "reminderId"],
    ["commitment", "commitmentId"],
    ["financial_obligation", "obligationId"],
    ["financial_payment", "paymentId"],
    ["donation", "donationId"],
    ["income_receivable", "receivableId"],
    ["person", "personId"],
    ["project", "projectId"],
    ["financial_party", "partyId"],
  ];
  for (const [type, key] of knownArgs) {
    const path = target(type, stringValue(args[key]));
    if (path) return path;
  }
  const relation = stringValue(args.relation);
  const typedRelationTargets: Record<string, Array<[string, string]>> = {
    project_people: [["person", stringValue(args.rightId)], ["project", stringValue(args.leftId)]],
    task_people: [["person", stringValue(args.rightId)], ["task", stringValue(args.leftId)]],
    task_projects: [["project", stringValue(args.rightId)], ["task", stringValue(args.leftId)]],
    task_purposes: [["task", stringValue(args.leftId)]],
    reminder_people: [["person", stringValue(args.rightId)], ["reminder", stringValue(args.leftId)]],
    reminder_projects: [["project", stringValue(args.rightId)], ["reminder", stringValue(args.leftId)]],
    reminder_tasks: [["task", stringValue(args.rightId)], ["reminder", stringValue(args.leftId)]],
    commitment_people: [["person", stringValue(args.rightId)], ["commitment", stringValue(args.leftId)]],
    commitment_projects: [["project", stringValue(args.rightId)], ["commitment", stringValue(args.leftId)]],
    commitment_purposes: [["commitment", stringValue(args.leftId)]],
  };
  for (const [type, id] of typedRelationTargets[relation] ?? []) {
    const path = target(type, id);
    if (path) return path;
  }
  return null;
}

function formatDate(value: string | undefined) {
  if (!value) return "بدون تاريخ";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

async function fetchTimelinePage(entityType: TimelineEntityType, entityId: string, offset: number) {
  const response = await fetch(`/api/entities/${entityType}/${encodeURIComponent(entityId)}/timeline?limit=${PAGE_SIZE}&offset=${offset}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("تعذر تحميل المزيد من النشاط.");
  const payload = await response.json() as { events?: unknown };
  return Array.isArray(payload.events) ? payload.events.filter((item): item is ActivityTimelineEvent => Boolean(item && typeof item === "object")) : [];
}

export function ActivityTimeline({
  entityType,
  entityId,
  initialEvents,
  className = "",
}: {
  entityType: TimelineEntityType;
  entityId: string;
  initialEvents: ActivityTimelineEvent[];
  className?: string;
}) {
  const [, setLocation] = useLocation();
  const [events, setEvents] = useState(initialEvents);
  const [requestedOffset, setRequestedOffset] = useState(0);
  const [hasMore, setHasMore] = useState(initialEvents.length >= PAGE_SIZE);
  const pageQuery = useQuery({
    queryKey: [`/api/entities/${entityType}/${entityId}/timeline`, requestedOffset],
    queryFn: () => fetchTimelinePage(entityType, entityId, requestedOffset),
    enabled: requestedOffset > 0,
    staleTime: 20_000,
  });

  useEffect(() => {
    setEvents(initialEvents);
    setRequestedOffset(0);
    setHasMore(initialEvents.length >= PAGE_SIZE);
  }, [entityId, initialEvents]);

  useEffect(() => {
    if (requestedOffset === 0 || !pageQuery.data) return;
    setEvents((current) => {
      const existing = new Set(current.map((event) => event.id));
      return [...current, ...pageQuery.data.filter((event) => !existing.has(event.id))];
    });
    setHasMore(pageQuery.data.length >= PAGE_SIZE);
    setRequestedOffset(0);
  }, [pageQuery.data, requestedOffset]);

  return (
    <GraphSection title="النشاط الأخير" icon={<Clock3 className="size-4 text-primary" />} className={className}>
      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">لا يوجد نشاط مسجل لهذا الكيان بعد.</p>
      ) : (
        <div className="space-y-3">
          {events.map((event) => {
            const target = targetForEvent(event, entityType, entityId);
            const content = (
              <>
                <span className="min-w-0">
                  <span className="block text-sm leading-relaxed">{titleForEvent(event)}</span>
                  {stringValue(event.summary) && stringValue(event.summary) !== titleForEvent(event) && <span className="mt-1 block truncate text-xs text-muted-foreground">{event.summary}</span>}
                  <span className="mt-1 block text-xs text-muted-foreground">{formatDate(event.occurredAt ?? event.createdAt)}</span>
                </span>
                {target && <ArrowLeft className="size-4 shrink-0 text-muted-foreground" />}
              </>
            );
            return target ? (
              <button type="button" key={event.id} onClick={() => setLocation(target)} className="flex min-h-14 w-full items-center justify-between gap-3 border-r-2 border-primary/25 pr-3 text-right transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                {content}
              </button>
            ) : (
              <div key={event.id} className="flex min-h-14 items-center border-r-2 border-primary/25 pr-3">
                {content}
              </div>
            );
          })}
          {pageQuery.isError && (
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
              <div className="flex items-center gap-2"><CircleAlert className="size-4" /> تعذر تحميل النشاط الأقدم.</div>
              <button type="button" onClick={() => void pageQuery.refetch()} className="mt-2 inline-flex min-h-10 items-center gap-2 font-semibold underline underline-offset-4"><RefreshCw className="size-3.5" /> حاول مرة أخرى</button>
            </div>
          )}
          {hasMore && (
            <button type="button" onClick={() => setRequestedOffset(events.length)} disabled={pageQuery.isFetching} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-primary disabled:opacity-50">
              {pageQuery.isFetching ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              عرض النشاط الأقدم
            </button>
          )}
        </div>
      )}
    </GraphSection>
  );
}