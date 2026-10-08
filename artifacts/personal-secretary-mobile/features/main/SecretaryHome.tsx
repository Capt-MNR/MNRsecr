import { Feather } from '@expo/vector-icons';
import {
  getGetTodayContextQueryKey,
  getListAgentWorksQueryKey,
  getListPendingSecretaryApprovalsQueryKey,
  useGetTodayContext,
  useListAgentWorks,
  useListPendingSecretaryApprovals,
} from '@workspace/api-client-react';
import type { AppLanguage } from '@/hooks/useLanguage';
import { useColors } from '@/hooks/useColors';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { statusLabel as workStatusLabel } from './WorksView';
import { buildSecretaryHomeModel } from './secretary-home-model';

type Colors = ReturnType<typeof useColors>;
export type HomeRecord = { id: string; recordType: string; title: string; subtitle: string; trailing?: string };

type Props = {
  language: AppLanguage;
  onOpenAsk: () => void;
  onOpenRecord: (record: HomeRecord) => void;
  onReviewApproval: (approval: { operationId: string; conversationId?: string | null }) => void;
  onOpenWork: (workId: string) => void;
  onOpenContext: () => void;
};

const copy = (language: AppLanguage, ar: string, en: string) => language === 'en' ? en : ar;

function dateText(value: string | null | undefined, language: AppLanguage) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ar-EG', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

