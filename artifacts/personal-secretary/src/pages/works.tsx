import { useMemo, useState } from 'react';
import { Activity, ArrowLeft, CheckCircle2, Clock3, Pause, Play, Plus, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { Link, useLocation, useRoute } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  AgentWorkKind,
  getGetAgentWorkQueryKey,
  getGetSecretaryOperationQueryKey,
  getListAgentWorksQueryKey,
  useChangeAgentWorkStatus,
  useCreateAgentWork,
  useGetAgentWork,
  useGetSecretaryOperation,
  useApproveSecretaryOperation,
  useRejectSecretaryOperation,
  useListAgentWorks,
} from '@workspace/api-client-react';
import ApprovalForm from '../components/approval-form';

const kindLabels: Record<AgentWorkKind, string> = {
  monitor: 'متابعة',
  reminder: 'تذكير',
  recurring_task: 'عمل متكرر',
  external_action: 'إجراء خارجي',
  research: 'بحث',
  workflow: 'سير عمل',
};

const statusLabels: Record<string, string> = {
  draft: 'مسودة',
  active: 'يعمل',
  paused: 'متوقف مؤقتًا',
  waiting: 'ينتظر',
  needs_review: 'يحتاج مراجعتك',
  completed: 'اكتمل',
  failed: 'تعذر إكماله',
  cancelled: 'ملغى',
};

