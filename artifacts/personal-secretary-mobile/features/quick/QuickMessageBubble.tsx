import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type { Approval, LocalMessage, MobileRecordRow } from './quick-model';
import { starterMessage, styles } from './quick-model';

function messageTime(value: string) {
  if (value === starterMessage.createdAt) return 'الآن';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'الآن';
  return new Intl.DateTimeFormat('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function QuickMessageBubble({
  message,
  colors,
  onApprove,
  onReject,
  onOpenMain,
  onOpenRecord,
  busyOperationId,
}: {
  message: LocalMessage;
  colors: ReturnType<typeof useColors>;
  onApprove: (approval: Approval) => void;
  onReject: (approval: Approval) => void;
  onOpenMain?: () => void;
  onOpenRecord: (record: MobileRecordRow) => void;
  busyOperationId: string | null;
}) {
  const isUser = message.role === 'user';
  const approval = message.approval;
  const approvalBusy = approval && busyOperationId === approval.operationId;
  const isResolved = approval?.status === 'completed'
    || approval?.status === 'rejected'
    || approval?.status === 'expired'
    || approval?.status === 'failed';
  const canQuickApprove = approval?.status === 'pending' && approval.quickApprove === true;

  return (
    <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
      <View style={[styles.messageBubble, {
        backgroundColor: isUser ? colors.primary : colors.card,
        borderColor: isUser ? colors.primary : colors.border,
      }]}>
        <Text style={[styles.messageText, { color: isUser ? colors.primaryForeground : colors.foreground }]}>
          {message.text}
        </Text>
        <Text style={[styles.messageTime, { color: isUser ? colors.primaryForeground : colors.mutedForeground }]}>
          {messageTime(message.createdAt)}
        </Text>

        {approval && (
          <View style={[styles.approvalCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <View style={styles.approvalHeading}>
              <Feather name="shield" size={15} color={colors.primary} />
              <Text style={[styles.approvalTitle, { color: colors.foreground }]}>{approval.title}</Text>
            </View>
            {approval.details.map((detail) => (
              <Text key={detail} style={[styles.approvalDetail, { color: colors.mutedForeground }]}>
                {detail}
              </Text>
            ))}

            {isResolved ? (
              <View style={styles.resolvedRow}>
                <Feather
                  name={approval.status === 'completed' ? 'check-circle' : 'x-circle'}
                  size={15}
                  color={approval.status === 'completed' ? colors.primary : colors.destructive}
                />
                <Text style={[styles.resolvedText, { color: colors.mutedForeground }]}>
                  {approval.status === 'completed' ? 'تم التنفيذ' : 'تم الرفض'}
                </Text>
              </View>
            ) : (
              <View style={styles.approvalActions}>
                {canQuickApprove ? (
                  <Pressable
                    testID={`quick-approve-${approval.operationId}`}
                    accessibilityRole="button"
                    accessibilityLabel="اعتماد العملية سريعًا"
                    onPress={() => onApprove(approval)}
                    disabled={Boolean(approvalBusy)}
                    style={({ pressed }) => [
                      styles.approveButton,
                      { backgroundColor: colors.primary, opacity: pressed || approvalBusy ? 0.65 : 1 },
                    ]}
                  >
                    {approvalBusy
                      ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                      : <Feather name="check" size={16} color={colors.primaryForeground} />}
                    <Text style={[styles.approveText, { color: colors.primaryForeground }]}>اعتماد</Text>
                  </Pressable>
                ) : onOpenMain ? (
                  <Pressable
                    testID={`open-main-review-${approval.operationId}`}
                    accessibilityRole="button"
                    accessibilityLabel="مراجعة العملية في البرنامج الرئيسي"
                    onPress={onOpenMain}
                    disabled={Boolean(approvalBusy)}
                    style={({ pressed }) => [
                      styles.approveButton,
                      { backgroundColor: colors.primary, opacity: pressed || approvalBusy ? 0.65 : 1 },
                    ]}
                  >
                    <Feather name="arrow-up-left" size={16} color={colors.primaryForeground} />
                    <Text style={[styles.approveText, { color: colors.primaryForeground }]}>مراجعة في Main</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  testID={`reject-${approval.operationId}`}
                  accessibilityRole="button"
                  accessibilityLabel="رفض العملية"
                  onPress={() => onReject(approval)}
                  disabled={Boolean(approvalBusy)}
                  style={({ pressed }) => [
                    styles.rejectButton,
                    { borderColor: colors.border, opacity: pressed || approvalBusy ? 0.65 : 1 },
                  ]}
                >
                  <Feather name="x" size={16} color={colors.mutedForeground} />
                  <Text style={[styles.rejectText, { color: colors.mutedForeground }]}>رفض</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {message.recordLink && (
          <Pressable
            testID={`open-record-${message.recordLink.recordType}-${message.recordLink.id}`}
            accessibilityRole="button"
            accessibilityLabel={`فتح تفاصيل ${message.recordLink.title}`}
            onPress={() => onOpenRecord(message.recordLink as MobileRecordRow)}
            style={({ pressed }) => [styles.messageLink, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
          >
            <Feather name="arrow-up-left" size={15} color={colors.primary} />
            <Text style={[styles.messageLinkText, { color: colors.primary }]}>فتح التفاصيل</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}