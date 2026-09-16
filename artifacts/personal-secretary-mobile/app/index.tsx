import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useApproveSecretaryOperation,
  useCreateTurn,
  useGetConversation,
  useGetEntityGraph,
  getGetTodayContextQueryKey,
  getListRecordsQueryKey,
  useGetTodayContext,
  useListRecords,
  useRejectSecretaryOperation,
} from '@workspace/api-client-react';
import type { RecordsResponse, TodayContext, TurnResponse } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

type ApprovalStatus = 'pending' | 'executing' | 'completed' | 'rejected' | 'expired' | 'failed';

type Approval = {
  operationId: string;
  title: string;
  details: string[];
  status: ApprovalStatus;
};

type LocalMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  createdAt: string;
  approval?: Approval;
  recordLink?: MobileRecordRow;
};

type RecordOrigin = {
  conversationId: string;
  turnId?: string | null;
  operationId?: string | null;
};

const STORAGE_MESSAGES = '@personal-secretary-mobile/messages';
const STORAGE_CONVERSATION = '@personal-secretary-mobile/conversation';

const starterMessage: LocalMessage = {
  id: 'welcome',
  role: 'assistant',
  text: 'أنا جاهز للطلبات السريعة. اسألني عن يومك، سجّل مصروفًا، أو اطلب تذكيرًا.',
  createdAt: new Date(0).toISOString(),
};

const suggestions = [
  'إيه عندي النهارده؟',
  'فكرني بكرة أكلم محمد',
  'محمد أخد مني كام؟',
];

type FeatherName = ComponentProps<typeof Feather>['name'];

type MobileRecordRow = {
  id: string;
  recordType: string;
  title: string;
  subtitle: string;
  trailing?: string;
  origin?: RecordOrigin | null;
};

type MobileRecordSection = {
  key: string;
  title: string;
  icon: FeatherName;
  data: MobileRecordRow[];
};

type TodayContextReminder = TodayContext['upcomingReminders'][number];
type TodayContextTask = TodayContext['pendingTasks'][number];

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: currency || 'EGP',
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

function recordDate(value?: string | null) {
  if (!value) return 'بدون موعد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const relatedLabels: Record<string, string> = {
  projects: 'المشاريع',
  people: 'الأشخاص',
  expenses: 'المصروفات',
  commitments: 'الالتزامات',
  tasks: 'المهام',
  reminders: 'التذكيرات',
  financialParties: 'العلاقات المالية',
};

function statusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    active: 'نشط',
    open: 'مفتوح',
    pending: 'معلّق',
    scheduled: 'مجدول',
    done: 'مكتمل',
    completed: 'مكتمل',
    overdue: 'متأخر',
    cancelled: 'ملغى',
  };
  return status ? labels[status] ?? status : 'بدون حالة';
}

function recordSections(records: RecordsResponse | undefined): MobileRecordSection[] {
  if (!records) return [];
  return [
    {
      key: 'expenses',
      title: 'المصروفات',
      icon: 'dollar-sign',
      data: records.expenses.map((expense) => ({
        id: expense.id,
        recordType: 'expense',
        title: expense.description,
        subtitle: [expense.personName ?? expense.projectName, recordDate(expense.occurredAt)]
          .filter(Boolean)
          .join(' · '),
        trailing: money(expense.amountMinor, expense.currency),
        origin: expense.origin,
      })),
    },
    {
      key: 'people',
      title: 'الأشخاص',
      icon: 'users',
      data: records.people.map((person) => ({
        id: person.id,
        recordType: 'person',
        title: person.name,
        subtitle: person.phone ?? person.notes ?? 'لا توجد ملاحظات',
      })),
    },
    {
      key: 'projects',
      title: 'المشاريع',
      icon: 'briefcase',
      data: records.projects.map((project) => ({
        id: project.id,
        recordType: 'project',
        title: project.name,
        subtitle: recordDate(project.updatedAt),
        trailing: statusLabel(project.status),
      })),
    },
    {
      key: 'tasks',
      title: 'المهام',
      icon: 'check-square',
      data: records.tasks.map((task) => ({
        id: task.id,
        recordType: 'task',
        title: task.title,
        subtitle: task.dueAt ? `موعدها ${recordDate(task.dueAt)}` : 'مهمة مستمرة',
        trailing: statusLabel(task.status),
        origin: task.origin,
      })),
    },
    {
      key: 'reminders',
      title: 'التذكيرات',
      icon: 'bell',
      data: records.reminders.map((reminder) => ({
        id: reminder.id,
        recordType: 'reminder',
        title: reminder.text,
        subtitle: `${recordDate(reminder.dueAt)} · ${reminder.timezone}`,
        trailing: statusLabel(reminder.status),
        origin: reminder.origin,
      })),
    },
    {
      key: 'commitments',
      title: 'الالتزامات',
      icon: 'link',
      data: records.commitments.map((commitment) => ({
        id: commitment.id,
        recordType: 'commitment',
        title: commitment.title,
        subtitle: commitment.personName ?? 'بدون طرف محدد',
        trailing: commitment.dueAt ? recordDate(commitment.dueAt) : statusLabel(commitment.status),
        origin: commitment.origin as RecordOrigin | null,
      })),
    },
  ];
}

function approvalFromAction(action: TurnResponse['action']): Approval | undefined {
  if (!action || action.type !== 'approval_required' || typeof action.operationId !== 'string') {
    return undefined;
  }
  const display = action.display && typeof action.display === 'object'
    ? action.display as { title?: unknown; details?: unknown }
    : {};
  const status = typeof action.status === 'string'
    && ['pending', 'executing', 'completed', 'rejected', 'expired', 'failed'].includes(action.status)
    ? action.status as ApprovalStatus
    : 'pending';
  return {
    operationId: action.operationId,
    title: typeof display.title === 'string' ? display.title : 'تأكيد العملية',
    details: Array.isArray(display.details)
      ? display.details.filter((detail): detail is string => typeof detail === 'string')
      : [],
    status,
  };
}

function recordLinkFromAction(action: TurnResponse['action']): MobileRecordRow | undefined {
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
      subtitle: [
        stringValue(value.personName, stringValue(value.projectName, '')),
        occurredAt ? recordDate(occurredAt) : '',
      ].filter(Boolean).join(' · '),
      ...(amountMinor !== null ? { trailing: money(amountMinor, currency) } : {}),
    };
  }

  if ((type === 'person_created' || type === 'person_linked' || type === 'person_expense_total')
    && typeof value.personId === 'string') {
    return {
      id: value.personId,
      recordType: 'person',
      title: stringValue(value.personName, 'الشخص المرتبط'),
      subtitle: 'فتح تفاصيل الشخص',
    };
  }

  if ((type === 'project_created' || type === 'project_people')
    && typeof value.projectId === 'string') {
    return {
      id: value.projectId,
      recordType: 'project',
      title: stringValue(value.projectName, 'المشروع المرتبط'),
      subtitle: 'فتح تفاصيل المشروع',
    };
  }

  if (type === 'reminder_created' && typeof value.reminderId === 'string') {
    return {
      id: value.reminderId,
      recordType: 'reminder',
      title: stringValue(value.text, 'تذكير محفوظ'),
      subtitle: typeof value.dueAt === 'string' ? recordDate(value.dueAt) : 'فتح تفاصيل التذكير',
      trailing: statusLabel(typeof value.status === 'string' ? value.status : null),
    };
  }

  return undefined;
}

function addOrigin(record: MobileRecordRow, conversationId: string, operationId?: string | null): MobileRecordRow {
  return {
    ...record,
    origin: {
      conversationId,
      turnId: null,
      operationId: operationId ?? null,
    },
  };
}

function messagesFromConversation(detail: unknown, conversationId: string): LocalMessage[] {
  const turns = arrayValue(objectValue(detail).recentTurns);
  const loadedMessages: LocalMessage[] = [];

  turns.forEach((rawTurn, index) => {
    const turn = objectValue(rawTurn);
    const turnId = typeof turn.turnId === 'string' ? turn.turnId : `turn-${index}`;
    const createdAt = typeof turn.createdAt === 'string' ? turn.createdAt : new Date().toISOString();
    const action = Object.keys(objectValue(turn.action)).length > 0 ? objectValue(turn.action) : undefined;
    const recordLink = action ? recordLinkFromAction(action) : undefined;
    const linkedRecord = recordLink ? addOrigin(recordLink, conversationId, typeof action?.operationId === 'string' ? action.operationId : null) : undefined;

    if (typeof turn.userMessage === 'string') {
      loadedMessages.push({
        id: `${conversationId}-${turnId}-user`,
        role: 'user',
        text: turn.userMessage,
        createdAt,
      });
    }
    if (typeof turn.assistantMessage === 'string') {
      loadedMessages.push({
        id: `${conversationId}-${turnId}-assistant`,
        role: 'assistant',
        text: turn.assistantMessage,
        createdAt,
        approval: action ? approvalFromAction(action) : undefined,
        ...(linkedRecord ? { recordLink: linkedRecord } : {}),
      });
    }
  });

  return loadedMessages.length > 0 ? loadedMessages : [starterMessage];
}

