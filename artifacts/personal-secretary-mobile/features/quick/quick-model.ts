import { StyleSheet } from 'react-native';
import type { AppLanguage } from '@/hooks/useLanguage';
import type { LocalInputAttachment } from '../../services/local-input-assets';
import {
  addOrigin,
  recordLinkFromAction,
  secretaryContextFromRecord,
  type MobileRecordRow,
  type RecordOrigin,
} from './quick-provenance';

export {
  addOrigin,
  recordLinkFromAction,
  secretaryContextFromRecord,
} from './quick-provenance';
export type { MobileRecordRow, RecordOrigin } from './quick-provenance';

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

export function approvalsFromAction(action: unknown): Approval[] {
  const value = objectValue(action);
  if (!['approval_required', 'pending_confirmation'].includes(String(value.type))) return [];
  const rawApprovals = Array.isArray(value.approvals) ? value.approvals : [value];
  return rawApprovals.flatMap((raw) => {
    const item = objectValue(raw);
    return approvalFromAction({ ...value, ...item }) ?? [];
  });
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
    const inputId = typeof turn.inputId === 'string' ? turn.inputId : undefined;
    if (typeof turn.userMessage === 'string') result.push({ id: `${conversationId}-${turnId}-user`, role: 'user', text: turn.userMessage, createdAt, ...(inputId ? { inputId } : {}) });
    if (typeof turn.assistantMessage === 'string') {
      const approvals = action ? approvalsFromAction(action) : [];
      result.push({
        id: `${conversationId}-${turnId}-assistant`,
        role: 'assistant',
        text: turn.assistantMessage,
        createdAt,
        ...(approvals.length > 0 ? { approval: approvals[0], ...(approvals.length > 1 ? { approvals } : {}) } : {}),
        ...(link ? { recordLink: addOrigin(link, conversationId, typeof action?.operationId === 'string' ? action.operationId : null) } : {}),
      });
    }
  });
  return result.length ? result : [starterMessage];
}