function formatDate(value: string | null | undefined) {
  if (!value) return 'لم يبدأ بعد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'غير متاح';
  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function conditionLabel(condition: Record<string, unknown>) {
  if (condition.entity === 'tasks' && condition.metric === 'open_task_count' && typeof condition.threshold === 'number') {
    const operator = condition.operator === 'gte' ? 'أكبر من أو يساوي'
      : condition.operator === 'eq' ? 'يساوي' : 'أكبر من';
    return `عدد المهام المفتوحة ${operator} ${condition.threshold}`;
  }
  if (
    condition.provider === 'github'
    && condition.entity === 'repository'
    && condition.metric === 'open_issues_count'
    && typeof condition.owner === 'string'
    && typeof condition.repository === 'string'
    && typeof condition.threshold === 'number'
  ) {
    const operator = condition.operator === 'gte' ? 'أكبر من أو يساوي'
      : condition.operator === 'eq' ? 'يساوي'
        : 'أكبر من';
    return `العناصر المفتوحة في GitHub ${condition.owner}/${condition.repository} ${operator} ${condition.threshold} (حسب GitHub API)`;
  }
  if (typeof condition.request === 'string') return condition.request;
  return 'شرط متابعة يحتاج مراجعة.';
}

function evidenceLabel(snapshot: Record<string, unknown>) {
  const value = typeof snapshot.value === 'number' ? `القيمة الحالية: ${snapshot.value}` : 'تم الفحص بدون قيمة قابلة للعرض.';
  const checkedAt = typeof snapshot.checkedAt === 'string' ? `تم التحقق ${formatDate(snapshot.checkedAt)}` : '';
  const source = typeof snapshot.repository === 'string' ? `المصدر: GitHub/${snapshot.repository}` : '';
  const reason = typeof snapshot.reason === 'string' && snapshot.reason === 'github_api_read_verified'
    ? 'تم التحقق من المصدر الرسمي'
    : '';
  return [source, value, reason, checkedAt].filter(Boolean).join(' — ');
}

function statusStyle(status: string) {
  if (status === 'active') return 'bg-chart-3/10 text-chart-3';
  if (status === 'paused' || status === 'waiting') return 'bg-accent/15 text-accent-foreground';
  if (status === 'failed' || status === 'needs_review') return 'bg-destructive/10 text-destructive';
  return 'bg-muted text-muted-foreground';
}

function WorkCard({ work, selected }: { work: any; selected: boolean }) {
  return (
    <Link
      href={`/works/${work.id}`}
      className={`block rounded-2xl border p-4 transition-colors ${selected ? 'border-primary/50 bg-primary/5' : 'border-border/70 bg-card/65 hover:border-primary/30 hover:bg-card'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{work.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{kindLabels[work.kind as AgentWorkKind]}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusStyle(work.status)}`}>
          {statusLabels[work.status] ?? work.status}
        </span>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        {work.lastRunAt ? `آخر متابعة ${formatDate(work.lastRunAt)}` : 'لم تتم متابعة هذا العمل بعد'}
      </p>
    </Link>
  );
}

function WorkDetail({ workId }: { workId: string }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const detailQuery = useGetAgentWork(workId, {
    query: { queryKey: getGetAgentWorkQueryKey(workId), staleTime: 5_000 },
  });
  const approvalOperationId = useMemo(() => {
    const event = detailQuery.data?.events.find((item) => item.eventType === 'approval_requested');
    const metadata = event?.metadata;
    return metadata && typeof metadata.operationId === 'string' ? metadata.operationId : null;
  }, [detailQuery.data?.events]);
  const operationQuery = useGetSecretaryOperation(approvalOperationId ?? '', {
    query: {
      queryKey: approvalOperationId
        ? getGetSecretaryOperationQueryKey(approvalOperationId)
        : ['/api/approvals/disabled'],
      enabled: Boolean(approvalOperationId),
      staleTime: 2_000,
      refetchInterval: approvalOperationId ? 5_000 : false,
    },
  });
  const approveMutation = useApproveSecretaryOperation({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetAgentWorkQueryKey(workId) });
        if (approvalOperationId) void queryClient.invalidateQueries({ queryKey: getGetSecretaryOperationQueryKey(approvalOperationId) });
      },
    },
  });
  const rejectMutation = useRejectSecretaryOperation({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetAgentWorkQueryKey(workId) });
        if (approvalOperationId) void queryClient.invalidateQueries({ queryKey: getGetSecretaryOperationQueryKey(approvalOperationId) });
      },
    },
  });
  const statusMutation = useChangeAgentWorkStatus({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListAgentWorksQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetAgentWorkQueryKey(workId) });
      },
    },
  });
  const work = detailQuery.data?.work;

  if (detailQuery.isLoading) {
    return <div className="rounded-2xl border border-border/70 bg-card/65 p-6 text-sm text-muted-foreground">أحمل تفاصيل العمل...</div>;
  }
  if (detailQuery.isError || !work) {
    return (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-sm text-destructive">
        <p>تعذر تحميل هذا العمل.</p>
        <button type="button" onClick={() => void detailQuery.refetch()} className="mt-3 font-semibold underline underline-offset-4">حاول مرة أخرى</button>
      </div>
    );
  }

  const workStatus = work.status ?? 'draft';
  const workKind = work.kind ?? 'monitor';
  const workTitle = work.title ?? 'عمل الوكيل';
  const nextStatus = workStatus === 'draft' ? 'active'
    : workStatus === 'active' ? 'paused'
      : workStatus === 'paused' ? 'active'
        : null;
  const currentStatus = workStatus;
  const operation = operationQuery.data;
  const approvalVisible = Boolean(
    operation
    && approvalOperationId
    && (operation.status === 'pending' || operation.status === 'executing'),
  );
  const approvalOutcome = operation?.status === 'expired'
    ? 'انتهت صلاحية الموافقة، لذلك لم تُنشأ المهمة. ستستمر المتابعة، ولن أطلب موافقة جديدة إلا بعد تحقق الشرط مرة أخرى.'
    : operation?.status === 'rejected'
      ? 'تم رفض الموافقة، لذلك لم تُنشأ المهمة.'
      : operation?.status === 'failed'
        ? 'تعذر تنفيذ المهمة بعد الموافقة، ولم تُعتبر منشأة.'
        : null;

  function changeStatus(to: 'active' | 'paused' | 'cancelled') {
    statusMutation.mutate({
      workId,
      data: { from: currentStatus, to, reason: to === 'paused' ? 'أوقفه المستخدم مؤقتًا.' : undefined },
    });
  }

  return (
    <section className="min-w-0 rounded-3xl border border-border/70 bg-card/55 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button type="button" onClick={() => setLocation('/works')} className="mb-4 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-primary">
            <ArrowLeft className="size-3.5" /> كل الأعمال
          </button>
          <p className="text-xs text-muted-foreground">{kindLabels[workKind as AgentWorkKind]}</p>
          <h2 className="mt-1 font-serif text-2xl tracking-tight">{workTitle}</h2>
          {work.description && <p className="mt-2 max-w-xl text-sm leading-7 text-muted-foreground">{work.description}</p>}
        </div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusStyle(workStatus)}`}>
          {statusLabels[workStatus] ?? workStatus}
        </span>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {nextStatus && (
          <button
            type="button"
            onClick={() => changeStatus(nextStatus)}
            disabled={statusMutation.isPending}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {nextStatus === 'paused' ? <Pause className="size-4" /> : <Play className="size-4" />}
            {nextStatus === 'paused' ? 'إيقاف مؤقت' : 'تشغيل العمل'}
          </button>
        )}
        {!['cancelled', 'completed'].includes(workStatus) && (
          <button type="button" onClick={() => changeStatus('cancelled')} disabled={statusMutation.isPending} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:border-destructive/40 hover:text-destructive disabled:opacity-50">
            <XCircle className="size-4" /> إلغاء العمل
          </button>
        )}
        <button type="button" onClick={() => void detailQuery.refetch()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-primary">
          <RefreshCw className="size-4" /> تحديث
        </button>
      </div>

      {approvalVisible && operation && approvalOperationId && (
        <div className="mt-6 rounded-2xl border border-primary/25 bg-primary/5 p-4">
          <p className="mb-3 text-sm font-semibold">موافقة مطلوبة قبل إنشاء المهمة</p>
          <ApprovalForm
            operationId={approvalOperationId}
            toolName={operation.toolName}
            initialArgs={operation.args}
            display={operation.display}
            status={operation.status}
            allowArgsOverride={false}
            busy={approveMutation.isPending || rejectMutation.isPending}
            onConfirm={() => approveMutation.mutate({ operationId: approvalOperationId })}
            onReject={() => rejectMutation.mutate({ operationId: approvalOperationId })}
          />
        </div>
      )}
      {approvalOutcome && (
        <div className="mt-6 rounded-2xl border border-border/70 bg-background/65 p-4 text-sm text-muted-foreground">
          {approvalOutcome}
        </div>
      )}

      <div className="mt-7 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-background/70 p-4">
          <p className="text-xs text-muted-foreground">المتابعة القادمة</p>
          <p className="mt-2 text-sm font-semibold">{formatDate(work.nextRunAt)}</p>
        </div>
        <div className="rounded-2xl bg-background/70 p-4">
          <p className="text-xs text-muted-foreground">آخر نتيجة</p>
          <p className="mt-2 text-sm font-semibold">{work.lastRunStatus ? statusLabels[work.lastRunStatus] ?? work.lastRunStatus : 'لا توجد نتيجة بعد'}</p>
        </div>
        <div className="rounded-2xl bg-background/70 p-4">
          <p className="text-xs text-muted-foreground">آخر تحديث</p>
          <p className="mt-2 text-sm font-semibold">{formatDate(work.updatedAt)}</p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border/60 bg-background/50 p-4">
        <p className="text-xs text-muted-foreground">ماذا يتابع الوكيل؟</p>
        <p className="mt-2 text-sm font-semibold">{conditionLabel(work.condition ?? {})}</p>
        {detailQuery.data?.evidence[0] && (
          <p className="mt-2 text-xs text-muted-foreground">{evidenceLabel(detailQuery.data.evidence[0].snapshot)}</p>
        )}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">ما الذي حدث</h3>
          </div>
          <div className="mt-3 space-y-2">
            {detailQuery.data?.events.length ? detailQuery.data.events.map((event) => (
              <div key={event.id} className="rounded-2xl border border-border/60 bg-background/50 p-3">
                <p className="text-sm">{event.summary}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{formatDate(event.occurredAt)}</p>
              </div>
            )) : <p className="rounded-2xl bg-background/50 p-4 text-sm text-muted-foreground">لا توجد أحداث بعد.</p>}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <Clock3 className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">المحاولات</h3>
          </div>
          <div className="mt-3 space-y-2">
            {detailQuery.data?.runs.length ? detailQuery.data.runs.map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/50 p-3">
                <div>
                  <p className="text-sm">المحاولة {run.attempt}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{formatDate(run.startedAt)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusStyle(run.status)}`}>{statusLabels[run.status] ?? run.status}</span>
              </div>
            )) : <p className="rounded-2xl bg-background/50 p-4 text-sm text-muted-foreground">لم تبدأ محاولة بعد.</p>}
          </div>
        </div>
      </div>

      <div className="mt-8">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">الدليل المرتبط بالنتيجة</h3>
        </div>
        <div className="mt-3 space-y-2">
          {detailQuery.data?.evidence.length ? detailQuery.data.evidence.map((evidence) => (
            <div key={evidence.id} className="rounded-2xl border border-border/60 bg-background/50 p-3">
              <p className="text-sm">{evidenceLabel(evidence.snapshot)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{formatDate(evidence.createdAt)}</p>
            </div>
          )) : <p className="rounded-2xl bg-background/50 p-4 text-sm text-muted-foreground">لا يوجد دليل محفوظ بعد.</p>}
        </div>
      </div>
    </section>
  );
}

