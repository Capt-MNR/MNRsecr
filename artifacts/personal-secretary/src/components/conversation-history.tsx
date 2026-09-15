import { useEffect, useState } from 'react';
import {
  Archive,
  MessageSquareText,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useLocation } from 'wouter';
import {
  getGetConversationQueryKey,
  getListConversationsQueryKey,
  useGetConversation,
  useListConversations,
} from '@workspace/api-client-react';
import type { ConversationDetail } from '@workspace/api-client-react';

function formatHistoryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const age = Date.now() - date.getTime();
  if (age < 24 * 60 * 60 * 1000) {
    return new Intl.DateTimeFormat('ar-EG', { hour: 'numeric', minute: '2-digit' }).format(date);
  }
  return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short' }).format(date);
}

export default function ConversationHistory({
  selectedId,
  isOpen,
  variant = 'both',
  onOpenChange,
  onNew,
  onSelect,
  onLoaded,
}: {
  selectedId?: string;
  isOpen: boolean;
  variant?: 'both' | 'desktop' | 'mobile';
  onOpenChange: (open: boolean) => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onLoaded: (detail: ConversationDetail) => void;
}) {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');
  const conversationsQuery = useListConversations(
    { search: search.trim() || undefined },
    {
      query: {
        queryKey: getListConversationsQueryKey({ search: search.trim() || undefined }),
        staleTime: 10_000,
      },
    },
  );
  const detailQuery = useGetConversation(selectedId ?? '', {
      query: {
      queryKey: getGetConversationQueryKey(selectedId ?? ''),
      enabled: Boolean(selectedId),
        refetchInterval: (query) => query.state.data?.recentTurns.some((turn) => turn.action?.type === 'approval_required') ? 5_000 : false,
    },
  });

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (detailQuery.data && detailQuery.data.conversationId === selectedId) {
      onLoaded(detailQuery.data);
    }
  }, [detailQuery.data, onLoaded, selectedId]);

  const content = (
    <>
      <div className="mb-3 flex items-center justify-between px-2">
        <p className="text-[11px] tracking-wide text-muted-foreground">المحادثات الأخيرة</p>
        <MessageSquareText className="size-3.5 text-muted-foreground/70" />
      </div>
      <label className="mb-3 flex items-center gap-2 rounded-xl border border-border/70 bg-card/60 px-3 py-2 text-muted-foreground focus-within:border-primary/40">
        <Search className="size-3.5 shrink-0" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث في المحادثات" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60" />
      </label>
      <div className="scrollbar-thin min-h-0 flex-1 space-y-1 overflow-y-auto">
        {conversationsQuery.isLoading && [1, 2, 3].map((item) => <div key={item} className="h-14 animate-pulse rounded-xl bg-muted/70" />)}
        {conversationsQuery.isError && <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive" role="alert"><p>تعذر تحميل سجل المحادثات.</p><button type="button" onClick={() => void conversationsQuery.refetch()} className="mt-2 font-semibold underline underline-offset-4">حاول مرة أخرى</button></div>}
        {!conversationsQuery.isLoading && conversationsQuery.data?.conversations.length === 0 && <p className="px-2 py-4 text-xs leading-relaxed text-muted-foreground">لا توجد محادثات محفوظة بعد.</p>}
        {conversationsQuery.data?.conversations.map((conversation) => (
          <button key={conversation.conversationId} type="button" onClick={() => { onSelect(conversation.conversationId); onOpenChange(false); }} className={`w-full rounded-xl px-3 py-2.5 text-right transition ${selectedId === conversation.conversationId ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/70'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-semibold">{conversation.title}</span>
              <span className="shrink-0 text-[9px] text-muted-foreground">{formatHistoryTime(conversation.lastActivityAt)}</span>
            </div>
            <p className="mt-1 truncate text-[10px] text-muted-foreground">{conversation.preview}</p>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <>
      {variant !== 'mobile' && <div className="mt-8 flex min-h-0 flex-1 flex-col">{content}</div>}
      {variant !== 'desktop' && isOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-label="سجل المحادثات">
          <button type="button" className="absolute inset-0 bg-foreground/30 backdrop-blur-[1px]" onClick={() => onOpenChange(false)} aria-label="إغلاق سجل المحادثات" />
          <aside className="relative z-10 flex w-[min(88vw,340px)] flex-col border-l border-border bg-sidebar px-5 py-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2"><MessageSquareText className="size-4 text-primary" /><h2 className="font-serif text-xl">المحادثات</h2></div>
              <button type="button" onClick={() => onOpenChange(false)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="إغلاق"><X className="size-4" /></button>
            </div>
            <button type="button" onClick={onNew} className="mb-3 flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-3 text-sm font-semibold text-primary"><Plus className="size-4" /> محادثة جديدة</button>
            <button type="button" onClick={() => { setLocation('/records'); onOpenChange(false); }} className="mb-5 flex items-center gap-2 rounded-xl px-3 py-3 text-sm text-muted-foreground hover:bg-muted"><Archive className="size-4" /> السجلات المحفوظة</button>
            <div className="flex min-h-0 flex-1 flex-col">{content}</div>
          </aside>
        </div>
      )}
    </>
  );
}