import { useState } from 'react';
import { ArrowRight, Brain, Clock3, LoaderCircle, RotateCcw, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { Link } from 'wouter';
import {
  getListSecondBrainMemoriesQueryKey,
  useArchiveSecondBrainMemory,
  useListSecondBrainMemories,
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
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const memoriesQuery = useListSecondBrainMemories({
    query: {
      queryKey: getListSecondBrainMemoriesQueryKey(),
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

  const memories = memoriesQuery.data?.memories ?? [];

  function archiveMemory(id: string) {
    if (archiveMutation.isPending) return;
    setArchivingId(id);
    archiveMutation.mutate({ memoryId: id });
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
            <span>{memories.length} ذاكرة نشطة</span>
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
            <h2 className="mt-3 font-serif text-xl">لا توجد ذاكرة محفوظة</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              قل للسكرتير مثلًا: «افتكر إني بفضل الردود المختصرة».
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
                    <button
                      type="button"
                      onClick={() => archiveMemory(memory.id)}
                      disabled={archiveMutation.isPending}
                      className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/5 hover:text-destructive disabled:opacity-50"
                      aria-label={`أرشفة الذاكرة: ${memory.value}`}
                    >
                      {isArchiving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      <span className="hidden sm:inline">إزالة</span>
                    </button>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock3 className="size-3.5" />
                      آخر تأكيد: {formatDate(memory.lastConfirmedAt)}
                    </span>
                    <span>الثقة: {Math.round(memory.confidence * 100)}٪</span>
                    <span>تحدّثت: {formatDate(memory.updatedAt)}</span>
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