export default function Works() {
  const [, params] = useRoute('/works/:id');
  const [, setLocation] = useLocation();
  const selectedId = params?.id;
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<AgentWorkKind>('monitor');
  const worksQuery = useListAgentWorks(undefined, {
    query: { queryKey: getListAgentWorksQueryKey(), staleTime: 5_000 },
  });
  const createMutation = useCreateAgentWork({
    mutation: {
      onSuccess: (result) => {
        setTitle('');
        setIsCreating(false);
        void queryClient.invalidateQueries({ queryKey: getListAgentWorksQueryKey() });
        if (result.work?.id) setLocation(`/works/${result.work.id}`);
      },
    },
  });

  const works = useMemo(() => worksQuery.data?.works ?? [], [worksQuery.data?.works]);

  return (
    <div dir="rtl" lang="ar" className="grain min-h-[100dvh] bg-background text-foreground">
      <main className="mx-auto min-h-[100dvh] max-w-[1280px] px-4 py-6 sm:px-8 lg:px-12">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/70 pb-6">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary">
              <ArrowLeft className="size-3.5" /> العودة للمحادثة
            </Link>
            <div className="mt-5 flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><Sparkles className="size-5" /></div>
              <div>
                <p className="text-xs text-muted-foreground">مساحة الوكيل</p>
                <h1 className="font-serif text-3xl tracking-tight">الأعمال الجارية</h1>
              </div>
            </div>
          </div>
          <button type="button" onClick={() => setIsCreating((value) => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            <Plus className="size-4" /> عمل جديد
          </button>
        </header>

        {isCreating && (
          <form
            className="mt-6 rounded-3xl border border-primary/20 bg-primary/5 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = title.trim();
              if (!trimmed) return;
              createMutation.mutate({ data: { kind, title: trimmed, description: null, source: {}, condition: {}, schedule: { frequency: 'manual' } } });
            }}
          >
            <p className="text-sm font-semibold">ما الذي تريد أن يتابعه الوكيل؟</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
              <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus placeholder="مثال: تابع موعد تجديد الاشتراك" className="min-h-11 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
              <select value={kind} onChange={(event) => setKind(event.target.value as AgentWorkKind)} className="min-h-11 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary">
                {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <button type="submit" disabled={createMutation.isPending || !title.trim()} className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                {createMutation.isPending ? 'جارٍ الحفظ...' : 'حفظ العمل'}
              </button>
            </div>
            {createMutation.isError && <p className="mt-3 text-xs text-destructive">تعذر حفظ العمل. حاول مرة أخرى.</p>}
          </form>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[340px_1fr]">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">كل الأعمال</p>
              <span className="text-xs text-muted-foreground">{works.length} أعمال</span>
            </div>
            {worksQuery.isLoading ? <p className="rounded-2xl bg-card/60 p-5 text-sm text-muted-foreground">أحمل أعمالك...</p>
              : works.length ? <div className="space-y-2">{works.map((work) => <WorkCard key={work.id} work={work} selected={work.id === selectedId} />)}</div>
                : <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">لم تحفظ عملًا بعد. ابدأ من زر «عمل جديد».</div>}
          </section>
          <section>
            {selectedId ? <WorkDetail workId={selectedId} /> : (
              <div className="flex min-h-[420px] items-center justify-center rounded-3xl border border-dashed border-border bg-card/30 p-8 text-center">
                <div className="max-w-sm">
                  <CheckCircle2 className="mx-auto size-10 text-chart-3" />
                  <h2 className="mt-4 font-serif text-2xl">الوكيل يعرف أين وصل</h2>
                  <p className="mt-3 text-sm leading-7 text-muted-foreground">اختر عملًا من القائمة لترى حالته، ما حدث فيه، ومحاولاته الأخيرة.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}