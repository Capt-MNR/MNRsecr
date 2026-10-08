import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  getGetSecretaryOperationQueryKey,
  getListPendingSecretaryApprovalsQueryKey,
  getGetProactivePreferencesQueryKey,
  useGetSecretaryOperation,
  useGetProactivePreferences,
  useUpdateProactivePreferences,
} from '@workspace/api-client-react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, useThemePreference } from '@/hooks/useColors';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/services/auth-context';
import {
  isSecretaryAuthenticationFailure,
  SecretaryChatTransportError,
  useSecretaryChatService,
} from '../services/secretary-chat';
import {
  receiptDraft,
  receiptNeedsReview,
  useSecretaryInputCapture,
  type SecretaryInputResult,
} from '../services/secretary-input';
import { hydrateLocalInputAttachments } from '../services/local-input-assets';
import { initializeSecretaryPush } from '../services/mobile-push';
import {
  MainDrawer,
  MainBottomBar,
  MainWorkspace,
  AskView,
  SecretaryHome,
  ContextHub,
  ConnectionsView,
  ConversationHistoryView,
  RecordDetailView,
  RecordsView,
  WorksView,
  addOrigin,
  approvalFromAction,
  approvalsFromAction,
  messagesFromConversation,
  objectValue,
  recordLinkFromAction,
  secretaryContextFromRecord,
  starterMessage,
  styles,
  SecondBrainMemorySheet,
  SettingsSection,
  PersonalInformationSection,
  type Approval,
  type ApprovalStatus,
  type AssistantPreferences,
  defaultAssistantPreferences,
  type LocalMessage,
  type MainSection,
  type MobileRecordRow,
  type RecordOrigin,
} from '../features/main';

function secretaryFailureText(error: unknown, language: 'ar' | 'en', approval = false) {
  if (isSecretaryAuthenticationFailure(error)) {
    return language === 'ar' ? 'انتهت جلسة الدخول. سجّل الدخول مرة أخرى.' : 'Your session expired. Sign in again.';
  }
  const value = error && typeof error === 'object' ? error as { category?: unknown; status?: unknown; name?: unknown } : {};
  const category = error instanceof SecretaryChatTransportError ? error.category : value.category;
  const status = typeof value.status === 'number' ? value.status : undefined;
  const isTimeout = category === 'timeout' || value.name === 'FetchTimeoutError' || status === 408 || status === 504;
  if (isTimeout) {
    return language === 'ar'
      ? (approval ? 'تأخر تأكيد النتيجة. راجع سجل العملية قبل إعادة المحاولة.' : 'تأخر الرد. تحقّق من المحادثة قبل إرسال الطلب مرة أخرى.')
      : (approval ? 'The outcome could not be confirmed in time. Check the operation history before retrying.' : 'The response took too long. Check the conversation before sending again.');
  }
  if (category === 'conflict' || status === 409) {
    return language === 'ar'
      ? 'تغيّرت هذه العملية في موضع آخر. حدّث البيانات وراجع حالتها قبل أي إجراء.'
      : 'This operation changed elsewhere. Refresh and review its current state before acting.';
  }
  if (category === 'provider_unavailable' || category === 'provider_error' || status === 503 || status === 502) {
    return language === 'ar'
      ? 'مزود الذكاء الاصطناعي غير متاح حاليًا. لم أؤكد تنفيذ أي طلب.'
      : 'The AI provider is unavailable right now. No request was confirmed as completed.';
  }
  if (category === 'provider_rate_limit' || category === 'rate_limit' || status === 429) {
    return language === 'ar'
      ? 'وصل مزود الذكاء الاصطناعي إلى حد مؤقت. انتظر قليلًا ثم أعد المحاولة.'
      : 'The AI provider reached a temporary limit. Wait briefly, then try again.';
  }
  if (category === 'validation' || status === 400 || status === 422) {
    return language === 'ar'
      ? 'الطلب يحتاج إلى تفاصيل أو تصحيح قبل إكماله.'
      : 'The request needs more detail or correction before it can continue.';
  }
  if (category === 'permission' || status === 403) {
    return language === 'ar' ? 'ليس لديك إذن لتنفيذ هذا الإجراء.' : 'You do not have permission to perform this action.';
  }
  if (category === 'not_found' || status === 404) {
    return language === 'ar' ? 'لم تعد هذه العملية موجودة. حدّث الشاشة.' : 'This operation is no longer available. Refresh the screen.';
  }
  if (error instanceof TypeError) {
    return language === 'ar'
      ? 'تعذر الاتصال بالخدمة. تحقّق من اتصالك ثم راجع الحالة قبل إعادة إجراء تغييري.'
      : 'Could not reach the service. Check your connection and verify the status before repeating a write.';
  }
  return language === 'ar'
    ? (approval ? 'تعذر حفظ قرارك. راجع حالة العملية ثم حاول مجددًا.' : 'تعذر إكمال الطلب. حاول مرة أخرى.')
    : (approval ? 'Your decision could not be saved. Check the operation status before trying again.' : 'The request could not be completed. Try again.');
}

