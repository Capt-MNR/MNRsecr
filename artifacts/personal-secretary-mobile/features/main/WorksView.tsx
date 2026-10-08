import { Feather } from '@expo/vector-icons';
import {
  AgentWorkStatus,
  getGetAgentWorkQueryKey,
  getGetSecretaryOperationQueryKey,
  getListAgentWorksQueryKey,
  useApproveSecretaryOperation,
  useChangeAgentWorkStatus,
  useGetAgentWork,
  useGetSecretaryOperation,
  useRejectSecretaryOperation,
  useListAgentWorks,
  type AgentWork,
  type AgentWorkDetails,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
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
import { OperationStatusNotice } from '../OperationStatusNotice';
import {
  approvalExplanation,
  approvalOutcomeMayBeUnknown,
  operationNoticeFromAction,
  operationNoticeFromStatus,
  secretaryFailureText,
  type OperationNotice,
} from '../../services/operation-presentation';

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
  uncertain: ['نتيجة غير مؤكدة', 'Outcome unconfirmed'],
  unknown_result: ['نتيجة غير مؤكدة', 'Outcome unconfirmed'],
  verified: ['تم التحقق', 'Verified'],
  unchanged: ['لم يتغير', 'Unchanged'],
  queued: ['في قائمة الانتظار', 'Queued'],
  claimed: ['بدأ التنفيذ', 'Claimed'],
  running: ['جارٍ التنفيذ', 'Running'],
  verifying: ['جارٍ التحقق', 'Verifying'],
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

export function statusLabel(status: string, language: AppLanguage): string {
  const labels = statusLabels[status];
  return labels ? localized(language, labels[0], labels[1]) : status;
}

function kindLabel(kind: string, language: AppLanguage): string {
  const labels = kindLabels[kind];
  return labels ? localized(language, labels[0], labels[1]) : kind;
}

function workConditionLabel(condition: Record<string, unknown>, language: AppLanguage): string {
  if (
    condition.entity === 'tasks'
    && condition.metric === 'open_task_count'
    && typeof condition.threshold === 'number'
  ) {
    const operator = condition.operator === 'gte' ? localized(language, 'أكبر من أو يساوي', 'at least')
      : condition.operator === 'eq' ? localized(language, 'يساوي', 'equals')
        : localized(language, 'أكبر من', 'more than');
    return localized(language, `عدد المهام المفتوحة ${operator} ${condition.threshold}`, `Open tasks ${operator} ${condition.threshold}`);
  }
  if (
    condition.provider === 'github'
    && condition.entity === 'repository'
    && condition.metric === 'open_issues_count'
    && typeof condition.owner === 'string'
    && typeof condition.repository === 'string'
    && typeof condition.threshold === 'number'
  ) {
    const operator = condition.operator === 'gte' ? localized(language, 'أكبر من أو يساوي', 'at least')
      : condition.operator === 'eq' ? localized(language, 'يساوي', 'equals')
        : localized(language, 'أكبر من', 'more than');
    return localized(
      language,
      `العناصر المفتوحة في GitHub ${condition.owner}/${condition.repository} ${operator} ${condition.threshold}`,
      `GitHub ${condition.owner}/${condition.repository} open items ${operator} ${condition.threshold}`,
    );
  }
  if (typeof condition.request === 'string') return condition.request;
  return localized(language, 'يتابع هذا العمل شرطًا يحتاج مراجعتك.', 'This work follows a condition that needs review.');
}

function evidenceValueLabel(snapshot: Record<string, unknown> | null | undefined, language: AppLanguage): string {
  if (!snapshot) return localized(language, 'لا توجد نتيجة بعد', 'No result yet');
  if (typeof snapshot.value === 'number') {
    const repository = typeof snapshot.repository === 'string' ? ` — GitHub/${snapshot.repository}` : '';
    return localized(language, `القيمة الحالية: ${snapshot.value}${repository}`, `Current value: ${snapshot.value}${repository}`);
  }
  return localized(language, 'تم الفحص بدون قيمة قابلة للعرض.', 'Checked without a displayable value.');
}

function statusColor(status: string, colors: WorksColors): string {
  if (status === 'active') return colors.accent;
  if (status === 'failed' || status === 'needs_review') return colors.destructive;
  if (status === 'paused' || status === 'waiting') return colors.primary;
  return colors.mutedForeground;
}

function transitionActions(status: AgentWorkStatus, unknownOutcome = false): Array<{
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
      if (unknownOutcome) {
        return [{ to: 'cancelled', labelAr: 'إلغاء المتابعة', labelEn: 'Cancel monitoring', icon: 'x-circle', tone: 'destructive' }];
      }
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
  const status = work.status ?? 'draft';
  const color = statusColor(status, colors);
  return (
    <View style={[styles.statusPill, { backgroundColor: `${color}1A` }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]}>{statusLabel(status, language)}</Text>
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
  const workId = work.id ?? '';
  const title = work.title ?? 'عمل الوكيل';
  const kind = work.kind ?? 'monitor';
  return (
    <Pressable
      testID={`agent-work-${workId}`}
      accessibilityRole="button"
      accessibilityLabel={localized(language, `فتح ${title}`, `Open ${title}`)}
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
          <Text style={[styles.workTitle, { color: colors.foreground }]} numberOfLines={2}>{title}</Text>
          <Text style={[styles.workMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {kindLabel(kind, language)}
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
  const work = details.work ?? ({
    id: '',
    kind: 'monitor',
    title: 'عمل الوكيل',
    description: null,
    status: 'draft',
    source: {},
    condition: {},
    action: {},
    schedule: {},
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: null,
    rowVersion: 1,
    createdAt: '',
    updatedAt: '',
  } as AgentWork);
  const queryClient = useQueryClient();
  const [approvalNotice, setApprovalNotice] = useState<OperationNotice | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const persistedRunNotice = operationNoticeFromStatus(work.lastRunStatus ?? details.runs[0]?.status ?? '');
  const hasUnknownPersistedOutcome = persistedRunNotice?.status === 'unknown_result'
    || persistedRunNotice?.status === 'needs_review';
  const approvalOperationId = useMemo(() => {
    const event = details.events.find((item) => item.eventType === 'approval_requested');
    const metadata = event?.metadata;
    return metadata && typeof metadata.operationId === 'string' ? metadata.operationId : null;
  }, [details.events]);
  const operationQuery = useGetSecretaryOperation(approvalOperationId ?? '', {
    query: {
      queryKey: approvalOperationId
        ? getGetSecretaryOperationQueryKey(approvalOperationId)
        : ['/api/approvals/disabled'],
      enabled: Boolean(approvalOperationId),
      staleTime: 2_000,
      refetchInterval: approvalOperationId
        && !hasUnknownPersistedOutcome
        && approvalNotice?.status !== 'unknown_result'
        && approvalNotice?.status !== 'needs_review'
        ? 5_000
        : false,
    },
  });
  const approveMutation = useApproveSecretaryOperation({
    mutation: {
      onSuccess: (response) => {
        const notice = operationNoticeFromAction(response.action, response.status);
        setApprovalNotice(notice?.status === 'pending_approval' ? null : notice ?? null);
        setApprovalError(null);
        void queryClient.invalidateQueries({ queryKey: getGetAgentWorkQueryKey(work.id ?? '') });
        if (approvalOperationId) void queryClient.invalidateQueries({ queryKey: getGetSecretaryOperationQueryKey(approvalOperationId) });
        onRefresh();
      },
      onError: (error) => {
        setApprovalError(secretaryFailureText(error, language, true));
        if (approvalOutcomeMayBeUnknown(error)) {
          setApprovalNotice({ status: 'unknown_result', ...(approvalOperationId ? { operationId: approvalOperationId } : {}) });
        }
      },
    },
  });
  const rejectMutation = useRejectSecretaryOperation({
    mutation: {
      onSuccess: (response) => {
        const notice = operationNoticeFromAction(response.action, response.status);
        setApprovalNotice(notice?.status === 'pending_approval' ? null : notice ?? null);
        setApprovalError(null);
        void queryClient.invalidateQueries({ queryKey: getGetAgentWorkQueryKey(work.id ?? '') });
        if (approvalOperationId) void queryClient.invalidateQueries({ queryKey: getGetSecretaryOperationQueryKey(approvalOperationId) });
        onRefresh();
      },
      onError: (error) => {
        setApprovalError(secretaryFailureText(error, language, true));
        if (approvalOutcomeMayBeUnknown(error)) {
          setApprovalNotice({ status: 'unknown_result', ...(approvalOperationId ? { operationId: approvalOperationId } : {}) });
        }
      },
    },
  });
  const operation = operationQuery.data;
  const reviewPriorityNotice = [approvalNotice, persistedRunNotice]
    .find((notice) => notice?.status === 'unknown_result' || notice?.status === 'needs_review');
  const currentOperationNotice = reviewPriorityNotice
    ?? approvalNotice
    ?? (operation?.status ? operationNoticeFromStatus(operation.status) : persistedRunNotice);
  const unknownOutcome = currentOperationNotice?.status === 'unknown_result';
  const needsReview = currentOperationNotice?.status === 'needs_review';
  const actions = transitionActions(work.status ?? 'draft', unknownOutcome);
  const approvalVisible = Boolean(
    operation
    && approvalOperationId
    && operation.status === 'pending'
    && !unknownOutcome
    && !needsReview,
  );
  const statusNotice = currentOperationNotice?.status === 'pending_approval' ? undefined : currentOperationNotice;
  const explanation = approvalExplanation(operation?.toolName, language);
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
          <Text style={[styles.detailEyebrow, { color: colors.mutedForeground }]}>{kindLabel(work.kind ?? 'monitor', language)}</Text>
          <Text style={[styles.detailTitle, { color: colors.foreground }]}>{work.title ?? 'عمل الوكيل'}</Text>
          {work.description && (
            <Text style={[styles.detailDescription, { color: colors.mutedForeground }]}>{work.description}</Text>
          )}
        </View>
        <WorkStatusPill work={work} colors={colors} language={language} />
      </View>

      {statusNotice && <OperationStatusNotice notice={statusNotice} colors={colors} language={language} />}
      {approvalError && <Text accessibilityRole="alert" style={[styles.approvalDetail, { color: colors.destructive }]}>{approvalError}</Text>}

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

      {approvalVisible && operation && approvalOperationId && (
        <View style={[styles.approvalCard, { backgroundColor: `${colors.primary}0F`, borderColor: `${colors.primary}55` }]}>
          <Text style={[styles.approvalTitle, { color: colors.foreground }]}>
            {localized(language, 'محتاج موافقتك', 'Waiting for your approval')}
          </Text>
          <Text style={[styles.approvalCopy, { color: colors.mutedForeground }]}>
            {operation.display.title}
          </Text>
          <Text style={[styles.approvalDetail, { color: colors.mutedForeground }]}>
            {localized(language, `الجهة: ${explanation.service}`, `Service: ${explanation.service}`)}
          </Text>
          <Text style={[styles.approvalDetail, { color: colors.mutedForeground }]}>{explanation.reason}</Text>
          <Text style={[styles.approvalDetail, { color: colors.mutedForeground }]}>{explanation.afterApproval}</Text>
          {operation.display.details.map((detail) => (
            <Text key={detail} style={[styles.approvalDetail, { color: colors.mutedForeground }]}>{detail}</Text>
          ))}
          {approvalError && <Text accessibilityRole="alert" style={[styles.approvalDetail, { color: colors.destructive }]}>{approvalError}</Text>}
          <View style={styles.approvalActions}>
            <Pressable
              testID="agent-work-approve"
              accessibilityRole="button"
              disabled={operation.status !== 'pending' || approveMutation.isPending || rejectMutation.isPending}
              onPress={() => approveMutation.mutate({ operationId: approvalOperationId })}
              style={({ pressed }) => [styles.approvalButton, { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.approvalButtonText, { color: colors.primaryForeground }]}>{localized(language, 'موافقة', 'Approve')}</Text>
            </Pressable>
            <Pressable
              testID="agent-work-reject"
              accessibilityRole="button"
              disabled={operation.status !== 'pending' || approveMutation.isPending || rejectMutation.isPending}
              onPress={() => rejectMutation.mutate({ operationId: approvalOperationId })}
              style={({ pressed }) => [styles.approvalButton, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.approvalButtonText, { color: colors.mutedForeground }]}>{localized(language, 'رفض', 'Reject')}</Text>
            </Pressable>
          </View>
        </View>
      )}
      {!statusNotice && operation?.status === 'executing' && (
        <OperationStatusNotice notice={{ status: 'executing', ...(approvalOperationId ? { operationId: approvalOperationId } : {}) }} colors={colors} language={language} />
      )}

      <View style={styles.summaryGrid}>
        <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{localized(language, 'المتابعة القادمة', 'Next check')}</Text>
          <Text style={[styles.summaryValue, { color: colors.foreground }]}>{dateLabel(work.nextRunAt, language)}</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{localized(language, 'آخر نتيجة', 'Last result')}</Text>
          <Text style={[styles.summaryValue, { color: colors.foreground }]}>
            {work.lastRunStatus ? statusLabel(work.lastRunStatus, language) : localized(language, 'لا توجد', 'None')}
          </Text>
        </View>
      </View>

      <View style={[styles.explanationCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{localized(language, 'ماذا يتابع الوكيل؟', 'What the agent follows')}</Text>
        <Text style={[styles.explanationText, { color: colors.foreground }]}>{workConditionLabel(work.condition ?? {}, language)}</Text>
        <Text style={[styles.explanationText, { color: colors.mutedForeground }]}>{evidenceValueLabel(details.evidence[0]?.snapshot, language)}</Text>
        {typeof details.evidence[0]?.snapshot.checkedAt === 'string' && (
          <Text style={[styles.timelineDate, { color: colors.mutedForeground }]}>
            {localized(language, `تم التحقق ${dateLabel(details.evidence[0].snapshot.checkedAt, language)}`, `Verified ${dateLabel(details.evidence[0].snapshot.checkedAt, language)}`)}
          </Text>
        )}
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
  initialWorkId,
  onStartFollowing,
}: {
  colors: WorksColors;
  language: AppLanguage;
  onBack: () => void;
  initialWorkId?: string;
  onStartFollowing?: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(initialWorkId ?? null);
  useEffect(() => {
    if (initialWorkId) setSelectedWorkId(initialWorkId);
  }, [initialWorkId]);
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
            from: detailQuery.data.work.status ?? 'draft',
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
      keyExtractor={(item) => item.id ?? item.title ?? 'agent-work'}
      renderItem={({ item }) => (
        <WorkCard
          work={item}
          colors={colors}
          language={language}
          selected={item.id === selectedWorkId}
          onPress={() => { if (item.id) setSelectedWorkId(item.id); }}
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
          {onStartFollowing && (
            <Pressable
              testID="agent-work-start-following"
              accessibilityRole="button"
              accessibilityLabel={localized(language, 'اطلب من السكرتير متابعة عمل جديد', 'Ask the secretary to follow something new')}
              onPress={onStartFollowing}
              style={({ pressed }) => [{ padding: 14, borderRadius: 16, borderWidth: 1, backgroundColor: colors.primary, borderColor: colors.primary, flexDirection: 'row-reverse', alignItems: 'center', gap: 10, opacity: pressed ? 0.75 : 1 }]}
            >
              <Feather name="plus-circle" size={18} color={colors.primaryForeground} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.errorTitle, { color: colors.primaryForeground }]}>{localized(language, 'اطلب متابعة جديدة', 'Ask for new follow-up')}</Text>
                <Text style={[styles.emptyText, { color: colors.primaryForeground, opacity: 0.8 }]}>{localized(language, 'صف ما تريد متابعته بلغة عادية.', 'Describe what you want tracked in plain language.')}</Text>
              </View>
            </Pressable>
          )}
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
  approvalCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, gap: 8, marginTop: 4, marginBottom: 4 },
  approvalTitle: { fontSize: 14, fontWeight: '700', textAlign: 'right' },
  approvalCopy: { fontSize: 13, fontWeight: '600', textAlign: 'right' },
  approvalDetail: { fontSize: 12, lineHeight: 18, textAlign: 'right' },
  approvalActions: { flexDirection: 'row-reverse', gap: 8, marginTop: 4 },
  approvalButton: { minHeight: 38, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  approvalButtonText: { fontSize: 12, fontWeight: '700' },
  summaryGrid: { flexDirection: 'row-reverse', gap: 8, marginBottom: 12 },
  summaryCard: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 11, gap: 5 },
  explanationCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 13, gap: 6, marginBottom: 4 },
  explanationText: { fontSize: 13, lineHeight: 20, textAlign: 'right' },
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