import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import {
  initializeSecretaryPush,
  openSecretaryNotificationSettings,
  retrySecretaryPush,
  type SecretaryPushStatus,
} from '../../services/mobile-push';
import { initializeQuickNotification } from '../../services/quick-notification';
import { createQuickActionGuard } from '../../services/quick-action-guard';
import QuickScreen from './QuickScreen';
import { QuickMessageBubble } from './QuickMessageBubble';
import { ReceiptReviewCard } from '../receipt-review';
import {
  addOrigin,
  approvalFromAction,
  approvalsFromAction,
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
  const isRtl = language === 'ar';
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const inputRef = useRef<TextInput>(null);
  const retryKeyRef = useRef<{ message: string; key: string } | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([starterMessage]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [busyOperationId, setBusyOperationId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [inputReview, setInputReview] = useState<SecretaryInputResult | null>(null);
  const [pushStatus, setPushStatus] = useState<SecretaryPushStatus | null>(null);
  const [conversationToLoad, setConversationToLoad] = useState<string | null>(null);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const actionGuardRef = useRef(createQuickActionGuard());
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
    void initializeSecretaryPush().then((status) => {
      if (active) setPushStatus(status);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (params.conversationId && params.conversationId !== conversationToLoad) {
      setConversationToLoad(params.conversationId);
    }
  }, [conversationToLoad, params.conversationId]);

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
    if (!actionGuardRef.current.tryBeginTurn()) return;
    setDraft('');
    const submittedInputId = inputReview?.inputId ?? null;
    const submittedInputAttachment = inputReview?.localAttachment ?? null;
    const idempotencyKey = retryKeyRef.current?.message === message
      ? retryKeyRef.current.key
      : `mobile-turn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    retryKeyRef.current = { message, key: idempotencyKey };
    setInputReview(null);
    setLocalError(null);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      appendMessage({
        id: `user-${Date.now()}`,
        role: 'user',
        text: message,
        createdAt: new Date().toISOString(),
        ...(submittedInputId ? { inputId: submittedInputId } : {}),
        ...(submittedInputAttachment ? { inputAttachment: submittedInputAttachment } : {}),
      });
      const result = await secretaryChat.sendTurn({
        message,
        conversationId: conversationId ?? null,
        channel: 'quick',
        context: null,
        inputId: submittedInputId,
        idempotencyKey,
      });
      if (retryKeyRef.current?.key === idempotencyKey) retryKeyRef.current = null;
      setConversationId(result.conversationId);
      await queryClient.invalidateQueries({ queryKey: ['secretary-chat-conversations'] });
      const linked = recordLinkFromAction(result.action);
      appendMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: result.assistantMessage || result.response?.message || 'تم استلام طلبك.',
        createdAt: new Date().toISOString(),
        ...(result.turnId ? { turnId: result.turnId } : {}),
        ...(() => {
          const approvals = approvalsFromAction(result.action);
          return approvals.length > 0
            ? { approval: approvals[0], ...(approvals.length > 1 ? { approvals } : {}) }
            : {};
        })(),
        ...(linked ? { recordLink: addOrigin(linked, result.conversationId, typeof objectValue(result.action).operationId === 'string' ? objectValue(result.action).operationId as string : null, result.turnId) } : {}),
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setLocalError('لم أتمكن من الوصول للسكرتير. جرّب مرة أخرى.');
      appendMessage({ id: `error-${Date.now()}`, role: 'assistant', text: 'حصلت مشكلة مؤقتة في الاتصال. رسالتك لم تُنفّذ.', createdAt: new Date().toISOString() });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      actionGuardRef.current.endTurn();
    }
  }

  async function updateApproval(approval: Approval, status: ApprovalStatus) {
    if (!actionGuardRef.current.tryBeginApproval(approval.operationId)) return;
    setBusyOperationId(approval.operationId);
    setLocalError(null);
    try {
      const response = status === 'completed'
        ? await secretaryChat.approveOperation(approval.operationId)
        : await secretaryChat.rejectOperation(approval.operationId);
      const linked = recordLinkFromAction(response.action);
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
      await queryClient.invalidateQueries({ queryKey: ['secretary-chat-conversations'] });
      if (response.assistantMessage) appendMessage({ id: `approval-${Date.now()}`, role: 'assistant', text: response.assistantMessage, createdAt: new Date().toISOString(), ...(linked ? { recordLink: addOrigin(linked, response.conversationId, response.operationId, response.turnId) } : {}) });
      if (status === 'completed') await queryClient.invalidateQueries({ queryKey: ['records'] });
      await Haptics.notificationAsync(status === 'completed' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
    } catch {
      setLocalError('لم يتم حفظ قرار الموافقة. جرّب مرة أخرى.');
    } finally {
      actionGuardRef.current.endApproval(approval.operationId);
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
    <View style={styles.quickWelcome}>
      <View style={[styles.quickWelcomeMark, { backgroundColor: colorWithAlpha(colors.primary, 0.12) }]}>
        <Feather name="message-circle" size={21} color={colors.primary} />
      </View>
      <Text style={[styles.quickWelcomeTitle, { color: colors.foreground, textAlign: isRtl ? 'right' : 'left' }]}>
        {localized(language, 'أقدر أساعدك في إيه؟', 'What can I help you with?')}
      </Text>
      <Text style={[styles.quickWelcomeText, { color: colors.mutedForeground, textAlign: isRtl ? 'right' : 'left' }]}>
        {localized(language, 'اسأل عن يومك، سجّل مصروفًا، أو اضبط تذكيرًا.', 'Ask about your day, log an expense, or set a reminder.')}
      </Text>
      <View style={styles.suggestionsBlock}>
        <Text style={[styles.suggestionsLabel, { color: colors.mutedForeground, textAlign: isRtl ? 'right' : 'left' }]}>{localized(language, 'جرّب طلبًا سريعًا', 'Try a quick request')}</Text>
        <View style={styles.suggestions}>
          {visibleSuggestions.map((suggestion, index) => (
            <Pressable
              key={suggestion}
              testID={`suggestion-${suggestion}`}
              onPress={() => { setDraft(suggestion); inputRef.current?.focus(); }}
              style={({ pressed }) => [
                styles.suggestionChip,
                { borderColor: colors.border, backgroundColor: colorWithAlpha(colors.card, 0.64), opacity: pressed ? 0.65 : 1, flexDirection: isRtl ? 'row-reverse' : 'row' },
              ]}
            >
              <View style={[styles.suggestionIcon, { backgroundColor: colors.muted }]}>
                <Feather name={index === 0 ? 'sun' : index === 1 ? 'bell' : 'credit-card'} size={14} color={colors.primary} />
              </View>
              <Text style={[styles.suggestionText, { color: colors.foreground, textAlign: isRtl ? 'right' : 'left' }]}>{suggestion}</Text>
              <Feather name={isRtl ? 'chevron-left' : 'chevron-right'} size={15} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: colors.background, direction: isRtl ? 'rtl' : 'ltr' }]} behavior="padding">
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
        <View style={[styles.headerTop, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <Pressable testID="quick-open-main" accessibilityRole="button" accessibilityLabel={localized(language, 'فتح البرنامج الكامل', 'Open Main workspace')} onPress={() => openMain()} style={({ pressed }) => [styles.iconButton, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}>
            <Feather name="grid" size={17} color={colors.foreground} />
          </Pressable>
          <View style={[styles.quickHeaderTitle, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <View style={[styles.quickHeaderMark, { backgroundColor: colors.primary }]}>
              <Feather name="message-circle" size={15} color={colors.primaryForeground} />
            </View>
            <Text style={[styles.brandName, { color: colors.foreground, textAlign: isRtl ? 'right' : 'left' }]}>
              {localized(language, 'محادثة سريعة', 'Quick Chat')}
            </Text>
          </View>
          <View style={styles.headerSideBalance} />
        </View>
      </View>
      {!hydrated ? <View style={styles.loadingState}><ActivityIndicator color={colors.primary} /></View> : (
        <QuickScreen>
          <FlatList
             inverted={!isFreshConversation}
             data={isFreshConversation ? messages : reversedMessages}
            keyExtractor={(item) => item.id}
              renderItem={({ item }) => isFreshConversation && item.id === starterMessage.id ? null : <QuickMessageBubble message={item} colors={colors} language={language} onApprove={(approval) => void updateApproval(approval, 'completed')} onReject={(approval) => void updateApproval(approval, 'rejected')} onOpenMain={() => openMain()} onOpenRecord={(record) => openMain(record)} onRetryInput={(attachment) => { if (attachment) void inputCapture.retryAttachment(attachment); }} retryingInput={inputCapture.state === 'processing'} busyOperationId={busyOperationId} />}
             contentContainerStyle={styles.messageList}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
             ListHeaderComponent={isFreshConversation
               ? quickIntro
               : secretaryChat.isSending || conversationQuery.isFetching
                  ? <View style={[styles.typingRow, { alignItems: isRtl ? 'flex-end' : 'flex-start' }]}><View style={[styles.typingBubble, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: isRtl ? 'row-reverse' : 'row' }]}><ActivityIndicator size="small" color={colors.primary} /><Text style={[styles.typingText, { color: colors.mutedForeground }]}>{conversationQuery.isFetching ? localized(language, 'بفتح المحادثة الأصلية…', 'Opening the original conversation…') : localized(language, 'بفكر في الرد…', 'Thinking…')}</Text></View></View>
                 : null}
          />
        </QuickScreen>
      )}
      {localError && <View style={[styles.errorBanner, { backgroundColor: colors.destructive, flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
        <Feather name="alert-circle" size={15} color={colors.destructiveForeground} />
        <Text style={[styles.errorText, { color: colors.destructiveForeground, textAlign: isRtl ? 'right' : 'left' }]}>{localError}</Text>
        {inputCapture.canRetry && <Pressable onPress={() => void inputCapture.retry()} style={styles.errorRetryButton}>
          <Text style={[styles.errorRetryText, { color: colors.destructiveForeground }]}>{localized(language, 'إعادة المحاولة', 'Retry')}</Text>
        </Pressable>}
      </View>}
      {pushStatus && pushStatus !== 'registered' && <View style={[styles.errorBanner, { backgroundColor: colors.muted, borderColor: colors.border, flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
        <Feather name="bell-off" size={15} color={colors.mutedForeground} />
        <Text style={[styles.errorText, { color: colors.mutedForeground, textAlign: isRtl ? 'right' : 'left' }]}>
          {pushStatus === 'unsupported'
            ? localized(language, 'الإشعارات متاحة في تطبيق الهاتف فقط.', 'Notifications are available in the native app only.')
            : pushStatus === 'permission-denied'
              ? localized(language, 'إشعارات السكرتير متوقفة. فعّلها من إعدادات الهاتف.', 'Secretary notifications are off. Enable them in device settings.')
              : localized(language, 'تعذر تفعيل إشعارات السكرتير.', 'Secretary notifications could not be enabled.')}
        </Text>
        {pushStatus === 'permission-denied' ? (
          <Pressable onPress={() => void openSecretaryNotificationSettings()} style={styles.errorRetryButton}>
            <Text style={[styles.errorRetryText, { color: colors.mutedForeground }]}>{localized(language, 'الإعدادات', 'Settings')}</Text>
          </Pressable>
        ) : pushStatus === 'failed' ? (
          <Pressable onPress={() => void retrySecretaryPush().then(setPushStatus)} style={styles.errorRetryButton}>
            <Text style={[styles.errorRetryText, { color: colors.mutedForeground }]}>{localized(language, 'إعادة المحاولة', 'Retry')}</Text>
          </Pressable>
        ) : null}
      </View>}
      {conversationQuery.isError && <View style={[styles.errorBanner, { backgroundColor: colors.destructive }]}><Text style={[styles.errorText, { color: colors.destructiveForeground, textAlign: isRtl ? 'right' : 'left' }]}>{localized(language, 'تعذر فتح المحادثة الأصلية.', 'Unable to open the original conversation.')}</Text></View>}
      <View style={[styles.composerWrap, { paddingBottom: bottomInset, borderTopColor: colors.border, backgroundColor: colors.background }]}>
        {inputReview?.kind === 'receipt' && <ReceiptReviewCard result={inputReview} colors={colors} language={language} onChange={updateInputReview} onClear={() => setInputReview(null)} />}
        {inputReview && inputReview.kind !== 'receipt' && <View style={[styles.inputReview, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Feather name="mic" size={14} color={colors.primary} />
          <Text style={[styles.inputReviewText, { color: colors.mutedForeground }]} numberOfLines={2}>
            {inputReview.text}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={localized(language, 'إلغاء الإدخال', 'Cancel input')} onPress={() => setInputReview(null)}><Feather name="x" size={15} color={colors.mutedForeground} /></Pressable>
        </View>}
        <View style={[styles.composer, { backgroundColor: colors.card, borderColor: colors.input, flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <View style={[styles.inputActions, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <Pressable testID="quick-voice-input" accessibilityRole="button" accessibilityLabel={inputCapture.state === 'recording' ? localized(language, 'إيقاف التسجيل', 'Stop recording') : localized(language, 'تسجيل طلب صوتي', 'Record a voice request')} onPress={() => void inputCapture.toggleVoice()} disabled={inputCapture.state === 'processing'} style={({ pressed }) => [styles.inputAction, { backgroundColor: inputCapture.state === 'recording' ? colors.destructive : colors.muted, opacity: pressed || inputCapture.state === 'processing' ? 0.6 : 1 }]}>{inputCapture.state === 'processing' ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name={inputCapture.state === 'recording' ? 'square' : 'mic'} size={14} color={inputCapture.state === 'recording' ? colors.destructiveForeground : colors.primary} />}</Pressable>
            <Pressable testID="quick-receipt-camera" accessibilityRole="button" accessibilityLabel={localized(language, 'تصوير فاتورة', 'Take a receipt photo')} onPress={() => void inputCapture.pickReceipt('camera')} disabled={inputCapture.state !== 'idle'} style={({ pressed }) => [styles.inputAction, { backgroundColor: colors.muted, opacity: pressed || inputCapture.state !== 'idle' ? 0.6 : 1 }]}><Feather name="camera" size={14} color={colors.primary} /></Pressable>
            <Pressable testID="quick-receipt-library" accessibilityRole="button" accessibilityLabel={localized(language, 'اختيار صورة فاتورة', 'Choose a receipt image')} onPress={() => void inputCapture.pickReceipt('library')} disabled={inputCapture.state !== 'idle'} style={({ pressed }) => [styles.inputAction, { backgroundColor: colors.muted, opacity: pressed || inputCapture.state !== 'idle' ? 0.6 : 1 }]}><Feather name="image" size={14} color={colors.primary} /></Pressable>
          </View>
          <TextInput ref={inputRef} testID="quick-message-input" accessibilityLabel={localized(language, 'اكتب طلبك', 'Write your request')} value={draft} onChangeText={setDraft} onSubmitEditing={() => void sendMessage()} placeholder={localized(language, 'اكتب طلبك بسرعة…', 'Write a quick request…')} placeholderTextColor={colors.mutedForeground} multiline maxLength={1000} returnKeyType="send" blurOnSubmit={false} textAlign={isRtl ? 'right' : 'left'} style={[styles.input, { color: colors.foreground, writingDirection: isRtl ? 'rtl' : 'ltr' }]} />
          <Pressable testID="send-message" accessibilityRole="button" accessibilityLabel={localized(language, 'إرسال الطلب', 'Send request')} onPress={() => void sendMessage()} disabled={!draft.trim() || secretaryChat.isSending || conversationQuery.isFetching || inputCapture.state !== 'idle' || receiptNeedsReview(inputReview)} style={({ pressed }) => [styles.sendButton, { backgroundColor: colors.primary, opacity: !draft.trim() || secretaryChat.isSending || conversationQuery.isFetching || inputCapture.state !== 'idle' || receiptNeedsReview(inputReview) ? 0.4 : pressed ? 0.7 : 1 }]}><Feather name="arrow-up" size={18} color={colors.primaryForeground} /></Pressable>
        </View>
        <Text style={[styles.composerHint, { color: colors.mutedForeground }]}>{localized(language, 'للمحادثات السريعة فقط · أي تغيير حساس سيطلب موافقتك', 'Quick conversations only · sensitive changes require your approval')}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}