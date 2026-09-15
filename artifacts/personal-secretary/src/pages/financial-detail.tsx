import { ArrowRight, CircleAlert, LoaderCircle, Receipt, Scale, WalletCards } from "lucide-react";
import { useGetFinancialParty } from "@workspace/api-client-react";
import type { ReactNode } from "react";
import { useLocation, useRoute } from "wouter";

function money(value: unknown, currency: unknown) {
  const amount = typeof value === "number" ? value / 100 : Number(value ?? 0) / 100;
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: typeof currency === "string" ? currency : "EGP",
  }).format(amount);
}

export default function FinancialDetail() {
  const [, params] = useRoute("/financial/parties/:id");
  const [, setLocation] = useLocation();
  const query = useGetFinancialParty(params?.id ?? "", {
    query: { queryKey: [`/api/financial/parties/${params?.id ?? ""}`], enabled: Boolean(params?.id) },
  });

  if (query.isLoading) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><LoaderCircle className="size-6 animate-spin text-primary" /></div>;
  }
  if (query.isError || !query.data) {
    return <div dir="rtl" lang="ar" className="flex min-h-[100dvh] items-center justify-center bg-background p-6">
      <div className="rounded-2xl border border-destructive/25 bg-card p-6 text-center">
        <CircleAlert className="mx-auto size-8 text-destructive" />
        <p className="mt-3 text-sm">تعذر تحميل الطرف المالي.</p>
        <button type="button" onClick={() => setLocation("/records")} className="mt-5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">العودة للسجلات</button>
      </div>
    </div>;
  }

  const data = query.data as any;
  const entity = data.entity;
  const related = data.related ?? {};
  return <div dir="rtl" lang="ar" className="grain min-h-[100dvh] bg-background text-foreground">
    <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-8 sm:py-10">
      <button type="button" onClick={() => setLocation("/records")} className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary">
        <ArrowRight className="size-4" /> العودة للسجلات
      </button>
      <header className="mt-8 flex items-start gap-4">
        <div className="rounded-2xl bg-primary/10 p-3 text-primary"><WalletCards className="size-6" /></div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Financial Party</p>
          <h1 className="mt-1 font-serif text-3xl tracking-tight sm:text-4xl">{entity.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">الاتجاهات المالية محفوظة بمعرّفات صريحة، وليست مستنتجة من الاسم.</p>
        </div>
      </header>
      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        <FinancialSection title="السلف والديون" icon={<Scale className="size-4 text-primary" />} items={related.obligations ?? []} render={(item: any) => <><span>{item.title} · {item.kind === "advance" ? "سلفة" : "دين"}</span><span>{money(item.principalAmountMinor, item.currency)}</span></>} />
        <FinancialSection title="المدفوعات الفعلية" icon={<WalletCards className="size-4 text-primary" />} items={related.payments ?? []} render={(item: any) => <><span>{item.paymentKind}</span><span>{money(item.amountMinor, item.currency)}</span></>} />
        <FinancialSection title="التبرعات" icon={<Receipt className="size-4 text-primary" />} items={related.donations ?? []} render={(item: any) => <><span>{item.status === "pledged" ? "تعهد" : "تبرع مدفوع"}</span><span>{money(item.amountMinor, item.currency)}</span></>} />
        <FinancialSection title="الدخل والمستحقات" icon={<Scale className="size-4 text-primary" />} items={related.receivables ?? []} render={(item: any) => <><span>{item.title} · {item.kind}</span><span>{money(item.amountMinor, item.currency)}</span></>} />
      </div>
    </main>
  </div>;
}

function FinancialSection({ title, icon, items, render }: { title: string; icon: ReactNode; items: any[]; render: (item: any) => ReactNode }) {
  return <section className="rounded-2xl border border-border bg-card p-5">
    <h2 className="flex items-center gap-2 font-semibold">{icon}{title}</h2>
    <div className="mt-4 space-y-3">
      {items.length === 0 && <p className="text-sm text-muted-foreground">لا توجد سجلات مرتبطة.</p>}
      {items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-3 text-sm">{render(item)}</div>)}
    </div>
  </section>;
}