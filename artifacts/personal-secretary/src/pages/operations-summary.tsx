import { Activity, ArrowRight, CircleAlert, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import {
  getGetOperationalSummaryQueryKey,
  useGetOperationalSummary,
} from '@workspace/api-client-react';

const numberFormat = new Intl.NumberFormat('ar-EG');

function count(value: number | undefined) {
  return value === undefined ? '—' : numberFormat.format(value);
}

function latency(value: number | null | undefined) {
  return value == null ? 'لا توجد قياسات' : `${numberFormat.format(Math.round(value))} ms`;
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | undefined;
  detail?: string;
}) {
  return (
    <article className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{count(value)}</p>
      {detail && <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{detail}</p>}
    </article>
  );
}

export default function OperationsSummary() {
  const [anchorTime, setAnchorTime] = useState(() => Date.now());
  const to = new Date(anchorTime);
  const from = new Date(anchorTime - 24 * 60 * 60 * 1_000);
  const params = { from: from.toISOString(), to: to.toISOString() };
  const summaryQuery = useGetOperationalSummary(
    params,
    {
      query: {
        queryKey: getGetOperationalSummaryQueryKey(params),
        refetchInterval: 60_000,
        staleTime: 30_000,
      },
    },
  );
  const summary = summaryQuery.data;

  const countGroups = [
    {
      title: 'مشغّل الأحداث',
      cards: [
        { label: 'الأحداث الكلية', value: summary?.triggers.total },
        { label: 'عولجت', value: summary?.triggers.processed },
        { label: 'عولجت بعد المهلة', value: summary?.triggers.delayed, detail: 'أكثر من 60 ثانية من وقت الإتاحة' },
        { label: 'معزولة نهائيًا', value: summary?.triggers.missed, detail: 'أحداث انتهت في الحجر خلال الفترة' },
        { label: 'متأخرة حاليًا', value: summary?.triggers.overdue, detail: 'معلّقة أو محجوزة منذ أكثر من 60 ثانية' },
      ],
    },
    {
      title: 'Agent Work',
      cards: [
        { label: 'أعمال أُنشئت', value: summary?.work.created },
        { label: 'اكتملت', value: summary?.work.completed },
        { label: 'فشلت', value: summary?.work.failed },
        { label: 'انتهت مهلة إيجارها', value: summary?.work.stale },
        { label: 'استردادات الإيجار', value: summary?.work.leaseRecoveries },
      ],
    },
    {
      title: 'التنبيهات والمزوّدون',
      cards: [
        { label: 'تنبيهات أُدرجت', value: summary?.notifications.queued },
        { label: 'محاولات التسليم', value: summary?.notifications.attempts },
        { label: 'إعادات المحاولة', value: summary?.notifications.retries },
        { label: 'وصول مؤكد', value: summary?.notifications.confirmed, detail: 'تأكيد إيجابي محفوظ من المزوّد' },
        { label: 'إخفاقات مزوّد النموذج', value: summary?.providerFailures.count },
      ],
    },
  ];

  const latencyRows = summary ? [
    { label: 'من الحدث إلى إنشاء العمل', metric: summary.latencyMs.triggerToWork },
    { label: 'مدة تنفيذ العمل', metric: summary.latencyMs.workRun },
    { label: 'من إدراج التنبيه إلى أول محاولة', metric: summary.latencyMs.notificationQueueToFirstAttempt },
    { label: 'من إدراج التنبيه إلى التأكيد', metric: summary.latencyMs.notificationQueueToConfirmation },
    { label: 'مدة محاولات المزوّد الفاشلة', metric: summary.latencyMs.providerFailure },
  ] : [];

  return (
    <main className="min-h-screen bg-background px-4 py-5 text-foreground sm:px-8 sm:py-8" dir="rtl">
      <div className="mx-auto max-w-6xl">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-5 flex flex-wrap items-center gap-5">
              <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground">
                <ArrowRight className="size-4" />
                العودة للسكرتير
              </Link>
              <Link href="/learning" className="text-xs font-semibold text-primary underline-offset-4 hover:underline">
                حلقة التعلم الآمنة
              </Link>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                <Activity className="size-6" />
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold tracking-wide text-primary">ملخص تشغيلي محفوظ</p>
                <h1 className="font-serif text-3xl leading-tight sm:text-4xl">صحة التشغيل</h1>
                <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">
                  أرقام مجمّعة من سجلّات هذا الحساب فقط. لا يتضمن التقرير نصوص المحادثات أو بيانات اعتماد المزوّدين.
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAnchorTime(Date.now())}
            disabled={summaryQuery.isFetching}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw className={`size-3.5 ${summaryQuery.isFetching ? 'animate-spin' : ''}`} />
            آخر 24 ساعة
          </button>
        </header>

        <div className="mb-5 text-xs text-muted-foreground">
          الفترة: {from.toLocaleString('ar-EG')} – {to.toLocaleString('ar-EG')}
          {summary && <> · آخر تحديث: {new Date(summary.generatedAt).toLocaleTimeString('ar-EG')}</>}
        </div>

        {summaryQuery.isError && (
          <div className="mb-5 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
            <div className="flex items-center gap-2 font-semibold">
              <CircleAlert className="size-4" />
              تعذر تحميل التقرير التشغيلي.
            </div>
            <button type="button" onClick={() => void summaryQuery.refetch()} className="mt-3 font-semibold underline underline-offset-4">
              حاول مرة أخرى
            </button>
          </div>
        )}

        {summaryQuery.isLoading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="جاري تحميل التقرير">
            {Array.from({ length: 10 }, (_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-2xl bg-muted/70" />
            ))}
          </div>
        )}

        {countGroups.map((group) => (
          <section key={group.title} className="mb-7">
            <h2 className="mb-3 text-lg font-semibold">{group.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {group.cards.map((card) => (
                <MetricCard key={card.label} {...card} />
              ))}
            </div>
          </section>
        ))}

        <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold">زمن المراحل</h2>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">
            المتوسط والحد الأعلى بالمللي ثانية؛ عدد العينات يوضح مقدار القياس المحفوظ.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[580px] text-right text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="py-3 font-medium">المرحلة</th>
                  <th className="py-3 font-medium">العينات</th>
                  <th className="py-3 font-medium">المتوسط</th>
                  <th className="py-3 font-medium">الأعلى</th>
                </tr>
              </thead>
              <tbody>
                {latencyRows.map(({ label, metric }) => (
                  <tr key={label} className="border-b border-border/60 last:border-0">
                    <th className="py-3 font-medium">{label}</th>
                    <td className="py-3 tabular-nums">{count(metric?.count)}</td>
                    <td className="py-3 tabular-nums">{latency(metric?.averageMs)}</td>
                    <td className="py-3 tabular-nums">{latency(metric?.maxMs)}</td>
                  </tr>
                ))}
                {latencyRows.length === 0 && !summaryQuery.isLoading && (
                  <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">لا توجد قياسات ضمن الفترة.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <p className="mt-5 text-[11px] leading-6 text-muted-foreground">
          «المعزولة نهائيًا» تعني أحداثًا نُقلت إلى الحجر، و«المتأخرة حاليًا» لقطة للحالة عند إنشاء التقرير.
          تأكيد التنبيه لا يعني دائمًا أن المستخدم شاهده؛ يُعرض فقط عند حفظ تأكيد إيجابي من مزوّد التسليم.
        </p>
      </div>
    </main>
  );
}