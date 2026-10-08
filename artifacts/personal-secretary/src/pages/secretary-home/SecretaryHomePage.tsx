import {
  AlertCircle,
  ArrowLeft,
  ArrowUpLeft,
  CalendarDays,
  Check,
  Clock3,
  Coins,
  ListChecks,
  MessageCircle,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import {
  getGetTodayContextQueryKey,
  getListAgentWorksQueryKey,
  getListPendingSecretaryApprovalsQueryKey,
  useGetTodayContext,
  useListAgentWorks,
  useListPendingSecretaryApprovals,
} from '@workspace/api-client-react';
import { Link } from 'wouter';
import { buildSecretaryHomeModel } from '@/lib/secretary-home-model';

const statusLabels: Record<string, string> = {
  draft: 'مسودة',
  active: 'قيد المتابعة',
  paused: 'متوقف مؤقتًا',
  waiting: 'ينتظر',
  needs_review: 'يحتاج مراجعتك',
  failed: 'تعذّر إكماله',
  uncertain: 'النتيجة غير مؤكدة',
  unknown: 'النتيجة غير معروفة',
  unknown_result: 'النتيجة غير مؤكدة',
  pending: 'معلّق',
  in_progress: 'جارٍ العمل',
  queued: 'في قائمة الانتظار',
  claimed: 'جارٍ التحضير',
  running: 'جارٍ التنفيذ',
  verifying: 'جارٍ التحقق',
  verified: 'تم التحقق',
  unchanged: 'لم يتغير',
  completed: 'اكتمل',
  cancelled: 'أُلغي',
  rejected: 'تم الرفض',
  expired: 'انتهت صلاحية الموافقة',
};

function dateTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ar-EG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function money(amountMinor: number, currency: string) {
  try {
    return new Intl.NumberFormat('ar-EG', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toLocaleString('ar-EG')} ${currency}`;
  }
}

function recordPath(item: { id: string; type: 'task' | 'reminder' }) {
  const params = new URLSearchParams({
    tab: item.type === 'task' ? 'tasks' : 'reminders',
    recordId: item.id,
  });
  return `/records?${params.toString()}`;
}

function expensePath(id: string) {
  const params = new URLSearchParams({ tab: 'expenses', recordId: id });
  return `/records?${params.toString()}`;
}

function workPath(id: string | undefined) {
  return id ? `/works/${encodeURIComponent(id)}` : '/works';
}

function SectionHeading({
  icon: Icon,
  title,
  note,
}: {
  icon: typeof CalendarDays;
  title: string;
  note?: string;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-serif text-lg font-semibold tracking-tight">{title}</h2>
          {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
        </div>
      </div>
    </div>
  );
}

function QuerySkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-[1.5rem] border border-border/70 bg-card/70 p-5 ${className}`}>
      <div className="h-4 w-28 rounded-full bg-muted" />
      <div className="mt-5 h-4 w-3/4 rounded-full bg-muted/80" />
      <div className="mt-3 h-3 w-1/2 rounded-full bg-muted/70" />
    </div>
  );
}

