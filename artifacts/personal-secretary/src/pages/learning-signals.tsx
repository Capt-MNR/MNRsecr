import {
  ArrowRight,
  BrainCircuit,
  CircleAlert,
  Clock3,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import {
  getListLearningSignalsQueryKey,
  useReviewLearningSignal,
  useListLearningSignals,
} from '@workspace/api-client-react';
import type { LearningSignal } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

const categoryLabels: Record<LearningSignal['category'], string> = {
  amount: 'مبلغ',
  date_time: 'موعد أو وقت',
  person: 'شخص',
  project: 'مشروع',
  intent: 'نية الطلب',
  general: 'تصحيح عام',
};

function formatSignalTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

const statusLabels: Record<LearningSignal['status'], string> = {
  pending_review: 'معلّقة للمراجعة',
  approved: 'معتمدة كـ benchmark',
  rejected: 'مرفوضة',
  needs_context: 'تحتاج سياقًا إضافيًا',
};

const statusClasses: Record<LearningSignal['status'], string> = {
  pending_review: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  approved: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  rejected: 'border-destructive/25 bg-destructive/10 text-destructive',
  needs_context: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300',
};

function SignalCard({
  signal,
  onReview,
  isBusy,
}: {
  signal: LearningSignal;
  onReview: (status: 'approved' | 'rejected' | 'needs_context') => void;
  isBusy: boolean;
}) {
  return (
    <article className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
              {categoryLabels[signal.category]}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClasses[signal.status]}`}>
              {statusLabels[signal.status]}
            </span>
          </div>
          <h2 className="text-base font-semibold text-foreground">{signal.conversationTitle}</h2>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock3 className="size-3.5" />
          <time dateTime={signal.createdAt}>{formatSignalTime(signal.createdAt)}</time>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {signal.previousUserMessage && (
          <div className="rounded-2xl border border-border/60 bg-muted/35 p-4">
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground">الطلب السابق</p>
            <p className="text-sm leading-7 text-foreground">{signal.previousUserMessage}</p>
            {signal.previousActionType && (
              <p className="mt-2 text-[11px] text-muted-foreground">العملية: {signal.previousActionType}</p>
            )}
          </div>
        )}
        <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-4">
          <p className="mb-2 text-[11px] font-semibold tracking-wide text-primary">التصحيح الملتقط</p>
          <p className="text-sm font-medium leading-7 text-foreground">{signal.userMessage}</p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            درجة الالتقاط: {Math.round(signal.confidence * 100)}%
          </p>
        </div>
      </div>

      {signal.previousAssistantMessage && (
        <details className="mt-4 rounded-2xl border border-border/60 px-4 py-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
            عرض رد السكرتير السابق
          </summary>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">{signal.previousAssistantMessage}</p>
        </details>
      )}

      <div className="mt-5 flex items-start gap-2 rounded-2xl bg-muted/45 px-4 py-3 text-xs leading-6 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>هذه الإشارة للمراجعة والتقييم فقط. لا تغيّر أي سجل ولا تُعدّل قواعد السكرتير تلقائيًا.</p>
      </div>

      {signal.status !== 'approved' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onReview('approved')}
            disabled={isBusy}
            className="min-h-10 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            اعتماد كـ benchmark
          </button>
          <button
            type="button"
            onClick={() => onReview('needs_context')}
            disabled={isBusy}
            className="min-h-10 rounded-xl border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-500/10 dark:text-sky-300 disabled:cursor-wait disabled:opacity-60"
          >
            أحتاج سياقًا
          </button>
          <button
            type="button"
            onClick={() => onReview('rejected')}
            disabled={isBusy}
            className="min-h-10 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted disabled:cursor-wait disabled:opacity-60"
          >
            رفض الإشارة
          </button>
        </div>
      )}
    </article>
  );
}

export default function LearningSignals() {
  const queryClient = useQueryClient();
  const signalsQuery = useListLearningSignals({
    query: {
      queryKey: getListLearningSignalsQueryKey(),
      staleTime: 10_000,
    },
  });
  const reviewMutation = useReviewLearningSignal();
  const [activeSignalId, setActiveSignalId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  async function reviewSignal(
    signalId: string,
    status: 'approved' | 'rejected' | 'needs_context',
  ) {
    setActiveSignalId(signalId);
    setReviewError(null);
    try {
      await reviewMutation.mutateAsync({ signalId, data: { status } });
      await queryClient.invalidateQueries({ queryKey: getListLearningSignalsQueryKey() });
    } catch {
      setReviewError('تعذر حفظ قرار المراجعة. حاول مرة أخرى.');
    } finally {
      setActiveSignalId(null);
    }
  }

  const pendingCount = signalsQuery.data?.signals.filter(
    (signal) => signal.status === 'pending_review' || signal.status === 'needs_context',
  ).length ?? 0;

  return (
    <main className="min-h-screen bg-background px-4 py-5 text-foreground sm:px-8 sm:py-8" dir="rtl">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/" className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground">
              <ArrowRight className="size-4" />
              العودة للسكرتير
            </Link>
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                <BrainCircuit className="size-6" />
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold tracking-wide text-primary">حلقة التعلم الآمنة</p>
                <h1 className="font-serif text-3xl leading-tight sm:text-4xl">مراجعة تصحيحات المستخدم</h1>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                  أمثلة التقطها السكرتير من المحادثات لتقييم فهمه. لا يتم اعتمادها أو استخدامها لتغيير البيانات تلقائيًا.
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signalsQuery.refetch()}
            disabled={signalsQuery.isFetching}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw className={`size-3.5 ${signalsQuery.isFetching ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </header>

        {signalsQuery.isLoading && (
          <div className="space-y-4" aria-label="جاري تحميل إشارات التصحيح">
            {[1, 2].map((item) => <div key={item} className="h-64 animate-pulse rounded-3xl bg-muted/70" />)}
          </div>
        )}

        {signalsQuery.isError && (
          <div className="rounded-3xl border border-destructive/25 bg-destructive/5 p-5 text-sm text-destructive" role="alert">
            <div className="flex items-center gap-2 font-semibold"><CircleAlert className="size-4" /> تعذر تحميل إشارات التصحيح.</div>
            <button type="button" onClick={() => void signalsQuery.refetch()} className="mt-3 font-semibold underline underline-offset-4">
              حاول مرة أخرى
            </button>
          </div>
        )}

        {reviewError && (
          <div className="mb-4 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
            {reviewError}
          </div>
        )}

        {!signalsQuery.isLoading && !signalsQuery.isError && signalsQuery.data?.signals.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border bg-card/60 px-6 py-14 text-center">
            <BrainCircuit className="mx-auto size-8 text-muted-foreground/60" />
            <h2 className="mt-4 text-base font-semibold">لا توجد تصحيحات معلّقة</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-muted-foreground">
              عندما يصحح المستخدم مبلغًا أو موعدًا أو شخصًا في سياق محادثة، ستظهر الإشارة هنا للمراجعة.
            </p>
          </div>
        )}

        {!signalsQuery.isLoading && !signalsQuery.isError && (signalsQuery.data?.signals.length ?? 0) > 0 && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {pendingCount} إشارة تحتاج قرارًا · {signalsQuery.data?.signals.length} إجمالي الإشارات
            </p>
            {signalsQuery.data?.signals.map((signal) => (
              <SignalCard
                key={signal.signalId}
                signal={signal}
                isBusy={activeSignalId === signal.signalId}
                onReview={(status) => void reviewSignal(signal.signalId, status)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}