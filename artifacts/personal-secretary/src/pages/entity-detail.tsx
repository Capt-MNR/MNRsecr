import {
  ArrowRight,
  Bell,
  CheckSquare2,
  CircleAlert,
  FolderKanban,
  LoaderCircle,
  MessageSquareText,
  Phone,
  Receipt,
  Scale,
  UserRound,
  WalletCards,
} from "lucide-react";
import { useGetEntityGraph, useGetFinancialParty } from "@workspace/api-client-react";
import { useLocation, useRoute } from "wouter";
import type { ReactNode } from "react";
import { ActivityTimeline, type ActivityTimelineEvent } from "../components/graph/activity-timeline";
import { AskSecretaryLink, entityPath, financialRecordPath, recordPath } from "../components/graph/context-link";
import { EmptyRelation, GraphSection, RelatedLink } from "../components/graph/graph-section";

type EntityType = "person" | "project";
type RelatedItem = {
  id: string;
  relationshipId?: string;
  name?: string;
  title?: string;
  text?: string;
  relationship?: string | null;
  status?: string;
  dueAt?: string | null;
  updatedAt?: string | null;
};
type Expense = {
  id: string;
  amountMinor: number;
  currency: string;
  description: string;
  occurredAt: string;
  projectId?: string | null;
  projectName?: string | null;
  personId?: string | null;
  personName?: string | null;
  purposeId?: string | null;
  purposeName?: string | null;
  origin?: { conversationId: string; turnId?: string | null } | null;
};
type GraphData = {
  entity: { id: string; name: string; notes?: string | null; phone?: string | null; status?: string };
  related: {
    projects?: RelatedItem[];
    people?: RelatedItem[];
    expenses?: Expense[];
    commitments?: RelatedItem[];
    tasks?: RelatedItem[];
    reminders?: RelatedItem[];
    financialParties?: RelatedItem[];
  };
  timeline?: ActivityTimelineEvent[];
};

function formatDate(value: string | null | undefined) {
  if (!value) return "بدون موعد";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("ar-EG", { style: "currency", currency }).format(amountMinor / 100);
}

function asItems(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
}