function messageTime(value: string) {
  if (value === starterMessage.createdAt) return 'الآن';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'الآن';
  return new Intl.DateTimeFormat('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function RecordsView({
  colors,
  onOpenRecord,
  onBack,
}: {
  colors: ReturnType<typeof useColors>;
  onOpenRecord: (record: MobileRecordRow) => void;
  onBack?: () => void;
}) {
  const recordsQuery = useListRecords({
    query: {
      queryKey: getListRecordsQueryKey(),
      staleTime: 20_000,
    },
  });
  const sections = recordSections(recordsQuery.data);
  const totalRecords = sections.reduce((total, section) => total + section.data.length, 0);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <Pressable
          testID={`record-${item.recordType}-${item.id}`}
          accessibilityRole="button"
          accessibilityLabel={`فتح ${item.title}`}
          onPress={() => onOpenRecord(item)}
          style={({ pressed }) => [
            styles.recordRow,
            { borderBottomColor: colors.border, opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <View style={styles.recordCopy}>
            <Text style={[styles.recordTitle, { color: colors.foreground }]} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={[styles.recordSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
              {item.subtitle}
            </Text>
          </View>
          {item.trailing && (
            <Text style={[styles.recordTrailing, { color: colors.primary }]} numberOfLines={2}>
              {item.trailing}
            </Text>
          )}
          <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
        </Pressable>
      )}
      renderSectionHeader={({ section }) => (
        <View style={[styles.recordSectionHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <View style={styles.recordSectionTitle}>
            <View style={[styles.recordIcon, { backgroundColor: colors.muted }]}>
              <Feather name={section.icon} size={15} color={colors.primary} />
            </View>
            <Text style={[styles.recordSectionName, { color: colors.foreground }]}>{section.title}</Text>
          </View>
          <Text style={[styles.recordCount, { color: colors.mutedForeground }]}>{section.data.length}</Text>
        </View>
      )}
      ListHeaderComponent={(
        <View>
          <View style={styles.recordsIntro}>
            <View>
              <Text style={[styles.recordsTitle, { color: colors.foreground }]}>الرئيسية</Text>
              <Text style={[styles.recordsSubtitle, { color: colors.mutedForeground }]}>
                بياناتك المهمة في مكان واحد
              </Text>
            </View>
            <View style={styles.recordsHeaderActions}>
              {onBack && (
                <Pressable
                  testID="records-back-to-office"
                  accessibilityRole="button"
                  accessibilityLabel="العودة إلى مكتب السكرتير"
                  onPress={onBack}
                  style={({ pressed }) => [
                    styles.iconButton,
                    { borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                  ]}
                >
                  <Feather name="arrow-right" size={17} color={colors.foreground} />
                </Pressable>
              )}
              <Pressable
                testID="refresh-records"
                accessibilityRole="button"
                accessibilityLabel="تحديث السجلات"
                onPress={() => void recordsQuery.refetch()}
                style={({ pressed }) => [
                  styles.iconButton,
                  { borderColor: colors.border, opacity: pressed || recordsQuery.isFetching ? 0.6 : 1 },
                ]}
              >
                {recordsQuery.isFetching ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Feather name="refresh-cw" size={17} color={colors.foreground} />
                )}
              </Pressable>
            </View>
          </View>

          <View style={styles.recordSummaryGrid}>
            {sections.map((section) => (
              <View key={section.key} style={[styles.recordSummaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.recordSummaryCount, { color: colors.primary }]}>{section.data.length}</Text>
                <Text style={[styles.recordSummaryLabel, { color: colors.mutedForeground }]}>{section.title}</Text>
              </View>
            ))}
          </View>

          {recordsQuery.isError && (
            <View style={[styles.recordsError, { backgroundColor: colors.destructive, borderColor: colors.destructive }]}>
              <Feather name="alert-circle" size={16} color={colors.destructiveForeground} />
              <View style={styles.recordsErrorCopy}>
                <Text style={[styles.recordsErrorTitle, { color: colors.destructiveForeground }]}>تعذر تحميل الرئيسية</Text>
                <Text style={[styles.recordsErrorText, { color: colors.destructiveForeground }]}>
                  تحقق من الاتصال وحاول التحديث مرة أخرى.
                </Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => void recordsQuery.refetch()}>
                <Text style={[styles.recordsRetry, { color: colors.destructiveForeground }]}>حاول</Text>
              </Pressable>
            </View>
          )}

          {recordsQuery.isLoading && (
            <View style={styles.recordsLoading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.recordsLoadingText, { color: colors.mutedForeground }]}>جاري تحميل بياناتك…</Text>
            </View>
          )}

          {!recordsQuery.isLoading && !recordsQuery.isError && totalRecords === 0 && (
            <View style={[styles.recordsEmpty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="archive" size={26} color={colors.primary} />
              <Text style={[styles.recordsEmptyTitle, { color: colors.foreground }]}>لا توجد سجلات بعد</Text>
              <Text style={[styles.recordsEmptyText, { color: colors.mutedForeground }]}>
                أي مصروف أو تذكير أو مهمة تحفظها سيظهر هنا.
              </Text>
            </View>
          )}
        </View>
      )}
      contentContainerStyle={styles.recordsList}
      stickySectionHeadersEnabled={false}
      showsVerticalScrollIndicator={false}
      refreshControl={(
        <RefreshControl
          refreshing={recordsQuery.isFetching}
          onRefresh={() => void recordsQuery.refetch()}
          tintColor={colors.primary}
        />
      )}
    />
  );
}

function MainOffice({
  colors,
  onOpenRecord,
  onOpenRecords,
  onOpenQuick,
  onAskSecretary,
  pendingApprovals,
  lastAssistantMessage,
  draft,
  onChangeDraft,
  onSend,
  inputRef,
  isSending,
  onApprove,
  onReject,
  busyOperationId,
  recordOrigins,
}: {
  colors: ReturnType<typeof useColors>;
  onOpenRecord: (record: MobileRecordRow) => void;
  onOpenRecords: () => void;
  onOpenQuick: () => void;
  onAskSecretary: (draft: string) => void;
  pendingApprovals: Approval[];
  lastAssistantMessage: LocalMessage | null;
  draft: string;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  inputRef: { current: TextInput | null };
  isSending: boolean;
  onApprove: (approval: Approval) => void;
  onReject: (approval: Approval) => void;
  busyOperationId: string | null;
  recordOrigins: Record<string, RecordOrigin>;
}) {
  const todayQuery = useGetTodayContext({
    query: {
      queryKey: getGetTodayContextQueryKey(),
      staleTime: 30_000,
    },
  });
  const [financialExpanded, setFinancialExpanded] = useState(false);
  const recordsQuery = useListRecords({
    query: {
      queryKey: getListRecordsQueryKey(),
      enabled: financialExpanded,
      staleTime: 20_000,
    },
  });
  const context = todayQuery.data?.context;
  const recentTotal = context
    ? [...context.recentExpenses.reduce((totals, expense) => {
      totals.set(expense.currency, (totals.get(expense.currency) ?? 0) + expense.amountMinor);
      return totals;
    }, new Map<string, number>())].map(([currency, amount]) => money(amount, currency)).join('، ')
    : '';
  const attentionCount = pendingApprovals.length
    + (context?.pendingTasks.length ?? 0)
    + (context?.upcomingReminders.length ?? 0);

  function openReminder(reminder: TodayContextReminder) {
    onOpenRecord({
      id: reminder.id,
      recordType: 'reminder',
      title: reminder.text,
      subtitle: `${recordDate(reminder.dueAt)} · ${reminder.timezone}`,
      trailing: statusLabel(reminder.status),
    });
  }

  function openTask(task: TodayContextTask) {
    onOpenRecord({
      id: task.id,
      recordType: 'task',
      title: task.title,
      subtitle: task.dueAt ? `موعدها ${recordDate(task.dueAt)}` : 'مهمة مستمرة',
      trailing: statusLabel(task.status),
    });
  }

  const financialSections = recordSections(recordsQuery.data);
  const commitmentSection = financialSections.find((section) => section.key === 'commitments');

  return (
    <ScrollView
      contentContainerStyle={styles.officeList}
      showsVerticalScrollIndicator={false}
      refreshControl={(
        <RefreshControl
          refreshing={todayQuery.isFetching}
          onRefresh={() => void todayQuery.refetch()}
          tintColor={colors.primary}
        />
      )}
    >
      <View style={styles.officeIntro}>
        <View style={styles.officeIntroCopy}>
          <Text style={[styles.officeEyebrow, { color: colors.primary }]}>مكتب السكرتير</Text>
          <Text style={[styles.officeGreeting, { color: colors.foreground }]}>
            {new Date().getHours() < 12 ? 'صباح الخير' : new Date().getHours() < 17 ? 'نهارك هادئ' : 'مساء الخير'}
          </Text>
          <Text style={[styles.officeSubtitle, { color: colors.mutedForeground }]}>
            نظرة هادئة على ما يستحق انتباهك اليوم.
          </Text>
        </View>
        <Pressable
          testID="refresh-office"
          accessibilityRole="button"
          accessibilityLabel="تحديث مكتب السكرتير"
          onPress={() => void todayQuery.refetch()}
          style={({ pressed }) => [
            styles.officeRefresh,
            { borderColor: colors.border, opacity: pressed || todayQuery.isFetching ? 0.6 : 1 },
          ]}
        >
          {todayQuery.isFetching ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="refresh-cw" size={16} color={colors.foreground} />
          )}
        </Pressable>
      </View>

      <View style={[styles.officeChatPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.officeChatHeading}>
          <View style={[styles.officeChatIcon, { backgroundColor: colors.muted }]}>
            <Feather name="message-circle" size={16} color={colors.primary} />
          </View>
          <View style={styles.officeChatHeadingCopy}>
            <Text style={[styles.officeChatTitle, { color: colors.foreground }]}>تحدث مع السكرتير</Text>
            <Text style={[styles.officeChatHint, { color: colors.mutedForeground }]}>اسأل، اطلب، أو ابدأ إجراءً من داخل المكتب</Text>
          </View>
        </View>
        {lastAssistantMessage && (
          <View style={styles.officeChatReply}>
            <MessageBubble
              message={lastAssistantMessage}
              colors={colors}
              onApprove={onApprove}
              onReject={onReject}
              onOpenRecord={onOpenRecord}
              busyOperationId={busyOperationId}
            />
          </View>
        )}
        {isSending && (
          <View style={[styles.officeChatTyping, { backgroundColor: colors.muted }]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.officeChatTypingText, { color: colors.mutedForeground }]}>السكرتير يفكر…</Text>
          </View>
        )}
        <View style={[styles.officeChatComposer, { backgroundColor: colors.background, borderColor: colors.input }]}>
          <TextInput
            ref={inputRef}
            testID="main-message-input"
            value={draft}
            onChangeText={onChangeDraft}
            onSubmitEditing={onSend}
            placeholder="اكتب طلبًا للسكرتير…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={1000}
            returnKeyType="send"
            blurOnSubmit={false}
            textAlign="right"
            style={[styles.officeChatInput, { color: colors.foreground }]}
          />
          <Pressable
            testID="main-send-message"
            accessibilityRole="button"
            accessibilityLabel="إرسال طلب من المكتب"
            onPress={onSend}
            disabled={!draft.trim() || isSending}
            style={({ pressed }) => [
              styles.officeChatSend,
              { backgroundColor: colors.primary, opacity: !draft.trim() || isSending ? 0.4 : pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="arrow-up" size={17} color={colors.primaryForeground} />
          </Pressable>
        </View>
        <Text style={[styles.officeChatFooter, { color: colors.mutedForeground }]}>نفس محادثتك في السريع · التغييرات الحساسة تحتاج موافقتك</Text>
      </View>

      {todayQuery.isError && (
        <View style={[styles.officeError, { backgroundColor: colors.destructive, borderColor: colors.destructive }]}>
          <Feather name="alert-circle" size={16} color={colors.destructiveForeground} />
          <Text style={[styles.officeErrorText, { color: colors.destructiveForeground }]}>
            تعذر تحميل موجز اليوم.
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void todayQuery.refetch()}>
            <Text style={[styles.recordsRetry, { color: colors.destructiveForeground }]}>حاول</Text>
          </Pressable>
        </View>
      )}

      {todayQuery.isLoading && (
        <View style={styles.officeLoading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.recordsLoadingText, { color: colors.mutedForeground }]}>السكرتير يجهز الموجز…</Text>
        </View>
      )}

      {!todayQuery.isLoading && !todayQuery.isError && context && (
        <>
          <View style={[styles.officePulse, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.officePulseItem}>
              <Text style={[styles.officePulseValue, { color: colors.primary }]}>{context.pendingTasks.length}</Text>
              <Text style={[styles.officePulseLabel, { color: colors.mutedForeground }]}>مهام مفتوحة</Text>
            </View>
            <View style={[styles.officePulseDivider, { backgroundColor: colors.border }]} />
            <View style={styles.officePulseItem}>
              <Text style={[styles.officePulseValue, { color: colors.primary }]}>{context.upcomingReminders.length}</Text>
              <Text style={[styles.officePulseLabel, { color: colors.mutedForeground }]}>تذكيرات قادمة</Text>
            </View>
            <View style={[styles.officePulseDivider, { backgroundColor: colors.border }]} />
            <View style={styles.officePulseItem}>
              <Text style={[styles.officePulseValue, { color: colors.primary }]}>{context.activeProjects.length}</Text>
              <Text style={[styles.officePulseLabel, { color: colors.mutedForeground }]}>مشاريع نشطة</Text>
            </View>
          </View>

          <View style={styles.officeSection}>
            <View style={styles.officeSectionHeading}>
              <View>
                <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>يحتاج انتباهك</Text>
                <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>
                  {attentionCount > 0 ? `${attentionCount} أشياء تستحق نظرة` : 'كل شيء هادئ الآن'}
                </Text>
              </View>
              <Feather name={attentionCount > 0 ? 'bell' : 'check-circle'} size={18} color={attentionCount > 0 ? colors.primary : colors.accent} />
            </View>
            {attentionCount === 0 ? (
              <View style={[styles.officeCalm, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Text style={[styles.officeCalmText, { color: colors.mutedForeground }]}>
                  لا توجد مهام عاجلة أو موافقات معلّقة.
                </Text>
              </View>
            ) : (
              <View style={styles.officeActionList}>
                {pendingApprovals.slice(0, 2).map((approval) => (
                  <Pressable
                    key={approval.operationId}
                    testID={`office-approval-${approval.operationId}`}
                    accessibilityRole="button"
                    onPress={onOpenQuick}
                    style={({ pressed }) => [
                      styles.officeActionRow,
                      { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                    ]}
                  >
                    <View style={[styles.officeActionIcon, { backgroundColor: colors.destructive }]}>
                      <Feather name="check-circle" size={15} color={colors.destructiveForeground} />
                    </View>
                    <View style={styles.officeActionCopy}>
                      <Text style={[styles.officeActionTitle, { color: colors.foreground }]} numberOfLines={1}>{approval.title}</Text>
                      <Text style={[styles.officeActionMeta, { color: colors.mutedForeground }]}>موافقة مطلوبة · افتح السكرتير</Text>
                    </View>
                    <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
                  </Pressable>
                ))}
                {context.upcomingReminders.slice(0, 2).map((reminder) => (
                  <Pressable
                    key={`reminder-${reminder.id}`}
                    testID={`office-reminder-${reminder.id}`}
                    accessibilityRole="button"
                    onPress={() => openReminder(reminder)}
                    style={({ pressed }) => [
                      styles.officeActionRow,
                      { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                    ]}
                  >
                    <View style={[styles.officeActionIcon, { backgroundColor: colors.muted }]}>
                      <Feather name="clock" size={15} color={colors.primary} />
                    </View>
                    <View style={styles.officeActionCopy}>
                      <Text style={[styles.officeActionTitle, { color: colors.foreground }]} numberOfLines={1}>{reminder.text}</Text>
                      <Text style={[styles.officeActionMeta, { color: colors.mutedForeground }]}>{recordDate(reminder.dueAt)}</Text>
                    </View>
                    <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
                  </Pressable>
                ))}
                {context.pendingTasks.slice(0, 2).map((task) => (
                  <Pressable
                    key={`task-${task.id}`}
                    testID={`office-task-${task.id}`}
                    accessibilityRole="button"
                    onPress={() => openTask(task)}
                    style={({ pressed }) => [
                      styles.officeActionRow,
                      { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                    ]}
                  >
                    <View style={[styles.officeActionIcon, { backgroundColor: colors.muted }]}>
                      <Feather name="check-square" size={15} color={colors.primary} />
                    </View>
                    <View style={styles.officeActionCopy}>
                      <Text style={[styles.officeActionTitle, { color: colors.foreground }]} numberOfLines={1}>{task.title}</Text>
                      <Text style={[styles.officeActionMeta, { color: colors.mutedForeground }]}>{task.dueAt ? recordDate(task.dueAt) : 'مهمة مستمرة'}</Text>
                    </View>
                    <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={styles.officeSection}>
            <View style={styles.officeSectionHeading}>
              <View>
                <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>اليوم</Text>
                <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>ما يعرفه السكرتير عن يومك الآن</Text>
              </View>
              <Feather name="sun" size={18} color={colors.primary} />
            </View>
            <View style={styles.officeTodayList}>
              {context.upcomingReminders.slice(0, 3).map((reminder) => (
                <Pressable key={`today-${reminder.id}`} onPress={() => openReminder(reminder)} style={styles.officeTodayRow}>
                  <Text style={[styles.officeTodayTime, { color: colors.primary }]}>{recordDate(reminder.dueAt)}</Text>
                  <Text style={[styles.officeTodayText, { color: colors.foreground }]} numberOfLines={1}>{reminder.text}</Text>
                </Pressable>
              ))}
              {context.pendingTasks.slice(0, 3).map((task) => (
                <Pressable key={`today-task-${task.id}`} onPress={() => openTask(task)} style={styles.officeTodayRow}>
                  <Text style={[styles.officeTodayTime, { color: colors.mutedForeground }]}>{task.dueAt ? recordDate(task.dueAt) : 'مفتوحة'}</Text>
                  <Text style={[styles.officeTodayText, { color: colors.foreground }]} numberOfLines={1}>{task.title}</Text>
                </Pressable>
              ))}
              {context.upcomingReminders.length === 0 && context.pendingTasks.length === 0 && (
                <Text style={[styles.officeEmptyLine, { color: colors.mutedForeground }]}>لا يوجد شيء مجدول في الموجز الحالي.</Text>
              )}
            </View>
          </View>

          <View style={styles.officeSection}>
            <View style={styles.officeSectionHeading}>
              <View>
                <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>النبض المالي</Text>
                <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>
                  {recentTotal ? `${recentTotal} في أحدث المصروفات` : 'لا توجد حركة مالية حديثة'}
                </Text>
              </View>
              <Feather name="dollar-sign" size={18} color={colors.primary} />
            </View>
            <View style={[styles.officeFinancialRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.officeFinancialCopy}>
                <Text style={[styles.officeFinancialTitle, { color: colors.foreground }]}>آخر المصروفات</Text>
                <Text style={[styles.officeFinancialMeta, { color: colors.mutedForeground }]}>{context.recentExpenses.length} سجلات محدودة</Text>
              </View>
              <Pressable
                testID="office-financial-toggle"
                accessibilityRole="button"
                onPress={() => setFinancialExpanded((expanded) => !expanded)}
                style={({ pressed }) => [
                  styles.officeInlineAction,
                  { borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <Text style={[styles.officeInlineActionText, { color: colors.foreground }]}>
                  {financialExpanded ? 'إخفاء التفاصيل' : 'عرض الالتزامات'}
                </Text>
                <Feather name={financialExpanded ? 'chevron-up' : 'chevron-left'} size={14} color={colors.foreground} />
              </Pressable>
            </View>
            {financialExpanded && (
              <View style={[styles.officeExpandedPanel, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                {recordsQuery.isLoading ? (
                  <ActivityIndicator color={colors.primary} />
                ) : recordsQuery.isError ? (
                  <Text style={[styles.officeEmptyLine, { color: colors.mutedForeground }]}>تعذر تحميل التفاصيل المالية.</Text>
                ) : (
                  <>
                    <Text style={[styles.officeExpandedTitle, { color: colors.foreground }]}>
                      {commitmentSection?.data.length ?? 0} التزامات محفوظة
                    </Text>
                    {(commitmentSection?.data ?? []).slice(0, 3).map((commitment) => (
                      <Pressable key={commitment.id} onPress={() => onOpenRecord(commitment)} style={styles.officeTodayRow}>
                        <Text style={[styles.officeTodayTime, { color: colors.mutedForeground }]}>{commitment.trailing ?? 'مفتوح'}</Text>
                        <Text style={[styles.officeTodayText, { color: colors.foreground }]} numberOfLines={1}>{commitment.title}</Text>
                      </Pressable>
                    ))}
                    <Pressable testID="office-open-all-records-financial" onPress={onOpenRecords}>
                      <Text style={[styles.officeMoreLink, { color: colors.primary }]}>استكشف كل السجلات المالية</Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}
          </View>

          <View style={styles.officeSection}>
            <View style={styles.officeSectionHeading}>
              <View>
                <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>النشاط الأخير</Text>
                <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>مصروفات حديثة يمكنك فتح تفاصيلها</Text>
              </View>
              <Feather name="activity" size={18} color={colors.primary} />
            </View>
            <View style={styles.officeActivityList}>
              {context.recentExpenses.slice(0, 4).map((expense) => (
                <Pressable
                  key={`expense-${expense.id}`}
                  testID={`office-expense-${expense.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`فتح تفاصيل ${expense.description}`}
                  onPress={() => onOpenRecord({
                    id: expense.id,
                    recordType: 'expense',
                    title: expense.description,
                    subtitle: [expense.personName ?? expense.projectName, recordDate(expense.occurredAt)].filter(Boolean).join(' · '),
                    trailing: money(expense.amountMinor, expense.currency),
                    origin: recordOrigins[expense.id] ?? null,
                  })}
                  style={({ pressed }) => [
                    styles.officeActivityRow,
                    { borderBottomColor: colors.border, opacity: pressed ? 0.65 : 1 },
                  ]}
                >
                  <Text style={[styles.officeActivityAmount, { color: colors.primary }]}>{money(expense.amountMinor, expense.currency)}</Text>
                  <View style={styles.officeActivityCopy}>
                    <Text style={[styles.officeActivityTitle, { color: colors.foreground }]} numberOfLines={1}>{expense.description}</Text>
                    <Text style={[styles.officeActivityMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {expense.personName ?? expense.projectName ?? recordDate(expense.occurredAt)}
                    </Text>
                  </View>
                  <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
                </Pressable>
              ))}
              {context.recentExpenses.length === 0 && (
                <Text style={[styles.officeEmptyLine, { color: colors.mutedForeground }]}>لا توجد مصروفات حديثة في الموجز الحالي.</Text>
              )}
            </View>
          </View>

          <View style={styles.officeSection}>
            <View style={styles.officeSectionHeading}>
              <View>
                <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>السياق النشط</Text>
                <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>أشخاص ومشاريع في الصورة الآن</Text>
              </View>
              <Feather name="layers" size={18} color={colors.primary} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.officeEntityRail}>
              {context.relevantPeople.slice(0, 5).map((person) => (
                <Pressable
                  key={`person-${person.id}`}
                  testID={`office-person-${person.id}`}
                  onPress={() => onOpenRecord({ id: person.id, recordType: 'person', title: person.name, subtitle: 'فتح مركز الشخص' })}
                  style={({ pressed }) => [
                    styles.officeEntityTile,
                    { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                  ]}
                >
                  <View style={[styles.officeEntityIcon, { backgroundColor: colors.muted }]}>
                    <Feather name="user" size={15} color={colors.primary} />
                  </View>
                  <Text style={[styles.officeEntityName, { color: colors.foreground }]} numberOfLines={1}>{person.name}</Text>
                  <Text style={[styles.officeEntityMeta, { color: colors.mutedForeground }]}>مركز الشخص</Text>
                </Pressable>
              ))}
              {context.activeProjects.slice(0, 5).map((project) => (
                <Pressable
                  key={`project-${project.id}`}
                  testID={`office-project-${project.id}`}
                  onPress={() => onOpenRecord({ id: project.id, recordType: 'project', title: project.name, subtitle: 'فتح مركز المشروع' })}
                  style={({ pressed }) => [
                    styles.officeEntityTile,
                    { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                  ]}
                >
                  <View style={[styles.officeEntityIcon, { backgroundColor: colors.muted }]}>
                    <Feather name="briefcase" size={15} color={colors.primary} />
                  </View>
                  <Text style={[styles.officeEntityName, { color: colors.foreground }]} numberOfLines={1}>{project.name}</Text>
                  <Text style={[styles.officeEntityMeta, { color: colors.mutedForeground }]}>مركز المشروع</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <View style={styles.officeSection}>
            <View style={styles.officeSectionHeading}>
              <View>
                <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>ماذا يمكن أن يفعل السكرتير؟</Text>
                <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>ابدأ من فضولك، وليس من قائمة إعدادات</Text>
              </View>
              <Feather name="compass" size={18} color={colors.primary} />
            </View>
            <View style={styles.officeSuggestions}>
              {[
                ['اسأل عن آخر مصروف مرتبط بشخص', 'محمد أخد مني كام؟'],
                ['راجع ما يستحق انتباهك اليوم', 'إيه اللي عليا النهارده؟'],
                ['سجّل شيء جديد بسرعة', 'دفعت لمحمد 5000'],
              ].map(([label, draft]) => (
                <Pressable
                  key={draft}
                  testID={`office-suggestion-${draft}`}
                  onPress={() => onAskSecretary(draft)}
                  style={({ pressed }) => [
                    styles.officeSuggestionRow,
                    { borderBottomColor: colors.border, opacity: pressed ? 0.65 : 1 },
                  ]}
                >
                  <Feather name="arrow-up-left" size={15} color={colors.primary} />
                  <View style={styles.officeSuggestionCopy}>
                    <Text style={[styles.officeSuggestionLabel, { color: colors.foreground }]}>{label}</Text>
                    <Text style={[styles.officeSuggestionDraft, { color: colors.mutedForeground }]}>{draft}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>

          <Pressable
            testID="open-all-records"
            accessibilityRole="button"
            onPress={onOpenRecords}
            style={({ pressed }) => [
              styles.officeExploreButton,
              { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="archive" size={16} color={colors.primaryForeground} />
            <Text style={[styles.officeExploreText, { color: colors.primaryForeground }]}>استكشف كل معلوماتك</Text>
            <Feather name="arrow-left" size={16} color={colors.primaryForeground} />
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const detailStyles = StyleSheet.create({
  detailScreen: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  detailHeader: {
    minHeight: 42,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailEyebrow: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  detailCard: {
    marginTop: 14,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    alignItems: 'flex-end',
  },
  detailIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailTitle: {
    width: '100%',
    marginTop: 16,
    fontSize: 21,
    fontWeight: '700',
    lineHeight: 29,
    textAlign: 'right',
  },
  detailSubtitle: {
    width: '100%',
    marginTop: 7,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'right',
  },
  detailMeta: {
    width: '100%',
    marginTop: 8,
    fontSize: 12,
    textAlign: 'right',
  },
  detailValue: {
    marginTop: 14,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
  },
  detailState: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  detailStateText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  detailRetry: {
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  relatedCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 13,
  },
  relatedTitle: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  relatedRow: {
    minHeight: 42,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  relatedLabel: {
    fontSize: 12,
    textAlign: 'right',
  },
  relatedCount: {
    fontSize: 13,
    fontWeight: '700',
  },
  detailContext: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 9,
  },
  detailContextCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  detailContextTitle: {
    width: '100%',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  detailContextText: {
    width: '100%',
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  detailPrimaryAction: {
    minHeight: 48,
    marginTop: 18,
    borderRadius: 15,
    paddingHorizontal: 16,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  detailPrimaryActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  detailSecondaryAction: {
    minHeight: 44,
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  detailSecondaryActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
});

function RecordDetailView({
  record,
  colors,
  onBack,
  onAskSecretary,
  onOpenConversation,
}: {
  record: MobileRecordRow;
  colors: ReturnType<typeof useColors>;
  onBack: () => void;
  onAskSecretary: () => void;
  onOpenConversation?: (origin: RecordOrigin) => void;
}) {
  const isEntity = record.recordType === 'person' || record.recordType === 'project';
  const entityType = record.recordType === 'person' ? 'person' : 'project';
  const entityQuery = useGetEntityGraph(entityType, record.id, {
    query: {
      enabled: isEntity,
      queryKey: [`/api/entities/${entityType}/${record.id}`],
      staleTime: 20_000,
    },
  });
  const entityData = objectValue(entityQuery.data);
  const entity = objectValue(entityData.entity);
  const related = objectValue(entityData.related);
  const entityName = stringValue(entity.name, record.title);
  const entitySubtitle = record.recordType === 'person'
    ? stringValue(entity.notes, stringValue(entity.phone, record.subtitle))
    : `الحالة: ${stringValue(entity.status, record.trailing ?? 'غير محددة')}`;
  const relatedGroups = Object.entries(related)
    .map(([key, value]) => ({ key, count: arrayValue(value).length }))
    .filter((group) => group.count > 0);

  return (
    <View style={detailStyles.detailScreen}>
      <View style={detailStyles.detailHeader}>
        <Pressable
          testID="record-detail-back"
          accessibilityRole="button"
          accessibilityLabel="العودة إلى الرئيسية"
          onPress={onBack}
          style={({ pressed }) => [
            styles.iconButton,
            { borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <Feather name="arrow-right" size={17} color={colors.foreground} />
        </Pressable>
        <Text style={[detailStyles.detailEyebrow, { color: colors.mutedForeground }]}>تفاصيل السجل</Text>
      </View>

      <View style={[detailStyles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[detailStyles.detailIcon, { backgroundColor: colors.muted }]}>
          <Feather name="file-text" size={20} color={colors.primary} />
        </View>
        <Text style={[detailStyles.detailTitle, { color: colors.foreground }]}>{isEntity ? entityName : record.title}</Text>
        <Text style={[detailStyles.detailSubtitle, { color: colors.mutedForeground }]}>
          {isEntity ? entitySubtitle : record.subtitle}
        </Text>
        {isEntity && typeof entity.phone === 'string' && (
          <Text style={[detailStyles.detailMeta, { color: colors.mutedForeground }]}>{entity.phone}</Text>
        )}
        {!isEntity && record.trailing && <Text style={[detailStyles.detailValue, { color: colors.primary }]}>{record.trailing}</Text>}
      </View>

      {isEntity && entityQuery.isLoading && (
        <View style={detailStyles.detailState}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[detailStyles.detailStateText, { color: colors.mutedForeground }]}>جاري تحميل تفاصيل الكيان…</Text>
        </View>
      )}

      {isEntity && entityQuery.isError && (
        <View style={[detailStyles.detailState, { backgroundColor: colors.destructive, borderColor: colors.destructive }]}>
          <Feather name="alert-circle" size={16} color={colors.destructiveForeground} />
          <Text style={[detailStyles.detailStateText, { color: colors.destructiveForeground }]}>
            تعذر تحميل التفاصيل من السجل الحالي.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إعادة تحميل التفاصيل"
            onPress={() => void entityQuery.refetch()}
          >
            <Text style={[detailStyles.detailRetry, { color: colors.destructiveForeground }]}>حاول</Text>
          </Pressable>
        </View>
      )}

      {isEntity && !entityQuery.isLoading && !entityQuery.isError && relatedGroups.length > 0 && (
        <View style={[detailStyles.relatedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[detailStyles.relatedTitle, { color: colors.foreground }]}>مرتبط بهذا الكيان</Text>
          {relatedGroups.map((group) => (
            <View key={group.key} style={[detailStyles.relatedRow, { borderBottomColor: colors.border }]}>
              <Text style={[detailStyles.relatedLabel, { color: colors.mutedForeground }]}>
                {relatedLabels[group.key] ?? group.key}
              </Text>
              <Text style={[detailStyles.relatedCount, { color: colors.primary }]}>{group.count}</Text>
            </View>
          ))}
        </View>
      )}

      {record.origin && onOpenConversation && (
        <Pressable
          testID="open-original-conversation"
          accessibilityRole="button"
          accessibilityLabel="فتح المحادثة الأصلية"
          onPress={() => onOpenConversation(record.origin as RecordOrigin)}
          style={({ pressed }) => [
            detailStyles.detailSecondaryAction,
            { borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <Feather name="corner-up-left" size={16} color={colors.foreground} />
          <Text style={[detailStyles.detailSecondaryActionText, { color: colors.foreground }]}>
            فتح المحادثة الأصلية
          </Text>
        </Pressable>
      )}

      <View style={[detailStyles.detailContext, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        <Feather name="message-circle" size={17} color={colors.primary} />
        <View style={detailStyles.detailContextCopy}>
          <Text style={[detailStyles.detailContextTitle, { color: colors.foreground }]}>تحدث مع السكرتير عن هذا السجل</Text>
          <Text style={[detailStyles.detailContextText, { color: colors.mutedForeground }]}>
            سأجهز لك مسودة مرتبطة بالسجل، ويمكنك تعديلها قبل الإرسال.
          </Text>
        </View>
      </View>

      <Pressable
        testID="ask-secretary-about-record"
        accessibilityRole="button"
        accessibilityLabel="اسأل السكرتير عن هذا السجل"
        onPress={onAskSecretary}
        style={({ pressed }) => [
          detailStyles.detailPrimaryAction,
          { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Feather name="message-circle" size={16} color={colors.primaryForeground} />
        <Text style={[detailStyles.detailPrimaryActionText, { color: colors.primaryForeground }]}>اسأل السكرتير عن هذا</Text>
      </Pressable>
    </View>
  );
}

function MessageBubble({
  message,
  colors,
  onApprove,
  onReject,
  onOpenRecord,
  busyOperationId,
}: {
  message: LocalMessage;
  colors: ReturnType<typeof useColors>;
  onApprove: (approval: Approval) => void;
  onReject: (approval: Approval) => void;
  onOpenRecord: (record: MobileRecordRow) => void;
  busyOperationId: string | null;
}) {
  const isUser = message.role === 'user';
  const approvalBusy = message.approval && busyOperationId === message.approval.operationId;
  const isResolved = message.approval?.status === 'completed' || message.approval?.status === 'rejected';

  return (
    <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
      <View
        style={[
          styles.messageBubble,
          {
            backgroundColor: isUser ? colors.primary : colors.card,
            borderColor: isUser ? colors.primary : colors.border,
          },
        ]}
      >
        <Text style={[styles.messageText, { color: isUser ? colors.primaryForeground : colors.foreground }]}>
          {message.text}
        </Text>
        <Text style={[styles.messageTime, { color: isUser ? colors.primaryForeground : colors.mutedForeground }]}>
          {messageTime(message.createdAt)}
        </Text>

        {message.approval && (
          <View style={[styles.approvalCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <View style={styles.approvalHeading}>
              <Feather name="shield" size={15} color={colors.primary} />
              <Text style={[styles.approvalTitle, { color: colors.foreground }]}>{message.approval.title}</Text>
            </View>
            {message.approval.details.map((detail) => (
              <Text key={detail} style={[styles.approvalDetail, { color: colors.mutedForeground }]}>
                {detail}
              </Text>
            ))}
            {isResolved ? (
              <View style={styles.resolvedRow}>
                <Feather
                  name={message.approval.status === 'completed' ? 'check-circle' : 'x-circle'}
                  size={15}
                  color={message.approval.status === 'completed' ? colors.primary : colors.destructive}
                />
                <Text style={[styles.resolvedText, { color: colors.mutedForeground }]}>
                  {message.approval.status === 'completed' ? 'تم التنفيذ' : 'تم الرفض'}
                </Text>
              </View>
            ) : (
              <View style={styles.approvalActions}>
                <Pressable
                  testID={`approve-${message.approval.operationId}`}
                  accessibilityRole="button"
                  accessibilityLabel="اعتماد العملية"
                  onPress={() => onApprove(message.approval as Approval)}
                  disabled={Boolean(approvalBusy)}
                  style={({ pressed }) => [
                    styles.approveButton,
                    { backgroundColor: colors.primary, opacity: pressed || approvalBusy ? 0.65 : 1 },
                  ]}
                >
                  {approvalBusy ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <Feather name="check" size={16} color={colors.primaryForeground} />
                  )}
                  <Text style={[styles.approveText, { color: colors.primaryForeground }]}>اعتماد</Text>
                </Pressable>
                <Pressable
                  testID={`reject-${message.approval.operationId}`}
                  accessibilityRole="button"
                  accessibilityLabel="رفض العملية"
                  onPress={() => onReject(message.approval as Approval)}
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
            style={({ pressed }) => [
              styles.messageLink,
              { borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
            ]}
          >
            <Feather name="arrow-up-left" size={15} color={colors.primary} />
            <Text style={[styles.messageLinkText, { color: colors.primary }]}>فتح التفاصيل</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function QuickSecretaryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [activeView, setActiveView] = useState<'quick' | 'home'>('quick');
  const [mainSection, setMainSection] = useState<'office' | 'records'>('office');
  const [selectedRecord, setSelectedRecord] = useState<MobileRecordRow | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([starterMessage]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [busyOperationId, setBusyOperationId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [conversationToLoad, setConversationToLoad] = useState<string | null>(null);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const createTurn = useCreateTurn();
  const approveOperation = useApproveSecretaryOperation();
  const rejectOperation = useRejectSecretaryOperation();
  const queryClient = useQueryClient();
  const conversationQuery = useGetConversation(conversationToLoad ?? '', {
    query: {
      queryKey: ['getConversation', conversationToLoad],
      enabled: Boolean(conversationToLoad),
      staleTime: 20_000,
    },
  });

  useEffect(() => {
    let cancelled = false;
    const hydrationFallback = setTimeout(() => {
      if (!cancelled) setHydrated(true);
    }, 1_500);
    void AsyncStorage.multiGet([STORAGE_MESSAGES, STORAGE_CONVERSATION]).then(([storedMessages, storedConversation]) => {
      if (cancelled) return;
      if (storedMessages[1]) {
        try {
          const parsed = JSON.parse(storedMessages[1]) as LocalMessage[];
          if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
        } catch {
          setMessages([starterMessage]);
        }
      }
      if (storedConversation[1]) setConversationId(storedConversation[1]);
      setHydrated(true);
    }).catch(() => setHydrated(true)).finally(() => clearTimeout(hydrationFallback));
    return () => {
      cancelled = true;
      clearTimeout(hydrationFallback);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void AsyncStorage.multiSet([
      [STORAGE_MESSAGES, JSON.stringify(messages.slice(-40))],
      [STORAGE_CONVERSATION, conversationId ?? ''],
    ]);
  }, [conversationId, hydrated, messages]);

  useEffect(() => {
    if (!conversationToLoad || loadedConversationId === conversationToLoad || !conversationQuery.data) return;
    setMessages(messagesFromConversation(conversationQuery.data, conversationToLoad));
    setConversationId(conversationToLoad);
    setLoadedConversationId(conversationToLoad);
    setLocalError(null);
  }, [conversationQuery.data, conversationToLoad, loadedConversationId]);

  function appendMessage(message: LocalMessage) {
    setMessages((current) => [...current, message].slice(-40));
  }

  async function sendMessage(value = draft) {
    const message = value.trim();
    if (!message || createTurn.isPending || conversationQuery.isFetching) return;
    setDraft('');
    setLocalError(null);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    appendMessage({
      id: `user-${Date.now()}`,
      role: 'user',
      text: message,
      createdAt: new Date().toISOString(),
    });
    try {
      const result = await createTurn.mutateAsync({
        data: {
          message,
          conversationId: conversationId ?? null,
        },
      });
      setConversationId(result.conversationId);
      const resultRecord = recordLinkFromAction(result.action);
      const linkedRecord = resultRecord
        ? addOrigin(
          resultRecord,
          result.conversationId,
          typeof objectValue(result.action).operationId === 'string' ? objectValue(result.action).operationId as string : null,
        )
        : undefined;
      appendMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: result.assistantMessage || result.response?.message || 'تم استلام طلبك.',
        createdAt: new Date().toISOString(),
        approval: approvalFromAction(result.action),
        ...(linkedRecord ? { recordLink: linkedRecord } : {}),
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setLocalError('لم أتمكن من الوصول للسكرتير. جرّب مرة أخرى.');
      appendMessage({
        id: `error-${Date.now()}`,
        role: 'assistant',
        text: 'حصلت مشكلة مؤقتة في الاتصال. رسالتك لم تُنفّذ.',
        createdAt: new Date().toISOString(),
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  async function updateApproval(approval: Approval, status: ApprovalStatus) {
    setBusyOperationId(approval.operationId);
    setLocalError(null);
    try {
      const response = status === 'completed'
        ? await approveOperation.mutateAsync({ operationId: approval.operationId })
        : await rejectOperation.mutateAsync({ operationId: approval.operationId });
      const responseRecord = recordLinkFromAction(response.action);
      const linkedRecord = responseRecord
        ? addOrigin(
          responseRecord,
          response.conversationId,
          response.operationId,
        )
        : undefined;
      setMessages((current) => current.map((message) => (
        message.approval?.operationId === approval.operationId
          ? {
            ...message,
            approval: { ...approval, status: response.status as ApprovalStatus },
            ...(linkedRecord ? { recordLink: linkedRecord } : {}),
          }
          : message
      )));
      setConversationId(response.conversationId);
      if (response.assistantMessage) {
        appendMessage({
          id: `approval-${Date.now()}`,
          role: 'assistant',
          text: response.assistantMessage,
          createdAt: new Date().toISOString(),
          ...(linkedRecord ? { recordLink: linkedRecord } : {}),
        });
      }
      if (status === 'completed') {
        await queryClient.invalidateQueries({ queryKey: getListRecordsQueryKey() });
      }
      await Haptics.notificationAsync(
        status === 'completed'
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );
    } catch {
      setLocalError('لم يتم حفظ قرار الموافقة. جرّب مرة أخرى.');
    } finally {
      setBusyOperationId(null);
    }
  }

  function startNewConversation() {
    setConversationId(undefined);
    setConversationToLoad(null);
    setLoadedConversationId(null);
    setMessages([starterMessage]);
    setLocalError(null);
    void Haptics.selectionAsync();
  }

  function openHome() {
    setSelectedRecord(null);
    setMainSection('office');
    setActiveView('home');
    void Haptics.selectionAsync();
  }

  function openRecords() {
    setSelectedRecord(null);
    setMainSection('records');
    setActiveView('home');
    void Haptics.selectionAsync();
  }

  function openQuick() {
    setSelectedRecord(null);
    setActiveView('quick');
    void Haptics.selectionAsync();
  }

  function openRecordFromRecords(record: MobileRecordRow) {
    setSelectedRecord(record);
    setMainSection('records');
    setActiveView('home');
    void Haptics.selectionAsync();
  }

  function openRecordFromQuick(record: MobileRecordRow) {
    setSelectedRecord(record);
    setMainSection('office');
    setActiveView('home');
    void Haptics.selectionAsync();
  }

  function openOfficeRecord(record: MobileRecordRow) {
    setSelectedRecord(record);
    setMainSection('office');
    setActiveView('home');
    void Haptics.selectionAsync();
  }

  function openQuickWithDraft(value: string) {
    setDraft(value);
    setSelectedRecord(null);
    setActiveView('quick');
    void Haptics.selectionAsync();
  }

  function openOfficeWithDraft(value: string) {
    setDraft(value);
    setSelectedRecord(null);
    setMainSection('office');
    setActiveView('home');
    setTimeout(() => inputRef.current?.focus(), 0);
    void Haptics.selectionAsync();
  }

  function openOriginalConversation(origin: RecordOrigin) {
    setSelectedRecord(null);
    setActiveView('quick');
    if (origin.conversationId === conversationId) {
      void Haptics.selectionAsync();
      return;
    }
    setConversationToLoad(origin.conversationId);
    setLoadedConversationId(null);
    setLocalError(null);
    void Haptics.selectionAsync();
  }

  function askSecretaryAboutRecord() {
    if (!selectedRecord) return;
    setDraft(`اسألني عن ${selectedRecord.title}`);
    setSelectedRecord(null);
    setActiveView('quick');
    void Haptics.selectionAsync();
  }

  const reversedMessages = [...messages].reverse();
  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant') ?? null;
  const recordOrigins = messages.reduce<Record<string, RecordOrigin>>((origins, message) => {
    if (message.recordLink?.origin) origins[message.recordLink.id] = message.recordLink.origin;
    return origins;
  }, {});
  const topInset = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const bottomInset = insets.bottom + (Platform.OS === 'web' ? 34 : 10);

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <View style={styles.headerTop}>
          <View style={styles.brandBlock}>
            <View style={[styles.brandMark, { backgroundColor: colors.primary }]}>
              <Feather name={activeView === 'quick' ? 'message-circle' : 'grid'} size={18} color={colors.primaryForeground} />
            </View>
            <View>
               <Text style={[styles.brandName, { color: colors.foreground }]}>
                 {activeView === 'quick' ? 'السكرتير' : 'مكتب السكرتير'}
              </Text>
              <View style={styles.availability}>
                <View style={[styles.statusDot, { backgroundColor: colors.accent }]} />
                <Text style={[styles.availabilityText, { color: colors.mutedForeground }]}>
                   {activeView === 'quick' ? 'جاهز للرد السريع' : 'استكشف، راجع، وافهم'}
                </Text>
              </View>
            </View>
          </View>
          {activeView === 'quick' && (
            <Pressable
              testID="new-conversation"
              accessibilityRole="button"
              accessibilityLabel="محادثة جديدة"
              onPress={startNewConversation}
              style={({ pressed }) => [styles.iconButton, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
            >
              <Feather name="edit-3" size={17} color={colors.foreground} />
            </Pressable>
          )}
        </View>
        <View style={[styles.viewSwitcher, { backgroundColor: colors.muted }]}>
          <Pressable
            testID="quick-view-tab"
            accessibilityRole="button"
            accessibilityState={{ selected: activeView === 'quick' }}
            onPress={openQuick}
            style={({ pressed }) => [
              styles.viewTab,
              activeView === 'quick' && { backgroundColor: colors.card },
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="message-circle" size={14} color={activeView === 'quick' ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.viewTabText, { color: activeView === 'quick' ? colors.foreground : colors.mutedForeground }]}>السريع</Text>
          </Pressable>
          <Pressable
            testID="home-view-tab"
            accessibilityRole="button"
            accessibilityLabel="فتح الواجهة الرئيسية"
            accessibilityState={{ selected: activeView === 'home' }}
            onPress={openHome}
            style={({ pressed }) => [
              styles.viewTab,
              activeView === 'home' && { backgroundColor: colors.card },
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
           <Feather name="briefcase" size={14} color={activeView === 'home' ? colors.primary : colors.mutedForeground} />
           <Text style={[styles.viewTabText, { color: activeView === 'home' ? colors.foreground : colors.mutedForeground }]}>المكتب</Text>
          </Pressable>
        </View>
      </View>

       {activeView === 'home' ? (
        selectedRecord ? (
          <RecordDetailView
            record={selectedRecord}
            colors={colors}
            onBack={() => setSelectedRecord(null)}
            onAskSecretary={askSecretaryAboutRecord}
            onOpenConversation={openOriginalConversation}
          />
        ) : (
           mainSection === 'office' ? (
             <MainOffice
               colors={colors}
               onOpenRecord={openOfficeRecord}
               onOpenRecords={openRecords}
               onOpenQuick={openQuick}
               onAskSecretary={openOfficeWithDraft}
               lastAssistantMessage={lastAssistantMessage}
               draft={draft}
               onChangeDraft={setDraft}
               onSend={() => void sendMessage()}
               inputRef={inputRef}
               isSending={createTurn.isPending || conversationQuery.isFetching}
               onApprove={(approval) => void updateApproval(approval, 'completed')}
               onReject={(approval) => void updateApproval(approval, 'rejected')}
               busyOperationId={busyOperationId}
               recordOrigins={recordOrigins}
               pendingApprovals={messages.flatMap((message) => (
                 message.approval && message.approval.status === 'pending' ? [message.approval] : []
               ))}
             />
           ) : (
             <RecordsView colors={colors} onOpenRecord={openRecordFromRecords} onBack={openHome} />
           )
        )
      ) : !hydrated ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          inverted
          data={reversedMessages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              colors={colors}
              onApprove={(approval) => void updateApproval(approval, 'completed')}
              onReject={(approval) => void updateApproval(approval, 'rejected')}
               onOpenRecord={openRecordFromQuick}
              busyOperationId={busyOperationId}
            />
          )}
          contentContainerStyle={styles.messageList}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={createTurn.isPending || conversationQuery.isFetching ? (
            <View style={styles.typingRow}>
              <View style={[styles.typingBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.typingText, { color: colors.mutedForeground }]}>
                  {conversationQuery.isFetching ? 'بفتح المحادثة الأصلية…' : 'بفكر في الرد…'}
                </Text>
              </View>
            </View>
          ) : null}
          ListFooterComponent={messages.length === 1 ? (
            <View style={styles.suggestionsBlock}>
              <Text style={[styles.suggestionsLabel, { color: colors.mutedForeground }]}>ابدأ بطلب سريع</Text>
              <View style={styles.suggestions}>
                {suggestions.map((suggestion) => (
                  <Pressable
                    key={suggestion}
                    testID={`suggestion-${suggestion}`}
                    onPress={() => {
                      setDraft(suggestion);
                      inputRef.current?.focus();
                    }}
                    style={({ pressed }) => [
                      styles.suggestionChip,
                      { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.65 : 1 },
                    ]}
                  >
                    <Text style={[styles.suggestionText, { color: colors.foreground }]}>{suggestion}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        />
      )}

      {activeView === 'quick' && localError && (
        <View style={[styles.errorBanner, { backgroundColor: colors.destructive }]}>
          <Feather name="alert-circle" size={15} color={colors.destructiveForeground} />
          <Text style={[styles.errorText, { color: colors.destructiveForeground }]}>{localError}</Text>
        </View>
      )}

      {activeView === 'quick' && conversationQuery.isError && (
        <View style={[styles.errorBanner, { backgroundColor: colors.destructive }]}>
          <Feather name="alert-circle" size={15} color={colors.destructiveForeground} />
          <Text style={[styles.errorText, { color: colors.destructiveForeground }]}>
            تعذر فتح المحادثة الأصلية.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إعادة فتح المحادثة الأصلية"
            onPress={() => void conversationQuery.refetch()}
          >
            <Text style={[styles.errorRetry, { color: colors.destructiveForeground }]}>حاول</Text>
          </Pressable>
        </View>
      )}

      {activeView === 'quick' && (
      <View style={[styles.composerWrap, { paddingBottom: bottomInset, borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <View style={[styles.composer, { backgroundColor: colors.card, borderColor: colors.input }]}>
          <TextInput
            ref={inputRef}
            testID="quick-message-input"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => void sendMessage()}
            placeholder="اكتب طلبك بسرعة…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={1000}
            returnKeyType="send"
            blurOnSubmit={false}
            textAlign="right"
            style={[styles.input, { color: colors.foreground }]}
          />
          <Pressable
            testID="send-message"
            accessibilityRole="button"
            accessibilityLabel="إرسال الطلب"
            onPress={() => void sendMessage()}
            disabled={!draft.trim() || createTurn.isPending || conversationQuery.isFetching}
            style={({ pressed }) => [
              styles.sendButton,
              { backgroundColor: colors.primary, opacity: !draft.trim() || createTurn.isPending || conversationQuery.isFetching ? 0.4 : pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="arrow-up" size={18} color={colors.primaryForeground} />
          </Pressable>
        </View>
        <Text style={[styles.composerHint, { color: colors.mutedForeground }]}>
          للمحادثات السريعة فقط · أي تغيير حساس سيطلب موافقتك
        </Text>
      </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    minHeight: 116,
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTop: {
    minHeight: 46,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandBlock: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'right',
  },
  availability: {
    marginTop: 2,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  availabilityText: {
    fontSize: 11,
    textAlign: 'right',
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewSwitcher: {
    marginTop: 10,
    borderRadius: 13,
    padding: 3,
    flexDirection: 'row-reverse',
    alignSelf: 'stretch',
  },
  viewTab: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  viewTabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  messageList: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 16,
  },
  recordsList: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  recordsIntro: {
    paddingTop: 18,
    paddingBottom: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recordsHeaderActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  recordsTitle: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'right',
  },
  recordsSubtitle: {
    marginTop: 3,
    fontSize: 12,
    textAlign: 'right',
  },
  recordSummaryGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  recordSummaryCard: {
    width: '31.8%',
    minHeight: 68,
    borderRadius: 14,
    borderWidth: 1,
    padding: 9,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  recordSummaryCount: {
    fontSize: 18,
    fontWeight: '700',
  },
  recordSummaryLabel: {
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
  },
  recordSectionHeader: {
    paddingTop: 15,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recordSectionTitle: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  recordIcon: {
    width: 29,
    height: 29,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordSectionName: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
  },
  recordCount: {
    fontSize: 11,
  },
  recordRow: {
    minHeight: 63,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  recordCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  recordTitle: {
    width: '100%',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'right',
  },
  recordSubtitle: {
    width: '100%',
    marginTop: 3,
    fontSize: 11,
    textAlign: 'right',
  },
  recordTrailing: {
    maxWidth: 92,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'left',
  },
  recordsLoading: {
    minHeight: 170,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  recordsLoadingText: {
    fontSize: 12,
  },
  recordsError: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  recordsErrorCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  recordsErrorTitle: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  recordsErrorText: {
    marginTop: 3,
    fontSize: 11,
    textAlign: 'right',
  },
  recordsRetry: {
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  recordsEmpty: {
    minHeight: 190,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    marginTop: 12,
  },
  recordsEmptyTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '700',
  },
  recordsEmptyText: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
  },
  officeList: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 32,
  },
  officeIntro: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  officeIntroCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeGreeting: {
    marginTop: 5,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'right',
  },
  officeSubtitle: {
    maxWidth: 270,
    marginTop: 5,
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'right',
  },
  officeRefresh: {
    width: 38,
    height: 38,
    marginTop: 2,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeChatPanel: {
    marginTop: 18,
    borderRadius: 19,
    borderWidth: 1,
    padding: 12,
  },
  officeChatHeading: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  officeChatIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeChatHeadingCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeChatTitle: {
    width: '100%',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeChatHint: {
    width: '100%',
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
  },
  officeChatReply: {
    marginTop: 9,
  },
  officeChatTyping: {
    marginTop: 9,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 7,
  },
  officeChatTypingText: {
    fontSize: 11,
  },
  officeChatComposer: {
    minHeight: 48,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingLeft: 6,
    paddingRight: 10,
    flexDirection: 'row-reverse',
    alignItems: 'flex-end',
  },
  officeChatInput: {
    flex: 1,
    maxHeight: 76,
    paddingTop: 10,
    paddingBottom: 9,
    paddingHorizontal: 4,
    fontSize: 13,
    lineHeight: 20,
  },
  officeChatSend: {
    width: 32,
    height: 32,
    marginBottom: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeChatFooter: {
    paddingTop: 6,
    fontSize: 9,
    textAlign: 'center',
  },
  officeError: {
    marginTop: 15,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  officeErrorText: {
    flex: 1,
    fontSize: 12,
    textAlign: 'right',
  },
  officeLoading: {
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  officePulse: {
    minHeight: 84,
    marginTop: 18,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 8,
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  officePulseItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officePulseValue: {
    fontSize: 21,
    fontWeight: '700',
  },
  officePulseLabel: {
    marginTop: 3,
    fontSize: 10,
    textAlign: 'center',
  },
  officePulseDivider: {
    width: StyleSheet.hairlineWidth,
    height: 36,
  },
  officeSection: {
    marginTop: 27,
  },
  officeSectionHeading: {
    marginBottom: 11,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  officeSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeSectionHint: {
    marginTop: 3,
    fontSize: 11,
    textAlign: 'right',
  },
  officeCalm: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 13,
    justifyContent: 'center',
  },
  officeCalmText: {
    fontSize: 12,
    textAlign: 'right',
  },
  officeActionList: {
    gap: 8,
  },
  officeActionRow: {
    minHeight: 60,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  officeActionIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeActionCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeActionTitle: {
    width: '100%',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  officeActionMeta: {
    width: '100%',
    marginTop: 3,
    fontSize: 10,
    textAlign: 'right',
  },
  officeTodayList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  officeTodayRow: {
    minHeight: 43,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  officeTodayTime: {
    minWidth: 78,
    fontSize: 10,
    textAlign: 'right',
  },
  officeTodayText: {
    flex: 1,
    fontSize: 12,
    textAlign: 'right',
  },
  officeActivityList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  officeActivityRow: {
    minHeight: 61,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  officeActivityCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeActivityTitle: {
    width: '100%',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  officeActivityMeta: {
    width: '100%',
    marginTop: 3,
    fontSize: 10,
    textAlign: 'right',
  },
  officeActivityAmount: {
    maxWidth: 92,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'left',
  },
  officeEmptyLine: {
    paddingVertical: 13,
    fontSize: 12,
    textAlign: 'right',
  },
  officeFinancialRow: {
    minHeight: 72,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  officeFinancialCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeFinancialTitle: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeFinancialMeta: {
    marginTop: 3,
    fontSize: 10,
    textAlign: 'right',
  },
  officeInlineAction: {
    minHeight: 34,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 9,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
  },
  officeInlineActionText: {
    fontSize: 10,
    fontWeight: '700',
  },
  officeExpandedPanel: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingBottom: 5,
  },
  officeExpandedTitle: {
    paddingTop: 11,
    paddingBottom: 3,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeMoreLink: {
    paddingVertical: 12,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeEntityRail: {
    gap: 9,
    paddingVertical: 2,
  },
  officeEntityTile: {
    width: 128,
    minHeight: 111,
    borderRadius: 16,
    borderWidth: 1,
    padding: 11,
    alignItems: 'flex-end',
  },
  officeEntityIcon: {
    width: 29,
    height: 29,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeEntityName: {
    width: '100%',
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeEntityMeta: {
    width: '100%',
    marginTop: 3,
    fontSize: 10,
    textAlign: 'right',
  },
  officeSuggestions: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  officeSuggestionRow: {
    minHeight: 57,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  officeSuggestionCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeSuggestionLabel: {
    width: '100%',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  officeSuggestionDraft: {
    width: '100%',
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
  },
  officeExploreButton: {
    minHeight: 50,
    marginTop: 27,
    borderRadius: 16,
    paddingHorizontal: 15,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  officeExploreText: {
    fontSize: 13,
    fontWeight: '700',
  },
  detailScreen: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  detailHeader: {
    minHeight: 42,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailEyebrow: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  detailCard: {
    marginTop: 14,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    alignItems: 'flex-end',
  },
  detailIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailTitle: {
    width: '100%',
    marginTop: 16,
    fontSize: 21,
    fontWeight: '700',
    lineHeight: 29,
    textAlign: 'right',
  },
  detailSubtitle: {
    width: '100%',
    marginTop: 7,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'right',
  },
  detailMeta: {
    width: '100%',
    marginTop: 8,
    fontSize: 12,
    textAlign: 'right',
  },
  detailValue: {
    marginTop: 14,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
  },
  detailState: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  detailStateText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  detailRetry: {
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  relatedCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 13,
  },
  relatedTitle: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  relatedRow: {
    minHeight: 42,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  relatedLabel: {
    fontSize: 12,
    textAlign: 'right',
  },
  relatedCount: {
    fontSize: 13,
    fontWeight: '700',
  },
  detailContext: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 9,
  },
  detailContextCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  detailContextTitle: {
    width: '100%',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  detailContextText: {
    width: '100%',
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  detailPrimaryAction: {
    minHeight: 48,
    marginTop: 18,
    borderRadius: 15,
    paddingHorizontal: 16,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  detailPrimaryActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  messageRow: {
    width: '100%',
    marginBottom: 12,
  },
  userRow: {
    alignItems: 'flex-start',
  },
  assistantRow: {
    alignItems: 'flex-end',
  },
  messageBubble: {
    maxWidth: '88%',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 9,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'right',
  },
  messageTime: {
    marginTop: 5,
    fontSize: 10,
    textAlign: 'right',
    opacity: 0.78,
  },
  approvalCard: {
    marginTop: 10,
    borderRadius: 15,
    borderWidth: 1,
    padding: 10,
  },
  approvalHeading: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 7,
  },
  approvalTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  approvalDetail: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  approvalActions: {
    flexDirection: 'row-reverse',
    gap: 8,
    marginTop: 11,
  },
  approveButton: {
    minHeight: 38,
    flex: 1,
    borderRadius: 11,
    paddingHorizontal: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  approveText: {
    fontSize: 12,
    fontWeight: '700',
  },
  rejectButton: {
    minHeight: 38,
    flex: 1,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  rejectText: {
    fontSize: 12,
    fontWeight: '600',
  },
  resolvedRow: {
    marginTop: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  resolvedText: {
    fontSize: 12,
    fontWeight: '600',
  },
  messageLink: {
    minHeight: 36,
    marginTop: 10,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 11,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    gap: 6,
  },
  messageLinkText: {
    fontSize: 12,
    fontWeight: '700',
  },
  typingRow: {
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  typingBubble: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  typingText: {
    fontSize: 12,
  },
  suggestionsBlock: {
    marginTop: 24,
    marginBottom: 18,
    alignItems: 'flex-end',
  },
  suggestionsLabel: {
    marginBottom: 9,
    fontSize: 12,
    textAlign: 'right',
  },
  suggestions: {
    width: '100%',
    gap: 8,
    alignItems: 'flex-end',
  },
  suggestionChip: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  suggestionText: {
    fontSize: 13,
    textAlign: 'right',
  },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 7,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    textAlign: 'right',
  },
  errorRetry: {
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerWrap: {
    paddingHorizontal: 14,
    paddingTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composer: {
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    paddingLeft: 7,
    paddingRight: 12,
    flexDirection: 'row-reverse',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    maxHeight: 88,
    paddingTop: 12,
    paddingBottom: 11,
    paddingHorizontal: 4,
    fontSize: 15,
    lineHeight: 22,
  },
  sendButton: {
    width: 36,
    height: 36,
    marginBottom: 7,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerHint: {
    paddingTop: 7,
    paddingBottom: 1,
    fontSize: 10,
    textAlign: 'center',
  },
});