import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/hooks/useLanguage';
import {
  useSecretaryChatService,
} from '../../services/secretary-chat';
import { initializeSecretaryPush } from '../../services/mobile-push';
import {
  initializeQuickNotification,
  isQuickNotificationResponse,
} from '../../services/quick-notification';
import QuickScreen from './QuickScreen';
import { QuickMessageBubble } from './QuickMessageBubble';
import {
  addOrigin,
  approvalFromAction,
  localized,
  messagesFromConversation,
  objectValue,
  recordLinkFromAction,
  starterMessage,
  STORAGE_CONVERSATION,
  STORAGE_MESSAGES,
  styles,
  suggestions,
  type Approval,
  type ApprovalStatus,
  type LocalMessage,
  type MobileRecordRow,
} from './quick-model';

export default function QuickRoute() {
  const colors = useColors();
  const { language } = useLanguage();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([starterMessage]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [busyOperationId, setBusyOperationId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [conversationToLoad, setConversationToLoad] = useState<string | null>(null);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const secretaryChat = useSecretaryChatService(conversationToLoad, '', false);
  const conversationQuery = secretaryChat.conversationQuery;
  const visibleSuggestions = language === 'en'
    ? ['What do I have today?', 'Remind me tomorrow to call Mohamed', 'How much does Mohamed owe me?']
    : suggestions;

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
    void initializeQuickNotification();
    void initializeSecretaryPush();
    return () => {
      active = false;
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

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (isQuickNotificationResponse(response)) router.replace('/');
    });
    return () => subscription.remove();
  }, [router]);

  function appendMessage(message: LocalMessage) {
    setMessages((current) => [...current, message].slice(-40));
  }

  async function sendMessage(value = draft) {
    const message = value.trim();
    if (!message || secretaryChat.isSending || conversationQuery.isFetching) return;
    setDraft('');
    setLocalError(null);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    appendMessage({ id: `user-${Date.now()}`, role: 'user', text: message, createdAt: new Date().toISOString() });
    try {
      const result = await secretaryChat.sendTurn({
        message,
        conversationId: conversationId ?? null,
        channel: 'quick',
        context: null,
      });
      setConversationId(result.conversationId);
      await queryClient.invalidateQueries({ queryKey: ['secretary-chat-conversations'] });
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
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setLocalError('لم أتمكن من الوصول للسكرتير. جرّب مرة أخرى.');
      appendMessage({ id: `error-${Date.now()}`, role: 'assistant', text: 'حصلت مشكلة مؤقتة في الاتصال. رسالتك لم تُنفّذ.', createdAt: new Date().toISOString() });
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
      const linked = recordLinkFromAction(response.action);
      setMessages((current) => current.map((message) => message.approval?.operationId === approval.operationId
        ? { ...message, approval: { ...approval, status: response.status as ApprovalStatus }, ...(linked ? { recordLink: addOrigin(linked, response.conversationId, response.operationId, response.turnId) } : {}) }
        : message));
      setConversationId(response.conversationId);
      await queryClient.invalidateQueries({ queryKey: ['secretary-chat-conversations'] });
      if (response.assistantMessage) appendMessage({ id: `approval-${Date.now()}`, role: 'assistant', text: response.assistantMessage, createdAt: new Date().toISOString(), ...(linked ? { recordLink: addOrigin(linked, response.conversationId, response.operationId, response.turnId) } : {}) });
      if (status === 'completed') await queryClient.invalidateQueries({ queryKey: ['records'] });
      await Haptics.notificationAsync(status === 'completed' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
    } catch {
      setLocalError('لم يتم حفظ قرار الموافقة. جرّب مرة أخرى.');
    } finally {
      setBusyOperationId(null);
    }
  }

  function openMain(record?: MobileRecordRow) {
    if (record) {
      router.push({
        pathname: '/main',
        params: {
          recordId: record.id,
          recordType: record.recordType,
          recordTitle: record.title,
          recordSubtitle: record.subtitle,
          recordTrailing: record.trailing ?? '',
        },
      });
      return;
    }
    router.push('/main');
  }

  const topInset = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const bottomInset = insets.bottom + (Platform.OS === 'web' ? 34 : 10);
  const reversedMessages = [...messages].reverse();

  return (
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: colors.background }]} behavior="padding">
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <View style={styles.headerTop}>
          <View style={styles.brandBlock}>
            <View style={[styles.brandMark, { backgroundColor: colors.primary }]}><Feather name="message-circle" size={18} color={colors.primaryForeground} /></View>
            <View>
              <Text style={[styles.brandName, { color: colors.foreground }]}>{localized(language, 'السكرتير السريع', 'Quick Chat')}</Text>
              <View style={styles.availability}><View style={[styles.statusDot, { backgroundColor: colors.accent }]} /><Text style={[styles.availabilityText, { color: colors.mutedForeground }]}>{localized(language, 'فتحت السكرتير بسرعة', 'Fast access to your secretary')}</Text></View>
            </View>
          </View>
          <Pressable testID="quick-open-main" accessibilityRole="button" accessibilityLabel="فتح البرنامج الكامل" onPress={() => openMain()} style={({ pressed }) => [styles.iconButton, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}>
            <Feather name="grid" size={17} color={colors.foreground} />
          </Pressable>
        </View>
      </View>
      {!hydrated ? <View style={styles.loadingState}><ActivityIndicator color={colors.primary} /></View> : (
        <QuickScreen>
          <FlatList
            inverted
            data={reversedMessages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <QuickMessageBubble message={item} colors={colors} onApprove={(approval) => void updateApproval(approval, 'completed')} onReject={(approval) => void updateApproval(approval, 'rejected')} onOpenMain={() => openMain()} onOpenRecord={(record) => openMain(record)} busyOperationId={busyOperationId} />}
            contentContainerStyle={styles.messageList}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={secretaryChat.isSending || conversationQuery.isFetching ? <View style={styles.typingRow}><View style={[styles.typingBubble, { backgroundColor: colors.card, borderColor: colors.border }]}><ActivityIndicator size="small" color={colors.primary} /><Text style={[styles.typingText, { color: colors.mutedForeground }]}>{conversationQuery.isFetching ? 'بفتح المحادثة الأصلية…' : 'بفكر في الرد…'}</Text></View></View> : null}
            ListFooterComponent={<View><View style={[styles.quickHero, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={[styles.quickHeroMark, { backgroundColor: colors.primary }]}><Feather name="message-circle" size={23} color={colors.primaryForeground} /></View><Text style={[styles.quickHeroTitle, { color: colors.foreground }]}>{localized(language, 'السكرتير الشخصي', 'Personal Secretary')}</Text><Text style={[styles.quickHeroText, { color: colors.mutedForeground }]}>{localized(language, 'مساحة سريعة للتحدث والمراجعة، مرتبطة بنفس محادثات وعمليات البرنامج الكامل.', 'A fast space to talk and review, connected to the same conversations and actions as the full workspace.')}</Text></View>{messages.length === 1 && <View style={styles.suggestionsBlock}><Text style={[styles.suggestionsLabel, { color: colors.mutedForeground }]}>{localized(language, 'ابدأ بطلب سريع', 'Start with a quick request')}</Text><View style={styles.suggestions}>{visibleSuggestions.map((suggestion) => <Pressable key={suggestion} testID={`suggestion-${suggestion}`} onPress={() => { setDraft(suggestion); inputRef.current?.focus(); }} style={({ pressed }) => [styles.suggestionChip, { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.65 : 1 }]}><Text style={[styles.suggestionText, { color: colors.foreground }]}>{suggestion}</Text></Pressable>)}</View></View>}</View>}
          />
        </QuickScreen>
      )}
      {localError && <View style={[styles.errorBanner, { backgroundColor: colors.destructive }]}><Feather name="alert-circle" size={15} color={colors.destructiveForeground} /><Text style={[styles.errorText, { color: colors.destructiveForeground }]}>{localError}</Text></View>}
      {conversationQuery.isError && <View style={[styles.errorBanner, { backgroundColor: colors.destructive }]}><Text style={[styles.errorText, { color: colors.destructiveForeground }]}>{localized(language, 'تعذر فتح المحادثة الأصلية.', 'Unable to open the original conversation.')}</Text></View>}
      <View style={[styles.composerWrap, { paddingBottom: bottomInset, borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <View style={[styles.composer, { backgroundColor: colors.card, borderColor: colors.input }]}>
          <TextInput ref={inputRef} testID="quick-message-input" value={draft} onChangeText={setDraft} onSubmitEditing={() => void sendMessage()} placeholder={localized(language, 'اكتب طلبك بسرعة…', 'Write a quick request…')} placeholderTextColor={colors.mutedForeground} multiline maxLength={1000} returnKeyType="send" blurOnSubmit={false} textAlign="right" style={[styles.input, { color: colors.foreground }]} />
          <Pressable testID="send-message" accessibilityRole="button" accessibilityLabel={localized(language, 'إرسال الطلب', 'Send request')} onPress={() => void sendMessage()} disabled={!draft.trim() || secretaryChat.isSending || conversationQuery.isFetching} style={({ pressed }) => [styles.sendButton, { backgroundColor: colors.primary, opacity: !draft.trim() || secretaryChat.isSending || conversationQuery.isFetching ? 0.4 : pressed ? 0.7 : 1 }]}><Feather name="arrow-up" size={18} color={colors.primaryForeground} /></Pressable>
        </View>
        <Text style={[styles.composerHint, { color: colors.mutedForeground }]}>{localized(language, 'للمحادثات السريعة فقط · أي تغيير حساس سيطلب موافقتك', 'Quick conversations only · sensitive changes require your approval')}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}