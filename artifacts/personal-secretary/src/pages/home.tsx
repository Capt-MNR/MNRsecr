import { useCallback, useMemo, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp,
  CalendarClock,
  Check,
  CircleAlert,
  Clock3,
  DollarSign,
  ListChecks,
  LoaderCircle,
  Menu,
  PanelRight,
  Plus,
  RefreshCw,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react';
import {
  getGetTodayContextQueryKey,
  getHealthCheckQueryKey,
  useCreateTurn,
  useGetTodayContext,
  useHealthCheck,
} from '@workspace/api-client-react';
import type { ConversationDetail } from '@workspace/api-client-react';
import { classifySecretaryError } from '../lib/secretary-errors';
import ConversationHistory from '../components/conversation-history';

type LocalMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  time: string;
  meta?: string;
};

const starterMessage: LocalMessage = {
  id: 'welcome',
  role: 'assistant',
  text: 'صباح الخير. أنا جاهز أسجل لك مصروف، أضيف تذكير، أو أراجع معك تفاصيل الناس والمشاريع.',
  time: 'الآن',
  meta: 'سكرتيرك الخاص',
};

const suggestedPrompts = [
  'إيه عندي النهارده؟',
  'فكرني بكرة أكلم محمد',
  'محمد أخد مني كام؟',
];

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'اليوم';
  return new Intl.DateTimeFormat('ar-EG', { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
}

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency }).format(amountMinor / 100);
}

