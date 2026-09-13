import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Check,
  CircleAlert,
  Clock3,
  Edit3,
  FolderKanban,
  ListChecks,
  LoaderCircle,
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

type RecordItem = ExpenseRecord | PersonRecord | ProjectRecord | TaskRecord | ReminderRecord | CommitmentRecord;
type Tab = 'expenses' | 'people' | 'projects' | 'tasks' | 'reminders' | 'commitments';

const tabs: Array<{ id: Tab; label: string; icon: typeof WalletCards }> = [
  { id: 'expenses', label: 'المصروفات', icon: WalletCards },
  { id: 'people', label: 'الأشخاص', icon: UserRound },
  { id: 'projects', label: 'المشاريع', icon: FolderKanban },
  { id: 'tasks', label: 'المهام', icon: ListChecks },
  { id: 'reminders', label: 'التذكيرات', icon: Clock3 },
  { id: 'commitments', label: 'الالتزامات', icon: Archive },
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

function labelForRecord(record: RecordItem): string {
  if ('description' in record && typeof record.description === 'string') return record.description;
  if ('name' in record && typeof record.name === 'string') return record.name;
  if ('title' in record && typeof record.title === 'string') return record.title;
  return typeof record.text === 'string' ? record.text : 'سجل محفوظ';
}

function recordId(record: RecordItem) {
  return record.id;
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
            <label className="block">
              <span className="mb-1.5 block text-xs text-muted-foreground">ملاحظات</span>
              <textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} rows={3} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" />
            </label>
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
  onDelete,
}: {
  kind: RecordType;
  record: RecordItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const expense = kind === 'expense' ? record as ExpenseRecord : undefined;
  const task = kind === 'task' ? record as TaskRecord : undefined;
  const reminder = kind === 'reminder' ? record as ReminderRecord : undefined;
  const commitment = kind === 'commitment' ? record as CommitmentRecord : undefined;
  const project = kind === 'project' ? record as ProjectRecord : undefined;
  return (
    <article className="group rounded-2xl border border-border/75 bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_18px_35px_-30px_hsl(var(--foreground)/.5)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold">{labelForRecord(record)}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {expense ? `${expense.projectName ?? expense.personName ?? 'بدون ربط'} · ${formatDate(expense.occurredAt)}` : project ? `${project.status} · ${formatDate(project.updatedAt)}` : task ? `${task.status} · ${formatDate(task.dueAt)}` : reminder ? `${reminder.status} · ${formatDate(reminder.dueAt)}` : commitment ? `${commitment.status} · ${formatDate(commitment.dueAt)}` : formatDate(record.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 gap-1 opacity-70 transition group-hover:opacity-100">
          <button type="button" onClick={onEdit} className="rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary" aria-label="تعديل"><Edit3 className="size-3.5" /></button>
          <button type="button" onClick={onDelete} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="حذف"><Trash2 className="size-3.5" /></button>
        </div>
      </div>
      {expense && <p className="mt-4 font-mono text-lg font-semibold">{money(expense.amountMinor, expense.currency)}</p>}
      {('notes' in record && typeof record.notes === 'string' && record.notes) && <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{record.notes}</p>}
      {kind === 'reminder' && reminder && <p className="mt-3 text-xs text-muted-foreground">{reminder.timezone}</p>}
    </article>
  );
}

export default function Records() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('expenses');
  const [editing, setEditing] = useState<{ kind: RecordType; record: RecordItem } | null>(null);
  const [creating, setCreating] = useState<RecordType | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{ kind: RecordType; recordId: string; approval: ApprovalRequest } | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [staleRecordMessage, setStaleRecordMessage] = useState<string | null>(null);
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
  const currentRecords = useMemo(() => data?.[tab] ?? [], [data, tab]) as RecordItem[];
  const kind = recordTypeForTab(tab);

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
    const latest = await recordsQuery.refetch();
    const current = latest.data?.[tab]?.find((candidate) => candidate.id === record.id);
    if (!current) {
      setStaleRecordMessage('تم تحديث القائمة لأن هذا السجل لم يعد متاحًا للتعديل.');
      return;
    }
    setEditing({ kind, record: current as RecordItem });
  }

  function openCreate() {
    createMutation.reset();
    updateMutation.reset();
    deleteMutation.reset();
    setCreating(kind);
  }

  return (
    <div dir="rtl" lang="ar" className="grain min-h-[100dvh] bg-background text-foreground">
      <main className="mx-auto min-h-[100dvh] max-w-[1240px] px-4 py-6 sm:px-8 sm:py-10">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <a href={import.meta.env.BASE_URL} className="text-xs text-muted-foreground transition hover:text-primary">← العودة للمحادثة</a>
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

        <nav className="scrollbar-thin mb-7 flex gap-2 overflow-x-auto pb-1" aria-label="أنواع السجلات">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm transition ${tab === id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary'}`}>
              <Icon className="size-4" /> {label} <span className={tab === id ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}>{data?.[id]?.length ?? 0}</span>
            </button>
          ))}
        </nav>

        {recordsQuery.isLoading && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3, 4, 5, 6].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl bg-muted" />)}</div>}
        {staleRecordMessage && <div className="mb-5 flex items-center gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300" role="status"><CircleAlert className="size-4" /> {staleRecordMessage}</div>}
        {error && <div className="mb-5 flex items-center gap-2 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive" role="alert"><CircleAlert className="size-4" /> {error.message}</div>}
         {!recordsQuery.isLoading && !error && currentRecords.length === 0 && <div className="rounded-[24px] border border-dashed border-border bg-card/50 px-6 py-16 text-center"><Check className="mx-auto size-8 text-primary/60" /><h2 className="mt-4 font-serif text-xl">لا توجد سجلات هنا بعد</h2><p className="mt-2 text-sm text-muted-foreground">يمكنك إضافة أول سجل يدويًا أو من خلال المحادثة.</p><button type="button" onClick={openCreate} className="mx-auto mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"><Plus className="size-4" /> إضافة {labelForKind(kind)}</button></div>}
        {!recordsQuery.isLoading && currentRecords.length > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{currentRecords.map((record) => <RecordCard key={record.id} kind={kind} record={record} onEdit={() => void editItem(record)} onDelete={() => deleteItem(record)} />)}</div>}
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
            {pendingApproval.approval.status === 'pending' ? (
              <div className="mt-7 flex gap-2">
                <button type="button" onClick={approvePending} disabled={approveMutation.isPending || rejectMutation.isPending} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                  {approveMutation.isPending && <LoaderCircle className="size-4 animate-spin" />} موافق، احفظ
                </button>
                <button type="button" onClick={rejectPending} disabled={approveMutation.isPending || rejectMutation.isPending} className="flex-1 rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50">
                  {rejectMutation.isPending ? <LoaderCircle className="mx-auto size-4 animate-spin" /> : 'إلغاء'}
                </button>
              </div>
            ) : (
              <p className="mt-6 text-sm font-medium text-muted-foreground">
                {pendingApproval.approval.status === 'completed' ? 'تم حفظ السجل.' : pendingApproval.approval.status === 'rejected' ? 'تم إلغاء العملية.' : 'هذه العملية لم تعد قابلة للتنفيذ.'}
              </p>
            )}
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