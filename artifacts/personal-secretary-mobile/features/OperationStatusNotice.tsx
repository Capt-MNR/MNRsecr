import { useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import type { useColors } from '@/hooks/useColors';
import type { AppLanguage } from '@/hooks/useLanguage';
import type { OperationNotice } from '../services/operation-presentation';

function localized(language: AppLanguage, arabic: string, english: string) {
  return language === 'en' ? english : arabic;
}

function statusCopy(status: OperationNotice['status'], language: AppLanguage) {
  const copy: Record<OperationNotice['status'], [string, string]> = {
    pending_approval: ['محتاج موافقتك', 'Waiting for your approval'],
    executing: ['جارٍ التنفيذ', 'Executing'],
    verifying: ['جارٍ التحقق', 'Verifying'],
    completed: ['تم التنفيذ ✓', 'Completed ✓'],
    rejected: ['تم رفض العملية', 'Operation rejected'],
    expired: ['انتهت صلاحية الموافقة', 'Approval expired'],
    failed: ['التنفيذ فشل', 'Execution failed'],
    unknown_result: ['النتيجة غير مؤكدة', 'Outcome is unknown'],
    needs_review: ['محتاج مراجعتك', 'Needs your review'],
    cancelled: ['تم إلغاء العملية', 'Operation cancelled'],
    waiting: ['في انتظار الخطوة التالية', 'Waiting for the next step'],
  };
  const [arabic, english] = copy[status];
  return localized(language, arabic, english);
}

function statusBody(notice: OperationNotice, language: AppLanguage) {
  switch (notice.status) {
    case 'pending_approval':
      return localized(language, 'لن يبدأ التنفيذ قبل موافقتك.', 'Execution will not start before you approve.');
    case 'executing':
      return localized(language, 'العملية قيد التنفيذ. لا ترسل موافقة أخرى.', 'The operation is running. Do not approve it again.');
    case 'verifying':
      return localized(language, 'جارٍ التحقق من النتيجة قبل تأكيد اكتمال العملية.', 'The result is being checked before completion is confirmed.');
    case 'completed':
      return notice.verificationSummary
        ?? localized(language, 'وصلت نتيجة مكتملة للعملية.', 'A completed operation result was received.');
    case 'rejected':
      return localized(language, 'تم رفض العملية.', 'The operation was rejected.');
    case 'expired':
      return localized(language, 'انتهت صلاحية الموافقة، ولم يتم اعتمادها.', 'The approval expired before it was accepted.');
    case 'failed':
      return notice.errorSummary ?? localized(language, 'التنفيذ فشل. راجع سجل العملية لأي سبب متاح.', 'Execution failed. Check the operation history for any available reason.');
    case 'unknown_result':
      return localized(language, 'لم أتمكن من التأكد هل تم التنفيذ. لن أعيد التنفيذ تلقائيًا.', 'I could not confirm whether it ran. I will not retry automatically.');
    case 'needs_review':
      return localized(language, 'راجع تفاصيل العملية قبل اتخاذ خطوة أخرى.', 'Review the operation details before taking another step.');
    case 'cancelled':
      return localized(language, 'تم إلغاء العمل دون اعتباره مكتملًا.', 'The work was cancelled and is not marked complete.');
    case 'waiting':
      return localized(language, 'العملية تنتظر الخطوة التالية.', 'The operation is waiting for its next step.');
  }
}

export function OperationStatusNotice({
  notice,
  colors,
  language,
}: {
  notice: OperationNotice;
  colors: ReturnType<typeof useColors>;
  language: AppLanguage;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = Boolean(notice.serviceLabel || notice.verificationSummary || notice.checkedAt);
  const isAlert = notice.status === 'unknown_result' || notice.status === 'needs_review' || notice.status === 'failed';
  const icon = notice.status === 'completed'
    ? 'check-circle'
    : isAlert ? 'alert-circle'
      : notice.status === 'executing' || notice.status === 'verifying' ? 'loader'
        : 'info';
  const accent = notice.status === 'completed'
    ? colors.primary
    : isAlert ? colors.accent : colors.mutedForeground;

  return (
    <View
      accessibilityRole={isAlert ? 'alert' : 'summary'}
      style={{
        marginTop: 10,
        borderWidth: 1,
        borderRadius: 14,
        padding: 11,
        backgroundColor: colors.muted,
        borderColor: colors.border,
        flexDirection: language === 'en' ? 'row' : 'row-reverse',
        alignItems: 'flex-start',
        gap: 8,
      }}
    >
      <Feather name={icon} size={16} color={accent} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: '700', textAlign: language === 'en' ? 'left' : 'right' }}>
          {statusCopy(notice.status, language)}
        </Text>
        <Text style={{ marginTop: 3, color: colors.mutedForeground, fontSize: 11, lineHeight: 17, textAlign: language === 'en' ? 'left' : 'right' }}>
          {statusBody(notice, language)}
        </Text>
        {hasDetails && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={localized(language, expanded ? 'إخفاء تفاصيل التحقق' : 'عرض تفاصيل التحقق', expanded ? 'Hide verification details' : 'Show verification details')}
            onPress={() => setExpanded((current) => !current)}
            style={{ alignSelf: language === 'en' ? 'flex-start' : 'flex-end', marginTop: 5 }}
          >
            <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '600' }}>
              {localized(language, expanded ? 'إخفاء التفاصيل' : 'تفاصيل التحقق', expanded ? 'Hide details' : 'Verification details')}
            </Text>
          </Pressable>
        )}
        {expanded && (
          <View style={{ marginTop: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 }}>
            {notice.serviceLabel && (
              <Text style={{ color: colors.mutedForeground, fontSize: 10, textAlign: language === 'en' ? 'left' : 'right' }}>
                {localized(language, `المصدر: ${notice.serviceLabel}`, `Source: ${notice.serviceLabel}`)}
              </Text>
            )}
            {notice.verificationSummary && (
              <Text style={{ marginTop: 3, color: colors.mutedForeground, fontSize: 10, textAlign: language === 'en' ? 'left' : 'right' }}>
                {localized(language, `نتيجة التحقق: ${notice.verificationSummary}`, `Verification: ${notice.verificationSummary}`)}
              </Text>
            )}
            {notice.checkedAt && (
              <Text style={{ marginTop: 3, color: colors.mutedForeground, fontSize: 10, textAlign: language === 'en' ? 'left' : 'right' }}>
                {localized(language, `آخر تحقق: ${notice.checkedAt}`, `Last checked: ${notice.checkedAt}`)}
              </Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}
