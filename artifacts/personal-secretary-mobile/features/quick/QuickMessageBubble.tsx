import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type { AppLanguage } from '@/hooks/useLanguage';
import { approvalExplanation } from '../../services/operation-presentation';
import type { Approval, LocalMessage, MobileRecordRow } from './quick-model';
import { localized, starterMessage, styles } from './quick-model';
import { OperationStatusNotice } from '../OperationStatusNotice';
import { ApprovalStatusGate } from '../ApprovalStatusGate';
import { LocalInputAttachmentView } from '../local-input-attachment';

function messageTime(value: string, language: AppLanguage) {
  if (value === starterMessage.createdAt) return localized(language, 'الآن', 'Now');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return localized(language, 'الآن', 'Now');
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function QuickMessageBubble({
  message,
  colors,
  language,
  onApprove,
  onReject,
  onOpenMain,
  onOpenRecord,
  onRetryInput,
  retryingInput = false,
  busyOperationId,
}: {
  message: LocalMessage;
  colors: ReturnType<typeof useColors>;
  language: AppLanguage;
  onApprove: (approval: Approval) => void;
  onReject: (approval: Approval) => void;
  onOpenMain?: (operationId?: string, stateHint?: 'unknown_result' | 'needs_review') => void;
  onOpenRecord: (record: MobileRecordRow) => void;
  onRetryInput?: (attachment: LocalMessage['inputAttachment']) => void;
  retryingInput?: boolean;
  busyOperationId: string | null;
}) {
  const isUser = message.role === 'user';
  const isRtl = language === 'ar';
  const approvals = message.approvals ?? (message.approval ? [message.approval] : []);

  return (
    <View style={[styles.messageRow, { alignItems: isUser === isRtl ? 'flex-start' : 'flex-end', direction: isRtl ? 'rtl' : 'ltr' }]}>
      <View style={[
        styles.messageBubble,
        isUser ? styles.userMessageBubble : styles.assistantMessageBubble,
        {
          backgroundColor: isUser ? colors.muted : 'transparent',
          borderColor: isUser ? colors.border : 'transparent',
        },
      ]}>
        <Text style={[styles.messageText, { color: colors.foreground, textAlign: isRtl ? 'right' : 'left', writingDirection: isRtl ? 'rtl' : 'ltr' }]}>
          {message.text}
        </Text>
        {message.inputAttachment && (
          <LocalInputAttachmentView
            attachment={message.inputAttachment}
            onRetry={onRetryInput ? () => onRetryInput(message.inputAttachment) : undefined}
            retrying={retryingInput}
          />
        )}
        <Text style={[styles.messageTime, { color: colors.mutedForeground, textAlign: isRtl ? 'right' : 'left' }]}>
          {messageTime(message.createdAt, language)}
        </Text>

        {approvals.map((snapshotApproval) => (
          <ApprovalStatusGate
            key={snapshotApproval.operationId}
            approval={snapshotApproval}
            operationNotice={
              !message.operationNotice?.operationId
                || message.operationNotice.operationId === snapshotApproval.operationId
                ? message.operationNotice
                : undefined
            }
            colors={colors}
            language={language}
          >
          {({ approval, canRespond }) => {
          const approvalBusy = busyOperationId === approval.operationId;
          const noticeStatus = message.operationNotice?.operationId
            && message.operationNotice.operationId !== approval.operationId
            ? undefined
            : message.operationNotice?.status;
          const unknownOutcome = noticeStatus === 'unknown_result';
          const needsReview = noticeStatus === 'needs_review';
          const isExecuting = approval.status === 'executing'
            || noticeStatus === 'executing'
            || noticeStatus === 'verifying';
          const isWaiting = noticeStatus === 'waiting';
          const isResolved = ['completed', 'rejected', 'expired', 'failed'].includes(approval.status)
            || ['completed', 'rejected', 'expired', 'failed', 'unknown_result', 'needs_review', 'cancelled'].includes(noticeStatus ?? '')
            || isWaiting
            || isExecuting;
          const operationCompleted = approval.status === 'completed' || noticeStatus === 'completed';
          const operationRejected = approval.status === 'rejected' || noticeStatus === 'rejected';
          const operationExpired = approval.status === 'expired' || noticeStatus === 'expired';
          const operationFailed = approval.status === 'failed' || noticeStatus === 'failed';
          const operationCancelled = noticeStatus === 'cancelled';
          const canShowPending = approval.status === 'pending'
            && (!noticeStatus || noticeStatus === 'pending_approval');
          const canQuickApprove = canRespond && approval.status === 'pending' && approval.quickApprove === true;
          const explanation = approvalExplanation(approval.toolName, language);
          return (
          <View key={approval.operationId} style={[styles.approvalCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <View style={[styles.approvalHeading, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
              <Feather name="shield" size={15} color={colors.primary} />
              <Text style={[styles.approvalTitle, { color: colors.foreground, textAlign: isRtl ? 'right' : 'left' }]}>{approval.title}</Text>
            </View>
            {approval.details.map((detail) => (
              <Text key={detail} style={[styles.approvalDetail, { color: colors.mutedForeground, textAlign: isRtl ? 'right' : 'left' }]}>
                {detail}
              </Text>
            ))}
            {canShowPending && (
              <View style={{ marginTop: 8, paddingTop: 7, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={[styles.approvalDetail, { color: colors.foreground, fontWeight: '700', textAlign: isRtl ? 'right' : 'left' }]}>
                  {localized(language, 'محتاج موافقتك', 'Waiting for your approval')}
                </Text>
                <Text style={[styles.approvalDetail, { color: colors.mutedForeground, textAlign: isRtl ? 'right' : 'left' }]}>
                  {localized(language, `الجهة: ${explanation.service}`, `Service: ${explanation.service}`)}
                </Text>
                <Text style={[styles.approvalDetail, { color: colors.mutedForeground, textAlign: isRtl ? 'right' : 'left' }]}>{explanation.reason}</Text>
                <Text style={[styles.approvalDetail, { color: colors.mutedForeground, textAlign: isRtl ? 'right' : 'left' }]}>{explanation.afterApproval}</Text>
              </View>
            )}

            {isResolved || isExecuting ? (
              noticeStatus ? null : (
                <View style={[styles.resolvedRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                  <Feather
                    name={operationCompleted ? 'check-circle' : isExecuting ? 'loader' : unknownOutcome || needsReview ? 'alert-circle' : operationRejected ? 'x-circle' : 'alert-circle'}
                    size={15}
                    color={operationCompleted ? colors.primary : isExecuting || unknownOutcome || needsReview ? colors.accent : operationRejected ? colors.destructive : colors.mutedForeground}
                  />
                  <Text style={[styles.resolvedText, { color: colors.mutedForeground }]}>
                    {unknownOutcome
                      ? localized(language, 'النتيجة غير مؤكدة', 'Outcome is unknown')
                      : needsReview
                        ? localized(language, 'محتاج مراجعتك', 'Needs your review')
                        : isExecuting
                           ? localized(language, noticeStatus === 'verifying' ? 'جارٍ التحقق' : 'جارٍ التنفيذ', noticeStatus === 'verifying' ? 'Verifying' : 'Executing')
                          : operationCompleted
                            ? localized(language, 'تم التنفيذ ✓', 'Completed ✓')
                             : operationRejected
                               ? localized(language, 'تم رفض العملية', 'Operation rejected')
                               : operationFailed
                        ? localized(language, 'التنفيذ فشل', 'Execution failed')
                        : operationExpired
                          ? localized(language, 'انتهت صلاحية العملية', 'Expired')
                          : operationCancelled
                            ? localized(language, 'تم إلغاء العملية', 'Operation cancelled')
                            : isWaiting
                              ? localized(language, 'في انتظار الخطوة التالية', 'Waiting for the next step')
                            : localized(language, 'تم رفض العملية', 'Operation rejected')}
                  </Text>
                </View>
              )
            ) : (
              <View style={[styles.approvalActions, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                {canQuickApprove ? (
                  <Pressable
                    testID={`quick-approve-${approval.operationId}`}
                    accessibilityRole="button"
                      accessibilityLabel={localized(language, 'الموافقة على العملية سريعًا', 'Approve this action')}
                    onPress={() => onApprove(approval)}
                    disabled={Boolean(approvalBusy) || !canRespond}
                      style={({ pressed }) => [
                      styles.approveButton,
                        { backgroundColor: colors.primary, opacity: pressed || approvalBusy ? 0.65 : 1, flexDirection: isRtl ? 'row-reverse' : 'row' },
                    ]}
                  >
                    {approvalBusy
                      ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                      : <Feather name="check" size={16} color={colors.primaryForeground} />}
                    <Text style={[styles.approveText, { color: colors.primaryForeground }]}>{localized(language, 'موافقة', 'Approve')}</Text>
                  </Pressable>
                ) : onOpenMain ? (
                  <Pressable
                    testID={`open-main-review-${approval.operationId}`}
                    accessibilityRole="button"
                    accessibilityLabel={localized(language, 'مراجعة العملية في البرنامج الرئيسي', 'Review this action in Main')}
                    onPress={() => onOpenMain(approval.operationId)}
                    disabled={Boolean(approvalBusy)}
                      style={({ pressed }) => [
                      styles.approveButton,
                        { backgroundColor: colors.primary, opacity: pressed || approvalBusy ? 0.65 : 1, flexDirection: isRtl ? 'row-reverse' : 'row' },
                    ]}
                  >
                    <Feather name={isRtl ? 'arrow-up-left' : 'arrow-up-right'} size={16} color={colors.primaryForeground} />
                    <Text style={[styles.approveText, { color: colors.primaryForeground }]}>{localized(language, 'مراجعة في Main', 'Review in Main')}</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  testID={`reject-${approval.operationId}`}
                  accessibilityRole="button"
                  accessibilityLabel={localized(language, 'رفض العملية', 'Reject this action')}
                  onPress={() => onReject(approval)}
                  disabled={Boolean(approvalBusy) || !canRespond}
                  style={({ pressed }) => [
                    styles.rejectButton,
                    { borderColor: colors.border, opacity: pressed || approvalBusy ? 0.65 : 1, flexDirection: isRtl ? 'row-reverse' : 'row' },
                  ]}
                >
                  <Feather name="x" size={16} color={colors.mutedForeground} />
                  <Text style={[styles.rejectText, { color: colors.mutedForeground }]}>{localized(language, 'رفض', 'Reject')}</Text>
                </Pressable>
              </View>
            )}
          </View>
          );
          }}
          </ApprovalStatusGate>
        ))}
        {message.operationNotice && !(message.operationNotice.status === 'pending_approval' && approvals.length > 0) && (
          <>
            <OperationStatusNotice notice={message.operationNotice} colors={colors} language={language} />
            {onOpenMain
              && ['unknown_result', 'needs_review'].includes(message.operationNotice.status)
              && (message.operationNotice.operationId || approvals[0]?.operationId) && (
                <Pressable
                  testID={`quick-open-main-review-${message.operationNotice.operationId ?? approvals[0]?.operationId}`}
                  accessibilityRole="button"
                  accessibilityLabel={localized(language, 'فتح العملية في Main للمراجعة', 'Open operation in Main for review')}
                  onPress={() => onOpenMain(
                    message.operationNotice?.operationId ?? approvals[0]?.operationId,
                    message.operationNotice?.status === 'unknown_result' ? 'unknown_result' : 'needs_review',
                  )}
                  style={({ pressed }) => [
                    styles.messageLink,
                    {
                      borderColor: colors.border,
                      opacity: pressed ? 0.65 : 1,
                      flexDirection: isRtl ? 'row-reverse' : 'row',
                      alignSelf: isRtl ? 'flex-end' : 'flex-start',
                    },
                  ]}
                >
                  <Feather name={isRtl ? 'arrow-up-left' : 'arrow-up-right'} size={15} color={colors.primary} />
                  <Text style={[styles.messageLinkText, { color: colors.primary }]}>
                    {localized(language, 'فتح في Main للمراجعة', 'Review in Main')}
                  </Text>
                </Pressable>
              )}
          </>
        )}

        {message.recordLink && (
          <Pressable
            testID={`open-record-${message.recordLink.recordType}-${message.recordLink.id}`}
            accessibilityRole="button"
            accessibilityLabel={localized(language, `فتح تفاصيل ${message.recordLink.title}`, `Open details for ${message.recordLink.title}`)}
            onPress={() => onOpenRecord(message.recordLink as MobileRecordRow)}
            style={({ pressed }) => [styles.messageLink, { borderColor: colors.border, opacity: pressed ? 0.65 : 1, flexDirection: isRtl ? 'row-reverse' : 'row', alignSelf: isRtl ? 'flex-end' : 'flex-start' }]}
          >
            <Feather name={isRtl ? 'arrow-up-left' : 'arrow-up-right'} size={15} color={colors.primary} />
            <Text style={[styles.messageLinkText, { color: colors.primary }]}>{localized(language, 'فتح التفاصيل', 'Open details')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}