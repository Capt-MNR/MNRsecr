import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type { AppLanguage } from '@/hooks/useLanguage';
import type { Approval, LocalMessage, MobileRecordRow } from './quick-model';
import { localized, starterMessage, styles } from './quick-model';
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
  onOpenMain?: () => void;
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
      <View style={[styles.messageBubble, {
        backgroundColor: isUser ? colors.primary : colors.card,
        borderColor: isUser ? colors.primary : colors.border,
      }]}>
        <Text style={[styles.messageText, { color: isUser ? colors.primaryForeground : colors.foreground, textAlign: isRtl ? 'right' : 'left', writingDirection: isRtl ? 'rtl' : 'ltr' }]}>
          {message.text}
        </Text>
        {message.inputAttachment && (
          <LocalInputAttachmentView
            attachment={message.inputAttachment}
            onRetry={onRetryInput ? () => onRetryInput(message.inputAttachment) : undefined}
            retrying={retryingInput}
          />
        )}
        <Text style={[styles.messageTime, { color: isUser ? colors.primaryForeground : colors.mutedForeground, textAlign: isRtl ? 'right' : 'left' }]}>
          {messageTime(message.createdAt, language)}
        </Text>

        {approvals.map((approval) => {
          const approvalBusy = busyOperationId === approval.operationId;
          const isResolved = approval.status === 'completed'
            || approval.status === 'rejected'
            || approval.status === 'expired'
            || approval.status === 'failed';
          const canQuickApprove = approval.status === 'pending' && approval.quickApprove === true;
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

            {isResolved ? (
              <View style={[styles.resolvedRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                <Feather
                  name={approval.status === 'completed' ? 'check-circle' : 'x-circle'}
                  size={15}
                  color={approval.status === 'completed' ? colors.primary : colors.destructive}
                />
                <Text style={[styles.resolvedText, { color: colors.mutedForeground }]}>
                  {approval.status === 'completed'
                    ? localized(language, 'تم التنفيذ', 'Completed')
                    : approval.status === 'failed'
                      ? localized(language, 'تعذر التنفيذ', 'Failed')
                      : approval.status === 'expired'
                        ? localized(language, 'انتهت صلاحية العملية', 'Expired')
                        : localized(language, 'تم الرفض', 'Rejected')}
                </Text>
              </View>
            ) : (
              <View style={[styles.approvalActions, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                {canQuickApprove ? (
                  <Pressable
                    testID={`quick-approve-${approval.operationId}`}
                    accessibilityRole="button"
                      accessibilityLabel={localized(language, 'اعتماد العملية سريعًا', 'Approve this action')}
                    onPress={() => onApprove(approval)}
                    disabled={Boolean(approvalBusy)}
                      style={({ pressed }) => [
                      styles.approveButton,
                        { backgroundColor: colors.primary, opacity: pressed || approvalBusy ? 0.65 : 1, flexDirection: isRtl ? 'row-reverse' : 'row' },
                    ]}
                  >
                    {approvalBusy
                      ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                      : <Feather name="check" size={16} color={colors.primaryForeground} />}
                    <Text style={[styles.approveText, { color: colors.primaryForeground }]}>{localized(language, 'اعتماد', 'Approve')}</Text>
                  </Pressable>
                ) : onOpenMain ? (
                  <Pressable
                    testID={`open-main-review-${approval.operationId}`}
                    accessibilityRole="button"
                    accessibilityLabel={localized(language, 'مراجعة العملية في البرنامج الرئيسي', 'Review this action in Main')}
                    onPress={onOpenMain}
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
                  disabled={Boolean(approvalBusy)}
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
        })}

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