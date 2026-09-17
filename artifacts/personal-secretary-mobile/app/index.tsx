import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ComponentProps, type ComponentType, type ReactNode } from 'react';
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
import QuickScreen from '../features/quick/QuickScreen';
import { QuickMessageBubble } from '../features/quick/QuickMessageBubble';

import {
  type Approval,
  type ApprovalStatus,
  type LocalMessage,
  type MainSection,
  type MobileRecordRow,
  type RecordOrigin,
  addOrigin,
  approvalFromAction,
  localized,
  messagesFromConversation,
  objectValue,
  recordLinkFromAction,
  secretaryContextFromRecord,
  starterMessage,
  suggestions,
  STORAGE_MESSAGES,
  STORAGE_CONVERSATION,
  styles as sharedStyles,
} from '../features/shared';
import type * as MainFeature from '../features/main';
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
  const [MainWorkspace, setMainWorkspace] = useState<ComponentType<{ children: ReactNode }> | null>(null);
  const [MainModule, setMainModule] = useState<typeof MainFeature | null>(null);
  const queryClient = useQueryClient();
  const secretaryChat = useSecretaryChatService(
    conversationToLoad,
    conversationSearch.trim(),
    activeView === 'home',
  );
  const conversationQuery = secretaryChat.conversationQuery;
  const recentConversations = secretaryChat.conversationsQuery.data?.conversations ?? [];
  const visibleSuggestions = language === 'en'
    ? ['What do I have today?', 'Remind me tomorrow to call Mohamed', 'How much does Mohamed owe me?']
    : suggestions;

  useEffect(() => {
    if (activeView !== 'home' || MainModule) return;
    let cancelled = false;
    void import('../features/main').then((module) => {
      if (!cancelled) {
        setMainModule(module);
        setMainWorkspace(() => module.MainWorkspace);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [MainModule, activeView]);

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
          result.turnId,
        )
        : undefined;
      appendMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: result.assistantMessage || result.response?.message || 'تم استلام طلبك.',
        createdAt: new Date().toISOString(),
        ...(result.turnId ? { turnId: result.turnId } : {}),
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

  async function updateApproval(approval: Approval, status: ApprovalStatus, args?: Record<string, unknown>) {
    setBusyOperationId(approval.operationId);
    setLocalError(null);
    try {
      const response = status === 'completed'
        ? await secretaryChat.approveOperation(approval.operationId, args)
        : await secretaryChat.rejectOperation(approval.operationId);
      const responseRecord = recordLinkFromAction(response.action);
      const linkedRecord = responseRecord
        ? addOrigin(
          responseRecord,
          response.conversationId,
          response.operationId,
          response.turnId,
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
        await queryClient.invalidateQueries({ queryKey: ['records'] });
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
  const MainDrawer = MainModule?.MainDrawer as typeof MainFeature.MainDrawer;
  const MainOffice = MainModule?.MainOffice as typeof MainFeature.MainOffice;
  const RecordDetailView = MainModule?.RecordDetailView as typeof MainFeature.RecordDetailView;
  const RecordsView = MainModule?.RecordsView as typeof MainFeature.RecordsView;
  const styles = MainModule?.styles ?? sharedStyles;

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

      {activeView === 'home' && MainWorkspace ? (
        <MainWorkspace>
          <>
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
            {selectedRecord ? (
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
               onApprove={(approval, args) => void updateApproval(approval, 'completed', args)}
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
                   onApprove={(approval, args) => void updateApproval(approval, 'completed', args)}
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
            )}
          </>
        </MainWorkspace>
      ) : activeView === 'home' ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !hydrated ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <QuickScreen>
          <FlatList
            inverted
            data={reversedMessages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <QuickMessageBubble
                message={item}
                colors={colors}
                onApprove={(approval) => void updateApproval(approval, 'completed')}
                onReject={(approval) => void updateApproval(approval, 'rejected')}
                onOpenMain={openHome}
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
        </QuickScreen>
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
