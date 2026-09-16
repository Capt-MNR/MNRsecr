import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useGetEntityGraph,
  getGetTodayContextQueryKey,
  getListRecordsQueryKey,
  useGetTodayContext,
  useListRecords,
} from '@workspace/api-client-react';
import type {
  ConversationListResponse,
  RecordsResponse,
  TodayContext,
  TurnResponse,
} from '@workspace/api-client-react';
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
import { useColors, useThemePreference, type ThemePreference } from '@/hooks/useColors';
import { useLanguage, type AppLanguage } from '@/hooks/useLanguage';
import {
  useSecretaryChatService,
  type SecretaryChatContext,
} from '../services/secretary-chat';

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
  related?: MobileRecordRow[];
};

type MobileRecordSection = {
  key: string;
  title: string;
  icon: FeatherName;
  data: MobileRecordRow[];
};

type MainSection = 'office' | 'records' | 'people' | 'projects' | 'financial' | 'tasks' | 'reminders' | 'activity';
type ConversationSummary = ConversationListResponse['conversations'][number];

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

function localized(language: AppLanguage, arabic: string, english: string) {
  return language === 'en' ? english : arabic;
}

function recordSectionLabel(language: AppLanguage, key: string, fallback: string) {
  const englishLabels: Record<string, string> = {
    expenses: 'Expenses',
    people: 'People',
    projects: 'Projects',
    tasks: 'Tasks',
    reminders: 'Reminders',
    commitments: 'Commitments',
  };
  return localized(language, fallback, englishLabels[key] ?? fallback);
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
  purposes: 'الأغراض',
  payments: 'المدفوعات',
  obligations: 'الالتزامات المالية',
  advances: 'السلف',
  debts: 'الديون',
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
        related: [
          expense.personId && expense.personName
            ? { id: expense.personId, recordType: 'person', title: expense.personName, subtitle: 'الشخص المرتبط' }
            : null,
          expense.projectId && expense.projectName
            ? { id: expense.projectId, recordType: 'project', title: expense.projectName, subtitle: 'المشروع المرتبط' }
            : null,
          expense.purposeId && expense.purposeName
            ? { id: expense.purposeId, recordType: 'purpose', title: expense.purposeName, subtitle: 'الغرض المرتبط' }
            : null,
        ].filter((item): item is MobileRecordRow => Boolean(item)),
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

function relatedRow(key: string, value: unknown): MobileRecordRow | null {
  const item = objectValue(value);
  const id = typeof item.id === 'string' ? item.id : '';
  if (!id) return null;
  const typeByKey: Record<string, string> = {
    projects: 'project',
    people: 'person',
    expenses: 'expense',
    commitments: 'commitment',
    tasks: 'task',
    reminders: 'reminder',
    financialParties: 'financial_party',
    purposes: 'purpose',
    payments: 'payment',
    obligations: 'obligation',
    advances: 'obligation',
    debts: 'obligation',
  };
  const recordType = typeByKey[key];
  if (!recordType) return null;
  const title = stringValue(
    item.name,
    stringValue(item.title, stringValue(item.description, stringValue(item.text, relatedLabels[key] ?? 'سجل مرتبط'))),
  );
  const date = typeof item.dueAt === 'string'
    ? recordDate(item.dueAt)
    : typeof item.occurredAt === 'string'
      ? recordDate(item.occurredAt)
      : '';
  const detail = stringValue(item.relationship, stringValue(item.status, date || (relatedLabels[key] ?? 'فتح التفاصيل')));
  const amountMinor = typeof item.amountMinor === 'number'
    ? item.amountMinor
    : typeof item.principalAmountMinor === 'number'
      ? item.principalAmountMinor
      : null;
  const currency = stringValue(item.currency, 'EGP');
  return {
    id,
    recordType,
    title,
    subtitle: detail,
    ...(amountMinor !== null ? { trailing: money(amountMinor, currency) } : {}),
  };
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

function secretaryContextFromRecord(record: MobileRecordRow): SecretaryChatContext {
  return {
    recordType: record.recordType,
    recordId: record.id,
    title: record.title,
    sourceConversationId: record.origin?.conversationId ?? null,
    sourceTurnId: record.origin?.turnId ?? null,
    sourceOperationId: record.origin?.operationId ?? null,
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
  onOpenSection,
  onBack,
  sectionKeys,
  title = 'السجلات',
  subtitle = 'استكشف معلوماتك المرتبطة',
  titleEn = 'Records',
  subtitleEn = 'Explore your connected information',
}: {
  colors: ReturnType<typeof useColors>;
  onOpenRecord: (record: MobileRecordRow) => void;
  onOpenSection?: (sectionKey: string) => void;
  onBack?: () => void;
  sectionKeys?: string[];
  title?: string;
  subtitle?: string;
  titleEn?: string;
  subtitleEn?: string;
}) {
  const { language } = useLanguage();
  const recordsQuery = useListRecords({
    query: {
      queryKey: getListRecordsQueryKey(),
      staleTime: 20_000,
    },
  });
  const sections = recordSections(recordsQuery.data).filter((section) => !sectionKeys || sectionKeys.includes(section.key));
  const totalRecords = sections.reduce((total, section) => total + section.data.length, 0);

  return (
    <SectionList
      style={styles.recordsView}
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
            <Text style={[styles.recordSectionName, { color: colors.foreground }]}>
              {recordSectionLabel(language, section.key, section.title)}
            </Text>
          </View>
          <Text style={[styles.recordCount, { color: colors.mutedForeground }]}>{section.data.length}</Text>
        </View>
      )}
      ListHeaderComponent={(
        <View>
          <View style={styles.recordsIntro}>
            <View>
            <Text style={[styles.recordsTitle, { color: colors.foreground }]}>
              {localized(language, title, titleEn)}
            </Text>
              <Text style={[styles.recordsSubtitle, { color: colors.mutedForeground }]}>
              {localized(language, subtitle, subtitleEn)}
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
              <Pressable
                key={section.key}
                testID={`record-summary-${section.key}`}
                accessibilityRole="button"
                accessibilityLabel={`فتح ${section.title}`}
                disabled={section.data.length === 0}
                onPress={() => {
                  if (onOpenSection) {
                    onOpenSection(section.key);
                    return;
                  }
                  const firstRecord = section.data[0];
                  if (firstRecord) onOpenRecord(firstRecord);
                }}
                style={({ pressed }) => [
                  styles.recordSummaryCard,
                  { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.68 : section.data.length === 0 ? 0.55 : 1 },
                ]}
              >
                <Text style={[styles.recordSummaryCount, { color: colors.primary }]}>{section.data.length}</Text>
                <Text style={[styles.recordSummaryLabel, { color: colors.mutedForeground }]}>
                  {recordSectionLabel(language, section.key, section.title)}
                </Text>
                <Feather name="arrow-up-left" size={12} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>

          {recordsQuery.isError && (
            <View style={[styles.recordsError, { backgroundColor: colors.destructive, borderColor: colors.destructive }]}>
              <Feather name="alert-circle" size={16} color={colors.destructiveForeground} />
              <View style={styles.recordsErrorCopy}>
                <Text style={[styles.recordsErrorTitle, { color: colors.destructiveForeground }]}>
                  {localized(language, 'تعذر تحميل السجلات', 'Unable to load records')}
                </Text>
                <Text style={[styles.recordsErrorText, { color: colors.destructiveForeground }]}>
                  {localized(language, 'تحقق من الاتصال وحاول التحديث مرة أخرى.', 'Check your connection and try refreshing again.')}
                </Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => void recordsQuery.refetch()}>
                <Text style={[styles.recordsRetry, { color: colors.destructiveForeground }]}>
                  {localized(language, 'حاول', 'Retry')}
                </Text>
              </Pressable>
            </View>
          )}

          {recordsQuery.isLoading && (
            <View style={styles.recordsLoading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.recordsLoadingText, { color: colors.mutedForeground }]}>
                {localized(language, 'جاري تحميل بياناتك…', 'Loading your data…')}
              </Text>
            </View>
          )}

          {!recordsQuery.isLoading && !recordsQuery.isError && totalRecords === 0 && (
            <View style={[styles.recordsEmpty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="archive" size={26} color={colors.primary} />
              <Text style={[styles.recordsEmptyTitle, { color: colors.foreground }]}>
                {localized(language, 'لا توجد سجلات بعد', 'No records yet')}
              </Text>
              <Text style={[styles.recordsEmptyText, { color: colors.mutedForeground }]}>
                {localized(language, 'أي مصروف أو تذكير أو مهمة تحفظها سيظهر هنا.', 'Expenses, reminders, and tasks you save will appear here.')}
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

type SecretaryChatProps = {
  colors: ReturnType<typeof useColors>;
  messages: LocalMessage[];
  draft: string;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  isSending: boolean;
  onApprove: (approval: Approval) => void;
  onReject: (approval: Approval) => void;
  busyOperationId: string | null;
  onOpenRecord: (record: MobileRecordRow) => void;
  context?: MobileRecordRow | null;
  compact?: boolean;
};

function CentralSecretaryChat({
  colors,
  messages,
  draft,
  onChangeDraft,
  onSend,
  isSending,
  onApprove,
  onReject,
  busyOperationId,
  onOpenRecord,
  context,
  compact = false,
}: SecretaryChatProps) {
  const { language } = useLanguage();
  return (
    <View
      testID={compact ? 'record-context-chat' : 'main-central-chat'}
      style={[
        compact ? styles.recordChatPanel : styles.centralChatPanel,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.centralChatHeading}>
        <View style={[styles.centralChatIcon, { backgroundColor: colors.muted }]}>
          <Feather name="message-circle" size={compact ? 15 : 17} color={colors.primary} />
        </View>
        <View style={styles.centralChatHeadingCopy}>
          <Text style={[styles.centralChatTitle, { color: colors.foreground }]}>
            {context
              ? `${localized(language, 'السكرتير', 'Secretary')} · ${context.title}`
              : localized(language, 'السكرتير الشخصي', 'Personal Secretary')}
          </Text>
          <Text style={[styles.centralChatHint, { color: colors.mutedForeground }]}>
            {context
              ? localized(language, 'اسأل عن هذا السياق أو علاقاته', 'Ask about this context or its relationships')
              : localized(language, 'تحدث، راجع، أو ابدأ إجراءً من داخل البرنامج', 'Talk, review, or start an action')}
          </Text>
        </View>
      </View>

      {context && (
        <View style={[styles.chatContextChip, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Feather name="crosshair" size={13} color={colors.primary} />
          <Text style={[styles.chatContextText, { color: colors.mutedForeground }]} numberOfLines={1}>
            {localized(language, 'السياق الحالي', 'Current context')}: {context.recordType} · {context.title}
          </Text>
        </View>
      )}

      <ScrollView
        testID={compact ? 'record-context-transcript' : 'main-chat-transcript'}
        style={[styles.centralChatTranscript, compact && styles.recordChatTranscript]}
        contentContainerStyle={styles.centralChatTranscriptContent}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            colors={colors}
            onApprove={onApprove}
            onReject={onReject}
            onOpenRecord={onOpenRecord}
            busyOperationId={busyOperationId}
          />
        ))}
        {isSending && (
          <View style={[styles.centralChatTyping, { backgroundColor: colors.muted }]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.centralChatTypingText, { color: colors.mutedForeground }]}>
              {localized(language, 'السكرتير يفكر…', 'The secretary is thinking…')}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.centralChatComposer, { backgroundColor: colors.background, borderColor: colors.input }]}>
        <TextInput
          testID={compact ? 'record-context-input' : 'main-message-input'}
          value={draft}
          onChangeText={onChangeDraft}
          onSubmitEditing={onSend}
          placeholder={context
            ? localized(language, 'اكتب سؤالك عن هذا السياق…', 'Ask about this context…')
            : localized(language, 'اكتب للسكرتير…', 'Write to your secretary…')}
          placeholderTextColor={colors.mutedForeground}
          multiline
          maxLength={1000}
          returnKeyType="send"
          blurOnSubmit={false}
          textAlign="right"
          style={[styles.centralChatInput, { color: colors.foreground }]}
        />
        <Pressable
          testID={compact ? 'record-context-send' : 'main-send-message'}
          accessibilityRole="button"
          accessibilityLabel={context
            ? localized(language, 'إرسال سؤال عن السجل', 'Send a question about the record')
            : localized(language, 'إرسال طلب إلى السكرتير', 'Send a request to the secretary')}
          onPress={onSend}
          disabled={!draft.trim() || isSending}
          style={({ pressed }) => [
            styles.centralChatSend,
            { backgroundColor: colors.primary, opacity: !draft.trim() || isSending ? 0.4 : pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="arrow-up" size={17} color={colors.primaryForeground} />
        </Pressable>
      </View>
      <Text style={[styles.centralChatFooter, { color: colors.mutedForeground }]}>
        {localized(language, 'نفس المحادثة والعمليات والموافقات · لا يتم الإرسال تلقائيًا', 'Same conversation, actions, and approvals · nothing is sent automatically')}
      </Text>
    </View>
  );
}

function MainOffice({
  colors,
  language,
  onOpenRecord,
  onOpenRecords,
  onOpenConversation,
  onFocusChat,
  onAskSecretary,
  pendingApprovals,
  messages,
  draft,
  onChangeDraft,
  onSend,
  inputRef,
  isSending,
  onApprove,
  onReject,
  busyOperationId,
  recordOrigins,
  chatContext,
  recentConversations,
  conversationSearch,
  onChangeConversationSearch,
  conversationsLoading,
}: {
  colors: ReturnType<typeof useColors>;
  language: AppLanguage;
  onOpenRecord: (record: MobileRecordRow) => void;
  onOpenRecords: () => void;
  onOpenConversation: (conversationId: string) => void;
  onFocusChat: (record?: MobileRecordRow) => void;
  onAskSecretary: (draft: string) => void;
  pendingApprovals: Approval[];
  messages: LocalMessage[];
  draft: string;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  inputRef: { current: TextInput | null };
  isSending: boolean;
  onApprove: (approval: Approval) => void;
  onReject: (approval: Approval) => void;
  busyOperationId: string | null;
  recordOrigins: Record<string, RecordOrigin>;
  chatContext: MobileRecordRow | null;
  recentConversations: ConversationSummary[];
  conversationSearch: string;
  onChangeConversationSearch: (value: string) => void;
  conversationsLoading: boolean;
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
  const latestEdits = context ? [
    ...context.recentExpenses.map((expense) => ({
      id: `expense-${expense.id}`,
      record: {
        id: expense.id,
        recordType: 'expense',
        title: expense.description,
        subtitle: [expense.personName ?? expense.projectName, recordDate(expense.occurredAt)].filter(Boolean).join(' · '),
        trailing: money(expense.amountMinor, expense.currency),
        origin: recordOrigins[expense.id] ?? null,
      } satisfies MobileRecordRow,
      icon: 'dollar-sign' as FeatherName,
      meta: localized(language, 'مصروف محفوظ', 'Expense saved'),
    })),
    ...context.pendingTasks.map((task) => ({
      id: `task-${task.id}`,
      record: {
        id: task.id,
        recordType: 'task',
        title: task.title,
        subtitle: task.dueAt ? recordDate(task.dueAt) : localized(language, 'مهمة مستمرة', 'Ongoing task'),
        trailing: statusLabel(task.status),
      } satisfies MobileRecordRow,
      icon: 'check-square' as FeatherName,
      meta: localized(language, 'مهمة محدثة', 'Task updated'),
    })),
    ...context.upcomingReminders.map((reminder) => ({
      id: `reminder-${reminder.id}`,
      record: {
        id: reminder.id,
        recordType: 'reminder',
        title: reminder.text,
        subtitle: recordDate(reminder.dueAt),
        trailing: statusLabel(reminder.status),
      } satisfies MobileRecordRow,
      icon: 'bell' as FeatherName,
      meta: localized(language, 'تذكير محدث', 'Reminder updated'),
    })),
  ].slice(0, 5) : [];
  const normalizedSearch = conversationSearch.trim().toLocaleLowerCase();
  const filteredLatestEdits = normalizedSearch
    ? latestEdits.filter((edit) => [
      edit.record.title,
      edit.record.subtitle,
      edit.meta,
      edit.record.trailing ?? '',
    ].join(' ').toLocaleLowerCase().includes(normalizedSearch))
    : latestEdits;
  const hasRecentActivity = recentConversations.length > 0 || filteredLatestEdits.length > 0;

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
          <Text style={[styles.officeEyebrow, { color: colors.primary }]}>
            {localized(language, 'مكتب السكرتير', 'Secretary Office')}
          </Text>
          <Text style={[styles.officeGreeting, { color: colors.foreground }]}>
            {new Date().getHours() < 12
              ? localized(language, 'صباح الخير', 'Good morning')
              : new Date().getHours() < 17
                ? localized(language, 'نهارك هادئ', 'Have a calm day')
                : localized(language, 'مساء الخير', 'Good evening')}
          </Text>
          <Text style={[styles.officeSubtitle, { color: colors.mutedForeground }]}>
            {localized(language, 'نظرة هادئة على ما يستحق انتباهك اليوم.', 'A calm view of what deserves your attention today.')}
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

      <CentralSecretaryChat
        colors={colors}
        messages={messages}
        draft={draft}
        onChangeDraft={onChangeDraft}
        onSend={onSend}
        isSending={isSending}
        onApprove={onApprove}
        onReject={onReject}
        busyOperationId={busyOperationId}
        onOpenRecord={onOpenRecord}
        context={chatContext}
      />

      <View testID="recent-activity" style={styles.officeSection}>
        <View style={styles.officeSectionHeading}>
          <View>
            <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>
              {localized(language, 'آخر المحادثات والتعديلات', 'Recent conversations and updates')}
            </Text>
            <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>
              {localized(language, 'اسحب القائمة وابحث داخل نصوص المحادثات', 'Swipe the list and search across conversation text')}
            </Text>
          </View>
          <Feather name="search" size={18} color={colors.primary} />
        </View>
        <View style={[styles.officeSearchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            testID="recent-conversations-search"
            value={conversationSearch}
            onChangeText={onChangeConversationSearch}
            placeholder={localized(language, 'ابحث في أي كلمة داخل المحادثة…', 'Search any word in a conversation…')}
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="search"
            clearButtonMode="while-editing"
            style={[styles.officeSearchInput, { color: colors.foreground }]}
          />
          {conversationsLoading && <ActivityIndicator size="small" color={colors.primary} />}
        </View>
        <ScrollView
          testID="recent-activity-list"
          style={styles.officeRecentActivityScroll}
          contentContainerStyle={styles.officeRecentActivityContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          {recentConversations.slice(0, 20).map((conversation) => (
              <Pressable
                key={conversation.conversationId}
                testID={`recent-conversation-${conversation.conversationId}`}
                accessibilityRole="button"
                accessibilityLabel={`${localized(language, 'فتح المحادثة', 'Open conversation')} ${conversation.title}`}
                onPress={() => onOpenConversation(conversation.conversationId)}
                style={({ pressed }) => [
                  styles.officeRecentActivityRow,
                  { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <View style={[styles.officeRecentActivityIcon, { backgroundColor: colors.muted }]}>
                  <Feather name="message-circle" size={15} color={colors.primary} />
                </View>
                <View style={styles.officeRecentActivityCopy}>
                  <Text style={[styles.officeRecentActivityTitle, { color: colors.foreground }]} numberOfLines={1}>
                    {conversation.title}
                  </Text>
                  <Text style={[styles.officeRecentActivityPreview, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {conversation.preview}
                  </Text>
                  <Text style={[styles.officeRecentActivityMeta, { color: colors.primary }]}>
                    {localized(language, 'محادثة', 'Conversation')} · {conversation.turnCount} {localized(language, 'رسائل', 'turns')}
                  </Text>
                </View>
                <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
              </Pressable>
            ))}
          {filteredLatestEdits.map((edit) => (
              <Pressable
                key={edit.id}
                testID={`recent-edit-${edit.record.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${localized(language, 'فتح', 'Open')} ${edit.record.title}`}
                onPress={() => onOpenRecord(edit.record)}
                style={({ pressed }) => [
                  styles.officeRecentActivityRow,
                  { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <View style={[styles.officeRecentActivityIcon, { backgroundColor: colors.muted }]}>
                  <Feather name={edit.icon} size={15} color={colors.primary} />
                </View>
                <View style={styles.officeRecentActivityCopy}>
                  <Text style={[styles.officeRecentActivityTitle, { color: colors.foreground }]} numberOfLines={1}>
                    {edit.record.title}
                  </Text>
                  <Text style={[styles.officeRecentActivityPreview, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {edit.meta} · {edit.record.subtitle}
                  </Text>
                </View>
                <Text style={[styles.officeRecentActivityMeta, { color: colors.primary }]} numberOfLines={1}>
                  {localized(language, 'تعديل', 'Update')}
                  {edit.record.trailing ? ` · ${edit.record.trailing}` : ''}
                </Text>
                <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
              </Pressable>
            ))}
          {!hasRecentActivity && (
            <View style={[styles.officeEmptyPanel, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Text style={[styles.officeEmptyLine, { color: colors.mutedForeground }]}>
                {conversationSearch.trim()
                  ? localized(language, 'لا توجد نتائج مطابقة.', 'No matching results.')
                  : localized(language, 'لا توجد محادثات أو تعديلات بعد.', 'No conversations or updates yet.')}
              </Text>
            </View>
          )}
        </ScrollView>
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
                <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>
                  {localized(language, 'يحتاج انتباهك', 'Needs your attention')}
                </Text>
                <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>
                  {attentionCount > 0
                    ? `${attentionCount} ${localized(language, 'أشياء تستحق نظرة', 'items worth a look')}`
                    : localized(language, 'كل شيء هادئ الآن', 'Everything is calm right now')}
                </Text>
              </View>
              <Feather name={attentionCount > 0 ? 'bell' : 'check-circle'} size={18} color={attentionCount > 0 ? colors.primary : colors.accent} />
            </View>
            {attentionCount === 0 ? (
              <View style={[styles.officeCalm, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Text style={[styles.officeCalmText, { color: colors.mutedForeground }]}>
                  {localized(language, 'لا توجد مهام عاجلة أو موافقات معلّقة.', 'No urgent tasks or pending approvals.')}
                </Text>
              </View>
            ) : (
              <View style={styles.officeActionList}>
                {pendingApprovals.slice(0, 2).map((approval) => (
                  <Pressable
                    key={approval.operationId}
                    testID={`office-approval-${approval.operationId}`}
                    accessibilityRole="button"
                     onPress={() => onFocusChat()}
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
                <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>
                  {localized(language, 'اليوم', 'Today')}
                </Text>
                <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>
                  {localized(language, 'ما يعرفه السكرتير عن يومك الآن', 'What the secretary knows about your day')}
                </Text>
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
                <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>
                  {localized(language, 'النبض المالي', 'Financial pulse')}
                </Text>
                <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>
                  {recentTotal
                    ? `${recentTotal} ${localized(language, 'في أحدث المصروفات', 'in recent expenses')}`
                    : localized(language, 'لا توجد حركة مالية حديثة', 'No recent financial activity')}
                </Text>
              </View>
              <Feather name="dollar-sign" size={18} color={colors.primary} />
            </View>
            <View style={[styles.officeFinancialRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.officeFinancialCopy}>
                <Text style={[styles.officeFinancialTitle, { color: colors.foreground }]}>
                  {localized(language, 'آخر المصروفات', 'Recent expenses')}
                </Text>
                <Text style={[styles.officeFinancialMeta, { color: colors.mutedForeground }]}>
                  {context.recentExpenses.length} {localized(language, 'سجلات محدودة', 'limited records')}
                </Text>
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
                  {financialExpanded
                    ? localized(language, 'إخفاء التفاصيل', 'Hide details')
                    : localized(language, 'عرض الالتزامات', 'Show commitments')}
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
                      {commitmentSection?.data.length ?? 0} {localized(language, 'التزامات محفوظة', 'saved commitments')}
                    </Text>
                    {(commitmentSection?.data ?? []).slice(0, 3).map((commitment) => (
                      <Pressable key={commitment.id} onPress={() => onOpenRecord(commitment)} style={styles.officeTodayRow}>
                        <Text style={[styles.officeTodayTime, { color: colors.mutedForeground }]}>{commitment.trailing ?? 'مفتوح'}</Text>
                        <Text style={[styles.officeTodayText, { color: colors.foreground }]} numberOfLines={1}>{commitment.title}</Text>
                      </Pressable>
                    ))}
                    <Pressable testID="office-open-all-records-financial" onPress={onOpenRecords}>
                      <Text style={[styles.officeMoreLink, { color: colors.primary }]}>
                        {localized(language, 'استكشف كل السجلات المالية', 'Explore all financial records')}
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}
          </View>

          <View style={styles.officeSection}>
            <View style={styles.officeSectionHeading}>
              <View>
                <Text style={[styles.officeSectionTitle, { color: colors.foreground }]}>
                  {localized(language, 'النشاط الأخير', 'Latest activity')}
                </Text>
                <Text style={[styles.officeSectionHint, { color: colors.mutedForeground }]}>
                  {localized(language, 'مصروفات حديثة يمكنك فتح تفاصيلها', 'Recent expenses you can open')}
                </Text>
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
  detailContent: {
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
  relatedHint: {
    marginTop: 4,
    marginBottom: 5,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'right',
  },
  relatedRow: {
    minHeight: 42,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  relatedRowCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  relatedLabel: {
    fontSize: 12,
    textAlign: 'right',
  },
  relatedSubtext: {
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
  },
  relatedCount: {
    fontSize: 13,
    fontWeight: '700',
  },
  timelineCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 13,
  },
  timelineHeading: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timelineRow: {
    minHeight: 48,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 8,
  },
  timelineDot: {
    width: 7,
    height: 7,
    marginTop: 5,
    borderRadius: 4,
    backgroundColor: '#6b8f71',
  },
  timelineCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  timelineTitle: {
    width: '100%',
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'right',
  },
  timelineMeta: {
    width: '100%',
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
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
  onOpenRelatedRecord,
  chatMessages,
  chatDraft,
  onChangeChatDraft,
  onSendChat,
  chatBusy,
  onApprove,
  onReject,
  busyOperationId,
  chatContext,
}: {
  record: MobileRecordRow;
  colors: ReturnType<typeof useColors>;
  onBack: () => void;
  onAskSecretary: () => void;
  onOpenConversation?: (origin: RecordOrigin) => void;
  onOpenRelatedRecord: (record: MobileRecordRow) => void;
  chatMessages: LocalMessage[];
  chatDraft: string;
  onChangeChatDraft: (value: string) => void;
  onSendChat: () => void;
  chatBusy: boolean;
  onApprove: (approval: Approval) => void;
  onReject: (approval: Approval) => void;
  busyOperationId: string | null;
  chatContext: MobileRecordRow | null;
}) {
  const isEntity = record.recordType === 'person'
    || record.recordType === 'project'
    || record.recordType === 'financial_party';
  const entityType = record.recordType === 'project'
    ? 'project'
    : record.recordType === 'financial_party'
      ? 'financial_party'
      : 'person';
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
    : record.recordType === 'project'
      ? `الحالة: ${stringValue(entity.status, record.trailing ?? 'غير محددة')}`
      : 'فتح مركز الطرف المالي';
  const relatedGroups = Object.entries(related)
    .map(([key, value]) => ({ key, count: arrayValue(value).length }))
    .filter((group) => group.count > 0);
  const graphRelatedRows = Object.entries(related).flatMap(([key, value]) =>
    arrayValue(value)
      .map((item) => relatedRow(key, item))
      .filter((item): item is MobileRecordRow => Boolean(item)),
  );
  const allRelatedRows = [...(record.related ?? []), ...graphRelatedRows]
    .filter((item, index, rows) => rows.findIndex((candidate) => candidate.recordType === item.recordType && candidate.id === item.id) === index);
  const timelineRows = arrayValue(entityData.timeline).slice(0, 8);

  return (
    <ScrollView
      style={detailStyles.detailScreen}
      contentContainerStyle={detailStyles.detailContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
    >
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
          <Text style={[detailStyles.detailEyebrow, { color: colors.mutedForeground }]}>
            {isEntity ? 'مركز الكيان' : 'تفاصيل السجل'}
          </Text>
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

      {!entityQuery.isLoading && !entityQuery.isError && allRelatedRows.length > 0 && (
        <View style={[detailStyles.relatedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[detailStyles.relatedTitle, { color: colors.foreground }]}>استكشف المعلومات المرتبطة</Text>
          <Text style={[detailStyles.relatedHint, { color: colors.mutedForeground }]}>
            افتح علاقة واتبعها إلى الكيان أو السجل التالي.
          </Text>
          {allRelatedRows.map((relatedRecord) => (
            <Pressable
              key={`${relatedRecord.recordType}-${relatedRecord.id}`}
              accessibilityRole="button"
              accessibilityLabel={`فتح ${relatedRecord.title}`}
              onPress={() => onOpenRelatedRecord(relatedRecord)}
              style={({ pressed }) => [
                detailStyles.relatedRow,
                { borderBottomColor: colors.border, opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <View style={detailStyles.relatedRowCopy}>
                <Text style={[detailStyles.relatedLabel, { color: colors.foreground }]} numberOfLines={1}>
                  {relatedRecord.title}
                </Text>
                <Text style={[detailStyles.relatedSubtext, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {relatedRecord.subtitle}
                </Text>
              </View>
              {relatedRecord.trailing && (
                <Text style={[detailStyles.relatedCount, { color: colors.primary }]} numberOfLines={1}>
                  {relatedRecord.trailing}
                </Text>
              )}
              <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </View>
      )}

      {isEntity && !entityQuery.isLoading && !entityQuery.isError && timelineRows.length > 0 && (
        <View style={[detailStyles.timelineCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={detailStyles.timelineHeading}>
            <Text style={[detailStyles.relatedTitle, { color: colors.foreground }]}>النشاط المرتبط</Text>
            <Feather name="activity" size={16} color={colors.primary} />
          </View>
          {timelineRows.map((item, index) => {
            const event = objectValue(item);
            return (
              <View key={`${String(event.id ?? 'event')}-${index}`} style={[detailStyles.timelineRow, { borderBottomColor: colors.border }]}>
                <View style={detailStyles.timelineDot} />
                <View style={detailStyles.timelineCopy}>
                  <Text style={[detailStyles.timelineTitle, { color: colors.foreground }]} numberOfLines={2}>
                    {stringValue(event.summary, stringValue(event.description, stringValue(event.type, 'نشاط مرتبط')))}
                  </Text>
                  <Text style={[detailStyles.timelineMeta, { color: colors.mutedForeground }]}>
                    {recordDate(typeof event.occurredAt === 'string' ? event.occurredAt : null)}
                  </Text>
                </View>
              </View>
            );
          })}
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
      {chatContext?.id === record.id && (
        <CentralSecretaryChat
          colors={colors}
          messages={chatMessages}
          draft={chatDraft}
          onChangeDraft={onChangeChatDraft}
          onSend={onSendChat}
          isSending={chatBusy}
          onApprove={onApprove}
          onReject={onReject}
          busyOperationId={busyOperationId}
          onOpenRecord={onOpenRelatedRecord}
          context={record}
          compact
        />
      )}
    </ScrollView>
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

const mainNavigation: Array<{ key: MainSection; labelAr: string; labelEn: string; icon: FeatherName }> = [
  { key: 'office', labelAr: 'الرئيسية', labelEn: 'Home', icon: 'home' },
  { key: 'records', labelAr: 'السجلات', labelEn: 'Records', icon: 'archive' },
  { key: 'people', labelAr: 'الأشخاص', labelEn: 'People', icon: 'users' },
  { key: 'projects', labelAr: 'المشاريع', labelEn: 'Projects', icon: 'briefcase' },
  { key: 'financial', labelAr: 'الماليات', labelEn: 'Financial', icon: 'dollar-sign' },
  { key: 'tasks', labelAr: 'المهام', labelEn: 'Tasks', icon: 'check-square' },
  { key: 'reminders', labelAr: 'التذكيرات', labelEn: 'Reminders', icon: 'bell' },
  { key: 'activity', labelAr: 'النشاط', labelEn: 'Activity', icon: 'activity' },
];

function MainDrawer({
  colors,
  language,
  themePreference,
  open,
  activeSection,
  onClose,
  onSelect,
  onOpenQuick,
  onThemeChange,
  onLanguageChange,
}: {
  colors: ReturnType<typeof useColors>;
  language: AppLanguage;
  themePreference: ThemePreference;
  open: boolean;
  activeSection: MainSection;
  onClose: () => void;
  onSelect: (section: MainSection) => void;
  onOpenQuick: () => void;
  onThemeChange: (theme: ThemePreference) => void;
  onLanguageChange: (language: AppLanguage) => void;
}) {
  if (!open) return null;
  return (
    <View style={styles.drawerLayer}>
      <Pressable
        testID="main-drawer-backdrop"
        accessibilityRole="button"
        accessibilityLabel="إغلاق القائمة"
        onPress={onClose}
        style={styles.drawerBackdrop}
      />
      <ScrollView
        style={[styles.drawerPanel, { backgroundColor: colors.card, borderLeftColor: colors.border }]}
        contentContainerStyle={styles.drawerScrollContent}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.drawerHeading}>
          <View style={[styles.drawerMark, { backgroundColor: colors.primary }]}>
            <Feather name="grid" size={16} color={colors.primaryForeground} />
          </View>
          <View style={styles.drawerHeadingCopy}>
            <Text style={[styles.drawerTitle, { color: colors.foreground }]}>Personal Secretary</Text>
            <Text style={[styles.drawerSubtitle, { color: colors.mutedForeground }]}>
              {localized(language, 'إدارة واستكشاف معلوماتك', 'Manage and explore your information')}
            </Text>
          </View>
          <Pressable
            testID="close-main-drawer"
            accessibilityRole="button"
            accessibilityLabel="إغلاق القائمة"
            onPress={onClose}
            style={({ pressed }) => [styles.drawerClose, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
          >
            <Feather name="x" size={17} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={styles.drawerNav}>
          {mainNavigation.map((item) => (
            <Pressable
              key={item.key}
              testID={`main-nav-${item.key}`}
              accessibilityRole="button"
              accessibilityState={{ selected: activeSection === item.key }}
              onPress={() => onSelect(item.key)}
              style={({ pressed }) => [
                styles.drawerNavItem,
                activeSection === item.key && { backgroundColor: colors.muted },
                { opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Feather name={item.icon} size={17} color={activeSection === item.key ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.drawerNavText, { color: activeSection === item.key ? colors.foreground : colors.mutedForeground }]}>
                {localized(language, item.labelAr, item.labelEn)}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={[styles.drawerQuickSeparator, { borderTopColor: colors.border }]} />
        <Pressable
          testID="drawer-open-quick"
          accessibilityRole="button"
          accessibilityLabel="فتح السكرتير بسرعة"
          onPress={onOpenQuick}
          style={({ pressed }) => [styles.drawerQuick, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
        >
          <View style={[styles.drawerQuickBubble, { backgroundColor: colors.primary }]}>
            <Feather name="message-circle" size={16} color={colors.primaryForeground} />
          </View>
          <View style={styles.drawerQuickCopy}>
            <Text style={[styles.drawerQuickTitle, { color: colors.foreground }]}>
              {localized(language, 'فتح السكرتير بسرعة', 'Open Quick Chat')}
            </Text>
            <Text style={[styles.drawerQuickText, { color: colors.mutedForeground }]}>
              {localized(language, 'وصول خفيف إلى نفس السكرتير', 'A lightweight way to reach the same secretary')}
            </Text>
          </View>
        </Pressable>
        <View style={[styles.drawerSettings, { borderTopColor: colors.border }]}>
          <View style={styles.drawerSettingsHeading}>
            <Text style={[styles.drawerSettingsTitle, { color: colors.foreground }]}>
              {localized(language, 'الإعدادات', 'Settings')}
            </Text>
            <Feather name="sliders" size={16} color={colors.primary} />
          </View>
          <Text style={[styles.drawerSettingLabel, { color: colors.mutedForeground }]}>
            {localized(language, 'الخلفية', 'Appearance')}
          </Text>
          <View style={[styles.drawerChoiceRow, { backgroundColor: colors.muted }]}>
            {([
              ['light', 'فاتحة', 'Light', 'sun'],
              ['dark', 'داكنة', 'Dark', 'moon'],
            ] as const).map(([value, arabicLabel, englishLabel, icon]) => (
              <Pressable
                key={value}
                testID={`theme-${value}`}
                accessibilityRole="button"
                accessibilityState={{ selected: themePreference === value }}
                onPress={() => onThemeChange(value)}
                style={({ pressed }) => [
                  styles.drawerChoice,
                  themePreference === value && { backgroundColor: colors.card, borderColor: colors.border },
                  { opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <Feather name={icon} size={14} color={themePreference === value ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.drawerChoiceText, { color: themePreference === value ? colors.foreground : colors.mutedForeground }]}>
                  {localized(language, arabicLabel, englishLabel)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.drawerSettingLabel, { color: colors.mutedForeground }]}>
            {localized(language, 'اللغة', 'Language')}
          </Text>
          <View style={[styles.drawerChoiceRow, { backgroundColor: colors.muted }]}>
            {([
              ['ar', 'العربية', 'Arabic'],
              ['en', 'English', 'English'],
            ] as const).map(([value, arabicLabel, englishLabel]) => (
              <Pressable
                key={value}
                testID={`language-${value}`}
                accessibilityRole="button"
                accessibilityState={{ selected: language === value }}
                onPress={() => onLanguageChange(value)}
                style={({ pressed }) => [
                  styles.drawerChoice,
                  language === value && { backgroundColor: colors.card, borderColor: colors.border },
                  { opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <Text style={[styles.drawerChoiceText, { color: language === value ? colors.foreground : colors.mutedForeground }]}>
                  {localized(language, arabicLabel, englishLabel)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// Drawer styles stay in the screen stylesheet so the shell can remain a single
// mobile entry point while the larger sections are split out later.

export default function QuickSecretaryScreen() {
  const colors = useColors();
  const { language, setLanguage } = useLanguage();
  const { themePreference, setThemePreference } = useThemePreference();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [activeView, setActiveView] = useState<'quick' | 'home'>('quick');
  const [mainSection, setMainSection] = useState<MainSection>('office');
  const [selectedRecord, setSelectedRecord] = useState<MobileRecordRow | null>(null);
  const [recordReturnView, setRecordReturnView] = useState<'main' | 'quick'>('main');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatContext, setChatContext] = useState<MobileRecordRow | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([starterMessage]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [busyOperationId, setBusyOperationId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [conversationToLoad, setConversationToLoad] = useState<string | null>(null);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const [conversationSearch, setConversationSearch] = useState('');
  const queryClient = useQueryClient();
  const secretaryChat = useSecretaryChatService(conversationToLoad, conversationSearch.trim());
  const conversationQuery = secretaryChat.conversationQuery;
  const recentConversations = secretaryChat.conversationsQuery.data?.conversations ?? [];
  const visibleSuggestions = language === 'en'
    ? ['What do I have today?', 'Remind me tomorrow to call Mohamed', 'How much does Mohamed owe me?']
    : suggestions;

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
    if (!message || secretaryChat.isSending || conversationQuery.isFetching) return;
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
      const result = await secretaryChat.sendTurn({
        message,
        conversationId: conversationId ?? null,
        channel: chatContext ? 'record' : activeView === 'quick' ? 'quick' : 'main',
        context: chatContext ? secretaryContextFromRecord(chatContext) : null,
      });
      setConversationId(result.conversationId);
      await queryClient.invalidateQueries({ queryKey: ['secretary-chat-conversations'] });
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
        ? await secretaryChat.approveOperation(approval.operationId)
        : await secretaryChat.rejectOperation(approval.operationId);
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
      await queryClient.invalidateQueries({ queryKey: ['secretary-chat-conversations'] });
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
    setChatContext(null);
    setDrawerOpen(false);
    setActiveView('home');
    void Haptics.selectionAsync();
  }

  function openMainSection(section: MainSection) {
    setSelectedRecord(null);
    setMainSection(section);
    setChatContext(null);
    setDrawerOpen(false);
    setActiveView('home');
    void Haptics.selectionAsync();
  }

  function openRecordSection(sectionKey: string) {
    const targetSection: MainSection = sectionKey === 'people'
      ? 'people'
      : sectionKey === 'projects'
        ? 'projects'
        : sectionKey === 'tasks'
          ? 'tasks'
          : sectionKey === 'reminders'
            ? 'reminders'
            : sectionKey === 'activity'
              ? 'activity'
              : 'financial';
    openMainSection(targetSection);
  }

  function openQuick() {
    setSelectedRecord(null);
    setDrawerOpen(false);
    setActiveView('quick');
    void Haptics.selectionAsync();
  }

  function openRecordFromRecords(record: MobileRecordRow) {
    setSelectedRecord(record);
    setRecordReturnView('main');
    setChatContext(null);
    setMainSection('records');
    setActiveView('home');
    void Haptics.selectionAsync();
  }

  function openRecordFromQuick(record: MobileRecordRow) {
    setSelectedRecord(record);
    setRecordReturnView('quick');
    setChatContext(null);
    setMainSection('records');
    setActiveView('home');
    void Haptics.selectionAsync();
  }

  function openOfficeRecord(record: MobileRecordRow) {
    setSelectedRecord(record);
    setRecordReturnView('main');
    setChatContext(null);
    setMainSection('office');
    setActiveView('home');
    void Haptics.selectionAsync();
  }

  function openOfficeWithDraft(value: string) {
    setDraft(value);
    setSelectedRecord(null);
    setMainSection('office');
    setChatContext(null);
    setActiveView('home');
    setTimeout(() => inputRef.current?.focus(), 0);
    void Haptics.selectionAsync();
  }

  function openOriginalConversation(origin: RecordOrigin) {
    setSelectedRecord(null);
    setMainSection('office');
    setChatContext(null);
    setActiveView(recordReturnView === 'quick' ? 'quick' : 'home');
    if (origin.conversationId === conversationId) {
      void Haptics.selectionAsync();
      return;
    }
    setConversationToLoad(origin.conversationId);
    setLoadedConversationId(null);
    setLocalError(null);
    void Haptics.selectionAsync();
  }

  function openConversation(conversationIdToOpen: string) {
    setSelectedRecord(null);
    setMainSection('office');
    setChatContext(null);
    setDrawerOpen(false);
    setActiveView('home');
    if (conversationIdToOpen !== conversationId) {
      setConversationToLoad(conversationIdToOpen);
      setLoadedConversationId(null);
      setLocalError(null);
    }
    void Haptics.selectionAsync();
  }

  function askSecretaryAboutRecord() {
    if (!selectedRecord) return;
    setDraft(`اسألني عن ${selectedRecord.title}`);
    setChatContext(selectedRecord);
    setRecordReturnView('main');
    setSelectedRecord(null);
    setMainSection('office');
    setActiveView('home');
    setTimeout(() => inputRef.current?.focus(), 0);
    void Haptics.selectionAsync();
  }

  const reversedMessages = [...messages].reverse();
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
                  {activeView === 'quick'
                    ? localized(language, 'السكرتير السريع', 'Quick Chat')
                    : localized(language, 'مكتب السكرتير', 'Secretary Office')}
              </Text>
              <View style={styles.availability}>
                <View style={[styles.statusDot, { backgroundColor: colors.accent }]} />
                <Text style={[styles.availabilityText, { color: colors.mutedForeground }]}>
                    {activeView === 'quick'
                      ? localized(language, 'فتحت السكرتير بسرعة', 'Fast access to your secretary')
                      : localized(language, 'إدارة، استكشاف، ومراجعة', 'Manage, explore, and review')}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.headerActions}>
            {activeView === 'home' ? (
              <>
                <Pressable
                  testID="open-main-drawer"
                  accessibilityRole="button"
                  accessibilityLabel="فتح قائمة البرنامج"
                  onPress={() => setDrawerOpen(true)}
                  style={({ pressed }) => [styles.iconButton, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
                >
                  <Feather name="menu" size={18} color={colors.foreground} />
                </Pressable>
                <Pressable
                  testID="main-quick-bubble"
                  accessibilityRole="button"
                  accessibilityLabel="فتح السكرتير بسرعة"
                  onPress={openQuick}
                  style={({ pressed }) => [
                    styles.quickAccessBubble,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Feather name="message-circle" size={17} color={colors.primaryForeground} />
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  testID="quick-open-main"
                  accessibilityRole="button"
                  accessibilityLabel="فتح البرنامج الكامل"
                  onPress={openHome}
                  style={({ pressed }) => [styles.iconButton, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
                >
                  <Feather name="grid" size={17} color={colors.foreground} />
                </Pressable>
                <Pressable
                  testID="new-conversation"
                  accessibilityRole="button"
                  accessibilityLabel="محادثة جديدة"
                  onPress={startNewConversation}
                  style={({ pressed }) => [styles.iconButton, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
                >
                  <Feather name="edit-3" size={17} color={colors.foreground} />
                </Pressable>
              </>
            )}
          </View>
        </View>
      </View>

      {activeView === 'home' && (
        <MainDrawer
          colors={colors}
          language={language}
          themePreference={themePreference}
          open={drawerOpen}
          activeSection={mainSection}
          onClose={() => setDrawerOpen(false)}
          onSelect={openMainSection}
          onOpenQuick={openQuick}
          onThemeChange={setThemePreference}
          onLanguageChange={setLanguage}
        />
      )}

      {activeView === 'home' ? (
        selectedRecord ? (
          <RecordDetailView
            record={selectedRecord}
            colors={colors}
            onBack={() => setSelectedRecord(null)}
            onAskSecretary={askSecretaryAboutRecord}
            onOpenConversation={openOriginalConversation}
              onOpenRelatedRecord={openOfficeRecord}
              chatMessages={messages}
              chatDraft={draft}
              onChangeChatDraft={setDraft}
              onSendChat={() => void sendMessage()}
              chatBusy={secretaryChat.isSending || conversationQuery.isFetching}
              onApprove={(approval) => void updateApproval(approval, 'completed')}
              onReject={(approval) => void updateApproval(approval, 'rejected')}
              busyOperationId={busyOperationId}
              chatContext={chatContext}
          />
        ) : (
            <>
              {mainSection === 'office' && (
                <MainOffice
                  colors={colors}
                  language={language}
                  onOpenRecord={openOfficeRecord}
                  onOpenRecords={() => openMainSection('records')}
                  onOpenConversation={openConversation}
                  onFocusChat={() => setChatContext(null)}
                  onAskSecretary={openOfficeWithDraft}
                  messages={messages}
                  draft={draft}
                  onChangeDraft={setDraft}
                  onSend={() => void sendMessage()}
                  inputRef={inputRef}
                  isSending={secretaryChat.isSending || conversationQuery.isFetching}
                  onApprove={(approval) => void updateApproval(approval, 'completed')}
                  onReject={(approval) => void updateApproval(approval, 'rejected')}
                  busyOperationId={busyOperationId}
                  recordOrigins={recordOrigins}
                  chatContext={chatContext}
                  recentConversations={recentConversations}
                  conversationSearch={conversationSearch}
                  onChangeConversationSearch={setConversationSearch}
                  conversationsLoading={secretaryChat.conversationsQuery.isFetching}
                  pendingApprovals={messages.flatMap((message) => (
                    message.approval && message.approval.status === 'pending' ? [message.approval] : []
                  ))}
                />
              )}
              {mainSection === 'records' && (
                <RecordsView
                  colors={colors}
                  onOpenSection={openRecordSection}
                  title="السجلات"
                  subtitle="كل ما حفظه السكرتير في مكان واحد"
                  onOpenRecord={openRecordFromRecords}
                  onBack={openHome}
                />
              )}
              {mainSection === 'people' && (
                <RecordsView
                  colors={colors}
                  onOpenSection={openRecordSection}
                  title="الأشخاص"
                  subtitle="الأشخاص وعلاقاتهم بالسجلات والمشاريع"
                  sectionKeys={['people']}
                  onOpenRecord={openRecordFromRecords}
                  onBack={openHome}
                />
              )}
              {mainSection === 'projects' && (
                <RecordsView
                  colors={colors}
                  onOpenSection={openRecordSection}
                  title="المشاريع"
                  subtitle="المشاريع النشطة وسياقها المرتبط"
                  sectionKeys={['projects']}
                  onOpenRecord={openRecordFromRecords}
                  onBack={openHome}
                />
              )}
              {mainSection === 'financial' && (
                <RecordsView
                  colors={colors}
                  onOpenSection={openRecordSection}
                  title="الماليات"
                  subtitle="المصروفات والالتزامات والعلاقات المالية"
                  sectionKeys={['expenses', 'commitments']}
                  onOpenRecord={openRecordFromRecords}
                  onBack={openHome}
                />
              )}
              {mainSection === 'tasks' && (
                <RecordsView
                  colors={colors}
                  onOpenSection={openRecordSection}
                  title="المهام"
                  subtitle="المهام المفتوحة والمكتملة المرتبطة بسياقك"
                  sectionKeys={['tasks']}
                  onOpenRecord={openRecordFromRecords}
                  onBack={openHome}
                />
              )}
              {mainSection === 'reminders' && (
                <RecordsView
                  colors={colors}
                  onOpenSection={openRecordSection}
                  title="التذكيرات"
                  subtitle="كل المواعيد والتنبيهات التي يتابعها السكرتير"
                  sectionKeys={['reminders']}
                  onOpenRecord={openRecordFromRecords}
                  onBack={openHome}
                />
              )}
              {mainSection === 'activity' && (
                <RecordsView
                  colors={colors}
                  onOpenSection={openRecordSection}
                  title="النشاط / Timeline"
                  subtitle="آخر السجلات والحركة التي تستحق المراجعة"
                  onOpenRecord={openRecordFromRecords}
                  onBack={openHome}
                />
              )}
            </>
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
          ListHeaderComponent={secretaryChat.isSending || conversationQuery.isFetching ? (
            <View style={styles.typingRow}>
              <View style={[styles.typingBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.typingText, { color: colors.mutedForeground }]}>
                  {conversationQuery.isFetching
                    ? localized(language, 'بفتح المحادثة الأصلية…', 'Opening the original conversation…')
                    : localized(language, 'بفكر في الرد…', 'Thinking…')}
                </Text>
              </View>
            </View>
          ) : null}
          ListFooterComponent={(
            <View>
              <View style={[styles.quickHero, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.quickHeroMark, { backgroundColor: colors.primary }]}>
                  <Feather name="message-circle" size={23} color={colors.primaryForeground} />
                </View>
                <Text style={[styles.quickHeroTitle, { color: colors.foreground }]}>
                  {localized(language, 'السكرتير الشخصي', 'Personal Secretary')}
                </Text>
                <Text style={[styles.quickHeroText, { color: colors.mutedForeground }]}>
                  {localized(
                    language,
                    'مساحة سريعة للتحدث والمراجعة، مرتبطة بنفس محادثات وعمليات البرنامج الكامل.',
                    'A fast space to talk and review, connected to the same conversations and actions as the full workspace.',
                  )}
                </Text>
              </View>
              {messages.length === 1 && (
                <View style={styles.suggestionsBlock}>
                  <Text style={[styles.suggestionsLabel, { color: colors.mutedForeground }]}>
                    {localized(language, 'ابدأ بطلب سريع', 'Start with a quick request')}
                  </Text>
                  <View style={styles.suggestions}>
                    {visibleSuggestions.map((suggestion) => (
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
              )}
            </View>
          )}
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
            {localized(language, 'تعذر فتح المحادثة الأصلية.', 'Unable to open the original conversation.')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={localized(language, 'إعادة فتح المحادثة الأصلية', 'Retry opening the original conversation')}
            onPress={() => void conversationQuery.refetch()}
          >
            <Text style={[styles.errorRetry, { color: colors.destructiveForeground }]}>
              {localized(language, 'حاول', 'Retry')}
            </Text>
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
            placeholder={localized(language, 'اكتب طلبك بسرعة…', 'Write a quick request…')}
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
            accessibilityLabel={localized(language, 'إرسال الطلب', 'Send request')}
            onPress={() => void sendMessage()}
            disabled={!draft.trim() || secretaryChat.isSending || conversationQuery.isFetching}
            style={({ pressed }) => [
              styles.sendButton,
              { backgroundColor: colors.primary, opacity: !draft.trim() || secretaryChat.isSending || conversationQuery.isFetching ? 0.4 : pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="arrow-up" size={18} color={colors.primaryForeground} />
          </Pressable>
        </View>
        <Text style={[styles.composerHint, { color: colors.mutedForeground }]}>
          {localized(language, 'للمحادثات السريعة فقط · أي تغيير حساس سيطلب موافقتك', 'Quick conversations only · sensitive changes require your approval')}
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
  headerActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  quickAccessBubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
    flexDirection: 'row-reverse',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
  },
  drawerPanel: {
    width: '82%',
    maxWidth: 340,
    height: '100%',
    paddingTop: 78,
    paddingHorizontal: 16,
    borderLeftWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: -4, height: 0 },
    elevation: 8,
  },
  drawerScrollContent: {
    flexGrow: 1,
    paddingBottom: 28,
  },
  drawerHeading: {
    minHeight: 48,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  drawerMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerHeadingCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  drawerTitle: {
    width: '100%',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
  },
  drawerSubtitle: {
    width: '100%',
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
  },
  drawerClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerNav: {
    marginTop: 22,
    gap: 5,
  },
  drawerNavItem: {
    minHeight: 46,
    borderRadius: 13,
    paddingHorizontal: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  drawerNavText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  drawerQuickSeparator: {
    marginTop: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  drawerQuick: {
    minHeight: 62,
    marginTop: 15,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 11,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  drawerQuickBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerQuickCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  drawerQuickTitle: {
    width: '100%',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  drawerQuickText: {
    width: '100%',
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
  },
  drawerSettings: {
    marginTop: 18,
    paddingTop: 15,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  drawerSettingsHeading: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  drawerSettingsTitle: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  drawerSettingLabel: {
    marginTop: 13,
    marginBottom: 6,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'right',
  },
  drawerChoiceRow: {
    borderRadius: 12,
    padding: 3,
    flexDirection: 'row-reverse',
    gap: 3,
  },
  drawerChoice: {
    flex: 1,
    minHeight: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'transparent',
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  drawerChoiceText: {
    fontSize: 11,
    fontWeight: '700',
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
  quickHero: {
    marginBottom: 14,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 22,
    alignItems: 'center',
  },
  quickHeroMark: {
    width: 54,
    height: 54,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickHeroTitle: {
    marginTop: 12,
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'center',
  },
  quickHeroText: {
    maxWidth: 290,
    marginTop: 6,
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
  },
  recordsList: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  recordsView: {
    flex: 1,
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
  centralChatPanel: {
    marginTop: 18,
    borderRadius: 19,
    borderWidth: 1,
    padding: 12,
  },
  recordChatPanel: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
  },
  centralChatHeading: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  centralChatIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centralChatHeadingCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  centralChatTitle: {
    width: '100%',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  centralChatHint: {
    width: '100%',
    marginTop: 2,
    fontSize: 10,
    textAlign: 'right',
  },
  chatContextChip: {
    marginTop: 9,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 7,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  chatContextText: {
    flex: 1,
    fontSize: 10,
    textAlign: 'right',
  },
  centralChatTranscript: {
    maxHeight: 245,
    marginTop: 8,
  },
  recordChatTranscript: {
    maxHeight: 220,
  },
  centralChatTranscriptContent: {
    paddingVertical: 3,
    gap: 7,
  },
  centralChatTyping: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 7,
  },
  centralChatTypingText: {
    fontSize: 11,
  },
  centralChatComposer: {
    minHeight: 48,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingLeft: 6,
    paddingRight: 10,
    flexDirection: 'row-reverse',
    alignItems: 'flex-end',
  },
  centralChatInput: {
    flex: 1,
    maxHeight: 76,
    paddingTop: 10,
    paddingBottom: 9,
    paddingHorizontal: 4,
    fontSize: 13,
    lineHeight: 20,
  },
  centralChatSend: {
    width: 32,
    height: 32,
    marginBottom: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centralChatFooter: {
    paddingTop: 6,
    fontSize: 9,
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
  officeSearchBox: {
    minHeight: 44,
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 11,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  officeSearchInput: {
    flex: 1,
    minHeight: 42,
    fontSize: 12,
    textAlign: 'right',
  },
  officeRecentActivityScroll: {
    maxHeight: 300,
    marginTop: 10,
    borderRadius: 15,
  },
  officeRecentActivityContent: {
    gap: 8,
    paddingBottom: 2,
  },
  officeRecentActivityRow: {
    minHeight: 68,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  officeRecentActivityIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeRecentActivityCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeRecentActivityTitle: {
    width: '100%',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeRecentActivityPreview: {
    width: '100%',
    marginTop: 3,
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'right',
  },
  officeRecentActivityMeta: {
    maxWidth: 100,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'left',
  },
  officeEmptyPanel: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 13,
    justifyContent: 'center',
  },
  officeConversationRail: {
    gap: 9,
    paddingVertical: 2,
  },
  officeConversationCard: {
    width: 178,
    minHeight: 156,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    alignItems: 'flex-end',
  },
  officeConversationIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeConversationTitle: {
    width: '100%',
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    textAlign: 'right',
  },
  officeConversationPreview: {
    width: '100%',
    flex: 1,
    marginTop: 5,
    fontSize: 10,
    lineHeight: 16,
    textAlign: 'right',
  },
  officeConversationMeta: {
    width: '100%',
    marginTop: 8,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeRecentEditList: {
    gap: 8,
  },
  officeRecentEditRow: {
    minHeight: 60,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
  },
  officeRecentEditIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeRecentEditCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  officeRecentEditTitle: {
    width: '100%',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  officeRecentEditMeta: {
    width: '100%',
    marginTop: 3,
    fontSize: 10,
    textAlign: 'right',
  },
  officeRecentEditTrailing: {
    maxWidth: 82,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'left',
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