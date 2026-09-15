import { ReactNode } from 'react';
import { UseQueryResult } from '@tanstack/react-query';
import { CalendarClock, CircleAlert, Clock3, DollarSign, HandCoins, ListChecks, RefreshCw, Scale, Sparkles, UsersRound, Check, ArrowUp, ArrowDown, ArrowUpRight, ArrowUpLeft, AlertCircle } from 'lucide-react';
import type { TodayContextResponse, ErrorResponse, HealthStatus, FinancialListResponse } from '@workspace/api-client-react';

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amountMinor / 100);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ar-EG', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'اليوم';
  return new Intl.DateTimeFormat('ar-EG', { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
}

function getItems(data: unknown): Array<Record<string, unknown>> {
  if (!data || typeof data !== 'object') return [];
  const items = (data as { items?: unknown }).items;
  return Array.isArray(items) ? (items as Array<Record<string, unknown>>) : [];
}

function EmptyText({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground italic">{children}</p>;
}

export type DashboardProps = {
  todayQuery: UseQueryResult<TodayContextResponse, unknown>;
  healthQuery: UseQueryResult<HealthStatus, unknown>;
  obligationsQuery: UseQueryResult<FinancialListResponse, unknown>;
  paymentsQuery: UseQueryResult<FinancialListResponse, unknown>;
  receivablesQuery: UseQueryResult<FinancialListResponse, unknown>;
  donationsQuery: UseQueryResult<FinancialListResponse, unknown>;
  pendingApprovals: Array<{ operationId: string; title: string; toolName: string }>;
  onNavigate: (path: string) => void;
};

export default function SecretaryDashboard({
  todayQuery,
  healthQuery,
  obligationsQuery,
  paymentsQuery,
  receivablesQuery,
  donationsQuery,
  pendingApprovals,
  onNavigate,
}: DashboardProps) {
  const context = todayQuery.data?.context;
  const isError = todayQuery.isError;
  const isLoading = todayQuery.isLoading;

  const handleRetry = () => {
    void todayQuery.refetch();
    void obligationsQuery.refetch();
    void paymentsQuery.refetch();
    void receivablesQuery.refetch();
    void donationsQuery.refetch();
  };

  const obligations = getItems(obligationsQuery.data);
  const payments = getItems(paymentsQuery.data);
  const receivables = getItems(receivablesQuery.data);
  
  const formatTotal = (items: Array<Record<string, unknown>>, amountKey: string) => {
    const totals = new Map<string, number>();
    for (const item of items) {
      const currency = typeof item.currency === 'string' ? item.currency : 'EGP';
      const amount = typeof item[amountKey] === 'number' ? (item[amountKey] as number) : Number(item[amountKey] ?? 0);
      totals.set(currency, (totals.get(currency) ?? 0) + amount);
    }
    return [...totals.entries()].map(([currency, total]) => money(total, currency)).join('، ');
  };

  const obligationsTotal = formatTotal(obligations, 'principalAmountMinor');
  const receivablesTotal = formatTotal(receivables, 'amountMinor');
  const paymentsTotal = formatTotal(payments, 'amountMinor');

  // Counts for attention
  const attentionCount = pendingApprovals.length + (context?.pendingTasks.length ?? 0) + (context?.upcomingReminders.length ?? 0);

  return (
    <div className="flex h-full flex-col font-sans">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-accent/20 text-accent-foreground">
              <CalendarClock className="size-3.5" />
            </span>
            <h2 className="font-serif text-[22px] tracking-tight">موجز اليوم</h2>
          </div>
          <p className="mt-1 pl-9 text-xs text-muted-foreground">{context?.asOf ? formatDate(context.asOf) : 'جاري التحميل...'}</p>
        </div>
        <button
          type="button"
          onClick={handleRetry}
          disabled={todayQuery.isFetching}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          aria-label="تحديث الموجز"
        >
          <RefreshCw className={`size-4 ${todayQuery.isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {isError && (
        <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-destructive">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CircleAlert className="size-4" /> الموجز غير متاح
          </div>
          <p className="mt-2 text-xs leading-relaxed opacity-90">تعذر تحميل بياناتك. قد تكون هناك مشكلة في الاتصال.</p>
          <button type="button" onClick={handleRetry} className="mt-3 text-xs font-semibold underline underline-offset-4">حاول مرة أخرى</button>
        </div>
      )}

      {isLoading && (
        <div className="space-y-8">
          <div className="h-28 animate-pulse rounded-xl bg-card/60 border border-border/70" />
          <div className="h-40 animate-pulse rounded-xl bg-card/60 border border-border/70" />
          <div className="h-32 animate-pulse rounded-xl bg-card/60 border border-border/70" />
        </div>
      )}

      {!isLoading && !isError && context && (
        <div className="scrollbar-thin flex-1 space-y-9 overflow-y-auto pb-6 pr-2">
          
          {/* ATTENTION SECTION */}
          <section>
            <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-2 text-foreground">
              <h3 className="font-serif text-lg tracking-tight">بانتظار الإجراء</h3>
              {attentionCount > 0 && (
                <span className="flex size-5 items-center justify-center rounded-full bg-destructive/10 text-[10px] font-bold text-destructive">
                  {attentionCount}
                </span>
              )}
            </div>

            <div className="space-y-2">
              {attentionCount === 0 ? (
                <EmptyText>لا توجد مهام عاجلة أو موافقات معلقة.</EmptyText>
              ) : (
                <>
                  {pendingApprovals.map(approval => (
                    <button 
                      key={approval.operationId}
                      onClick={() => {
                        const el = document.querySelector(`[data-testid="approval-${approval.operationId}"]`);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                      className="group flex w-full items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-right transition-colors hover:bg-destructive/10"
                    >
                      <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-destructive">{approval.title}</p>
                        <p className="mt-0.5 text-[11px] text-destructive/80">الموافقة مطلوبة لتنفيذ العملية</p>
                      </div>
                    </button>
                  ))}
                  
                  {context.upcomingReminders.slice(0, 3).map(reminder => (
                    <button 
                      key={reminder.id}
                      onClick={() => onNavigate(`/records?tab=reminders&recordId=${reminder.id}`)}
                      className="group flex w-full items-start gap-3 rounded-lg border border-border/50 bg-card p-3 text-right transition-colors hover:border-primary/30 hover:bg-primary/5"
                    >
                      <Clock3 className="mt-0.5 size-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground group-hover:text-primary">{reminder.text}</p>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground">{formatTime(reminder.dueAt)}</p>
                      </div>
                    </button>
                  ))}

                  {context.pendingTasks.slice(0, 3).map(task => (
                    <button 
                      key={task.id}
                      onClick={() => onNavigate(`/records?tab=tasks&recordId=${task.id}`)}
                      className="group flex w-full items-start gap-3 rounded-lg border border-border/50 bg-card p-3 text-right transition-colors hover:border-primary/30 hover:bg-primary/5"
                    >
                      <ListChecks className="mt-0.5 size-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground group-hover:text-primary">{task.title}</p>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground">{task.dueAt ? formatTime(task.dueAt) : 'مهمة مستمرة'}</p>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          </section>

          {/* FINANCIAL SECTION */}
          <section>
            <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-2 text-foreground">
              <h3 className="font-serif text-lg tracking-tight">النبض المالي</h3>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 rounded-xl border border-border/60 bg-card/60 p-3">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">التزامات</span>
                <span className="font-mono text-base font-semibold text-destructive">{obligationsTotal || '0 ج.م'}</span>
              </div>
              <div className="flex flex-col gap-1 rounded-xl border border-border/60 bg-card/60 p-3">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">دخل متوقع</span>
                <span className="font-mono text-base font-semibold text-chart-3">{receivablesTotal || '0 ج.م'}</span>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {context.recentExpenses.length > 0 ? (
                context.recentExpenses.slice(0, 4).map(expense => (
                  <button 
                    key={expense.id}
                    onClick={() => onNavigate(`/records?tab=expenses&recordId=${expense.id}`)}
                    className="flex w-full items-center justify-between gap-3 border-r-2 border-transparent pr-2 text-right transition-colors hover:border-primary hover:bg-muted/50 p-2 rounded-l-lg"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{expense.description}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{expense.projectName ?? expense.personName ?? formatTime(expense.occurredAt)}</p>
                    </div>
                    <span className="shrink-0 font-mono text-xs font-medium text-foreground">{money(expense.amountMinor, expense.currency)}</span>
                  </button>
                ))
              ) : (
                <EmptyText>لا توجد تحركات مالية مسجلة مؤخراً.</EmptyText>
              )}
            </div>
          </section>

          {/* CONTEXT SECTION */}
          <section>
            <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-2 text-foreground">
              <h3 className="font-serif text-lg tracking-tight">السياق النشط</h3>
            </div>

            <div className="space-y-5">
              <div>
                <p className="mb-2 text-[11px] font-semibold text-muted-foreground">أشخاص مهمون</p>
                {context.relevantPeople.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {context.relevantPeople.slice(0, 5).map(person => (
                      <button
                        key={person.id}
                        onClick={() => onNavigate(`/people/${person.id}`)}
                        className="flex items-center gap-1.5 rounded-full border border-border/80 bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                      >
                        {person.name}
                        <ArrowUpLeft className="size-3 opacity-50" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyText>لا يوجد أشخاص نشطين حالياً.</EmptyText>
                )}
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold text-muted-foreground">مشاريع مفتوحة</p>
                {context.activeProjects.length > 0 ? (
                  <div className="space-y-1.5">
                    {context.activeProjects.slice(0, 4).map(project => (
                      <button
                        key={project.id}
                        onClick={() => onNavigate(`/projects/${project.id}`)}
                        className="flex w-full items-center justify-between rounded-lg border border-border/40 bg-card/40 px-3 py-2 text-right transition-colors hover:bg-primary/5 hover:text-primary"
                      >
                        <span className="text-sm">{project.name}</span>
                        <ArrowUpLeft className="size-3 opacity-50" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyText>لا توجد مشاريع مفتوحة.</EmptyText>
                )}
              </div>
            </div>
          </section>

        </div>
      )}
    </div>
  );
}
