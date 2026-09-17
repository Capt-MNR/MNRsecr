import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, useThemePreference } from '@/hooks/useColors';
import { useLanguage } from '@/hooks/useLanguage';
import appColors from '@/constants/colors';
import { useSecretaryChatService } from '../services/secretary-chat';
import { initializeSecretaryPush } from '../services/mobile-push';
import { isQuickNotificationResponse } from '../services/quick-notification';
import {
  MainDrawer,
  MainOffice,
  MainWorkspace,
  RecordDetailView,
  RecordsView,
  addOrigin,
  approvalFromAction,
  messagesFromConversation,
  objectValue,
  recordLinkFromAction,
  secretaryContextFromRecord,
  starterMessage,
  STORAGE_CONVERSATION,
  STORAGE_MESSAGES,
  styles,
  type Approval,
  type ApprovalStatus,
  type LocalMessage,
  type MainSection,
  type MobileRecordRow,
  type RecordOrigin,
} from '../features/main';

const mainWorkspaceColors = { ...appColors.dark, radius: appColors.radius };

export default function MainRoute() {
  const colors = mainWorkspaceColors as ReturnType<typeof useColors>;
  const { language, setLanguage } = useLanguage();
  const { themePreference, setThemePreference } = useThemePreference();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    recordId?: string;
    recordType?: string;
    recordTitle?: string;
    recordSubtitle?: string;
    recordTrailing?: string;
  }>();
  const inputRef = useRef<TextInput>(null);
  const [mainSection, setMainSection] = useState<MainSection>('office');
  const [selectedRecord, setSelectedRecord] = useState<MobileRecordRow | null>(null);
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
  const secretaryChat = useSecretaryChatService(conversationToLoad, conversationSearch.trim(), true);
  const conversationQuery = secretaryChat.conversationQuery;
  const recentConversations = secretaryChat.conversationsQuery.data?.conversations ?? [];

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
    let active = true;
    void AsyncStorage.multiGet([STORAGE_MESSAGES, STORAGE_CONVERSATION]).then(([storedMessages, storedConversation]) => {
      if (!active) return;
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
    void initializeSecretaryPush();
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (isQuickNotificationResponse(response)) router.replace('/');
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [router]);

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
    appendMessage({ id: `user-${Date.now()}`, role: 'user', text: message, createdAt: new Date().toISOString() });
    try {
      const result = await secretaryChat.sendTurn({ message, conversationId: conversationId ?? null, channel: chatContext ? 'record' : 'main', context: chatContext ? secretaryContextFromRecord(chatContext) : null });
      setConversationId(result.conversationId);
      const linked = recordLinkFromAction(result.action);
      appendMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: result.assistantMessage || result.response?.message || 'تم استلام طلبك.',
        createdAt: new Date().toISOString(),
        ...(result.turnId ? { turnId: result.turnId } : {}),
        approval: approvalFromAction(result.action),
        ...(linked ? { recordLink: addOrigin(linked, result.conversationId, typeof objectValue(result.action).operationId === 'string' ? objectValue(result.action).operationId as string : null, result.turnId) } : {}),
      });
    } catch {
      setLocalError('لم أتمكن من الوصول للسكرتير. جرّب مرة أخرى.');
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
      setMessages((current) => current.map((message) => message.approval?.operationId === approval.operationId
        ? { ...message, approval: { ...approval, status: response.status as ApprovalStatus }, ...(linked ? { recordLink: addOrigin(linked, response.conversationId, response.operationId, response.turnId) } : {}) }
        : message));
      setConversationId(response.conversationId);
      if (response.assistantMessage) appendMessage({ id: `approval-${Date.now()}`, role: 'assistant', text: response.assistantMessage, createdAt: new Date().toISOString(), ...(linked ? { recordLink: addOrigin(linked, response.conversationId, response.operationId, response.turnId) } : {}) });
      if (status === 'completed') await queryClient.invalidateQueries({ queryKey: ['records'] });
    } catch {
      setLocalError('لم يتم حفظ قرار الموافقة. جرّب مرة أخرى.');
    } finally {
      setBusyOperationId(null);
    }
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
    setMainSection('office');
  }
  function openConversationById(id: string) {
    openConversation({ conversationId: id });
  }
  function askSecretaryAboutRecord() {
    if (!selectedRecord) return;
    setDraft(`اسألني عن ${selectedRecord.title}`);
    setChatContext(selectedRecord);
    setSelectedRecord(null);
    setMainSection('office');
    setTimeout(() => inputRef.current?.focus(), 0);
  }
  const recordOrigins = messages.reduce<Record<string, RecordOrigin>>((origins, message) => {
    if (message.recordLink?.origin) origins[message.recordLink.id] = message.recordLink.origin;
    return origins;
  }, {});
  const topInset = insets.top + (Platform.OS === 'web' ? 67 : 0);

  return (
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: colors.background }]} behavior="padding">
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <View style={styles.headerTop}>
          <View style={styles.brandBlock}><View style={[styles.brandMark, { backgroundColor: colors.primary }]}><Feather name="grid" size={18} color={colors.primaryForeground} /></View><View><Text style={[styles.brandName, { color: colors.foreground }]}>مكتب السكرتير</Text><Text style={[styles.availabilityText, { color: colors.mutedForeground }]}>إدارة، استكشاف، ومراجعة</Text></View></View>
          <View style={styles.headerActions}>
            <Pressable testID="open-main-drawer" accessibilityRole="button" accessibilityLabel="فتح قائمة البرنامج" onPress={() => setDrawerOpen(true)} style={({ pressed }) => [styles.iconButton, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}><Feather name="menu" size={18} color={colors.foreground} /></Pressable>
            <Pressable testID="main-quick-bubble" accessibilityRole="button" accessibilityLabel="فتح السكرتير بسرعة" onPress={() => router.replace('/')} style={({ pressed }) => [styles.quickAccessBubble, { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 }]}><Feather name="message-circle" size={17} color={colors.primaryForeground} /></Pressable>
          </View>
        </View>
      </View>
      {!hydrated ? <View style={styles.loadingState}><ActivityIndicator color={colors.primary} /></View> : (
        <MainWorkspace>
          <MainDrawer colors={colors} language={language} themePreference={themePreference} open={drawerOpen} activeSection={mainSection} onClose={() => setDrawerOpen(false)} onSelect={openMainSection} onOpenQuick={() => router.replace('/')} onThemeChange={setThemePreference} onLanguageChange={setLanguage} />
          {selectedRecord ? <RecordDetailView record={selectedRecord} colors={colors} onBack={() => setSelectedRecord(null)} onAskSecretary={askSecretaryAboutRecord} onOpenConversation={openConversation} onOpenRelatedRecord={openRecord} chatMessages={messages} chatDraft={draft} onChangeChatDraft={setDraft} onSendChat={() => void sendMessage()} chatBusy={secretaryChat.isSending || conversationQuery.isFetching} onApprove={(approval, args) => void updateApproval(approval, 'completed', args)} onReject={(approval) => void updateApproval(approval, 'rejected')} busyOperationId={busyOperationId} chatContext={chatContext} /> : (
            <>
              {mainSection === 'office' && <MainOffice colors={colors} language={language} onOpenRecord={openRecord} onOpenRecords={() => openMainSection('records')} onOpenConversation={openConversationById} onFocusChat={() => setChatContext(null)} onAskSecretary={(value) => { setDraft(value); setTimeout(() => inputRef.current?.focus(), 0); }} messages={messages} draft={draft} onChangeDraft={setDraft} onSend={() => void sendMessage()} inputRef={inputRef} isSending={secretaryChat.isSending || conversationQuery.isFetching} onApprove={(approval, args) => void updateApproval(approval, 'completed', args)} onReject={(approval) => void updateApproval(approval, 'rejected')} busyOperationId={busyOperationId} recordOrigins={recordOrigins} chatContext={chatContext} recentConversations={recentConversations} conversationSearch={conversationSearch} onChangeConversationSearch={setConversationSearch} conversationsLoading={secretaryChat.conversationsQuery.isFetching} pendingApprovals={messages.flatMap((message) => message.approval?.status === 'pending' ? [message.approval] : [])} />}
              {mainSection === 'records' && <RecordsView colors={colors} onOpenSection={openRecordSection} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
              {mainSection === 'people' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="الأشخاص" subtitle="الأشخاص وعلاقاتهم بالسجلات والمشاريع" sectionKeys={['people']} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
              {mainSection === 'projects' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="المشاريع" subtitle="المشاريع النشطة وسياقها المرتبط" sectionKeys={['projects']} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
              {mainSection === 'financial' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="الماليات" subtitle="المصروفات والالتزامات والعلاقات المالية" sectionKeys={['expenses', 'commitments']} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
              {mainSection === 'tasks' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="المهام" subtitle="المهام المفتوحة والمكتملة المرتبطة بسياقك" sectionKeys={['tasks']} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
              {mainSection === 'reminders' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="التذكيرات" subtitle="كل المواعيد والتنبيهات التي يتابعها السكرتير" sectionKeys={['reminders']} onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
              {mainSection === 'activity' && <RecordsView colors={colors} onOpenSection={openRecordSection} title="النشاط / Timeline" subtitle="آخر السجلات والحركة التي تستحق المراجعة" onOpenRecord={openRecord} onBack={() => openMainSection('office')} />}
            </>
          )}
        </MainWorkspace>
      )}
      {localError && <Text style={{ color: colors.destructive, padding: 12 }}>{localError}</Text>}
    </KeyboardAvoidingView>
  );
}