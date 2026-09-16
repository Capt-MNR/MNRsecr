import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  BadgeDollarSign,
  Check,
  CircleAlert,
  Clock3,
  Edit3,
  FolderKanban,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  Plus,
  RefreshCw,
  Trash2,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import {
  getGetTodayContextQueryKey,
  getListRecordsQueryKey,
  useApproveSecretaryOperation,
  useCreateRecord,
  useDeleteRecord,
  useListRecords,
  useListFinancialParties,
  useListFinancialObligations,
  useListFinancialPayments,
  useListDonations,
  useListIncomeReceivables,
  useRejectSecretaryOperation,
  useUpdateRecord,
} from '@workspace/api-client-react';
import type {
  ApprovalRequest,
  ApprovalResponse,
  CommitmentRecord,
  RecordCreateInput,
  ExpenseRecord,
  PersonRecord,
  ProjectRecord,
  RecordUpdateInput,
  RecordMutationResponse,
  RecordType,
  ReminderRecord,
  TaskRecord,
} from '@workspace/api-client-react';
import { classifySecretaryError } from '../lib/secretary-errors';
import { RECORD_REFRESH_FAILURE_MESSAGE, resolveRecordForEditing } from '../lib/record-editing';
import { useLocation } from 'wouter';
import ApprovalForm from '../components/approval-form';
import { entityPath, financialRecordPath } from '../components/graph/context-link';

type RecordItem = ExpenseRecord | PersonRecord | ProjectRecord | TaskRecord | ReminderRecord | CommitmentRecord;
type RecordOrigin = { conversationId: string; turnId?: string | null; operationId?: string | null };
type Tab = 'expenses' | 'people' | 'projects' | 'tasks' | 'reminders' | 'commitments' | 'financial';

const tabs: Array<{ id: Tab; label: string; icon: typeof WalletCards }> = [
  { id: 'expenses', label: 'المصروفات', icon: WalletCards },
  { id: 'people', label: 'الأشخاص', icon: UserRound },
  { id: 'projects', label: 'المشاريع', icon: FolderKanban },
  { id: 'tasks', label: 'المهام', icon: ListChecks },
  { id: 'reminders', label: 'التذكيرات', icon: Clock3 },
  { id: 'commitments', label: 'الالتزامات', icon: Archive },
  { id: 'financial', label: 'الماليات', icon: BadgeDollarSign },
];

const tabGroups: Array<{ label: string; tabs: Tab[] }> = [
  { label: 'الأساسيات', tabs: ['expenses', 'people', 'projects'] },
  { label: 'المتابعة', tabs: ['tasks', 'reminders', 'commitments'] },
  { label: 'الماليات', tabs: ['financial'] },
];

function formatDate(value: string | null | undefined) {
  if (!value) return 'بدون موعد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency }).format(amountMinor / 100);
}

function recordTypeForTab(tab: Tab): RecordType {
  return tab === 'expenses' ? 'expense'
    : tab === 'people' ? 'person'
      : tab === 'projects' ? 'project'
        : tab === 'tasks' ? 'task'
          : tab === 'reminders' ? 'reminder'
            : 'commitment';
}

function itemsFromFinancialQuery(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return [];
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items)
    ? items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    : [];
}

function financialText(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function financialMoney(value: unknown, currency: unknown) {
  const amount = typeof value === 'number' ? value : Number(value ?? 0);
  const code = typeof currency === 'string' && currency ? currency : 'EGP';
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: code }).format(amount / 100);
}