function operationNoticeFromAction(action: unknown): LocalMessage['operationNotice'] {
  const value = objectValue(action);
  const verification = objectValue(value.verification);
  const rawStatus = [verification.outcome, verification.status, verification.state, value.outcome, value.status]
    .find((candidate): candidate is string => typeof candidate === 'string')
    ?.toLowerCase();
  const withOperationId = (status: NonNullable<LocalMessage['operationNotice']>['status']): LocalMessage['operationNotice'] => ({
    status,
    ...(typeof value.operationId === 'string' ? { operationId: value.operationId } : {}),
  });
  if (rawStatus === 'unknown_result' || rawStatus === 'uncertain') return withOperationId('unknown_result');
  if (rawStatus === 'needs_review' || value.type === 'needs_review') return withOperationId('needs_review');
  if (['approval_required', 'pending_confirmation'].includes(String(value.type))) return withOperationId('pending_approval');
  if (rawStatus === 'waiting' || rawStatus === 'queued') return withOperationId('waiting');
  if (rawStatus === 'completed' || rawStatus === 'verified' || verification.verified === true) return withOperationId('completed');
  if (rawStatus === 'rejected' || rawStatus === 'expired' || rawStatus === 'failed') return withOperationId(rawStatus);
  return undefined;
}

function approvalOutcomeMayBeUnknown(error: unknown) {
  const value = error && typeof error === 'object' ? error as { name?: unknown; status?: unknown; category?: unknown } : {};
  return (error instanceof SecretaryChatTransportError && error.category === 'timeout')
    || value.name === 'FetchTimeoutError'
    || value.category === 'timeout'
    || value.status === 408
    || value.status === 504
    || error instanceof TypeError;
}