function ContextSkeleton() {
  return (
    <div className="space-y-4" data-testid="loading-context">
      {[1, 2, 3].map((item) => (
        <div key={item} className="animate-pulse rounded-2xl border border-border/70 bg-card/70 p-4">
          <div className="mb-3 h-3 w-24 rounded-full bg-muted" />
          <div className="h-4 w-4/5 rounded-full bg-muted" />
          <div className="mt-2 h-3 w-2/5 rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

function EmptyLine({ children }: { children: string }) {
  return <p className="py-2 text-sm text-muted-foreground" data-testid="empty-context">{children}</p>;
}

function Home() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [isContextOpen, setIsContextOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<LocalMessage[]>([starterMessage]);

  const todayQuery = useGetTodayContext({
    query: {
      queryKey: getGetTodayContextQueryKey(),
      staleTime: 30_000,
    },
  });
  const healthQuery = useHealthCheck({
    query: {
      queryKey: getHealthCheckQueryKey(),
      staleTime: 60_000,
      retry: 1,
    },
  });
  const createTurn = useCreateTurn({
    request: { timeoutMs: 30_000 },
  });
  const context = todayQuery.data?.context;
  const sendError = createTurn.isError ? classifySecretaryError(createTurn.error) : null;

  const dateLabel = useMemo(
    () => formatDate(context?.asOf ?? new Date().toISOString()),
    [context?.asOf],
  );
  const canSend = draft.trim().length > 0 && !createTurn.isPending;
  const healthLabel = healthQuery.isPending
    ? 'جاري فحص الاتصال'
    : healthQuery.isError
      ? 'الاتصال يحتاج مراجعة'
      : healthQuery.data?.status === 'ok'
        ? 'جاهز'
        : 'متاح';

  const handleConversationLoaded = useCallback((detail: ConversationDetail) => {
    setConversationId(detail.conversationId);
    const loadedMessages: LocalMessage[] = [];
    detail.recentTurns.forEach((turn, index) => {
      loadedMessages.push({
        id: `${detail.conversationId}-user-${index}`,
        role: 'user',
        text: turn.userMessage,
        time: formatTime(turn.createdAt),
      });
      loadedMessages.push({
        id: `${detail.conversationId}-assistant-${index}`,
        role: 'assistant',
        text: turn.assistantMessage,
        time: formatTime(turn.createdAt),
        meta: 'من سجل المحادثة',
      });
    });
    setMessages(loadedMessages.length > 0 ? loadedMessages : [starterMessage]);
  }, []);

  function startNewConversation() {
    setConversationId(undefined);
    setSelectedConversationId(undefined);
    setMessages([starterMessage]);
    setIsHistoryOpen(false);
  }

  function sendMessage(value = draft) {
    const message = value.trim();
    if (!message || createTurn.isPending) return;
    const sentAt = new Date().toISOString();
    setDraft('');
    setMessages((current) => [
      ...current,
      { id: `user-${sentAt}`, role: 'user', text: message, time: formatTime(sentAt) },
    ]);

    createTurn.mutate(
      {
        data: {
          message,
          conversationId: conversationId ?? null,
          idempotencyKey: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `turn-${Date.now()}`,
        },
      },
      {
        onSuccess: (response) => {
          setConversationId(response.conversationId);
          setSelectedConversationId(response.conversationId);
          setMessages((current) => [
            ...current,
            {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              text: response.assistantMessage,
              time: formatTime(new Date().toISOString()),
              meta: response.provider ? `${response.provider} · ${response.model}` : 'سكرتيرك الخاص',
            },
          ]);
          queryClient.invalidateQueries({ queryKey: getGetTodayContextQueryKey() });
          queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
        },
      },
    );
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  return (
    <div dir="rtl" lang="ar" className="grain min-h-[100dvh] bg-background text-foreground">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1480px]">
        <aside className="hidden w-[245px] shrink-0 flex-col border-l border-border/70 bg-sidebar/75 px-5 py-6 lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="relative flex size-10 items-center justify-center rounded-[14px] bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="size-[18px]" strokeWidth={1.8} />
              <span className="absolute -right-1 -top-1 size-2 rounded-full bg-accent" />
            </div>
            <div>
              <p className="font-serif text-[20px] leading-none tracking-tight">سكرتير</p>
              <p className="mt-1 text-[10px] tracking-wide text-muted-foreground">نظامك الشخصي</p>
            </div>
          </div>

          <div className="mt-12 px-2">
            <p className="text-[11px] tracking-wide text-muted-foreground">مساحة العمل</p>
            <button
              type="button"
              onClick={startNewConversation}
              className="mt-3 flex w-full items-center gap-3 rounded-xl bg-primary/10 px-3 py-3 text-left text-sm font-medium text-primary transition-colors hover:bg-primary/15"
              data-testid="button-new-conversation"
            >
              <Plus className="size-4" />
               محادثة جديدة
            </button>
            <a href={`${import.meta.env.BASE_URL}records`} className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <span className="flex size-4 items-center justify-center rounded border border-current text-[9px]">▦</span>
              السجلات المحفوظة
            </a>
          </div>

          <ConversationHistory
            variant="desktop"
            selectedId={selectedConversationId}
            isOpen={isHistoryOpen}
            onOpenChange={setIsHistoryOpen}
            onNew={startNewConversation}
            onSelect={setSelectedConversationId}
            onLoaded={handleConversationLoaded}
          />

          <div className="mt-auto rounded-2xl border border-border/80 bg-card/55 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className={`size-2 rounded-full ${healthQuery.isError ? 'bg-destructive' : 'animate-breathe bg-chart-3'}`} />
              {healthLabel}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">بياناتك محفوظة في مساحتك الخاصة ومتاحة وقت ما تحتاجها.</p>
          </div>
        </aside>
        <ConversationHistory
          variant="mobile"
          selectedId={selectedConversationId}
          isOpen={isHistoryOpen}
          onOpenChange={setIsHistoryOpen}
          onNew={startNewConversation}
          onSelect={setSelectedConversationId}
          onLoaded={handleConversationLoaded}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[76px] shrink-0 items-center justify-between border-b border-border/70 px-4 sm:px-8 lg:px-12">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setIsHistoryOpen(true)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted lg:hidden" data-testid="button-open-menu">
                <Menu className="size-5" />
              </button>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{dateLabel}</p>
                 <h1 className="mt-1 font-serif text-[24px] leading-none tracking-tight sm:text-[28px]">يومك في محادثة واحدة</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1.5 text-xs text-muted-foreground sm:flex">
                <span className={`size-1.5 rounded-full ${healthQuery.isError ? 'bg-destructive' : 'bg-chart-3'}`} />
                {healthLabel}
              </div>
              <button
                type="button"
                onClick={() => setIsContextOpen((open) => !open)}
                className="rounded-xl border border-border/70 bg-card p-2.5 text-muted-foreground transition-colors hover:bg-muted lg:hidden"
                     aria-label="عرض سياق اليوم"
                data-testid="button-toggle-context"
              >
                <PanelRight className="size-4" />
              </button>
              <div className="flex size-9 items-center justify-center rounded-full bg-[#d8b99b] text-xs font-bold text-[#4a3029]" data-testid="avatar-user">
                AM
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
            <section className="flex min-h-0 min-w-0 flex-1 flex-col px-4 pb-5 pt-7 sm:px-8 sm:pt-10 lg:px-12">
              <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col">
                <div className="mb-7 flex items-end justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">اكتب طلبك بطريقتك الطبيعية.</p>
                    <p className="mt-1 text-xs text-muted-foreground/75">المصروفات والتذكيرات تُحفظ في مساحتك الخاصة.</p>
                  </div>
                  <button
                    type="button"
                    onClick={startNewConversation}
                    className="hidden items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted sm:flex"
                    data-testid="button-clear-conversation"
                  >
                    <X className="size-3.5" />
                    مسح المحادثة
                  </button>
                </div>

                <div className="scrollbar-thin flex-1 space-y-7 overflow-y-auto pb-6">
                  {messages.map((message, index) => (
                    <article
                      key={message.id}
                      className={`animate-rise-in flex gap-3.5 ${message.role === 'user' ? 'justify-start' : 'justify-end'}`}
                      style={{ animationDelay: `${Math.min(index * 70, 350)}ms` }}
                      data-testid={`message-${message.role}-${message.id}`}
                    >
                      {message.role === 'assistant' && (
                        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                          <Sparkles className="size-3.5" />
                        </div>
                      )}
                      <div className={`max-w-[min(88%,600px)] ${message.role === 'user' ? 'items-end' : ''}`}>
                        <div className={message.role === 'user'
                          ? 'rounded-[18px] rounded-br-[5px] bg-primary px-4 py-3 text-[15px] leading-relaxed text-primary-foreground'
                          : 'rounded-[18px] rounded-tl-[5px] border border-border/70 bg-card px-4 py-3 text-[15px] leading-relaxed shadow-[0_8px_24px_-20px_hsl(var(--foreground)/.4)]'}>
                          {message.text}
                        </div>
                        <div className={`mt-1.5 flex items-center gap-2 px-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70 ${message.role === 'user' ? 'justify-end' : ''}`}>
                          <span>{message.time}</span>
                          {message.meta && <><span>·</span><span>{message.meta}</span></>}
                        </div>
                      </div>
                    </article>
                  ))}
                  {createTurn.isPending && (
                    <article className="flex gap-3.5 animate-rise-in" data-testid="loading-response">
                      <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                        <Sparkles className="size-3.5" />
                      </div>
                      <div className="rounded-[18px] rounded-tl-[5px] border border-border/70 bg-card px-5 py-4">
                        <div className="flex gap-1.5">
                          <span className="size-1.5 animate-breathe rounded-full bg-muted-foreground" />
                          <span className="size-1.5 animate-breathe rounded-full bg-muted-foreground [animation-delay:200ms]" />
                          <span className="size-1.5 animate-breathe rounded-full bg-muted-foreground [animation-delay:400ms]" />
                        </div>
                      </div>
                    </article>
                  )}
                  {sendError && (
                    <div
                      className="ml-11 flex items-center gap-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                      data-testid="error-send"
                      data-error-category={sendError.category}
                      role="alert"
                    >
                      <CircleAlert className="size-3.5 shrink-0" />
                      {sendError.message}
                    </div>
                  )}
                </div>

                <div className="mb-3 flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                  {suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => { setDraft(prompt); }}
                      className="shrink-0 rounded-full border border-border/80 bg-card/70 px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                      data-testid={`button-suggestion-${prompt.slice(0, 10).replaceAll(' ', '-').toLowerCase()}`}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>

                <div className="rounded-[20px] border border-border bg-card p-2 shadow-[0_18px_44px_-35px_hsl(var(--foreground)/.45)]">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder="اكتب طلبك هنا..."
                    rows={2}
                    className="w-full resize-none bg-transparent px-3 py-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/65"
                    data-testid="input-message"
                  />
                  <div className="flex items-center justify-between px-2 pb-1 pt-2">
                    <div className="flex items-center gap-1">
                      <span className="hidden pr-1 text-[10px] text-muted-foreground sm:inline">Enter للإرسال · Shift+Enter لسطر جديد</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => sendMessage()}
                      disabled={!canSend}
                      className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label="إرسال الرسالة"
                      data-testid="button-send-message"
                    >
                      {createTurn.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" strokeWidth={2.5} />}
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-center text-[10px] tracking-wide text-muted-foreground/60">خاص افتراضيًا · أنت المتحكم</p>
              </div>
            </section>

            <aside className={`${isContextOpen ? 'flex' : 'hidden'} w-full shrink-0 flex-col border-t border-border/70 bg-sidebar/35 px-4 py-6 sm:px-8 lg:flex lg:w-[340px] lg:border-r lg:border-t-0 lg:px-6 xl:w-[375px]`}>
              <div className="mb-6 flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-lg bg-accent/20 text-accent-foreground"><CalendarClock className="size-3.5" /></span>
                    <h2 className="font-serif text-[22px]">اليوم</h2>
                  </div>
                  <p className="mt-1 pl-9 text-xs text-muted-foreground">{dateLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={() => todayQuery.refetch()}
                  disabled={todayQuery.isFetching}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-muted disabled:opacity-50"
                  aria-label="تحديث سياق اليوم"
                  data-testid="button-refresh-context"
                >
                  <RefreshCw className={`size-4 ${todayQuery.isFetching ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {todayQuery.isLoading && <ContextSkeleton />}
              {todayQuery.isError && (
                <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-4" data-testid="error-context">
                  <div className="flex items-center gap-2 text-sm font-semibold text-destructive"><CircleAlert className="size-4" /> سياق اليوم غير متاح</div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">المحادثة ما زالت تعمل. حاول تحميل بياناتك المحفوظة مرة أخرى.</p>
                  <button type="button" onClick={() => todayQuery.refetch()} className="mt-3 text-xs font-semibold text-destructive underline underline-offset-4" data-testid="button-retry-context">حاول مرة أخرى</button>
                </div>
              )}
              {!todayQuery.isLoading && !todayQuery.isError && context && (
                <div className="scrollbar-thin space-y-7 overflow-y-auto pb-5">
                  <ContextBlock icon={<Clock3 className="size-3.5" />} title="القادم" count={context.upcomingReminders.length}>
                    {context.upcomingReminders.length === 0 ? <EmptyLine>لا توجد تذكيرات قادمة.</EmptyLine> : context.upcomingReminders.slice(0, 3).map((reminder) => (
                      <div key={reminder.id} className="border-r-2 border-accent/65 pr-3" data-testid={`reminder-${reminder.id}`}>
                        <p className="text-sm leading-snug">{reminder.text}</p>
                        <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{formatTime(reminder.dueAt)} · {reminder.status}</p>
                      </div>
                    ))}
                  </ContextBlock>

                  <ContextBlock icon={<ListChecks className="size-3.5" />} title="المهام" count={context.pendingTasks.length}>
                    {context.pendingTasks.length === 0 ? <EmptyLine>لا توجد مهام معلقة.</EmptyLine> : context.pendingTasks.slice(0, 4).map((task) => (
                      <div key={task.id} className="flex items-start gap-2.5" data-testid={`task-${task.id}`}>
                        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-border bg-background"><Check className="size-2.5 text-muted-foreground" /></span>
                        <div className="min-w-0"><p className="text-sm leading-snug">{task.title}</p><p className="mt-1 font-mono text-[10px] tracking-wide text-muted-foreground">{task.dueAt ? formatTime(task.dueAt) : 'بدون موعد'}</p></div>
                      </div>
                    ))}
                  </ContextBlock>

                  <ContextBlock icon={<DollarSign className="size-3.5" />} title="أحدث المصروفات" count={context.recentExpenses.length}>
                    {context.recentExpenses.length === 0 ? <EmptyLine>لا توجد مصروفات محفوظة.</EmptyLine> : context.recentExpenses.slice(0, 3).map((expense) => (
                      <div key={expense.id} className="flex items-center justify-between gap-3" data-testid={`expense-${expense.id}`}>
                        <div className="min-w-0"><p className="truncate text-sm">{expense.description}</p><p className="mt-1 text-xs text-muted-foreground">{expense.projectName ?? expense.personName ?? formatTime(expense.occurredAt)}</p></div>
                        <p className="shrink-0 font-mono text-xs">{money(expense.amountMinor, expense.currency)}</p>
                      </div>
                    ))}
                  </ContextBlock>

                  <div className="grid grid-cols-2 gap-3">
                    <MiniStat icon={<Sparkles className="size-3.5" />} label="المشاريع" value={context.activeProjects.length} testId="stat-projects" />
                    <MiniStat icon={<UsersRound className="size-3.5" />} label="الأشخاص" value={context.relevantPeople.length} testId="stat-people" />
                  </div>
                </div>
              )}
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}

function ContextBlock({ icon, title, count, children }: { icon: ReactNode; title: string; count: number; children: ReactNode }) {
  return (
    <section data-testid={`context-${title.toLowerCase().replaceAll(' ', '-')}`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em]">{title}</h3>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground/70">{String(count).padStart(2, '0')}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function MiniStat({ icon, label, value, testId }: { icon: ReactNode; label: string; value: number; testId: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 p-3" data-testid={testId}>
      <div className="flex items-center gap-2 text-muted-foreground">{icon}<span className="text-[10px] uppercase tracking-[0.14em]">{label}</span></div>
      <p className="mt-2 font-mono text-xl">{value}</p>
    </div>
  );
}

export default Home;