import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowUp,
  CircleAlert,
  LoaderCircle,
  Menu,
  MessageSquareText,
  PanelRight,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import {
  getGetTodayContextQueryKey,
  getGetSecretaryOperationQueryKey,
  getHealthCheckQueryKey,
  useApproveSecretaryOperation,
  useCreateTurn,
  useGetTodayContext,
  useHealthCheck,
  useListDonations,
  useListFinancialObligations,
  useListFinancialPayments,
  useListIncomeReceivables,
  useRejectSecretaryOperation,
} from '@workspace/api-client-react';
import type { ConversationDetail } from '@workspace/api-client-react';
import { classifySecretaryError } from '../lib/secretary-errors';
import ConversationHistory from '../components/conversation-history';
import ApprovalForm from '../components/approval-form';
import { Link, useLocation, useSearch } from 'wouter';
import SecretaryDashboard from '../components/secretary-dashboard';

type LocalMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  time: string;
  meta?: string;
  turnId?: string;
  facts?: Array<{ type: 'money' | 'count'; value: number; currency?: string; label?: string }>;
  approval?: {
    operationId: string;
    toolName: string;
    initialArgs: Record<string, unknown>;
    title: string;
    details: string[];
    personCandidates?: Array<{ id: string; name: string; status: string }>;
    projectCandidates?: Array<{ id: string; name: string; status: string }>;
    status: 'pending' | 'executing' | 'completed' | 'rejected' | 'expired' | 'failed';
  };
};
type ApprovalStatus = NonNullable<LocalMessage['approval']>['status'];

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

function approvalFromAction(action: Record<string, unknown> | undefined): LocalMessage['approval'] | undefined {
  if (!action || action.type !== 'approval_required' || typeof action.operationId !== 'string') return undefined;
  const display = action.display && typeof action.display === 'object'
    ? action.display as { title?: unknown; details?: unknown }
    : {};
  return {
    operationId: action.operationId,
    toolName: typeof action.toolName === 'string' ? action.toolName : 'record_expense',
    initialArgs: action.args && typeof action.args === 'object'
      ? action.args as Record<string, unknown>
      : {},
    title: typeof display.title === 'string' ? display.title : 'تأكيد التغيير',
    details: Array.isArray(display.details)
      ? display.details.filter((detail): detail is string => typeof detail === 'string')
      : [],
    ...(Array.isArray(action.personCandidates) ? { personCandidates: action.personCandidates as Array<{ id: string; name: string; status: string }> } : {}),
    ...(Array.isArray(action.projectCandidates) ? { projectCandidates: action.projectCandidates as Array<{ id: string; name: string; status: string }> } : {}),
    status: typeof action.status === 'string' && ['pending', 'executing', 'completed', 'rejected', 'expired', 'failed'].includes(action.status)
      ? action.status as ApprovalStatus
      : 'pending',
  };
}