export default function MainRoute() {
  const { language, setLanguage } = useLanguage();
  const { themePreference, setThemePreference } = useThemePreference();
  const { logout } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    recordId?: string;
    recordType?: string;
    recordTitle?: string;
    recordSubtitle?: string;
    recordTrailing?: string;
    workId?: string;
  }>();
  const [mainSection, setMainSection] = useState<MainSection>('office');
  const [selectedRecord, setSelectedRecord] = useState<MobileRecordRow | null>(null);
  const [recordReturnSection, setRecordReturnSection] = useState<MainSection>('office');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [memorySheetOpen, setMemorySheetOpen] = useState(false);
  const [chatContext, setChatContext] = useState<MobileRecordRow | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([starterMessage]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [focusedApproval, setFocusedApproval] = useState<{ operationId: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [busyOperationId, setBusyOperationId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [inputReview, setInputReview] = useState<SecretaryInputResult | null>(null);
  const [conversationToLoad, setConversationToLoad] = useState<string | null>(null);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const [conversationSearch, setConversationSearch] = useState('');
  const [assistantPreferences, setAssistantPreferences] = useState<AssistantPreferences>(defaultAssistantPreferences);
  const queryClient = useQueryClient();
  const proactivePreferencesQuery = useGetProactivePreferences({
    query: {
      queryKey: getGetProactivePreferencesQueryKey(),
      staleTime: 30_000,
    },
  });
  const updateProactivePreferences = useUpdateProactivePreferences();
  const secretaryChat = useSecretaryChatService(conversationToLoad, conversationSearch.trim(), true);
  const focusedApprovalQuery = useGetSecretaryOperation(focusedApproval?.operationId ?? '', {
    query: {
      queryKey: getGetSecretaryOperationQueryKey(focusedApproval?.operationId ?? ''),
      enabled: Boolean(focusedApproval),
    },
  });
  const conversationQuery = secretaryChat.conversationQuery;
  const recentConversations = secretaryChat.conversationsQuery.data?.conversations ?? [];
  const inputCapture = useSecretaryInputCapture(
    (result) => {
      setInputReview(result);
      setDraft(result.kind === 'receipt' ? receiptDraft(result) : result.text);
      setLocalError(null);
    },
    setLocalError,
  );
  function applyPreferenceResponse(preferences: NonNullable<typeof proactivePreferencesQuery.data>) {
    setAssistantPreferences({
      activity: preferences.activity,
      proactive: preferences.proactive,
      intelligence: preferences.intelligence,
      communicationStyle: preferences.communicationStyle,
      repeatReminders: preferences.repeatReminders,
    });
    if (preferences.explicitFields.includes('language')) {
      setLanguage(preferences.language);
    }
  }
  function updateAssistantPreference(patch: Partial<AssistantPreferences>) {
    setAssistantPreferences((current) => ({ ...current, ...patch }));
    updateProactivePreferences.mutate(
      { data: patch },
      {
        onSuccess: (preferences) => {
          queryClient.setQueryData(getGetProactivePreferencesQueryKey(), preferences);
          applyPreferenceResponse(preferences);
          setLocalError(null);
        },
        onError: () => {
          if (proactivePreferencesQuery.data) applyPreferenceResponse(proactivePreferencesQuery.data);
          setLocalError(language === 'ar'
            ? 'تعذر حفظ الإعدادات على الحساب. تمت استعادة آخر إعداد محفوظ.'
            : 'Could not save account settings. The last saved settings were restored.');
        },
      },
    );
  }
  function updateAppLanguage(value: 'ar' | 'en') {
    setLanguage(value);
    updateProactivePreferences.mutate(
      { data: { language: value } },
      {
        onSuccess: (preferences) => {
          queryClient.setQueryData(getGetProactivePreferencesQueryKey(), preferences);
          applyPreferenceResponse(preferences);
          setLocalError(null);
        },
        onError: () => {
          if (proactivePreferencesQuery.data) applyPreferenceResponse(proactivePreferencesQuery.data);
          setLocalError(language === 'ar'
            ? 'تعذر حفظ اللغة على الحساب.'
            : 'Could not save the language to your account.');
        },
      },
    );
  }
  function updateInputReview(result: SecretaryInputResult) {
    setInputReview(result);
    setDraft(result.kind === 'receipt' ? receiptDraft(result) : result.text);
  }

  async function handleLogout() {
    setDrawerOpen(false);
    await logout();
  }

  useEffect(() => {
    if (!params.recordId || !params.recordType || !params.recordTitle) return;
    setSelectedRecord({
      id: params.recordId,
      recordType: params.recordType,
      title: params.recordTitle,
      subtitle: params.recordSubtitle ?? '',
      ...(params.recordTrailing ? { trailing: params.recordTrailing } : {}),
    });
    setMainSection('records');
  }, [params.recordId, params.recordSubtitle, params.recordTrailing, params.recordTitle, params.recordType]);

  useEffect(() => {
    if (typeof params.workId === 'string' && params.workId) setMainSection('works');
  }, [params.workId]);

  useEffect(() => {
    void initializeSecretaryPush();
  }, []);

  useEffect(() => {
    if (!proactivePreferencesQuery.isFetched) return;
    if (proactivePreferencesQuery.data) applyPreferenceResponse(proactivePreferencesQuery.data);
    else if (proactivePreferencesQuery.isError) {
      setLocalError(language === 'ar'
        ? 'تعذر تحميل تفضيلات الحساب.'
        : 'Could not load account preferences.');
    }
    setHydrated(true);
  }, [proactivePreferencesQuery.data, proactivePreferencesQuery.isFetched, proactivePreferencesQuery.isError]);

  useEffect(() => {
    if (!conversationToLoad || loadedConversationId === conversationToLoad || !conversationQuery.data) return;
    setMessages(messagesFromConversation(conversationQuery.data, conversationToLoad));
    setConversationId(conversationToLoad);
    setLoadedConversationId(conversationToLoad);
    setLocalError(null);
  }, [conversationQuery.data, conversationToLoad, loadedConversationId]);

  useEffect(() => {
    if (!focusedApproval) return;
    const operation = focusedApprovalQuery.data;
    if (operation && operation.operationId === focusedApproval.operationId) {
      const args = objectValue(operation.args);
      const approval: Approval = {
        operationId: operation.operationId,
        title: operation.display.title,
        details: operation.display.details,
        status: operation.status as ApprovalStatus,
        toolName: operation.toolName,
        initialArgs: args,
      };
      setConversationToLoad(null);
      setLoadedConversationId(null);
      setConversationId(operation.conversationId ?? undefined);
      setMessages([{
        id: `home-approval-${operation.operationId}`,
        role: 'assistant',
        text: language === 'ar' ? 'راجع العملية المحفوظة قبل اتخاذ القرار.' : 'Review the saved operation before deciding.',
        createdAt: new Date().toISOString(),
        approval,
      }]);
      setMainSection('chat');
      setFocusedApproval(null);
      setLocalError(null);
    } else if (focusedApprovalQuery.isError) {
      setFocusedApproval(null);
      setLocalError(language === 'ar' ? 'تعذر جلب حالة الموافقة الحالية.' : 'Could not load the current approval status.');
    }
  }, [focusedApproval, focusedApprovalQuery.data, focusedApprovalQuery.isError, language]);

  function appendMessage(message: LocalMessage) {
    setMessages((current) => [...current, message].slice(-40));
  }
  async function sendMessage(value = draft) {
    const message = value.trim();
    if (!message || secretaryChat.isSending || conversationQuery.isFetching) return;
    if (receiptNeedsReview(inputReview)) {
      setLocalError('أكمل مبلغ الفاتورة والعملة قبل إرسال المسودة.');
      return;
    }
    setDraft('');
    const submittedInputId = inputReview?.inputId ?? null;
    const submittedInputAttachment = inputReview?.localAttachment ?? null;
    setInputReview(null);
    setLocalError(null);
    appendMessage({
      id: `user-${Date.now()}`,
      role: 'user',
      text: message,
      createdAt: new Date().toISOString(),
      ...(submittedInputId ? { inputId: submittedInputId } : {}),
      ...(submittedInputAttachment ? { inputAttachment: submittedInputAttachment } : {}),
    });
    try {
       const result = await secretaryChat.sendTurn({ message, conversationId: conversationId ?? null, channel: chatContext ? 'record' : 'main', context: chatContext ? secretaryContextFromRecord(chatContext) : null, inputId: submittedInputId });
      setConversationId(result.conversationId);
       void queryClient.invalidateQueries({ queryKey: getListPendingSecretaryApprovalsQueryKey() });
      const linked = recordLinkFromAction(result.action);
       const operationNotice = operationNoticeFromAction(result.action);
      appendMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: result.assistantMessage || result.response?.message || 'تم استلام طلبك.',
        createdAt: new Date().toISOString(),
        ...(result.turnId ? { turnId: result.turnId } : {}),
         ...(operationNotice ? { operationNotice } : {}),
        ...(() => {
          const approvals = approvalsFromAction(result.action);
          return approvals.length > 0
            ? { approval: approvals[0], ...(approvals.length > 1 ? { approvals } : {}) }
            : {};
        })(),
        ...(linked ? { recordLink: addOrigin(linked, result.conversationId, typeof objectValue(result.action).operationId === 'string' ? objectValue(result.action).operationId as string : null, result.turnId) } : {}),
      });
    } catch (error) {
      setLocalError(secretaryFailureText(error, language));
      void queryClient.invalidateQueries({ queryKey: getListPendingSecretaryApprovalsQueryKey() });
    }
  }
  async function updateApproval(approval: Approval, status: ApprovalStatus, args?: Record<string, unknown>) {
    setBusyOperationId(approval.operationId);
    setLocalError(null);
    try {
      const response = status === 'completed'
        ? await secretaryChat.approveOperation(approval.operationId, args)
        : await secretaryChat.rejectOperation(approval.operationId);
      const linked = recordLinkFromAction(response.action);
      const operationNotice = operationNoticeFromAction(response.action);
      setMessages((current) => current.map((message) => {
        const approvals = message.approvals ?? (message.approval ? [message.approval] : []);
        if (!approvals.some((item) => item.operationId === approval.operationId)) return message;
        const updatedApprovals = approvals.map((item) => item.operationId === approval.operationId
          ? { ...item, status: response.status as ApprovalStatus }
          : item);
        return {
          ...message,
          approval: updatedApprovals[0],
          ...(updatedApprovals.length > 1 ? { approvals: updatedApprovals } : {}),
          ...(linked ? { recordLink: addOrigin(linked, response.conversationId, response.operationId, response.turnId) } : {}),
        };
      }));
      setConversationId(response.conversationId);
      if (response.assistantMessage || operationNotice) appendMessage({
        id: `approval-${Date.now()}`,
        role: 'assistant',
        text: response.assistantMessage ?? '',
        createdAt: new Date().toISOString(),
        ...(operationNotice ? { operationNotice } : {}),
        ...(linked ? { recordLink: addOrigin(linked, response.conversationId, response.operationId, response.turnId) } : {}),
      });
      void queryClient.invalidateQueries({ queryKey: getListPendingSecretaryApprovalsQueryKey() });
      if (status === 'completed') await queryClient.invalidateQueries({ queryKey: ['records'] });
    } catch (error) {
      setLocalError(secretaryFailureText(error, language, true));
      if (approvalOutcomeMayBeUnknown(error)) {
        setMessages((current) => current.map((message) => {
          const approvals = message.approvals ?? (message.approval ? [message.approval] : []);
          if (!approvals.some((item) => item.operationId === approval.operationId)) return message;
          return {
            ...message,
            operationNotice: { status: 'unknown_result', operationId: approval.operationId },
          };
        }));
      }
      void queryClient.invalidateQueries({ queryKey: getListPendingSecretaryApprovalsQueryKey() });
    } finally {
      setBusyOperationId(null);
    }
  }
  function handleRecordPendingApproval(approval: Approval) {
    appendMessage({
      id: `record-approval-${Date.now()}`,
      role: 'assistant',
      text: 'التعديل جاهز للمراجعة. راجع التفاصيل ثم وافق لإكمال الحفظ.',
      createdAt: new Date().toISOString(),
      approval,
    });
    setSelectedRecord(null);
    setMainSection('chat');
    setChatContext(null);
  }
  function openMainSection(section: MainSection) {
    setSelectedRecord(null);
    setMainSection(section);
    setChatContext(null);
    setDrawerOpen(false);
  }
  function openRecordSection(sectionKey: string) {
    const section: MainSection = sectionKey === 'people' ? 'people' : sectionKey === 'projects' ? 'projects' : sectionKey === 'tasks' ? 'tasks' : sectionKey === 'reminders' ? 'reminders' : sectionKey === 'activity' ? 'activity' : 'financial';
    openMainSection(section);
  }
  function openRecord(record: MobileRecordRow) {
    setRecordReturnSection(mainSection);
    setSelectedRecord(record);
    setMainSection('records');
    setChatContext(null);
  }
  function openConversation(origin: RecordOrigin) {
    if (origin.conversationId !== conversationId) {
      setConversationToLoad(origin.conversationId);
      setLoadedConversationId(null);
    }
    setSelectedRecord(null);
    setMainSection('chat');
  }
  function openConversationById(id: string) {
    openConversation({ conversationId: id });
  }
  function askSecretaryAboutRecord() {
    if (!selectedRecord) return;
    setDraft(`اسألني عن ${selectedRecord.title}`);
    setChatContext(selectedRecord);
    setSelectedRecord(null);
    setMainSection('chat');
  }
  const recordOrigins = messages.reduce<Record<string, RecordOrigin>>((origins, message) => {
    if (message.recordLink?.origin) origins[message.recordLink.id] = message.recordLink.origin;
    return origins;
  }, {});
  const topInset = insets.top + (Platform.OS === 'web' ? 18 : 0);
  const isRtl = language === 'ar';

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={topInset}
    >
      <View style={[styles.header, { paddingTop: topInset + 3, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={[styles.headerTop, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <Pressable
            testID="open-main-drawer-from-brand"
            accessibilityRole="button"
            accessibilityLabel={language === 'en' ? 'Open the workspace menu' : 'فتح قائمة البرنامج'}
            onPress={() => setDrawerOpen(true)}
            style={({ pressed }) => [styles.brandBlock, { flexDirection: isRtl ? 'row-reverse' : 'row', opacity: pressed ? 0.7 : 1 }]}
          >
            <LinearGradient
              colors={[colors.primary, colors.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.brandMark}
            >
              <Feather name="star" size={17} color={colors.primaryForeground} />
            </LinearGradient>
            <View>
              <Text style={[styles.brandName, { color: colors.foreground, textAlign: isRtl ? 'right' : 'left' }]}>{language === 'en' ? 'Personal Secretary' : 'سكرتيرك الذكي'}</Text>
              <View style={[styles.availability, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                <View style={[styles.statusDot, { backgroundColor: colors.accent }]} />
                <Text style={[styles.availabilityText, { color: colors.mutedForeground, textAlign: isRtl ? 'right' : 'left' }]}>{language === 'en' ? 'Your full workspace' : 'مكتبك الكامل · سياقك وسجلاتك'}</Text>
              </View>
            </View>
          </Pressable>
          <View style={[styles.headerActions, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <Pressable testID="main-quick-bubble" accessibilityRole="button" accessibilityLabel={language === 'en' ? 'Open Quick Chat' : 'فتح السكرتير بسرعة'} onPress={() => router.replace('/')} style={({ pressed }) => [styles.iconButton, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}><Feather name="message-circle" size={17} color={colors.mutedForeground} /></Pressable>
            <Pressable testID="open-main-drawer" accessibilityRole="button" accessibilityLabel={language === 'en' ? 'Open workspace menu' : 'فتح قائمة البرنامج'} onPress={() => setDrawerOpen(true)} style={({ pressed }) => [styles.iconButton, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}><Feather name="menu" size={18} color={colors.foreground} /></Pressable>
          </View>
        </View>
      </View>
      {!hydrated ? <View style={styles.loadingState}><ActivityIndicator color={colors.primary} /></View> : (
        <MainWorkspace bottomBarClearance={Math.max(17, insets.bottom + 9) + 84}>
          <View style={{ flex: 1 }}>
            <View
              pointerEvents={selectedRecord ? 'none' : 'auto'}
              style={[{ flex: 1 }, selectedRecord && { opacity: 0 }]}
            >
                {mainSection === 'office' && (
                  <SecretaryHome
                    language={language}
                    onOpenAsk={() => openMainSection('chat')}
                    onOpenRecord={openRecord}
                    onReviewApproval={(approval) => {
                      if (approval.conversationId) {
                        openConversationById(approval.conversationId);
                      } else {
                        setFocusedApproval({ operationId: approval.operationId });
                        setMessages([{
                          id: `loading-approval-${approval.operationId}`,
                          role: 'assistant',
                          text: language === 'ar' ? 'جارٍ التحقق من حالة الموافقة…' : 'Checking the current approval status…',
                          createdAt: new Date().toISOString(),
                        }]);
                        openMainSection('chat');
                      }
                    }}
                    onOpenWork={(workId) => {
                      router.setParams({ workId });
                      openMainSection('works');
                    }}
                    onOpenContext={() => openMainSection('context')}
                  />
                )}
                {mainSection === 'chat' && (
                  <AskView
                    colors={colors}
                    messages={messages}
                    draft={draft}
                    onChangeDraft={setDraft}
                    onSend={() => void sendMessage()}
                    onQuickPrompt={(value) => void sendMessage(value)}
                    isSending={secretaryChat.isSending || conversationQuery.isFetching || inputCapture.state === 'processing'}
                    onApprove={(approval, args) => void updateApproval(approval, 'completed', args)}
                    onReject={(approval) => void updateApproval(approval, 'rejected')}
                    busyOperationId={busyOperationId}
                    onOpenRecord={openRecord}
                    onRetryInput={(attachment) => { if (attachment) void inputCapture.retryAttachment(attachment); }}
                    retryingInput={inputCapture.state === 'processing'}
                    context={chatContext}
                    smartSignal={localError ?? undefined}
                    quickPrompts={undefined}
                    inputState={inputCapture.state}
                    onToggleVoice={() => void inputCapture.toggleVoice()}
                    onCaptureReceipt={() => void inputCapture.pickReceipt('camera')}
                    onPickReceipt={() => void inputCapture.pickReceipt('library')}
                    inputReview={inputReview}
                    onChangeInputReview={updateInputReview}
                    onClearInputReview={() => setInputReview(null)}
                    onOpenHistory={() => openMainSection('history')}
                  />
                )}
                {mainSection === 'history' && <ConversationHistoryView colors={colors} language={language} conversations={recentConversations} loading={secretaryChat.conversationsQuery.isFetching} onOpenConversation={openConversationById} onBack={() => openMainSection('chat')} />}
                {mainSection === 'context' && (
                  <ContextHub
                    language={language}
                    onOpenPeople={() => openMainSection('people')}
                    onOpenProjects={() => openMainSection('projects')}
                    onOpenRecords={() => openMainSection('records')}
                    onOpenMemory={() => setMemorySheetOpen(true)}
                    onOpenConnections={() => openMainSection('connections')}
                  />
                )}
                {mainSection === 'connections' && <ConnectionsView language={language} onBack={() => openMainSection('context')} />}
                {mainSection === 'records' && <RecordsView colors={colors} onOpenSection={openRecordSection} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
                {mainSection === 'people' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="الأشخاص" titleEn="People" subtitle="الأشخاص وعلاقاتهم بالسجلات والمشاريع" subtitleEn="People and their links to records and projects" sectionKeys={['people']} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
               {mainSection === 'projects' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="المشاريع" titleEn="Projects" subtitle="المشاريع النشطة وسياقها المرتبط" subtitleEn="Active projects and their related context" sectionKeys={['projects']} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
               {mainSection === 'financial' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="الماليات" titleEn="Finances" subtitle="المصروفات والالتزامات والعلاقات المالية" subtitleEn="Expenses, commitments, and financial relationships" sectionKeys={['expenses', 'commitments']} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
               {mainSection === 'tasks' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="المهام" titleEn="Tasks" subtitle="المهام المفتوحة والمكتملة المرتبطة بسياقك" subtitleEn="Open and completed tasks connected to your context" sectionKeys={['tasks']} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
               {mainSection === 'reminders' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="التذكيرات" titleEn="Reminders" subtitle="كل المواعيد والتنبيهات التي يتابعها السكرتير" subtitleEn="Appointments and reminders your secretary tracks" sectionKeys={['reminders']} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
                 {mainSection === 'activity' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="النشاط" titleEn="Activity" subtitle="آخر السجلات والحركة التي تستحق المراجعة" subtitleEn="Recent records and updates worth reviewing" onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
                 {mainSection === 'works' && <WorksView colors={colors} language={language} initialWorkId={typeof params.workId === 'string' ? params.workId : undefined} onBack={() => openMainSection('office')} onStartFollowing={() => { setDraft(language === 'ar' ? 'عايز السكرتير يتابع ' : 'I want the secretary to follow '); setInputReview(null); openMainSection('chat'); }} />}
                 {mainSection === 'settings' && <SettingsSection colors={colors} language={language} themePreference={themePreference} onThemeChange={setThemePreference} onLanguageChange={updateAppLanguage} assistantPreferences={assistantPreferences} onAssistantPreferencesChange={updateAssistantPreference} onOpenPersonalInformation={() => openMainSection('personal-information')} onBack={() => openMainSection('office')} />}
                 {mainSection === 'personal-information' && <PersonalInformationSection colors={colors} language={language} onBack={() => openMainSection('settings')} onOpenMemoryLibrary={() => setMemorySheetOpen(true)} />}
            </View>
            {selectedRecord && (
              <View style={[{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, { backgroundColor: colors.background }]}>
                <RecordDetailView record={selectedRecord} colors={colors} language={language} onBack={() => { setSelectedRecord(null); setMainSection(recordReturnSection); }} onAskSecretary={askSecretaryAboutRecord} onOpenConversation={openConversation} onOpenRelatedRecord={openRecord} onPendingApproval={handleRecordPendingApproval} onRecordSaved={() => setSelectedRecord(null)} chatMessages={messages} chatDraft={draft} onChangeChatDraft={setDraft} onSendChat={() => void sendMessage()} chatBusy={secretaryChat.isSending || conversationQuery.isFetching} onApprove={(approval, args) => void updateApproval(approval, 'completed', args)} onReject={(approval) => void updateApproval(approval, 'rejected')} busyOperationId={busyOperationId} chatContext={chatContext} />
              </View>
            )}
          </View>
        </MainWorkspace>
      )}
      {hydrated && (
        <MainBottomBar
          colors={colors}
          language={language}
          activeSection={selectedRecord ? 'records' : mainSection}
          onSelect={openMainSection}
          onOpenDrawer={() => setDrawerOpen(true)}
        />
      )}
      {hydrated && (
        <MainDrawer
          colors={colors}
          language={language}
          open={drawerOpen}
          activeSection={mainSection}
          onClose={() => setDrawerOpen(false)}
          onSelect={openMainSection}
          onOpenQuick={() => router.replace('/')}
          onOpenMemories={() => {
            setDrawerOpen(false);
            setMemorySheetOpen(true);
          }}
           onLogout={() => void handleLogout()}
        />
      )}
      <SecondBrainMemorySheet
        colors={colors}
        language={language}
        visible={memorySheetOpen}
        onClose={() => setMemorySheetOpen(false)}
      />
      {localError && <View style={styles.errorRow}>
        <Text style={{ color: colors.destructive, padding: 12, flex: 1 }}>{localError}</Text>
        {inputCapture.canRetry && <Pressable onPress={() => void inputCapture.retry()} style={styles.retryButton}>
          <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>{language === 'en' ? 'Retry' : 'إعادة المحاولة'}</Text>
        </Pressable>}
      </View>}
    </KeyboardAvoidingView>
  );
}
