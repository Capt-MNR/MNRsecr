import { StyleSheet } from 'react-native';
import type { AppLanguage } from '@/hooks/useLanguage';
import type { SecretaryChatContext } from '../../services/secretary-chat';

export type ApprovalStatus = 'pending' | 'executing' | 'completed' | 'rejected' | 'expired' | 'failed';
export type Approval = {
  operationId: string;
  title: string;
  details: string[];
  status: ApprovalStatus;
  quickApprove?: boolean;
  initialArgs?: Record<string, unknown>;
  personCandidates?: Array<{ id: string; name: string; status?: string }>;
  projectCandidates?: Array<{ id: string; name: string; status?: string }>;
};
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
export type LocalMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  createdAt: string;
  turnId?: string;
  approval?: Approval;
  recordLink?: MobileRecordRow;
};

export const STORAGE_MESSAGES = '@personal-secretary-mobile/messages';
export const STORAGE_CONVERSATION = '@personal-secretary-mobile/conversation';
export const starterMessage: LocalMessage = {
  id: 'welcome',
  role: 'assistant',
  text: 'أنا جاهز للطلبات السريعة. اسألني عن يومك، سجّل مصروفًا، أو اطلب تذكيرًا.',
  createdAt: new Date(0).toISOString(),
};
export const suggestions = ['إيه عندي النهارده؟', 'فكرني بكرة أكلم محمد', 'محمد أخد مني كام؟'];

