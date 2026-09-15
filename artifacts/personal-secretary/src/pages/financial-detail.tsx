import { ArrowRight, CircleAlert, Clock3, FolderKanban, HandCoins, LoaderCircle, Receipt, Scale, UserRound, WalletCards } from "lucide-react";
import { useGetEntityGraph, useGetFinancialParty } from "@workspace/api-client-react";
import { useLocation, useRoute } from "wouter";
import type { ReactNode } from "react";
import { ActivityTimeline, type ActivityTimelineEvent } from "../components/graph/activity-timeline";
import { AskSecretaryLink, entityPath, financialRecordPath } from "../components/graph/context-link";
import { EmptyRelation, GraphSection, RelatedLink } from "../components/graph/graph-section";

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

function idOf(value: unknown) {
  return typeof value === "string" && value ? value : "";
}

export default function FinancialDetail() {
  const [, params] = useRoute("/financial/parties/:id");
  const [, setLocation] = useLocation();
  const id = params?.id ?? "";
  const financialQuery = useGetFinancialParty(id, { query: { queryKey: [`/api/financial/parties/${id}`], enabled: Boolean(id), staleTime: 20_000 } });
  const graphQuery = useGetEntityGraph("financial_party", id, { query: { queryKey: [`/api/entities/financial_party/${id}`], enabled: Boolean(id), staleTime: 20_000 } });

  if (financialQuery.isLoading) {
    return <div dir="rtl" lang="ar" className="flex min-h-[100dvh] items-center justify-center bg-background"><LoaderCircle className="size-6 animate-spin text-primary" /><span className="sr-only">جاري تحميل الطرف المالي</span></div>;
  }
  if (financialQuery.isError || !financialQuery.data) {
    return (
      <div dir="rtl" lang="ar" className="flex min-h-[100dvh] items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border border-destructive/25 bg-card p-6 text-center">
          <CircleAlert className="mx-auto size-8 text-destructive" />
          <p className="mt-3 text-sm">تعذر تحميل الطرف المالي. قد يكون محذوفًا أو غير متاح في مساحتك.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2"><button type="button" onClick={() => void financialQuery.refetch()} className="min-h-10 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold">حاول مرة أخرى</button><button type="button" onClick={() => setLocation("/records?tab=financial")} className="min-h-10 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">العودة للسجلات المالية</button></div>
        </div>
      </div>
    );
  }

  const data = financialQuery.data as { entity?: Item; related?: Record<string, unknown> };
  const entity = data.entity ?? {};
  const related = data.related ?? {};
  const obligations = items(related.obligations);
  const payments = items(related.payments);
  const donations = items(related.donations);
  const receivables = items(related.receivables);
  const bounds = (related.bounds && typeof related.bounds === "object" ? related.bounds : {}) as Record<string, unknown>;
  const graph = graphQuery.data as { entity?: Item; related?: Record<string, unknown>; timeline?: ActivityTimelineEvent[] } | undefined;
  const graphRelated = graph?.related ?? {};
  const people = items(graphRelated.people);
  const projects = items(graphRelated.projects);
  const purposes = items(graphRelated.purposes);
  const entityName = text(entity.name, "طرف مالي");

  return (
    <div dir="rtl" lang="ar" className="grain min-h-[100dvh] bg-background text-foreground">
      <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-8 sm:py-10">
        <button type="button" onClick={() => setLocation("/records?tab=financial")} className="inline-flex min-h-10 items-center gap-2 text-xs text-muted-foreground hover:text-primary"><ArrowRight className="size-4" /> العودة للسجلات المالية</button>
        <header className="mt-6 rounded-[24px] border border-border bg-card p-5 sm:mt-8 sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-primary/10 p-3 text-primary"><WalletCards className="size-6" /></div>
              <div className="min-w-0"><p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">طرف مالي</p><h1 className="mt-1 break-words font-serif text-3xl tracking-tight sm:text-4xl">{entityName}</h1><p className="mt-2 text-sm text-muted-foreground">الأرقام أدناه مجمعة حسب النوع والعملة، ولا تمثل صافي رصيد.</p></div>
            </div>
            <AskSecretaryLink entityType="financial_party" entityId={id} entityName={entityName} />
          </div>
        </header>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="السلف والديون" value={groupedMoney(obligations, "principalAmountMinor") || "—"} detail={`${obligations.length} سجل`} />
          <SummaryCard label="المدفوعات" value={groupedMoney(payments, "amountMinor") || "—"} detail={`${payments.length} سجل`} />
          <SummaryCard label="التبرعات" value={groupedMoney(donations, "amountMinor") || "—"} detail={`${donations.length} سجل`} />
          <SummaryCard label="المستحقات" value={groupedMoney(receivables, "amountMinor") || "—"} detail={`${receivables.length} سجل`} />
        </div>
        {Object.entries(bounds).some(([key, value]) => key.endsWith("Truncated") && value === true) && <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300" role="status">بعض القوائم معروضة ضمن الحد المسموح للتفاصيل؛ هذه الأرقام ليست إجماليًا غير محدود.</p>}

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {obligations.length > 0 && <FinancialSection title="السلف والديون" icon={<Scale className="size-4 text-primary" />} items={obligations} render={(item) => <><span className="min-w-0"><span className="block truncate">{text(item.title, item.kind === "advance" ? "سلفة" : "دين")}</span><small className="mt-1 block text-xs text-muted-foreground">{item.outstandingAmountMinor !== undefined ? `المتبقي: ${money(item.outstandingAmountMinor, item.currency)}` : text(item.status, "")}</small></span><span className="shrink-0 font-mono">{money(item.principalAmountMinor, item.currency)}</span></>} onOpen={(item) => setLocation(financialRecordPath("obligation", idOf(item.id)))} partyIds={obligations.flatMap((item) => [idOf(item.lenderPartyId), idOf(item.borrowerPartyId)])} setLocation={setLocation} />}
          {payments.length > 0 && <FinancialSection title="المدفوعات الفعلية" icon={<WalletCards className="size-4 text-primary" />} items={payments} render={(item) => <><span className="min-w-0"><span className="block truncate">{text(item.description, text(item.paymentKind, "دفعة"))}</span><small className="mt-1 block text-xs text-muted-foreground">{formatDate(item.occurredAt)}</small></span><span className="shrink-0 font-mono">{money(item.amountMinor, item.currency)}</span></>} onOpen={(item) => setLocation(financialRecordPath("payment", idOf(item.id)))} partyIds={payments.flatMap((item) => [idOf(item.payerPartyId), idOf(item.payeePartyId)])} setLocation={setLocation} />}
          {donations.length > 0 && <FinancialSection title="التبرعات" icon={<HandCoins className="size-4 text-primary" />} items={donations} render={(item) => <><span className="min-w-0"><span className="block truncate">{item.status === "pledged" ? "تعهد" : "تبرع مدفوع"}</span><small className="mt-1 block text-xs text-muted-foreground">{formatDate(item.pledgedAt)}</small></span><span className="shrink-0 font-mono">{money(item.amountMinor, item.currency)}</span></>} onOpen={(item) => setLocation(financialRecordPath("donation", idOf(item.id)))} partyIds={donations.flatMap((item) => [idOf(item.donorPartyId), idOf(item.recipientPartyId)])} setLocation={setLocation} />}
          {receivables.length > 0 && <FinancialSection title="الدخل والمستحقات" icon={<Receipt className="size-4 text-primary" />} items={receivables} render={(item) => <><span className="min-w-0"><span className="block truncate">{text(item.title, item.kind === "income" ? "دخل متوقع" : "مستحق")}</span><small className="mt-1 block text-xs text-muted-foreground">{text(item.status, "")}</small></span><span className="shrink-0 font-mono">{money(item.amountMinor, item.currency)}</span></>} onOpen={(item) => setLocation(financialRecordPath("receivable", idOf(item.id)))} partyIds={receivables.flatMap((item) => [idOf(item.creditorPartyId), idOf(item.debtorPartyId)])} setLocation={setLocation} />}
        </div>

        {graphQuery.isLoading && <div className="mt-5 flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> جاري تحميل العلاقات المرتبطة…</div>}
        {graphQuery.isError ? (
          <div className="mt-5 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300"><p>تم تحميل السجلات المالية، لكن تعذر تحميل العلاقات العامة لهذا الطرف.</p><button type="button" onClick={() => void graphQuery.refetch()} className="mt-3 min-h-10 font-semibold underline underline-offset-4">حاول مرة أخرى</button></div>
        ) : (
          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            {people.length > 0 && <LinkSection title="الأشخاص المرتبطون" icon={<UserRound className="size-4 text-primary" />} items={people} onOpen={(item) => setLocation(entityPath("person", String(item.id)))} />}
            {projects.length > 0 && <LinkSection title="المشاريع المرتبطة" icon={<FolderKanban className="size-4 text-primary" />} items={projects} onOpen={(item) => setLocation(entityPath("project", String(item.id)))} />}
            {purposes.length > 0 && <LinkSection title="الأغراض" icon={<Receipt className="size-4 text-primary" />} items={purposes} onOpen={() => setLocation("/records?tab=expenses")} />}
          </div>
        )}
        <ActivityTimeline entityType="financial_party" entityId={id} initialEvents={graph?.timeline ?? []} className="mt-5" />
      </main>
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 font-mono text-lg font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

function FinancialSection({
  title,
  icon,
  items: rows,
  render,
  onOpen,
  partyIds,
  setLocation,
}: {
  title: string;
  icon: ReactNode;
  items: Item[];
  render: (item: Item) => ReactNode;
  onOpen: (item: Item) => void;
  partyIds: string[];
  setLocation: (path: string) => void;
}) {
  const visiblePartyIds = partyIds.filter(Boolean);
  return (
    <GraphSection title={title} icon={icon}>
      <div className="space-y-2">
        {rows.map((item, index) => <button type="button" key={String(item.id ?? index)} onClick={() => onOpen(item)} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl bg-muted/50 p-3 text-right text-sm transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{render(item)}</button>)}
      </div>
      {visiblePartyIds.length > 0 && <div className="mt-3 flex flex-wrap gap-2 border-t border-border/60 pt-3"><span className="self-center text-xs text-muted-foreground">الأطراف:</span>{[...new Set(visiblePartyIds)].map((partyId) => <button type="button" key={partyId} onClick={() => setLocation(entityPath("financial_party", partyId))} className="min-h-9 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary">فتح الطرف المالي</button>)}</div>}
    </GraphSection>
  );
}

function LinkSection({ title, icon, items: rows, onOpen }: { title: string; icon: React.ReactNode; items: Item[]; onOpen: (item: Item) => void }) {
  return <GraphSection title={title} icon={icon}><div className="space-y-2">{rows.map((item, index) => <RelatedLink key={String(item.id ?? index)} label={text(item.name, text(item.title, "سجل مرتبط"))} detail={text(item.relationship, "") || undefined} onOpen={() => onOpen(item)} />)}</div></GraphSection>;
}