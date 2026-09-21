import { Feather } from '@expo/vector-icons';
import {
  AgentWorkStatus,
  getGetAgentWorkQueryKey,
  getListAgentWorksQueryKey,
  useChangeAgentWorkStatus,
  useGetAgentWork,
  useListAgentWorks,
  type AgentWork,
  type AgentWorkDetails,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { AppLanguage } from '@/hooks/useLanguage';
import { useColors } from '@/hooks/useColors';

type WorksColors = ReturnType<typeof useColors>;

function localized(language: AppLanguage, arabic: string, english: string): string {
  return language === 'en' ? english : arabic;
}

const statusLabels: Record<string, [string, string]> = {
  draft: ['مسودة', 'Draft'],
  active: ['يعمل', 'Active'],
  paused: ['متوقف مؤقتًا', 'Paused'],
  waiting: ['ينتظر', 'Waiting'],
  needs_review: ['يحتاج مراجعتك', 'Needs review'],
  completed: ['اكتمل', 'Completed'],
  failed: ['تعذر إكماله', 'Failed'],
  cancelled: ['ملغى', 'Cancelled'],
};

const kindLabels: Record<string, [string, string]> = {
  monitor: ['متابعة', 'Monitor'],
  reminder: ['تذكير', 'Reminder'],
  recurring_task: ['عمل متكرر', 'Recurring task'],
  external_action: ['إجراء خارجي', 'External action'],
  research: ['بحث', 'Research'],
  workflow: ['سير عمل', 'Workflow'],
};

function dateLabel(value: string | null | undefined, language: AppLanguage): string {
  if (!value) return localized(language, 'لم يبدأ بعد', 'Not started yet');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ar-EG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function statusLabel(status: string, language: AppLanguage): string {
  const labels = statusLabels[status];
  return labels ? localized(language, labels[0], labels[1]) : status;
}

function kindLabel(kind: string, language: AppLanguage): string {
  const labels = kindLabels[kind];
  return labels ? localized(language, labels[0], labels[1]) : kind;
}

function statusColor(status: string, colors: WorksColors): string {
  if (status === 'active') return colors.accent;
  if (status === 'failed' || status === 'needs_review') return colors.destructive;
  if (status === 'paused' || status === 'waiting') return colors.primary;
  return colors.mutedForeground;
}

function transitionActions(status: AgentWorkStatus): Array<{
  to: AgentWorkStatus;
  labelAr: string;
  labelEn: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  tone: 'primary' | 'muted' | 'destructive';
}> {
  switch (status) {
    case 'draft':
      return [{ to: 'active', labelAr: 'تشغيل العمل', labelEn: 'Activate', icon: 'play', tone: 'primary' }];
    case 'active':
      return [
        { to: 'paused', labelAr: 'إيقاف مؤقت', labelEn: 'Pause', icon: 'pause', tone: 'muted' },
        { to: 'cancelled', labelAr: 'إلغاء', labelEn: 'Cancel', icon: 'x-circle', tone: 'destructive' },
      ];
    case 'paused':
      return [
        { to: 'active', labelAr: 'استئناف', labelEn: 'Resume', icon: 'play', tone: 'primary' },
        { to: 'cancelled', labelAr: 'إلغاء', labelEn: 'Cancel', icon: 'x-circle', tone: 'destructive' },
      ];
    case 'waiting':
      return [{ to: 'cancelled', labelAr: 'إلغاء', labelEn: 'Cancel', icon: 'x-circle', tone: 'destructive' }];
    case 'needs_review':
      return [{ to: 'cancelled', labelAr: 'إلغاء', labelEn: 'Cancel', icon: 'x-circle', tone: 'destructive' }];
    case 'failed':
      return [
        { to: 'active', labelAr: 'إعادة التشغيل', labelEn: 'Retry', icon: 'refresh-cw', tone: 'primary' },
        { to: 'cancelled', labelAr: 'إلغاء', labelEn: 'Cancel', icon: 'x-circle', tone: 'destructive' },
      ];
    default:
      return [];
  }
}

function WorkStatusPill({
  work,
  colors,
  language,
}: {
  work: AgentWork;
  colors: WorksColors;
  language: AppLanguage;
}) {
  const color = statusColor(work.status, colors);
  return (
    <View style={[styles.statusPill, { backgroundColor: `${color}1A` }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]}>{statusLabel(work.status, language)}</Text>
    </View>
  );
}

function WorkCard({
  work,
  colors,
  language,
  selected,
  onPress,
}: {
  work: AgentWork;
  colors: WorksColors;
  language: AppLanguage;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={`agent-work-${work.id}`}
      accessibilityRole="button"
      accessibilityLabel={localized(language, `فتح ${work.title}`, `Open ${work.title}`)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.workCard,
        {
          backgroundColor: selected ? `${colors.primary}0F` : colors.card,
          borderColor: selected ? colors.primary : colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.workCardTop}>
        <View style={styles.workCardCopy}>
          <Text style={[styles.workTitle, { color: colors.foreground }]} numberOfLines={2}>{work.title}</Text>
          <Text style={[styles.workMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {kindLabel(work.kind, language)}
          </Text>
        </View>
        <WorkStatusPill work={work} colors={colors} language={language} />
      </View>
      <Text style={[styles.workLastRun, { color: colors.mutedForeground }]}>
        {work.lastRunAt
          ? localized(language, `آخر متابعة ${dateLabel(work.lastRunAt, language)}`, `Last check ${dateLabel(work.lastRunAt, language)}`)
          : localized(language, 'لم تتم متابعة هذا العمل بعد', 'This work has not run yet')}
      </Text>
    </Pressable>
  );
}

function SectionTitle({
  icon,
  title,
  colors,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  colors: WorksColors;
}) {
  return (
    <View style={styles.sectionTitle}>
      <Feather name={icon} size={15} color={colors.primary} />
      <Text style={[styles.sectionTitleText, { color: colors.foreground }]}>{title}</Text>
    </View>
  );
}

function WorkDetail({
  details,
  colors,
  language,
  onBack,
  onRefresh,
  onTransition,
  transitionPending,
}: {
  details: AgentWorkDetails;
  colors: WorksColors;
  language: AppLanguage;
  onBack: () => void;
  onRefresh: () => void;
  onTransition: (to: AgentWorkStatus) => void;
  transitionPending: boolean;
}) {
  const actions = transitionActions(details.work.status);
  return (
    <ScrollView
      testID="agent-work-detail"
      style={styles.detailScroll}
      contentContainerStyle={styles.detailContent}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={styles.detailHeader}>
        <Pressable
          testID="agent-work-back"
          accessibilityRole="button"
          accessibilityLabel={localized(language, 'العودة إلى أعمال الوكيل', 'Back to agent work')}
          onPress={onBack}
          style={({ pressed }) => [styles.iconButton, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
        >
          <Feather name="arrow-right" size={17} color={colors.foreground} />
        </Pressable>
        <View style={styles.detailHeaderCopy}>
          <Text style={[styles.detailEyebrow, { color: colors.mutedForeground }]}>{kindLabel(details.work.kind, language)}</Text>
          <Text style={[styles.detailTitle, { color: colors.foreground }]}>{details.work.title}</Text>
          {details.work.description && (
            <Text style={[styles.detailDescription, { color: colors.mutedForeground }]}>{details.work.description}</Text>
          )}
        </View>
        <WorkStatusPill work={details.work} colors={colors} language={language} />
      </View>

      {actions.length > 0 && (
        <View style={styles.actionRow}>
          {actions.map((action) => {
            const actionColor = action.tone === 'destructive'
              ? colors.destructive
              : action.tone === 'primary'
                ? colors.primary
                : colors.mutedForeground;
            return (
              <Pressable
                key={action.to}
                testID={`agent-work-transition-${action.to}`}
                accessibilityRole="button"
                accessibilityLabel={localized(language, action.labelAr, action.labelEn)}
                disabled={transitionPending}
                onPress={() => onTransition(action.to)}
                style={({ pressed }) => [
                  styles.actionButton,
                  {
                    backgroundColor: action.tone === 'primary' ? colors.primary : colors.card,
                    borderColor: actionColor,
                    opacity: pressed || transitionPending ? 0.55 : 1,
                  },
                ]}
              >
                <Feather name={action.icon} size={15} color={action.tone === 'primary' ? colors.primaryForeground : actionColor} />
                <Text style={[styles.actionButtonText, { color: action.tone === 'primary' ? colors.primaryForeground : actionColor }]}>
                  {localized(language, action.labelAr, action.labelEn)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.summaryGrid}>
        <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{localized(language, 'المتابعة القادمة', 'Next check')}</Text>
          <Text style={[styles.summaryValue, { color: colors.foreground }]}>{dateLabel(details.work.nextRunAt, language)}</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{localized(language, 'آخر نتيجة', 'Last result')}</Text>
          <Text style={[styles.summaryValue, { color: colors.foreground }]}>
            {details.work.lastRunStatus ? statusLabel(details.work.lastRunStatus, language) : localized(language, 'لا توجد', 'None')}
          </Text>
        </View>
      </View>

      <SectionTitle icon="activity" title={localized(language, 'ما الذي حدث', 'What happened')} colors={colors} />
      {details.events.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{localized(language, 'لا توجد أحداث بعد.', 'No events yet.')}</Text>
      ) : details.events.slice(0, 8).map((event) => (
        <View key={event.id} style={[styles.timelineRow, { borderBottomColor: colors.border }]}>
          <View style={[styles.timelineDot, { backgroundColor: colors.primary }]} />
          <View style={styles.timelineCopy}>
            <Text style={[styles.timelineSummary, { color: colors.foreground }]}>{event.summary}</Text>
            <Text style={[styles.timelineDate, { color: colors.mutedForeground }]}>{dateLabel(event.occurredAt, language)}</Text>
          </View>
        </View>
      ))}

      <SectionTitle icon="clock" title={localized(language, 'المحاولات', 'Runs')} colors={colors} />
      {details.runs.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{localized(language, 'لم تبدأ محاولة بعد.', 'No runs yet.')}</Text>
      ) : details.runs.slice(0, 8).map((run) => (
        <View key={run.id} style={[styles.runRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View>
            <Text style={[styles.timelineSummary, { color: colors.foreground }]}>
              {localized(language, `المحاولة ${run.attempt}`, `Run ${run.attempt}`)}
            </Text>
            <Text style={[styles.timelineDate, { color: colors.mutedForeground }]}>{dateLabel(run.startedAt, language)}</Text>
          </View>
          <Text style={[styles.runStatus, { color: statusColor(run.status, colors) }]}>{statusLabel(run.status, language)}</Text>
        </View>
      ))}

      <SectionTitle icon="file-text" title={localized(language, 'الأدلة المحفوظة', 'Evidence')} colors={colors} />
      {details.evidence.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{localized(language, 'لا توجد أدلة محفوظة بعد.', 'No evidence saved yet.')}</Text>
      ) : details.evidence.slice(0, 6).map((evidence) => (
        <View key={evidence.id} style={[styles.evidenceRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.evidenceCopy}>
            <Text style={[styles.timelineSummary, { color: colors.foreground }]}>{evidence.retentionClass === 'sensitive' ? localized(language, 'دليل حساس', 'Sensitive evidence') : localized(language, 'دليل قياسي', 'Standard evidence')}</Text>
            <Text style={[styles.timelineDate, { color: colors.mutedForeground }]}>{dateLabel(evidence.createdAt, language)}</Text>
          </View>
          <Text style={[styles.evidenceHash, { color: colors.mutedForeground }]}>{evidence.snapshotHash.slice(0, 10)}…</Text>
        </View>
      ))}
    </ScrollView>
  );
}

export default function WorksView({
  colors,
  language,
  onBack,
}: {
  colors: WorksColors;
  language: AppLanguage;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const worksQuery = useListAgentWorks(undefined, {
    query: {
      queryKey: getListAgentWorksQueryKey(),
      staleTime: 10_000,
    },
  });
  const detailQuery = useGetAgentWork(selectedWorkId ?? '', {
    query: {
      enabled: Boolean(selectedWorkId),
      queryKey: getGetAgentWorkQueryKey(selectedWorkId ?? ''),
      staleTime: 5_000,
    },
  });
  const statusMutation = useChangeAgentWorkStatus({
    mutation: {
      onSuccess: (_result, variables) => {
        void queryClient.invalidateQueries({ queryKey: getListAgentWorksQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetAgentWorkQueryKey(variables.workId) });
      },
    },
  });
  const works = useMemo(() => worksQuery.data?.works ?? [], [worksQuery.data?.works]);

  if (selectedWorkId && detailQuery.data) {
    return (
      <WorkDetail
        details={detailQuery.data}
        colors={colors}
        language={language}
        onBack={() => setSelectedWorkId(null)}
        onRefresh={() => void detailQuery.refetch()}
        onTransition={(to) => statusMutation.mutate({
          workId: selectedWorkId,
          data: {
            from: detailQuery.data.work.status,
            to,
            reason: localized(language, 'تغيير الحالة من تطبيق الهاتف.', 'Status changed from the mobile app.'),
          },
        })}
        transitionPending={statusMutation.isPending}
      />
    );
  }

  return (
    <FlatList
      testID="agent-works-view"
      style={styles.list}
      data={works}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <WorkCard
          work={item}
          colors={colors}
          language={language}
          selected={item.id === selectedWorkId}
          onPress={() => setSelectedWorkId(item.id)}
        />
      )}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      scrollEnabled={works.length > 0}
      refreshControl={<RefreshControl refreshing={worksQuery.isFetching} onRefresh={() => void worksQuery.refetch()} tintColor={colors.primary} />}
      ListHeaderComponent={(
        <View style={styles.listHeader}>
          <View style={styles.recordsIntro}>
            <View style={styles.listHeaderCopy}>
              <Text style={[styles.detailTitle, { color: colors.foreground }]}>{localized(language, 'أعمال الوكيل', 'Agent work')}</Text>
              <Text style={[styles.detailDescription, { color: colors.mutedForeground }]}>
                {localized(language, 'ما يتابعه الوكيل وما يحتاج انتباهك.', 'What the agent is following and what needs your attention.')}
              </Text>
            </View>
            <Pressable
              testID="agent-works-back"
              accessibilityRole="button"
              accessibilityLabel={localized(language, 'العودة إلى المكتب', 'Back to office')}
              onPress={onBack}
              style={({ pressed }) => [styles.iconButton, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
            >
              <Feather name="arrow-right" size={17} color={colors.foreground} />
            </Pressable>
          </View>
          {worksQuery.isLoading && (
            <View style={styles.loadingState}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{localized(language, 'جاري تحميل الأعمال…', 'Loading agent work…')}</Text>
            </View>
          )}
          {worksQuery.isError && (
            <View style={[styles.errorCard, { backgroundColor: `${colors.destructive}14`, borderColor: colors.destructive }]}>
              <Text style={[styles.errorTitle, { color: colors.destructive }]}>{localized(language, 'تعذر تحميل أعمال الوكيل', 'Unable to load agent work')}</Text>
              <Pressable accessibilityRole="button" onPress={() => void worksQuery.refetch()}>
                <Text style={[styles.retryText, { color: colors.destructive }]}>{localized(language, 'حاول مرة أخرى', 'Try again')}</Text>
              </Pressable>
            </View>
          )}
          {selectedWorkId && detailQuery.isLoading && (
            <View style={styles.loadingState}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{localized(language, 'جاري تحميل التفاصيل…', 'Loading details…')}</Text>
            </View>
          )}
          {selectedWorkId && detailQuery.isError && (
            <View style={[styles.errorCard, { backgroundColor: `${colors.destructive}14`, borderColor: colors.destructive }]}>
              <Text style={[styles.errorTitle, { color: colors.destructive }]}>{localized(language, 'تعذر تحميل تفاصيل العمل', 'Unable to load work details')}</Text>
              <Pressable accessibilityRole="button" onPress={() => void detailQuery.refetch()}>
                <Text style={[styles.retryText, { color: colors.destructive }]}>{localized(language, 'حاول مرة أخرى', 'Try again')}</Text>
              </Pressable>
            </View>
          )}
          {!worksQuery.isLoading && !worksQuery.isError && works.length === 0 && (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="compass" size={24} color={colors.primary} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{localized(language, 'لا توجد أعمال بعد', 'No agent work yet')}</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {localized(language, 'اطلب من السكرتير متابعة شيء مستمر، وسيظهر هنا.', 'Ask the secretary to keep following something and it will appear here.')}
              </Text>
            </View>
          )}
          {works.length > 0 && <Text style={[styles.countLabel, { color: colors.mutedForeground }]}>{works.length} {localized(language, 'أعمال', 'works')}</Text>}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { padding: 18, paddingBottom: 120, gap: 10 },
  listHeader: { gap: 14, marginBottom: 8 },
  listHeaderCopy: { flex: 1 },
  recordsIntro: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  detailScroll: { flex: 1 },
  detailContent: { padding: 18, paddingBottom: 120, gap: 10 },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 4 },
  detailHeaderCopy: { flex: 1, gap: 3 },
  detailEyebrow: { fontSize: 12, fontWeight: '600', textAlign: 'right' },
  detailTitle: { fontSize: 23, fontWeight: '700', lineHeight: 30, textAlign: 'right' },
  detailDescription: { fontSize: 13, lineHeight: 20, textAlign: 'right' },
  workCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, gap: 11 },
  workCardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  workCardCopy: { flex: 1, gap: 4 },
  workTitle: { fontSize: 15, fontWeight: '700', textAlign: 'right' },
  workMeta: { fontSize: 12, textAlign: 'right' },
  workLastRun: { fontSize: 11, textAlign: 'right' },
  statusPill: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '700' },
  iconButton: { width: 36, height: 36, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  actionRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 5, marginBottom: 6 },
  actionButton: { minHeight: 38, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  actionButtonText: { fontSize: 12, fontWeight: '700' },
  summaryGrid: { flexDirection: 'row-reverse', gap: 8, marginBottom: 12 },
  summaryCard: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 11, gap: 5 },
  summaryLabel: { fontSize: 11, textAlign: 'right' },
  summaryValue: { fontSize: 12, fontWeight: '700', textAlign: 'right' },
  sectionTitle: { flexDirection: 'row-reverse', alignItems: 'center', gap: 7, marginTop: 9, marginBottom: 1 },
  sectionTitleText: { fontSize: 14, fontWeight: '700', textAlign: 'right' },
  timelineRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 9, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  timelineDot: { width: 7, height: 7, borderRadius: 4, marginTop: 5 },
  timelineCopy: { flex: 1, gap: 3 },
  timelineSummary: { fontSize: 13, fontWeight: '600', textAlign: 'right' },
  timelineDate: { fontSize: 11, textAlign: 'right' },
  runRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', borderWidth: StyleSheet.hairlineWidth, borderRadius: 13, padding: 11, marginTop: 7 },
  runStatus: { fontSize: 11, fontWeight: '700' },
  evidenceRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', borderWidth: StyleSheet.hairlineWidth, borderRadius: 13, padding: 11, marginTop: 7 },
  evidenceCopy: { flex: 1, gap: 3 },
  evidenceHash: { fontSize: 10, fontFamily: 'monospace' },
  loadingState: { alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 26 },
  emptyCard: { alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 24, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptyText: { fontSize: 12, lineHeight: 19, textAlign: 'center' },
  errorCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 13, gap: 8 },
  errorTitle: { fontSize: 13, fontWeight: '700', textAlign: 'right' },
  retryText: { fontSize: 12, fontWeight: '700', textAlign: 'right' },
  countLabel: { fontSize: 11, textAlign: 'right' },
});