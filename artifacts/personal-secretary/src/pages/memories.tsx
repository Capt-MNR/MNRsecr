import { useState } from 'react';
import { ArrowRight, ArchiveRestore, Brain, Check, Clock3, LoaderCircle, RotateCcw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react';
import { Link } from 'wouter';
import {
  getListSecondBrainMemoriesQueryKey,
  getListSecondBrainCandidatesQueryKey,
  type ListSecondBrainMemoriesParams,
  useListSecondBrainCandidates,
  useArchiveSecondBrainMemory,
  useListSecondBrainMemories,
  useReviewSecondBrainCandidate,
  useAssociateSecondBrainCandidate,
  useGetCandidates,
  getGetCandidatesQueryKey,
  useRestoreSecondBrainMemory,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

const kindLabels: Record<string, string> = {
  fact: 'معلومة',
  preference: 'تفضيل',
  alias: 'اسم بديل',
};

function formatDate(value: Date | string | null) {
  if (!value) return 'غير متاح';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'غير متاح';
  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function aliasLabel(key: string) {
  return key.startsWith('alias:') ? key.slice('alias:'.length) : null;
}

export default function Memories() {
  const queryClient = useQueryClient();
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<ListSecondBrainMemoriesParams['kind']>();
  const [status, setStatus] = useState<NonNullable<ListSecondBrainMemoriesParams['status']>>('active');
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [reviewingCandidateId, setReviewingCandidateId] = useState<string | null>(null);
  const [associatingCandidateId, setAssociatingCandidateId] = useState<string | null>(null);
  const [associationType, setAssociationType] = useState<'person' | 'project' | 'financial_party'>('person');
  const [associationQuery, setAssociationQuery] = useState('');
  const filters: ListSecondBrainMemoriesParams = {
    ...(search ? { search } : {}),
    ...(kind ? { kind } : {}),
    status,
  };
  const memoriesQuery = useListSecondBrainMemories(filters, {
    query: {
      queryKey: getListSecondBrainMemoriesQueryKey(filters),
      staleTime: 0,
      refetchOnMount: 'always',
    },
  });
  const archiveMutation = useArchiveSecondBrainMemory({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListSecondBrainMemoriesQueryKey() });
        setArchivingId(null);
      },
      onError: () => setArchivingId(null),
    },
  });
  const restoreMutation = useRestoreSecondBrainMemory({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListSecondBrainMemoriesQueryKey() });
        setRestoringId(null);
      },
      onError: () => setRestoringId(null),
    },
  });
  const candidatesQuery = useListSecondBrainCandidates({ status: 'pending_review' }, {
    query: {
      queryKey: getListSecondBrainCandidatesQueryKey({ status: 'pending_review' }),
      staleTime: 0,
      refetchOnMount: 'always',
    },
  });
  const reviewCandidateMutation = useReviewSecondBrainCandidate({
    mutation: {
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListSecondBrainCandidatesQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getListSecondBrainMemoriesQueryKey() }),
        ]);
        setReviewingCandidateId(null);
      },
      onError: () => setReviewingCandidateId(null),
    },
  });
  const entityCandidatesQuery = useGetCandidates(
    { type: associationType, q: associationQuery.trim() || ' ' },
    { query: { queryKey: getGetCandidatesQueryKey({ type: associationType, q: associationQuery.trim() || ' ' }), enabled: Boolean(associatingCandidateId && associationQuery.trim()), staleTime: 10_000 } },
  );
  const associateCandidateMutation = useAssociateSecondBrainCandidate({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListSecondBrainCandidatesQueryKey() });
        setAssociatingCandidateId(null);
        setAssociationQuery('');
      },
    },
  });

  const memories = memoriesQuery.data?.memories ?? [];
  const hasFilters = Boolean(search || kind || status === 'archived');

  function archiveMemory(id: string) {
    if (archiveMutation.isPending || restoreMutation.isPending) return;
    setArchivingId(id);
    archiveMutation.mutate({ memoryId: id });
  }

  function restoreMemory(id: string) {
    if (archiveMutation.isPending || restoreMutation.isPending) return;
    setRestoringId(id);
    restoreMutation.mutate({ memoryId: id });
  }

  function reviewCandidate(id: string, status: 'approved' | 'rejected' | 'needs_context') {
    if (reviewCandidateMutation.isPending) return;
    setReviewingCandidateId(id);
    reviewCandidateMutation.mutate({ candidateId: id, data: { status } });
  }

  function associateCandidate(candidateId: string, entityId: string) {
    if (associateCandidateMutation.isPending) return;
    associateCandidateMutation.mutate({ candidateId, data: { entityType: associationType, entityId } });
  }

  return (
    <div dir="rtl" lang="ar" className="grain min-h-[100dvh] bg-background text-foreground">
      <div className="mx-auto min-h-[100dvh] max-w-[980px] px-4 py-6 sm:px-8 sm:py-10">
        <header className="flex items-start justify-between gap-4 border-b border-border/70 pb-6">
          <div className="flex items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-[15px] bg-primary text-primary-foreground shadow-sm">
              <Brain className="size-5" strokeWidth={1.8} />
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Second Brain</p>
              <h1 className="mt-1 font-serif text-[28px] tracking-tight sm:text-[34px]">الذاكرة الشخصية</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                معلومات حفظتها أنت صراحةً لتساعد السكرتير. لا تغيّر السجلات المالية ولا تستبدل مصدر البيانات الرسمي.
              </p>
            </div>
          </div>
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            <ArrowRight className="size-4" />
            <span className="hidden sm:inline">السكرتير</span>
          </Link>
        </header>

        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 text-chart-3" />
            <span>{memories.length} {status === 'active' ? 'ذاكرة نشطة' : 'ذاكرة مؤرشفة'}</span>
          </div>
          <button
            type="button"
            onClick={() => void memoriesQuery.refetch()}
            disabled={memoriesQuery.isFetching}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <RotateCcw className={`size-3.5 ${memoriesQuery.isFetching ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </div>

        <form
          className="mt-5 rounded-2xl border border-border/70 bg-card/60 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(searchDraft.trim());
          }}
        >
          <div className="flex items-center gap-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="ابحث في الذاكرة..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/65"
              aria-label="البحث في الذاكرة"
            />
            {searchDraft && (
              <button
                type="button"
                onClick={() => {
                  setSearchDraft('');
                  setSearch('');
                }}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="مسح البحث"
              >
                <X className="size-4" />
              </button>
            )}
            <button type="submit" className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">
              بحث
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SlidersHorizontal className="size-3.5 text-muted-foreground" />
            {[
              [undefined, 'الكل'],
              ['fact', 'معلومات'],
              ['preference', 'تفضيلات'],
              ['alias', 'أسماء بديلة'],
            ].map(([value, label]) => (
              <button
                key={value ?? 'all'}
                type="button"
                onClick={() => setKind(value as ListSecondBrainMemoriesParams['kind'])}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                  kind === value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            {[
              ['active', 'النشطة'],
              ['archived', 'الأرشيف'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value as NonNullable<ListSecondBrainMemoriesParams['status']>)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                  status === value ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {value === 'archived' && <ArchiveRestore className="ml-1 inline size-3" />}
                {label}
              </button>
            ))}
          </div>
        </form>

        <section className="mt-8 rounded-2xl border border-primary/15 bg-primary/[0.035] p-4 sm:p-5" aria-label="اقتراحات الذاكرة">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary/70">Review queue</p>
              <h2 className="mt-1 font-serif text-xl">اقتراحات تحتاج مراجعة</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                لا تدخل هذه الاقتراحات إلى سياق السكرتير قبل موافقتك.
              </p>
            </div>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              {candidatesQuery.data?.candidates.length ?? 0}
            </span>
          </div>
          {candidatesQuery.isLoading && <div className="mt-4 h-20 animate-pulse rounded-xl bg-card/70" />}
          {candidatesQuery.isError && !candidatesQuery.isLoading && (
            <p className="mt-4 text-xs text-destructive">تعذر تحميل اقتراحات الذاكرة.</p>
          )}
          {!candidatesQuery.isLoading && !candidatesQuery.isError && (candidatesQuery.data?.candidates.length ?? 0) === 0 && (
            <p className="mt-4 text-xs text-muted-foreground">لا توجد اقتراحات معلقة حاليًا.</p>
          )}
          {(candidatesQuery.data?.candidates.length ?? 0) > 0 && (
            <div className="mt-4 space-y-3">
              {candidatesQuery.data?.candidates.map((candidate) => (
                <article key={candidate.id} className="rounded-xl border border-border/60 bg-card/70 p-3">
                  {(() => {
                      const aliasNeedsAssociation = candidate.kind === 'alias' && !candidate.entityAssociated;
                    return (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                        {kindLabels[candidate.kind] ?? candidate.kind}
                      </span>
                      <p className="mt-2 text-sm leading-6">{candidate.value}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        الثقة: {Math.round(candidate.confidence * 100)}٪ · {formatDate(candidate.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                        {aliasNeedsAssociation && (
                         <div className="mt-3 w-full rounded-lg border border-border/60 bg-background/60 p-2">
                           <div className="flex gap-2">
                              <select value={associationType} onChange={(event) => setAssociationType(event.target.value as 'person' | 'project' | 'financial_party')} className="rounded-md border border-border bg-background px-2 text-xs">
                               <option value="person">شخص</option>
                               <option value="project">مشروع</option>
                                <option value="financial_party">طرف مالي</option>
                             </select>
                             <input value={associatingCandidateId === candidate.id ? associationQuery : ''} onFocus={() => setAssociatingCandidateId(candidate.id)} onChange={(event) => { setAssociatingCandidateId(candidate.id); setAssociationQuery(event.target.value); }} placeholder="ابحث عن الكيان..." className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
                           </div>
                           {associatingCandidateId === candidate.id && (entityCandidatesQuery.data?.length ?? 0) > 0 && (
                             <div className="mt-2 space-y-1">
                               {entityCandidatesQuery.data?.map((entity) => (
                                 <button key={entity.id} type="button" onClick={() => associateCandidate(candidate.id, entity.id)} className="block w-full rounded-md px-2 py-1.5 text-right text-xs hover:bg-muted">
                                   {entity.name}
                                 </button>
                               ))}
                             </div>
                           )}
                         </div>
                       )}
                       <button
                        type="button"
                        onClick={() => reviewCandidate(candidate.id, 'approved')}
                        disabled={reviewCandidateMutation.isPending || aliasNeedsAssociation}
                        className="rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        {reviewingCandidateId === candidate.id && reviewCandidateMutation.isPending
                          ? <LoaderCircle className="size-3.5 animate-spin" />
                          : aliasNeedsAssociation ? 'اربطه بكيان أولًا' : 'اعتماد'}
                      </button>
                      <button
                        type="button"
                        onClick={() => reviewCandidate(candidate.id, 'needs_context')}
                        disabled={reviewCandidateMutation.isPending}
                        className="rounded-lg border border-border/70 px-3 py-2 text-[11px] font-semibold text-muted-foreground disabled:opacity-50"
                      >
                        يحتاج توضيح
                      </button>
                      <button
                        type="button"
                        onClick={() => reviewCandidate(candidate.id, 'rejected')}
                        disabled={reviewCandidateMutation.isPending}
                        className="rounded-lg border border-destructive/20 px-3 py-2 text-[11px] font-semibold text-destructive disabled:opacity-50"
                      >
                        رفض
                      </button>
                    </div>
                  </div>
                    );
                  })()}
                </article>
              ))}
            </div>
          )}
        </section>

        {memoriesQuery.isLoading && (
          <div className="mt-8 space-y-3">
            {[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl border border-border/60 bg-card/60" />)}
          </div>
        )}

        {memoriesQuery.isError && !memoriesQuery.isLoading && (
          <div className="mt-8 rounded-2xl border border-destructive/25 bg-destructive/5 p-5 text-sm text-destructive">
            تعذر تحميل الذاكرة الشخصية.
            <button type="button" onClick={() => void memoriesQuery.refetch()} className="mr-2 font-semibold underline underline-offset-4">
              حاول مرة أخرى
            </button>
          </div>
        )}

        {!memoriesQuery.isLoading && !memoriesQuery.isError && memories.length === 0 && (
          <div className="mt-8 rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center">
            <Sparkles className="mx-auto size-6 text-primary" />
            <h2 className="mt-3 font-serif text-xl">
              {hasFilters ? 'لا توجد نتائج مطابقة' : status === 'archived' ? 'لا توجد ذاكرة مؤرشفة' : 'لا توجد ذاكرة محفوظة'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {hasFilters ? 'جرّب تغيير البحث أو التصفية.' : 'قل للسكرتير مثلًا: «افتكر إني بفضل الردود المختصرة».'}
            </p>
          </div>
        )}

        {!memoriesQuery.isLoading && !memoriesQuery.isError && memories.length > 0 && (
          <section className="mt-5 space-y-3" aria-label="الذاكرة الشخصية">
            {memories.map((memory) => {
              const alias = aliasLabel(memory.key);
              const isArchiving = archivingId === memory.id;
              return (
                <article key={memory.id} className="rounded-2xl border border-border/70 bg-card/70 p-4 shadow-[0_14px_40px_-30px_hsl(var(--foreground)/.5)] sm:p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                          {kindLabels[memory.kind] ?? memory.kind}
                        </span>
                        {alias && <span className="text-xs text-muted-foreground">«{alias}»</span>}
                      </div>
                      <p className="mt-3 text-[15px] leading-7 text-foreground">{memory.value}</p>
                    </div>
                    {status === 'active' ? (
                    <button
                      type="button"
                      onClick={() => archiveMemory(memory.id)}
                      disabled={archiveMutation.isPending || restoreMutation.isPending}
                      className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/5 hover:text-destructive disabled:opacity-50"
                      aria-label={`أرشفة الذاكرة: ${memory.value}`}
                    >
                      {isArchiving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      <span className="hidden sm:inline">إزالة</span>
                    </button>
                    ) : (
                    <button
                      type="button"
                      onClick={() => restoreMemory(memory.id)}
                      disabled={archiveMutation.isPending || restoreMutation.isPending}
                      className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
                      aria-label={`استرجاع الذاكرة: ${memory.value}`}
                    >
                      {restoringId === memory.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                      <span className="hidden sm:inline">استرجاع</span>
                    </button>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock3 className="size-3.5" />
                      آخر تأكيد: {formatDate(memory.lastConfirmedAt)}
                    </span>
                    <span>الثقة: {Math.round(memory.confidence * 100)}٪</span>
                    <span>تحدّثت: {formatDate(memory.updatedAt)}</span>
                    {status === 'archived' && <span className="text-muted-foreground/80">مؤرشفة</span>}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}