function FinancialRecords({ setLocation }: { setLocation: (path: string) => void }) {
  const parties = useListFinancialParties({ query: { queryKey: ['/api/financial/parties'], staleTime: 20_000 } });
  const obligations = useListFinancialObligations({ query: { queryKey: ['/api/financial/obligations'], staleTime: 20_000 } });
  const payments = useListFinancialPayments({ query: { queryKey: ['/api/financial/payments'], staleTime: 20_000 } });
  const donations = useListDonations({ query: { queryKey: ['/api/financial/donations'], staleTime: 20_000 } });
  const receivables = useListIncomeReceivables({ query: { queryKey: ['/api/financial/receivables'], staleTime: 20_000 } });
  const queries = [parties, obligations, payments, donations, receivables];
  const error = queries.find((query) => query.isError)?.error;
  const loading = queries.some((query) => query.isLoading);
  const partyItems = itemsFromFinancialQuery(parties.data);
  const obligationItems = itemsFromFinancialQuery(obligations.data);
  const paymentItems = itemsFromFinancialQuery(payments.data);
  const donationItems = itemsFromFinancialQuery(donations.data);
  const receivableItems = itemsFromFinancialQuery(receivables.data);
  const params = new URLSearchParams(location.search);
  const selectedType = params.get('financialType') as 'obligation' | 'payment' | 'donation' | 'receivable' | null;
  const selectedId = params.get('recordId');
  const groups = [
    { type: 'obligation' as const, label: 'السلف والديون', items: obligationItems },
    { type: 'payment' as const, label: 'المدفوعات الفعلية', items: paymentItems },
    { type: 'donation' as const, label: 'التبرعات', items: donationItems },
    { type: 'receivable' as const, label: 'الدخل والمستحقات', items: receivableItems },
  ];
  const selectedGroup = groups.find((group) => group.type === selectedType);
  const selectedRecord = selectedGroup?.items.find((item) => String(item.id) === selectedId);

  if (loading) {
    return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3, 4, 5, 6].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl bg-muted" />)}</div>;
  }
  if (error) {
    return <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-5 text-sm text-destructive" role="alert"><p>تعذر تحميل السجلات المالية.</p><button type="button" onClick={() => { void parties.refetch(); void obligations.refetch(); void payments.refetch(); void donations.refetch(); void receivables.refetch(); }} className="mt-3 inline-flex min-h-10 items-center gap-2 font-semibold underline underline-offset-4"><RefreshCw className="size-4" /> حاول مرة أخرى</button></div>;
  }
  const total = partyItems.length + obligationItems.length + paymentItems.length + donationItems.length + receivableItems.length;
  if (total === 0) {
    return <div className="rounded-[24px] border border-dashed border-border bg-card/50 px-6 py-16 text-center"><BadgeDollarSign className="mx-auto size-8 text-primary/60" /><h2 className="mt-4 font-serif text-xl">لا توجد سجلات مالية بعد</h2><p className="mt-2 text-sm text-muted-foreground">ستظهر الأطراف والسلف والمدفوعات والتبرعات والمستحقات هنا عند حفظها.</p></div>;
  }

  return (
    <div className="space-y-5">
      {selectedId && !selectedRecord && <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300" role="status">السجل المالي المطلوب لم يعد موجودًا أو لا ينتمي إلى مساحتك الحالية. يمكنك العودة إلى القائمة لاختيار سجل آخر.</div>}
      {selectedRecord && selectedGroup && <FinancialRecordFocus type={selectedGroup.type} item={selectedRecord} setLocation={setLocation} />}
      <div className="grid gap-5 lg:grid-cols-2">
      <FinancialRecordGroup title="الأطراف المالية" items={partyItems} onOpen={(item) => setLocation(`/financial/parties/${String(item.id)}`)} render={(item) => <><span>{financialText(item.name, 'طرف مالي')}</span><span className="text-xs text-muted-foreground">{financialText(item.partyType, 'طرف')}</span></>} />
      <FinancialRecordGroup title="السلف والديون" type="obligation" selectedId={selectedId} items={obligationItems} onOpen={(item) => setLocation(financialRecordPath('obligation', String(item.id)))} render={(item) => <><span>{financialText(item.title, item.kind === 'advance' ? 'سلفة' : 'دين')}</span><span className="font-mono">{financialMoney(item.principalAmountMinor, item.currency)}</span></>} />
      <FinancialRecordGroup title="المدفوعات الفعلية" type="payment" selectedId={selectedId} items={paymentItems} onOpen={(item) => setLocation(financialRecordPath('payment', String(item.id)))} render={(item) => <><span>{financialText(item.description, financialText(item.paymentKind, 'دفعة'))}</span><span className="font-mono">{financialMoney(item.amountMinor, item.currency)}</span></>} />
      <FinancialRecordGroup title="التبرعات" type="donation" selectedId={selectedId} items={donationItems} onOpen={(item) => setLocation(financialRecordPath('donation', String(item.id)))} render={(item) => <><span>{item.status === 'pledged' ? 'تعهد' : 'تبرع مدفوع'}</span><span className="font-mono">{financialMoney(item.amountMinor, item.currency)}</span></>} />
      <FinancialRecordGroup title="الدخل والمستحقات" type="receivable" selectedId={selectedId} items={receivableItems} onOpen={(item) => setLocation(financialRecordPath('receivable', String(item.id)))} render={(item) => <><span>{financialText(item.title, item.kind === 'income' ? 'دخل متوقع' : 'مستحق')}</span><span className="font-mono">{financialMoney(item.amountMinor, item.currency)}</span></>} />
      </div>
    </div>
  );
}

