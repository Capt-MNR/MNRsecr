import { Feather } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import {
  getGetAuthOAuthLinkedProvidersQueryKey,
  useGetAuthOAuthLinkedProviders,
} from '@workspace/api-client-react';
import { ActivityIndicator, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { useColors, ThemePreference } from '@/hooks/useColors';
import type { AppLanguage } from '@/hooks/useLanguage';
import type { AssistantPreferences } from './index';
import { useAuth } from '@/services/auth-context';
import type { AuthProvider } from '@/services/auth';

function copy(language: AppLanguage, ar: string, en: string) {
  return language === 'ar' ? ar : en;
}

type PermissionState = 'checking' | 'granted' | 'denied' | 'undetermined' | 'unsupported' | 'error';

export function SettingsSection({
  colors,
  language,
  themePreference,
  onThemeChange,
  onLanguageChange,
  assistantPreferences,
  onAssistantPreferencesChange,
  onOpenPersonalInformation,
  onBack,
}: {
  colors: ReturnType<typeof useColors>;
  language: AppLanguage;
  themePreference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onLanguageChange: (language: AppLanguage) => void;
  assistantPreferences: AssistantPreferences;
  onAssistantPreferencesChange: (patch: Partial<AssistantPreferences>) => void;
  onOpenPersonalInformation: () => void;
  onBack: () => void;
}) {
  const [permission, setPermission] = useState<PermissionState>(Platform.OS === 'web' ? 'unsupported' : 'checking');
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [authPassword, setAuthPassword] = useState('');
  const [authProviderBusy, setAuthProviderBusy] = useState<AuthProvider | null>(null);
  const [authProviderError, setAuthProviderError] = useState('');
  const [authProviderNotice, setAuthProviderNotice] = useState('');
  const rtl = language === 'ar';
  const { linkProvider, unlinkProvider } = useAuth();
  const linkedProvidersQuery = useGetAuthOAuthLinkedProviders({
    query: {
      queryKey: getGetAuthOAuthLinkedProvidersQueryKey(),
      enabled: Platform.OS !== 'web',
    },
  });

  const refreshPermission = useCallback(async () => {
    if (Platform.OS === 'web') {
      setPermission('unsupported');
      return;
    }
    try {
      const current = await Notifications.getPermissionsAsync();
      setPermission(current.granted ? 'granted' : current.canAskAgain ? 'undetermined' : 'denied');
    } catch {
      setPermission('error');
    }
  }, []);

  useEffect(() => { void refreshPermission(); }, [refreshPermission]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPermission();
    });
    return () => subscription.remove();
  }, [refreshPermission]);

  async function requestPermission() {
    if (Platform.OS === 'web' || permissionBusy) return;
    setPermissionBusy(true);
    try {
      const result = await Notifications.requestPermissionsAsync();
      setPermission(result.granted ? 'granted' : result.canAskAgain ? 'undetermined' : 'denied');
    } catch {
      setPermission('error');
    } finally {
      setPermissionBusy(false);
    }
  }

  async function openDeviceSettings() {
    if (Platform.OS === 'web') return;
    try {
      await Linking.openSettings();
    } catch {
      setPermission('error');
    }
  }

  async function toggleAuthProvider(provider: AuthProvider) {
    if (!authPassword || authProviderBusy) return;
    const linked = linkedProvidersQuery.data?.providers.some((item) => item.provider === provider) ?? false;
    setAuthProviderBusy(provider);
    setAuthProviderError('');
    setAuthProviderNotice('');
    try {
      if (linked) {
        await unlinkProvider(provider, authPassword);
        setAuthProviderNotice(copy(language, 'أُلغي ربط المزوّد. لم تتغير بيانات حسابك.', 'Provider unlinked. Your account data was not changed.'));
      } else {
        await linkProvider(provider, authPassword);
        setAuthProviderNotice(copy(language, 'تم ربط المزوّد بحسابك الحالي.', 'Provider linked to your existing account.'));
      }
      setAuthPassword('');
      await linkedProvidersQuery.refetch();
    } catch (error) {
      setAuthProviderError(error instanceof Error
        ? error.message
        : copy(language, 'تعذر تحديث ربط تسجيل الدخول.', 'Could not update the sign-in link.'));
    } finally {
      setAuthProviderBusy(null);
    }
  }

  function optionRow<T extends string | boolean>(
    title: string,
    options: Array<[T, string, string, string?]>,
    value: T,
    onChange: (next: T) => void,
    testPrefix?: string,
  ) {
    return (
      <View style={styles.controlBlock}>
        <Text style={[styles.label, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{title}</Text>
        <View style={[styles.optionRow, { backgroundColor: colors.muted, flexDirection: rtl ? 'row-reverse' : 'row' }]}>
          {options.map(([key, ar, en, icon]) => (
            <Pressable
              key={String(key)}
              testID={testPrefix ? `${testPrefix}-${String(key)}` : undefined}
              accessibilityRole="button"
              accessibilityState={{ selected: value === key }}
              onPress={() => onChange(key)}
              style={({ pressed }) => [
                styles.option,
                value === key && { backgroundColor: colors.card, borderColor: colors.border },
                { opacity: pressed ? 0.66 : 1 },
              ]}
            >
              {icon && <Feather name={icon as 'sun' | 'moon'} size={14} color={value === key ? colors.primary : colors.mutedForeground} />}
              <Text style={[styles.optionText, { color: value === key ? colors.foreground : colors.mutedForeground }]}>{copy(language, ar, en)}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  const permissionLabel = permission === 'granted'
    ? copy(language, 'مسموح', 'Allowed')
    : permission === 'denied'
      ? copy(language, 'مرفوض', 'Blocked')
      : permission === 'unsupported'
        ? copy(language, 'غير متاح على الويب', 'Unavailable on web')
        : permission === 'checking'
          ? copy(language, 'جارٍ التحقق', 'Checking')
          : permission === 'error'
            ? copy(language, 'تعذر التحقق', 'Could not check')
            : copy(language, 'غير مفعّل', 'Not enabled');

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={[styles.pageHeading, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        <Pressable testID="settings-back" accessibilityRole="button" accessibilityLabel={copy(language, 'عودة', 'Back')} onPress={onBack} style={[styles.backButton, { borderColor: colors.border }]}>
          <Feather name={rtl ? 'arrow-right' : 'arrow-left'} size={17} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'الإعدادات', 'Settings')}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>
            {copy(language, 'أدر تفضيلاتك هنا؛ إذن الإشعارات خاص بكل جهاز.', 'Manage your preferences here; notification permission is specific to each device.')}
          </Text>
        </View>
        <View style={[styles.headingIcon, { backgroundColor: colors.muted }]}><Feather name="sliders" size={17} color={colors.primary} /></View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionEyebrow, { color: colors.primary, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'التطبيق', 'APP')}</Text>
        {optionRow(copy(language, 'المظهر', 'Appearance'), [
          ['light', 'فاتح', 'Light', 'sun'],
          ['dark', 'داكن', 'Dark', 'moon'],
        ], themePreference, onThemeChange, 'theme')}
        {optionRow(copy(language, 'لغة الواجهة', 'Interface language'), [
          ['ar', 'العربية', 'Arabic'],
          ['en', 'الإنجليزية', 'English'],
        ], language, onLanguageChange, 'language')}
      </View>

      <Pressable
        testID="open-personal-information"
        accessibilityRole="button"
        accessibilityLabel={copy(language, 'فتح معلوماتك الشخصية', 'Open personal information')}
        onPress={onOpenPersonalInformation}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            flexDirection: rtl ? 'row-reverse' : 'row',
            alignItems: 'center',
            opacity: pressed ? 0.68 : 1,
          },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '700', textAlign: rtl ? 'right' : 'left' }}>
            {copy(language, 'معلوماتك الشخصية', 'Personal information')}
          </Text>
          <Text style={[styles.helper, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>
            {copy(language, 'تحكم في ملفك ومكتبة الذاكرة التي تستخدمها.', 'Manage your profile and the memory library the assistant can use.')}
          </Text>
        </View>
        <Feather name={rtl ? 'chevron-left' : 'chevron-right'} size={17} color={colors.primary} />
      </Pressable>

      {Platform.OS !== 'web' ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionEyebrow, { color: colors.primary, textAlign: rtl ? 'right' : 'left' }]}>
            {copy(language, 'الحساب', 'ACCOUNT')}
          </Text>
          <Text style={[styles.sectionTitle, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>
            {copy(language, 'طرق تسجيل الدخول', 'Sign-in methods')}
          </Text>
          <Text style={[styles.helper, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>
            {copy(language, 'اربط Google أو Microsoft بحسابك الحالي. لا يؤدي الربط إلى إنشاء حساب جديد أو نقل بياناتك.', 'Link Google or Microsoft to your existing account. Linking does not create a new account or move your data.')}
          </Text>
          <TextInput
            accessibilityLabel={copy(language, 'كلمة مرور الحساب الحالية', 'Current account password')}
            placeholder={copy(language, 'أدخل كلمة مرور حسابك الحالية', 'Enter your current account password')}
            placeholderTextColor={colors.mutedForeground}
            value={authPassword}
            onChangeText={setAuthPassword}
            secureTextEntry
            autoCapitalize="none"
            style={{
              color: colors.foreground,
              borderColor: colors.input,
              borderWidth: 1,
              borderRadius: 11,
              padding: 12,
              textAlign: rtl ? 'right' : 'left',
            }}
          />
          {linkedProvidersQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : linkedProvidersQuery.isError ? (
            <Text style={[styles.helper, { color: colors.destructive, textAlign: rtl ? 'right' : 'left' }]}>
              {copy(language, 'تعذر تحميل طرق تسجيل الدخول؛ أعد المحاولة قبل تغيير أي ربط.', 'Could not load sign-in methods. Retry before changing a link.')}
            </Text>
          ) : (
            (['google', 'microsoft'] as const).map((provider) => {
              const linked = linkedProvidersQuery.data?.providers.find((item) => item.provider === provider);
              return (
                <View key={provider} style={{ gap: 6 }}>
                  <Text style={[styles.helper, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>
                    {linked
                      ? `${provider === 'google' ? 'Google' : 'Microsoft'} · ${linked.emailAddress ?? copy(language, 'مرتبط', 'Linked')}`
                      : `${provider === 'google' ? 'Google' : 'Microsoft'} · ${copy(language, 'غير مرتبط', 'Not linked')}`}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!authPassword || authProviderBusy !== null || linkedProvidersQuery.isError}
                    onPress={() => void toggleAuthProvider(provider)}
                    style={{
                      backgroundColor: linked ? colors.muted : colors.primary,
                      borderRadius: 11,
                      padding: 12,
                      opacity: !authPassword || authProviderBusy !== null ? 0.5 : 1,
                    }}
                  >
                    <Text style={{
                      color: linked ? colors.foreground : colors.primaryForeground,
                      textAlign: 'center',
                      fontWeight: '700',
                    }}>
                      {authProviderBusy === provider
                        ? copy(language, 'جارٍ المعالجة…', 'Working…')
                        : linked
                          ? copy(language, 'إلغاء الربط', 'Unlink')
                          : copy(language, 'ربط المزوّد', 'Link provider')}
                    </Text>
                  </Pressable>
                </View>
              );
            })
          )}
          {authProviderError ? <Text style={{ color: colors.destructive, fontSize: 12 }}>{authProviderError}</Text> : null}
          {authProviderNotice ? <Text style={{ color: colors.primary, fontSize: 12 }}>{authProviderNotice}</Text> : null}
        </View>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>
            {copy(language, 'طرق تسجيل الدخول', 'Sign-in methods')}
          </Text>
          <Text style={[styles.helper, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>
            {copy(language, 'افتح إعدادات الحساب في نسخة الويب لربط Google أو Microsoft.', 'Open account settings in the web app to link Google or Microsoft.')}
          </Text>
        </View>
      )}

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionEyebrow, { color: colors.primary, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'السكرتير', 'SECRETARY')}</Text>
        <Text style={[styles.sectionTitle, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'كيف يتابع يومك', 'How your secretary keeps up')}</Text>
        <Text style={[styles.helper, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'تتحكم هذه الاختيارات في أسلوب المتابعة، ولا تحفظ معلومات شخصية عنك.', 'These choices tune the assistant’s behavior; they do not save personal facts about you.')}</Text>
        {optionRow(copy(language, 'الحضور', 'Activity'), [
          ['focused', 'مركز', 'Focused'],
          ['balanced', 'متوازن', 'Balanced'],
          ['quiet', 'هادئ', 'Quiet'],
        ], assistantPreferences.activity, (activity) => onAssistantPreferencesChange({ activity }), 'assistant-activity')}
        {optionRow(copy(language, 'المبادرة', 'Proactive level'), [
          ['low', 'منخفض', 'Low'],
          ['balanced', 'متوازن', 'Balanced'],
          ['high', 'مرتفع', 'High'],
        ], assistantPreferences.proactive, (proactive) => onAssistantPreferencesChange({ proactive }), 'assistant-proactive')}
        {optionRow(copy(language, 'عمق الإجابة', 'Answer depth'), [
          ['fast', 'سريع', 'Fast'],
          ['balanced', 'متوازن', 'Balanced'],
          ['deep', 'متعمق', 'Deep'],
        ], assistantPreferences.intelligence, (intelligence) => onAssistantPreferencesChange({ intelligence }), 'assistant-intelligence')}
        {optionRow(copy(language, 'أسلوب التواصل', 'Communication style'), [
          ['balanced', 'متوازن', 'Balanced'],
          ['friendly', 'ودود', 'Friendly'],
          ['concise', 'موجز', 'Concise'],
          ['formal', 'رسمي', 'Formal'],
        ], assistantPreferences.communicationStyle, (communicationStyle) => onAssistantPreferencesChange({ communicationStyle }), 'assistant-style')}
        {optionRow(copy(language, 'تكرار التذكير', 'Repeat reminders'), [
          [false, 'مرة واحدة', 'Once'],
          [true, 'السماح بالتكرار', 'Allow repeats'],
        ], assistantPreferences.repeatReminders, (repeatReminders) => onAssistantPreferencesChange({ repeatReminders }), 'assistant-repeat')}
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.notificationHeading, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
          <View style={[styles.notificationIcon, { backgroundColor: colors.muted }]}><Feather name="bell" size={16} color={colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'إشعارات الجهاز', 'Device notifications')}</Text>
            <Text style={[styles.helper, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'حالة إذن نظام التشغيل لهذا الجهاز فقط.', 'Permission status from this device’s operating system.')}</Text>
          </View>
          {permission === 'checking' ? <ActivityIndicator color={colors.primary} /> : (
            <Text accessibilityLiveRegion="polite" style={[styles.permissionStatus, { color: permission === 'granted' ? colors.primary : colors.mutedForeground }]}>{permissionLabel}</Text>
          )}
        </View>
        {permission === 'unsupported' ? (
          <Text style={[styles.webNote, { color: colors.mutedForeground, textAlign: rtl ? 'right' : 'left' }]}>{copy(language, 'إدارة إذن الإشعارات متاحة في تطبيق الهاتف فقط؛ لا يمكن للويب تغيير إذن الجهاز.', 'Notification permission controls are available in the mobile app; the web version cannot change device permissions.')}</Text>
        ) : permission === 'granted' ? (
          <Pressable accessibilityRole="button" onPress={openDeviceSettings} style={[styles.permissionButton, { borderColor: colors.border }]}>
            <Text style={[styles.permissionButtonText, { color: colors.foreground }]}>{copy(language, 'فتح إعدادات الجهاز', 'Open device settings')}</Text>
            <Feather name="external-link" size={14} color={colors.primary} />
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" disabled={permissionBusy || permission === 'checking'} onPress={permission === 'denied' || permission === 'error' ? openDeviceSettings : requestPermission} style={[styles.permissionButton, { backgroundColor: colors.primary, opacity: permissionBusy ? 0.7 : 1 }]}>
            {permissionBusy && <ActivityIndicator size="small" color={colors.primaryForeground} />}
            <Text style={[styles.permissionButtonText, { color: colors.primaryForeground }]}>{permission === 'denied' || permission === 'error' ? copy(language, 'فتح إعدادات الجهاز', 'Open device settings') : copy(language, 'السماح بالإشعارات', 'Allow notifications')}</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 115, gap: 14 },
  pageHeading: { alignItems: 'center', gap: 12, marginBottom: 3 },
  backButton: { width: 38, height: 38, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  headingIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 21, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 3 },
  card: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 14 },
  sectionEyebrow: { fontSize: 10, letterSpacing: 1.1, fontWeight: '800' },
  sectionTitle: { fontSize: 15, fontWeight: '700' },
  helper: { fontSize: 11, lineHeight: 17, marginTop: 4 },
  controlBlock: { gap: 7 },
  label: { fontSize: 12, fontWeight: '700' },
  optionRow: { borderRadius: 13, padding: 4, gap: 4 },
  option: { flex: 1, minHeight: 36, borderRadius: 10, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5, paddingHorizontal: 5 },
  optionText: { fontSize: 10, fontWeight: '700', textAlign: 'center' },
  notificationHeading: { alignItems: 'center', gap: 11 },
  notificationIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  permissionStatus: { fontSize: 11, fontWeight: '700' },
  webNote: { fontSize: 11, lineHeight: 18 },
  permissionButton: { minHeight: 42, paddingHorizontal: 13, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  permissionButtonText: { fontSize: 12, fontWeight: '700' },
});