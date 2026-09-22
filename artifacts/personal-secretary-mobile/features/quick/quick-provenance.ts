import type { SecretaryChatContext } from '../../services/secretary-chat';

export type RecordOrigin = {
  conversationId: string;
  turnId?: string | null;
  operationId?: string | null;
};

export type MobileRecordRow = {
  id: string;
  recordType: string;
  title: string;
  subtitle: string;
  trailing?: string;
  origin?: RecordOrigin | null;
  related?: MobileRecordRow[];
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function recordDate(value?: string | null) {
  if (!value) return 'بدون موعد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(date);
}

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: currency || 'EGP', maximumFractionDigits: 0 }).format(amountMinor / 100);
}

export function recordLinkFromAction(action: unknown): MobileRecordRow | undefined {
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
      subtitle: [stringValue(value.personName, stringValue(value.projectName, '')), occurredAt ? recordDate(occurredAt) : ''].filter(Boolean).join(' · '),
      ...(amountMinor !== null ? { trailing: money(amountMinor, currency) } : {}),
    };
  }
  if (['person_created', 'person_linked', 'person_expense_total'].includes(type) && typeof value.personId === 'string') {
    return { id: value.personId, recordType: 'person', title: stringValue(value.personName, 'الشخص المرتبط'), subtitle: 'فتح تفاصيل الشخص' };
  }
  if (['project_created', 'project_people'].includes(type) && typeof value.projectId === 'string') {
    return { id: value.projectId, recordType: 'project', title: stringValue(value.projectName, 'المشروع المرتبط'), subtitle: 'فتح تفاصيل المشروع' };
  }
  if (type === 'reminder_created' && typeof value.reminderId === 'string') {
    return { id: value.reminderId, recordType: 'reminder', title: stringValue(value.text, 'تذكير محفوظ'), subtitle: typeof value.dueAt === 'string' ? recordDate(value.dueAt) : 'فتح تفاصيل التذكير' };
  }
  return undefined;
}

export function addOrigin(record: MobileRecordRow, conversationId: string, operationId?: string | null, turnId?: string | null): MobileRecordRow {
  return { ...record, origin: { conversationId, turnId: turnId ?? null, operationId: operationId ?? null } };
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