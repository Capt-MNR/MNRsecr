import { useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, CircleCheck, CircleX, Clock3, LoaderCircle, Save, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import {
  useGetCandidates,
  useGetSecretaryOperation,
  type ApprovalOperation,
  type Candidate,
} from '@workspace/api-client-react';
import { prepareReminderApprovalArgs } from '../lib/approval-args';

type ApprovalDisplay = {
  title: string;
  details: string[];
};

type ApprovalArgs = Record<string, unknown>;
type ApprovalStatus = 'pending' | 'executing' | 'completed' | 'rejected' | 'expired' | 'failed';

type ApprovalFormProps = {
  operationId: string;
  toolName: string;
  initialArgs: ApprovalArgs;
  display: ApprovalDisplay;
  status?: ApprovalStatus;
  allowArgsOverride?: boolean;
  busy?: boolean;
  error?: string | null;
  personCandidates?: Candidate[];
  projectCandidates?: Candidate[];
  onConfirm: (args?: ApprovalArgs) => void;
  onReject: () => void;
};

const DRAFT_PREFIX = 'secretary.approval-draft:';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function candidateArray(value: unknown): Candidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Candidate => (
    Boolean(item)
    && typeof item === 'object'
    && typeof (item as Candidate).id === 'string'
    && typeof (item as Candidate).name === 'string'
  ));
}

function amountInputFromArgs(args: ApprovalArgs): string {
  const amountMinor = asNumber(args.amountMinor);
  return amountMinor > 0 ? String(amountMinor / 100) : '';
}