export const styles = StyleSheet.create({
  screen: { flex: 1 }, quickBackground: { ...StyleSheet.absoluteFill }, header: { minHeight: 62, paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 2 },
  headerTop: { minHeight: 44, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  brandBlock: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }, brandMark: { width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  brandCopy: { alignItems: 'flex-end' }, brandEyebrow: { marginBottom: 1, fontSize: 8, fontWeight: '700', letterSpacing: 0.8, textAlign: 'right' },
  brandName: { fontSize: 17, fontWeight: '700', textAlign: 'right' }, availability: { marginTop: 2, flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 }, availabilityText: { fontSize: 10, textAlign: 'right' },
  iconButton: { width: 38, height: 38, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  quickHeaderTitle: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 }, quickHeaderMark: { width: 30, height: 30, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, headerSideBalance: { width: 38 },
  headerActions: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' }, messageList: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  quickWelcome: { alignItems: 'center', paddingTop: 28, paddingHorizontal: 4, paddingBottom: 10 },
  quickWelcomeMark: { width: 48, height: 48, marginBottom: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  quickWelcomeTitle: { maxWidth: 310, fontSize: 22, lineHeight: 30, fontWeight: '700', textAlign: 'center' },
  quickWelcomeText: { maxWidth: 300, marginTop: 7, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  quickHero: { marginBottom: 16, borderRadius: 25, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 16 },
  quickHeroTop: { flexDirection: 'row-reverse', alignItems: 'center', gap: 11 }, quickHeroCopy: { flex: 1, alignItems: 'flex-end' },
  quickHeroMark: { width: 48, height: 48, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  quickHeroEyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 0.7, textAlign: 'right' }, quickHeroTitle: { marginTop: 3, fontSize: 18, fontWeight: '800', textAlign: 'right' },
  quickHeroText: { width: '100%', marginTop: 13, fontSize: 11, lineHeight: 18, textAlign: 'right' },
  quickHeroStatus: { marginTop: 13, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  quickHeroStatusDot: { width: 6, height: 6, borderRadius: 3 }, quickHeroStatusText: { flex: 1, fontSize: 9, textAlign: 'right' }, quickHeroStatusMode: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  suggestionsBlock: { width: '100%', marginTop: 27 }, suggestionsLabel: { marginBottom: 9, fontSize: 11, fontWeight: '700', textAlign: 'right' },
  suggestions: { gap: 8 }, suggestionChip: { minHeight: 49, borderRadius: 16, borderWidth: 1, paddingHorizontal: 10, flexDirection: 'row-reverse', alignItems: 'center', gap: 9 },
  suggestionIcon: { width: 29, height: 29, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, suggestionText: { flex: 1, fontSize: 12, fontWeight: '600', textAlign: 'right' },
  typingRow: { paddingVertical: 8, alignItems: 'flex-end' }, typingBubble: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }, typingText: { fontSize: 11 },
  composerWrap: { paddingHorizontal: 14, paddingTop: 8 }, composer: { flexDirection: 'row-reverse', alignItems: 'flex-end', borderRadius: 21, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 }, input: { flex: 1, minHeight: 42, maxHeight: 110, paddingVertical: 10, paddingHorizontal: 4, fontSize: 15, lineHeight: 22 }, sendButton: { width: 37, height: 37, marginBottom: 4, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, inputActions: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }, inputAction: { width: 29, height: 29, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, inputReview: { flexDirection: 'row-reverse', alignItems: 'center', gap: 7, borderWidth: 1, borderRadius: 13, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 6 }, inputReviewText: { flex: 1, fontSize: 10, lineHeight: 15, textAlign: 'right' },
  composerHint: { paddingTop: 7, paddingBottom: 1, fontSize: 9, textAlign: 'center' }, errorBanner: { marginHorizontal: 14, marginBottom: 8, borderRadius: 12, borderWidth: 1, padding: 10, flexDirection: 'row-reverse', alignItems: 'center', gap: 7 }, errorText: { flex: 1, fontSize: 12, textAlign: 'right' }, errorRetry: { marginTop: 5, fontSize: 11, fontWeight: '700', textAlign: 'right' }, errorRetryButton: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.65)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 }, errorRetryText: { fontSize: 11, fontWeight: '700' },
  messageRow: { width: '100%', marginBottom: 12 }, userRow: { alignItems: 'flex-start' }, assistantRow: { alignItems: 'flex-end' },
  messageBubble: { maxWidth: '92%', borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 9 },
  userMessageBubble: { borderRadius: 21, paddingHorizontal: 15, paddingTop: 10, paddingBottom: 8 },
  assistantMessageBubble: { maxWidth: '100%', borderWidth: 0, borderRadius: 0, paddingHorizontal: 0, paddingTop: 3, paddingBottom: 3 },
  messageText: { fontSize: 15, lineHeight: 24, textAlign: 'right' }, messageTime: { marginTop: 5, fontSize: 10, textAlign: 'right', opacity: 0.78 },
  approvalCard: { marginTop: 10, borderRadius: 15, borderWidth: 1, padding: 10 }, approvalHeading: { flexDirection: 'row-reverse', alignItems: 'center', gap: 7 },
  approvalTitle: { flex: 1, fontSize: 13, fontWeight: '700', textAlign: 'right' }, approvalDetail: { marginTop: 5, fontSize: 12, lineHeight: 18, textAlign: 'right' },
  approvalActions: { flexDirection: 'row-reverse', gap: 8, marginTop: 11 }, approveButton: { minHeight: 38, flex: 1, borderRadius: 11, paddingHorizontal: 12, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6 },
  approveText: { fontSize: 12, fontWeight: '700' }, rejectButton: { minHeight: 38, flex: 1, borderRadius: 11, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6 },
  rejectText: { fontSize: 12, fontWeight: '600' }, resolvedRow: { marginTop: 10, flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }, resolvedText: { fontSize: 12, fontWeight: '600' },
  messageLink: { minHeight: 36, marginTop: 10, borderRadius: 11, borderWidth: 1, paddingHorizontal: 11, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end', gap: 6 },
  messageLinkText: { fontSize: 12, fontWeight: '700' },
});