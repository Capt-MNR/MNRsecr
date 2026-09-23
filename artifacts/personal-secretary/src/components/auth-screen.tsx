import { useState, type FormEvent } from 'react';
import { login, signup, type AuthUser } from '@/lib/auth';

export default function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setPending(true);
    setError('');
    try {
      const user = mode === 'login'
        ? await login(email, password)
        : await signup(email, password, name);
      onAuthenticated(user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تسجيل الدخول.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6" dir="rtl">
      <section className="w-full max-w-md rounded-2xl border bg-background p-7 shadow-sm">
        <p className="text-sm font-medium text-primary">السكرتير الشخصي</p>
        <h1 className="mt-2 text-2xl font-semibold">{mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          بياناتك تبقى ضمن مساحة العمل الخاصة بحسابك.
        </p>
        <form onSubmit={(event) => void submit(event)}>
        {mode === 'signup' && (
          <label className="mt-6 block text-sm">
            الاسم
            <input className="mt-2 w-full rounded-lg border bg-background px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </label>
        )}
        <label className="mt-4 block text-sm">
          البريد الإلكتروني
          <input className="mt-2 w-full rounded-lg border bg-background px-3 py-2" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" dir="ltr" />
        </label>
        <label className="mt-4 block text-sm">
          كلمة المرور
          <input className="mt-2 w-full rounded-lg border bg-background px-3 py-2" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} dir="ltr" />
        </label>
        {error && <p className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <button type="submit" className="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground disabled:opacity-50" disabled={pending || !email || password.length < 12}>
          {pending ? 'جارٍ المعالجة…' : mode === 'login' ? 'دخول' : 'إنشاء الحساب'}
        </button>
        </form>
        <button type="button" className="mt-4 w-full text-sm text-muted-foreground underline-offset-4 hover:underline" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}>
          {mode === 'login' ? 'ليس لديك حساب؟ أنشئ حسابًا' : 'لديك حساب؟ سجّل الدخول'}
        </button>
      </section>
    </main>
  );
}