function Home() {
  const [location, setLocation] = useLocation();
  const searchString = useSearch();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [askContext, setAskContext] = useState<{ entityType: string; entityId: string; entityName: string; } | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();

  const [isContextOpen, setIsContextOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const [highlightedTurnId, setHighlightedTurnId] = useState<string | undefined>();
  const [messages, setMessages] = useState<LocalMessage[]>([starterMessage]);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<ReturnType<typeof classifySecretaryError> | null>(null);
  const sendingRef = useRef(false);

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
  const obligationsQuery = useListFinancialObligations({
    query: { queryKey: ['/api/financial/obligations'], staleTime: 30_000 },
  });
  const paymentsQuery = useListFinancialPayments({
    query: { queryKey: ['/api/financial/payments'], staleTime: 30_000 },
  });
  const donationsQuery = useListDonations({
    query: { queryKey: ['/api/financial/donations'], staleTime: 30_000 },
  });
  const receivablesQuery = useListIncomeReceivables({
    query: { queryKey: ['/api/financial/receivables'], staleTime: 30_000 },
  });
  const createTurn = useCreateTurn({
    request: { timeoutMs: 90_000 },
  });
  const approveOperation = useApproveSecretaryOperation({
    request: { timeoutMs: 90_000 },
  });
  const rejectOperation = useRejectSecretaryOperation({
    request: { timeoutMs: 90_000 },
  });
  const approvalOperationQueries = messages
    .filter((message) => Boolean(message.approval?.operationId))
    .map((message) => message.approval!.operationId);
  const context = todayQuery.data?.context;
  const sendErrorMessage = sendError?.category === 'timeout'
    ? 'لم يصل الرد في الوقت المتوقع. قد يكون الطلب ما زال قيد التنفيذ؛ لا تعيد إرسال طلب حفظ الآن، وتحقق من السجلات أولًا.'
    : sendError?.message;

  const dateLabel = useMemo(
    () => formatDate(context?.asOf ?? new Date().toISOString()),
    [context?.asOf],
  );
  
  useEffect(() => {
    if (searchString) {
      const searchParams = new URLSearchParams(searchString);
      const linkedConversationId = searchParams.get('conversationId');
      const linkedTurnId = searchParams.get('turnId');
      if (linkedConversationId) {
        setSelectedConversationId(linkedConversationId);
        setHighlightedTurnId(linkedTurnId ?? undefined);
      }
      const askParam = searchParams.get('ask');
      const entityTypeParam = searchParams.get('entityType');
      const entityIdParam = searchParams.get('entityId');
      const entityNameParam = searchParams.get('entityName');

      if (askParam) {
        setDraft(askParam);
        if (entityTypeParam && entityIdParam && entityNameParam) {
          setAskContext({ entityType: entityTypeParam, entityId: entityIdParam, entityName: entityNameParam });
        }
        // Remove from URL without page reload using wouter
        setLocation(location, { replace: true });
      }
    }
  }, [searchString]);

  useEffect(() => {
    if (!highlightedTurnId) return;
    const target = [...document.querySelectorAll<HTMLElement>('[data-turn-id]')]
      .find((element) => element.dataset.turnId === highlightedTurnId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightedTurnId, messages]);

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
          ...(turn.turnId ? { turnId: turn.turnId } : {}),
      });
      loadedMessages.push({
        id: `${detail.conversationId}-assistant-${index}`,
        role: 'assistant',
        text: turn.assistantMessage,
        time: formatTime(turn.createdAt),
        meta: 'من سجل المحادثة',
          ...(turn.turnId ? { turnId: turn.turnId } : {}),
        ...(turn.action ? { approval: approvalFromAction(turn.action as Record<string, unknown>) } : {}),
      });
    });
    setMessages(loadedMessages.length > 0 ? loadedMessages : [starterMessage]);
  }, []);

  function startNewConversation() {
    setConversationId(undefined);
    setSelectedConversationId(undefined);
    setHighlightedTurnId(undefined);
    setMessages([starterMessage]);
    setIsHistoryOpen(false);
  }

  function sendMessage(value = draft) {
    const message = value.trim();
    if (!message || createTurn.isPending || sendingRef.current) return;
    sendingRef.current = true;
    setSendError(null);
    const sentAt = new Date().toISOString();
    setDraft('');
    setAskContext(null);
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
          sendingRef.current = false;
          setSendError(null);
          const approval = approvalFromAction(response.action);
          setConversationId(response.conversationId);
          setSelectedConversationId(response.conversationId);
          setApprovalError(null);
          setMessages((current) => [
            ...current,
            {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
               text: response.response?.message ?? response.assistantMessage,
              time: formatTime(new Date().toISOString()),
              meta: response.provider ? `${response.provider} · ${response.model}` : 'سكرتيرك الخاص',
               ...(response.response?.groundedFacts ? { facts: response.response.groundedFacts } : {}),
              ...(approval ? { approval } : {}),
            },
          ]);
          queryClient.invalidateQueries({ queryKey: getGetTodayContextQueryKey() });
          queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
        },
        onError: (error) => {
          sendingRef.current = false;
          setSendError(classifySecretaryError(error));
        },
      },
    );
  }

  function handleApprovalResponse(response: {
    operationId: string;
    status: ApprovalStatus;
    assistantMessage: string;
  }) {
    setApprovalError(null);
    setMessages((current) => current.map((message) => (
      message.approval?.operationId === response.operationId
        ? {
            ...message,
            text: response.assistantMessage,
            approval: { ...message.approval, status: response.status },
          }
        : message
    )));
    queryClient.invalidateQueries({ queryKey: getGetTodayContextQueryKey() });
    queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
  }

  function approve(operationId: string, args?: Record<string, unknown>) {
    if (approveOperation.isPending || rejectOperation.isPending) return;
    setApprovalError(null);
    approveOperation.mutate(
      args ? { operationId, data: { args } } : { operationId },
      {
        onSuccess: handleApprovalResponse,
        onError: (error) => {
          setApprovalError(classifySecretaryError(error)?.message ?? 'تعذر تنفيذ الموافقة.');
          approvalOperationQueries.forEach((id) => {
            queryClient.invalidateQueries({ queryKey: getGetSecretaryOperationQueryKey(id) });
          });
        },
      },
    );
  }

  function reject(operationId: string) {
    if (approveOperation.isPending || rejectOperation.isPending) return;
    setApprovalError(null);
    rejectOperation.mutate(
      { operationId },
      {
        onSuccess: handleApprovalResponse,
        onError: (error) => setApprovalError(classifySecretaryError(error)?.message ?? 'تعذر إلغاء العملية.'),
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
              <Link
                href="/records"
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                data-testid="link-records-home"
              >
                <Archive className="size-4" />
                <span className="hidden sm:inline">السجلات</span>
              </Link>
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
                      style={{ animationDelay: `${Math.min(index * 70, 350)}ms` }}
                      data-testid={`message-${message.role}-${message.id}`}
                      data-turn-id={message.turnId}
                      data-highlighted={message.turnId === highlightedTurnId ? 'true' : undefined}
                      className={`animate-rise-in flex gap-3.5 ${message.role === 'user' ? 'justify-start' : 'justify-end'} ${message.turnId === highlightedTurnId ? 'rounded-2xl ring-2 ring-primary/40 ring-offset-4 ring-offset-background' : ''}`}
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
                           {message.facts && message.facts.length > 0 && (
                             <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-2" aria-label="حقائق مؤكدة">
                               {message.facts.map((fact, factIndex) => (
                                 <span key={`${fact.label ?? fact.type}-${factIndex}`} className="rounded-full bg-primary/8 px-2 py-1 text-[11px] text-primary">
                                   {fact.type === 'money' ? money(fact.value, fact.currency ?? 'EGP') : fact.value}
                                   {fact.label ? ` · ${fact.label}` : ''}
                                 </span>
                               ))}
                             </div>
                           )}
                        </div>
                        <div className={`mt-1.5 flex items-center gap-2 px-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70 ${message.role === 'user' ? 'justify-end' : ''}`}>
                          <span>{message.time}</span>
                          {message.meta && <><span>·</span><span>{message.meta}</span></>}
                          {message.turnId === highlightedTurnId && <><span>·</span><MessageSquareText className="size-3 text-primary" /><span className="text-primary">السياق المرتبط</span></>}
                        </div>
                         {message.approval && (
                          <div
                            className="mt-3 rounded-2xl border border-primary/20 bg-primary/5 p-3 text-right"
                            data-testid={`approval-${message.approval.operationId}`}
                          >
                            <div className="flex items-start gap-2">
                              <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-foreground">{message.approval.title}</p>
                                {message.approval.status !== 'pending' && message.approval.details.length > 0 && (
                                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                                    {message.approval.details.map((detail) => <li key={detail}>{detail}</li>)}
                                  </ul>
                                )}
                              </div>
                            </div>
                            <ApprovalForm
                              operationId={message.approval.operationId}
                              toolName={message.approval.toolName}
                              initialArgs={message.approval.initialArgs}
                              display={{
                                title: message.approval.title,
                                details: message.approval.details,
                              }}
                              status={message.approval.status}
                               allowArgsOverride={message.approval.toolName === 'record_expense' || message.approval.toolName === 'create_reminder'}
                              personCandidates={message.approval.personCandidates}
                              projectCandidates={message.approval.projectCandidates}
                              busy={approveOperation.isPending || rejectOperation.isPending}
                              error={approvalError}
                              onConfirm={(args) => approve(message.approval!.operationId, args)}
                              onReject={() => reject(message.approval!.operationId)}
                            />
                            {approvalError && message.approval.status === 'pending' && (
                              <p className="mt-2 text-xs text-destructive" role="alert">{approvalError}</p>
                            )}
                          </div>
                        )}
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
                      {sendErrorMessage}
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
                  {askContext && (
                    <div className="mb-2 flex items-center justify-between rounded-lg bg-primary/5 px-3 py-1.5 text-xs text-primary">
                      <div className="flex items-center gap-2">
                        <Sparkles className="size-3.5" />
                        <span>سؤال عن: <strong>{askContext.entityName}</strong></span>
                      </div>
                      <button 
                        type="button" 
                        onClick={() => setAskContext(null)} 
                        className="rounded-full p-1 hover:bg-primary/10"
                        aria-label="إلغاء السياق"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  )}
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
              <SecretaryDashboard
                todayQuery={todayQuery}
                healthQuery={healthQuery}
                obligationsQuery={obligationsQuery}
                paymentsQuery={paymentsQuery}
                receivablesQuery={receivablesQuery}
                donationsQuery={donationsQuery}
                pendingApprovals={messages
                  .filter((m) => m.approval?.status === 'pending')
                  .map((m) => ({
                    operationId: m.approval!.operationId,
                    title: m.approval!.title,
                    toolName: m.approval!.toolName,
                  }))}
                onNavigate={(path) => setLocation(path)}
              />
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}

export default Home;