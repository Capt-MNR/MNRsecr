import { ArrowRight, CircleAlert, Clock3, FolderKanban, LoaderCircle, Receipt, UserRound, Bell, CheckSquare2, WalletCards } from "lucide-react";
import { useGetEntityGraph } from "@workspace/api-client-react";
import { useLocation, useRoute } from "wouter";

type EntityType = "person" | "project";
type RelatedItem = { id: string; relationshipId?: string; name?: string; title?: string; text?: string; relationship?: string | null; status?: string; dueAt?: string | null };
type GraphData = {
  entity: { id: string; name: string; notes?: string | null; status?: string };
  related: {
    projects: RelatedItem[];
    people: RelatedItem[];
    expenses: Array<{ id: string; amountMinor: number; currency: string; description: string; occurredAt: string }>;
    commitments: RelatedItem[];
    tasks?: RelatedItem[];
    reminders?: RelatedItem[];
    financialParties?: RelatedItem[];
  };
  timeline: Array<{ id: string; eventType: string; summary: string; occurredAt: string }>;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "بدون موعد";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("ar-EG", { style: "currency", currency }).format(amountMinor / 100);
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
          <button type="button" onClick={() => setLocation("/records")} className="mt-5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">العودة للسجلات</button>
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
            <p className="mt-2 text-sm text-muted-foreground">
              {entityType === "project" ? `الحالة: ${entity.status}` : entity.notes || "لا توجد ملاحظات محفوظة."}
            </p>
          </div>
        </header>

        {entityType === "person" ? (
          <PersonSections data={data} setLocation={setLocation} />
        ) : (
          <ProjectSections data={data} setLocation={setLocation} />
        )}
      </main>
    </div>
  );
}

function PersonSections({ data, setLocation }: { data: GraphData; setLocation: (path: string) => void }) {
  return (
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
              <h2 className="flex items-center gap-2 font-semibold"><FolderKanban className="size-4 text-primary" /> المشاريع المرتبطة</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {data.related.projects.length === 0 && <p className="text-sm text-muted-foreground">لا توجد مشاريع مرتبطة.</p>}
                {data.related.projects.map((item) => (
                  <button type="button" key={item.relationshipId} onClick={() => setLocation(`/projects/${item.id}`)} className="rounded-xl border border-border p-3 text-right hover:border-primary/50">
                    <p className="font-medium">{item.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.relationship || "بدون وصف للعلاقة"} · {item.status}</p>
                  </button>
                ))}
              </div>
            </section>
            <RelatedCards title="المهام المرتبطة" icon={<CheckSquare2 className="size-4 text-primary" />} items={data.related.tasks ?? []} />
            <RelatedCards title="التذكيرات المرتبطة" icon={<Bell className="size-4 text-primary" />} items={data.related.reminders ?? []} />
            <RelatedCards title="الأطراف المالية" icon={<WalletCards className="size-4 text-primary" />} items={data.related.financialParties ?? []} />
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="flex items-center gap-2 font-semibold"><Clock3 className="size-4 text-primary" /> النشاط</h2>
              <Timeline events={data.timeline} />
            </section>
            <ExpenseList expenses={data.related.expenses} />
            <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
              <h2 className="font-semibold">الالتزامات</h2>
              <div className="mt-4 space-y-3">
                {data.related.commitments.length === 0 && <p className="text-sm text-muted-foreground">لا توجد التزامات مرتبطة.</p>}
                {data.related.commitments.map((item) => <div key={item.id} className="flex items-center justify-between rounded-xl bg-muted/50 p-3 text-sm"><span>{item.title}</span><span className="text-xs text-muted-foreground">{item.status} · {formatDate(item.dueAt)}</span></div>)}
              </div>
            </section>
          </div>
  );
}

function ProjectSections({ data, setLocation }: { data: GraphData; setLocation: (path: string) => void }) {
  return (
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
              <h2 className="flex items-center gap-2 font-semibold"><UserRound className="size-4 text-primary" /> الأشخاص المرتبطون</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {data.related.people.length === 0 && <p className="text-sm text-muted-foreground">لا توجد علاقات محفوظة.</p>}
                {data.related.people.map((item) => (
                  <button type="button" key={item.relationshipId} onClick={() => setLocation(`/people/${item.id}`)} className="rounded-xl border border-border p-3 text-right hover:border-primary/50">
                    <p className="font-medium">{item.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.relationship || "بدون وصف للعلاقة"}</p>
                  </button>
                ))}
              </div>
            </section>
            <RelatedCards title="المهام المرتبطة" icon={<CheckSquare2 className="size-4 text-primary" />} items={data.related.tasks ?? []} />
            <RelatedCards title="التذكيرات المرتبطة" icon={<Bell className="size-4 text-primary" />} items={data.related.reminders ?? []} />
            <RelatedCards title="الأطراف المالية" icon={<WalletCards className="size-4 text-primary" />} items={data.related.financialParties ?? []} />
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="flex items-center gap-2 font-semibold"><Clock3 className="size-4 text-primary" /> النشاط</h2>
              <Timeline events={data.timeline} />
            </section>
            <ExpenseList expenses={data.related.expenses} />
          </div>
  );
}

function RelatedCards({ title, icon, items }: { title: string; icon: React.ReactNode; items: RelatedItem[] }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 font-semibold">{icon}{title}</h2>
      <div className="mt-4 space-y-2">
        {items.length === 0 && <p className="text-sm text-muted-foreground">لا توجد سجلات مرتبطة.</p>}
        {items.map((item) => <div key={item.id} className="rounded-xl bg-muted/50 p-3 text-sm"><p className="font-medium">{item.name ?? item.title ?? item.text}</p><p className="mt-1 text-xs text-muted-foreground">{item.relationship || item.status || formatDate(item.dueAt)}</p></div>)}
      </div>
    </section>
  );
}

function Timeline({ events }: { events: Array<{ id: string; eventType: string; summary: string; occurredAt: string }> }) {
  return (
    <div className="mt-4 space-y-4">
      {events.length === 0 && <p className="text-sm text-muted-foreground">لا يوجد نشاط مسجل بعد.</p>}
      {events.map((event) => <div key={event.id} className="border-r-2 border-primary/20 pr-3"><p className="text-sm">{event.summary}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(event.occurredAt)}</p></div>)}
    </div>
  );
}

function ExpenseList({ expenses }: { expenses: Array<{ id: string; amountMinor: number; currency: string; description: string; occurredAt: string }> }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
      <h2 className="flex items-center gap-2 font-semibold"><Receipt className="size-4 text-primary" /> المصروفات المرتبطة</h2>
      <div className="mt-4 space-y-3">
        {expenses.length === 0 && <p className="text-sm text-muted-foreground">لا توجد مصروفات مرتبطة.</p>}
        {expenses.map((expense) => <div key={expense.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-3"><div><p className="text-sm font-medium">{expense.description}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(expense.occurredAt)}</p></div><span className="font-mono text-sm font-semibold">{money(expense.amountMinor, expense.currency)}</span></div>)}
      </div>
    </section>
  );
}