function text(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function amount(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function groupedMoney(items: Array<Record<string, unknown>>, field: string) {
  const totals = new Map<string, number>();
  for (const item of items) {
    const currency = text(item.currency, "EGP");
    totals.set(currency, (totals.get(currency) ?? 0) + amount(item[field]));
  }
  return [...totals.entries()].map(([currency, total]) => money(total, currency)).join("، ");
}

export default function EntityDetail({ entityType }: { entityType: EntityType }) {
  const [, params] = useRoute(`/${entityType === "person" ? "people" : "projects"}/:id`);
  const [, setLocation] = useLocation();
  const id = params?.id ?? "";
  const query = useGetEntityGraph(entityType, id, { query: { queryKey: [`/api/entities/${entityType}/${id}`], enabled: Boolean(id), staleTime: 20_000 } });
  const Icon = entityType === "person" ? UserRound : FolderKanban;

  if (query.isLoading) {
    return <div dir="rtl" lang="ar" className="flex min-h-[100dvh] items-center justify-center bg-background text-muted-foreground"><LoaderCircle className="size-6 animate-spin" /><span className="sr-only">جاري تحميل التفاصيل</span></div>;
  }
  if (query.isError || !query.data) {
    return (
      <div dir="rtl" lang="ar" className="flex min-h-[100dvh] items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-md rounded-2xl border border-destructive/25 bg-card p-6 text-center">
          <CircleAlert className="mx-auto size-8 text-destructive" />
          <p className="mt-3 text-sm">تعذر تحميل تفاصيل الكيان. قد يكون محذوفًا أو غير متاح في مساحتك.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => void query.refetch()} className="min-h-10 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold">حاول مرة أخرى</button>
            <button type="button" onClick={() => setLocation("/records")} className="min-h-10 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">العودة للسجلات</button>
          </div>
        </div>
      </div>
    );
  }

  const data = query.data as unknown as GraphData;
  const entity = data.entity;
  return (
    <div dir="rtl" lang="ar" className="grain min-h-[100dvh] bg-background text-foreground">
      <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-8 sm:py-10">
        <button type="button" onClick={() => setLocation("/records")} className="inline-flex min-h-10 items-center gap-2 text-xs text-muted-foreground hover:text-primary"><ArrowRight className="size-4" /> العودة للسجلات</button>
        <header className="mt-6 rounded-[24px] border border-border bg-card p-5 sm:mt-8 sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-primary/10 p-3 text-primary"><Icon className="size-6" /></div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{entityType === "person" ? "شخص" : "مشروع"}</p>
                <h1 className="mt-1 break-words font-serif text-3xl tracking-tight sm:text-4xl">{entity.name}</h1>
                <p className="mt-2 text-sm text-muted-foreground">{entityType === "project" ? `الحالة: ${text(entity.status, "غير محددة")}` : text(entity.notes, "لا توجد ملاحظات محفوظة.")}</p>
                {entityType === "person" && entity.phone && (
                  <a href={`tel:${entity.phone}`} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground hover:border-primary/40 hover:text-primary" data-testid={`link-profile-phone-${entity.id}`}>
                    <Phone className="size-4" /> {entity.phone}
                  </a>
                )}
              </div>
            </div>
            <AskSecretaryLink entityType={entityType} entityId={entity.id} entityName={entity.name} />
          </div>
        </header>
        {entityType === "person" ? <PersonSections data={data} setLocation={setLocation} /> : <ProjectSections data={data} setLocation={setLocation} />}
      </main>
    </div>
  );
}

function PersonSections({ data, setLocation }: { data: GraphData; setLocation: (path: string) => void }) {
  const related = data.related;
  return (
    <div className="mt-6 grid gap-5 lg:mt-8 lg:grid-cols-3">
      {related.projects && related.projects.length > 0 && <EntityLinks title="المشاريع المرتبطة" icon={<FolderKanban className="size-4 text-primary" />} items={related.projects} getPath={(item) => entityPath("project", item.id)} setLocation={setLocation} className="lg:col-span-2" />}
      {related.tasks && related.tasks.length > 0 && <EntityLinks title="المهام المرتبطة" icon={<CheckSquare2 className="size-4 text-primary" />} items={related.tasks} getPath={(item) => recordPath("tasks", item.id)} setLocation={setLocation} />}
      {related.reminders && related.reminders.length > 0 && <EntityLinks title="التذكيرات المرتبطة" icon={<Bell className="size-4 text-primary" />} items={related.reminders} getPath={(item) => recordPath("reminders", item.id)} setLocation={setLocation} />}
      {related.financialParties && related.financialParties.length > 0 && <FinancialSnapshots parties={related.financialParties} setLocation={setLocation} />}
      {related.expenses && related.expenses.length > 0 && <ExpenseList expenses={related.expenses} setLocation={setLocation} className="lg:col-span-2" />}
      {related.commitments && related.commitments.length > 0 && <EntityLinks title="الالتزامات المرتبطة" icon={<Scale className="size-4 text-primary" />} items={related.commitments} getPath={(item) => recordPath("commitments", item.id)} setLocation={setLocation} className="lg:col-span-2" />}
      <ActivityTimeline entityType="person" entityId={data.entity.id} initialEvents={data.timeline ?? []} className="lg:col-span-3" />
    </div>
  );
}

function ProjectSections({ data, setLocation }: { data: GraphData; setLocation: (path: string) => void }) {
  const related = data.related;
  return (
    <div className="mt-6 grid gap-5 lg:mt-8 lg:grid-cols-3">
      {related.people && related.people.length > 0 && <EntityLinks title="الأشخاص المرتبطون" icon={<UserRound className="size-4 text-primary" />} items={related.people} getPath={(item) => entityPath("person", item.id)} setLocation={setLocation} className="lg:col-span-2" />}
      {related.tasks && related.tasks.length > 0 && <EntityLinks title="المهام المرتبطة" icon={<CheckSquare2 className="size-4 text-primary" />} items={related.tasks} getPath={(item) => recordPath("tasks", item.id)} setLocation={setLocation} />}
      {related.reminders && related.reminders.length > 0 && <EntityLinks title="التذكيرات المرتبطة" icon={<Bell className="size-4 text-primary" />} items={related.reminders} getPath={(item) => recordPath("reminders", item.id)} setLocation={setLocation} />}
      {related.financialParties && related.financialParties.length > 0 && <FinancialSnapshots parties={related.financialParties} setLocation={setLocation} />}
      {related.expenses && related.expenses.length > 0 && <ExpenseList expenses={related.expenses} setLocation={setLocation} className="lg:col-span-3" />}
      <ActivityTimeline entityType="project" entityId={data.entity.id} initialEvents={data.timeline ?? []} className="lg:col-span-3" />
    </div>
  );
}

function EntityLinks({
  title,
  icon,
  items,
  getPath,
  setLocation,
  className = "",
}: {
  title: string;
  icon: ReactNode;
  items: RelatedItem[];
  getPath: (item: RelatedItem) => string;
  setLocation: (path: string) => void;
  className?: string;
}) {
  return (
    <GraphSection title={title} icon={icon} className={className}>
      <div className="space-y-2">
        {items.map((item) => <RelatedLink key={item.relationshipId ?? item.id} label={item.name ?? item.title ?? item.text ?? "سجل مرتبط"} detail={item.relationship || item.status || formatDate(item.dueAt)} onOpen={() => setLocation(getPath(item))} />)}
      </div>
    </GraphSection>
  );
}

function FinancialSnapshots({ parties, setLocation }: { parties: RelatedItem[]; setLocation: (path: string) => void }) {
  return (
    <GraphSection title="العلاقات المالية" icon={<WalletCards className="size-4 text-primary" />} className="lg:col-span-3">
      <p className="text-xs text-muted-foreground">ملخص منفصل لكل طرف مالي؛ لا يمثل صافي رصيد ولا يخلط بين العملات.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {parties.map((party) => <PartySnapshot key={party.id} party={party} setLocation={setLocation} />)}
      </div>
    </GraphSection>
  );
}

function PartySnapshot({ party, setLocation }: { party: RelatedItem; setLocation: (path: string) => void }) {
  const query = useGetFinancialParty(party.id, { query: { queryKey: [`/api/financial/parties/${party.id}`], enabled: Boolean(party.id), staleTime: 20_000 } });
  const related = (query.data as { related?: Record<string, unknown> } | undefined)?.related;
  const obligations = asItems(related?.obligations);
  const payments = asItems(related?.payments);
  const donations = asItems(related?.donations);
  const receivables = asItems(related?.receivables);
  const linkedRecords = [
    ...obligations.slice(0, 2).map((item) => ({ type: "obligation" as const, id: String(item.id), label: text(item.title, item.kind === "advance" ? "سلفة" : "دين") })),
    ...payments.slice(0, 2).map((item) => ({ type: "payment" as const, id: String(item.id), label: text(item.description, "دفعة") })),
    ...receivables.slice(0, 2).map((item) => ({ type: "receivable" as const, id: String(item.id), label: text(item.title, "مستحق") })),
  ];
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <button type="button" onClick={() => setLocation(entityPath("financial_party", party.id))} className="flex min-h-11 w-full items-start justify-between gap-3 text-right transition hover:text-primary">
        <div className="min-w-0"><p className="truncate font-medium">{party.name ?? "طرف مالي"}</p><p className="mt-1 text-xs text-muted-foreground">{party.relationship || party.status || "فتح التفاصيل المالية"}</p></div>
        <WalletCards className="size-4 shrink-0 text-primary" />
      </button>
      {query.isLoading ? <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> جاري تحميل الملخص المالي…</div> : query.isError ? (
        <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300"><p>تعذر تحميل ملخص هذا الطرف.</p><button type="button" onClick={() => void query.refetch()} className="mt-2 font-semibold underline underline-offset-4">حاول مرة أخرى</button></div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <span>سلف/ديون: {obligations.length} · {groupedMoney(obligations, "principalAmountMinor") || "—"}</span>
            <span>مدفوعات: {payments.length} · {groupedMoney(payments, "amountMinor") || "—"}</span>
            <span>تبرعات: {donations.length} · {groupedMoney(donations, "amountMinor") || "—"}</span>
            <span>مستحقات: {receivables.length} · {groupedMoney(receivables, "amountMinor") || "—"}</span>
          </div>
          {linkedRecords.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border/60 pt-3">
              {linkedRecords.map((item) => (
                <button type="button" key={`${item.type}-${item.id}`} onClick={() => setLocation(financialRecordPath(item.type, item.id))} className="min-h-9 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary" data-testid={`link-financial-record-${item.id}`}>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ExpenseList({ expenses, setLocation, className = "" }: { expenses: Expense[]; setLocation: (path: string) => void; className?: string }) {
  return (
    <GraphSection title="المصروفات المرتبطة" icon={<Receipt className="size-4 text-primary" />} className={className}>
      <div className="space-y-2">
        {expenses.map((expense) => (
          <div key={expense.id} className="rounded-xl bg-muted/50 p-3">
            <button type="button" onClick={() => setLocation(recordPath("expenses", expense.id))} className="flex min-h-11 w-full items-center justify-between gap-3 text-right transition hover:text-primary">
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{expense.description}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{expense.purposeName ? `${expense.purposeName} · ` : ""}{formatDate(expense.occurredAt)}</span></span>
              <span className="shrink-0 font-mono text-sm font-semibold">{money(expense.amountMinor, expense.currency)}</span>
            </button>
            <div className="mt-2 flex flex-wrap gap-2 border-t border-border/60 pt-2">
              {expense.projectId && <button type="button" onClick={() => setLocation(entityPath("project", expense.projectId!))} className="min-h-9 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary">المشروع: {expense.projectName ?? "فتح المشروع"}</button>}
              {expense.personId && <button type="button" onClick={() => setLocation(entityPath("person", expense.personId!))} className="min-h-9 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary">الشخص: {expense.personName ?? "فتح الشخص"}</button>}
              {expense.origin?.conversationId && <button type="button" onClick={() => {
                const params = new URLSearchParams({ conversationId: expense.origin!.conversationId });
                if (expense.origin?.turnId) params.set("turnId", expense.origin.turnId);
                setLocation(`/?${params.toString()}`);
              }} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 text-xs font-medium text-primary hover:border-primary/40 hover:bg-primary/10">
                <MessageSquareText className="size-3.5" /> فتح المحادثة الأصلية
              </button>}
            </div>
          </div>
        ))}
      </div>
    </GraphSection>
  );
}