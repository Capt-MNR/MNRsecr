import { ArrowRight, Bell, CheckSquare2, CircleAlert, Clock3, FolderKanban, LoaderCircle, Receipt, Scale, UserRound, WalletCards } from "lucide-react";
import { useGetEntityGraph, useGetFinancialParty } from "@workspace/api-client-react";
import { useLocation, useRoute } from "wouter";
import type { ReactNode } from "react";

type EntityType = "person" | "project";
type RelatedItem = { id: string; relationshipId?: string; name?: string; title?: string; text?: string; relationship?: string | null; status?: string; dueAt?: string | null };
type Expense = { id: string; amountMinor: number; currency: string; description: string; occurredAt: string; projectName?: string | null; personName?: string | null; purposeName?: string | null };
type GraphData = {
  entity: { id: string; name: string; notes?: string | null; status?: string };
  related: {
    projects?: RelatedItem[];
    people?: RelatedItem[];
    expenses?: Expense[];
    commitments?: RelatedItem[];
    tasks?: RelatedItem[];
    reminders?: RelatedItem[];
    financialParties?: RelatedItem[];
  };
  timeline?: Array<{ id: string; eventType: string; summary: string; occurredAt: string }>;
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
  const query = useGetEntityGraph(entityType, id, { query: { queryKey: [`/api/entities/${entityType}/${id}`], enabled: Boolean(id) } });
  const Icon = entityType === "person" ? UserRound : FolderKanban;

  if (query.isLoading) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-background text-muted-foreground"><LoaderCircle className="size-6 animate-spin" /></div>;
  }
  if (query.isError || !query.data) {
    return (
      <div dir="rtl" lang="ar" className="flex min-h-[100dvh] items-center justify-center bg-background p-6 text-foreground">
        <div className="rounded-2xl border border-destructive/25 bg-card p-6 text-center">
          <CircleAlert className="mx-auto size-8 text-destructive" />
          <p className="mt-3 text-sm">تعذر تحميل تفاصيل الكيان.</p>
          <div className="mt-5 flex justify-center gap-2">
            <button type="button" onClick={() => void query.refetch()} className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold">حاول مرة أخرى</button>
            <button type="button" onClick={() => setLocation("/records")} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">العودة للسجلات</button>
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
        <button type="button" onClick={() => setLocation("/records")} className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary">
          <ArrowRight className="size-4" /> العودة للسجلات
        </button>
        <header className="mt-8 flex items-start gap-4">
          <div className="rounded-2xl bg-primary/10 p-3 text-primary"><Icon className="size-6" /></div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{entityType === "person" ? "Person" : "Project"}</p>
            <h1 className="mt-1 font-serif text-3xl tracking-tight sm:text-4xl">{entity.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{entityType === "project" ? `الحالة: ${entity.status}` : entity.notes || "لا توجد ملاحظات محفوظة."}</p>
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
    <div className="mt-10 grid gap-5 lg:grid-cols-3">
      <EntityLinks title="المشاريع المرتبطة" icon={<FolderKanban className="size-4 text-primary" />} items={related.projects ?? []} getPath={(item) => `/projects/${item.id}`} setLocation={setLocation} className="lg:col-span-2" />
      <EntityLinks title="المهام المرتبطة" icon={<CheckSquare2 className="size-4 text-primary" />} items={related.tasks ?? []} getPath={(item) => `/records?tab=tasks&recordId=${item.id}`} setLocation={setLocation} />
      <EntityLinks title="التذكيرات المرتبطة" icon={<Bell className="size-4 text-primary" />} items={related.reminders ?? []} getPath={(item) => `/records?tab=reminders&recordId=${item.id}`} setLocation={setLocation} />
      <FinancialSnapshots parties={related.financialParties ?? []} setLocation={setLocation} />
      <ExpenseList expenses={related.expenses ?? []} setLocation={setLocation} />
      <EntityLinks title="الالتزامات المرتبطة" icon={<Scale className="size-4 text-primary" />} items={related.commitments ?? []} getPath={(item) => `/records?tab=commitments&recordId=${item.id}`} setLocation={setLocation} className="lg:col-span-2" />
      <TimelineSection events={data.timeline ?? []} />
    </div>
  );
}

function ProjectSections({ data, setLocation }: { data: GraphData; setLocation: (path: string) => void }) {
  const related = data.related;
  return (
    <div className="mt-10 grid gap-5 lg:grid-cols-3">
      <EntityLinks title="الأشخاص المرتبطون" icon={<UserRound className="size-4 text-primary" />} items={related.people ?? []} getPath={(item) => `/people/${item.id}`} setLocation={setLocation} className="lg:col-span-2" />
      <EntityLinks title="المهام المرتبطة" icon={<CheckSquare2 className="size-4 text-primary" />} items={related.tasks ?? []} getPath={(item) => `/records?tab=tasks&recordId=${item.id}`} setLocation={setLocation} />
      <EntityLinks title="التذكيرات المرتبطة" icon={<Bell className="size-4 text-primary" />} items={related.reminders ?? []} getPath={(item) => `/records?tab=reminders&recordId=${item.id}`} setLocation={setLocation} />
      <FinancialSnapshots parties={related.financialParties ?? []} setLocation={setLocation} />
      <ExpenseList expenses={related.expenses ?? []} setLocation={setLocation} />
      <TimelineSection events={data.timeline ?? []} />
    </div>
  );
}

function EntityLinks({ title, icon, items, getPath, setLocation, className = "" }: { title: string; icon: ReactNode; items: RelatedItem[]; getPath: (item: RelatedItem) => string; setLocation: (path: string) => void; className?: string }) {
  return (
    <section className={`rounded-2xl border border-border bg-card p-5 ${className}`}>
      <h2 className="flex items-center gap-2 font-semibold">{icon}{title}</h2>
      <div className="mt-4 space-y-2">
        {items.length === 0 && <p className="text-sm text-muted-foreground">لا توجد سجلات مرتبطة.</p>}
        {items.map((item) => (
          <button type="button" key={item.relationshipId ?? item.id} onClick={() => setLocation(getPath(item))} className="flex w-full items-center justify-between gap-3 rounded-xl bg-muted/50 p-3 text-right text-sm transition hover:bg-primary/5">
            <span className="font-medium">{item.name ?? item.title ?? item.text ?? "سجل مرتبط"}</span>
            <span className="text-xs text-muted-foreground">{item.relationship || item.status || formatDate(item.dueAt)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function FinancialSnapshots({ parties, setLocation }: { parties: RelatedItem[]; setLocation: (path: string) => void }) {
  if (parties.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-3">
      <h2 className="flex items-center gap-2 font-semibold"><WalletCards className="size-4 text-primary" /> العلاقات المالية</h2>
      <p className="mt-1 text-xs text-muted-foreground">ملخص منفصل لكل طرف مالي؛ لا يمثل صافي رصيد ولا يخلط بين العملات.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {parties.map((party) => <PartySnapshot key={party.id} party={party} setLocation={setLocation} />)}
      </div>
    </section>
  );
}

function PartySnapshot({ party, setLocation }: { party: RelatedItem; setLocation: (path: string) => void }) {
  const query = useGetFinancialParty(party.id, { query: { queryKey: [`/api/financial/parties/${party.id}`], enabled: Boolean(party.id), staleTime: 20_000 } });
  const related = (query.data as { related?: Record<string, unknown> } | undefined)?.related;
  const obligations = asItems(related?.obligations);
  const payments = asItems(related?.payments);
  const donations = asItems(related?.donations);
  const receivables = asItems(related?.receivables);
  return (
    <button type="button" onClick={() => setLocation(`/financial/parties/${party.id}`)} className="rounded-xl border border-border bg-background p-4 text-right transition hover:border-primary/40">
      <div className="flex items-start justify-between gap-3">
        <div><p className="font-medium">{party.name ?? "طرف مالي"}</p><p className="mt-1 text-xs text-muted-foreground">{party.relationship || party.status || "فتح التفاصيل المالية"}</p></div>
        <WalletCards className="size-4 text-primary" />
      </div>
      {query.isLoading ? <LoaderCircle className="mt-4 size-4 animate-spin text-muted-foreground" /> : query.isError ? <p className="mt-3 text-xs text-destructive">تعذر تحميل ملخص هذا الطرف.</p> : (
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <span>سلف/ديون: {obligations.length} · {groupedMoney(obligations, "principalAmountMinor") || "—"}</span>
          <span>مدفوعات: {payments.length} · {groupedMoney(payments, "amountMinor") || "—"}</span>
          <span>تبرعات: {donations.length} · {groupedMoney(donations, "amountMinor") || "—"}</span>
          <span>مستحقات: {receivables.length} · {groupedMoney(receivables, "amountMinor") || "—"}</span>
        </div>
      )}
    </button>
  );
}

function TimelineSection({ events }: { events: Array<{ id: string; summary: string; occurredAt: string }> }) {
  return <section className="rounded-2xl border border-border bg-card p-5"><h2 className="flex items-center gap-2 font-semibold"><Clock3 className="size-4 text-primary" /> النشاط</h2><div className="mt-4 space-y-4">{events.length === 0 && <p className="text-sm text-muted-foreground">لا يوجد نشاط مسجل بعد.</p>}{events.map((event) => <div key={event.id} className="border-r-2 border-primary/20 pr-3"><p className="text-sm">{event.summary}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(event.occurredAt)}</p></div>)}</div></section>;
}

function ExpenseList({ expenses, setLocation }: { expenses: Expense[]; setLocation: (path: string) => void }) {
  return <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2"><h2 className="flex items-center gap-2 font-semibold"><Receipt className="size-4 text-primary" /> المصروفات المرتبطة</h2><div className="mt-4 space-y-2">{expenses.length === 0 && <p className="text-sm text-muted-foreground">لا توجد مصروفات مرتبطة.</p>}{expenses.map((expense) => <button type="button" key={expense.id} onClick={() => setLocation(`/records?tab=expenses&recordId=${expense.id}`)} className="flex w-full items-center justify-between gap-3 rounded-xl bg-muted/50 p-3 text-right transition hover:bg-primary/5"><div><p className="text-sm font-medium">{expense.description}</p><p className="mt-1 text-xs text-muted-foreground">{expense.purposeName ? `${expense.purposeName} · ` : ""}{formatDate(expense.occurredAt)}</p></div><span className="font-mono text-sm font-semibold">{money(expense.amountMinor, expense.currency)}</span></button>)}</div></section>;
}