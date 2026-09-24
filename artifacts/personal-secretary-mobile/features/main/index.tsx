import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getGetTodayContextQueryKey, getListRecordsQueryKey, useCreateProactiveSuppression, useGetEntityGraph, useGetTodayContext, useListRecords, useUpdateRecord, type ApprovalRequest, type CommitmentRecord, type ConversationListResponse, type ExpenseRecord, type PersonRecord, type ProjectRecord, type RecordMutationResponse, type RecordType, type RecordsResponse, type RecordUpdateInput, type ReminderRecord, type TaskRecord, type TodayContext, type TurnResponse } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, type ThemePreference } from '@/hooks/useColors';
import { useLanguage, type AppLanguage } from '@/hooks/useLanguage';
import { useSecretaryChatService, type SecretaryChatContext } from '../../services/secretary-chat';
import type { LocalInputAttachment } from '../../services/local-input-assets';
import { receiptNeedsReview, type SecretaryInputResult, type SecretaryInputState } from '../../services/secretary-input';
import { MessageBubble } from '../message-bubble';
import { ReceiptReviewCard } from '../receipt-review';
export { default as MainWorkspace } from './MainWorkspace';
export { default as WorksView } from './WorksView';
export { SecondBrainMemorySheet } from './SecondBrainMemorySheet';
export { MessageBubble };

export type ApprovalStatus = 'pending' | 'executing' | 'completed' | 'rejected' | 'expired' | 'failed';
type ConfirmationMode = 'immediate_approval' | 'deferred_confirmation';
type ApprovalCandidate = { id: string; name: string; status?: string };

export type Approval = {
  operationId: string;
  title: string;
  details: string[];
  status: ApprovalStatus;
  confirmationMode?: ConfirmationMode;
  quickApprove?: boolean;
  toolName?: string;
  initialArgs?: Record<string, unknown>;
  personCandidates?: ApprovalCandidate[];
  projectCandidates?: ApprovalCandidate[];
};

export type LocalMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  createdAt: string;
  turnId?: string;
  inputId?: string | null;
  inputAttachment?: LocalInputAttachment | null;
  approval?: Approval;
  approvals?: Approval[];
  recordLink?: MobileRecordRow;
};

export type RecordOrigin = {
  conversationId: string;
  turnId?: string | null;
  operationId?: string | null;
};

export const STORAGE_MESSAGES = '@personal-secretary-mobile/messages';
export const STORAGE_CONVERSATION = '@personal-secretary-mobile/conversation';

export const starterMessage: LocalMessage = {
  id: 'welcome',
  role: 'assistant',
  text: 'أنا جاهز للطلبات السريعة. اسألني عن يومك، سجّل مصروفًا، أو اطلب تذكيرًا.',
  createdAt: new Date(0).toISOString(),
};

export const suggestions = [
  'إيه عندي النهارده؟',
  'فكرني بكرة أكلم محمد',
  'محمد أخد مني كام؟',
];

type FeatherName = ComponentProps<typeof Feather>['name'];

export type MobileRecordRow = {
  id: string;
  recordType: string;
  title: string;
  subtitle: string;
  trailing?: string;
  rowVersion?: number;
  origin?: RecordOrigin | null;
  related?: MobileRecordRow[];
};

type MobileRecordSection = {
  key: string;
  title: string;
  icon: FeatherName;
  data: MobileRecordRow[];
};

export type MainSection = 'office' | 'chat' | 'records' | 'people' | 'projects' | 'financial' | 'tasks' | 'reminders' | 'activity' | 'works';
export type AssistantPreferences = {
  activity: 'focused' | 'balanced' | 'quiet';
  proactive: 'low' | 'balanced' | 'high';
  intelligence: 'fast' | 'balanced' | 'deep';
  communicationStyle: 'formal' | 'friendly' | 'concise' | 'balanced';
  repeatReminders: boolean;
};
export const defaultAssistantPreferences: AssistantPreferences = {
  activity: 'balanced',
  proactive: 'balanced',
  intelligence: 'balanced',
  communicationStyle: 'balanced',
  repeatReminders: false,
};
type ConversationSummary = ConversationListResponse['conversations'][number];

type TodayContextReminder = TodayContext['upcomingReminders'][number];
type TodayContextTask = TodayContext['pendingTasks'][number];

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: currency || 'EGP',
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