export default function SecretaryHomePage() {
  const todayQuery = useGetTodayContext({
    query: { queryKey: getGetTodayContextQueryKey(), staleTime: 30000 },
  });
  const worksQuery = useListAgentWorks(undefined, {
    query: { queryKey: getListAgentWorksQueryKey(), staleTime: 15000 },
  });
  const approvalsQuery = useListPendingSecretaryApprovals({
    query: { queryKey: getListPendingSecretaryApprovalsQueryKey(), staleTime: 10000 },
  });

  const context = todayQuery.data?.context;
  const model = buildSecretaryHomeModel({
    asOf: context?.asOf,
    tasks: context?.pendingTasks ?? [],
    reminders: context?.upcomingReminders ?? [],
    works: worksQuery.data?.works ?? [],
    approvals: approvalsQuery.data?.approvals ?? [],
    expenses: context?.recentExpenses ?? [],
  });
  const attentionCount = model.attention.length;

  const isInitialLoading =
    (todayQuery.isLoading && !todayQuery.data) ||
    (worksQuery.isLoading && !worksQuery.data) ||
    (approvalsQuery.isLoading && !approvalsQuery.data);
  const failedQueries = [
    todayQuery.isError ? 'موجز اليوم' : null,
    worksQuery.isError ? 'الأعمال' : null,
    approvalsQuery.isError ? 'الموافقات' : null,
  ].filter(Boolean);
  const allFailed = failedQueries.length === 3 && !context && !worksQuery.data && !approvalsQuery.data;
  const retryAll = () => {
    void todayQuery.refetch();
    void worksQuery.refetch();
    void approvalsQuery.refetch();
  };

  return (
    <div dir="rtl" lang="ar" className="grain min-h-[100dvh] bg-background text-foreground">
      <main className="mx-auto min-h-[100dvh] max-w-6xl px-4 pb-14 pt-5 sm:px-7 sm:pt-8 lg:px-10">
        <header className="border-b border-border/70 pb-6 sm:pb-8">
          <nav aria-label="التنقل الرئيسي" className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold tracking-tight text-foreground">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Check className="size-4" />
              </span>
              سكرتيري الشخصي
            </Link>
            <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-border/70 bg-card/70 p-1">
              <Link href="/ask" data-testid="link-ask" className="inline-flex min-h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <MessageCircle className="size-4" /> اسألني
              </Link>
              <Link href="/works" data-testid="link-works" className="inline-flex min-h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Workflow className="size-4" /> المتابعات
              </Link>
              <Link href="/records" data-testid="link-records" className="inline-flex min-h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <ListChecks className="size-4" /> السجلات
              </Link>
            </div>
          </nav>

        <div className="mt-9 flex flex-col justify-between gap-5 sm:mt-12 sm:flex-row sm:items-end">
            <div className="max-w-2xl">
              <p className="inline-flex items-center gap-2 text-xs font-semibold text-primary">
                <span className="size-1.5 rounded-full bg-chart-3" />
                مساحة هادئة للمتابعة
              </p>
              <h1 className="mt-3 font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
                صباحك أوضح،
                <span className="text-primary"> وخطوتك التالية أقرب.</span>
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
                ما يحتاج انتباهك، ما يتابعه المساعد، وما تم تسجيله — كلٌ في مكانه.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
              <Link href="/ask?entry=follow" data-testid="link-start-work-follow-up" className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs font-semibold text-primary transition-colors hover:border-primary/40 hover:bg-primary/10">
                <Workflow className="size-4" />
                اجعل السكرتير يتابع
              </Link>
              <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                <CalendarDays className="size-4 text-primary" />
                <div>
                  <p className="text-[11px] text-muted-foreground">آخر تحديث للموجز</p>
                  <p className="mt-0.5 text-xs font-semibold" data-testid="text-context-asof">
                    {context?.asOf ? dateTime(context.asOf) : 'بانتظار بيانات اليوم'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {failedQueries.length > 0 && !allFailed && (
          <div role="status" data-testid="status-partial-data" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
            <p className="text-foreground">
              بعض البيانات غير متاحة الآن: {failedQueries.join('، ')}. المعروض هنا هو ما وصل فقط.
            </p>
            <button type="button" onClick={retryAll} className="inline-flex min-h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-primary hover:bg-primary/10">
              <RotateCw className="size-3.5" /> إعادة المحاولة
            </button>
          </div>
        )}

        {isInitialLoading && !allFailed && (
          <div className="mt-7 grid gap-4 md:grid-cols-2" aria-label="جارٍ تحميل البيانات">
            <QuerySkeleton className="min-h-40" />
            <QuerySkeleton className="min-h-40" />
            <QuerySkeleton className="min-h-40 md:col-span-2" />
          </div>
        )}

        {allFailed && (
          <div role="alert" className="mt-8 rounded-[1.75rem] border border-destructive/25 bg-destructive/5 p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                <AlertCircle className="size-5" />
              </span>
              <div>
                <h2 className="font-serif text-xl font-semibold">تعذر تحميل مساحة المتابعة</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">لم تصل بيانات اليوم أو الأعمال أو الموافقات. يمكنك المحاولة مرة أخرى.</p>
                <button type="button" onClick={retryAll} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
                  <RefreshCw className="size-4" /> حاول مرة أخرى
                </button>
              </div>
            </div>
          </div>
        )}

        {!isInitialLoading && !allFailed && (
          <div className="mt-7 space-y-10 sm:mt-9 sm:space-y-12">
            {model.attention.length > 0 && (
              <section aria-labelledby="attention-title" data-testid="section-attention">
                <div className="mb-4 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold tracking-wide text-destructive">يحتاج انتباهك</p>
                    <h2 id="attention-title" className="mt-1 font-serif text-xl font-semibold">محتاج منك الآن</h2>
                  </div>
                  <span className="flex size-8 items-center justify-center rounded-full bg-destructive/10 text-sm font-bold text-destructive" data-testid="text-attention-count">
                    {attentionCount.toLocaleString('ar-EG')}
                  </span>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {model.attention.map((item) => {
                    if (item.kind === 'approval') {
                      const approval = item.approval;
                      const params = new URLSearchParams({ operationId: approval.operationId });
                      return (
                        <Link
                          key={item.key}
                          href={`/ask?${params.toString()}`}
                          data-testid={`card-approval-${approval.operationId}`}
                          className="group flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/[0.045] p-4 transition-colors hover:border-destructive/40 hover:bg-destructive/[0.08]"
                        >
                          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-destructive" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">{item.title}</p>
                            {approval.display.details.length > 0 && (
                              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{approval.display.details.join(' · ')}</p>
                            )}
                            <p className="mt-2 text-[11px] text-destructive">{item.reason} · {dateTime(approval.updatedAt)}</p>
                          </div>
                          <ArrowUpLeft className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5" />
                        </Link>
                      );
                    }
                    if (item.kind === 'task') {
                      return (
                        <Link
                          key={item.key}
                          href={recordPath({ id: item.task.id, type: 'task' })}
                          data-testid={`card-overdue-task-${item.task.id}`}
                          className="group flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/[0.045] p-4 transition-colors hover:border-destructive/40"
                        >
                          <Clock3 className="mt-0.5 size-5 shrink-0 text-destructive" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">{item.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{item.reason} · {dateTime(item.task.dueAt)}</p>
                          </div>
                          <ArrowUpLeft className="mt-1 size-4 shrink-0 text-muted-foreground" />
                        </Link>
                      );
                    }
                    return (
                      <Link
                        key={item.key}
                        href={workPath(item.work.id)}
                        data-testid={`card-attention-work-${item.work.id}`}
                        className="group flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/[0.045] p-4 transition-colors hover:border-destructive/40"
                      >
                        <Workflow className="mt-0.5 size-5 shrink-0 text-destructive" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{item.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.reason}
                            {item.work.lastRunAt ? ` · آخر تشغيل ${dateTime(item.work.lastRunAt)}` : ''}
                          </p>
                        </div>
                        <ArrowUpLeft className="mt-1 size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            {worksQuery.isError && !worksQuery.data && (
              <div role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-sm">
                <p className="font-semibold">تعذر تحميل الأعمال التي يتابعها المساعد.</p>
                <button type="button" onClick={() => void worksQuery.refetch()} className="mt-2 text-xs font-semibold text-destructive underline underline-offset-4">أعد المحاولة</button>
              </div>
            )}

            {model.watching.length > 0 && (
              <section aria-labelledby="works-title" data-testid="section-tracked-works">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <SectionHeading icon={Workflow} title="السكرتير بيتابع" note="الحالة وآخر تشغيل والموعد القادم عند توفرها" />
                  <Link href="/works" data-testid="link-all-works" className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
                    إدارة المتابعات <ArrowLeft className="size-3.5" />
                  </Link>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {model.watching.map((work, index) => (
                    <Link
                      key={work.id}
                      href={workPath(work.id)}
                      data-testid={`card-tracked-work-${index}`}
                      className="rounded-[1.4rem] border border-border/70 bg-card/65 p-4 transition-colors hover:border-primary/30 hover:bg-card"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{work.title ?? 'عمل يتابعه المساعد'}</p>
                          {work.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{work.description}</p>}
                        </div>
                        <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                          {statusLabels[work.status ?? ''] ?? work.status ?? 'الحالة غير متاحة'}
                        </span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                        {work.lastRunAt && <span>آخر تشغيل: {dateTime(work.lastRunAt)}</span>}
                        {work.lastRunStatus && <span>نتيجتها: {statusLabels[work.lastRunStatus] ?? work.lastRunStatus}</span>}
                        {work.nextRunAt && <span>الموعد القادم: {dateTime(work.nextRunAt)}</span>}
                        {!work.lastRunAt && !work.lastRunStatus && !work.nextRunAt && <span>لا توجد مواعيد متابعة مسجلة بعد.</span>}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {todayQuery.isError && !context && (
              <div role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5">
                <p className="text-sm font-semibold">تعذر تحميل موجز اليوم.</p>
                <button type="button" onClick={() => void todayQuery.refetch()} className="mt-2 text-xs font-semibold text-destructive underline underline-offset-4">أعد المحاولة</button>
              </div>
            )}

            {model.today.length > 0 && (
              <section aria-labelledby="today-title" data-testid="section-today">
                <SectionHeading icon={CalendarDays} title="اليوم" note="المهام والتذكيرات حسب موعدها" />
                <div className="overflow-hidden rounded-[1.6rem] border border-border/70 bg-card/65">
                  {model.today.map((item, index) => (
                    <Link
                      key={item.id}
                      href={recordPath(item)}
                      data-testid={`row-today-${item.type}-${item.id}`}
                      className={`group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-primary/[0.04] sm:px-5 ${index ? 'border-t border-border/60' : ''}`}
                    >
                      <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${item.type === 'task' ? 'bg-primary/10 text-primary' : 'bg-accent/20 text-accent-foreground'}`}>
                        {item.type === 'task' ? <ListChecks className="size-4" /> : <Clock3 className="size-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{item.title}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {item.dueAt ? dateTime(item.dueAt) : 'مهمة مفتوحة بلا موعد'}
                          {item.type === 'task' && item.status ? ` · ${statusLabels[item.status] ?? item.status}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
                        {item.type === 'task' ? 'مهمة' : 'تذكير'}
                      </span>
                      <ArrowUpLeft className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:-translate-x-0.5 group-hover:text-primary" />
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {model.upcoming.length > 0 && (
              <section aria-labelledby="later-title" data-testid="section-upcoming">
                <SectionHeading icon={Clock3} title="قريبًا" note="مواعيد في أيام قادمة" />
                <div className="grid gap-3 md:grid-cols-2">
                  {model.upcoming.map((item) => (
                    <Link
                      key={`${item.type}-${item.id}`}
                      href={recordPath(item)}
                      data-testid={`card-later-${item.type}-${item.id}`}
                      className="group flex items-center gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 transition-colors hover:border-primary/30 hover:bg-card"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        {item.type === 'task' ? <ListChecks className="size-4" /> : <Clock3 className="size-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{item.title}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{dateTime(item.dueAt)}</span>
                      </span>
                      <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
                        {item.type === 'task' ? 'مهمة' : 'تذكير'}
                      </span>
                      <ArrowUpLeft className="size-4 text-muted-foreground/60 group-hover:text-primary" />
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {model.recorded.length > 0 && (
              <section aria-labelledby="records-title" data-testid="section-recorded-items">
                <div className="mb-4 flex items-end justify-between gap-3">
                  <SectionHeading icon={Coins} title="آخر ما سُجّل" note="مصروفات محفوظة مؤخرًا؛ ليست سجلًا كاملًا للأنشطة" />
                  <Link href="/records" data-testid="link-view-records" className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
                    فتح السجلات <ArrowLeft className="size-3.5" />
                  </Link>
                </div>
                <div className="overflow-hidden rounded-[1.6rem] border border-border/70 bg-card/65">
                    {model.recorded.map((expense, index) => (
                      <Link
                        key={expense.id}
                        href={expensePath(expense.id)}
                        data-testid={`row-recorded-expense-${expense.id}`}
                        className={`flex items-center gap-4 px-4 py-4 transition-colors hover:bg-primary/[0.04] sm:px-5 ${index ? 'border-t border-border/60' : ''}`}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/20 text-accent-foreground">
                          <Coins className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{expense.description}</span>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {[expense.projectName, expense.personName, dateTime(expense.occurredAt)].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">{money(expense.amountMinor, expense.currency)}</span>
                      </Link>
                    ))}
                </div>
              </section>
            )}

            {context && model.today.length === 0 && model.upcoming.length === 0 && attentionCount === 0 && model.watching.length === 0 && model.recorded.length === 0 && (
              <div className="rounded-[1.75rem] border border-dashed border-border bg-card/35 px-5 py-10 text-center">
                <Check className="mx-auto size-8 text-chart-3" />
                <h2 className="mt-4 font-serif text-xl font-semibold">لا يوجد ما يحتاج متابعة الآن</h2>
                <p className="mt-2 text-sm text-muted-foreground">عندما تصل مهام أو مواعيد أو أعمال مسجلة، ستظهر هنا.</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
