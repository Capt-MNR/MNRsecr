import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useApproveSecretaryOperation,
  useCreateTurn,
  getListRecordsQueryKey,
  useListRecords,
  useRejectSecretaryOperation,
} from '@workspace/api-client-react';
import type { RecordsResponse, TurnResponse } from '@workspace/api-client-react';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
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
  title: string;
  subtitle: string;
  trailing?: string;
};

type MobileRecordSection = {
  key: string;
  title: string;
  icon: FeatherName;
  data: MobileRecordRow[];
};

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
        title: expense.description,
        subtitle: [expense.personName ?? expense.projectName, recordDate(expense.occurredAt)]
          .filter(Boolean)
          .join(' · '),
        trailing: money(expense.amountMinor, expense.currency),
      })),
    },
    {
      key: 'people',
      title: 'الأشخاص',
      icon: 'users',
      data: records.people.map((person) => ({
        id: person.id,
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
        title: task.title,
        subtitle: task.dueAt ? `موعدها ${recordDate(task.dueAt)}` : 'مهمة مستمرة',
        trailing: statusLabel(task.status),
      })),
    },
    {
      key: 'reminders',
      title: 'التذكيرات',
      icon: 'bell',
      data: records.reminders.map((reminder) => ({
        id: reminder.id,
        title: reminder.text,
        subtitle: `${recordDate(reminder.dueAt)} · ${reminder.timezone}`,
        trailing: statusLabel(reminder.status),
      })),
    },
    {
      key: 'commitments',
      title: 'الالتزامات',
      icon: 'link',
      data: records.commitments.map((commitment) => ({
        id: commitment.id,
        title: commitment.title,
        subtitle: commitment.personName ?? 'بدون طرف محدد',
        trailing: commitment.dueAt ? recordDate(commitment.dueAt) : statusLabel(commitment.status),
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

function messageTime(value: string) {
  if (value === starterMessage.createdAt) return 'الآن';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'الآن';
  return new Intl.DateTimeFormat('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function RecordsView({ colors }: { colors: ReturnType<typeof useColors> }) {
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
        <View style={[styles.recordRow, { borderBottomColor: colors.border }]}>
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
        </View>
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
            <Pressable
              testID="refresh-records"
              accessibilityRole="button"
              accessibilityLabel="تحديث الرئيسية"
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

function MessageBubble({
  message,
  colors,
  onApprove,
  onReject,
  busyOperationId,
}: {
  message: LocalMessage;
  colors: ReturnType<typeof useColors>;
  onApprove: (approval: Approval) => void;
  onReject: (approval: Approval) => void;
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
      </View>
    </View>
  );
}

export default function QuickSecretaryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [activeView, setActiveView] = useState<'quick' | 'home'>('quick');
  const [messages, setMessages] = useState<LocalMessage[]>([starterMessage]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [busyOperationId, setBusyOperationId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const createTurn = useCreateTurn();
  const approveOperation = useApproveSecretaryOperation();
  const rejectOperation = useRejectSecretaryOperation();

  useEffect(() => {
    let cancelled = false;
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
    }).catch(() => setHydrated(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void AsyncStorage.multiSet([
      [STORAGE_MESSAGES, JSON.stringify(messages.slice(-40))],
      [STORAGE_CONVERSATION, conversationId ?? ''],
    ]);
  }, [conversationId, hydrated, messages]);

  function appendMessage(message: LocalMessage) {
    setMessages((current) => [...current, message].slice(-40));
  }

  async function sendMessage(value = draft) {
    const message = value.trim();
    if (!message || createTurn.isPending) return;
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
      appendMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: result.assistantMessage || result.response?.message || 'تم استلام طلبك.',
        createdAt: new Date().toISOString(),
        approval: approvalFromAction(result.action),
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
      setMessages((current) => current.map((message) => (
        message.approval?.operationId === approval.operationId
          ? { ...message, approval: { ...approval, status: response.status as ApprovalStatus } }
          : message
      )));
      if (response.assistantMessage) {
        appendMessage({
          id: `approval-${Date.now()}`,
          role: 'assistant',
          text: response.assistantMessage,
          createdAt: new Date().toISOString(),
        });
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
    setMessages([starterMessage]);
    setLocalError(null);
    void Haptics.selectionAsync();
  }

  const reversedMessages = [...messages].reverse();
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
                {activeView === 'quick' ? 'السكرتير' : 'الرئيسية'}
              </Text>
              <View style={styles.availability}>
                <View style={[styles.statusDot, { backgroundColor: colors.accent }]} />
                <Text style={[styles.availabilityText, { color: colors.mutedForeground }]}>
                  {activeView === 'quick' ? 'جاهز للرد السريع' : 'بياناتك المهمة في مكان واحد'}
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
            onPress={() => setActiveView('quick')}
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
            onPress={() => setActiveView('home')}
            style={({ pressed }) => [
              styles.viewTab,
              activeView === 'home' && { backgroundColor: colors.card },
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="grid" size={14} color={activeView === 'home' ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.viewTabText, { color: activeView === 'home' ? colors.foreground : colors.mutedForeground }]}>الرئيسية</Text>
          </Pressable>
        </View>
      </View>

      {activeView === 'home' ? (
        <RecordsView colors={colors} />
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
              busyOperationId={busyOperationId}
            />
          )}
          contentContainerStyle={styles.messageList}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={createTurn.isPending ? (
            <View style={styles.typingRow}>
              <View style={[styles.typingBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.typingText, { color: colors.mutedForeground }]}>بفكر في الرد…</Text>
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
            disabled={!draft.trim() || createTurn.isPending}
            style={({ pressed }) => [
              styles.sendButton,
              { backgroundColor: colors.primary, opacity: !draft.trim() || createTurn.isPending ? 0.4 : pressed ? 0.7 : 1 },
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
    minHeight: 76,
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
  messageList: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 16,
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