export function localized(language: AppLanguage, arabic: string, english: string) {
  return language === 'en' ? english : arabic;
}
export function objectValue(value: unknown): Record<string, unknown> {
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

export function approvalFromAction(action: unknown): Approval | undefined {
  const value = objectValue(action);
  if (!['approval_required', 'pending_confirmation'].includes(String(value.type)) || typeof value.operationId !== 'string') return undefined;
  const display = objectValue(value.display);
  const args = objectValue(value.args);
  const candidates = (input: unknown) => Array.isArray(input)
    ? input.filter((item): item is { id: string; name: string } => Boolean(item) && typeof item === 'object' && typeof objectValue(item).id === 'string' && typeof objectValue(item).name === 'string')
    : undefined;
  const status = typeof value.status === 'string' && ['pending', 'executing', 'completed', 'rejected', 'expired', 'failed'].includes(value.status)
    ? value.status as ApprovalStatus
    : 'pending';
  return {
    operationId: value.operationId,
    title: typeof display.title === 'string' ? display.title : 'تأكيد العملية',
    details: Array.isArray(display.details) ? display.details.filter((item): item is string => typeof item === 'string') : [],
    status,
    ...(value.quickApprove === true ? { quickApprove: true } : {}),
    ...(Object.keys(args).length ? { initialArgs: args } : {}),
    ...(candidates(value.personCandidates ?? args.personCandidates) ? { personCandidates: candidates(value.personCandidates ?? args.personCandidates) } : {}),
    ...(candidates(value.projectCandidates ?? args.projectCandidates) ? { projectCandidates: candidates(value.projectCandidates ?? args.projectCandidates) } : {}),
  };
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
export function addOrigin(record: MobileRecordRow, conversationId: string, operationId?: string | null, turnId?: string | null) {
  return { ...record, origin: { conversationId, turnId: turnId ?? null, operationId: operationId ?? null } };
}
export function secretaryContextFromRecord(record: MobileRecordRow): SecretaryChatContext {
  return { recordType: record.recordType, recordId: record.id, title: record.title, sourceConversationId: record.origin?.conversationId ?? null, sourceTurnId: record.origin?.turnId ?? null, sourceOperationId: record.origin?.operationId ?? null };
}
export function messagesFromConversation(detail: unknown, conversationId: string): LocalMessage[] {
  const turns = Array.isArray(objectValue(detail).recentTurns) ? objectValue(detail).recentTurns as unknown[] : [];
  const result: LocalMessage[] = [];
  turns.forEach((raw, index) => {
    const turn = objectValue(raw);
    const turnId = typeof turn.turnId === 'string' ? turn.turnId : `turn-${index}`;
    const createdAt = typeof turn.createdAt === 'string' ? turn.createdAt : new Date().toISOString();
    const action = Object.keys(objectValue(turn.action)).length ? objectValue(turn.action) : undefined;
    const link = action && recordLinkFromAction(action);
    if (typeof turn.userMessage === 'string') result.push({ id: `${conversationId}-${turnId}-user`, role: 'user', text: turn.userMessage, createdAt });
    if (typeof turn.assistantMessage === 'string') result.push({ id: `${conversationId}-${turnId}-assistant`, role: 'assistant', text: turn.assistantMessage, createdAt, approval: action ? approvalFromAction(action) : undefined, ...(link ? { recordLink: addOrigin(link, conversationId, typeof action?.operationId === 'string' ? action.operationId : null) } : {}) });
  });
  return result.length ? result : [starterMessage];
}

export const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { minHeight: 116, paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTop: { minHeight: 46, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  brandBlock: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }, brandMark: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  brandName: { fontSize: 17, fontWeight: '700', textAlign: 'right' }, availability: { marginTop: 2, flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 }, availabilityText: { fontSize: 11, textAlign: 'right' },
  iconButton: { width: 38, height: 38, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' }, messageList: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 16 },
  quickHero: { marginBottom: 14, borderRadius: 22, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 22, alignItems: 'center' },
  quickHeroMark: { width: 54, height: 54, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, quickHeroTitle: { marginTop: 12, fontSize: 19, fontWeight: '700', textAlign: 'center' },
  quickHeroText: { maxWidth: 290, marginTop: 6, fontSize: 11, lineHeight: 18, textAlign: 'center' }, suggestionsBlock: { marginTop: 4 }, suggestionsLabel: { marginBottom: 8, fontSize: 12, textAlign: 'right' },
  suggestions: { gap: 8 }, suggestionChip: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 }, suggestionText: { fontSize: 12, textAlign: 'right' },
  typingRow: { paddingVertical: 8, alignItems: 'flex-end' }, typingBubble: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }, typingText: { fontSize: 11 },
  composerWrap: { paddingHorizontal: 14, paddingTop: 8 }, composer: { flexDirection: 'row-reverse', alignItems: 'flex-end', borderRadius: 18, borderWidth: 1, paddingHorizontal: 8 }, input: { flex: 1, minHeight: 42, maxHeight: 110, paddingVertical: 10, paddingHorizontal: 4, fontSize: 15, lineHeight: 22 }, sendButton: { width: 36, height: 36, marginBottom: 7, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  composerHint: { paddingTop: 7, paddingBottom: 1, fontSize: 10, textAlign: 'center' }, errorBanner: { marginHorizontal: 14, marginBottom: 8, borderRadius: 12, borderWidth: 1, padding: 10 }, errorText: { fontSize: 12, textAlign: 'right' }, errorRetry: { marginTop: 5, fontSize: 11, fontWeight: '700', textAlign: 'right' },
  messageRow: { width: '100%', marginBottom: 12 }, userRow: { alignItems: 'flex-start' }, assistantRow: { alignItems: 'flex-end' },
  messageBubble: { maxWidth: '88%', borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 9 },
  messageText: { fontSize: 15, lineHeight: 24, textAlign: 'right' }, messageTime: { marginTop: 5, fontSize: 10, textAlign: 'right', opacity: 0.78 },
  approvalCard: { marginTop: 10, borderRadius: 15, borderWidth: 1, padding: 10 }, approvalHeading: { flexDirection: 'row-reverse', alignItems: 'center', gap: 7 },
  approvalTitle: { flex: 1, fontSize: 13, fontWeight: '700', textAlign: 'right' }, approvalDetail: { marginTop: 5, fontSize: 12, lineHeight: 18, textAlign: 'right' },
  approvalActions: { flexDirection: 'row-reverse', gap: 8, marginTop: 11 }, approveButton: { minHeight: 38, flex: 1, borderRadius: 11, paddingHorizontal: 12, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6 },
  approveText: { fontSize: 12, fontWeight: '700' }, rejectButton: { minHeight: 38, flex: 1, borderRadius: 11, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6 },
  rejectText: { fontSize: 12, fontWeight: '600' }, resolvedRow: { marginTop: 10, flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }, resolvedText: { fontSize: 12, fontWeight: '600' },
  messageLink: { minHeight: 36, marginTop: 10, borderRadius: 11, borderWidth: 1, paddingHorizontal: 11, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end', gap: 6 },
  messageLinkText: { fontSize: 12, fontWeight: '700' },
});