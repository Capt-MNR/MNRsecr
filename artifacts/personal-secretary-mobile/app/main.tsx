import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  getGetSecretaryOperationQueryKey,
  getListAgentWorksQueryKey,
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
import { useSecretaryChatService } from '../services/secretary-chat';
import {
  receiptDraft,
  receiptNeedsReview,
  useSecretaryInputCapture,
  type SecretaryInputResult,
} from '../services/secretary-input';
import {
  approvalOutcomeMayBeUnknown,
  operationNoticeFromAction,
  operationNoticeForHandoff,
  secretaryFailureText,
} from '../services/operation-presentation';
import type { QuickOperationStateHint } from '../services/quick-operation-handoff';
import { hydrateLocalInputAttachments } from '../services/local-input-assets';
import { agentWorkIdFromAction } from '../services/agent-work-presentation';
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
    operationId?: string;
    operationState?: string;
    conversationId?: string;
    providerTest?: string;
  }>();
  const [mainSection, setMainSection] = useState<MainSection>(
    params.providerTest === 'groq-only' || params.providerTest === 'groq-only-consumed'
      ? 'chat'
      : 'office',
  );
  const [selectedRecord, setSelectedRecord] = useState<MobileRecordRow | null>(null);
  const [recordReturnSection, setRecordReturnSection] = useState<MainSection>('office');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [memorySheetOpen, setMemorySheetOpen] = useState(false);
  const [chatContext, setChatContext] = useState<MobileRecordRow | null>(null);
  const [followEntryActive, setFollowEntryActive] = useState(false);
  const [messages, setMessages] = useState<LocalMessage[]>([starterMessage]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [focusedApproval, setFocusedApproval] = useState<{
    operationId: string;
    conversationId?: string;
    operationState?: QuickOperationStateHint;
  } | null>(null);
  const [draft, setDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [busyOperationId, setBusyOperationId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [inputReview, setInputReview] = useState<SecretaryInputResult | null>(null);
  const [conversationToLoad, setConversationToLoad] = useState<string | null>(null);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const [conversationSearch, setConversationSearch] = useState('');
  const groqOnlyTestAttempted = useRef(params.providerTest === 'groq-only-consumed');
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
  useEffect(() => {
    if (typeof params.operationId !== 'string' || !params.operationId) return;
    const operationState = params.operationState === 'unknown_result' || params.operationState === 'needs_review'
      ? params.operationState
      : undefined;
    setSelectedRecord(null);
    setMainSection('chat');
    setConversationToLoad(null);
    setLoadedConversationId(null);
    setFocusedApproval({
      operationId: params.operationId,
      ...(typeof params.conversationId === 'string' ? { conversationId: params.conversationId } : {}),
      ...(operationState ? { operationState } : {}),
    });
    setLocalError(null);
    router.setParams({ operationId: undefined, operationState: undefined, conversationId: undefined });
  }, [params.conversationId, params.operationId, params.operationState, router]);

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
      const operationNotice = operationNoticeForHandoff(
        operation.status,
        operation.operationId,
        focusedApproval.operationState,
      );
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
      setConversationId(operation.conversationId ?? focusedApproval.conversationId);
      setMessages([{
        id: `home-approval-${operation.operationId}`,
        role: 'assistant',
        text: language === 'ar'
          ? 'هذه العملية مرتبطة بمحادثة Quick. راجع التفاصيل والحالة الحالية أدناه.'
          : 'This action is linked to the Quick conversation. Review its details and current status below.',
        createdAt: new Date().toISOString(),
        approval,
        ...(operationNotice.status === 'pending_approval' || operationNotice.status === 'executing'
          ? {}
          : { operationNotice }),
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
    const groqOnlyTestRequested = params.providerTest === 'groq-only';
    const groqOnlyTestRoute = groqOnlyTestRequested || params.providerTest === 'groq-only-consumed';
    if (groqOnlyTestRoute && groqOnlyTestAttempted.current) {
      setLocalError(language === 'ar'
        ? 'تم استهلاك طلب اختبار Groq الوحيد. لا تعِد الإرسال من وضع الاختبار.'
        : 'The one Groq-only test request has been used. Do not send again in test mode.');
      return;
    }
    if (groqOnlyTestRequested && chatContext) {
      setLocalError(language === 'ar'
        ? 'اختبار Groq متاح من محادثة Main فقط، وليس من تفاصيل سجل.'
        : 'The Groq-only test is available from Main chat, not from a record detail.');
      return;
    }
    if (receiptNeedsReview(inputReview)) {
      setLocalError('أكمل مبلغ الفاتورة والعملة قبل إرسال المسودة.');
      return;
    }
    if (groqOnlyTestRequested) {
      groqOnlyTestAttempted.current = true;
      router.setParams({ providerTest: 'groq-only-consumed' });
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
       const result = await secretaryChat.sendTurn({
        message,
        conversationId: conversationId ?? null,
        channel: chatContext ? 'record' : 'main',
        context: chatContext ? secretaryContextFromRecord(chatContext) : null,
        inputId: submittedInputId,
        ...(groqOnlyTestRequested ? { providerFallbackPolicy: 'groq_only' } : {}),
      });
      setConversationId(result.conversationId);
       void queryClient.invalidateQueries({ queryKey: getListPendingSecretaryApprovalsQueryKey() });
      const linked = recordLinkFromAction(result.action);
      const actionApprovals = approvalsFromAction(result.action);
      const agentWorkId = agentWorkIdFromAction(result.action);
      const derivedNotice = operationNoticeFromAction(result.action, result.action?.status);
      const operationNotice = actionApprovals.length > 0 && derivedNotice?.status === 'pending_approval'
        ? undefined
        : derivedNotice;
      appendMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: result.assistantMessage || result.response?.message || 'تم استلام طلبك.',
        createdAt: new Date().toISOString(),
        ...(result.turnId ? { turnId: result.turnId } : {}),
         ...(operationNotice ? { operationNotice } : {}),
        ...(actionApprovals.length > 0
          ? { approval: actionApprovals[0], ...(actionApprovals.length > 1 ? { approvals: actionApprovals } : {}) }
          : {}),
        ...(linked ? { recordLink: addOrigin(linked, result.conversationId, typeof objectValue(result.action).operationId === 'string' ? objectValue(result.action).operationId as string : null, result.turnId) } : {}),
        ...(agentWorkId ? { agentWorkId } : {}),
      });
      setFollowEntryActive(false);
      if (agentWorkId) void queryClient.invalidateQueries({ queryKey: getListAgentWorksQueryKey() });
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
      const agentWorkId = agentWorkIdFromAction(response.action);
      const operationNotice = operationNoticeFromAction(response.action, response.status);
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
          ...(operationNotice ? { operationNotice } : {}),
          ...(agentWorkId ? { agentWorkId } : {}),
          ...(linked ? { recordLink: addOrigin(linked, response.conversationId, response.operationId, response.turnId) } : {}),
        };
      }));
      setConversationId(response.conversationId);
      if (response.assistantMessage) appendMessage({
        id: `approval-${Date.now()}`,
        role: 'assistant',
        text: response.assistantMessage,
        createdAt: new Date().toISOString(),
        ...(linked ? { recordLink: addOrigin(linked, response.conversationId, response.operationId, response.turnId) } : {}),
        ...(agentWorkId ? { agentWorkId } : {}),
      });
      if (agentWorkId) void queryClient.invalidateQueries({ queryKey: getListAgentWorksQueryKey() });
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
    setFollowEntryActive(false);
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
    setFollowEntryActive(false);
  }
  function openConversation(origin: RecordOrigin) {
    if (origin.conversationId !== conversationId) {
      setConversationToLoad(origin.conversationId);
      setLoadedConversationId(null);
    }
    setSelectedRecord(null);
    setMainSection('chat');
    setFollowEntryActive(false);
  }
  function openConversationById(id: string) {
    openConversation({ conversationId: id });
  }
  function askSecretaryAboutRecord() {
    if (!selectedRecord) return;
    setDraft(`اسألني عن ${selectedRecord.title}`);
    setChatContext(selectedRecord);
    setFollowEntryActive(false);
    setSelectedRecord(null);
    setMainSection('chat');
  }
  function startFollowingFromHome() {
    setDraft('');
    setInputReview(null);
    openMainSection('chat');
    setFollowEntryActive(true);
  }
  function startFollowingFromRecord() {
    if (!selectedRecord || !['person', 'project'].includes(selectedRecord.recordType)) return;
    setDraft('');
    setInputReview(null);
    setChatContext(selectedRecord);
    setFollowEntryActive(true);
    setSelectedRecord(null);
    setMainSection('chat');
  }
  function openWork(workId: string) {
    router.setParams({ workId });
    openMainSection('works');
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
                    onStartFollowing={startFollowingFromHome}
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
                    followEntryActive={followEntryActive}
                    onOpenWork={openWork}
                    smartSignal={localError ?? (
                      params.providerTest === 'groq-only'
                        ? (language === 'ar'
                          ? 'اختبار لمرة واحدة: إذا احتاج الطلب إلى نموذج فسيستخدم Groq فقط، بلا fallback. قد تنتهي قراءة محلية قبل استدعاء النموذج.'
                          : 'One-time test: if the turn needs a model, it can use Groq only, with no provider fallback. Local handling may finish before any model call.')
                        : params.providerTest === 'groq-only-consumed'
                          ? (language === 'ar'
                            ? 'استهلكت محاولة الاختبار الوحيدة، سواء اكتملت أو فشلت. لا تعِد الإرسال من وضع الاختبار.'
                            : 'The one test attempt has been consumed, whether it completed or failed. Do not send again in test mode.')
                          : undefined
                    )}
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
                {mainSection === 'connections' && (
                  <ConnectionsView
                    language={language}
                    onBack={() => openMainSection('context')}
                    onAsk={(prompt) => {
                      setDraft(prompt);
                      setInputReview(null);
                      openMainSection('chat');
                    }}
                  />
                )}
                {mainSection === 'records' && <RecordsView colors={colors} onOpenSection={openRecordSection} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
                {mainSection === 'people' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="الأشخاص" titleEn="People" subtitle="الأشخاص وعلاقاتهم بالسجلات والمشاريع" subtitleEn="People and their links to records and projects" sectionKeys={['people']} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
               {mainSection === 'projects' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="المشاريع" titleEn="Projects" subtitle="المشاريع النشطة وسياقها المرتبط" subtitleEn="Active projects and their related context" sectionKeys={['projects']} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
               {mainSection === 'financial' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="الماليات" titleEn="Finances" subtitle="المصروفات والالتزامات والعلاقات المالية" subtitleEn="Expenses, commitments, and financial relationships" sectionKeys={['expenses', 'commitments']} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
               {mainSection === 'tasks' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="المهام" titleEn="Tasks" subtitle="المهام المفتوحة والمكتملة المرتبطة بسياقك" subtitleEn="Open and completed tasks connected to your context" sectionKeys={['tasks']} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
               {mainSection === 'reminders' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="التذكيرات" titleEn="Reminders" subtitle="كل المواعيد والتنبيهات التي يتابعها السكرتير" subtitleEn="Appointments and reminders your secretary tracks" sectionKeys={['reminders']} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
                 {mainSection === 'activity' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="النشاط" titleEn="Activity" subtitle="آخر السجلات والحركة التي تستحق المراجعة" subtitleEn="Recent records and updates worth reviewing" onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
                  {mainSection === 'works' && <WorksView colors={colors} language={language} initialWorkId={typeof params.workId === 'string' ? params.workId : undefined} onBack={() => openMainSection('office')} onStartFollowing={startFollowingFromHome} />}
                 {mainSection === 'settings' && <SettingsSection colors={colors} language={language} themePreference={themePreference} onThemeChange={setThemePreference} onLanguageChange={updateAppLanguage} assistantPreferences={assistantPreferences} onAssistantPreferencesChange={updateAssistantPreference} onOpenPersonalInformation={() => openMainSection('personal-information')} onBack={() => openMainSection('office')} />}
                 {mainSection === 'personal-information' && <PersonalInformationSection colors={colors} language={language} onBack={() => openMainSection('settings')} onOpenMemoryLibrary={() => setMemorySheetOpen(true)} />}
            </View>
            {selectedRecord && (
              <View style={[{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, { backgroundColor: colors.background }]}>
                 <RecordDetailView record={selectedRecord} colors={colors} language={language} onBack={() => { setSelectedRecord(null); setMainSection(recordReturnSection); }} onAskSecretary={askSecretaryAboutRecord} onStartFollowing={startFollowingFromRecord} followEntryActive={followEntryActive} onOpenWork={openWork} onOpenConversation={openConversation} onOpenRelatedRecord={openRecord} onPendingApproval={handleRecordPendingApproval} onRecordSaved={() => setSelectedRecord(null)} chatMessages={messages} chatDraft={draft} onChangeChatDraft={setDraft} onSendChat={() => void sendMessage()} chatBusy={secretaryChat.isSending || conversationQuery.isFetching} onApprove={(approval, args) => void updateApproval(approval, 'completed', args)} onReject={(approval) => void updateApproval(approval, 'rejected')} busyOperationId={busyOperationId} chatContext={chatContext} />
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
