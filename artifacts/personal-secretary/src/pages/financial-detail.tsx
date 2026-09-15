import { ArrowRight, CircleAlert, Clock3, FolderKanban, HandCoins, LoaderCircle, Receipt, Scale, UserRound, WalletCards } from "lucide-react";
import { useGetEntityGraph, useGetFinancialParty } from "@workspace/api-client-react";
import type { ReactNode } from "react";
import { useLocation, useRoute } from "wouter";

type Item = Record<string, unknown>;

function items(value: unknown): Item[] {
  return Array.isArray(value) ? value.filter((item): item is Item => Boolean(item && typeof item === "object")) : [];
}

function text(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function amount(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function money(value: unknown, currency: unknown) {
  const code = text(currency, "EGP");
  return new Intl.NumberFormat("ar-EG", { style: "currency", currency: code }).format(amount(value) / 100);
}

function formatDate(value: unknown) {
  if (!value) return "بدون تاريخ";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function groupedMoney(rows: Item[], field: string) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const currency = text(row.currency, "EGP");
    totals.set(currency, (totals.get(currency) ?? 0) + amount(row[field]));
  }
  return [...totals.entries()].map(([currency, total]) => money(total, currency)).join("، ");
}

export default function FinancialDetail() {
  const [, params] = useRoute("/financial/parties/:id");
  const [, setLocation] = useLocation();
  const id = params?.id ?? "";
  const financialQuery = useGetFinancialParty(id, { query: { queryKey: [`/api/financial/parties/${id}`], enabled: Boolean(id), staleTime: 20_000 } });
  const graphQuery = useGetEntityGraph("financial_party", id, { query: { queryKey: [`/api/entities/financial_party/${id}`], enabled: Boolean(id), staleTime: 20_000 } });

  if (financialQuery.isLoading || graphQuery.isLoading) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><LoaderCircle className="size-6 animate-spin text-primary" /></div>;
  }
  if (financialQuery.isError || !financialQuery.data) {
    return <div dir="rtl" lang="ar" className="flex min-h-[100dvh] items-center justify-center bg-background p-6"><div className="rounded-2xl border border-destructive/25 bg-card p-6 text-center"><CircleAlert className="mx-auto size-8 text-destructive" /><p className="mt-3 text-sm">تعذر تحميل الطرف المالي.</p><button type="button" onClick={() => setLocation("/records")} className="mt-5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">العودة للسجلات</button></div></div>;
  }

  const data = financialQuery.data as { entity?: Item; related?: Record<string, unknown> };
  const entity = data.entity ?? {};
  const related = data.related ?? {};
  const obligations = items(related.obligations);
  const payments = items(related.payments);
  const donations = items(related.donations);
  const receivables = items(related.receivables);
  const graph = graphQuery.data as { related?: Record<string, unknown>; timeline?: Item[] } | undefined;
  const graphRelated = graph?.related ?? {};
  const people = items(graphRelated.people);
  const projects = items(graphRelated.projects);
  const purposes = items(graphRelated.purposes);

  return (
    <div dir="rtl" lang="ar" className="grain min-h-[100dvh] bg-background text-foreground">
      <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-8 sm:py-10">
        <button type="button" onClick={() => setLocation("/records?tab=financial")} className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary"><ArrowRight className="size-4" /> العودة للسجلات المالية</button>
        <header className="mt-8 flex items-start gap-4">
          <div className="rounded-2xl bg-primary/10 p-3 text-primary"><WalletCards className="size-6" /></div>
          <div><p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Financial Party</p><h1 className="mt-1 font-serif text-3xl tracking-tight sm:text-4xl">{text(entity.name, "طرف مالي")}</h1><p className="mt-2 text-sm text-muted-foreground">الأرقام أدناه مجمعة حسب النوع والعملة، ولا تمثل صافي رصيد إلا حيث يذكر ذلك صراحة.</p></div>
        </header>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="السلف والديون" value={groupedMoney(obligations, "principalAmountMinor") || "—"} detail={`${obligations.length} سجل`} />
          <SummaryCard label="المدفوعات" value={groupedMoney(payments, "amountMinor") || "—"} detail={`${payments.length} سجل`} />
          <SummaryCard label="التبرعات" value={groupedMoney(donations, "amountMinor") || "—"} detail={`${donations.length} سجل`} />
          <SummaryCard label="المستحقات" value={groupedMoney(receivables, "amountMinor") || "—"} detail={`${receivables.length} سجل`} />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <FinancialSection title="السلف والديون" icon={<Scale className="size-4 text-primary" />} items={obligations} render={(item) => <><span>{text(item.title, item.kind === "advance" ? "سلفة" : "دين")}<small className="mt-1 block text-xs text-muted-foreground">{item.outstandingAmountMinor !== undefined ? `المتبقي: ${money(item.outstandingAmountMinor, item.currency)}` : text(item.status, "")}</small></span><span className="font-mono">{money(item.principalAmountMinor, item.currency)}</span></>} onOpen={() => setLocation("/records?tab=financial")} />
          <FinancialSection title="المدفوعات الفعلية" icon={<WalletCards className="size-4 text-primary" />} items={payments} render={(item) => <><span>{text(item.paymentKind, "دفعة")}<small className="mt-1 block text-xs text-muted-foreground">{formatDate(item.occurredAt)}</small></span><span className="font-mono">{money(item.amountMinor, item.currency)}</span></>} onOpen={() => setLocation("/records?tab=financial")} />
          <FinancialSection title="التبرعات" icon={<HandCoins className="size-4 text-primary" />} items={donations} render={(item) => <><span>{item.status === "pledged" ? "تعهد" : "تبرع مدفوع"}<small className="mt-1 block text-xs text-muted-foreground">{formatDate(item.pledgedAt)}</small></span><span className="font-mono">{money(item.amountMinor, item.currency)}</span></>} onOpen={() => setLocation("/records?tab=financial")} />
          <FinancialSection title="الدخل والمستحقات" icon={<Receipt className="size-4 text-primary" />} items={receivables} render={(item) => <><span>{text(item.title, item.kind === "income" ? "دخل متوقع" : "مستحق")}<small className="mt-1 block text-xs text-muted-foreground">{text(item.status, "")}</small></span><span className="font-mono">{money(item.amountMinor, item.currency)}</span></>} onOpen={() => setLocation("/records?tab=financial")} />
        </div>

        {graphQuery.isError ? <p className="mt-5 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300">تم تحميل السجلات المالية، لكن تعذر تحميل العلاقات العامة لهذا الطرف.</p> : <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <LinkSection title="الأشخاص المرتبطون" icon={<UserRound className="size-4 text-primary" />} items={people} onOpen={(item) => setLocation(`/people/${String(item.id)}`)} />
          <LinkSection title="المشاريع المرتبطة" icon={<FolderKanban className="size-4 text-primary" />} items={projects} onOpen={(item) => setLocation(`/projects/${String(item.id)}`)} />
          <LinkSection title="الأغراض" icon={<Receipt className="size-4 text-primary" />} items={purposes} onOpen={() => setLocation("/records?tab=expenses")} />
          <Timeline events={graph?.timeline ?? []} />
        </div>}
      </main>
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 font-mono text-lg font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

function FinancialSection({ title, icon, items, render, onOpen }: { title: string; icon: ReactNode; items: Item[]; render: (item: Item) => ReactNode; onOpen: (item: Item) => void }) {
  return <section className="rounded-2xl border border-border bg-card p-5"><h2 className="flex items-center gap-2 font-semibold">{icon}{title}</h2><div className="mt-4 space-y-2">{items.length === 0 && <p className="text-sm text-muted-foreground">لا توجد سجلات مرتبطة.</p>}{items.map((item, index) => <button type="button" key={String(item.id ?? index)} onClick={() => onOpen(item)} className="flex w-full items-center justify-between gap-3 rounded-xl bg-muted/50 p-3 text-right text-sm transition hover:bg-primary/5">{render(item)}</button>)}</div></section>;
}

function LinkSection({ title, icon, items, onOpen }: { title: string; icon: ReactNode; items: Item[]; onOpen: (item: Item) => void }) {
  return <section className="rounded-2xl border border-border bg-card p-5"><h2 className="flex items-center gap-2 font-semibold">{icon}{title}</h2><div className="mt-4 space-y-2">{items.length === 0 && <p className="text-sm text-muted-foreground">لا توجد سجلات مرتبطة.</p>}{items.map((item, index) => <button type="button" key={String(item.id ?? index)} onClick={() => onOpen(item)} className="flex w-full items-center justify-between rounded-xl bg-muted/50 p-3 text-right text-sm transition hover:bg-primary/5"><span>{text(item.name, text(item.title, "سجل مرتبط"))}</span><ArrowRight className="size-3.5 text-muted-foreground" /></button>)}</div></section>;
}

function Timeline({ events }: { events: Item[] }) {
  return <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-3"><h2 className="flex items-center gap-2 font-semibold"><Clock3 className="size-4 text-primary" /> النشاط</h2><div className="mt-4 space-y-4">{events.length === 0 && <p className="text-sm text-muted-foreground">لا يوجد نشاط مسجل بعد.</p>}{events.map((event, index) => <div key={String(event.id ?? index)} className="border-r-2 border-primary/20 pr-3"><p className="text-sm">{text(event.summary, "نشاط مالي")}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(event.occurredAt)}</p></div>)}</div></section>;
}