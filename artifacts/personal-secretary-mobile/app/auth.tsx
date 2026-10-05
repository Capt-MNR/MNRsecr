import { useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/services/auth-context';

export default function AuthRoute() {
  const colors = useColors();
  const router = useRouter();
  const { login, loginWithProvider, signup } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError('');
    try {
      if (mode === 'login') await login(email, password);
      else await signup(email, password, name);
      router.replace('/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تسجيل الدخول.');
    } finally {
      setPending(false);
    }
  }

  async function signInWithProvider(provider: 'google' | 'microsoft') {
    setPending(true);
    setError('');
    try {
      await loginWithProvider(provider);
      router.replace('/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تسجيل الدخول الخارجي.');
    } finally {
      setPending(false);
    }
  }

  return (
    <ScrollView testID="auth-login-screen" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.background }} keyboardShouldPersistTaps="handled">
      <View style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 24 }}>
        <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '700', textAlign: 'right' }}>السكرتير الشخصي</Text>
        <Text style={{ color: colors.foreground, fontSize: 26, fontWeight: '700', marginTop: 8, textAlign: 'right' }}>
          {mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب'}
        </Text>
        {mode === 'signup' && (
          <TextInput style={{ color: colors.foreground, borderColor: colors.input, borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 24 }} placeholder="الاسم" placeholderTextColor={colors.mutedForeground} value={name} onChangeText={setName} autoComplete="name" />
        )}
        <TextInput style={{ color: colors.foreground, borderColor: colors.input, borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 16 }} placeholder="البريد الإلكتروني" placeholderTextColor={colors.mutedForeground} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <TextInput style={{ color: colors.foreground, borderColor: colors.input, borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 16 }} placeholder="كلمة المرور (12 حرفًا على الأقل)" placeholderTextColor={colors.mutedForeground} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
        {error ? <Text style={{ color: colors.destructive, marginTop: 14, textAlign: 'right' }}>{error}</Text> : null}
        <Pressable disabled={pending || !email || password.length < 12} onPress={() => void submit()} style={{ backgroundColor: colors.primary, borderRadius: 10, padding: 14, marginTop: 20, opacity: pending || !email || password.length < 12 ? 0.5 : 1 }}>
          <Text style={{ color: colors.primaryForeground, textAlign: 'center', fontWeight: '700' }}>{pending ? 'جارٍ المعالجة…' : mode === 'login' ? 'دخول' : 'إنشاء الحساب'}</Text>
        </Pressable>
        {mode === 'login' && Platform.OS !== 'web' && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>أو سجّل الدخول باستخدام</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            </View>
            {(['google', 'microsoft'] as const).map((provider) => (
              <Pressable
                key={provider}
                disabled={pending}
                onPress={() => void signInWithProvider(provider)}
                style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 13, marginTop: 10, opacity: pending ? 0.5 : 1 }}
              >
                <Text style={{ color: colors.foreground, textAlign: 'center', fontWeight: '600' }}>
                  {provider === 'google' ? 'المتابعة باستخدام Google' : 'المتابعة باستخدام Microsoft'}
                </Text>
              </Pressable>
            ))}
            <Text style={{ color: colors.mutedForeground, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 8 }}>
              يجب ربط المزوّد بحسابك الحالي أولًا من الإعدادات.
            </Text>
          </>
        )}
        <Pressable onPress={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }} style={{ padding: 14 }}>
          <Text style={{ color: colors.mutedForeground, textAlign: 'center' }}>{mode === 'login' ? 'ليس لديك حساب؟ أنشئ حسابًا' : 'لديك حساب؟ سجّل الدخول'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}