function FinancialRecordGroup({
  title,
  type,
  selectedId,
  items,
  onOpen,
  render,
}: {
  title: string;
  type?: 'obligation' | 'payment' | 'donation' | 'receivable';
  selectedId?: string | null;
  items: Array<Record<string, unknown>>;
  onOpen: (item: Record<string, unknown>) => void;
  render: (item: Record<string, unknown>) => ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-4 space-y-2">
        {items.map((item, index) => (
           <button type="button" key={String(item.id ?? index)} onClick={() => onOpen(item)} className={`flex w-full items-center justify-between gap-3 rounded-xl p-3 text-right text-sm transition hover:bg-primary/5 ${type && selectedId && String(item.id) === selectedId ? 'border border-primary/40 bg-primary/5' : 'bg-muted/50'}`} aria-current={type && selectedId && String(item.id) === selectedId ? 'true' : undefined}>
            {render(item)}
          </button>
        ))}
      </div>
    </section>
  );
}

function FinancialRecordFocus({
  type,
  item,
  setLocation,
}: {
  type: 'obligation' | 'payment' | 'donation' | 'receivable';
  item: Record<string, unknown>;
  setLocation: (path: string) => void;
}) {
  const labels = {
    obligation: 'التزام مالي',
    payment: 'دفعة مالية',
    donation: 'تبرع',
    receivable: 'مستحق مالي',
  };
  const parties: Array<[string, unknown]> = type === 'obligation'
    ? [['المُقرض', item.lenderPartyId], ['المقترض', item.borrowerPartyId]]
    : type === 'payment'
      ? [['الدافع', item.payerPartyId], ['المستفيد', item.payeePartyId]]
      : type === 'donation'
        ? [['المتبرع', item.donorPartyId], ['المستفيد', item.recipientPartyId]]
        : [['الدائن', item.creditorPartyId], ['المدين', item.debtorPartyId]];
  const amountValue = type === 'obligation' ? item.principalAmountMinor : item.amountMinor;
  const title = type === 'payment'
    ? financialText(item.description, financialText(item.paymentKind, labels[type]))
    : financialText(item.title, labels[type]);
  return (
    <section className="rounded-2xl border border-primary/25 bg-primary/5 p-5" aria-label="السجل المالي المحدد">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">السجل المحدد · {labels[type]}</p>
          <h2 className="mt-1 font-serif text-xl">{title}</h2>
          <p className="mt-2 font-mono text-lg font-semibold">{financialMoney(amountValue, item.currency)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{financialText(item.status, '') || (item.occurredAt ? String(item.occurredAt) : item.pledgedAt ? String(item.pledgedAt) : 'سجل محفوظ')}</p>
        </div>
        <button type="button" onClick={() => setLocation('/records?tab=financial')} className="min-h-10 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-primary">إظهار كل الماليات</button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-3">
        {parties.map(([label, value]) => typeof value === 'string' && value ? <button type="button" key={`${label}-${value}`} onClick={() => setLocation(entityPath('financial_party', value))} className="min-h-10 rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary">{label}: فتح الطرف المالي</button> : null)}
        {typeof item.projectId === 'string' && item.projectId && <button type="button" onClick={() => setLocation(entityPath('project', item.projectId as string))} className="min-h-10 rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary">فتح المشروع المرتبط</button>}
      </div>
    </section>
  );
}

function labelForRecord(record: RecordItem): string {
  if ('description' in record && typeof record.description === 'string') return record.description;
  if ('name' in record && typeof record.name === 'string') return record.name;
  if ('title' in record && typeof record.title === 'string') return record.title;
  return typeof record.text === 'string' ? record.text : 'سجل محفوظ';
}

function recordId(record: RecordItem) {
  return record.id;
}

function recordOrigin(record: RecordItem): RecordOrigin | null {
  if (!('origin' in record) || !record.origin || typeof record.origin !== 'object') return null;
  const origin = record.origin as Record<string, unknown>;
  return typeof origin.conversationId === 'string' ? {
    conversationId: origin.conversationId,
    turnId: typeof origin.turnId === 'string' ? origin.turnId : null,
    operationId: typeof origin.operationId === 'string' ? origin.operationId : null,
  } : null;
}

function conversationPath(origin: RecordOrigin) {
  const params = new URLSearchParams({ conversationId: origin.conversationId });
  if (origin.turnId) params.set('turnId', origin.turnId);
  return `/?${params.toString()}`;
}

function localDateTimeValue(value: Date) {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function labelForKind(kind: RecordType) {
  return {
    expense: 'مصروف',
    person: 'شخص',
    project: 'مشروع',
    task: 'مهمة',
    reminder: 'تذكير',
    commitment: 'التزام',
  }[kind];
}

function EditModal({
  kind,
  record,
  onClose,
  onSave,
  isSaving,
  people,
  projects,
  isCreate,
}: {
  kind: RecordType;
  record: RecordItem | null;
  onClose: () => void;
  onSave: (data: RecordUpdateInput | RecordCreateInput) => void;
  isSaving: boolean;
  people: PersonRecord[];
  projects: ProjectRecord[];
  isCreate: boolean;
}) {
  const expense = kind === 'expense' ? record as ExpenseRecord : undefined;
  const person = kind === 'person' ? record as PersonRecord : undefined;
  const project = kind === 'project' ? record as ProjectRecord : undefined;
  const task = kind === 'task' ? record as TaskRecord : undefined;
  const reminder = kind === 'reminder' ? record as ReminderRecord : undefined;
  const commitment = kind === 'commitment' ? record as CommitmentRecord : undefined;
  const [form, setForm] = useState<Record<string, string>>({
    amountMinor: expense ? String(expense.amountMinor) : '',
    currency: expense?.currency ?? 'EGP',
    description: expense?.description ?? '',
    personId: expense?.personId ?? '',
    projectId: expense?.projectId ?? '',
    occurredAt: expense?.occurredAt?.slice(0, 16) ?? localDateTimeValue(new Date()),
    name: person?.name ?? project?.name ?? '',
    phone: person?.phone ?? '',
    notes: person?.notes ?? '',
    title: task?.title ?? commitment?.title ?? '',
    text: reminder?.text ?? '',
    dueAt: (task?.dueAt ?? reminder?.dueAt ?? commitment?.dueAt)?.slice(0, 16)
      ?? localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)),
    timezone: reminder?.timezone ?? 'Africa/Cairo',
    status: (project?.status ?? task?.status ?? reminder?.status ?? commitment?.status)
      ?? (kind === 'project' ? 'active' : kind === 'task' ? 'pending' : kind === 'reminder' ? 'scheduled' : 'open'),
  });

  function update(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    const data = (isCreate ? { recordType: kind } : {}) as RecordUpdateInput | RecordCreateInput;
    if (isCreate) {
      (data as RecordCreateInput).idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `record-${Date.now()}`;
    } else if (record && typeof record.rowVersion === 'number') {
      (data as RecordUpdateInput).expectedRowVersion = record.rowVersion;
    }
    if (kind === 'expense') {
      data.amountMinor = Number(form.amountMinor);
      data.currency = form.currency;
      data.description = form.description;
      data.personId = form.personId || null;
      data.projectId = form.projectId || null;
      data.occurredAt = new Date(form.occurredAt).toISOString();
    } else if (kind === 'person') {
      data.name = form.name;
      data.phone = form.phone || null;
      data.notes = form.notes || null;
    } else if (kind === 'project') {
      data.name = form.name;
      data.status = form.status;
    } else if (kind === 'task') {
      data.title = form.title;
      data.dueAt = form.dueAt ? new Date(form.dueAt).toISOString() : null;
      data.status = form.status;
    } else if (kind === 'reminder') {
      data.text = form.text;
      data.dueAt = new Date(form.dueAt).toISOString();
      data.timezone = form.timezone;
      data.status = form.status;
    } else {
      data.title = form.title;
      data.dueAt = form.dueAt ? new Date(form.dueAt).toISOString() : null;
      data.status = form.status;
    }
    onSave(data);
  }

  const textInput = (key: string, label: string, type = 'text') => (
    <label className="block">
      <span className="mb-1.5 block text-xs text-muted-foreground">{label}</span>
      <input
        type={type}
        value={form[key] ?? ''}
        onChange={(event) => update(key, event.target.value)}
        required={['amountMinor', 'currency', 'description', 'name', 'title', 'text'].includes(key)
          || (kind === 'reminder' && key === 'dueAt')}
        className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/35 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true">
      <form onSubmit={save} className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-[24px] border border-border bg-card p-5 shadow-2xl sm:p-7" dir="rtl">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{isCreate ? 'إضافة سجل يدويًا' : 'تعديل السجل'}</p>
            <h2 className="mt-1 font-serif text-2xl">{isCreate ? `إضافة ${labelForKind(kind)}` : labelForRecord(record!)}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-muted-foreground hover:bg-muted" aria-label="إغلاق">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4">
          {kind === 'expense' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {textInput('amountMinor', 'المبلغ بوحدات صغرى', 'number')}
                {textInput('currency', 'العملة')}
              </div>
              {textInput('description', 'الوصف')}
              <label className="block">
                <span className="mb-1.5 block text-xs text-muted-foreground">الشخص المستلم (اختياري)</span>
                <select value={form.personId} onChange={(event) => update('personId', event.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary">
                  <option value="">بدون شخص</option>
                  {people.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs text-muted-foreground">المشروع (اختياري)</span>
                <select value={form.projectId} onChange={(event) => update('projectId', event.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary">
                  <option value="">بدون مشروع</option>
                  {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              {textInput('occurredAt', 'تاريخ المصروف', 'datetime-local')}
            </>
          )}
          {(kind === 'person' || kind === 'project') && textInput('name', 'الاسم')}
          {kind === 'person' && (
            <>
              {textInput('phone', 'رقم الهاتف (اختياري)', 'tel')}
              <label className="block">
                <span className="mb-1.5 block text-xs text-muted-foreground">ملاحظات</span>
                <textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} rows={3} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" />
              </label>
            </>
          )}
          {kind === 'task' && textInput('title', 'عنوان المهمة')}
          {kind === 'commitment' && textInput('title', 'عنوان الالتزام')}
          {kind === 'reminder' && textInput('text', 'نص التذكير')}
          {(kind === 'task' || kind === 'reminder' || kind === 'commitment') && textInput('dueAt', 'الموعد', 'datetime-local')}
          {kind === 'reminder' && textInput('timezone', 'المنطقة الزمنية')}
          {(kind === 'project' || kind === 'task' || kind === 'reminder' || kind === 'commitment') && (
            <label className="block">
              <span className="mb-1.5 block text-xs text-muted-foreground">الحالة</span>
              <select value={form.status} onChange={(event) => update('status', event.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary">
                {(kind === 'project' ? ['active', 'archived'] : kind === 'task' ? ['pending', 'in_progress', 'completed', 'cancelled'] : kind === 'reminder' ? ['scheduled', 'completed', 'cancelled'] : ['open', 'completed', 'cancelled']).map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>
          )}
        </div>
         <div className="mt-7 flex gap-2">
          <button type="submit" disabled={isSaving} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
             {isSaving && <LoaderCircle className="size-4 animate-spin" />} {isCreate ? 'حفظ السجل' : 'حفظ التعديل'}
          </button>
          <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground hover:bg-muted">إلغاء</button>
        </div>
      </form>
    </div>
  );
}

function RecordCard({
  kind,
  record,
  onEdit,
  isRefreshing,
  onDelete,
  onOpen,
  setLocation,
}: {
  kind: RecordType;
  record: RecordItem;
  onEdit: () => void;
  isRefreshing: boolean;
  onDelete: () => void;
  onOpen?: () => void;
  setLocation: (path: string) => void;
}) {
  const expense = kind === 'expense' ? record as ExpenseRecord : undefined;
  const task = kind === 'task' ? record as TaskRecord : undefined;
  const reminder = kind === 'reminder' ? record as ReminderRecord : undefined;
  const commitment = kind === 'commitment' ? record as CommitmentRecord : undefined;
  const project = kind === 'project' ? record as ProjectRecord : undefined;
  const person = kind === 'person' ? record as PersonRecord : undefined;
  const origin = recordOrigin(record);
  const supportsConversationOrigin = kind === 'expense' || kind === 'task' || kind === 'reminder';
  const RecordIcon = kind === 'expense' ? WalletCards : kind === 'person' ? UserRound : kind === 'project' ? FolderKanban : kind === 'task' ? ListChecks : kind === 'reminder' ? Clock3 : Archive;
  return (
    <article className="group rounded-2xl border border-border/75 bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_18px_35px_-30px_hsl(var(--foreground)/.5)]">
      <div className="flex items-start justify-between gap-3">
         <div className="flex min-w-0 items-start gap-3">
           <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><RecordIcon className="size-4" /></span>
           <div className="min-w-0">
             {onOpen ? <button type="button" onClick={onOpen} className="truncate text-right text-[15px] font-semibold hover:text-primary" data-testid={`link-record-${record.id}`}>{labelForRecord(record)}</button> : <h3 className="truncate text-[15px] font-semibold">{labelForRecord(record)}</h3>}
             <p className="mt-1 text-xs text-muted-foreground">
               {expense ? `${expense.projectName ?? expense.personName ?? 'بدون ربط'} · ${formatDate(expense.occurredAt)}` : project ? `${project.status} · ${formatDate(project.updatedAt)}` : task ? `${task.status} · ${formatDate(task.dueAt)}` : reminder ? `${reminder.status} · ${formatDate(reminder.dueAt)}` : commitment ? `${commitment.status} · ${formatDate(commitment.dueAt)}` : formatDate(record.createdAt)}
             </p>
           </div>
        </div>
        <div className="flex shrink-0 gap-1 opacity-70 transition group-hover:opacity-100">
           <button type="button" onClick={onEdit} disabled={isRefreshing} className="rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:cursor-wait disabled:opacity-50" aria-label={isRefreshing ? 'تحديث السجل قبل التعديل' : 'تعديل'} aria-busy={isRefreshing}>
             {isRefreshing ? <LoaderCircle className="size-3.5 animate-spin" /> : <Edit3 className="size-3.5" />}
           </button>
          <button type="button" onClick={onDelete} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="حذف"><Trash2 className="size-3.5" /></button>
        </div>
      </div>
      {expense && <p className="mt-4 font-mono text-lg font-semibold">{money(expense.amountMinor, expense.currency)}</p>}
       {person?.phone && <a href={`tel:${person.phone}`} className="mt-3 inline-flex min-h-9 items-center rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary" data-testid={`link-person-phone-${person.id}`}>هاتف: {person.phone}</a>}
      {expense && (expense.personId || expense.projectId) && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border/60 pt-3">
          {expense.personId && <button type="button" onClick={() => setLocation(entityPath('person', expense.personId!))} className="min-h-9 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary">الشخص: {expense.personName ?? 'فتح الشخص'}</button>}
          {expense.projectId && <button type="button" onClick={() => setLocation(entityPath('project', expense.projectId!))} className="min-h-9 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary">المشروع: {expense.projectName ?? 'فتح المشروع'}</button>}
        </div>
      )}
      {commitment?.personId && (
        <button type="button" onClick={() => setLocation(entityPath('person', commitment.personId!))} className="mt-3 min-h-9 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary">الشخص المرتبط: {commitment.personName ?? 'فتح الشخص'}</button>
      )}
      {('notes' in record && typeof record.notes === 'string' && record.notes) && <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{record.notes}</p>}
      {kind === 'reminder' && reminder && <p className="mt-3 text-xs text-muted-foreground">{reminder.timezone}</p>}
      {origin ? (
        <button type="button" onClick={() => setLocation(conversationPath(origin))} className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 text-xs font-medium text-primary hover:border-primary/40 hover:bg-primary/10" data-testid={`link-record-origin-${record.id}`}>
          <MessageSquareText className="size-3.5" /> فتح المحادثة الأصلية
        </button>
      ) : supportsConversationOrigin ? (
        <p className="mt-3 text-[11px] text-muted-foreground/75">أضيف يدويًا أو قبل تفعيل ربط المحادثات</p>
      ) : null}
    </article>
  );
}

export default function Records() {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const initialTab = new URLSearchParams(window.location.search).get('tab');
  const [tab, setTab] = useState<Tab>(tabs.some((item) => item.id === initialTab) ? initialTab as Tab : 'expenses');
  const [editing, setEditing] = useState<{ kind: RecordType; record: RecordItem } | null>(null);
  const [creating, setCreating] = useState<RecordType | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{ kind: RecordType; recordId: string; approval: ApprovalRequest } | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [staleRecordMessage, setStaleRecordMessage] = useState<string | null>(null);
  const [refreshingRecordId, setRefreshingRecordId] = useState<string | null>(null);
  const recordsQuery = useListRecords({ query: { queryKey: getListRecordsQueryKey(), staleTime: 20_000 } });
  const createMutation = useCreateRecord();
  const updateMutation = useUpdateRecord();
  const deleteMutation = useDeleteRecord();
  const approveMutation = useApproveSecretaryOperation();
  const rejectMutation = useRejectSecretaryOperation();
  const error = recordsQuery.isError
    ? classifySecretaryError(recordsQuery.error)
    : createMutation.isError
      ? classifySecretaryError(createMutation.error)
      : updateMutation.isError
        ? classifySecretaryError(updateMutation.error)
        : deleteMutation.isError
          ? classifySecretaryError(deleteMutation.error)
          : null;
  const data = recordsQuery.data;
  const currentRecords = useMemo(() => tab === 'financial' ? [] : data?.[tab] ?? [], [data, tab]) as RecordItem[];
  const kind = recordTypeForTab(tab === 'financial' ? 'expenses' : tab);

  useEffect(() => {
    const nextTab = new URLSearchParams(window.location.search).get('tab');
    if (nextTab && tabs.some((item) => item.id === nextTab)) setTab(nextTab as Tab);
  }, [location]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const recordId = params.get('recordId');
    if (!recordId || tab === 'financial' || recordsQuery.isLoading || !data) return;
    const target = (data[tab] ?? []).find((record) => record.id === recordId) as RecordItem | undefined;
    params.delete('recordId');
    setLocation(`${params.toString() ? `/records?${params.toString()}` : '/records'}`);
    if (target) {
      setStaleRecordMessage(null);
      setEditing({ kind, record: target });
    } else {
      setStaleRecordMessage('السجل المطلوب لم يعد موجودًا أو لا ينتمي إلى مساحتك الحالية.');
    }
  }, [data, kind, location, recordsQuery.isLoading, setLocation, tab]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: getListRecordsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayContextQueryKey() });
  }

  function handleMutationResult(response: RecordMutationResponse, kind: RecordType, recordId: string) {
    if (response.pendingApproval && response.approval) {
      setApprovalError(null);
      setPendingApproval({ kind, recordId, approval: response.approval });
      setEditing(null);
      return;
    }
    setEditing(null);
    refresh();
  }

  function handleCreateResult(response: RecordMutationResponse, kind: RecordType) {
    if (response.pendingApproval && response.approval) {
      setApprovalError(null);
      setPendingApproval({ kind, recordId: response.recordId, approval: response.approval });
      setCreating(null);
      return;
    }
    setCreating(null);
    refresh();
  }

  function applyApprovalResponse(response: ApprovalResponse) {
    setPendingApproval((current) => current
      ? { ...current, approval: { ...current.approval, status: response.status } }
      : current);
    setApprovalError(null);
    if (response.status === 'completed') refresh();
  }

  function approvePending() {
    if (!pendingApproval || approveMutation.isPending || rejectMutation.isPending) return;
    setApprovalError(null);
    approveMutation.mutate(
      { operationId: pendingApproval.approval.operationId },
      {
        onSuccess: applyApprovalResponse,
        onError: (error) => setApprovalError(classifySecretaryError(error)?.message ?? 'تعذر تنفيذ الموافقة.'),
      },
    );
  }

  function rejectPending() {
    if (!pendingApproval || approveMutation.isPending || rejectMutation.isPending) return;
    setApprovalError(null);
    rejectMutation.mutate(
      { operationId: pendingApproval.approval.operationId },
      {
        onSuccess: applyApprovalResponse,
        onError: (error) => setApprovalError(classifySecretaryError(error)?.message ?? 'تعذر إلغاء العملية.'),
      },
    );
  }

  function deleteItem(record: RecordItem) {
    if (!window.confirm(`هل تريد حذف "${labelForRecord(record)}"؟ لا يمكن استرجاعه بعد الحذف.`)) return;
    deleteMutation.mutate(
      { recordType: kind, recordId: recordId(record) },
      { onSuccess: (response) => handleMutationResult(response, kind, recordId(record)) },
    );
  }

  async function editItem(record: RecordItem) {
    setStaleRecordMessage(null);
    updateMutation.reset();
    deleteMutation.reset();
    setRefreshingRecordId(record.id);
    try {
      const latest = await recordsQuery.refetch();
      const latestRecords = (tab === 'financial' ? [] : latest.data?.[tab] ?? []) as RecordItem[];
      const decision = resolveRecordForEditing(
        { isSuccess: latest.isSuccess, data: latest.data ? latestRecords : undefined },
        record.id,
      );
      if (decision.status === 'refresh_failed') {
        setStaleRecordMessage(RECORD_REFRESH_FAILURE_MESSAGE);
        return;
      }
      if (decision.status === 'missing') {
        setStaleRecordMessage('تم تحديث القائمة لأن هذا السجل لم يعد متاحًا للتعديل.');
        return;
      }
      setEditing({ kind, record: decision.record });
    } catch {
      setStaleRecordMessage(RECORD_REFRESH_FAILURE_MESSAGE);
    } finally {
      setRefreshingRecordId(null);
    }
  }

  function openCreate() {
    if (tab === 'financial') {
      setTab('expenses');
      return;
    }
    createMutation.reset();
    updateMutation.reset();
    deleteMutation.reset();
    setCreating(kind);
  }

  return (
    <div dir="rtl" lang="ar" className="grain min-h-[100dvh] bg-background text-foreground">
      <main className="mx-auto min-h-[100dvh] max-w-[1240px] px-4 py-6 sm:px-8 sm:py-10">
         <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
             <button type="button" onClick={() => setLocation('/')} className="inline-flex min-h-10 items-center rounded-lg text-xs text-muted-foreground transition hover:text-primary" data-testid="link-records-conversation">← العودة للمحادثة</button>
            <p className="mt-6 text-xs uppercase tracking-[0.2em] text-muted-foreground">Structured Memory</p>
            <h1 className="mt-2 font-serif text-3xl tracking-tight sm:text-4xl">سجلاتك المحفوظة</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">المحادثة تساعدك على الفهم، لكن هذه السجلات هي المصدر الأساسي لبياناتك. عدّلها أو احذفها مع مراجعة واضحة.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={openCreate} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              <Plus className="size-4" /> إضافة سجل
            </button>
            <button type="button" onClick={() => recordsQuery.refetch()} disabled={recordsQuery.isFetching} className="rounded-xl border border-border bg-card p-3 text-muted-foreground hover:bg-muted disabled:opacity-50" aria-label="تحديث السجلات">
              <RefreshCw className={`size-4 ${recordsQuery.isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

         <nav className="mb-7 grid gap-3 sm:grid-cols-3" aria-label="أنواع السجلات">
           {tabGroups.map((group) => (
             <div key={group.label} className="rounded-2xl border border-border/70 bg-card/45 p-2">
               <p className="px-2 pb-1 text-[11px] font-semibold text-muted-foreground">{group.label}</p>
               <div className="scrollbar-thin flex gap-1.5 overflow-x-auto">
                 {group.tabs.map((id) => {
                   const tabInfo = tabs.find((item) => item.id === id)!;
                   const Icon = tabInfo.icon;
                   return (
                     <button key={id} type="button" onClick={() => setTab(id)} className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-primary'}`} data-testid={`tab-records-${id}`}>
                       <Icon className="size-3.5" /> {tabInfo.label} {id !== 'financial' && <span className={tab === id ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}>{data?.[id]?.length ?? 0}</span>}
                     </button>
                   );
                 })}
               </div>
             </div>
           ))}
        </nav>

        {tab === 'financial' ? <FinancialRecords setLocation={setLocation} /> : <>
          {recordsQuery.isLoading && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3, 4, 5, 6].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl bg-muted" />)}</div>}
          {staleRecordMessage && <div className="mb-5 flex items-center gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300" role="status"><CircleAlert className="size-4" /> {staleRecordMessage}</div>}
           {error && <div className="mb-5 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive" role="alert"><div className="flex items-center gap-2"><CircleAlert className="size-4" /> {error.message}</div><button type="button" onClick={() => void recordsQuery.refetch()} className="mt-3 text-xs font-semibold underline underline-offset-4">حاول مرة أخرى</button></div>}
          {!recordsQuery.isLoading && !error && currentRecords.length === 0 && <div className="rounded-[24px] border border-dashed border-border bg-card/50 px-6 py-16 text-center"><Check className="mx-auto size-8 text-primary/60" /><h2 className="mt-4 font-serif text-xl">لا توجد سجلات هنا بعد</h2><p className="mt-2 text-sm text-muted-foreground">يمكنك إضافة أول سجل يدويًا أو من خلال المحادثة.</p><button type="button" onClick={openCreate} className="mx-auto mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"><Plus className="size-4" /> إضافة {labelForKind(kind)}</button></div>}
            {!recordsQuery.isLoading && currentRecords.length > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{currentRecords.map((record) => <RecordCard key={record.id} kind={kind} record={record} setLocation={setLocation} isRefreshing={refreshingRecordId === record.id} onEdit={() => void editItem(record)} onDelete={() => deleteItem(record)} onOpen={kind === 'person' ? () => setLocation(entityPath('person', record.id)) : kind === 'project' ? () => setLocation(entityPath('project', record.id)) : undefined} />)}</div>}
        </>}
      </main>
      {creating && <EditModal kind={creating} record={null} isCreate people={data?.people ?? []} projects={data?.projects ?? []} onClose={() => setCreating(null)} isSaving={createMutation.isPending} onSave={(form) => createMutation.mutate({ data: form as RecordCreateInput }, { onSuccess: (response) => handleCreateResult(response, creating) })} />}
      {editing && <EditModal kind={editing.kind} record={editing.record} isCreate={false} people={data?.people ?? []} projects={data?.projects ?? []} onClose={() => setEditing(null)} isSaving={updateMutation.isPending} onSave={(form) => updateMutation.mutate({ recordType: editing.kind, recordId: editing.record.id, data: form as RecordUpdateInput }, { onSuccess: (response) => handleMutationResult(response, editing.kind, editing.record.id) })} />}
      {pendingApproval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/35 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-[24px] border border-border bg-card p-5 shadow-2xl sm:p-7" dir="rtl">
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">مراجعة قبل الحفظ</p>
                <h2 className="mt-1 font-serif text-2xl">{pendingApproval.approval.display.title}</h2>
                <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                  {pendingApproval.approval.display.details.map((detail) => <li key={detail}>{detail}</li>)}
                </ul>
              </div>
            </div>
            <ApprovalForm
              operationId={pendingApproval.approval.operationId}
              toolName={pendingApproval.approval.toolName}
              initialArgs={{}}
              display={pendingApproval.approval.display}
              status={pendingApproval.approval.status}
               allowArgsOverride={false}
              busy={approveMutation.isPending || rejectMutation.isPending}
              error={approvalError}
               onConfirm={() => {
                if (!pendingApproval || approveMutation.isPending || rejectMutation.isPending) return;
                approveMutation.mutate(
                   { operationId: pendingApproval.approval.operationId },
                  { onSuccess: applyApprovalResponse, onError: (approvalErrorValue) => setApprovalError(classifySecretaryError(approvalErrorValue)?.message ?? 'تعذر تنفيذ الموافقة.') },
                );
              }}
              onReject={rejectPending}
            />
            {approvalError && <p className="mt-3 text-sm text-destructive" role="alert">{approvalError}</p>}
            <button type="button" onClick={() => setPendingApproval(null)} className="mt-5 w-full rounded-xl border border-border px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted">
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  );
}