function SectionTitle({ title, count, colors, rtl }: { title: string; count?: number; colors: Colors; rtl: boolean }) {
  return (
    <View style={[styles.sectionHeading, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
      <Text style={[styles.sectionTitle, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{title}</Text>
      {count !== undefined && <Text style={[styles.count, { color: colors.mutedForeground }]}>{count}</Text>}
    </View>
  );
}

function Row({ icon, title, subtitle, tag, testID, onPress, colors, rtl, accent }: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  subtitle?: string;
  tag?: string;
  testID?: string;
  onPress: () => void;
  colors: Colors;
  rtl: boolean;
  accent?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: rtl ? 'row-reverse' : 'row', opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.rowIcon, { backgroundColor: colors.muted }]}>
        <Feather name={icon} size={16} color={accent ?? colors.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{title}</Text>
        {!!subtitle && <Text numberOfLines={1} style={[styles.rowSubtitle, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>{subtitle}</Text>}
      </View>
      {!!tag && <Text numberOfLines={1} style={[styles.rowTag, { color: accent ?? colors.primary, textAlign: rtl ? 'right' : 'left' }]}>{tag}</Text>}
      <Feather name={rtl ? 'chevron-left' : 'chevron-right'} size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function SecretaryHome({
  language, onOpenAsk, onOpenRecord, onReviewApproval, onOpenWork, onOpenContext,
}: Props) {
  const colors = useColors();
  const rtl = language === 'ar';
  const todayQuery = useGetTodayContext({
    query: { queryKey: getGetTodayContextQueryKey(), staleTime: 30_000 },
  });
  const worksQuery = useListAgentWorks(undefined, {
    query: { queryKey: getListAgentWorksQueryKey(), staleTime: 15_000 },
  });
  const approvalsQuery = useListPendingSecretaryApprovals({
    query: { queryKey: getListPendingSecretaryApprovalsQueryKey(), staleTime: 10_000 },
  });
  const context = todayQuery.data?.context;
  const agentWorks = worksQuery.data?.works ?? [];
  const pendingApprovals = approvalsQuery.data?.approvals ?? [];
  const model = buildSecretaryHomeModel(context, agentWorks, pendingApprovals);
  const focusCount = model.attention.length;
  const refreshing = todayQuery.isFetching || worksQuery.isFetching || approvalsQuery.isFetching;
  const refresh = () => {
    void todayQuery.refetch();
    void worksQuery.refetch();
    void approvalsQuery.refetch();
  };

  return (
    <View testID="main-office-home" style={{ flex: 1, minHeight: 0, backgroundColor: colors.background }}>
      <ScrollView
        testID="office-feed"
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      >
      <View testID="secretary-home" style={[styles.topline, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.eyebrow, { color: colors.primary, textAlign: rtl ? 'right' : 'left' }]}>
            {copy(language, 'مكتبك الشخصي', 'YOUR PERSONAL OFFICE')}
          </Text>
          <Text style={[styles.heading, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>
            {copy(language, 'ما يستحق انتباهك', 'What matters now')}
          </Text>
        </View>
        <View style={[styles.focusBadge, { backgroundColor: colors.primary }]}>
          <Text style={[styles.focusNumber, { color: colors.primaryForeground }]}>{focusCount}</Text>
          <Text style={[styles.focusCaption, { color: colors.primaryForeground }]}>{copy(language, 'للانتباه', 'TO REVIEW')}</Text>
        </View>
      </View>

      <Pressable
        testID="home-open-ask"
        accessibilityRole="button"
        accessibilityLabel={copy(language, 'اسأل السكرتير', 'Ask your secretary')}
        onPress={onOpenAsk}
        style={({ pressed }) => [styles.askBanner, { backgroundColor: colors.primary, flexDirection: rtl ? 'row-reverse' : 'row', opacity: pressed ? 0.78 : 1 }]}
      >
        <View style={[styles.askIcon, { backgroundColor: colors.primaryForeground }]}>
          <Feather name="message-circle" size={17} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.askTitle, { color: colors.primaryForeground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'اطلب أي شيء من السكرتير', 'Ask your secretary anything')}</Text>
          <Text style={[styles.askSubtitle, { color: colors.primaryForeground, opacity: 0.76, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'طلبات، أسئلة، متابعة، وسجلات من مكان واحد', 'Requests, questions, work and records in one place')}</Text>
        </View>
        <Feather name={rtl ? 'arrow-left' : 'arrow-right'} size={18} color={colors.primaryForeground} />
      </Pressable>

      <Pressable
        testID="home-open-context"
        accessibilityRole="button"
        accessibilityLabel={copy(language, 'فتح مركز السياق', 'Open context hub')}
        onPress={onOpenContext}
        style={({ pressed }) => [styles.contextBanner, { backgroundColor: colors.secondary, flexDirection: rtl ? 'row-reverse' : 'row', opacity: pressed ? 0.76 : 1 }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.bannerKicker, { color: colors.primary, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'ذاكرة مرتبطة بيومك', 'CONTEXT, CONNECTED')}</Text>
          <Text style={[styles.bannerTitle, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>
            {copy(language, `${context?.relevantPeople.length ?? 0} أشخاص · ${context?.activeProjects.length ?? 0} مشاريع`, `${context?.relevantPeople.length ?? 0} people · ${context?.activeProjects.length ?? 0} projects`)}
          </Text>
          <Text style={[styles.bannerSubtitle, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'افتح الأشخاص والمشاريع والسجلات والذاكرة', 'People, projects, records and remembered context')}</Text>
        </View>
        <Feather name={rtl ? 'arrow-left' : 'arrow-right'} size={19} color={colors.primary} />
      </Pressable>

      {(todayQuery.isError || approvalsQuery.isError || worksQuery.isError) && (
        <View style={[styles.errorPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.errorText, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>
            {copy(language, 'تعذر تحديث بعض بيانات السكرتير. اسحب للأسفل للمحاولة مرة أخرى.', 'Some secretary data could not be refreshed. Pull down to try again.')}
          </Text>
          <Pressable accessibilityRole="button" onPress={refresh} style={[styles.retryButton, { borderColor: colors.border }]}>
            <Text style={[styles.retryLabel, { color: colors.primary }]}>{copy(language, 'إعادة المحاولة', 'Retry')}</Text>
          </Pressable>
        </View>
      )}
      {(todayQuery.isLoading || worksQuery.isLoading || approvalsQuery.isLoading) && (
        <View style={[styles.loading, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>{copy(language, 'جارٍ جمع ما يحتاج انتباهك…', 'Gathering what needs your attention…')}</Text>
        </View>
      )}

      {model.attention.length > 0 && (
        <View style={styles.section}>
          <SectionTitle title={copy(language, 'محتاج منك الآن', 'Needs your attention')} count={model.attention.length} colors={colors} rtl={rtl} />
          {model.attention.map((item) => {
            if (item.kind === 'approval') {
              return (
                <Row
                  key={item.key}
                  icon="shield"
                  testID={`office-focus-approval-${item.operationId}`}
                  title={item.title}
                  subtitle={copy(language, item.reason, 'Your approval is required before this runs.')}
                  tag={copy(language, 'موافقة', 'Approval')}
                  onPress={() => onReviewApproval({ operationId: item.operationId, conversationId: item.conversationId })}
                  colors={colors}
                  rtl={rtl}
                  accent={colors.accent}
                />
              );
            }
            if (item.kind === 'task') {
              return (
                <Row
                  key={item.key}
                  icon="alert-circle"
                  testID={`office-focus-overdue-task-${item.id}`}
                  title={item.title}
                  subtitle={`${copy(language, item.reason, 'Its deadline passed and the task is still open.')} · ${dateText(item.dueAt, language)}`}
                  tag={copy(language, 'متأخرة', 'Overdue')}
                  onPress={() => onOpenRecord({ id: item.id, recordType: 'task', title: item.title, subtitle: dateText(item.dueAt, language), trailing: item.status })}
                  colors={colors}
                  rtl={rtl}
                  accent={colors.accent}
                />
              );
            }
            return (
              <Row
                key={item.key}
                icon="alert-circle"
                testID={`office-focus-work-review-${item.workId}`}
                title={item.title}
                subtitle={copy(language, item.reason, item.status === 'unknown_result'
                  ? 'The outcome is unconfirmed. It will not be retried automatically.'
                  : item.status === 'needs_review' ? 'This work needs your review.' : 'The latest run failed.')}
                tag={workStatusLabel(item.status, language)}
                onPress={() => onOpenWork(item.workId)}
                colors={colors}
                rtl={rtl}
                accent={colors.accent}
              />
            );
          })}
        </View>
      )}

      {model.watching.length > 0 && (
        <View style={styles.section}>
          <SectionTitle title={copy(language, 'السكرتير بيتابع', 'Under the secretary’s watch')} count={model.watching.length} colors={colors} rtl={rtl} />
          {model.watching.map((work) => {
            const lastRun = work.lastRunAt
              ? `${copy(language, 'آخر تشغيل', 'Last run')}: ${dateText(work.lastRunAt, language)}${work.lastRunStatus ? ` · ${workStatusLabel(work.lastRunStatus, language)}` : ''}`
              : '';
            const nextRun = work.nextRunAt
              ? `${copy(language, 'التالي', 'Next')}: ${dateText(work.nextRunAt, language)}`
              : '';
            return (
              <Row
                key={work.id}
                testID={`office-focus-work-${work.id}`}
                icon="activity"
                title={work.title ?? copy(language, 'عمل جارٍ', 'Ongoing work')}
                subtitle={[lastRun, nextRun].filter(Boolean).join(' · ') || work.description || ''}
                tag={workStatusLabel(work.status ?? 'draft', language)}
                onPress={() => { if (work.id) onOpenWork(work.id); }}
                colors={colors}
                rtl={rtl}
              />
            );
          })}
        </View>
      )}

      {model.today.length > 0 && (
        <View style={styles.section}>
          <SectionTitle title={copy(language, 'اليوم', 'Today')} count={model.today.length} colors={colors} rtl={rtl} />
          {model.today.map((item) => (
            <Row
              key={item.key}
              testID={`office-focus-${item.kind}-${item.id}`}
              icon={item.kind === 'reminder' ? 'clock' : 'check-square'}
              title={item.title}
              subtitle={item.dueAt
                ? dateText(item.dueAt, language)
                : copy(language, 'مهمة مفتوحة بلا موعد', 'Open task with no due date')}
              tag={item.kind === 'reminder'
                ? copy(language, 'تذكير', 'Reminder')
                : item.status === 'in_progress'
                  ? copy(language, 'قيد العمل', 'In progress')
                  : copy(language, 'مفتوحة', 'Open')}
              onPress={() => onOpenRecord({
                id: item.id,
                recordType: item.kind,
                title: item.title,
                subtitle: item.dueAt ? dateText(item.dueAt, language) : item.status,
                trailing: item.status,
              })}
              colors={colors}
              rtl={rtl}
            />
          ))}
        </View>
      )}

      {model.upcoming.length > 0 && (
        <View style={styles.section}>
          <SectionTitle title={copy(language, 'قريبًا', 'Coming up')} count={model.upcoming.length} colors={colors} rtl={rtl} />
          {model.upcoming.map((item) => (
            <Row
              key={item.key}
              testID={`office-focus-${item.kind}-${item.id}`}
              icon={item.kind === 'reminder' ? 'clock' : 'check-square'}
              title={item.title}
              subtitle={item.dueAt ? dateText(item.dueAt, language) : ''}
              tag={item.kind === 'reminder' ? copy(language, 'تذكير', 'Reminder') : copy(language, 'مهمة', 'Task')}
              onPress={() => onOpenRecord({ id: item.id, recordType: item.kind, title: item.title, subtitle: item.dueAt ? dateText(item.dueAt, language) : '', trailing: item.status })}
              colors={colors}
              rtl={rtl}
            />
          ))}
        </View>
      )}

      {model.recentExpenses.length > 0 && (
        <View style={styles.section}>
          <SectionTitle title={copy(language, 'آخر ما سُجّل', 'Recently recorded')} count={model.recentExpenses.length} colors={colors} rtl={rtl} />
          {model.recentExpenses.map((expense) => (
            <Row
              key={expense.id}
              testID={`office-focus-expense-${expense.id}`}
              icon="credit-card"
              title={expense.description}
              subtitle={[expense.personName, expense.projectName].filter(Boolean).join(' · ') || dateText(expense.occurredAt, language)}
              tag={`${(expense.amountMinor / 100).toLocaleString(language === 'en' ? 'en-US' : 'ar-EG', { minimumFractionDigits: 2 })} ${expense.currency}`}
              onPress={() => onOpenRecord({ id: expense.id, recordType: 'expense', title: expense.description, subtitle: [expense.personName, expense.projectName].filter(Boolean).join(' · ') || dateText(expense.occurredAt, language), trailing: `${(expense.amountMinor / 100).toLocaleString(language === 'en' ? 'en-US' : 'ar-EG', { minimumFractionDigits: 2 })} ${expense.currency}` })}
              colors={colors}
              rtl={rtl}
            />
          ))}
        </View>
      )}

      {model.attention.length === 0 && model.watching.length === 0 && model.today.length === 0 && model.upcoming.length === 0 && model.recentExpenses.length === 0 && !todayQuery.isLoading && !approvalsQuery.isLoading && !worksQuery.isLoading && !todayQuery.isError && !approvalsQuery.isError && !worksQuery.isError && (
        <View style={[styles.empty, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="check-circle" size={23} color={colors.primary} />
          <Text style={[styles.emptyTitle, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'أنت على اطلاع', 'You’re up to date')}</Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'لا يوجد ما يحتاج انتباهك الآن. سأبقي السياق قريبًا.', 'Nothing needs your attention right now. I’ll keep the context close.')}</Text>
        </View>
      )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 36, gap: 20 },
  askBanner: { minHeight: 70, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 12, alignItems: 'center', gap: 11 },
  askIcon: { width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  askTitle: { fontSize: 13, fontWeight: '800' },
  askSubtitle: { fontSize: 10, lineHeight: 15, marginTop: 3 },
  topline: { alignItems: 'center', gap: 12 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 6 },
  heading: { fontSize: 27, lineHeight: 34, fontWeight: '800', letterSpacing: -0.5 },
  focusBadge: { width: 64, height: 64, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  focusNumber: { fontSize: 22, fontWeight: '800', lineHeight: 25 },
  focusCaption: { fontSize: 7, fontWeight: '800', letterSpacing: 0.5 },
  contextBanner: { borderRadius: 22, padding: 17, alignItems: 'center', gap: 12 },
  bannerKicker: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginBottom: 5 },
  bannerTitle: { fontSize: 17, fontWeight: '800' },
  bannerSubtitle: { marginTop: 5, fontSize: 11, lineHeight: 17 },
  section: { gap: 8 },
  sectionHeading: { alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, marginBottom: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  count: { fontSize: 11, fontWeight: '700' },
  row: { minHeight: 65, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 11, paddingVertical: 9, alignItems: 'center', gap: 10 },
  rowIcon: { width: 35, height: 35, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  rowSubtitle: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  rowTag: { maxWidth: 84, fontSize: 9, fontWeight: '700' },
  empty: { borderWidth: 1, borderRadius: 21, padding: 19, gap: 9, alignItems: 'flex-start' },
  emptyTitle: { fontSize: 17, fontWeight: '800' },
  emptyBody: { fontSize: 12, lineHeight: 19 },
  loading: { minHeight: 54, padding: 12, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 },
  errorPanel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 15, padding: 12, gap: 8 },
  errorText: { fontSize: 11, lineHeight: 17 },
  retryButton: { alignSelf: 'flex-start', borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  retryLabel: { fontSize: 11, fontWeight: '700' },
});
