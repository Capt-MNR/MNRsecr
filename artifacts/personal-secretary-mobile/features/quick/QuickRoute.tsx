import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { LinearGradient } from 'expo-linear-gradient';
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
import {
  receiptDraft,
  receiptNeedsReview,
  useSecretaryInputCapture,
  type SecretaryInputResult,
} from '../../services/secretary-input';
import { hydrateLocalInputAttachments } from '../../services/local-input-assets';
import { initializeSecretaryPush } from '../../services/mobile-push';
import {
  initializeQuickNotification,
  isQuickNotificationResponse,
} from '../../services/quick-notification';
import QuickScreen from './QuickScreen';
import { QuickMessageBubble } from './QuickMessageBubble';
import { ReceiptReviewCard } from '../receipt-review';
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

function colorWithAlpha(color: string, alpha: number) {
  const normalized = color.replace('#', '');
  if (normalized.length !== 6) return color;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

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
  const [inputReview, setInputReview] = useState<SecretaryInputResult | null>(null);
  const [conversationToLoad, setConversationToLoad] = useState<string | null>(null);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const secretaryChat = useSecretaryChatService(conversationToLoad, '', false);
  const conversationQuery = secretaryChat.conversationQuery;
  const visibleSuggestions = language === 'en'
    ? ['What do I have today?', 'Remind me tomorrow to call Mohamed', 'How much does Mohamed owe me?']
    : suggestions;
  const inputCapture = useSecretaryInputCapture(
    (result) => {
      setInputReview(result);
      setDraft(result.kind === 'receipt' ? receiptDraft(result) : result.text);
      setLocalError(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    setLocalError,
  );
  function updateInputReview(result: SecretaryInputResult) {
    setInputReview(result);
    setDraft(result.kind === 'receipt' ? receiptDraft(result) : result.text);
  }

  useEffect(() => {
    let active = true;
    void AsyncStorage.multiGet([STORAGE_MESSAGES, STORAGE_CONVERSATION]).then(async ([storedMessages, storedConversation]) => {
      if (!active) return;
      if (storedMessages[1]) {
        try {
          const parsed = JSON.parse(storedMessages[1]) as LocalMessage[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            const hydratedMessages = await hydrateLocalInputAttachments(parsed);
            if (active) setMessages(hydratedMessages);
          }
        } catch {
          if (active) setMessages([starterMessage]);
        }
      }
      if (active && storedConversation[1]) setConversationId(storedConversation[1]);
      if (active) setHydrated(true);
    }).catch(() => {
      if (active) setHydrated(true);
    });
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
    void hydrateLocalInputAttachments(messagesFromConversation(conversationQuery.data, conversationToLoad)).then(setMessages);
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
    if (receiptNeedsReview(inputReview)) {
      setLocalError('أكمل مبلغ الفاتورة والعملة قبل إرسال المسودة.');
      return;
    }
    setDraft('');
    const submittedInputId = inputReview?.inputId ?? null;
    const submittedInputAttachment = inputReview?.localAttachment ?? null;
    setInputReview(null);
    setLocalError(null);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
        channel: 'quick',
        context: null,
        inputId: submittedInputId,
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
  const isFreshConversation = messages.length === 1 && messages[0]?.id === starterMessage.id;
  const quickIntro = (
    <View>
      <View style={[styles.quickHero, { backgroundColor: colorWithAlpha(colors.card, 0.84), borderColor: colors.border }]}>
        <View style={styles.quickHeroTop}>
          <View style={[styles.quickHeroMark, { backgroundColor: colorWithAlpha(colors.primary, 0.14), borderColor: colorWithAlpha(colors.primary, 0.22) }]}>
            <Feather name="message-circle" size={22} color={colors.primary} />
          </View>
          <View style={styles.quickHeroCopy}>
            <Text style={[styles.quickHeroEyebrow, { color: colors.primary }]}>{localized(language, 'المساعد السريع', 'QUICK SECRETARY')}</Text>
            <Text style={[styles.quickHeroTitle, { color: colors.foreground }]}>{localized(language, 'السكرتير الشخصي', 'Personal Secretary')}</Text>
          </View>
        </View>
        <Text style={[styles.quickHeroText, { color: colors.mutedForeground }]}>{localized(language, 'اطلبها بطريقتك، وأنا أرتّب الخطوة التالية من غير ما تفتح مساحة العمل كاملة.', 'Ask naturally and I will organize the next step without opening the full workspace.')}</Text>
        <View style={[styles.quickHeroStatus, { borderTopColor: colors.border }]}>
          <View style={[styles.quickHeroStatusDot, { backgroundColor: colors.accent }]} />
          <Text style={[styles.quickHeroStatusText, { color: colors.mutedForeground }]}>{localized(language, 'جاهز لطلب قصير', 'Ready for a short request')}</Text>
          <Text style={[styles.quickHeroStatusMode, { color: colors.mutedForeground }]}>Quick</Text>
        </View>
      </View>
      <View style={styles.suggestionsBlock}>
        <Text style={[styles.suggestionsLabel, { color: colors.mutedForeground }]}>{localized(language, 'ابدأ من هنا', 'Start here')}</Text>
        <View style={styles.suggestions}>
          {visibleSuggestions.map((suggestion, index) => (
            <Pressable
              key={suggestion}
              testID={`suggestion-${suggestion}`}
              onPress={() => { setDraft(suggestion); inputRef.current?.focus(); }}
              style={({ pressed }) => [
                styles.suggestionChip,
                { borderColor: colors.border, backgroundColor: colorWithAlpha(colors.card, 0.86), opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <View style={[styles.suggestionIcon, { backgroundColor: colors.muted }]}>
                <Feather name={index === 0 ? 'sun' : index === 1 ? 'bell' : 'credit-card'} size={14} color={colors.primary} />
              </View>
              <Text style={[styles.suggestionText, { color: colors.foreground }]}>{suggestion}</Text>
              <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: colors.background }]} behavior="padding">
      <LinearGradient
        pointerEvents="none"
        colors={[
          colorWithAlpha(colors.primary, 0.11),
          colorWithAlpha(colors.background, 0.72),
          colorWithAlpha(colors.muted, 0.68),
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.quickBackground}
      />
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colorWithAlpha(colors.border, 0.72) }]}>
        <View style={styles.headerTop}>
          <View style={styles.brandBlock}>
            <View style={[styles.brandMark, { backgroundColor: colors.primary }]}><Feather name="message-circle" size={18} color={colors.primaryForeground} /></View>
            <View style={styles.brandCopy}>
              <Text style={[styles.brandEyebrow, { color: colors.mutedForeground }]}>{localized(language, 'وصول سريع', 'QUICK ACCESS')}</Text>
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
             inverted={!isFreshConversation}
             data={isFreshConversation ? messages : reversedMessages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <QuickMessageBubble message={item} colors={colors} onApprove={(approval) => void updateApproval(approval, 'completed')} onReject={(approval) => void updateApproval(approval, 'rejected')} onOpenMain={() => openMain()} onOpenRecord={(record) => openMain(record)} onRetryInput={(attachment) => { if (attachment) void inputCapture.retryAttachment(attachment); }} retryingInput={inputCapture.state === 'processing'} busyOperationId={busyOperationId} />}
             contentContainerStyle={styles.messageList}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
             ListHeaderComponent={isFreshConversation
               ? quickIntro
               : secretaryChat.isSending || conversationQuery.isFetching
                 ? <View style={styles.typingRow}><View style={[styles.typingBubble, { backgroundColor: colors.card, borderColor: colors.border }]}><ActivityIndicator size="small" color={colors.primary} /><Text style={[styles.typingText, { color: colors.mutedForeground }]}>{conversationQuery.isFetching ? 'بفتح المحادثة الأصلية…' : 'بفكر في الرد…'}</Text></View></View>
                 : null}
          />
        </QuickScreen>
      )}
      {localError && <View style={[styles.errorBanner, { backgroundColor: colors.destructive }]}>
        <Feather name="alert-circle" size={15} color={colors.destructiveForeground} />
        <Text style={[styles.errorText, { color: colors.destructiveForeground }]}>{localError}</Text>
        {inputCapture.canRetry && <Pressable onPress={() => void inputCapture.retry()} style={styles.errorRetryButton}>
          <Text style={[styles.errorRetryText, { color: colors.destructiveForeground }]}>{localized(language, 'إعادة المحاولة', 'Retry')}</Text>
        </Pressable>}
      </View>}
      {conversationQuery.isError && <View style={[styles.errorBanner, { backgroundColor: colors.destructive }]}><Text style={[styles.errorText, { color: colors.destructiveForeground }]}>{localized(language, 'تعذر فتح المحادثة الأصلية.', 'Unable to open the original conversation.')}</Text></View>}
      <View style={[styles.composerWrap, { paddingBottom: bottomInset, borderTopColor: colors.border, backgroundColor: colors.background }]}>
        {inputReview?.kind === 'receipt' && <ReceiptReviewCard result={inputReview} colors={colors} language={language} onChange={updateInputReview} onClear={() => setInputReview(null)} />}
        {inputReview && inputReview.kind !== 'receipt' && <View style={[styles.inputReview, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Feather name="mic" size={14} color={colors.primary} />
          <Text style={[styles.inputReviewText, { color: colors.mutedForeground }]} numberOfLines={2}>
            {inputReview.text}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="إلغاء الإدخال" onPress={() => setInputReview(null)}><Feather name="x" size={15} color={colors.mutedForeground} /></Pressable>
        </View>}
        <View style={[styles.composer, { backgroundColor: colors.card, borderColor: colors.input }]}>
          <View style={styles.inputActions}>
            <Pressable testID="quick-voice-input" accessibilityRole="button" accessibilityLabel={inputCapture.state === 'recording' ? 'إيقاف التسجيل' : 'تسجيل طلب صوتي'} onPress={() => void inputCapture.toggleVoice()} disabled={inputCapture.state === 'processing'} style={({ pressed }) => [styles.inputAction, { backgroundColor: inputCapture.state === 'recording' ? colors.destructive : colors.muted, opacity: pressed || inputCapture.state === 'processing' ? 0.6 : 1 }]}>{inputCapture.state === 'processing' ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name={inputCapture.state === 'recording' ? 'square' : 'mic'} size={14} color={inputCapture.state === 'recording' ? colors.destructiveForeground : colors.primary} />}</Pressable>
            <Pressable testID="quick-receipt-camera" accessibilityRole="button" accessibilityLabel="تصوير فاتورة" onPress={() => void inputCapture.pickReceipt('camera')} disabled={inputCapture.state !== 'idle'} style={({ pressed }) => [styles.inputAction, { backgroundColor: colors.muted, opacity: pressed || inputCapture.state !== 'idle' ? 0.6 : 1 }]}><Feather name="camera" size={14} color={colors.primary} /></Pressable>
            <Pressable testID="quick-receipt-library" accessibilityRole="button" accessibilityLabel="اختيار صورة فاتورة" onPress={() => void inputCapture.pickReceipt('library')} disabled={inputCapture.state !== 'idle'} style={({ pressed }) => [styles.inputAction, { backgroundColor: colors.muted, opacity: pressed || inputCapture.state !== 'idle' ? 0.6 : 1 }]}><Feather name="image" size={14} color={colors.primary} /></Pressable>
          </View>
          <TextInput ref={inputRef} testID="quick-message-input" value={draft} onChangeText={setDraft} onSubmitEditing={() => void sendMessage()} placeholder={localized(language, 'اكتب طلبك بسرعة…', 'Write a quick request…')} placeholderTextColor={colors.mutedForeground} multiline maxLength={1000} returnKeyType="send" blurOnSubmit={false} textAlign="right" style={[styles.input, { color: colors.foreground }]} />
          <Pressable testID="send-message" accessibilityRole="button" accessibilityLabel={localized(language, 'إرسال الطلب', 'Send request')} onPress={() => void sendMessage()} disabled={!draft.trim() || secretaryChat.isSending || conversationQuery.isFetching || inputCapture.state !== 'idle' || receiptNeedsReview(inputReview)} style={({ pressed }) => [styles.sendButton, { backgroundColor: colors.primary, opacity: !draft.trim() || secretaryChat.isSending || conversationQuery.isFetching || inputCapture.state !== 'idle' || receiptNeedsReview(inputReview) ? 0.4 : pressed ? 0.7 : 1 }]}><Feather name="arrow-up" size={18} color={colors.primaryForeground} /></Pressable>
        </View>
        <Text style={[styles.composerHint, { color: colors.mutedForeground }]}>{localized(language, 'للمحادثات السريعة فقط · أي تغيير حساس سيطلب موافقتك', 'Quick conversations only · sensitive changes require your approval')}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}