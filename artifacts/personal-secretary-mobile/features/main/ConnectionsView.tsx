import { Feather } from '@expo/vector-icons';
import {
  getGetGmailEmailAccountQueryKey,
  getGetGoogleCalendarAccountQueryKey,
  useConnectGmailEmailAccount,
  useDisconnectGmailEmailAccount,
  useGetGmailEmailAccount,
  useConnectGoogleCalendarAccount,
  useDisconnectGoogleCalendarAccount,
  useGetGoogleCalendarAccount,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import type { AppLanguage } from '@/hooks/useLanguage';
import { useColors } from '@/hooks/useColors';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type Props = { language: AppLanguage; onBack?: () => void; onAsk: (prompt: string) => void };
const copy = (language: AppLanguage, ar: string, en: string) => language === 'en' ? en : ar;

function ServiceCard({
  title, description, capability, icon, configured, connected, emailAddress, loading, busy, error, onConnect, onDisconnect, onRetry, colors, language,
}: {
  title: string;
  description: string;
  capability: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  configured: boolean;
  connected: boolean;
  emailAddress: string | null;
  loading: boolean;
  busy: boolean;
  error: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onRetry: () => void;
  colors: ReturnType<typeof useColors>;
  language: AppLanguage;
}) {
  const rtl = language === 'ar';
  const status = loading
    ? copy(language, 'جارٍ التحقق', 'Checking status')
    : error
      ? copy(language, 'تعذّر التحقق', 'Could not verify')
      : !configured
        ? copy(language, 'غير مهيأ في هذه البيئة', 'Not configured here')
        : connected
          ? copy(language, 'متصل', 'Connected')
          : copy(language, 'غير متصل', 'Not connected');
  const statusColor = error ? colors.destructive : connected ? colors.accent : colors.mutedForeground;

  return (
    <View style={[styles.providerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.providerTop, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        <View style={[styles.providerIcon, { backgroundColor: colors.muted }]}>
          <Feather name={icon} size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.providerTitle, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{title}</Text>
          <Text style={[styles.providerDescription, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>{description}</Text>
        </View>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
      </View>

      <View style={[styles.statusLine, { flexDirection: rtl ? 'row-reverse' : 'row', borderTopColor: colors.border }]}>
        <Text style={[styles.statusLabel, { color: colors.mutedForeground }]}>{copy(language, 'الحالة', 'Status')}</Text>
        <Text style={[styles.statusValue, { color: statusColor }]}>{status}</Text>
      </View>
      {connected && emailAddress && (
        <Text selectable style={[styles.email, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{emailAddress}</Text>
      )}
      <View style={[styles.capability, { borderTopColor: colors.border }]}>
        <Text style={[styles.capabilityTitle, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'ما الذي يستطيع السكرتير فعله؟', 'What the secretary can do')}</Text>
        <Text style={[styles.capabilityText, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>{capability}</Text>
      </View>

      <View style={[styles.actions, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        {error ? (
          <Pressable testID={`connection-retry-${title}`} accessibilityRole="button" onPress={onRetry} style={[styles.actionSecondary, { borderColor: colors.border }]}>
            <Text style={[styles.actionSecondaryText, { color: colors.foreground }]}>{copy(language, 'إعادة المحاولة', 'Retry check')}</Text>
          </Pressable>
        ) : connected ? (
          <Pressable testID={`connection-disconnect-${title}`} accessibilityRole="button" disabled={busy} onPress={onDisconnect} style={[styles.actionSecondary, { borderColor: colors.border, opacity: busy ? 0.6 : 1 }]}>
            {busy && <ActivityIndicator size="small" color={colors.primary} />}
            <Text style={[styles.actionSecondaryText, { color: colors.foreground }]}>{copy(language, 'فصل الحساب', 'Disconnect account')}</Text>
          </Pressable>
        ) : (
          <Pressable testID={`connection-connect-${title}`} accessibilityRole="button" disabled={busy || loading || !configured} onPress={onConnect} style={[styles.actionPrimary, { backgroundColor: colors.primary, opacity: busy || loading || !configured ? 0.55 : 1 }]}>
            {busy ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="external-link" size={14} color={colors.primaryForeground} />}
            <Text style={[styles.actionPrimaryText, { color: colors.primaryForeground }]}>{copy(language, 'ربط البيانات', 'Connect data')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function ConnectionsView({ language, onBack, onAsk }: Props) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState('');
  const gmail = useGetGmailEmailAccount({ query: { queryKey: getGetGmailEmailAccountQueryKey() } });
  const calendar = useGetGoogleCalendarAccount({ query: { queryKey: getGetGoogleCalendarAccountQueryKey() } });
  const connectGmail = useConnectGmailEmailAccount();
  const disconnectGmail = useDisconnectGmailEmailAccount();
  const connectCalendar = useConnectGoogleCalendarAccount();
  const disconnectCalendar = useDisconnectGoogleCalendarAccount();

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void queryClient.invalidateQueries({ queryKey: getGetGmailEmailAccountQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetGoogleCalendarAccountQueryKey() });
      }
    });
    return () => sub.remove();
  }, [queryClient]);

  async function openAuthorization(url: string) {
    try {
      await Linking.openURL(url);
      setFeedback(copy(language, 'افتح صفحة Google لإكمال الإذن. سنحدّث الحالة عند عودتك.', 'Continue in Google to grant access. Status will refresh when you return.'));
    } catch {
      setFeedback(copy(language, 'تعذر فتح صفحة التفويض.', 'Could not open the authorization page.'));
    }
  }

  function confirmDisconnect(service: 'gmail' | 'calendar') {
    const isGmail = service === 'gmail';
    Alert.alert(
      copy(language, 'فصل الحساب؟', 'Disconnect account?'),
      copy(language, 'سيُزال وصول السكرتير إلى هذه البيانات.', 'The secretary will lose access to this data.'),
      [
        { text: copy(language, 'إلغاء', 'Cancel'), style: 'cancel' },
        {
          text: copy(language, 'فصل', 'Disconnect'),
          style: 'destructive',
          onPress: () => {
            setFeedback('');
            const mutation = isGmail ? disconnectGmail : disconnectCalendar;
            mutation.mutate(undefined, {
              onSuccess: async () => {
                await queryClient.invalidateQueries({ queryKey: isGmail ? getGetGmailEmailAccountQueryKey() : getGetGoogleCalendarAccountQueryKey() });
                setFeedback(copy(language, 'تم فصل الحساب.', 'Account disconnected.'));
              },
              onError: () => setFeedback(copy(language, 'تعذر فصل الحساب. حاول مرة أخرى.', 'Could not disconnect. Please try again.')),
            });
          },
        },
      ],
    );
  }

  const rtl = language === 'ar';
  return (
    <ScrollView testID="connections-view" style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={[styles.header, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        {onBack && (
          <Pressable testID="connections-back" accessibilityRole="button" accessibilityLabel={copy(language, 'عودة', 'Back')} onPress={onBack} style={[styles.back, { borderColor: colors.border }]}>
            <Feather name={rtl ? 'arrow-right' : 'arrow-left'} size={17} color={colors.foreground} />
          </Pressable>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.eyebrow, { color: colors.primary, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'وصول البيانات', 'DATA ACCESS')}</Text>
          <Text style={[styles.title, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'اتصالاتك', 'Your connections')}</Text>
        </View>
      </View>

      <View style={[styles.notice, { backgroundColor: colors.secondary, flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        <Feather name="shield" size={17} color={colors.primary} />
        <Text style={[styles.noticeText, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>
          {copy(language, 'حالة الاتصال لا تعني أن كل محتوى الخدمة قابل للتصفح. كل إجراء خارجي يحتاج موافقتك. ربط Google لتسجيل الدخول منفصل.', 'A connection does not mean all service content can be browsed. Each external action requires your approval. Google sign-in is separate.')}
        </Text>
      </View>

      <ServiceCard
        title="Gmail"
        description={copy(language, 'إرسال رسالة عبر بريدك', 'Send a message with your account')}
        capability={copy(language, 'يمكنه إرسال رسالة واحدة بعد موافقتك، ثم التحقق من ظهورها في الرسائل المرسلة. لا يدعم تصفح البريد الوارد أو البحث العام فيه.', 'Can send one message after your approval and verify it appears in Sent. General inbox browsing and search are not supported.')}
        icon="mail"
        configured={gmail.data?.configured ?? false}
        connected={gmail.data?.connected ?? false}
        emailAddress={gmail.data?.emailAddress ?? null}
        loading={gmail.isLoading}
        busy={connectGmail.isPending || disconnectGmail.isPending}
        error={gmail.isError}
        onRetry={() => void gmail.refetch()}
        onConnect={() => {
          setFeedback('');
          connectGmail.mutate(undefined, {
            onSuccess: (result) => void openAuthorization(result.authorizationUrl),
            onError: () => setFeedback(copy(language, 'تعذر بدء ربط Gmail.', 'Could not start Gmail connection.')),
          });
        }}
        onDisconnect={() => confirmDisconnect('gmail')}
        colors={colors}
        language={language}
      />

      <ServiceCard
        title="Google Calendar"
        description={copy(language, 'التقويم والمواعيد', 'Calendar and events')}
        capability={copy(language, 'يمكنه إنشاء أو تعديل أو إلغاء حدث محدد بعد موافقتك، ثم التحقق من النتيجة. لا يدعم تصفح التقويم أو البحث العام في الأحداث.', 'Can create, update, or cancel a specific event after your approval, then verify the result. General calendar browsing and event search are not supported.')}
        icon="calendar"
        configured={calendar.data?.configured ?? false}
        connected={calendar.data?.connected ?? false}
        emailAddress={calendar.data?.emailAddress ?? null}
        loading={calendar.isLoading}
        busy={connectCalendar.isPending || disconnectCalendar.isPending}
        error={calendar.isError}
        onRetry={() => void calendar.refetch()}
        onConnect={() => {
          setFeedback('');
          connectCalendar.mutate(undefined, {
            onSuccess: (result) => void openAuthorization(result.authorizationUrl),
            onError: () => setFeedback(copy(language, 'تعذر بدء ربط تقويم Google.', 'Could not start Google Calendar connection.')),
          });
        }}
        onDisconnect={() => confirmDisconnect('calendar')}
        colors={colors}
        language={language}
      />

      <View style={[styles.managed, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <View style={[styles.managedHeading, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
          <Feather name="grid" size={16} color={colors.mutedForeground} />
          <Text style={[styles.managedTitle, { color: colors.foreground }]}>{copy(language, 'Sheets', 'Sheets')}</Text>
          <Text style={[styles.managedBadge, { color: colors.mutedForeground, backgroundColor: colors.muted }]}>{copy(language, 'تديره المنصة', 'Platform managed')}</Text>
        </View>
        <Text style={[styles.managedText, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>
          {copy(language, 'تديره مساحة العمل، ولا تعرض هذه الصفحة حالة اتصاله أو تؤكد جاهزيته. يستطيع السكرتير إنشاء جدول أو كتابة بيانات محددة ضمن متابعة؛ يتطلب ذلك موافقة إنشاء المتابعة ثم موافقة منفصلة قبل الاتصال، مع التحقق من النتيجة.', 'Managed by the workspace; this page does not expose its connection status or confirm readiness. The secretary can create a sheet or write specified data within a Work item. This requires approval to create the Work item and a separate approval before connecting, followed by result verification.')}
        </Text>
      </View>

      <Pressable
        testID="connections-ask-secretary"
        accessibilityRole="button"
        accessibilityLabel={copy(language, 'اسأل السكرتير عن الاتصالات', 'Ask the secretary about connections')}
        onPress={() => onAsk(copy(language, 'ما الذي يستطيع السكرتير فعله عبر الاتصالات المتاحة؟', 'What can the secretary do through the available connections?'))}
        style={({ pressed }) => [styles.askButton, { backgroundColor: colors.primary, opacity: pressed ? 0.72 : 1, flexDirection: rtl ? 'row-reverse' : 'row' }]}
      >
        <Feather name="message-circle" size={16} color={colors.primaryForeground} />
        <Text style={[styles.askButtonText, { color: colors.primaryForeground }]}>{copy(language, 'اسأل السكرتير عن الاتصالات', 'Ask the secretary about connections')}</Text>
      </Pressable>

      {!!feedback && <Text accessibilityRole="alert" style={[styles.feedback, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>{feedback}</Text>}
      {(gmail.isLoading || calendar.isLoading) && (
        <View style={[styles.loading, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>{copy(language, 'جارٍ جلب حالة الاتصالات من الحساب.', 'Fetching connection status from your account.')}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingTop: 20, paddingBottom: 36, gap: 14 },
  header: { alignItems: 'center', gap: 12, marginBottom: 3 },
  back: { width: 40, height: 40, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 5 },
  title: { fontSize: 25, lineHeight: 32, fontWeight: '800' },
  notice: { padding: 14, borderRadius: 17, alignItems: 'flex-start', gap: 10 },
  noticeText: { flex: 1, fontSize: 11, lineHeight: 17 },
  providerCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 21, padding: 15, gap: 12 },
  providerTop: { gap: 11, alignItems: 'center' },
  providerIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  providerTitle: { fontSize: 15, fontWeight: '800' },
  providerDescription: { fontSize: 10, marginTop: 3 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLine: { paddingTop: 11, borderTopWidth: StyleSheet.hairlineWidth, justifyContent: 'space-between', alignItems: 'center' },
  statusLabel: { fontSize: 10 },
  statusValue: { fontSize: 11, fontWeight: '800' },
  email: { fontSize: 12, fontWeight: '700' },
  capability: { gap: 5, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 11 },
  capabilityTitle: { fontSize: 11, fontWeight: '800' },
  capabilityText: { fontSize: 10, lineHeight: 16 },
  actions: { justifyContent: 'flex-start', marginTop: 1 },
  actionPrimary: { minHeight: 39, paddingHorizontal: 13, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 7 },
  actionPrimaryText: { fontSize: 11, fontWeight: '800' },
  actionSecondary: { minHeight: 38, paddingHorizontal: 12, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 7 },
  actionSecondaryText: { fontSize: 11, fontWeight: '700' },
  managed: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 19, padding: 14, gap: 9 },
  managedHeading: { alignItems: 'center', gap: 8 },
  managedTitle: { fontSize: 13, fontWeight: '800', flex: 1 },
  managedBadge: { overflow: 'hidden', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4, fontSize: 8, fontWeight: '700' },
  managedText: { fontSize: 10, lineHeight: 16 },
  askButton: { minHeight: 46, justifyContent: 'center', alignItems: 'center', gap: 9, borderRadius: 15, paddingHorizontal: 16 },
  askButtonText: { fontSize: 12, fontWeight: '800' },
  feedback: { fontSize: 11, lineHeight: 17, paddingHorizontal: 3 },
  loading: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 15, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  loadingText: { flex: 1, fontSize: 10 },
});