function recordDate(value?: string | null) {
  if (!value) return 'بدون موعد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

export function localized(language: AppLanguage, arabic: string, english: string) {
  return language === 'en' ? english : arabic;
}

function colorWithAlpha(color: string, alpha: number) {
  const normalized = color.replace('#', '');
  if (normalized.length !== 6) return color;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function recordSectionLabel(language: AppLanguage, key: string, fallback: string) {
  const englishLabels: Record<string, string> = {
    expenses: 'Expenses',
    people: 'People',
    projects: 'Projects',
    tasks: 'Tasks',
    reminders: 'Reminders',
    commitments: 'Commitments',
  };
  return localized(language, fallback, englishLabels[key] ?? fallback);
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const relatedLabels: Record<string, string> = {
  projects: 'المشاريع',
  people: 'الأشخاص',
  expenses: 'المصروفات',
  commitments: 'الالتزامات',
  tasks: 'المهام',
  reminders: 'التذكيرات',
  financialParties: 'العلاقات المالية',
  purposes: 'الأغراض',
  payments: 'المدفوعات',
  obligations: 'الالتزامات المالية',
  advances: 'السلف',
  debts: 'الديون',
};

function statusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    active: 'نشط',
    open: 'مفتوح',
    pending: 'معلّق',
    scheduled: 'مجدول',
    done: 'مكتمل',
    completed: 'مكتمل',
    overdue: 'متأخر',
    cancelled: 'ملغى',
  };
  return status ? labels[status] ?? status : 'بدون حالة';
}

function recordSections(records: RecordsResponse | undefined): MobileRecordSection[] {
  if (!records) return [];
  return [
    {
      key: 'expenses',
      title: 'المصروفات',
      icon: 'dollar-sign',
      data: records.expenses.map((expense) => ({
        id: expense.id,
        recordType: 'expense',
        title: expense.description,
        subtitle: [expense.personName ?? expense.projectName, recordDate(expense.occurredAt)]
          .filter(Boolean)
          .join(' · '),
        trailing: money(expense.amountMinor, expense.currency),
        rowVersion: expense.rowVersion,
        origin: expense.origin,
        related: [
          expense.personId && expense.personName
            ? { id: expense.personId, recordType: 'person', title: expense.personName, subtitle: 'الشخص المرتبط' }
            : null,
          expense.projectId && expense.projectName
            ? { id: expense.projectId, recordType: 'project', title: expense.projectName, subtitle: 'المشروع المرتبط' }
            : null,
          expense.purposeId && expense.purposeName
            ? { id: expense.purposeId, recordType: 'purpose', title: expense.purposeName, subtitle: 'الغرض المرتبط' }
            : null,
        ].filter((item): item is MobileRecordRow => Boolean(item)),
      })),
    },
    {
      key: 'people',
      title: 'الأشخاص',
      icon: 'users',
      data: records.people.map((person) => ({
        id: person.id,
        recordType: 'person',
        title: person.name,
        subtitle: person.phone ?? person.notes ?? 'لا توجد ملاحظات',
        rowVersion: person.rowVersion,
      })),
    },
    {
      key: 'projects',
      title: 'المشاريع',
      icon: 'briefcase',
      data: records.projects.map((project) => ({
        id: project.id,
        recordType: 'project',
        title: project.name,
        subtitle: recordDate(project.updatedAt),
        trailing: statusLabel(project.status),
        rowVersion: project.rowVersion,
      })),
    },
    {
      key: 'tasks',
      title: 'المهام',
      icon: 'check-square',
      data: records.tasks.map((task) => ({
        id: task.id,
        recordType: 'task',
        title: task.title,
        subtitle: task.dueAt ? `موعدها ${recordDate(task.dueAt)}` : 'مهمة مستمرة',
        trailing: statusLabel(task.status),
        rowVersion: task.rowVersion,
        origin: task.origin,
      })),
    },
    {
      key: 'reminders',
      title: 'التذكيرات',
      icon: 'bell',
      data: records.reminders.map((reminder) => ({
        id: reminder.id,
        recordType: 'reminder',
        title: reminder.text,
        subtitle: `${recordDate(reminder.dueAt)} · ${reminder.timezone}`,
        trailing: statusLabel(reminder.status),
        rowVersion: reminder.rowVersion,
        origin: reminder.origin,
      })),
    },
    {
      key: 'commitments',
      title: 'الالتزامات',
      icon: 'link',
      data: records.commitments.map((commitment) => ({
        id: commitment.id,
        recordType: 'commitment',
        title: commitment.title,
        subtitle: commitment.personName ?? 'بدون طرف محدد',
        trailing: commitment.dueAt ? recordDate(commitment.dueAt) : statusLabel(commitment.status),
        rowVersion: commitment.rowVersion,
        origin: commitment.origin as RecordOrigin | null,
      })),
    },
  ];
}

function relatedRow(key: string, value: unknown): MobileRecordRow | null {
  const item = objectValue(value);
  const id = typeof item.id === 'string' ? item.id : '';
  if (!id) return null;
  const typeByKey: Record<string, string> = {
    projects: 'project',
    people: 'person',
    expenses: 'expense',
    commitments: 'commitment',
    tasks: 'task',
    reminders: 'reminder',
    financialParties: 'financial_party',
    purposes: 'purpose',
    payments: 'payment',
    obligations: 'obligation',
    advances: 'obligation',
    debts: 'obligation',
  };
  const recordType = typeByKey[key];
  if (!recordType) return null;
  const title = stringValue(
    item.name,
    stringValue(item.title, stringValue(item.description, stringValue(item.text, relatedLabels[key] ?? 'سجل مرتبط'))),
  );
  const date = typeof item.dueAt === 'string'
    ? recordDate(item.dueAt)
    : typeof item.occurredAt === 'string'
      ? recordDate(item.occurredAt)
      : '';
  const detail = stringValue(item.relationship, stringValue(item.status, date || (relatedLabels[key] ?? 'فتح التفاصيل')));
  const amountMinor = typeof item.amountMinor === 'number'
    ? item.amountMinor
    : typeof item.principalAmountMinor === 'number'
      ? item.principalAmountMinor
      : null;
  const currency = stringValue(item.currency, 'EGP');
  return {
    id,
    recordType,
    title,
    subtitle: detail,
    ...(amountMinor !== null ? { trailing: money(amountMinor, currency) } : {}),
  };
}

type EditableRecord = ExpenseRecord | PersonRecord | ProjectRecord | TaskRecord | ReminderRecord | CommitmentRecord;
type EditFormValues = Record<string, string>;

const editableRecordCollections: Record<RecordType, keyof RecordsResponse> = {
  expense: 'expenses',
  person: 'people',
  project: 'projects',
  task: 'tasks',
  reminder: 'reminders',
  commitment: 'commitments',
};

export function findEditableRecord(
  records: RecordsResponse | undefined,
  record: Pick<MobileRecordRow, 'recordType' | 'id'>,
): EditableRecord | null {
  if (!records || !(record.recordType in editableRecordCollections)) return null;
  const collection = records[editableRecordCollections[record.recordType as RecordType]] as EditableRecord[];
  return collection.find((candidate) => candidate.id === record.id) ?? null;
}

function localDateTime(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function editableRecordRow(record: EditableRecord, recordType: RecordType): MobileRecordRow {
  if (recordType === 'expense') {
    const expense = record as ExpenseRecord;
    return {
      id: expense.id,
      recordType,
      title: expense.description,
      subtitle: [expense.personName ?? expense.projectName, recordDate(expense.occurredAt)].filter(Boolean).join(' · '),
      trailing: money(expense.amountMinor, expense.currency),
      rowVersion: expense.rowVersion,
      origin: expense.origin,
    };
  }
  if (recordType === 'person') {
    const person = record as PersonRecord;
    return { id: person.id, recordType, title: person.name, subtitle: person.phone ?? person.notes ?? 'لا توجد ملاحظات', rowVersion: person.rowVersion };
  }
  if (recordType === 'project') {
    const project = record as ProjectRecord;
    return { id: project.id, recordType, title: project.name, subtitle: recordDate(project.updatedAt), trailing: statusLabel(project.status), rowVersion: project.rowVersion };
  }
  if (recordType === 'task') {
    const task = record as TaskRecord;
    return { id: task.id, recordType, title: task.title, subtitle: task.dueAt ? `موعدها ${recordDate(task.dueAt)}` : 'مهمة مستمرة', trailing: statusLabel(task.status), rowVersion: task.rowVersion, origin: task.origin };
  }
  if (recordType === 'reminder') {
    const reminder = record as ReminderRecord;
    return { id: reminder.id, recordType, title: reminder.text, subtitle: `${recordDate(reminder.dueAt)} · ${reminder.timezone}`, trailing: statusLabel(reminder.status), rowVersion: reminder.rowVersion, origin: reminder.origin };
  }
  const commitment = record as CommitmentRecord;
  return { id: commitment.id, recordType, title: commitment.title, subtitle: commitment.personName ?? 'بدون طرف محدد', trailing: commitment.dueAt ? recordDate(commitment.dueAt) : statusLabel(commitment.status), rowVersion: commitment.rowVersion, origin: commitment.origin as RecordOrigin | null };
}

export function editFormForRecord(record: EditableRecord, recordType: RecordType): EditFormValues {
  const expense = recordType === 'expense' ? record as ExpenseRecord : undefined;
  const person = recordType === 'person' ? record as PersonRecord : undefined;
  const project = recordType === 'project' ? record as ProjectRecord : undefined;
  const task = recordType === 'task' ? record as TaskRecord : undefined;
  const reminder = recordType === 'reminder' ? record as ReminderRecord : undefined;
  const commitment = recordType === 'commitment' ? record as CommitmentRecord : undefined;
  return {
    amountMinor: expense ? String(expense.amountMinor) : '',
    currency: expense?.currency ?? 'EGP',
    description: expense?.description ?? '',
    personId: expense?.personId ?? '',
    projectId: expense?.projectId ?? '',
    occurredAt: localDateTime(expense?.occurredAt),
    name: person?.name ?? project?.name ?? '',
    phone: person?.phone ?? '',
    notes: person?.notes ?? '',
    title: task?.title ?? commitment?.title ?? '',
    text: reminder?.text ?? '',
    dueAt: localDateTime(task?.dueAt ?? reminder?.dueAt ?? commitment?.dueAt),
    timezone: reminder?.timezone ?? 'Africa/Cairo',
    status: project?.status ?? task?.status ?? reminder?.status ?? commitment?.status ?? '',
  };
}

export function updateInputForRecord(
  record: EditableRecord,
  recordType: RecordType,
  form: EditFormValues,
): RecordUpdateInput {
  const input: RecordUpdateInput = { expectedRowVersion: record.rowVersion };
  if (recordType === 'expense') {
    input.amountMinor = Number(form.amountMinor);
    input.currency = form.currency.trim();
    input.description = form.description.trim();
    input.personId = form.personId || null;
    input.projectId = form.projectId || null;
    input.occurredAt = new Date(form.occurredAt).toISOString();
  } else if (recordType === 'person') {
    input.name = form.name.trim();
    input.phone = form.phone.trim() || null;
    input.notes = form.notes.trim() || null;
  } else if (recordType === 'project') {
    input.name = form.name.trim();
    input.status = form.status;
  } else if (recordType === 'task') {
    input.title = form.title.trim();
    input.dueAt = form.dueAt ? new Date(form.dueAt).toISOString() : null;
    input.status = form.status;
  } else if (recordType === 'reminder') {
    input.text = form.text.trim();
    input.dueAt = new Date(form.dueAt).toISOString();
    input.timezone = form.timezone.trim();
    input.status = form.status;
  } else {
    input.title = form.title.trim();
    input.dueAt = form.dueAt ? new Date(form.dueAt).toISOString() : null;
    input.status = form.status;
  }
  return input;
}

type RecordDetailField = {
  label: string;
  value: string;
};

function detailField(label: string, value: string | null | undefined): RecordDetailField | null {
  return value === null || value === undefined || value.trim() === ''
    ? null
    : { label, value };
}

export function detailFieldsForRecord(
  record: EditableRecord | null,
  recordType: RecordType | null,
): RecordDetailField[] {
  if (!record || !recordType) return [];
  const fields: Array<RecordDetailField | null> = [];
  if (recordType === 'expense') {
    const expense = record as ExpenseRecord;
    fields.push(
      detailField('الوصف', expense.description),
      detailField('المبلغ', money(expense.amountMinor, expense.currency)),
      detailField('العملة', expense.currency),
      detailField('الشخص المرتبط', expense.personName),
      detailField('المشروع المرتبط', expense.projectName),
      detailField('الغرض', expense.purposeName),
      detailField('وقت المصروف', recordDate(expense.occurredAt)),
      detailField('تم الحفظ', recordDate(expense.createdAt)),
    );
  } else if (recordType === 'person') {
    const person = record as PersonRecord;
    fields.push(
      detailField('الاسم', person.name),
      detailField('الهاتف', person.phone),
      detailField('ملاحظات', person.notes),
      detailField('تمت الإضافة', recordDate(person.createdAt)),
      detailField('آخر تحديث', recordDate(person.updatedAt)),
    );
  } else if (recordType === 'project') {
    const project = record as ProjectRecord;
    fields.push(
      detailField('الاسم', project.name),
      detailField('الحالة', statusLabel(project.status)),
      detailField('تمت الإضافة', recordDate(project.createdAt)),
      detailField('آخر تحديث', recordDate(project.updatedAt)),
    );
  } else if (recordType === 'task') {
    const task = record as TaskRecord;
    fields.push(
      detailField('العنوان', task.title),
      detailField('الحالة', statusLabel(task.status)),
      detailField('الموعد', task.dueAt ? recordDate(task.dueAt) : null),
      detailField('تم الحفظ', recordDate(task.createdAt)),
    );
  } else if (recordType === 'reminder') {
    const reminder = record as ReminderRecord;
    fields.push(
      detailField('النص', reminder.text),
      detailField('الحالة', statusLabel(reminder.status)),
      detailField('الموعد', recordDate(reminder.dueAt)),
      detailField('المنطقة الزمنية', reminder.timezone),
      detailField('تم الحفظ', recordDate(reminder.createdAt)),
    );
  } else {
    const commitment = record as CommitmentRecord;
    fields.push(
      detailField('العنوان', commitment.title),
      detailField('الحالة', statusLabel(commitment.status)),
      detailField('الطرف المرتبط', commitment.personName),
      detailField('الموعد', commitment.dueAt ? recordDate(commitment.dueAt) : null),
      detailField('تم الحفظ', recordDate(commitment.createdAt)),
    );
  }
  return fields.filter((field): field is RecordDetailField => Boolean(field));
}

export function approvalFromAction(action: TurnResponse['action']): Approval | undefined {
  if (
    !action
    || !['approval_required', 'pending_confirmation'].includes(String(action.type))
    || typeof action.operationId !== 'string'
  ) {
    return undefined;
  }
  const display = action.display && typeof action.display === 'object'
    ? action.display as { title?: unknown; details?: unknown }
    : {};
  const actionArgs = action.args && typeof action.args === 'object'
    ? action.args as Record<string, unknown>
    : {};
  const candidatesFrom = (value: unknown): ApprovalCandidate[] | undefined => (
    Array.isArray(value)
      ? value.filter((item): item is ApprovalCandidate => (
        Boolean(item)
        && typeof item === 'object'
        && typeof (item as { id?: unknown }).id === 'string'
        && typeof (item as { name?: unknown }).name === 'string'
      ))
      : undefined
  );
  const personCandidates = candidatesFrom(action.personCandidates ?? actionArgs.personCandidates);
  const projectCandidates = candidatesFrom(action.projectCandidates ?? actionArgs.projectCandidates);
  const status = typeof action.status === 'string'
    && ['pending', 'executing', 'completed', 'rejected', 'expired', 'failed'].includes(action.status)
    ? action.status as ApprovalStatus
    : 'pending';
  return {
    operationId: action.operationId,
    title: typeof display.title === 'string' ? display.title : 'تأكيد العملية',
    details: Array.isArray(display.details)
      ? display.details.filter((detail): detail is string => typeof detail === 'string')
      : [],
    status,
    ...(action.confirmationMode === 'immediate_approval' || action.confirmationMode === 'deferred_confirmation'
      ? { confirmationMode: action.confirmationMode }
      : {}),
    ...(action.quickApprove === true ? { quickApprove: true } : {}),
    ...(typeof action.toolName === 'string' ? { toolName: action.toolName } : {}),
    ...(action.args && typeof action.args === 'object' ? { initialArgs: action.args as Record<string, unknown> } : {}),
    ...(personCandidates ? { personCandidates } : {}),
    ...(projectCandidates ? { projectCandidates } : {}),
  };
}

export function approvalsFromAction(action: TurnResponse['action']): Approval[] {
  const value = action && typeof action === 'object' ? action as Record<string, unknown> : null;
  if (!value || !['approval_required', 'pending_confirmation'].includes(String(value.type))) return [];
  const rawApprovals = Array.isArray(value.approvals) ? value.approvals : [value];
  return rawApprovals.flatMap((raw) => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : value;
    const merged = { ...value, ...item };
    return approvalFromAction(merged as TurnResponse['action']) ?? [];
  });
}

export function recordLinkFromAction(action: TurnResponse['action']): MobileRecordRow | undefined {
  const value = objectValue(action);
  const type = stringValue(value.type, '');
  const amountMinor = typeof value.amountMinor === 'number' ? value.amountMinor : null;
  const currency = stringValue(value.currency, 'EGP');
  const occurredAt = typeof value.occurredAt === 'string' ? value.occurredAt : null;

  if (type === 'expense_recorded' && typeof value.expenseId === 'string') {
    return {
      id: value.expenseId,
      recordType: 'expense',
      title: stringValue(value.description, 'مصروف محفوظ'),
      subtitle: [
        stringValue(value.personName, stringValue(value.projectName, '')),
        occurredAt ? recordDate(occurredAt) : '',
      ].filter(Boolean).join(' · '),
      ...(amountMinor !== null ? { trailing: money(amountMinor, currency) } : {}),
    };
  }

  if ((type === 'person_created' || type === 'person_linked' || type === 'person_expense_total')
    && typeof value.personId === 'string') {
    return {
      id: value.personId,
      recordType: 'person',
      title: stringValue(value.personName, 'الشخص المرتبط'),
      subtitle: 'فتح تفاصيل الشخص',
    };
  }

  if ((type === 'project_created' || type === 'project_people')
    && typeof value.projectId === 'string') {
    return {
      id: value.projectId,
      recordType: 'project',
      title: stringValue(value.projectName, 'المشروع المرتبط'),
      subtitle: 'فتح تفاصيل المشروع',
    };
  }

  if (type === 'reminder_created' && typeof value.reminderId === 'string') {
    return {
      id: value.reminderId,
      recordType: 'reminder',
      title: stringValue(value.text, 'تذكير محفوظ'),
      subtitle: typeof value.dueAt === 'string' ? recordDate(value.dueAt) : 'فتح تفاصيل التذكير',
      trailing: statusLabel(typeof value.status === 'string' ? value.status : null),
    };
  }

  return undefined;
}

export function addOrigin(record: MobileRecordRow, conversationId: string, operationId?: string | null, turnId?: string | null): MobileRecordRow {
  return {
    ...record,
    origin: {
      conversationId,
      turnId: null,
      operationId: operationId ?? null,
    },
  };
}

export function secretaryContextFromRecord(record: MobileRecordRow): SecretaryChatContext {
  return {
    recordType: record.recordType,
    recordId: record.id,
    title: record.title,
    sourceConversationId: record.origin?.conversationId ?? null,
    sourceTurnId: record.origin?.turnId ?? null,
    sourceOperationId: record.origin?.operationId ?? null,
  };
}

export function messagesFromConversation(detail: unknown, conversationId: string): LocalMessage[] {
  const turns = arrayValue(objectValue(detail).recentTurns);
  const loadedMessages: LocalMessage[] = [];

  turns.forEach((rawTurn, index) => {
    const turn = objectValue(rawTurn);
    const turnId = typeof turn.turnId === 'string' ? turn.turnId : `turn-${index}`;
    const createdAt = typeof turn.createdAt === 'string' ? turn.createdAt : new Date().toISOString();
    const action = Object.keys(objectValue(turn.action)).length > 0 ? objectValue(turn.action) : undefined;
    const recordLink = action ? recordLinkFromAction(action) : undefined;
    const linkedRecord = recordLink ? addOrigin(recordLink, conversationId, typeof action?.operationId === 'string' ? action.operationId : null) : undefined;
    const inputId = typeof turn.inputId === 'string' ? turn.inputId : undefined;

    if (typeof turn.userMessage === 'string') {
      loadedMessages.push({
        id: `${conversationId}-${turnId}-user`,
        role: 'user',
        text: turn.userMessage,
        createdAt,
        ...(inputId ? { inputId } : {}),
      });
    }
    if (typeof turn.assistantMessage === 'string') {
      loadedMessages.push({
        id: `${conversationId}-${turnId}-assistant`,
        role: 'assistant',
        text: turn.assistantMessage,
        createdAt,
        ...(action ? (() => {
          const approvals = approvalsFromAction(action as TurnResponse['action']);
          return approvals.length > 0
            ? { approval: approvals[0], ...(approvals.length > 1 ? { approvals } : {}) }
            : {};
        })() : {}),
        ...(linkedRecord ? { recordLink: linkedRecord } : {}),
      });
    }
  });

  return loadedMessages.length > 0 ? loadedMessages : [starterMessage];
}

export function RecordsView({
  colors,
  onOpenRecord,
  onOpenSection,
  onBack,
  sectionKeys,
  title = 'السجلات',
  subtitle = 'استكشف معلوماتك المرتبطة',
  titleEn = 'Records',
  subtitleEn = 'Explore your connected information',
}: {
  colors: ReturnType<typeof useColors>;
  onOpenRecord: (record: MobileRecordRow) => void;
  onOpenSection?: (sectionKey: string) => void;
  onBack?: () => void;
  sectionKeys?: string[];
  title?: string;
  subtitle?: string;
  titleEn?: string;
  subtitleEn?: string;
}) {
  const { language } = useLanguage();
  const recordsQuery = useListRecords({
    query: {
      queryKey: getListRecordsQueryKey(),
      staleTime: 20_000,
    },
  });
  const sections = recordSections(recordsQuery.data).filter((section) => !sectionKeys || sectionKeys.includes(section.key));
  const totalRecords = sections.reduce((total, section) => total + section.data.length, 0);

  return (
    <SectionList
      style={styles.recordsView}
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <Pressable
          testID={`record-${item.recordType}-${item.id}`}
          accessibilityRole="button"
          accessibilityLabel={`فتح ${item.title}`}
          onPress={() => onOpenRecord(item)}
          style={({ pressed }) => [
            styles.recordRow,
            { borderBottomColor: colors.border, opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <View style={styles.recordCopy}>
            <Text style={[styles.recordTitle, { color: colors.foreground }]} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={[styles.recordSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
              {item.subtitle}
            </Text>
          </View>
          {item.trailing && (
            <Text style={[styles.recordTrailing, { color: colors.primary }]} numberOfLines={2}>
              {item.trailing}
            </Text>
          )}
          <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
        </Pressable>
      )}
      renderSectionHeader={({ section }) => (
        <View style={[styles.recordSectionHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <View style={styles.recordSectionTitle}>
            <Text style={[styles.recordSectionName, { color: colors.foreground }]}>
              {recordSectionLabel(language, section.key, section.title)}
            </Text>
          </View>
          <Text style={[styles.recordCount, { color: colors.mutedForeground }]}>{section.data.length}</Text>
        </View>
      )}
      ListHeaderComponent={(
        <View>
          <View style={styles.recordsIntro}>
            <View>
            <Text style={[styles.recordsTitle, { color: colors.foreground }]}>
              {localized(language, title, titleEn)}
            </Text>
              <Text style={[styles.recordsSubtitle, { color: colors.mutedForeground }]}>
              {localized(language, subtitle, subtitleEn)}
              </Text>
            </View>
            <View style={styles.recordsHeaderActions}>
              {onBack && (
                <Pressable
                  testID="records-back-to-office"
                  accessibilityRole="button"
                  accessibilityLabel="العودة إلى مكتب السكرتير"
                  onPress={onBack}
                  style={({ pressed }) => [
                    styles.iconButton,
                    { borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                  ]}
                >
                  <Feather name="arrow-right" size={17} color={colors.foreground} />
                </Pressable>
              )}
              <Pressable
                testID="refresh-records"
                accessibilityRole="button"
                accessibilityLabel="تحديث السجلات"
                onPress={() => void recordsQuery.refetch()}
                style={({ pressed }) => [
                  styles.iconButton,
                  { borderColor: colors.border, opacity: pressed || recordsQuery.isFetching ? 0.6 : 1 },
                ]}
              >
                {recordsQuery.isFetching ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Feather name="refresh-cw" size={17} color={colors.foreground} />
                )}
              </Pressable>
            </View>
          </View>

          <View style={styles.recordSummaryGrid}>
            {sections.map((section) => (
              <Pressable
                key={section.key}
                testID={`record-summary-${section.key}`}
                accessibilityRole="button"
                accessibilityLabel={`فتح ${section.title}`}
                disabled={section.data.length === 0}
                onPress={() => {
                  if (onOpenSection) {
                    onOpenSection(section.key);
                    return;
                  }
                  const firstRecord = section.data[0];
                  if (firstRecord) onOpenRecord(firstRecord);
                }}
                style={({ pressed }) => [
                  styles.recordSummaryCard,
                  { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.68 : section.data.length === 0 ? 0.55 : 1 },
                ]}
              >
                <Text style={[styles.recordSummaryCount, { color: colors.primary }]}>{section.data.length}</Text>
                <Text style={[styles.recordSummaryLabel, { color: colors.mutedForeground }]}>
                  {recordSectionLabel(language, section.key, section.title)}
                </Text>
                <Feather name="arrow-up-left" size={12} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>

          {recordsQuery.isError && (
            <View style={[styles.recordsError, { backgroundColor: colors.destructive, borderColor: colors.destructive }]}>
              <View style={styles.recordsErrorCopy}>
                <Text style={[styles.recordsErrorTitle, { color: colors.destructiveForeground }]}>
                  {localized(language, 'تعذر تحميل السجلات', 'Unable to load records')}
                </Text>
                <Text style={[styles.recordsErrorText, { color: colors.destructiveForeground }]}>
                  {localized(language, 'تحقق من الاتصال وحاول التحديث مرة أخرى.', 'Check your connection and try refreshing again.')}
                </Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => void recordsQuery.refetch()}>
                <Text style={[styles.recordsRetry, { color: colors.destructiveForeground }]}>
                  {localized(language, 'حاول', 'Retry')}
                </Text>
              </Pressable>
            </View>
          )}

          {recordsQuery.isLoading && (
            <View style={styles.recordsLoading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.recordsLoadingText, { color: colors.mutedForeground }]}>
                {localized(language, 'جاري تحميل بياناتك…', 'Loading your data…')}
              </Text>
            </View>
          )}

          {!recordsQuery.isLoading && !recordsQuery.isError && totalRecords === 0 && (
            <View style={[styles.recordsEmpty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.recordsEmptyTitle, { color: colors.foreground }]}>
                {localized(language, 'لا توجد سجلات بعد', 'No records yet')}
              </Text>
              <Text style={[styles.recordsEmptyText, { color: colors.mutedForeground }]}>
                {localized(language, 'أي مصروف أو تذكير أو مهمة تحفظها سيظهر هنا.', 'Expenses, reminders, and tasks you save will appear here.')}
              </Text>
            </View>
          )}
        </View>
      )}
      contentContainerStyle={styles.recordsList}
      stickySectionHeadersEnabled={false}
      showsVerticalScrollIndicator={false}
      refreshControl={(
        <RefreshControl
          refreshing={recordsQuery.isFetching}
          onRefresh={() => void recordsQuery.refetch()}
          tintColor={colors.primary}
        />
      )}
    />
  );
}

type SecretaryChatProps = {
  colors: ReturnType<typeof useColors>;
  messages: LocalMessage[];
  draft: string;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  onQuickPrompt?: (value: string) => void;
  onFocusChat?: () => void;
  isSending: boolean;
  onApprove: (approval: Approval, args?: Record<string, unknown>) => void;
  onReject: (approval: Approval) => void;
  busyOperationId: string | null;
  onOpenRecord: (record: MobileRecordRow) => void;
  onRetryInput?: (attachment: LocalMessage['inputAttachment']) => void;
  retryingInput?: boolean;
  context?: MobileRecordRow | null;
  smartSignal?: string;
  quickPrompts?: Array<{ label: string; value: string }>;
  inputState?: SecretaryInputState;
  onToggleVoice?: () => void;
  onCaptureReceipt?: () => void;
  onPickReceipt?: () => void;
  inputReview?: SecretaryInputResult | null;
  onChangeInputReview?: (result: SecretaryInputResult) => void;
  onClearInputReview?: () => void;
  compact?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  onOpenPearlSheet?: (tab: 'records' | 'context') => void;
  sheetLift?: number;
};

function CentralSecretaryChat({
  colors,
  messages,
  draft,
  onChangeDraft,
  onSend,
  onQuickPrompt,
  onFocusChat,
  isSending,
  onApprove,
  onReject,
  busyOperationId,
  onOpenRecord,
  onRetryInput,
  retryingInput = false,
  context,
  smartSignal,
  quickPrompts,
  compact = false,
  expanded = false,
  onToggleExpanded,
  onOpenPearlSheet,
  sheetLift = 0,
  inputState = 'idle',
  onToggleVoice,
  onCaptureReceipt,
  onPickReceipt,
  inputReview,
  onChangeInputReview,
  onClearInputReview,
}: SecretaryChatProps) {
  const inputBlocked = receiptNeedsReview(inputReview);
  const { language } = useLanguage();
  const insets = useSafeAreaInsets();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [inputHeight, setInputHeight] = useState(30);
  const transcriptRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (!draft) setInputHeight(30);
  }, [draft]);
  const transcriptMessages = messages.length === 1 && messages[0]?.id === 'welcome' ? [] : messages;
  const promptOptions = quickPrompts ?? [
    { label: localized(language, 'لخّص يومي', 'Summarize today'), value: 'اعرض ملخص اليوم' },
    { label: localized(language, 'ابحث عن مصروف', 'Find an expense'), value: 'اعرض مصروفاتي الأخيرة' },
    { label: localized(language, 'أضف مهمة', 'Add a task'), value: 'أنشئ مهمة جديدة' },
  ];
  const inputMaxHeight = expanded ? 132 : 76;
  const inputContentHeight = (event: { nativeEvent: { contentSize: { height: number } } }) => {
    setInputHeight(Math.min(inputMaxHeight, Math.max(30, event.nativeEvent.contentSize.height)));
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      transcriptRef.current?.scrollToEnd({ animated: false });
    }, 0);
    return () => clearTimeout(timer);
  }, [messages.length, isSending, expanded]);
  return (
    <>
    <View
      testID={compact ? 'record-context-chat' : 'main-central-chat'}
      style={[
        compact ? styles.recordChatPanel : styles.centralChatPanel,
        !compact && expanded && styles.centralChatExpanded,
        {
            backgroundColor: compact ? colors.card : 'transparent',
            borderColor: compact ? colors.border : colors.border,
            shadowColor: colors.primary,
            shadowOpacity: compact ? 0 : 0.12,
            shadowRadius: compact ? 0 : 26,
            shadowOffset: { width: 0, height: 12 },
            elevation: compact ? 0 : 5,
          },
      ]}
    >
      {!compact && expanded && (
        <LinearGradient
          pointerEvents="none"
          colors={[
            colorWithAlpha(colors.card, 0.78),
            colorWithAlpha(colors.background, 0.48),
            colorWithAlpha(colors.muted, 0.62),
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.centralChatSurface}
        />
      )}
      {!compact && expanded && (
        <View pointerEvents="none" style={styles.centralChatAmbient}>
          <View style={[styles.centralChatAmbientOrb, { backgroundColor: colors.primary }]} />
          <View style={[styles.centralChatAmbientOrbSmall, { backgroundColor: colors.accent }]} />
        </View>
      )}
         <View style={[styles.centralChatHeading, !compact && styles.centralChatHeadingPearl, { borderBottomColor: colors.border }]}>
        {!compact && (
          <Pressable
            testID="main-chat-focus"
            accessibilityRole="button"
            accessibilityLabel={localized(language, 'فتح المحادثة', 'Focus secretary chat')}
            onPress={onFocusChat}
            style={({ pressed }) => [
              styles.centralChatIcon,
              styles.centralChatHeroIcon,
               { backgroundColor: colors.muted, borderColor: colors.border, opacity: pressed ? 0.72 : 1 },
            ]}
          >
            <Feather name={isSending ? 'loader' : 'star'} size={15} color={colors.primary} />
          </Pressable>
        )}
        <View style={styles.centralChatHeadingCopy}>
          <Text style={[styles.centralChatTitle, { color: colors.foreground }]}>
            {context
              ? `${localized(language, 'السكرتير', 'Secretary')} · ${context.title}`
              : localized(language, 'حديثنا اليوم', 'Today’s conversation')}
          </Text>
          <Text style={[styles.centralChatHint, { color: colors.mutedForeground }]}>
            {context
              ? localized(language, 'اسأل عن هذا السياق أو علاقاته', 'Ask about this context or its relationships')
              : localized(language, 'مكان واحد للفكرة والخطوة التالية', 'One place for the idea and the next step')}
          </Text>
        </View>
        {!compact && (
          <View style={styles.centralChatHeaderActions}>
            <Pressable
              testID="main-chat-suggestions-toggle"
              accessibilityRole="button"
              accessibilityLabel={localized(language, onOpenPearlSheet ? 'فتح السجلات' : 'فتح اقتراحات السكرتير', onOpenPearlSheet ? 'Open records' : 'Open secretary suggestions')}
              accessibilityState={onOpenPearlSheet ? undefined : { expanded: suggestionsOpen }}
              onPress={() => onOpenPearlSheet ? onOpenPearlSheet('records') : setSuggestionsOpen((open) => !open)}
              style={({ pressed }) => [
                styles.centralChatHeaderButton,
                { backgroundColor: suggestionsOpen && !onOpenPearlSheet ? colors.muted : 'transparent', opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Feather name={onOpenPearlSheet ? 'archive' : 'menu'} size={17} color={colors.foreground} />
            </Pressable>
            {onToggleExpanded && !onOpenPearlSheet && (
              <Pressable
                testID="main-chat-expand-toggle"
                accessibilityRole="button"
                accessibilityLabel={expanded
                  ? localized(language, 'تصغير المحادثة', 'Collapse chat')
                  : localized(language, 'تكبير المحادثة', 'Expand chat')}
                accessibilityState={{ expanded }}
                onPress={onToggleExpanded}
                style={({ pressed }) => [
                  styles.centralChatHeaderButton,
                  { opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <Feather name={expanded ? 'minimize-2' : 'maximize-2'} size={17} color={colors.foreground} />
              </Pressable>
            )}
          </View>
        )}
      </View>

      {context && (
        <View style={[styles.chatContextChip, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Text style={[styles.chatContextText, { color: colors.mutedForeground }]} numberOfLines={1}>
            {localized(language, 'السياق الحالي', 'Current context')}: {context.recordType} · {context.title}
          </Text>
        </View>
      )}

      {!compact && expanded && onQuickPrompt && (
        <ScrollView
          horizontal
          style={styles.centralChatPromptScroll}
          showsHorizontalScrollIndicator={false}
           contentContainerStyle={[styles.centralChatPromptRail, !compact && styles.centralChatPromptRailPearl]}
          keyboardShouldPersistTaps="handled"
        >
          {promptOptions.map(({ label, value }) => (
            <Pressable
              key={`rail-${value}`}
              testID={`main-chat-prompt-rail-${value}`}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => onQuickPrompt(value)}
              style={({ pressed }) => [
                styles.centralChatPrompt,
                {
                   backgroundColor: 'transparent',
                  borderColor: colors.border,
                  opacity: pressed ? 0.65 : 1,
                },
              ]}
            >
              <Text style={[styles.centralChatPromptText, { color: colors.foreground }]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <ScrollView
        testID={compact ? 'record-context-transcript' : 'main-chat-transcript'}
        ref={transcriptRef}
        style={[
          styles.centralChatTranscript,
          compact && styles.recordChatTranscript,
          !compact && expanded && styles.centralChatTranscriptExpanded,
        ]}
        contentContainerStyle={[
          styles.centralChatTranscriptContent,
           !compact && styles.centralChatTranscriptContentPearl,
          !compact && expanded && transcriptMessages.length === 0 && styles.centralChatTranscriptEmptyContent,
           !compact && expanded && transcriptMessages.length === 0 && styles.centralChatTranscriptEmptyContentPearl,
        ]}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        {!compact && transcriptMessages.length === 0 && !isSending && (
          <View style={styles.centralChatEmpty}>
            <View style={[styles.centralChatEmptyIcon, { backgroundColor: colors.muted }]}>
              <Feather name="message-circle" size={20} color={colors.primary} />
            </View>
            <Text style={[styles.centralChatEmptyTitle, { color: colors.foreground }]}>
              {localized(language, 'إيه أهم حاجة أساعدك فيها؟', 'What should we take care of?')}
            </Text>
            <Text style={[styles.centralChatEmptyText, { color: colors.mutedForeground }]}>
              {context
                ? localized(language, 'اسأل عن السجل الحالي أو أي علاقة مرتبطة به.', 'Ask about this record or anything connected to it.')
                : localized(language, 'اكتب بطريقتك الطبيعية، وأنا أرتّب الخطوة التالية معك.', 'Write naturally, and I’ll help organize the next step.')}
            </Text>
          </View>
        )}
        {transcriptMessages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            colors={colors}
            onApprove={onApprove}
            onReject={onReject}
            onOpenRecord={onOpenRecord}
            onRetryInput={onRetryInput}
            retryingInput={retryingInput}
            busyOperationId={busyOperationId}
            pearlStyle={!compact}
          />
        ))}
        {isSending && (
          <View style={[styles.centralChatTyping, { backgroundColor: colors.muted }]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.centralChatTypingText, { color: colors.mutedForeground }]}>
              {localized(language, 'السكرتير يفكر…', 'The secretary is thinking…')}
            </Text>
          </View>
        )}
      </ScrollView>
      </View>

      {inputReview?.kind === 'receipt' && onChangeInputReview && onClearInputReview && (
        <ReceiptReviewCard
          result={inputReview}
          colors={colors}
          language={language}
          onChange={onChangeInputReview}
          onClear={onClearInputReview}
        />
      )}
      {inputReview && inputReview.kind !== 'receipt' && (
        <View style={[styles.inputReview, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <View style={styles.inputReviewCopy}>
            <Feather name="mic" size={14} color={colors.primary} />
            <Text style={[styles.inputReviewTitle, { color: colors.foreground }]}>
              {localized(language, 'نص صوتي جاهز للمراجعة', 'Voice text ready to review')}
            </Text>
            <Text style={[styles.inputReviewText, { color: colors.mutedForeground }]} numberOfLines={2}>
              {inputReview.text}
            </Text>
          </View>
          {onClearInputReview && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={localized(language, 'إلغاء المرفق', 'Clear input')}
              onPress={onClearInputReview}
              style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1, padding: 4 })}
            >
              <Feather name="x" size={15} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      )}
      <View style={[
        styles.centralChatComposer,
        expanded && styles.centralChatComposerExpanded,
        expanded && { bottom: 78 + insets.bottom + sheetLift },
        {
          backgroundColor: expanded ? colors.card : 'transparent',
          borderColor: expanded ? colors.border : 'transparent',
        },
      ]}>
        <View style={styles.centralChatInputActions}>
          {onToggleVoice && (
            <Pressable
              testID={compact ? 'record-context-voice' : 'main-voice-input'}
              accessibilityRole="button"
              accessibilityLabel={inputState === 'recording'
                ? localized(language, 'إيقاف التسجيل', 'Stop recording')
                : localized(language, 'تسجيل طلب صوتي', 'Record a voice request')}
              accessibilityState={{ busy: inputState === 'processing' }}
              onPress={onToggleVoice}
              disabled={inputState === 'processing'}
              style={({ pressed }) => [
                styles.centralChatInputAction,
                { backgroundColor: inputState === 'recording' ? colors.destructive : 'transparent', opacity: pressed || inputState === 'processing' ? 0.6 : 1 },
              ]}
            >
              {inputState === 'processing'
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Feather name={inputState === 'recording' ? 'square' : 'mic'} size={15} color={inputState === 'recording' ? colors.destructiveForeground : colors.primary} />}
            </Pressable>
          )}
          {(onCaptureReceipt || onPickReceipt) && (
            <Pressable
              testID={compact ? 'record-context-receipt-library' : 'main-receipt-library'}
              accessibilityRole="button"
              accessibilityLabel={localized(language, 'إرفاق فاتورة — اضغط مطولًا للتصوير', 'Attach a receipt — long press to take a photo')}
              onPress={onPickReceipt}
              onLongPress={onCaptureReceipt}
              disabled={inputState !== 'idle'}
              style={({ pressed }) => [styles.centralChatInputAction, { backgroundColor: 'transparent', opacity: pressed || inputState !== 'idle' ? 0.6 : 1 }]}
            >
              <Feather name="paperclip" size={15} color={colors.primary} />
            </Pressable>
          )}
        </View>
        <TextInput
          testID={compact ? 'record-context-input' : 'main-message-input'}
          value={draft}
          onChangeText={onChangeDraft}
          onContentSizeChange={inputContentHeight}
          onSubmitEditing={onSend}
          placeholder={context
            ? localized(language, 'اكتب سؤالك عن هذا السياق…', 'Ask about this context…')
            : localized(language, 'أكمل حديثك هنا…', 'Continue your thought…')}
          placeholderTextColor={colors.mutedForeground}
          multiline
          maxLength={1000}
          returnKeyType="send"
          blurOnSubmit={false}
          textAlign="right"
          style={[styles.centralChatInput, expanded && styles.centralChatInputExpanded, { color: colors.foreground, height: inputHeight, maxHeight: inputMaxHeight }]}
        />
        <Pressable
          testID={compact ? 'record-context-send' : 'main-send-message'}
          accessibilityRole="button"
          accessibilityLabel={context
            ? localized(language, 'إرسال سؤال عن السجل', 'Send a question about the record')
            : localized(language, 'إرسال طلب إلى السكرتير', 'Send a request to the secretary')}
          onPress={onSend}
           disabled={!draft.trim() || isSending || inputBlocked}
          style={({ pressed }) => [
            styles.centralChatSend,
             { backgroundColor: colors.primary, opacity: !draft.trim() || isSending || inputBlocked ? 0.4 : pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="arrow-up" size={17} color={colors.primaryForeground} />
        </Pressable>
      </View>
      {!compact && onQuickPrompt && expanded && !onOpenPearlSheet && (
        <View style={styles.centralChatQuickDock}>
          <Pressable
            testID="main-chat-quick-actions"
            accessibilityRole="button"
            accessibilityLabel={localized(language, 'فتح الإجراءات السريعة', 'Open quick actions')}
            accessibilityState={{ expanded: suggestionsOpen }}
            onPress={() => setSuggestionsOpen((open) => !open)}
            style={({ pressed }) => [
              styles.centralChatQuickButton,
              { backgroundColor: colors.muted, opacity: pressed ? 0.9 : 0.72 },
            ]}
          >
            <Feather name="zap" size={13} color={colors.primary} />
            <Text style={[styles.centralChatQuickButtonText, { color: colors.foreground }]}>
              {localized(language, 'إجراءات سريعة', 'Quick actions')}
            </Text>
          </Pressable>
        </View>
      )}
      {!compact && onQuickPrompt && suggestionsOpen && !onOpenPearlSheet && (
        <View
          style={[
            styles.centralChatSuggestionMenu,
            expanded && styles.centralChatSuggestionMenuExpanded,
            { backgroundColor: colors.card, shadowColor: colors.foreground },
          ]}
        >
          {promptOptions.map(({ label, value }) => (
            <Pressable
              key={value}
              testID={`main-chat-prompt-${value}`}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => onQuickPrompt(value)}
              style={({ pressed }) => [
                styles.centralChatPrompt,
                { backgroundColor: colors.muted, opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Text style={[styles.centralChatPromptText, { color: colors.foreground }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {!onOpenPearlSheet && (
        <Text style={[styles.centralChatFooter, { color: colors.mutedForeground }]}>
          {localized(language, 'نفس المحادثة والعمليات والموافقات · لا يتم الإرسال تلقائيًا', 'Same conversation, actions, and approvals · nothing is sent automatically')}
        </Text>
      )}
    </>
  );
}

export function MainOffice({
  colors,
  language,
  onOpenRecord,
  onOpenRecords,
  onOpenFinancial,
  assistantPreferences,
  onOpenConversation,
  onFocusChat,
  onAskSecretary,
  pendingApprovals,
  messages,
  draft,
  onChangeDraft,
  onSend,
  inputRef,
  isSending,
  onApprove,
  onReject,
  busyOperationId,
  recordOrigins,
  chatContext,
  onRetryInput,
  retryingInput = false,
  recentConversations,
  conversationSearch,
  onChangeConversationSearch,
  conversationsLoading,
  inputState,
  onToggleVoice,
  onCaptureReceipt,
  onPickReceipt,
  inputReview,
  onChangeInputReview,
  onClearInputReview,
}: {
  colors: ReturnType<typeof useColors>;
  language: AppLanguage;
  onOpenRecord: (record: MobileRecordRow) => void;
  onRetryInput?: (attachment: LocalMessage['inputAttachment']) => void;
  retryingInput?: boolean;
  onOpenRecords: () => void;
  onOpenFinancial: () => void;
  assistantPreferences: AssistantPreferences;
  onOpenConversation: (conversationId: string) => void;
  onFocusChat: (record?: MobileRecordRow) => void;
  onAskSecretary: (draft: string) => void;
  pendingApprovals: Approval[];
  messages: LocalMessage[];
  draft: string;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  inputRef: { current: TextInput | null };
  isSending: boolean;
  onApprove: (approval: Approval, args?: Record<string, unknown>) => void;
  onReject: (approval: Approval) => void;
  busyOperationId: string | null;
  recordOrigins: Record<string, RecordOrigin>;
  chatContext: MobileRecordRow | null;
  recentConversations: ConversationSummary[];
  conversationSearch: string;
  onChangeConversationSearch: (value: string) => void;
  conversationsLoading: boolean;
  inputState?: SecretaryInputState;
  onToggleVoice?: () => void;
  onCaptureReceipt?: () => void;
  onPickReceipt?: () => void;
  inputReview?: SecretaryInputResult | null;
  onChangeInputReview?: (result: SecretaryInputResult) => void;
  onClearInputReview?: () => void;
}) {
  const todayQuery = useGetTodayContext({
    query: {
      queryKey: getGetTodayContextQueryKey(),
      staleTime: 30_000,
    },
  });
  const [financialExpanded, setFinancialExpanded] = useState(false);
  const [pearlSheetPosition, setPearlSheetPosition] = useState(80);
  const [pearlSheetTab, setPearlSheetTab] = useState<'records' | 'context'>('records');
  const [pearlSheetOffset, setPearlSheetOffset] = useState(0);
  const pearlSheetHeight = useRef(0);
  const pearlSheetPositionRef = useRef(80);
  const pearlSheetDragStartOffset = useRef(0);
  const pearlSheetDragStartPosition = useRef(80);
  const pearlSheetWasDragged = useRef(false);
  const pearlSheetOpen = pearlSheetPosition < 80;
  const pearlComposerLift = (
    Math.max(0, pearlSheetHeight.current * 0.8 - pearlSheetOffset)
    + 40
  );
  const [recentSearchOpen, setRecentSearchOpen] = useState(false);
  const recentSearchRef = useRef<TextInput>(null);
  const recordsQuery = useListRecords({
    query: {
      queryKey: getListRecordsQueryKey(),
      enabled: financialExpanded,
      staleTime: 20_000,
    },
  });
  const contextData = todayQuery.data?.context;
  const context: TodayContext = contextData ?? {
    upcomingReminders: [],
    recentExpenses: [],
    activeProjects: [],
    relevantPeople: [],
    pendingTasks: [],
    asOf: '',
  };
  const recentTotal = context
    ? [...context.recentExpenses.reduce((totals, expense) => {
      totals.set(expense.currency, (totals.get(expense.currency) ?? 0) + expense.amountMinor);
      return totals;
    }, new Map<string, number>())].map(([currency, amount]) => money(amount, currency)).join('، ')
    : '';
  const attentionCount = pendingApprovals.length
    + (context?.pendingTasks.length ?? 0)
    + (context?.upcomingReminders.length ?? 0);

  function openReminder(reminder: TodayContextReminder) {
    onOpenRecord({
      id: reminder.id,
      recordType: 'reminder',
      title: reminder.text,
      subtitle: `${recordDate(reminder.dueAt)} · ${reminder.timezone}`,
      trailing: statusLabel(reminder.status),
    });
  }

  function openTask(task: TodayContextTask) {
    onOpenRecord({
      id: task.id,
      recordType: 'task',
      title: task.title,
      subtitle: task.dueAt ? `موعدها ${recordDate(task.dueAt)}` : 'مهمة مستمرة',
      trailing: statusLabel(task.status),
    });
  }

  function focusAndExpandChat() {
    onFocusChat();
  }

  function openPearlSheet(tab: 'records' | 'context') {
    setPearlSheetTab(tab);
    animatePearlSheetTo(43);
  }

  function animatePearlSheetTo(position: number) {
    const nextPosition = Math.max(0, Math.min(80, position));
    pearlSheetPositionRef.current = nextPosition;
    setPearlSheetPosition(nextPosition);
    const targetOffset = pearlSheetHeight.current * (nextPosition / 100);
    setPearlSheetOffset(targetOffset);
  }

  const pearlSheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gestureState) => Math.abs(gestureState.dy) > 3,
      onPanResponderGrant: () => {
        pearlSheetWasDragged.current = false;
        pearlSheetDragStartPosition.current = pearlSheetPositionRef.current;
        pearlSheetDragStartOffset.current = pearlSheetHeight.current * (pearlSheetPositionRef.current / 100);
      },
      onPanResponderMove: (_event, gestureState) => {
        const height = pearlSheetHeight.current;
        if (!height) return;
        if (Math.abs(gestureState.dy) > 3) pearlSheetWasDragged.current = true;
        const nextOffset = Math.max(0, Math.min(height * 0.8, pearlSheetDragStartOffset.current + gestureState.dy));
        setPearlSheetOffset(nextOffset);
      },
      onPanResponderRelease: (_event, gestureState) => {
        const height = pearlSheetHeight.current;
        if (!height) return;
        const currentOffset = Math.max(
          0,
          Math.min(height * 0.8, pearlSheetDragStartOffset.current + gestureState.dy),
        );
        const currentPosition = (currentOffset / height) * 100;
        const snapPoints = [0, 43, 80];
        const nearest = snapPoints.reduce((best, point) => (
          Math.abs(point - currentPosition) < Math.abs(best - currentPosition) ? point : best
        ));
        animatePearlSheetTo(nearest);
        setTimeout(() => {
          pearlSheetWasDragged.current = false;
        }, 0);
      },
      onPanResponderTerminate: () => {
        animatePearlSheetTo(pearlSheetDragStartPosition.current);
        pearlSheetWasDragged.current = false;
      },
    }),
  ).current;

  const financialSections = recordSections(recordsQuery.data);
  const commitmentSection = financialSections.find((section) => section.key === 'commitments');
  const latestEdits = context ? [
    ...context.recentExpenses.map((expense) => ({
      id: `expense-${expense.id}`,
      record: {
        id: expense.id,
        recordType: 'expense',
        title: expense.description,
        subtitle: [expense.personName ?? expense.projectName, recordDate(expense.occurredAt)].filter(Boolean).join(' · '),
        trailing: money(expense.amountMinor, expense.currency),
        origin: recordOrigins[expense.id] ?? null,
      } satisfies MobileRecordRow,
      icon: 'dollar-sign' as FeatherName,
      meta: localized(language, 'مصروف محفوظ', 'Expense saved'),
    })),
    ...context.pendingTasks.map((task) => ({
      id: `task-${task.id}`,
      record: {
        id: task.id,
        recordType: 'task',
        title: task.title,
        subtitle: task.dueAt ? recordDate(task.dueAt) : localized(language, 'مهمة مستمرة', 'Ongoing task'),
        trailing: statusLabel(task.status),
      } satisfies MobileRecordRow,
      icon: 'check-square' as FeatherName,
      meta: localized(language, 'مهمة محدثة', 'Task updated'),
    })),
    ...context.upcomingReminders.map((reminder) => ({
      id: `reminder-${reminder.id}`,
      record: {
        id: reminder.id,
        recordType: 'reminder',
        title: reminder.text,
        subtitle: recordDate(reminder.dueAt),
        trailing: statusLabel(reminder.status),
      } satisfies MobileRecordRow,
      icon: 'bell' as FeatherName,
      meta: localized(language, 'تذكير محدث', 'Reminder updated'),
    })),
  ].slice(0, 5) : [];
  const pearlSheetRecords = latestEdits;
  const normalizedSearch = conversationSearch.trim().toLocaleLowerCase();
  const filteredLatestEdits = normalizedSearch
    ? latestEdits.filter((edit) => [
      edit.record.title,
      edit.record.subtitle,
      edit.meta,
      edit.record.trailing ?? '',
    ].join(' ').toLocaleLowerCase().includes(normalizedSearch))
    : latestEdits;
  const hasRecentActivity = recentConversations.length > 0 || filteredLatestEdits.length > 0;
  const contextualRecordCount = contextData
    ? context.pendingTasks.length
      + context.upcomingReminders.length
      + context.activeProjects.length
      + context.recentExpenses.length
    : 0;
  const smartSignalBase = assistantPreferences.activity === 'quiet'
    ? localized(language, 'وضع الاستعداد · سأنتظر طلبك', 'Standby mode · waiting for your request')
    : todayQuery.isFetching
    ? localized(language, 'أقرأ موجز اليوم…', 'Reading today’s context…')
    : pendingApprovals.length > 0 && assistantPreferences.proactive !== 'low'
      ? `${pendingApprovals.length} ${localized(language, 'موافقة تحتاج قرارك', 'approval needs your decision')}`
      : context.pendingTasks.length + context.upcomingReminders.length > 0
        ? `${context.pendingTasks.length + context.upcomingReminders.length} ${assistantPreferences.proactive === 'high' ? localized(language, 'إشارات رتّبها السكرتير اليوم', 'signals organized for today') : localized(language, 'عناصر في موجز اليوم', 'items in today’s brief')}`
        : `${contextualRecordCount} ${localized(language, 'عنصرًا في سياقك اليوم', 'items in today’s context')}`;
  const smartSignal = `${smartSignalBase} · ${assistantPreferences.intelligence === 'deep'
    ? localized(language, 'تحليل عميق', 'deep analysis')
    : assistantPreferences.intelligence === 'fast'
      ? localized(language, 'رد سريع', 'fast response')
      : localized(language, 'سياق متوازن', 'balanced context')}`;
  const parsedContextDate = contextData?.asOf ? new Date(contextData.asOf) : null;
  const pearlDateLabel = parsedContextDate && !Number.isNaN(parsedContextDate.getTime())
    ? new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ar-EG', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(parsedContextDate)
    : localized(language, 'اليوم', 'Today');
  const summaryCards: Array<{
    key: string;
    label: string;
    labelEn: string;
    value: string;
    hint: string;
    hintEn: string;
    icon: FeatherName;
  }> = [
    {
      key: 'tasks',
      label: 'المهام',
      labelEn: 'Tasks',
      value: contextData ? String(context.pendingTasks.length) : '—',
      hint: 'مفتوحة',
      hintEn: 'Open',
      icon: 'check-square',
    },
    {
      key: 'appointments',
      label: 'المواعيد',
      labelEn: 'Appointments',
      value: contextData ? String(context.upcomingReminders.length) : '—',
      hint: 'قادمة',
      hintEn: 'Upcoming',
      icon: 'calendar',
    },
    {
      key: 'accounts',
      label: 'الحسابات',
      labelEn: 'Accounts',
      value: recentTotal || '—',
      hint: 'آخر المصروفات',
      hintEn: 'Recent spend',
      icon: 'dollar-sign',
    },
    {
      key: 'records',
      label: 'السجلات',
      labelEn: 'Records',
      value: contextData ? String(contextualRecordCount) : '—',
      hint: 'في موجز اليوم',
      hintEn: 'In today’s view',
      icon: 'file-text',
    },
  ];
  const quickActions: Array<{ icon: FeatherName; label: string; labelEn: string; draft: string }> = [
    pendingApprovals.length > 0
      ? { icon: 'shield', label: 'راجع الموافقات', labelEn: 'Review approvals', draft: 'إيه اللي محتاج موافقتي؟' }
      : { icon: 'sun', label: 'رتّب يومي', labelEn: 'Organize my day', draft: 'اعرض ملخص اليوم ورتب أولوياتي' },
    context.recentExpenses.length > 0
      ? { icon: 'bar-chart-2', label: 'راجع مصروفاتي', labelEn: 'Review spending', draft: 'اعرض مصروفاتي الأخيرة' }
      : { icon: 'bell', label: 'ما الذي يستحق انتباهي؟', labelEn: 'What needs my attention?', draft: 'ما الذي يحتاج انتباهي اليوم؟' },
    context.pendingTasks.length > 0
      ? { icon: 'check-square', label: 'رتّب مهامي', labelEn: 'Organize tasks', draft: 'اعرض مهامي المفتوحة ورتبها' }
      : { icon: 'layers', label: 'لخّص سياقي', labelEn: 'Summarize my context', draft: 'لخص السجلات المرتبطة بي' },
    { icon: 'users', label: 'راجع علاقاتي', labelEn: 'Review relationships', draft: 'مين لسه عليه فلوس أو متابعة؟' },
  ];

  return (
    <View testID="main-office-home" style={styles.officeHome}>
      <LinearGradient
        pointerEvents="none"
        colors={[
          colorWithAlpha(colors.primary, 0.12),
          colorWithAlpha(colors.background, 0.82),
          colorWithAlpha(colors.muted, 0.9),
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.pearlBackground}
      />
      {false && <View testID="main-summary-cards" style={styles.officeSummaryGrid}>
        {summaryCards.map((card) => (
          <Pressable
            key={card.key}
            testID={`office-summary-${card.key}`}
            accessibilityRole="button"
            accessibilityLabel={localized(language, `فتح ${card.label}`, `Open ${card.labelEn}`)}
            onPress={() => {
              if (card.key === 'records') {
                onOpenRecords();
              } else if (card.key === 'tasks') {
                const task = context.pendingTasks[0];
                if (task) openTask(task);
                else onAskSecretary('اعرض مهامي المفتوحة');
              } else if (card.key === 'appointments') {
                const reminder = context.upcomingReminders[0];
                if (reminder) openReminder(reminder);
                else onAskSecretary('اعرض مواعيدي القادمة');
              } else if (card.key === 'accounts') {
                onOpenFinancial();
              }
            }}
            style={({ pressed }) => [
              styles.officeSummaryCard,
              { opacity: pressed ? 0.68 : 1 },
            ]}
          >
            <View style={styles.officeSummaryIcon}>
              <Feather name={card.icon} size={14} color={colors.primary} />
            </View>
            <Text style={[styles.officeSummaryValue, { color: colors.foreground }]} numberOfLines={1}>{card.value}</Text>
            <Text style={[styles.officeSummaryLabel, { color: colors.foreground }]}>
              {localized(language, card.label, card.labelEn)}
            </Text>
            <Text style={[styles.officeSummaryHint, { color: colors.mutedForeground }]}>
              {localized(language, card.hint, card.hintEn)}
            </Text>
          </Pressable>
        ))}
      </View>}

      <View style={styles.pearlDateStrip}>
        <View style={styles.pearlDateCopy}>
          <Text style={[styles.pearlDateTitle, { color: colors.foreground }]}>{pearlDateLabel}</Text>
          <Text style={[styles.pearlDateHint, { color: colors.mutedForeground }]}>
            {localized(language, 'نواصل من آخر ما قيل، لا من شاشة جديدة', 'Continue from where you left off')}
          </Text>
        </View>
        <View style={[styles.pearlLivePill, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <View style={[styles.pearlLiveDot, { backgroundColor: todayQuery.isFetching ? colors.primary : colors.accent }]} />
          <Text style={[styles.pearlLiveText, { color: todayQuery.isFetching ? colors.primary : colors.accent }]}>
            {todayQuery.isFetching
              ? localized(language, 'يحدّث السياق', 'Updating context')
              : localized(language, 'السياق حي', 'Context live')}
          </Text>
        </View>
      </View>

      <CentralSecretaryChat
        colors={colors}
        messages={messages}
        draft={draft}
        onChangeDraft={onChangeDraft}
        onSend={onSend}
        onQuickPrompt={onAskSecretary}
        quickPrompts={quickActions.slice(0, 3).map((action) => ({
          label: localized(language, action.label, action.labelEn),
          value: action.draft,
        }))}
        onFocusChat={focusAndExpandChat}
         expanded
        isSending={isSending}
        onApprove={onApprove}
        onReject={onReject}
        busyOperationId={busyOperationId}
        onOpenRecord={onOpenRecord}
        onRetryInput={onRetryInput}
        retryingInput={retryingInput}
        context={chatContext}
        smartSignal={smartSignal}
        inputState={inputState}
        onToggleVoice={onToggleVoice}
        onCaptureReceipt={onCaptureReceipt}
        onPickReceipt={onPickReceipt}
        inputReview={inputReview}
        onChangeInputReview={onChangeInputReview}
        onClearInputReview={onClearInputReview}
        onOpenPearlSheet={openPearlSheet}
        sheetLift={pearlComposerLift}
      />

      <View
        testID="pearl-record-sheet"
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          if (height === pearlSheetHeight.current) return;
          pearlSheetHeight.current = height;
          setPearlSheetOffset(height * (pearlSheetPositionRef.current / 100));
        }}
        style={[
          styles.pearlSheet,
          {
            backgroundColor: 'transparent',
            borderColor: colors.border,
            shadowColor: colors.foreground,
            transform: [{ translateY: pearlSheetOffset }],
          },
        ]}
      >
        <LinearGradient
          pointerEvents="none"
          colors={[colors.card, colors.background, colors.muted]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.pearlSheetSurface}
        />
        <Pressable
          testID="pearl-sheet-handle"
          accessibilityRole="button"
          accessibilityLabel={pearlSheetOpen ? localized(language, 'تصغير السجلات والسياق', 'Collapse records and context') : localized(language, 'فتح السجلات والسياق', 'Open records and context')}
          onPress={() => {
            if (pearlSheetWasDragged.current) {
              pearlSheetWasDragged.current = false;
              return;
            }
            animatePearlSheetTo(pearlSheetOpen ? 80 : 43);
          }}
          {...pearlSheetPanResponder.panHandlers}
          style={styles.pearlSheetHandleZone}
        >
          <View style={[styles.pearlSheetHandle, { backgroundColor: colors.mutedForeground }]} />
        </Pressable>
        <ScrollView
          testID="pearl-sheet-scroll"
          style={styles.pearlSheetScroll}
          contentContainerStyle={styles.pearlSheetScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          <View style={styles.pearlSheetHeading}>
            <View style={styles.pearlSheetHeadingCopy}>
              <Text style={[styles.pearlSheetTitle, { color: colors.foreground }]}>
                {localized(language, 'السجلات والسياق', 'Records & context')}
              </Text>
              <Text style={[styles.pearlSheetHint, { color: colors.mutedForeground }]}>
                {localized(language, 'اربط ما قيل بما حُفظ', 'Connect what was said to what was saved')}
              </Text>
            </View>
            <Text style={[styles.pearlSheetCount, { color: colors.mutedForeground, backgroundColor: colors.muted }]}>
              {contextualRecordCount} {localized(language, 'عناصر', 'items')}
            </Text>
          </View>
          <View style={styles.pearlSheetTabs}>
            {(['records', 'context'] as const).map((tab) => (
              <Pressable
                key={tab}
                testID={`pearl-sheet-tab-${tab}`}
                accessibilityRole="button"
                accessibilityState={{ selected: pearlSheetTab === tab }}
                onPress={() => setPearlSheetTab(tab)}
                style={[
                  styles.pearlSheetTab,
                  pearlSheetTab === tab && { backgroundColor: colors.muted },
                ]}
              >
                <Text style={[styles.pearlSheetTabText, { color: pearlSheetTab === tab ? colors.foreground : colors.mutedForeground }]}>
                  {tab === 'records' ? localized(language, 'السجلات', 'Records') : localized(language, 'الصورة الأكبر', 'Bigger picture')}
                </Text>
              </Pressable>
            ))}
          </View>
          {pearlSheetTab === 'records' ? (
            <View style={styles.pearlSheetRecordList}>
              {pearlSheetRecords.length > 0 ? pearlSheetRecords.map((item) => (
                <Pressable
                  key={item.id}
                  testID={`pearl-sheet-record-${item.record.recordType}-${item.record.id}`}
                  accessibilityRole="button"
                  onPress={() => {
                    animatePearlSheetTo(80);
                    onOpenRecord(item.record);
                  }}
                  style={({ pressed }) => [
                    styles.pearlSheetRecord,
                    { backgroundColor: colors.muted, borderColor: colors.border, opacity: pressed ? 0.68 : 1 },
                  ]}
                >
                  <View style={[styles.pearlSheetRecordIcon, { backgroundColor: colors.card }]}>
                    <Feather name={item.icon} size={14} color={colors.primary} />
                  </View>
                  <View style={styles.pearlSheetRecordCopy}>
                    <Text style={[styles.pearlSheetRecordTitle, { color: colors.foreground }]} numberOfLines={1}>{item.record.title}</Text>
                    <Text style={[styles.pearlSheetRecordMeta, { color: colors.mutedForeground }]} numberOfLines={1}>{item.meta} · {item.record.subtitle}</Text>
                  </View>
                  <Text style={[styles.pearlSheetRecordTrailing, { color: colors.mutedForeground }]} numberOfLines={1}>{item.record.trailing ?? ''}</Text>
                  <Feather name="chevron-left" size={14} color={colors.mutedForeground} />
                </Pressable>
              )) : (
                <Text style={[styles.pearlSheetEmpty, { color: colors.mutedForeground }]}>
                  {localized(language, 'ستظهر السجلات المرتبطة هنا بعد أول تحديث.', 'Linked records will appear here after the first update.')}
                </Text>
              )}
            </View>
          ) : (
            <View>
              <View style={[styles.pearlSheetContext, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <View style={[styles.pearlSheetContextIcon, { backgroundColor: colors.card }]}>
                  <Feather name="shield" size={15} color={colors.primary} />
                </View>
                <Text style={[styles.pearlSheetContextTitle, { color: colors.foreground }]}>
                  {localized(language, 'خريطة اليوم كما فهمها السكرتير', 'Today’s context map')}
                </Text>
                <Text style={[styles.pearlSheetContextText, { color: colors.mutedForeground }]}>
                  {localized(language, `${contextualRecordCount} عناصر مرتبطة بالمحادثة الحالية.`, `${contextualRecordCount} items are linked to the current conversation.`)}
                </Text>
              </View>
              {(context.relevantPeople.length > 0 || context.activeProjects.length > 0) && (
                <View style={styles.pearlSheetRecordList}>
                  {context.relevantPeople.slice(0, 5).map((person) => (
                    <Pressable
                      key={`pearl-person-${person.id}`}
                      testID={`pearl-sheet-person-${person.id}`}
                      accessibilityRole="button"
                      onPress={() => onOpenRecord({ id: person.id, recordType: 'person', title: person.name, subtitle: 'فتح مركز الشخص' })}
                      style={({ pressed }) => [
                        styles.pearlSheetRecord,
                        { backgroundColor: colors.muted, borderColor: colors.border, opacity: pressed ? 0.68 : 1 },
                      ]}
                    >
                      <View style={[styles.pearlSheetRecordIcon, { backgroundColor: colors.card }]}>
                        <Feather name="user" size={14} color={colors.primary} />
                      </View>
                      <View style={styles.pearlSheetRecordCopy}>
                        <Text style={[styles.pearlSheetRecordTitle, { color: colors.foreground }]} numberOfLines={1}>{person.name}</Text>
                        <Text style={[styles.pearlSheetRecordMeta, { color: colors.mutedForeground }]} numberOfLines={1}>مركز الشخص</Text>
                      </View>
                      <Feather name="chevron-left" size={14} color={colors.mutedForeground} />
                    </Pressable>
                  ))}
                  {context.activeProjects.slice(0, 5).map((project) => (
                    <Pressable
                      key={`pearl-project-${project.id}`}
                      testID={`pearl-sheet-project-${project.id}`}
                      accessibilityRole="button"
                      onPress={() => onOpenRecord({ id: project.id, recordType: 'project', title: project.name, subtitle: 'فتح مركز المشروع' })}
                      style={({ pressed }) => [
                        styles.pearlSheetRecord,
                        { backgroundColor: colors.muted, borderColor: colors.border, opacity: pressed ? 0.68 : 1 },
                      ]}
                    >
                      <View style={[styles.pearlSheetRecordIcon, { backgroundColor: colors.card }]}>
                        <Feather name="briefcase" size={14} color={colors.primary} />
                      </View>
                      <View style={styles.pearlSheetRecordCopy}>
                        <Text style={[styles.pearlSheetRecordTitle, { color: colors.foreground }]} numberOfLines={1}>{project.name}</Text>
                        <Text style={[styles.pearlSheetRecordMeta, { color: colors.mutedForeground }]} numberOfLines={1}>مركز المشروع</Text>
                      </View>
                      <Feather name="chevron-left" size={14} color={colors.mutedForeground} />
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </View>

      {false && !todayQuery.isLoading && !todayQuery.isError && contextData && (
        <>
          <View style={styles.officeDashboardSplit}>
            <View style={[styles.officeDashboardCard, styles.officeTodayCard]}>
              <View style={styles.officeSectionHeading}>
                <View>
                  <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>
                    {localized(language, 'اليوم', 'Today')}
                  </Text>
                  <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>
                    {localized(language, 'القادم في موجزك', 'Upcoming items')}
                  </Text>
                </View>
              </View>
              <View style={styles.officeTodayList}>
                {context.upcomingReminders.slice(0, 3).map((reminder) => (
                  <Pressable key={`today-${reminder.id}`} onPress={() => openReminder(reminder)} style={styles.officeTodayRow}>
                    <View style={[styles.officeTodayMarker, { backgroundColor: colors.primary }]} />
                    <Text style={[styles.officeTodayTime, { color: colors.primary }]} numberOfLines={1}>{recordDate(reminder.dueAt)}</Text>
                    <Text style={[styles.officeTodayText, { color: colors.foreground }]} numberOfLines={1}>{reminder.text}</Text>
                  </Pressable>
                ))}
                {context.pendingTasks.slice(0, 3).map((task) => (
                  <Pressable key={`today-task-${task.id}`} onPress={() => openTask(task)} style={styles.officeTodayRow}>
                    <View style={[styles.officeTodayMarker, { backgroundColor: colors.accent }]} />
                    <Text style={[styles.officeTodayTime, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {task.dueAt ? recordDate(task.dueAt) : localized(language, 'مفتوحة', 'Open')}
                    </Text>
                    <Text style={[styles.officeTodayText, { color: colors.foreground }]} numberOfLines={1}>{task.title}</Text>
                  </Pressable>
                ))}
                {context.upcomingReminders.length === 0 && context.pendingTasks.length === 0 && (
                  <Text style={[styles.officeEmptyLine, { color: colors.mutedForeground }]}>
                    {localized(language, 'لا يوجد شيء مجدول الآن.', 'Nothing scheduled right now.')}
                  </Text>
                )}
              </View>
            </View>

            <View style={[styles.officeDashboardCard, styles.officeQuickCard]}>
              <View style={styles.officeSectionHeading}>
                <View>
                  <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>
                    {localized(language, 'إجراءات سريعة', 'Quick Actions')}
                  </Text>
                  <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>
                    {localized(language, 'ابدأ من المحادثة', 'Start from chat')}
                  </Text>
                </View>
              </View>
              <View style={styles.officeQuickActions}>
                {quickActions.map((action) => (
                  <Pressable
                    key={action.draft}
                    testID={`office-quick-action-${action.icon}`}
                    accessibilityRole="button"
                    onPress={() => onAskSecretary(action.draft)}
                    style={({ pressed }) => [
                      styles.officeQuickAction,
                      { opacity: pressed ? 0.62 : 1 },
                    ]}
                  >
                    <View style={[styles.officeQuickActionIcon, { backgroundColor: colors.muted }]}>
                      <Feather name={action.icon} size={13} color={colors.primary} />
                    </View>
                    <Text style={[styles.officeQuickActionText, { color: colors.foreground }]} numberOfLines={1}>
                      {localized(language, action.label, action.labelEn)}
                    </Text>
                    <Feather name="chevron-left" size={13} color={colors.mutedForeground} />
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

        </>
      )}

      {false && <View testID="recent-activity" style={styles.officeSection}>
        <View style={styles.officeSectionHeading}>
          <View>
            <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>
              {localized(language, 'آخر النشاط', 'Recent activity')}
            </Text>
          </View>
          <View style={styles.officeRecentHeadingActions}>
            <Pressable
              testID="recent-activity-search"
              accessibilityRole="button"
              accessibilityLabel={localized(language, recentSearchOpen ? 'إغلاق البحث' : 'فتح البحث', recentSearchOpen ? 'Close search' : 'Open search')}
              onPress={() => {
                setRecentSearchOpen((open) => !open);
                setTimeout(() => recentSearchRef.current?.focus(), 0);
              }}
              style={({ pressed }) => [
                styles.officeRecentSearchButton,
                { borderColor: colors.border, opacity: pressed ? 0.62 : 1 },
              ]}
            >
              <Feather name={recentSearchOpen ? 'x' : 'search'} size={14} color={colors.foreground} />
            </Pressable>
            <Pressable
              testID="recent-activity-view-all"
              accessibilityRole="button"
              accessibilityLabel={localized(language, 'عرض كل السجلات', 'View all records')}
              onPress={onOpenRecords}
              style={({ pressed }) => ({ opacity: pressed ? 0.62 : 1 })}
            >
              <Text style={[styles.officeRecentViewAll, { color: colors.primary }]}>
                {localized(language, 'عرض الكل', 'View all')}
              </Text>
            </Pressable>
          </View>
        </View>
        {recentSearchOpen && (
          <View style={[styles.officeSearchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput
              ref={recentSearchRef}
              testID="recent-conversations-search"
              value={conversationSearch}
              onChangeText={onChangeConversationSearch}
              placeholder={localized(language, 'ابحث في أي كلمة داخل المحادثة…', 'Search any word in a conversation…')}
              placeholderTextColor={colors.mutedForeground}
              returnKeyType="search"
              clearButtonMode="while-editing"
              style={[styles.officeSearchInput, { color: colors.foreground }]}
            />
            {conversationsLoading && <ActivityIndicator size="small" color={colors.primary} />}
          </View>
        )}
        <View
          testID="recent-activity-list"
          style={styles.officeRecentActivityScroll}
        >
          {recentConversations.slice(0, 1).map((conversation) => (
              <Pressable
                key={conversation.conversationId}
                testID={`recent-conversation-${conversation.conversationId}`}
                accessibilityRole="button"
                accessibilityLabel={`${localized(language, 'فتح المحادثة', 'Open conversation')} ${conversation.title}`}
                onPress={() => onOpenConversation(conversation.conversationId)}
                style={({ pressed }) => [
                  styles.officeRecentActivityRow,
                  { opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <View style={[styles.officeRecentActivityIcon, { backgroundColor: colors.muted }]}>
                  <Feather name="message-circle" size={15} color={colors.primary} />
                </View>
                <View style={styles.officeRecentActivityCopy}>
                  <Text style={[styles.officeRecentActivityTitle, { color: colors.foreground }]} numberOfLines={1}>
                    {conversation.title}
                  </Text>
                  <Text style={[styles.officeRecentActivityPreview, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {conversation.preview}
                  </Text>
                  <Text style={[styles.officeRecentActivityMeta, { color: colors.primary }]}>
                    {localized(language, 'محادثة', 'Conversation')} · {conversation.turnCount} {localized(language, 'رسائل', 'turns')}
                  </Text>
                </View>
                <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
              </Pressable>
            ))}
          {filteredLatestEdits.slice(0, 2).map((edit) => (
              <Pressable
                key={edit.id}
                testID={`recent-edit-${edit.record.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${localized(language, 'فتح', 'Open')} ${edit.record.title}`}
                onPress={() => onOpenRecord(edit.record)}
                style={({ pressed }) => [
                  styles.officeRecentActivityRow,
                  { opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <View style={[styles.officeRecentActivityIcon, { backgroundColor: colors.muted }]}>
                  <Feather name={edit.icon} size={15} color={colors.primary} />
                </View>
                <View style={styles.officeRecentActivityCopy}>
                  <Text style={[styles.officeRecentActivityTitle, { color: colors.foreground }]} numberOfLines={1}>
                    {edit.record.title}
                  </Text>
                  <Text style={[styles.officeRecentActivityPreview, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {edit.meta} · {edit.record.subtitle}
                  </Text>
                </View>
                <Text style={[styles.officeRecentActivityMeta, { color: colors.primary }]} numberOfLines={1}>
                  {localized(language, 'تعديل', 'Update')}
                  {edit.record.trailing ? ` · ${edit.record.trailing}` : ''}
                </Text>
                <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
              </Pressable>
            ))}
          {!hasRecentActivity && (
            <View style={[styles.officeEmptyPanel, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Text style={[styles.officeEmptyLine, { color: colors.mutedForeground }]}>
                {conversationSearch.trim()
                  ? localized(language, 'لا توجد نتائج مطابقة.', 'No matching results.')
                  : localized(language, 'لا توجد محادثات أو تعديلات بعد.', 'No conversations or updates yet.')}
              </Text>
            </View>
          )}
        </View>
      </View>}

      {todayQuery.isError && (
        <View style={[styles.officeError, { backgroundColor: colors.destructive, borderColor: colors.destructive }]}>
          <Text style={[styles.officeErrorText, { color: colors.destructiveForeground }]}>
            تعذر تحميل موجز اليوم.
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void todayQuery.refetch()}>
            <Text style={[styles.recordsRetry, { color: colors.destructiveForeground }]}>حاول</Text>
          </Pressable>
        </View>
      )}

      {todayQuery.isLoading && (
        <View style={styles.officeLoading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.recordsLoadingText, { color: colors.mutedForeground }]}>السكرتير يجهز الموجز…</Text>
        </View>
      )}

      {context && !todayQuery.isLoading && !todayQuery.isError && false && (
        <>
          <View style={[styles.officePulse, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.officePulseItem}>
              <Text style={[styles.officePulseValue, { color: colors.primary }]}>{context.pendingTasks.length}</Text>
              <Text style={[styles.officePulseLabel, { color: colors.mutedForeground }]}>مهام مفتوحة</Text>
            </View>
            <View style={[styles.officePulseDivider, { backgroundColor: colors.border }]} />
            <View style={styles.officePulseItem}>
              <Text style={[styles.officePulseValue, { color: colors.primary }]}>{context.upcomingReminders.length}</Text>
              <Text style={[styles.officePulseLabel, { color: colors.mutedForeground }]}>تذكيرات قادمة</Text>
            </View>
            <View style={[styles.officePulseDivider, { backgroundColor: colors.border }]} />
            <View style={styles.officePulseItem}>
              <Text style={[styles.officePulseValue, { color: colors.primary }]}>{context.activeProjects.length}</Text>
              <Text style={[styles.officePulseLabel, { color: colors.mutedForeground }]}>مشاريع نشطة</Text>
            </View>
          </View>

          <View style={styles.officeSection}>
            <View style={styles.officeSectionHeading}>
              <View>
                <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>
                  {localized(language, 'يحتاج انتباهك', 'Needs your attention')}
                </Text>
                <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>
                  {attentionCount > 0
                    ? `${attentionCount} ${localized(language, 'أشياء تستحق نظرة', 'items worth a look')}`
                    : localized(language, 'كل شيء هادئ الآن', 'Everything is calm right now')}
                </Text>
              </View>
              <Feather name={attentionCount > 0 ? 'bell' : 'check-circle'} size={18} color={attentionCount > 0 ? colors.primary : colors.accent} />
            </View>
            {attentionCount === 0 ? (
              <View style={[styles.officeCalm, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Text style={[styles.officeCalmText, { color: colors.mutedForeground }]}>
                  {localized(language, 'لا توجد مهام عاجلة أو موافقات معلّقة.', 'No urgent tasks or pending approvals.')}
                </Text>
              </View>
            ) : (
              <View style={styles.officeActionList}>
                {pendingApprovals.slice(0, 2).map((approval) => (
                  <Pressable
                    key={approval.operationId}
                    testID={`office-approval-${approval.operationId}`}
                    accessibilityRole="button"
                     onPress={() => onFocusChat()}
                    style={({ pressed }) => [
                      styles.officeActionRow,
                      { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                    ]}
                  >
                    <View style={[styles.officeActionIcon, { backgroundColor: colors.destructive }]}>
                      <Feather name="check-circle" size={15} color={colors.destructiveForeground} />
                    </View>
                    <View style={styles.officeActionCopy}>
                      <Text style={[styles.officeActionTitle, { color: colors.foreground }]} numberOfLines={1}>{approval.title}</Text>
                      <Text style={[styles.officeActionMeta, { color: colors.mutedForeground }]}>موافقة مطلوبة · افتح السكرتير</Text>
                    </View>
                    <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
                  </Pressable>
                ))}
                {context.upcomingReminders.slice(0, 2).map((reminder) => (
                  <Pressable
                    key={`reminder-${reminder.id}`}
                    testID={`office-reminder-${reminder.id}`}
                    accessibilityRole="button"
                    onPress={() => openReminder(reminder)}
                    style={({ pressed }) => [
                      styles.officeActionRow,
                      { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                    ]}
                  >
                    <View style={[styles.officeActionIcon, { backgroundColor: colors.muted }]}>
                      <Feather name="clock" size={15} color={colors.primary} />
                    </View>
                    <View style={styles.officeActionCopy}>
                      <Text style={[styles.officeActionTitle, { color: colors.foreground }]} numberOfLines={1}>{reminder.text}</Text>
                      <Text style={[styles.officeActionMeta, { color: colors.mutedForeground }]}>{recordDate(reminder.dueAt)}</Text>
                    </View>
                    <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
                  </Pressable>
                ))}
                {context.pendingTasks.slice(0, 2).map((task) => (
                  <Pressable
                    key={`task-${task.id}`}
                    testID={`office-task-${task.id}`}
                    accessibilityRole="button"
                    onPress={() => openTask(task)}
                    style={({ pressed }) => [
                      styles.officeActionRow,
                      { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                    ]}
                  >
                    <View style={[styles.officeActionIcon, { backgroundColor: colors.muted }]}>
                      <Feather name="check-square" size={15} color={colors.primary} />
                    </View>
                    <View style={styles.officeActionCopy}>
                      <Text style={[styles.officeActionTitle, { color: colors.foreground }]} numberOfLines={1}>{task.title}</Text>
                      <Text style={[styles.officeActionMeta, { color: colors.mutedForeground }]}>{task.dueAt ? recordDate(task.dueAt) : 'مهمة مستمرة'}</Text>
                    </View>
                    <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={styles.officeSection}>
            <View style={styles.officeSectionHeading}>
              <View>
                <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>
                  {localized(language, 'اليوم', 'Today')}
                </Text>
                <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>
                  {localized(language, 'ما يعرفه السكرتير عن يومك الآن', 'What the secretary knows about your day')}
                </Text>
              </View>
              <Feather name="sun" size={18} color={colors.primary} />
            </View>
            <View style={styles.officeTodayList}>
              {context.upcomingReminders.slice(0, 3).map((reminder) => (
                <Pressable key={`today-${reminder.id}`} onPress={() => openReminder(reminder)} style={styles.officeTodayRow}>
                  <Text style={[styles.officeTodayTime, { color: colors.primary }]}>{recordDate(reminder.dueAt)}</Text>
                  <Text style={[styles.officeTodayText, { color: colors.foreground }]} numberOfLines={1}>{reminder.text}</Text>
                </Pressable>
              ))}
              {context.pendingTasks.slice(0, 3).map((task) => (
                <Pressable key={`today-task-${task.id}`} onPress={() => openTask(task)} style={styles.officeTodayRow}>
                  <Text style={[styles.officeTodayTime, { color: colors.mutedForeground }]}>{task.dueAt ? recordDate(task.dueAt) : 'مفتوحة'}</Text>
                  <Text style={[styles.officeTodayText, { color: colors.foreground }]} numberOfLines={1}>{task.title}</Text>
                </Pressable>
              ))}
              {context.upcomingReminders.length === 0 && context.pendingTasks.length === 0 && (
                <Text style={[styles.officeEmptyLine, { color: colors.mutedForeground }]}>لا يوجد شيء مجدول في الموجز الحالي.</Text>
              )}
            </View>
          </View>

          <View style={styles.officeSection}>
            <View style={styles.officeSectionHeading}>
              <View>
                <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>
                  {localized(language, 'النبض المالي', 'Financial pulse')}
                </Text>
                <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>
                  {recentTotal
                    ? `${recentTotal} ${localized(language, 'في أحدث المصروفات', 'in recent expenses')}`
                    : localized(language, 'لا توجد حركة مالية حديثة', 'No recent financial activity')}
                </Text>
              </View>
              <Feather name="dollar-sign" size={18} color={colors.primary} />
            </View>
            <View style={[styles.officeFinancialRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.officeFinancialCopy}>
                <Text style={[styles.officeFinancialTitle, { color: colors.foreground }]}>
                  {localized(language, 'آخر المصروفات', 'Recent expenses')}
                </Text>
                <Text style={[styles.officeFinancialMeta, { color: colors.mutedForeground }]}>
                  {context.recentExpenses.length} {localized(language, 'سجلات محدودة', 'limited records')}
                </Text>
              </View>
              <Pressable
                testID="office-financial-toggle"
                accessibilityRole="button"
                onPress={() => setFinancialExpanded((expanded) => !expanded)}
                style={({ pressed }) => [
                  styles.officeInlineAction,
                  { borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <Text style={[styles.officeInlineActionText, { color: colors.foreground }]}>
                  {financialExpanded
                    ? localized(language, 'إخفاء التفاصيل', 'Hide details')
                    : localized(language, 'عرض الالتزامات', 'Show commitments')}
                </Text>
                <Feather name={financialExpanded ? 'chevron-up' : 'chevron-left'} size={14} color={colors.foreground} />
              </Pressable>
            </View>
            {financialExpanded && (
              <View style={[styles.officeExpandedPanel, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                {recordsQuery.isLoading ? (
                  <ActivityIndicator color={colors.primary} />
                ) : recordsQuery.isError ? (
                  <Text style={[styles.officeEmptyLine, { color: colors.mutedForeground }]}>تعذر تحميل التفاصيل المالية.</Text>
                ) : (
                  <>
                    <Text style={[styles.officeExpandedTitle, { color: colors.foreground }]}>
                      {commitmentSection?.data.length ?? 0} {localized(language, 'التزامات محفوظة', 'saved commitments')}
                    </Text>
                    {(commitmentSection?.data ?? []).slice(0, 3).map((commitment) => (
                      <Pressable key={commitment.id} onPress={() => onOpenRecord(commitment)} style={styles.officeTodayRow}>
                        <Text style={[styles.officeTodayTime, { color: colors.mutedForeground }]}>{commitment.trailing ?? 'مفتوح'}</Text>
                        <Text style={[styles.officeTodayText, { color: colors.foreground }]} numberOfLines={1}>{commitment.title}</Text>
                      </Pressable>
                    ))}
                    <Pressable testID="office-open-all-records-financial" onPress={onOpenRecords}>
                      <Text style={[styles.officeMoreLink, { color: colors.primary }]}>
                        {localized(language, 'استكشف كل السجلات المالية', 'Explore all financial records')}
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}
          </View>

          <View style={styles.officeSection}>
            <View style={styles.officeSectionHeading}>
              <View>
                <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>
                  {localized(language, 'النشاط الأخير', 'Latest activity')}
                </Text>
                <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>
                  {localized(language, 'مصروفات حديثة يمكنك فتح تفاصيلها', 'Recent expenses you can open')}
                </Text>
              </View>
              <Feather name="activity" size={18} color={colors.primary} />
            </View>
            <View style={styles.officeActivityList}>
              {context.recentExpenses.slice(0, 4).map((expense) => (
                <Pressable
                  key={`expense-${expense.id}`}
                  testID={`office-expense-${expense.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`فتح تفاصيل ${expense.description}`}
                  onPress={() => onOpenRecord({
                    id: expense.id,
                    recordType: 'expense',
                    title: expense.description,
                    subtitle: [expense.personName ?? expense.projectName, recordDate(expense.occurredAt)].filter(Boolean).join(' · '),
                    trailing: money(expense.amountMinor, expense.currency),
                    origin: recordOrigins[expense.id] ?? null,
                  })}
                  style={({ pressed }) => [
                    styles.officeActivityRow,
                    { borderBottomColor: colors.border, opacity: pressed ? 0.65 : 1 },
                  ]}
                >
                  <Text style={[styles.officeActivityAmount, { color: colors.primary }]}>{money(expense.amountMinor, expense.currency)}</Text>
                  <View style={styles.officeActivityCopy}>
                    <Text style={[styles.officeActivityTitle, { color: colors.foreground }]} numberOfLines={1}>{expense.description}</Text>
                    <Text style={[styles.officeActivityMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {expense.personName ?? expense.projectName ?? recordDate(expense.occurredAt)}
                    </Text>
                  </View>
                  <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
                </Pressable>
              ))}
              {context.recentExpenses.length === 0 && (
                <Text style={[styles.officeEmptyLine, { color: colors.mutedForeground }]}>لا توجد مصروفات حديثة في الموجز الحالي.</Text>
              )}
            </View>
          </View>

          <View style={styles.officeSection}>
            <View style={styles.officeSectionHeading}>
              <View>
                <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>السياق النشط</Text>
                <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>أشخاص ومشاريع في الصورة الآن</Text>
              </View>
              <Feather name="layers" size={18} color={colors.primary} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.officeEntityRail}>
              {context.relevantPeople.slice(0, 5).map((person) => (
                <Pressable
                  key={`person-${person.id}`}
                  testID={`office-person-${person.id}`}
                  onPress={() => onOpenRecord({ id: person.id, recordType: 'person', title: person.name, subtitle: 'فتح مركز الشخص' })}
                  style={({ pressed }) => [
                    styles.officeEntityTile,
                    { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                  ]}
                >
                  <View style={[styles.officeEntityIcon, { backgroundColor: colors.muted }]}>
                    <Feather name="user" size={15} color={colors.primary} />
                  </View>
                  <Text style={[styles.officeEntityName, { color: colors.foreground }]} numberOfLines={1}>{person.name}</Text>
                  <Text style={[styles.officeEntityMeta, { color: colors.mutedForeground }]}>مركز الشخص</Text>
                </Pressable>
              ))}
              {context.activeProjects.slice(0, 5).map((project) => (
                <Pressable
                  key={`project-${project.id}`}
                  testID={`office-project-${project.id}`}
                  onPress={() => onOpenRecord({ id: project.id, recordType: 'project', title: project.name, subtitle: 'فتح مركز المشروع' })}
                  style={({ pressed }) => [
                    styles.officeEntityTile,
                    { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                  ]}
                >
                  <View style={[styles.officeEntityIcon, { backgroundColor: colors.muted }]}>
                    <Feather name="briefcase" size={15} color={colors.primary} />
                  </View>
                  <Text style={[styles.officeEntityName, { color: colors.foreground }]} numberOfLines={1}>{project.name}</Text>
                  <Text style={[styles.officeEntityMeta, { color: colors.mutedForeground }]}>مركز المشروع</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <View style={styles.officeSection}>
            <View style={styles.officeSectionHeading}>
              <View>
                <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>ماذا يمكن أن يفعل السكرتير؟</Text>
                <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>ابدأ من فضولك، وليس من قائمة إعدادات</Text>
              </View>
              <Feather name="compass" size={18} color={colors.primary} />
            </View>
            <View style={styles.officeSuggestions}>
              {[
                ['اسأل عن آخر مصروف مرتبط بشخص', 'محمد أخد مني كام؟'],
                ['راجع ما يستحق انتباهك اليوم', 'إيه اللي عليا النهارده؟'],
                ['سجّل شيء جديد بسرعة', 'دفعت لمحمد 5000'],
              ].map(([label, draft]) => (
                <Pressable
                  key={draft}
                  testID={`office-suggestion-${draft}`}
                  onPress={() => onAskSecretary(draft)}
                  style={({ pressed }) => [
                    styles.officeSuggestionRow,
                    { borderBottomColor: colors.border, opacity: pressed ? 0.65 : 1 },
                  ]}
                >
                  <Feather name="arrow-up-left" size={15} color={colors.primary} />
                  <View style={styles.officeSuggestionCopy}>
                    <Text style={[styles.officeSuggestionLabel, { color: colors.foreground }]}>{label}</Text>
                    <Text style={[styles.officeSuggestionDraft, { color: colors.mutedForeground }]}>{draft}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>

          <Pressable
            testID="open-all-records"
            accessibilityRole="button"
            onPress={onOpenRecords}
            style={({ pressed }) => [
              styles.officeExploreButton,
              { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="archive" size={16} color={colors.primaryForeground} />
            <Text style={[styles.officeExploreText, { color: colors.primaryForeground }]}>استكشف كل معلوماتك</Text>
            <Feather name="arrow-left" size={16} color={colors.primaryForeground} />
          </Pressable>
        </>
      )}
    </View>
  );
}

const editStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: {
    padding: 20,
    paddingBottom: 34,
    gap: 14,
  },
  heading: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headingCopy: {
    alignItems: 'flex-end',
    gap: 3,
  },
  eyebrow: {
    fontSize: 11,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 12,
    textAlign: 'right',
  },
  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  multiline: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  chips: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  error: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  actions: {
    gap: 10,
    marginTop: 5,
  },
  primaryAction: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryAction: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontSize: 13,
    fontWeight: '700',
  },
});

const detailStyles = StyleSheet.create({
  detailScreen: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  detailContent: {
    paddingBottom: 24,
  },
  detailHeader: {
    minHeight: 42,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailEyebrow: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  detailCard: {
    marginTop: 14,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    alignItems: 'flex-end',
  },
  detailIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailTitle: {
    width: '100%',
    marginTop: 16,
    fontSize: 21,
    fontWeight: '700',
    lineHeight: 29,
    textAlign: 'right',
  },
  detailSubtitle: {
    width: '100%',
    marginTop: 7,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'right',
  },
  detailMeta: {
    width: '100%',
    marginTop: 8,
    fontSize: 12,
    textAlign: 'right',
  },
  detailValue: {
    marginTop: 14,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
  },
  fieldsCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 3,
  },
  fieldRow: {
    minHeight: 43,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  fieldLabel: {
    flexShrink: 0,
    fontSize: 11,
    textAlign: 'right',
  },
  fieldValue: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'left',
  },
  detailState: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  detailStateText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  detailRetry: {
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  relatedCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 13,
  },
  relatedTitle: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  relatedHint: {
    marginTop: 4,
    marginBottom: 5,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'right',
  },
  relatedRow: {
    minHeight: 42,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  relatedRowCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  relatedLabel: {
    fontSize: 12,
    textAlign: 'right',
  },
  relatedSubtext: {
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
  },
  relatedCount: {
    fontSize: 13,
    fontWeight: '700',
  },
  timelineCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 13,
  },
  timelineHeading: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timelineRow: {
    minHeight: 48,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 8,
  },
  timelineDot: {
    width: 7,
    height: 7,
    marginTop: 5,
    borderRadius: 4,
  },
  timelineCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  timelineTitle: {
    width: '100%',
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'right',
  },
  timelineMeta: {
    width: '100%',
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
  },
  detailContext: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 9,
  },
  detailContextCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  detailContextTitle: {
    width: '100%',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  detailContextText: {
    width: '100%',
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  detailPrimaryAction: {
    minHeight: 48,
    marginTop: 18,
    borderRadius: 15,
    paddingHorizontal: 16,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  detailPrimaryActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  detailSecondaryAction: {
    minHeight: 44,
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  detailSecondaryActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
});

function approvalForRequest(request: ApprovalRequest): Approval {
  return {
    operationId: request.operationId,
    title: request.display.title,
    details: request.display.details,
    status: request.status as ApprovalStatus,
    toolName: request.toolName,
  };
}

function MobileEditSheet({
  record,
  kind,
  colors,
  people,
  projects,
  isSaving,
  error,
  onClose,
  onSave,
}: {
  record: EditableRecord;
  kind: RecordType;
  colors: ReturnType<typeof useColors>;
  people: PersonRecord[];
  projects: ProjectRecord[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (form: EditFormValues) => void;
}) {
  const [form, setForm] = useState<EditFormValues>(() => editFormForRecord(record, kind));
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const label = kind === 'expense' ? 'مصروف' : kind === 'person' ? 'شخص' : kind === 'project' ? 'مشروع' : kind === 'task' ? 'مهمة' : kind === 'reminder' ? 'تذكير' : 'التزام';
  const statuses = kind === 'project' ? ['active', 'archived'] : kind === 'task' ? ['pending', 'in_progress', 'completed', 'cancelled'] : kind === 'reminder' ? ['scheduled', 'completed', 'cancelled'] : ['open', 'completed', 'cancelled'];
  const field = (key: string, labelText: string, keyboardType?: 'default' | 'numeric' | 'phone-pad', multiline = false) => (
    <View style={editStyles.field} key={key}>
      <Text style={[editStyles.fieldLabel, { color: colors.mutedForeground }]}>{labelText}</Text>
      <TextInput
        testID={`record-edit-${key}`}
        value={form[key] ?? ''}
        onChangeText={(value) => update(key, value)}
        keyboardType={keyboardType}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        textAlign="right"
        placeholderTextColor={colors.mutedForeground}
        style={[editStyles.input, { color: colors.foreground, backgroundColor: colors.input, borderColor: colors.border }, multiline && editStyles.multiline]}
      />
    </View>
  );
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={editStyles.backdrop}>
        <View style={[editStyles.sheet, { backgroundColor: colors.card }]}>
          <ScrollView contentContainerStyle={editStyles.content} keyboardShouldPersistTaps="handled">
            <View style={editStyles.heading}>
              <View style={editStyles.headingCopy}>
                <Text style={[editStyles.eyebrow, { color: colors.mutedForeground }]}>تعديل السجل</Text>
                <Text style={[editStyles.title, { color: colors.foreground }]}>تعديل {label}</Text>
              </View>
              <Pressable testID="record-edit-close" accessibilityRole="button" accessibilityLabel="إغلاق تعديل السجل" onPress={onClose}><Feather name="x" size={21} color={colors.foreground} /></Pressable>
            </View>
            {error && <Text style={[editStyles.error, { color: colors.destructive }]}>{error}</Text>}
            {kind === 'expense' && <>{field('amountMinor', 'المبلغ بالوحدات الصغرى', 'numeric')}{field('currency', 'العملة')}{field('description', 'الوصف')}{field('occurredAt', 'التاريخ (YYYY-MM-DDTHH:mm)')}</>}
            {(kind === 'person' || kind === 'project') && field('name', 'الاسم')}
            {kind === 'person' && <>{field('phone', 'رقم الهاتف', 'phone-pad')}{field('notes', 'ملاحظات', undefined, true)}</>}
            {kind === 'task' && field('title', 'عنوان المهمة')}
            {kind === 'commitment' && field('title', 'عنوان الالتزام')}
            {kind === 'reminder' && <>{field('text', 'نص التذكير')}{field('timezone', 'المنطقة الزمنية')}</>}
            {(kind === 'task' || kind === 'reminder' || kind === 'commitment') && field('dueAt', 'الموعد (YYYY-MM-DDTHH:mm)')}
            {(kind === 'project' || kind === 'task' || kind === 'reminder' || kind === 'commitment') && (
              <View style={editStyles.field}>
                <Text style={[editStyles.fieldLabel, { color: colors.mutedForeground }]}>الحالة</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={editStyles.chips}>
                  {statuses.map((status) => <Pressable key={status} testID={`record-edit-status-${status}`} onPress={() => update('status', status)} style={[editStyles.chip, { borderColor: colors.border, backgroundColor: form.status === status ? colors.primary : colors.background }]}><Text style={{ color: form.status === status ? colors.primaryForeground : colors.foreground }}>{status}</Text></Pressable>)}
                </ScrollView>
              </View>
            )}
            {kind === 'expense' && <><Text style={[editStyles.fieldLabel, { color: colors.mutedForeground }]}>الربط (اختياري)</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={editStyles.chips}><Pressable testID="record-edit-person-none" onPress={() => update('personId', '')} style={[editStyles.chip, { borderColor: colors.border, backgroundColor: !form.personId ? colors.primary : colors.background }]}><Text style={{ color: !form.personId ? colors.primaryForeground : colors.foreground }}>بدون شخص</Text></Pressable>{people.map((person) => <Pressable key={person.id} testID={`record-edit-person-${person.id}`} onPress={() => update('personId', person.id)} style={[editStyles.chip, { borderColor: colors.border, backgroundColor: form.personId === person.id ? colors.primary : colors.background }]}><Text style={{ color: form.personId === person.id ? colors.primaryForeground : colors.foreground }}>{person.name}</Text></Pressable>)}<Pressable testID="record-edit-project-none" onPress={() => update('projectId', '')} style={[editStyles.chip, { borderColor: colors.border, backgroundColor: !form.projectId ? colors.primary : colors.background }]}><Text style={{ color: !form.projectId ? colors.primaryForeground : colors.foreground }}>بدون مشروع</Text></Pressable>{projects.map((project) => <Pressable key={project.id} testID={`record-edit-project-${project.id}`} onPress={() => update('projectId', project.id)} style={[editStyles.chip, { borderColor: colors.border, backgroundColor: form.projectId === project.id ? colors.primary : colors.background }]}><Text style={{ color: form.projectId === project.id ? colors.primaryForeground : colors.foreground }}>{project.name}</Text></Pressable>)}</ScrollView></>}
            <View style={editStyles.actions}>
              <Pressable testID="record-edit-save" accessibilityRole="button" accessibilityLabel="حفظ تعديل السجل" disabled={isSaving} onPress={() => onSave(form)} style={[editStyles.primaryAction, { backgroundColor: colors.primary, opacity: isSaving ? 0.55 : 1 }]}><Text style={[editStyles.actionText, { color: colors.primaryForeground }]}>{isSaving ? 'جاري الحفظ…' : 'حفظ التعديل'}</Text></Pressable>
              <Pressable testID="record-edit-cancel" accessibilityRole="button" accessibilityLabel="إلغاء تعديل السجل" onPress={onClose} style={[editStyles.secondaryAction, { borderColor: colors.border }]}><Text style={[editStyles.actionText, { color: colors.foreground }]}>إلغاء</Text></Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function RecordDetailView({
  record,
  colors,
  language,
  onBack,
  onAskSecretary,
  onOpenConversation,
  onOpenRelatedRecord,
  chatMessages,
  chatDraft,
  onChangeChatDraft,
  onSendChat,
  chatBusy,
  onApprove,
  onReject,
  onPendingApproval,
  onRecordSaved,
  busyOperationId,
  chatContext,
}: {
  record: MobileRecordRow;
  colors: ReturnType<typeof useColors>;
  language: AppLanguage;
  onBack: () => void;
  onAskSecretary: () => void;
  onOpenConversation?: (origin: RecordOrigin) => void;
  onOpenRelatedRecord: (record: MobileRecordRow) => void;
  chatMessages: LocalMessage[];
  chatDraft: string;
  onChangeChatDraft: (value: string) => void;
  onSendChat: () => void;
  chatBusy: boolean;
  onApprove: (approval: Approval, args?: Record<string, unknown>) => void;
  onReject: (approval: Approval) => void;
  onPendingApproval: (approval: Approval) => void;
  onRecordSaved: () => void;
  busyOperationId: string | null;
  chatContext: MobileRecordRow | null;
}) {
  const queryClient = useQueryClient();
  const recordsQuery = useListRecords({ query: { queryKey: getListRecordsQueryKey(), staleTime: 20_000 } });
  const updateMutation = useUpdateRecord();
  const suppressionMutation = useCreateProactiveSuppression();
  const [editingRecord, setEditingRecord] = useState<EditableRecord | null>(null);
  const [editingError, setEditingError] = useState<string | null>(null);
  const [suppressionMessage, setSuppressionMessage] = useState<string | null>(null);
  const [suppressionError, setSuppressionError] = useState<string | null>(null);
  const [latestRecord, setLatestRecord] = useState<MobileRecordRow | null>(null);
  const editableKind = (record.recordType in editableRecordCollections) ? record.recordType as RecordType : null;
  const displayRecord = latestRecord ?? record;
  const detailRecord = editableKind ? findEditableRecord(recordsQuery.data, displayRecord) : null;
  const detailFields = detailFieldsForRecord(detailRecord, editableKind);
  const detailStatus = stringValue(objectValue(detailRecord).status, '');
  const canSuppressProactive = (record.recordType === 'task'
    && ['pending', 'in_progress'].includes(detailStatus))
    || (record.recordType === 'commitment'
      && ['open', 'active', 'in_progress', 'pending'].includes(detailStatus));
  const isEntity = record.recordType === 'person'
    || record.recordType === 'project'
    || record.recordType === 'financial_party';
  const entityType = record.recordType === 'project'
    ? 'project'
    : record.recordType === 'financial_party'
      ? 'financial_party'
      : 'person';
  const entityQuery = useGetEntityGraph(entityType, displayRecord.id, {
    query: {
      enabled: isEntity,
      queryKey: [`/api/entities/${entityType}/${record.id}`],
      staleTime: 20_000,
    },
  });
  const entityData = objectValue(entityQuery.data);
  const entity = objectValue(entityData.entity);
  const related = objectValue(entityData.related);
  const entityName = stringValue(entity.name, displayRecord.title);
  const entitySubtitle = displayRecord.recordType === 'person'
    ? stringValue(entity.notes, stringValue(entity.phone, displayRecord.subtitle))
    : displayRecord.recordType === 'project'
      ? `الحالة: ${stringValue(entity.status, displayRecord.trailing ?? 'غير محددة')}`
      : 'فتح مركز الطرف المالي';
  const relatedGroups = Object.entries(related)
    .map(([key, value]) => ({ key, count: arrayValue(value).length }))
    .filter((group) => group.count > 0);
  const graphRelatedRows = Object.entries(related).flatMap(([key, value]) =>
    arrayValue(value)
      .map((item) => relatedRow(key, item))
      .filter((item): item is MobileRecordRow => Boolean(item)),
  );
  const allRelatedRows = [...(record.related ?? []), ...graphRelatedRows]
    .filter((item, index, rows) => rows.findIndex((candidate) => candidate.recordType === item.recordType && candidate.id === item.id) === index);
  const timelineRows = arrayValue(entityData.timeline).slice(0, 8);
  async function openEditor() {
    if (!editableKind || recordsQuery.isFetching) return;
    setEditingError(null);
    const refreshed = await recordsQuery.refetch();
    const fresh = findEditableRecord(refreshed.data, record);
    if (!refreshed.isSuccess || !fresh) {
      setEditingError('تعذر تحديث السجل قبل التعديل. لم نفتح نسخة قديمة.');
      return;
    }
    setLatestRecord(editableRecordRow(fresh, editableKind));
    setEditingRecord(fresh);
  }
  async function saveEdit(form: EditFormValues) {
    if (!editingRecord || !editableKind) return;
    setEditingError(null);
    try {
      const data = updateInputForRecord(editingRecord, editableKind, form);
      updateMutation.mutate(
        { recordType: editableKind, recordId: editingRecord.id, data },
        {
          onSuccess: async (response: RecordMutationResponse) => {
            setEditingRecord(null);
            if (response.pendingApproval && response.approval) {
              onPendingApproval(approvalForRequest(response.approval));
              return;
            }
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: getListRecordsQueryKey() }),
              queryClient.invalidateQueries({ queryKey: getGetTodayContextQueryKey() }),
            ]);
            onRecordSaved();
          },
          onError: async (error: unknown) => {
            const status = typeof (error as { status?: unknown })?.status === 'number'
              ? (error as { status: number }).status
              : undefined;
            if (status !== 409) {
              setEditingError('تعذر حفظ التعديل. تحقق من البيانات وحاول مرة أخرى.');
              return;
            }
            setEditingRecord(null);
            const refreshed = await recordsQuery.refetch();
            const fresh = findEditableRecord(refreshed.data, record);
            if (fresh && editableKind) setLatestRecord(editableRecordRow(fresh, editableKind));
            if (isEntity) await entityQuery.refetch();
            setEditingError('رُفض التعديل لأن السجل تغيّر من نافذة أخرى. تم عرض النسخة الأحدث دون إعادة المحاولة.');
          },
        },
      );
    } catch {
      setEditingError('تحقق من قيم التاريخ والمبلغ ثم حاول مرة أخرى.');
    }
  }

  return (
    <ScrollView
      style={detailStyles.detailScreen}
      contentContainerStyle={detailStyles.detailContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
    >
      <View style={detailStyles.detailHeader}>
        <Pressable
          testID="record-detail-back"
          accessibilityRole="button"
          accessibilityLabel="العودة إلى الرئيسية"
          onPress={onBack}
          style={({ pressed }) => [
            styles.iconButton,
            { borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <Feather name="arrow-right" size={17} color={colors.foreground} />
        </Pressable>
          <Text style={[detailStyles.detailEyebrow, { color: colors.mutedForeground }]}>
            {isEntity ? 'مركز الكيان' : 'تفاصيل السجل'}
          </Text>
      </View>

      <View style={[detailStyles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
         <Text style={[detailStyles.detailTitle, { color: colors.foreground }]}>{isEntity ? entityName : displayRecord.title}</Text>
        <Text style={[detailStyles.detailSubtitle, { color: colors.mutedForeground }]}>
          {isEntity ? entitySubtitle : displayRecord.subtitle}
        </Text>
        {canSuppressProactive && (
          <View style={{ marginTop: 14, gap: 7 }}>
            <Pressable
              testID="record-pause-proactive"
              accessibilityRole="button"
              accessibilityLabel={localized(language, 'أنا أتابع هذا الأمر، أوقف التنبيهات مؤقتًا', 'I am tracking this; pause proactive alerts')}
              disabled={suppressionMutation.isPending || Boolean(suppressionMessage)}
              onPress={() => {
                setSuppressionError(null);
                setSuppressionMessage(null);
                suppressionMutation.mutate(
                  {
                    data: {
                      entityType: record.recordType as 'task' | 'commitment',
                      entityId: record.id,
                    },
                  },
                  {
                    onSuccess: () => setSuppressionMessage(localized(
                      language,
                      'تم إيقاف التنبيهات لهذا السجل لمدة 24 ساعة.',
                      'Proactive alerts for this record are paused for 24 hours.',
                    )),
                    onError: () => setSuppressionError(localized(
                      language,
                      'تعذر إيقاف التنبيهات. قد لا يكون السجل نشطًا الآن.',
                      'Could not pause alerts. The record may no longer be active.',
                    )),
                  },
                );
              }}
              style={({ pressed }) => [
                detailStyles.relatedRow,
                { borderColor: colors.border, borderWidth: 1, borderRadius: 13, opacity: pressed || suppressionMutation.isPending ? 0.65 : 1 },
              ]}
            >
              <Feather name="bell-off" size={15} color={colors.primary} />
              <Text style={[detailStyles.relatedLabel, { color: colors.foreground, flex: 1 }]}>
                {localized(language, 'أنا أتابع هذا الأمر', 'I am tracking this')}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: 'right' }}>
                {suppressionMutation.isPending
                  ? localized(language, 'جارٍ الحفظ', 'Saving')
                  : localized(language, 'إيقاف 24 ساعة', 'Pause 24 hours')}
              </Text>
            </Pressable>
            {suppressionMessage && (
              <Text accessibilityRole="text" style={{ color: colors.accent, fontSize: 12, textAlign: 'right' }}>
                {suppressionMessage}
              </Text>
            )}
            {suppressionError && (
              <Text accessibilityRole="alert" style={{ color: colors.destructive, fontSize: 12, textAlign: 'right' }}>
                {suppressionError}
              </Text>
            )}
          </View>
        )}
        {isEntity && typeof entity.phone === 'string' && (
          <Text style={[detailStyles.detailMeta, { color: colors.mutedForeground }]}>{entity.phone}</Text>
        )}
        {!isEntity && displayRecord.trailing && <Text style={[detailStyles.detailValue, { color: colors.primary }]}>{displayRecord.trailing}</Text>}
      </View>
      {detailFields.length > 0 && (
        <View testID="record-detail-fields" style={[detailStyles.fieldsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {detailFields.map((field) => (
            <View key={field.label} style={[detailStyles.fieldRow, { borderBottomColor: colors.border }]}>
              <Text style={[detailStyles.fieldValue, { color: colors.foreground }]}>{field.value}</Text>
              <Text style={[detailStyles.fieldLabel, { color: colors.mutedForeground }]}>{field.label}</Text>
            </View>
          ))}
        </View>
      )}
      {editableKind && (
        <Pressable
          testID="record-detail-edit"
          accessibilityRole="button"
          accessibilityLabel="تعديل السجل"
          onPress={() => void openEditor()}
          style={({ pressed }) => [detailStyles.detailSecondaryAction, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
        >
          <Feather name="edit-2" size={16} color={colors.foreground} />
          <Text style={[detailStyles.detailSecondaryActionText, { color: colors.foreground }]}>تعديل السجل</Text>
        </Pressable>
      )}
      {editingError && !editingRecord && <Text testID="record-edit-message" style={[detailStyles.detailStateText, { color: colors.destructive }]}>{editingError}</Text>}

      {isEntity && entityQuery.isLoading && (
        <View style={detailStyles.detailState}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[detailStyles.detailStateText, { color: colors.mutedForeground }]}>جاري تحميل تفاصيل الكيان…</Text>
        </View>
      )}

      {isEntity && entityQuery.isError && (
        <View style={[detailStyles.detailState, { backgroundColor: colors.destructive, borderColor: colors.destructive }]}>
          <Text style={[detailStyles.detailStateText, { color: colors.destructiveForeground }]}>
            تعذر تحميل التفاصيل من السجل الحالي.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إعادة تحميل التفاصيل"
            onPress={() => void entityQuery.refetch()}
          >
            <Text style={[detailStyles.detailRetry, { color: colors.destructiveForeground }]}>حاول</Text>
          </Pressable>
        </View>
      )}

      {!entityQuery.isLoading && !entityQuery.isError && allRelatedRows.length > 0 && (
        <View style={[detailStyles.relatedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[detailStyles.relatedTitle, { color: colors.foreground }]}>استكشف المعلومات المرتبطة</Text>
          <Text style={[detailStyles.relatedHint, { color: colors.mutedForeground }]}>
            افتح علاقة واتبعها إلى الكيان أو السجل التالي.
          </Text>
          {allRelatedRows.map((relatedRecord) => (
            <Pressable
              key={`${relatedRecord.recordType}-${relatedRecord.id}`}
              accessibilityRole="button"
              accessibilityLabel={`فتح ${relatedRecord.title}`}
              onPress={() => onOpenRelatedRecord(relatedRecord)}
              style={({ pressed }) => [
                detailStyles.relatedRow,
                { borderBottomColor: colors.border, opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <View style={detailStyles.relatedRowCopy}>
                <Text style={[detailStyles.relatedLabel, { color: colors.foreground }]} numberOfLines={1}>
                  {relatedRecord.title}
                </Text>
                <Text style={[detailStyles.relatedSubtext, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {relatedRecord.subtitle}
                </Text>
              </View>
              {relatedRecord.trailing && (
                <Text style={[detailStyles.relatedCount, { color: colors.primary }]} numberOfLines={1}>
                  {relatedRecord.trailing}
                </Text>
              )}
              <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </View>
      )}

      {isEntity && !entityQuery.isLoading && !entityQuery.isError && timelineRows.length > 0 && (
        <View style={[detailStyles.timelineCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={detailStyles.timelineHeading}>
            <Text style={[detailStyles.relatedTitle, { color: colors.foreground }]}>النشاط المرتبط</Text>
          </View>
          {timelineRows.map((item, index) => {
            const event = objectValue(item);
            return (
              <View key={`${String(event.id ?? 'event')}-${index}`} style={[detailStyles.timelineRow, { borderBottomColor: colors.border }]}>
                <View style={[detailStyles.timelineDot, { backgroundColor: colors.accent }]} />
                <View style={detailStyles.timelineCopy}>
                  <Text style={[detailStyles.timelineTitle, { color: colors.foreground }]} numberOfLines={2}>
                    {stringValue(event.summary, stringValue(event.description, stringValue(event.type, 'نشاط مرتبط')))}
                  </Text>
                  <Text style={[detailStyles.timelineMeta, { color: colors.mutedForeground }]}>
                    {recordDate(typeof event.occurredAt === 'string' ? event.occurredAt : null)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {displayRecord.origin && onOpenConversation && (
        <Pressable
          testID="open-original-conversation"
          accessibilityRole="button"
          accessibilityLabel="فتح المحادثة الأصلية"
          onPress={() => onOpenConversation(displayRecord.origin as RecordOrigin)}
          style={({ pressed }) => [
            detailStyles.detailSecondaryAction,
            { borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <Feather name="corner-up-left" size={16} color={colors.foreground} />
          <Text style={[detailStyles.detailSecondaryActionText, { color: colors.foreground }]}>
            فتح المحادثة الأصلية
          </Text>
        </Pressable>
      )}

      <View style={[detailStyles.detailContext, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        <View style={detailStyles.detailContextCopy}>
          <Text style={[detailStyles.detailContextTitle, { color: colors.foreground }]}>تحدث مع السكرتير عن هذا السجل</Text>
          <Text style={[detailStyles.detailContextText, { color: colors.mutedForeground }]}>
            سأجهز لك مسودة مرتبطة بالسجل، ويمكنك تعديلها قبل الإرسال.
          </Text>
        </View>
      </View>

      <Pressable
        testID="ask-secretary-about-record"
        accessibilityRole="button"
        accessibilityLabel="اسأل السكرتير عن هذا السجل"
        onPress={onAskSecretary}
        style={({ pressed }) => [
          detailStyles.detailPrimaryAction,
          { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Feather name="message-circle" size={16} color={colors.primaryForeground} />
        <Text style={[detailStyles.detailPrimaryActionText, { color: colors.primaryForeground }]}>اسأل السكرتير عن هذا</Text>
      </Pressable>
      {chatContext?.id === displayRecord.id && (
        <CentralSecretaryChat
          colors={colors}
          messages={chatMessages}
          draft={chatDraft}
          onChangeDraft={onChangeChatDraft}
          onSend={onSendChat}
          isSending={chatBusy}
          onApprove={onApprove}
          onReject={onReject}
          busyOperationId={busyOperationId}
          onOpenRecord={onOpenRelatedRecord}
          context={record}
          compact
        />
      )}
      {editingRecord && editableKind && (
        <MobileEditSheet
          record={editingRecord}
          kind={editableKind}
          colors={colors}
          people={(recordsQuery.data?.people ?? []) as PersonRecord[]}
          projects={(recordsQuery.data?.projects ?? []) as ProjectRecord[]}
          isSaving={updateMutation.isPending}
          error={editingError}
          onClose={() => setEditingRecord(null)}
          onSave={(form) => void saveEdit(form)}
        />
      )}
    </ScrollView>
  );
}

const mainNavigation: Array<{ key: MainSection; labelAr: string; labelEn: string; icon: FeatherName }> = [
  { key: 'office', labelAr: 'الرئيسية', labelEn: 'Home', icon: 'home' },
  { key: 'chat', labelAr: 'المحادثات السابقة', labelEn: 'Conversations', icon: 'message-circle' },
  { key: 'records', labelAr: 'السجلات', labelEn: 'Records', icon: 'archive' },
  { key: 'people', labelAr: 'الأشخاص', labelEn: 'People', icon: 'users' },
  { key: 'projects', labelAr: 'المشاريع', labelEn: 'Projects', icon: 'briefcase' },
  { key: 'financial', labelAr: 'الماليات', labelEn: 'Financial', icon: 'dollar-sign' },
  { key: 'tasks', labelAr: 'المهام', labelEn: 'Tasks', icon: 'check-square' },
  { key: 'reminders', labelAr: 'التذكيرات', labelEn: 'Reminders', icon: 'bell' },
  { key: 'activity', labelAr: 'النشاط', labelEn: 'Activity', icon: 'activity' },
  { key: 'works', labelAr: 'أعمال الوكيل', labelEn: 'Agent work', icon: 'compass' },
];

export function ConversationHistoryView({
  colors,
  language,
  conversations,
  loading,
  onOpenConversation,
  onBack,
}: {
  colors: ReturnType<typeof useColors>;
  language: AppLanguage;
  conversations: ConversationSummary[];
  loading: boolean;
  onOpenConversation: (conversationId: string) => void;
  onBack: () => void;
}) {
  return (
    <ScrollView testID="conversation-history" contentContainerStyle={styles.conversationHistory} showsVerticalScrollIndicator={false}>
      <View style={styles.recordsIntro}>
        <Pressable
          testID="conversation-history-back"
          accessibilityRole="button"
          accessibilityLabel={localized(language, 'العودة للرئيسية', 'Back to home')}
          onPress={onBack}
          style={({ pressed }) => [
            styles.iconButton,
            { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <Feather name="arrow-right" size={17} color={colors.foreground} />
        </Pressable>
        <View>
          <Text style={[styles.recordsTitle, { color: colors.foreground }]}>
            {localized(language, 'المحادثات السابقة', 'Previous conversations')}
          </Text>
          <Text style={[styles.recordsSubtitle, { color: colors.mutedForeground }]}>
            {localized(language, 'افتح أي محادثة وتابعها من نفس السكرتير.', 'Open a conversation and continue with the same secretary.')}
          </Text>
        </View>
      </View>
      {loading && (
        <View style={[styles.conversationHistoryState, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.recordsLoadingText, { color: colors.mutedForeground }]}>
            {localized(language, 'جاري تحميل المحادثات…', 'Loading conversations…')}
          </Text>
        </View>
      )}
      {!loading && conversations.length === 0 && (
        <View style={[styles.conversationHistoryState, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.recordsEmptyTitle, { color: colors.foreground }]}>
            {localized(language, 'لا توجد محادثات سابقة بعد', 'No previous conversations yet')}
          </Text>
          <Text style={[styles.recordsEmptyText, { color: colors.mutedForeground }]}>
            {localized(language, 'ابدأ من الرئيسية، وستظهر المحادثات هنا بعد حفظها.', 'Start from Home and saved conversations will appear here.')}
          </Text>
        </View>
      )}
      {!loading && conversations.map((conversation) => (
        <Pressable
          key={conversation.conversationId}
          testID={`conversation-history-${conversation.conversationId}`}
          accessibilityRole="button"
          accessibilityLabel={`${localized(language, 'فتح المحادثة', 'Open conversation')} ${conversation.title}`}
          onPress={() => onOpenConversation(conversation.conversationId)}
          style={({ pressed }) => [
            styles.conversationHistoryRow,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <View style={[styles.conversationHistoryIcon, { backgroundColor: colors.muted }]}>
            <Feather name="message-circle" size={16} color={colors.primary} />
          </View>
          <View style={styles.conversationHistoryCopy}>
            <Text style={[styles.conversationHistoryTitle, { color: colors.foreground }]} numberOfLines={1}>
              {conversation.title}
            </Text>
            <Text style={[styles.conversationHistoryPreview, { color: colors.mutedForeground }]} numberOfLines={2}>
              {conversation.preview}
            </Text>
            <Text style={[styles.conversationHistoryMeta, { color: colors.primary }]}>
              {conversation.turnCount} {localized(language, 'رسائل', 'turns')}
            </Text>
          </View>
          <Feather name="chevron-left" size={16} color={colors.mutedForeground} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function MainBottomBar({
  colors,
  language,
  activeSection,
  onSelect,
  onOpenDrawer,
}: {
  colors: ReturnType<typeof useColors>;
  language: AppLanguage;
  activeSection: MainSection;
  onSelect: (section: MainSection) => void;
  onOpenDrawer: () => void;
}) {
  const insets = useSafeAreaInsets();
  const items: Array<{ key: 'office' | 'chat' | 'records' | 'tasks' | 'more'; labelAr: string; labelEn: string; icon: FeatherName }> = [
    { key: 'office', labelAr: 'الرئيسية', labelEn: 'Home', icon: 'home' },
    { key: 'chat', labelAr: 'المحادثة', labelEn: 'Chat', icon: 'message-circle' },
    { key: 'records', labelAr: 'السجلات', labelEn: 'Records', icon: 'archive' },
    { key: 'tasks', labelAr: 'المهام', labelEn: 'Tasks', icon: 'check-square' },
    { key: 'more', labelAr: 'المزيد', labelEn: 'More', icon: 'more-horizontal' },
  ];
  return (
    <View
      style={[
        styles.bottomBar,
        {
          bottom: Math.max(17, insets.bottom + 9),
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      {items.map((item) => {
        const selected = item.key === 'office'
          ? activeSection === 'office'
          : item.key === 'chat'
            ? activeSection === 'chat'
          : item.key === 'records'
            ? activeSection === 'records'
            : item.key === 'tasks'
              ? activeSection === 'tasks'
              : false;
        return (
          <Pressable
            key={item.key}
            testID={`main-bottom-${item.key}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={localized(language, item.labelAr, item.labelEn)}
            onPress={() => {
              if (item.key === 'more') {
                onOpenDrawer();
              } else {
                onSelect(item.key);
              }
            }}
            style={({ pressed }) => [styles.bottomBarItem, { opacity: pressed ? 0.62 : 1 }]}
          >
            <View style={[styles.bottomBarIcon, selected && { backgroundColor: colors.muted }]}>
              <Feather name={item.icon} size={17} color={selected ? colors.primary : colors.mutedForeground} />
            </View>
            <Text style={[styles.bottomBarLabel, { color: selected ? colors.primary : colors.mutedForeground }]}>
              {localized(language, item.labelAr, item.labelEn)}
            </Text>
            {selected && <View style={[styles.bottomBarDot, { backgroundColor: colors.primary }]} />}
          </Pressable>
        );
      })}
    </View>
  );
}

export function MainDrawer({
  colors,
  language,
  themePreference,
  open,
  activeSection,
  onClose,
  onSelect,
  onOpenQuick,
  onOpenMemories,
  onThemeChange,
  onLanguageChange,
  assistantPreferences,
  onAssistantPreferencesChange,
  onLogout,
}: {
  colors: ReturnType<typeof useColors>;
  language: AppLanguage;
  themePreference: ThemePreference;
  open: boolean;
  activeSection: MainSection;
  onClose: () => void;
  onSelect: (section: MainSection) => void;
  onOpenQuick: () => void;
  onOpenMemories: () => void;
  onThemeChange: (theme: ThemePreference) => void;
  onLanguageChange: (language: AppLanguage) => void;
  assistantPreferences: AssistantPreferences;
  onAssistantPreferencesChange: (patch: Partial<AssistantPreferences>) => void;
  onLogout: () => void;
}) {
  if (!open) return null;
  return (
    <View style={styles.drawerLayer}>
      <Pressable
        testID="main-drawer-backdrop"
        accessibilityRole="button"
        accessibilityLabel="إغلاق القائمة"
        onPress={onClose}
        style={[styles.drawerBackdrop, { backgroundColor: colors.foreground, opacity: 0.22 }]}
      />
      <ScrollView
        style={[styles.drawerPanel, { backgroundColor: colors.card, borderLeftColor: colors.border, shadowColor: colors.foreground }]}
        contentContainerStyle={styles.drawerScrollContent}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.drawerHeading}>
          <View style={styles.drawerHeadingCopy}>
            <Text style={[styles.drawerTitle, { color: colors.foreground }]}>Personal Secretary</Text>
            <Text style={[styles.drawerSubtitle, { color: colors.mutedForeground }]}>
              {localized(language, 'إدارة واستكشاف معلوماتك', 'Manage and explore your information')}
            </Text>
          </View>
          <Pressable
            testID="close-main-drawer"
            accessibilityRole="button"
            accessibilityLabel="إغلاق القائمة"
            onPress={onClose}
            style={({ pressed }) => [styles.drawerClose, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
          >
            <Feather name="x" size={17} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={[styles.drawerStatus, { backgroundColor: colors.muted }]}>
          <Text style={[styles.drawerStatusLabel, { color: colors.mutedForeground }]}>
            {localized(language, 'حالة المكتب', 'Office status')}
          </Text>
          <Text style={[styles.drawerStatusValue, { color: colors.foreground }]}>
            {localized(language, 'السكرتير مستعد ويتبع اختيارك', 'The secretary is ready and follows your settings')}
          </Text>
        </View>
        <View style={styles.drawerNav}>
          {mainNavigation.map((item) => (
            <Pressable
              key={item.key}
              testID={`main-nav-${item.key}`}
              accessibilityRole="button"
              accessibilityState={{ selected: activeSection === item.key }}
              onPress={() => onSelect(item.key)}
              style={({ pressed }) => [
                styles.drawerNavItem,
                activeSection === item.key && { backgroundColor: colors.muted },
                { opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Feather name={item.icon} size={17} color={activeSection === item.key ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.drawerNavText, { color: activeSection === item.key ? colors.foreground : colors.mutedForeground }]}>
                {localized(language, item.labelAr, item.labelEn)}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={[styles.drawerQuickSeparator, { borderTopColor: colors.border }]} />
        <Pressable
          testID="drawer-open-quick"
          accessibilityRole="button"
          accessibilityLabel="فتح السكرتير بسرعة"
          onPress={onOpenQuick}
          style={({ pressed }) => [styles.drawerQuick, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
        >
          <View style={[styles.drawerQuickBubble, { backgroundColor: colors.primary }]}>
            <Feather name="message-circle" size={16} color={colors.primaryForeground} />
          </View>
          <View style={styles.drawerQuickCopy}>
            <Text style={[styles.drawerQuickTitle, { color: colors.foreground }]}>
              {localized(language, 'فتح السكرتير بسرعة', 'Open Quick Chat')}
            </Text>
            <Text style={[styles.drawerQuickText, { color: colors.mutedForeground }]}>
              {localized(language, 'وصول خفيف إلى نفس السكرتير', 'A lightweight way to reach the same secretary')}
            </Text>
          </View>
        </Pressable>
        <View style={[styles.drawerSettings, { borderTopColor: colors.border }]}>
          <View style={styles.drawerSettingsHeading}>
            <Text style={[styles.drawerSettingsTitle, { color: colors.foreground }]}>
              {localized(language, 'الإعدادات', 'Settings')}
            </Text>
          </View>
          <Pressable
            testID="drawer-open-memories"
            accessibilityRole="button"
            accessibilityLabel={localized(language, 'فتح الذاكرة الشخصية', 'Open personal memory')}
            onPress={onOpenMemories}
            style={({ pressed }) => [styles.drawerMemoryLink, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
          >
            <Feather name="database" size={15} color={colors.primary} />
            <View style={styles.drawerMemoryCopy}>
              <Text style={[styles.drawerMemoryTitle, { color: colors.foreground }]}>
                {localized(language, 'الذاكرة الشخصية', 'Personal memory')}
              </Text>
              <Text style={[styles.drawerMemoryText, { color: colors.mutedForeground }]}>
                {localized(language, 'راجع ما حفظته واحذفه عند الحاجة', 'Review or remove what you saved')}
              </Text>
            </View>
            <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
          </Pressable>
          <Text style={[styles.drawerSettingLabel, { color: colors.mutedForeground }]}>
            {localized(language, 'الخلفية', 'Appearance')}
          </Text>
          <View style={[styles.drawerChoiceRow, { backgroundColor: colors.muted }]}>
            {([
              ['light', 'فاتحة', 'Light', 'sun'],
              ['dark', 'داكنة', 'Dark', 'moon'],
            ] as const).map(([value, arabicLabel, englishLabel, icon]) => (
              <Pressable
                key={value}
                testID={`theme-${value}`}
                accessibilityRole="button"
                accessibilityState={{ selected: themePreference === value }}
                onPress={() => onThemeChange(value)}
                style={({ pressed }) => [
                  styles.drawerChoice,
                  themePreference === value && { backgroundColor: colors.card, borderColor: colors.border },
                  { opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <Feather name={icon} size={14} color={themePreference === value ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.drawerChoiceText, { color: themePreference === value ? colors.foreground : colors.mutedForeground }]}>
                  {localized(language, arabicLabel, englishLabel)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.drawerSettingLabel, { color: colors.mutedForeground }]}>
            {localized(language, 'اللغة', 'Language')}
          </Text>
          <View style={[styles.drawerChoiceRow, { backgroundColor: colors.muted }]}>
            {([
              ['ar', 'العربية', 'Arabic'],
              ['en', 'English', 'English'],
            ] as const).map(([value, arabicLabel, englishLabel]) => (
              <Pressable
                key={value}
                testID={`language-${value}`}
                accessibilityRole="button"
                accessibilityState={{ selected: language === value }}
                onPress={() => onLanguageChange(value)}
                style={({ pressed }) => [
                  styles.drawerChoice,
                  language === value && { backgroundColor: colors.card, borderColor: colors.border },
                  { opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <Text style={[styles.drawerChoiceText, { color: language === value ? colors.foreground : colors.mutedForeground }]}>
                  {localized(language, arabicLabel, englishLabel)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.drawerSettingLabel, { color: colors.mutedForeground }]}>
            {localized(language, 'حضور السكرتير', 'Secretary activity')}
          </Text>
          <Text style={[styles.drawerSettingHint, { color: colors.mutedForeground }]}>
            {localized(language, 'تحكم في مقدار ما يظهر على الشاشة.', 'Control how much the secretary surfaces.')}
          </Text>
          <View style={[styles.drawerChoiceRow, { backgroundColor: colors.muted }]}>
            {([
              ['focused', 'مركز', 'Focused'],
              ['balanced', 'متوازن', 'Balanced'],
              ['quiet', 'استعداد', 'Standby'],
            ] as const).map(([value, arabicLabel, englishLabel]) => (
              <Pressable
                key={value}
                testID={`assistant-activity-${value}`}
                accessibilityRole="button"
                accessibilityState={{ selected: assistantPreferences.activity === value }}
                onPress={() => onAssistantPreferencesChange({ activity: value })}
                style={({ pressed }) => [
                  styles.drawerChoice,
                  assistantPreferences.activity === value && { backgroundColor: colors.card, borderColor: colors.border },
                  { opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <Text style={[styles.drawerChoiceText, { color: assistantPreferences.activity === value ? colors.foreground : colors.mutedForeground }]}>
                  {localized(language, arabicLabel, englishLabel)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.drawerSettingLabel, { color: colors.mutedForeground }]}>
            {localized(language, 'المبادرة', 'Proactive level')}
          </Text>
          <Text style={[styles.drawerSettingHint, { color: colors.mutedForeground }]}>
            {localized(language, 'متى يقترح عليك السكرتير خطوة تالية.', 'When the secretary suggests the next step.')}
          </Text>
          <View style={[styles.drawerChoiceRow, { backgroundColor: colors.muted }]}>
            {([
              ['low', 'هادئ', 'Low'],
              ['balanced', 'متوازن', 'Balanced'],
              ['high', 'استباقي', 'High'],
            ] as const).map(([value, arabicLabel, englishLabel]) => (
              <Pressable
                key={value}
                testID={`assistant-proactive-${value}`}
                accessibilityRole="button"
                accessibilityState={{ selected: assistantPreferences.proactive === value }}
                onPress={() => onAssistantPreferencesChange({ proactive: value })}
                style={({ pressed }) => [
                  styles.drawerChoice,
                  assistantPreferences.proactive === value && { backgroundColor: colors.card, borderColor: colors.border },
                  { opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <Text style={[styles.drawerChoiceText, { color: assistantPreferences.proactive === value ? colors.foreground : colors.mutedForeground }]}>
                  {localized(language, arabicLabel, englishLabel)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.drawerSettingLabel, { color: colors.mutedForeground }]}>
            {localized(language, 'عمق الذكاء', 'AI depth')}
          </Text>
          <Text style={[styles.drawerSettingHint, { color: colors.mutedForeground }]}>
            {localized(language, 'سرعة الرد مقابل تحليل أعمق للسياق.', 'Response speed versus deeper context analysis.')}
          </Text>
          <View style={[styles.drawerChoiceRow, { backgroundColor: colors.muted }]}>
            {([
              ['fast', 'سريع', 'Fast'],
              ['balanced', 'متوازن', 'Balanced'],
              ['deep', 'عميق', 'Deep'],
            ] as const).map(([value, arabicLabel, englishLabel]) => (
              <Pressable
                key={value}
                testID={`assistant-intelligence-${value}`}
                accessibilityRole="button"
                accessibilityState={{ selected: assistantPreferences.intelligence === value }}
                onPress={() => onAssistantPreferencesChange({ intelligence: value })}
                style={({ pressed }) => [
                  styles.drawerChoice,
                  assistantPreferences.intelligence === value && { backgroundColor: colors.card, borderColor: colors.border },
                  { opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <Text style={[styles.drawerChoiceText, { color: assistantPreferences.intelligence === value ? colors.foreground : colors.mutedForeground }]}>
                  {localized(language, arabicLabel, englishLabel)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.drawerSettingLabel, { color: colors.mutedForeground }]}>
            {localized(language, 'أسلوب التواصل', 'Communication style')}
          </Text>
          <View style={[styles.drawerChoiceRow, { backgroundColor: colors.muted }]}>
            {([
              ['balanced', 'متوازن', 'Balanced'],
              ['friendly', 'ودود', 'Friendly'],
              ['concise', 'موجز', 'Concise'],
              ['formal', 'رسمي', 'Formal'],
            ] as const).map(([value, arabicLabel, englishLabel]) => (
              <Pressable
                key={value}
                testID={`assistant-style-${value}`}
                accessibilityRole="button"
                accessibilityState={{ selected: assistantPreferences.communicationStyle === value }}
                onPress={() => onAssistantPreferencesChange({ communicationStyle: value })}
                style={({ pressed }) => [
                  styles.drawerChoice,
                  assistantPreferences.communicationStyle === value && { backgroundColor: colors.card, borderColor: colors.border },
                  { opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <Text style={[styles.drawerChoiceText, { color: assistantPreferences.communicationStyle === value ? colors.foreground : colors.mutedForeground }]}>
                  {localized(language, arabicLabel, englishLabel)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.drawerSettingLabel, { color: colors.mutedForeground }]}>
            {localized(language, 'تكرار التذكير', 'Repeat reminders')}
          </Text>
          <Text style={[styles.drawerSettingHint, { color: colors.mutedForeground }]}>
            {localized(language, 'التكرار متوقف افتراضيًا؛ فعّله فقط إذا كنت تريده.', 'Repeats are off by default; enable them only if you want them.') }
          </Text>
          <View style={[styles.drawerChoiceRow, { backgroundColor: colors.muted }]}>
            {([
              [false, 'مرة واحدة', 'Once'],
              [true, 'السماح بالتكرار', 'Allow repeats'],
            ] as const).map(([value, arabicLabel, englishLabel]) => (
              <Pressable
                key={String(value)}
                testID={`assistant-repeat-${value}`}
                accessibilityRole="button"
                accessibilityState={{ selected: assistantPreferences.repeatReminders === value }}
                onPress={() => onAssistantPreferencesChange({ repeatReminders: value })}
                style={({ pressed }) => [
                  styles.drawerChoice,
                  assistantPreferences.repeatReminders === value && { backgroundColor: colors.card, borderColor: colors.border },
                  { opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <Text style={[styles.drawerChoiceText, { color: assistantPreferences.repeatReminders === value ? colors.foreground : colors.mutedForeground }]}>
                  {localized(language, arabicLabel, englishLabel)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            testID="drawer-logout"
            accessibilityRole="button"
            accessibilityLabel={localized(language, 'تسجيل الخروج', 'Log out')}
            onPress={onLogout}
            style={({ pressed }) => [
              styles.drawerLogout,
              { borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
            ]}
          >
            <Feather name="log-out" size={15} color={colors.destructive} />
            <Text style={[styles.drawerLogoutText, { color: colors.destructive }]}>
              {localized(language, 'تسجيل الخروج', 'Log out')}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// Drawer styles stay in the screen stylesheet so the shell can remain a single
export const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    minHeight: 70,
    paddingHorizontal: 18,
    paddingBottom: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTop: {
    minHeight: 40,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandBlock: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 14,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
    borderBottomLeftRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
  },
  availability: {
    marginTop: 2,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  availabilityText: {
    fontSize: 9,
    textAlign: 'right',
  },
  iconButton: {
    width: 39,
    height: 39,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  quickAccessBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  retryButton: {
    backgroundColor: '#2b7a7f',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  drawerLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    elevation: 1000,
    flexDirection: 'row-reverse',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  drawerPanel: {
    width: '82%',
    maxWidth: 340,
    height: '100%',
    paddingTop: 78,
    paddingHorizontal: 16,
    borderLeftWidth: 1,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: -4, height: 0 },
    elevation: 1001,
  },
  drawerScrollContent: {
    flexGrow: 1,
    paddingBottom: 28,
  },
  drawerHeading: {
    minHeight: 48,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  drawerMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerHeadingCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  drawerStatus: {
    marginTop: 16,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
    alignItems: 'flex-end',
  },
  drawerStatusLabel: {
    width: '100%',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'right',
  },
  drawerStatusValue: {
    width: '100%',
    marginTop: 3,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'right',
  },
  drawerTitle: {
    width: '100%',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
  },
  drawerSubtitle: {
    width: '100%',
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
  },
  drawerClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerNav: {
    marginTop: 22,
    gap: 5,
  },
  drawerNavItem: {
    minHeight: 46,
    borderRadius: 13,
    paddingHorizontal: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  drawerNavText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  drawerQuickSeparator: {
    marginTop: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  drawerQuick: {
    minHeight: 62,
    marginTop: 15,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 11,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  drawerQuickBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerQuickCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  drawerQuickTitle: {
    width: '100%',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  drawerQuickText: {
    width: '100%',
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
  },
  drawerSettings: {
    marginTop: 18,
    paddingTop: 15,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  drawerSettingsHeading: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  drawerMemoryLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 17,
  },
  drawerMemoryCopy: {
    flex: 1,
    gap: 3,
  },
  drawerMemoryTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  drawerMemoryText: {
    fontSize: 10,
    lineHeight: 15,
  },
  drawerLogout: {
    marginTop: 18,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
  },
  drawerLogoutText: {
    fontSize: 12,
    fontWeight: '700',
  },
  drawerSettingsTitle: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  drawerSettingLabel: {
    marginTop: 13,
    marginBottom: 6,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'right',
  },
  drawerSettingHint: {
    marginTop: -3,
    marginBottom: 6,
    fontSize: 9,
    lineHeight: 14,
    textAlign: 'right',
  },
  drawerChoiceRow: {
    borderRadius: 12,
    padding: 3,
    flexDirection: 'row-reverse',
    gap: 3,
  },
  drawerChoice: {
    flex: 1,
    minHeight: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'transparent',
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  drawerChoiceText: {
    fontSize: 11,
    fontWeight: '700',
  },
  viewSwitcher: {
    marginTop: 10,
    borderRadius: 13,
    padding: 3,
    flexDirection: 'row-reverse',
    alignSelf: 'stretch',
  },
  viewTab: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  viewTabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  messageList: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 16,
  },
  quickHero: {
    marginBottom: 14,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 22,
    alignItems: 'center',
  },
  quickHeroMark: {
    width: 54,
    height: 54,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickHeroTitle: {
    marginTop: 12,
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'center',
  },
  quickHeroText: {
    maxWidth: 290,
    marginTop: 6,
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
  },
  recordsList: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  recordsView: {
    flex: 1,
  },
  conversationHistory: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 96,
    gap: 8,
  },
  conversationHistoryState: {
    minHeight: 150,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 8,
  },
  conversationHistoryRow: {
    minHeight: 72,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  conversationHistoryIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conversationHistoryCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  conversationHistoryTitle: {
    width: '100%',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  conversationHistoryPreview: {
    width: '100%',
    marginTop: 3,
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'right',
  },
  conversationHistoryMeta: {
    width: '100%',
    marginTop: 3,
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'right',
  },
  recordsIntro: {
    paddingTop: 18,
    paddingBottom: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recordsHeaderActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  recordsTitle: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'right',
  },
  recordsSubtitle: {
    marginTop: 3,
    fontSize: 12,
    textAlign: 'right',
  },
  recordSummaryGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  recordSummaryCard: {
    width: '31.8%',
    minHeight: 68,
    borderRadius: 14,
    borderWidth: 1,
    padding: 9,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  recordSummaryCount: {
    fontSize: 18,
    fontWeight: '700',
  },
  recordSummaryLabel: {
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
  },
  recordSectionHeader: {
    paddingTop: 15,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recordSectionTitle: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  recordIcon: {
    width: 29,
    height: 29,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordSectionName: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
  },
  recordCount: {
    fontSize: 11,
  },
  recordRow: {
    minHeight: 63,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  recordCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  recordTitle: {
    width: '100%',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'right',
  },
  recordSubtitle: {
    width: '100%',
    marginTop: 3,
    fontSize: 11,
    textAlign: 'right',
  },
  recordTrailing: {
    maxWidth: 92,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'left',
  },
  recordsLoading: {
    minHeight: 170,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  recordsLoadingText: {
    fontSize: 12,
  },
  recordsError: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  recordsErrorCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  recordsErrorTitle: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  recordsErrorText: {
    marginTop: 3,
    fontSize: 11,
    textAlign: 'right',
  },
  recordsRetry: {
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  recordsEmpty: {
    minHeight: 190,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    marginTop: 12,
  },
  recordsEmptyTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '700',
  },
  recordsEmptyText: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
  },
  centralChatPanel: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
    height: 0,
    minHeight: 0,
    marginTop: 0,
    borderRadius: 0,
    borderWidth: 0,
    padding: 0,
    overflow: 'visible',
    position: 'relative',
  },
  centralChatSurface: {
    ...StyleSheet.absoluteFill,
    borderRadius: 27,
  },
  centralChatExpanded: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
    height: 0,
    minHeight: 0,
    marginTop: 0,
    marginBottom: 0,
    marginHorizontal: 0,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    borderRadius: 27,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'flex-start',
  },
  recordChatPanel: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
  },
  centralChatHeading: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
    paddingBottom: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  centralChatHeadingPearl: {
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  centralChatHeaderActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 3,
  },
  centralChatHeaderButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centralChatIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centralChatHeroIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    borderWidth: 1,
  },
  centralChatPresenceMark: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centralChatPresenceGlow: {
    position: 'absolute',
    width: 27,
    height: 27,
    borderRadius: 14,
    opacity: 0.2,
  },
  centralChatPresenceCore: {
    width: 23,
    height: 23,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centralChatPresenceDot: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  centralChatPresenceDotTop: {
    top: 0,
    right: 3,
  },
  centralChatPresenceDotSide: {
    bottom: 3,
    left: 2,
  },
  centralChatAmbient: {
    ...StyleSheet.absoluteFill,
  },
  centralChatAmbientOrb: {
    position: 'absolute',
    width: 180,
    height: 180,
    top: -110,
    left: -42,
    borderRadius: 90,
    opacity: 0.08,
  },
  centralChatAmbientOrbSmall: {
    position: 'absolute',
    width: 130,
    height: 130,
    bottom: -78,
    right: -30,
    borderRadius: 65,
    opacity: 0.1,
  },
  pearlBackground: {
    ...StyleSheet.absoluteFill,
  },
  centralChatHeadingCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  centralChatTitle: {
    width: '100%',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  centralChatHint: {
    width: '100%',
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
  },
  centralChatSignal: {
    marginTop: 3,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
  },
  centralChatSignalDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  centralChatSignalText: {
    fontSize: 8,
    fontWeight: '700',
    textAlign: 'right',
  },
  chatContextChip: {
    marginTop: 9,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 7,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  chatContextText: {
    flex: 1,
    fontSize: 10,
    textAlign: 'right',
  },
  centralChatTranscript: {
    height: 72,
    maxHeight: 72,
    marginTop: 4,
  },
  centralChatTranscriptExpanded: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
    height: 0,
    maxHeight: 100000,
    minHeight: 0,
    marginTop: 0,
    paddingBottom: 174,
  },
  recordChatTranscript: {
    maxHeight: 220,
  },
  centralChatTranscriptContent: {
    paddingVertical: 1,
    gap: 5,
  },
  centralChatTranscriptContentPearl: {
    paddingHorizontal: 14,
    paddingTop: 17,
    gap: 11,
  },
  centralChatTranscriptEmptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  centralChatTranscriptEmptyContentPearl: {
    justifyContent: 'center',
    paddingTop: 0,
  },
  centralChatEmpty: {
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  centralChatEmptyIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centralChatEmptyTitle: {
    marginTop: 9,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  centralChatEmptyText: {
    maxWidth: 270,
    marginTop: 5,
    fontSize: 10,
    lineHeight: 16,
    textAlign: 'center',
  },
  centralChatTyping: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 7,
  },
  centralChatTypingText: {
    fontSize: 11,
  },
  inputReview: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  inputReviewCopy: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  inputReviewTitle: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
  },
  inputReviewText: {
    width: '100%',
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'right',
  },
  centralChatComposer: {
    minHeight: 45,
    marginTop: 5,
    borderRadius: 0,
    borderWidth: 0,
    paddingLeft: 0,
    paddingRight: 0,
    flexDirection: 'row-reverse',
    alignItems: 'flex-end',
  },
  centralChatComposerExpanded: {
    minHeight: 52,
    marginTop: 0,
    marginBottom: 0,
    borderRadius: 17,
    borderWidth: 1,
    paddingLeft: 6,
    paddingRight: 7,
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: -16,
    zIndex: 40,
    elevation: 40,
  },
  centralChatInputExpanded: {
    paddingTop: 7,
    paddingBottom: 7,
  },
  centralChatInput: {
    flex: 1,
    maxHeight: 50,
    borderWidth: 0,
    outlineStyle: 'solid',
    outlineWidth: 0,
    outlineColor: 'transparent',
    backgroundColor: 'transparent',
    paddingTop: 7,
    paddingBottom: 6,
    paddingHorizontal: 4,
    fontSize: 13,
    lineHeight: 19,
  },
  centralChatSend: {
    width: 32,
    height: 32,
    marginBottom: 5,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centralChatInputActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 5,
  },
  centralChatInputAction: {
    width: 30,
    height: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centralChatFooter: {
    paddingTop: 3,
    fontSize: 7,
    textAlign: 'center',
  },
  centralChatPromptRail: {
    gap: 5,
    paddingTop: 12,
    paddingBottom: 0,
    alignItems: 'center',
  },
  centralChatPromptRailPearl: {
    paddingHorizontal: 14,
  },
  centralChatPromptScroll: {
    height: 43,
    flexGrow: 0,
    flexShrink: 0,
  },
  centralChatSuggestionMenu: {
    marginTop: 9,
    gap: 5,
  },
  centralChatSuggestionMenuExpanded: {
    position: 'absolute',
    right: 14,
    bottom: 106,
    width: '72%',
    zIndex: 5,
    padding: 8,
    borderRadius: 17,
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  centralChatQuickDock: {
    position: 'absolute',
    right: 14,
    bottom: 67,
    zIndex: 4,
  },
  centralChatQuickButton: {
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: 11,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
  },
  centralChatQuickButtonText: {
    fontSize: 9,
    fontWeight: '700',
  },
  centralChatPrompt: {
    minHeight: 31,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 11,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  centralChatPromptText: {
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'right',
  },
  pearlSheet: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    height: '66%',
    borderRadius: 30,
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingBottom: 94,
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: -8 },
    elevation: 1,
  },
  pearlSheetSurface: {
    ...StyleSheet.absoluteFill,
    borderRadius: 30,
  },
  pearlSheetScroll: {
    flex: 1,
    minHeight: 0,
  },
  pearlSheetScrollContent: {
    paddingBottom: 24,
  },
  pearlSheetHandleZone: {
    height: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pearlSheetHandle: {
    width: 42,
    height: 4,
    borderRadius: 4,
    opacity: 0.42,
  },
  pearlSheetHeading: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pearlSheetHeadingCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  pearlSheetTitle: {
    width: '100%',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'right',
  },
  pearlSheetHint: {
    width: '100%',
    marginTop: 2,
    fontSize: 8,
    textAlign: 'right',
  },
  pearlSheetCount: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    overflow: 'hidden',
    fontSize: 8,
    textAlign: 'center',
  },
  pearlSheetTabs: {
    paddingTop: 4,
    paddingBottom: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(120, 115, 140, 0.18)',
    flexDirection: 'row-reverse',
    gap: 5,
  },
  pearlSheetTab: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pearlSheetTabText: {
    fontSize: 9,
    fontWeight: '700',
  },
  pearlSheetRecordList: {
    paddingTop: 9,
    gap: 6,
  },
  pearlSheetRecord: {
    minHeight: 49,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  pearlSheetRecordIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pearlSheetRecordCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  pearlSheetRecordTitle: {
    width: '100%',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'right',
  },
  pearlSheetRecordMeta: {
    width: '100%',
    marginTop: 2,
    fontSize: 8,
    textAlign: 'right',
  },
  pearlSheetRecordTrailing: {
    maxWidth: 66,
    fontSize: 8,
    textAlign: 'right',
  },
  pearlSheetEmpty: {
    paddingTop: 15,
    fontSize: 10,
    lineHeight: 17,
    textAlign: 'center',
  },
  pearlSheetContext: {
    marginTop: 10,
    padding: 12,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'flex-end',
  },
  pearlSheetContextIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pearlSheetContextTitle: {
    width: '100%',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'right',
  },
  pearlSheetContextText: {
    width: '100%',
    marginTop: 5,
    fontSize: 9,
    lineHeight: 16,
    textAlign: 'right',
  },
  officeList: {
    paddingHorizontal: 7,
    paddingTop: 9,
    paddingBottom: 88,
  },
  officeHome: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
    height: '100%',
    minHeight: 0,
    overflow: 'visible',
    paddingHorizontal: 15,
    paddingTop: 0,
    paddingBottom: 4,
    position: 'relative',
    zIndex: 30,
    elevation: 30,
  },
  officeIntro: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  officeIntroMark: {
    width: 38,
    height: 38,
    marginTop: 2,
    marginRight: 10,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeIntroCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeGreeting: {
    marginTop: 2,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'right',
  },
  officeSubtitle: {
    maxWidth: 270,
    marginTop: 3,
    fontSize: 9,
    lineHeight: 14,
    textAlign: 'right',
  },
  officeRefresh: {
    width: 38,
    height: 38,
    marginTop: 2,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeSummaryGrid: {
    marginTop: 0,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pearlDateStrip: {
    minHeight: 70,
    paddingHorizontal: 1,
    paddingTop: 17,
    paddingBottom: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pearlDateCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  pearlDateTitle: {
    width: '100%',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'right',
  },
  pearlDateHint: {
    width: '100%',
    marginTop: 2,
    fontSize: 8,
    textAlign: 'right',
  },
  pearlLivePill: {
    minHeight: 27,
    paddingHorizontal: 9,
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
  },
  pearlLiveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  pearlLiveText: {
    fontSize: 8,
    fontWeight: '800',
  },
  officeSummaryCard: {
    height: 48,
    flex: 1,
    borderRadius: 0,
    borderWidth: 0,
    paddingHorizontal: 2,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeSummaryIcon: {
    width: 20,
    height: 20,
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeSummaryValue: {
    width: '100%',
    marginTop: 0,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  officeSummaryLabel: {
    width: '100%',
    marginTop: 0,
    fontSize: 8,
    fontWeight: '600',
    textAlign: 'center',
  },
  officeSummaryHint: {
    width: '100%',
    marginTop: 0,
    fontSize: 6,
    textAlign: 'center',
  },
  officeDashboardSplit: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 16,
  },
  officeDashboardCard: {
    flex: 1,
    minHeight: 112,
    borderRadius: 0,
    borderWidth: 0,
    padding: 0,
  },
  officeTodayCard: {
    flex: 1.15,
  },
  officeQuickCard: {
    flex: 0.9,
  },
  officeNetworkCard: {
    minHeight: 94,
    marginTop: 13,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  officeNetworkIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeNetworkCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeNetworkEyebrow: {
    width: '100%',
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeNetworkTitle: {
    width: '100%',
    marginTop: 2,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeNetworkText: {
    width: '100%',
    marginTop: 3,
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'right',
  },
  officeNetworkAction: {
    minWidth: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  officeNetworkCount: {
    fontSize: 10,
    fontWeight: '700',
  },
  officeQuickActions: {
    gap: 2,
  },
  officeQuickAction: {
    minHeight: 25,
    borderBottomWidth: 0,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  officeQuickActionIcon: {
    width: 18,
    height: 18,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeQuickActionText: {
    flex: 1,
    fontSize: 8,
    fontWeight: '600',
    textAlign: 'right',
  },
  officeAttentionCard: {
    minHeight: 58,
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  officeAttentionIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeAttentionCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeAttentionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeAttentionText: {
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
  },
  officeAttentionAction: {
    minWidth: 42,
    minHeight: 30,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeAttentionActionText: {
    fontSize: 11,
    fontWeight: '700',
  },
  officeChatPanel: {
    marginTop: 18,
    borderRadius: 19,
    borderWidth: 1,
    padding: 12,
  },
  officeChatHeading: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  officeChatIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeChatHeadingCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeChatTitle: {
    width: '100%',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeChatHint: {
    width: '100%',
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
  },
  officeChatReply: {
    marginTop: 9,
  },
  officeChatTyping: {
    marginTop: 9,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 7,
  },
  officeChatTypingText: {
    fontSize: 11,
  },
  officeChatComposer: {
    minHeight: 48,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingLeft: 6,
    paddingRight: 10,
    flexDirection: 'row-reverse',
    alignItems: 'flex-end',
  },
  officeChatInput: {
    flex: 1,
    maxHeight: 76,
    paddingTop: 10,
    paddingBottom: 9,
    paddingHorizontal: 4,
    fontSize: 13,
    lineHeight: 20,
  },
  officeChatSend: {
    width: 32,
    height: 32,
    marginBottom: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeChatFooter: {
    paddingTop: 6,
    fontSize: 9,
    textAlign: 'center',
  },
  officeError: {
    marginTop: 15,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  officeErrorText: {
    flex: 1,
    fontSize: 12,
    textAlign: 'right',
  },
  officeLoading: {
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  officePulse: {
    minHeight: 84,
    marginTop: 18,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 8,
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  officePulseItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officePulseValue: {
    fontSize: 21,
    fontWeight: '700',
  },
  officePulseLabel: {
    marginTop: 3,
    fontSize: 10,
    textAlign: 'center',
  },
  officePulseDivider: {
    width: StyleSheet.hairlineWidth,
    height: 36,
  },
  officeSection: {
    marginTop: 8,
  },
  officeSectionHeading: {
    marginBottom: 5,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  officeSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeSectionHint: {
    marginTop: 3,
    fontSize: 11,
    textAlign: 'right',
  },
  officeRecentViewAll: {
    fontSize: 10,
    fontWeight: '700',
  },
  officeRecentHeadingActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  officeRecentSearchButton: {
    width: 28,
    height: 28,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeSearchBox: {
    minHeight: 44,
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 11,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  officeSearchInput: {
    flex: 1,
    minHeight: 42,
    fontSize: 12,
    textAlign: 'right',
  },
  officeRecentActivityScroll: {
    maxHeight: 90,
    marginTop: 3,
    borderRadius: 0,
  },
  officeRecentActivityContent: {
    gap: 4,
    paddingBottom: 2,
  },
  officeRecentActivityRow: {
    minHeight: 28,
    borderRadius: 0,
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 2,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  officeRecentActivityIcon: {
    width: 21,
    height: 21,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeRecentActivityCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeRecentActivityTitle: {
    width: '100%',
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeRecentActivityPreview: {
    width: '100%',
    marginTop: 1,
    fontSize: 7,
    lineHeight: 10,
    textAlign: 'right',
  },
  officeRecentActivityMeta: {
    maxWidth: 72,
    fontSize: 7,
    fontWeight: '700',
    textAlign: 'left',
  },
  officeEmptyPanel: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 13,
    justifyContent: 'center',
  },
  officeConversationRail: {
    gap: 9,
    paddingVertical: 2,
  },
  officeConversationCard: {
    width: 178,
    minHeight: 156,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    alignItems: 'flex-end',
  },
  officeConversationIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeConversationTitle: {
    width: '100%',
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    textAlign: 'right',
  },
  officeConversationPreview: {
    width: '100%',
    flex: 1,
    marginTop: 5,
    fontSize: 10,
    lineHeight: 16,
    textAlign: 'right',
  },
  officeConversationMeta: {
    width: '100%',
    marginTop: 8,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeRecentEditList: {
    gap: 8,
  },
  officeRecentEditRow: {
    minHeight: 60,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  officeRecentEditIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeRecentEditCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeRecentEditTitle: {
    width: '100%',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeRecentEditMeta: {
    width: '100%',
    marginTop: 3,
    fontSize: 10,
    textAlign: 'right',
  },
  officeRecentEditTrailing: {
    maxWidth: 82,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'left',
  },
  officeCalm: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 13,
    justifyContent: 'center',
  },
  officeCalmText: {
    fontSize: 12,
    textAlign: 'right',
  },
  officeActionList: {
    gap: 8,
  },
  officeActionRow: {
    minHeight: 60,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  officeActionIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeActionCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeActionTitle: {
    width: '100%',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  officeActionMeta: {
    width: '100%',
    marginTop: 3,
    fontSize: 10,
    textAlign: 'right',
  },
  officeTodayList: {
    borderTopWidth: 0,
  },
  officeTodayRow: {
    minHeight: 25,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
  },
  officeTodayMarker: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  officeTodayTime: {
    minWidth: 58,
    fontSize: 8,
    textAlign: 'right',
  },
  officeTodayText: {
    flex: 1,
    fontSize: 9,
    textAlign: 'right',
  },
  officeActivityList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  officeActivityRow: {
    minHeight: 61,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  officeActivityCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeActivityTitle: {
    width: '100%',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  officeActivityMeta: {
    width: '100%',
    marginTop: 3,
    fontSize: 10,
    textAlign: 'right',
  },
  officeActivityAmount: {
    maxWidth: 92,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'left',
  },
  officeEmptyLine: {
    paddingVertical: 13,
    fontSize: 12,
    textAlign: 'right',
  },
  officeFinancialRow: {
    minHeight: 72,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  officeFinancialCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeFinancialTitle: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeFinancialMeta: {
    marginTop: 3,
    fontSize: 10,
    textAlign: 'right',
  },
  officeInlineAction: {
    minHeight: 34,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 9,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
  },
  officeInlineActionText: {
    fontSize: 10,
    fontWeight: '700',
  },
  officeExpandedPanel: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingBottom: 5,
  },
  officeExpandedTitle: {
    paddingTop: 11,
    paddingBottom: 3,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeMoreLink: {
    paddingVertical: 12,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeEntityRail: {
    gap: 9,
    paddingVertical: 2,
  },
  officeEntityTile: {
    width: 128,
    minHeight: 111,
    borderRadius: 16,
    borderWidth: 1,
    padding: 11,
    alignItems: 'flex-end',
  },
  officeEntityIcon: {
    width: 29,
    height: 29,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeEntityName: {
    width: '100%',
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeEntityMeta: {
    width: '100%',
    marginTop: 3,
    fontSize: 10,
    textAlign: 'right',
  },
  officeSuggestions: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  officeSuggestionRow: {
    minHeight: 57,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  officeSuggestionCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeSuggestionLabel: {
    width: '100%',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  officeSuggestionDraft: {
    width: '100%',
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
  },
  officeExploreButton: {
    minHeight: 50,
    marginTop: 27,
    borderRadius: 16,
    paddingHorizontal: 15,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  officeExploreText: {
    fontSize: 13,
    fontWeight: '700',
  },
  bottomBar: {
    position: 'absolute',
    right: 15,
    bottom: 17,
    left: 15,
    zIndex: 4,
    minHeight: 0,
    paddingHorizontal: 7,
    paddingTop: 8,
    paddingBottom: 8,
    borderWidth: 1,
    borderRadius: 19,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  bottomBarItem: {
    minWidth: 52,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  bottomBarIcon: {
    width: 29,
    height: 25,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBarLabel: {
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
  },
  bottomBarDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    marginTop: 1,
  },
  detailScreen: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  detailHeader: {
    minHeight: 42,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailEyebrow: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  detailCard: {
    marginTop: 14,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    alignItems: 'flex-end',
  },
  detailIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailTitle: {
    width: '100%',
    marginTop: 16,
    fontSize: 21,
    fontWeight: '700',
    lineHeight: 29,
    textAlign: 'right',
  },
  detailSubtitle: {
    width: '100%',
    marginTop: 7,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'right',
  },
  detailMeta: {
    width: '100%',
    marginTop: 8,
    fontSize: 12,
    textAlign: 'right',
  },
  detailValue: {
    marginTop: 14,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
  },
  detailState: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  detailStateText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  detailRetry: {
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  relatedCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 13,
  },
  relatedTitle: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  relatedRow: {
    minHeight: 42,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  relatedLabel: {
    fontSize: 12,
    textAlign: 'right',
  },
  relatedCount: {
    fontSize: 13,
    fontWeight: '700',
  },
  detailContext: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 9,
  },
  detailContextCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  detailContextTitle: {
    width: '100%',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  detailContextText: {
    width: '100%',
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  detailPrimaryAction: {
    minHeight: 48,
    marginTop: 18,
    borderRadius: 15,
    paddingHorizontal: 16,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  detailPrimaryActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  messageRow: {
    width: '100%',
    marginBottom: 12,
  },
  userRow: {
    alignItems: 'flex-start',
  },
  assistantRow: {
    alignItems: 'flex-end',
  },
  messageBubble: {
    maxWidth: '88%',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 9,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'right',
  },
  messageTime: {
    marginTop: 5,
    fontSize: 10,
    textAlign: 'right',
    opacity: 0.78,
  },
  approvalCard: {
    marginTop: 10,
    borderRadius: 15,
    borderWidth: 1,
    padding: 10,
  },
  approvalHeading: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 7,
  },
  approvalTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  approvalDetail: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  approvalActions: {
    flexDirection: 'row-reverse',
    gap: 8,
    marginTop: 11,
  },
  approveButton: {
    minHeight: 38,
    flex: 1,
    borderRadius: 11,
    paddingHorizontal: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  approveText: {
    fontSize: 12,
    fontWeight: '700',
  },
  rejectButton: {
    minHeight: 38,
    flex: 1,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  rejectText: {
    fontSize: 12,
    fontWeight: '600',
  },
  resolvedRow: {
    marginTop: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  resolvedText: {
    fontSize: 12,
    fontWeight: '600',
  },
  messageLink: {
    minHeight: 36,
    marginTop: 10,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 11,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    gap: 6,
  },
  messageLinkText: {
    fontSize: 12,
    fontWeight: '700',
  },
  typingRow: {
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  typingBubble: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  typingText: {
    fontSize: 12,
  },
  suggestionsBlock: {
    marginTop: 24,
    marginBottom: 18,
    alignItems: 'flex-end',
  },
  suggestionsLabel: {
    marginBottom: 9,
    fontSize: 12,
    textAlign: 'right',
  },
  suggestions: {
    width: '100%',
    gap: 8,
    alignItems: 'flex-end',
  },
  suggestionChip: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  suggestionText: {
    fontSize: 13,
    textAlign: 'right',
  },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 7,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    textAlign: 'right',
  },
  errorRetry: {
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerWrap: {
    paddingHorizontal: 14,
    paddingTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composer: {
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    paddingLeft: 7,
    paddingRight: 12,
    flexDirection: 'row-reverse',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    maxHeight: 88,
    paddingTop: 12,
    paddingBottom: 11,
    paddingHorizontal: 4,
    fontSize: 15,
    lineHeight: 22,
  },
  sendButton: {
    width: 36,
    height: 36,
    marginBottom: 7,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerHint: {
    paddingTop: 7,
    paddingBottom: 1,
    fontSize: 10,
    textAlign: 'center',
  },
});