function parseAmountMinor(value: string): number | null {
  const normalized = value.trim().replaceAll(',', '.');
  if (!normalized || !/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isSafeInteger(Math.round(amount * 100)) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function formatAmount(value: string, currency: string): string {
  const minor = parseAmountMinor(value);
  if (minor === null) return value || '—';
  return `${new Intl.NumberFormat('ar-EG').format(minor / 100)} ${currency || 'EGP'}`;
}

function draftKey(operationId: string): string {
  return `${DRAFT_PREFIX}${operationId}`;
}

function readDraft(operationId: string): { savedAt: number; args: ApprovalArgs } | null {
  try {
    const raw = localStorage.getItem(draftKey(operationId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: unknown; args?: unknown };
    if (typeof parsed.savedAt !== 'number' || !parsed.args || typeof parsed.args !== 'object') return null;
    if (Date.now() - parsed.savedAt >= DRAFT_TTL_MS) {
      localStorage.removeItem(draftKey(operationId));
      return null;
    }
    return { savedAt: parsed.savedAt, args: parsed.args as ApprovalArgs };
  } catch {
    return null;
  }
}

function saveDraft(operationId: string, args: ApprovalArgs): void {
  localStorage.setItem(draftKey(operationId), JSON.stringify({ savedAt: Date.now(), args }));
}

function clearDraft(operationId: string): void {
  try {
    localStorage.removeItem(draftKey(operationId));
  } catch {
    // A blocked or unavailable localStorage must not prevent terminal status rendering.
  }
}

function detailsFor(
  toolName: string,
  args: ApprovalArgs,
  personName: string,
  projectName: string,
): string[] {
  if (toolName === 'record_expense') {
    const currency = asString(args.currency, 'EGP');
    const amount = asString(args.amount) || amountInputFromArgs(args);
    return [
      ...(amount ? [`القيمة: ${formatAmount(amount, currency)}`] : []),
      ...(asString(args.description) ? [`الوصف: ${asString(args.description)}`] : []),
      ...(personName ? [`الشخص: ${personName}`] : []),
      ...(projectName ? [`المشروع: ${projectName}`] : []),
    ];
  }
  if (toolName === 'create_reminder') {
    const dueAt = asString(args.dueAt);
    const dueLabel = dueAt && !Number.isNaN(new Date(dueAt).getTime())
      ? new Intl.DateTimeFormat('ar-EG', {
          timeZone: asString(args.timezone, 'Africa/Cairo'),
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(dueAt))
      : '';
    return [
      ...(asString(args.text) ? [asString(args.text)] : []),
      ...(dueLabel ? [`الموعد: ${dueLabel}`] : []),
    ];
  }
  return [];
}

function localDateTimeValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isoFromLocalDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function statusPresentation(status: ApprovalStatus): {
  label: string;
  message: string;
  icon: LucideIcon;
  className: string;
} {
  switch (status) {
    case 'completed':
      return {
        label: 'اكتملت العملية',
        message: 'تم حفظ التغيير وتسجيله مرة واحدة.',
        icon: CircleCheck,
        className: 'text-emerald-600 dark:text-emerald-400',
      };
    case 'rejected':
      return {
        label: 'تم رفض العملية',
        message: 'تم إلغاء العملية، ولم يتم تنفيذ أي تغيير.',
        icon: CircleX,
        className: 'text-muted-foreground',
      };
    case 'expired':
      return {
        label: 'انتهت صلاحية العملية',
        message: 'انتهت مهلة الموافقة، ولم يتم تنفيذ أي تغيير.',
        icon: Clock3,
        className: 'text-amber-600 dark:text-amber-400',
      };
    case 'failed':
      return {
        label: 'تعذر تنفيذ العملية',
        message: 'لم يكتمل التغيير. راجع الخطأ أو اطلب العملية من جديد بدل إعادة المحاولة تلقائيًا.',
        icon: TriangleAlert,
        className: 'text-destructive',
      };
    case 'executing':
      return {
        label: 'العملية قيد التنفيذ',
        message: 'جارٍ تنفيذ التغيير. لا ترسل موافقة أخرى.',
        icon: LoaderCircle,
        className: 'animate-spin text-primary',
      };
    default:
      return {
        label: 'في انتظار موافقتك',
        message: 'لن يحدث أي تغيير قبل تأكيدك.',
        icon: Clock3,
        className: 'text-primary',
      };
  }
}

function CandidateSelect({
  label,
  value,
  query,
  candidates,
  onQueryChange,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  query: string;
  candidates: Candidate[];
  onQueryChange: (value: string) => void;
  onChange: (candidate: Candidate | null) => void;
  testId: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={`ابحث عن ${label}`}
        className="mb-1.5 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
        data-testid={`${testId}-search`}
      />
      <select
        value={value}
        onChange={(event) => {
          const selected = candidates.find((candidate) => candidate.id === event.target.value) ?? null;
          onChange(selected);
        }}
        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        data-testid={testId}
      >
        <option value="">بدون اختيار</option>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}{candidate.status ? ` · ${candidate.status}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function ApprovalForm({
  operationId,
  toolName,
  initialArgs,
  display,
  status = 'pending',
  allowArgsOverride = true,
  busy = false,
  error,
  personCandidates = [],
  projectCandidates = [],
  onConfirm,
  onReject,
}: ApprovalFormProps) {
  const operationQuery = useGetSecretaryOperation(operationId, {
    query: {
      queryKey: [`/api/approvals/${operationId}`],
      staleTime: 0,
      refetchInterval: (query) => query.state.data?.status === 'executing' ? 1_500 : false,
    },
  });
  const operation = operationQuery.data as ApprovalOperation | undefined;
  const sourceArgs = operation?.args ?? initialArgs;
  const [args, setArgs] = useState<ApprovalArgs>(sourceArgs);
  const [amount, setAmount] = useState(amountInputFromArgs(sourceArgs));
  const [personQuery, setPersonQuery] = useState(asString(sourceArgs.personName));
  const [projectQuery, setProjectQuery] = useState(asString(sourceArgs.projectName));
  const [personName, setPersonName] = useState(asString(sourceArgs.personName));
  const [projectName, setProjectName] = useState(asString(sourceArgs.projectName));
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const initialPersonCandidates = [...personCandidates, ...candidateArray(sourceArgs.personCandidates)];
  const initialProjectCandidates = [...projectCandidates, ...candidateArray(sourceArgs.projectCandidates)];
  const [selectedPersonId, setSelectedPersonId] = useState(asString(sourceArgs.personId));
  const [selectedProjectId, setSelectedProjectId] = useState(asString(sourceArgs.projectId));
  const personSearch = useGetCandidates(
    { type: 'person', q: personQuery.trim() || ' ' },
    { query: { queryKey: [`/api/candidates`, 'person', personQuery], enabled: personQuery.trim().length > 0, staleTime: 30_000 } },
  );
  const projectSearch = useGetCandidates(
    { type: 'project', q: projectQuery.trim() || ' ' },
    { query: { queryKey: [`/api/candidates`, 'project', projectQuery], enabled: projectQuery.trim().length > 0, staleTime: 30_000 } },
  );
  const people = useMemo(
    () => [...initialPersonCandidates, ...(personSearch.data ?? [])]
      .filter((candidate, index, all) => all.findIndex((item) => item.id === candidate.id) === index),
    [initialPersonCandidates, personSearch.data],
  );
  const projects = useMemo(
    () => [...initialProjectCandidates, ...(projectSearch.data ?? [])]
      .filter((candidate, index, all) => all.findIndex((item) => item.id === candidate.id) === index),
    [initialProjectCandidates, projectSearch.data],
  );

  useEffect(() => {
    const draft = readDraft(operationId);
    if (draft) {
      setArgs(draft.args);
      setAmount(amountInputFromArgs(draft.args));
      setPersonQuery(asString(draft.args.personName));
      setProjectQuery(asString(draft.args.projectName));
      setPersonName(asString(draft.args.personName));
      setProjectName(asString(draft.args.projectName));
      setSelectedPersonId(asString(draft.args.personId));
      setSelectedProjectId(asString(draft.args.projectId));
    }
  }, [operationId]);

  useEffect(() => {
    if (operation?.status === 'failed' || operation?.status === 'expired') {
      const draft = readDraft(operationId);
      if (draft && Date.now() - draft.savedAt >= DRAFT_TTL_MS) clearDraft(operationId);
    }
  }, [operation?.status, operationId]);

  const effectiveStatus = operation?.status ?? status;
  const hasAuthoritativeOperation = Boolean(operation);

  useEffect(() => {
    if (effectiveStatus === 'completed' || effectiveStatus === 'rejected' || effectiveStatus === 'expired') {
      clearDraft(operationId);
    }
  }, [effectiveStatus, operationId]);

  useEffect(() => {
    if (!operationQuery.data) return;
    const nextArgs = operationQuery.data.args ?? initialArgs;
    if (!readDraft(operationId)) {
      setArgs(nextArgs);
      setAmount(amountInputFromArgs(nextArgs));
      setSelectedPersonId(asString(nextArgs.personId));
      setSelectedProjectId(asString(nextArgs.projectId));
      setPersonName(asString(nextArgs.personName));
      setProjectName(asString(nextArgs.projectName));
      setPersonQuery(asString(nextArgs.personName));
      setProjectQuery(asString(nextArgs.projectName));
    }
  }, [initialArgs, operation?.args, operationId, operationQuery.data]);

  const editedDetails = detailsFor(toolName, { ...args, amount }, personName, projectName);
  const hasEditedDetails = editedDetails.length > 0
    && JSON.stringify(editedDetails) !== JSON.stringify(display.details);
  const amountError = toolName === 'record_expense' && parseAmountMinor(amount) === null
    ? 'أدخل مبلغًا صحيحًا أكبر من صفر.'
    : null;
  const descriptionError = toolName === 'record_expense' && !asString(args.description).trim()
    ? 'الوصف مطلوب.'
    : null;
  const reminderError = toolName === 'create_reminder' && !asString(args.text).trim()
    ? 'نص التذكير مطلوب.'
    : null;
  const dueAtError = toolName === 'create_reminder' && (
    !asString(args.dueAt) || Number.isNaN(new Date(asString(args.dueAt)).getTime())
  ) ? 'الموعد غير صالح.' : null;
  const validationError = amountError ?? descriptionError ?? reminderError ?? dueAtError;

  function updateArg(key: string, value: unknown) {
    setArgs((current) => ({ ...current, [key]: value }));
  }

  function confirm() {
    if (validationError || busy || !hasAuthoritativeOperation || operationQuery.isError) return;
    const nextArgs = toolName === 'create_reminder'
      ? prepareReminderApprovalArgs(args)
      : {
        ...args,
        ...(toolName === 'record_expense' ? {
          amountMinor: parseAmountMinor(amount)!,
          personId: selectedPersonId || null,
          projectId: selectedProjectId || null,
          ...(personName ? { personName } : {}),
          ...(projectName ? { projectName } : {}),
        } : {}),
      };
    if (!nextArgs) return;
    onConfirm(allowArgsOverride ? nextArgs : undefined);
  }

  function saveAsDraft() {
    if (!hasAuthoritativeOperation) return;
    const nextArgs = {
      ...args,
      ...(toolName === 'record_expense' ? {
        amountMinor: parseAmountMinor(amount) ?? asNumber(args.amountMinor),
        personId: selectedPersonId || null,
        projectId: selectedProjectId || null,
        ...(personName ? { personName } : {}),
        ...(projectName ? { projectName } : {}),
      } : {}),
    };
    setDraftError(null);
    try {
      saveDraft(operationId, nextArgs);
    } catch {
      setDraftError('تعذر حفظ المسودة على هذا الجهاز.');
      return;
    }
    setArgs(nextArgs);
    setDraftSaved(true);
  }

  if (effectiveStatus !== 'pending') {
    const presentation = statusPresentation(effectiveStatus);
    const StatusIcon = presentation.icon;
    return (
      <div
        className="mt-3 rounded-xl border border-border/70 bg-background/60 p-3"
        data-testid={`approval-status-${operationId}-${effectiveStatus}`}
        role="status"
        aria-live="polite"
      >
        <div className={`flex items-center gap-2 text-sm font-semibold ${presentation.className}`}>
          <StatusIcon className="size-4" />
          {presentation.label}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{presentation.message}</p>
        {effectiveStatus === 'failed' && operationQuery.data?.display.details?.length ? (
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {operationQuery.data.display.details.map((detail) => <li key={detail}>{detail}</li>)}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3" data-testid={`approval-form-${operationId}`}>
      {operationQuery.isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" /> جاري تحميل تفاصيل العملية…
        </div>
      )}
      {operationQuery.isError && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive" role="alert">
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <p>تعذر تحميل النسخة المعتمدة من العملية. لن يتم إرسال الموافقة حتى يتم التحقق من العملية على الخادم.</p>
          </div>
          <button type="button" onClick={() => void operationQuery.refetch()} className="mt-2 font-semibold underline underline-offset-4">حاول مرة أخرى</button>
        </div>
      )}
      {toolName === 'record_expense' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">المبلغ</span>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                className={`w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-primary ${amountError ? 'border-destructive' : 'border-border'}`}
                data-testid="approval-amount"
              />
              {amountError && <span className="mt-1 block text-[11px] text-destructive">{amountError}</span>}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">العملة</span>
              <input
                value={asString(args.currency, 'EGP')}
                onChange={(event) => updateArg('currency', event.target.value.toUpperCase())}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm uppercase outline-none focus:border-primary"
                data-testid="approval-currency"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">الوصف</span>
            <input
              value={asString(args.description)}
              onChange={(event) => updateArg('description', event.target.value)}
              className={`w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-primary ${descriptionError ? 'border-destructive' : 'border-border'}`}
              data-testid="approval-description"
            />
            {descriptionError && <span className="mt-1 block text-[11px] text-destructive">{descriptionError}</span>}
          </label>
          <CandidateSelect
            label="الشخص"
            value={selectedPersonId}
            query={personQuery}
            candidates={people}
            onQueryChange={(value) => { setPersonQuery(value); setPersonName(value); }}
            onChange={(candidate) => {
              setSelectedPersonId(candidate?.id ?? '');
              setPersonName(candidate?.name ?? '');
              setPersonQuery(candidate?.name ?? '');
            }}
            testId="approval-person"
          />
          <CandidateSelect
            label="المشروع"
            value={selectedProjectId}
            query={projectQuery}
            candidates={projects}
            onQueryChange={(value) => { setProjectQuery(value); setProjectName(value); }}
            onChange={(candidate) => {
              setSelectedProjectId(candidate?.id ?? '');
              setProjectName(candidate?.name ?? '');
              setProjectQuery(candidate?.name ?? '');
            }}
            testId="approval-project"
          />
        </div>
      )}
      {toolName === 'create_reminder' && (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">التذكير</span>
            <input
              value={asString(args.text)}
              onChange={(event) => updateArg('text', event.target.value)}
              className={`w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-primary ${reminderError ? 'border-destructive' : 'border-border'}`}
              data-testid="approval-reminder-text"
            />
            {reminderError && <span className="mt-1 block text-[11px] text-destructive">{reminderError}</span>}
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">الموعد</span>
            <input
              type="datetime-local"
              value={localDateTimeValue(asString(args.dueAt))}
              onChange={(event) => updateArg('dueAt', isoFromLocalDateTime(event.target.value) ?? '')}
              className={`w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-primary ${dueAtError ? 'border-destructive' : 'border-border'}`}
              data-testid="approval-reminder-due-at"
            />
            {dueAtError && <span className="mt-1 block text-[11px] text-destructive">{dueAtError}</span>}
          </label>
        </div>
      )}
      <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground"><Clock3 className="size-3.5" /> التفاصيل المعتمدة من الخادم</div>
        {display.details.length > 0 ? (
          <ul className="space-y-0.5">{display.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
        ) : (
          <p>لا توجد تفاصيل إضافية.</p>
        )}
        {hasEditedDetails && (
          <div className="mt-3 border-t border-border/60 pt-2">
            <div className="mb-1 font-medium text-foreground">بعد التعديل الصريح</div>
            <ul className="space-y-0.5">{editedDetails.map((detail) => <li key={detail}>{detail}</li>)}</ul>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      {draftSaved && <p className="text-xs text-muted-foreground">تم حفظ المسودة على هذا الجهاز.</p>}
      {draftError && <p className="text-xs text-destructive" role="alert">{draftError}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={confirm}
          disabled={busy || Boolean(validationError) || operationQuery.isLoading || !hasAuthoritativeOperation || operationQuery.isError}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid={`button-confirm-approval-${operationId}`}
        >
          {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          تأكيد
        </button>
        <button
          type="button"
          onClick={() => { clearDraft(operationId); onReject(); }}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          data-testid={`button-reject-approval-${operationId}`}
        >
          <X className="size-3.5" /> إلغاء
        </button>
        <button
          type="button"
          onClick={saveAsDraft}
          disabled={busy || operationQuery.isLoading || !hasAuthoritativeOperation}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          title="حفظ التعديلات دون تنفيذ"
          data-testid={`button-save-draft-${operationId}`}
        >
          <Save className="size-3.5" /> مسودة
        </button>
      </div>
    </div>
  );
}