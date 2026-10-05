import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAuthOAuthLinkedProvidersQueryKey,
  useGetAuthOAuthLinkedProviders,
  useUnlinkAuthOAuthProvider,
} from "@workspace/api-client-react";
import { beginOAuth, type AuthProvider } from "@/lib/auth";

const providers: Array<{ id: AuthProvider; label: string }> = [
  { id: "google", label: "Google" },
  { id: "microsoft", label: "Microsoft" },
];

function explainError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("AUTH_REAUTHENTICATION_REQUIRED")) return "كلمة المرور الحالية غير صحيحة.";
  if (message.includes("AUTH_PROVIDER_NOT_CONFIGURED")) return "إعدادات تسجيل الدخول لهذا المزوّد غير مكتملة بعد.";
  if (message.includes("AUTH_PROVIDER_ALREADY_LINKED")) return "هذا المزوّد مرتبط بحساب آخر أو يوجد ربط سابق.";
  return "تعذر تحديث طريقة تسجيل الدخول.";
}

export default function AuthProvidersSection() {
  const queryClient = useQueryClient();
  const linkedQuery = useGetAuthOAuthLinkedProviders({
    query: {
      queryKey: getGetAuthOAuthLinkedProvidersQueryKey(),
      staleTime: 0,
    },
  });
  const unlinkMutation = useUnlinkAuthOAuthProvider();
  const [currentPassword, setCurrentPassword] = useState("");
  const [linking, setLinking] = useState<AuthProvider | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function link(provider: AuthProvider) {
    if (!currentPassword || linking) return;
    setLinking(provider);
    setError("");
    setNotice("");
    try {
      const authorizationUrl = await beginOAuth(provider, "link", { currentPassword });
      window.location.assign(authorizationUrl);
    } catch (reason) {
      setError(explainError(reason));
      setLinking(null);
    }
  }

  function unlink(provider: AuthProvider) {
    if (!currentPassword || unlinkMutation.isPending) return;
    if (!window.confirm(`هل تريد إلغاء ربط ${provider === "google" ? "Google" : "Microsoft"}؟ لن تتغير بيانات حسابك، لكن لن تتمكن من تسجيل الدخول بهذا المزوّد.`)) return;
    setError("");
    setNotice("");
    unlinkMutation.mutate(
      { provider, data: { currentPassword } },
      {
        onSuccess: () => {
          setCurrentPassword("");
          setNotice("أُلغي ربط المزوّد. بقيت بيانات حسابك كما هي.");
          void queryClient.invalidateQueries({ queryKey: getGetAuthOAuthLinkedProvidersQueryKey() });
        },
        onError: (reason) => setError(explainError(reason)),
      },
    );
  }

  return (
    <section className="mt-6 rounded-3xl border border-border/80 bg-card p-6 shadow-sm sm:p-8" aria-labelledby="auth-provider-heading">
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <span aria-hidden="true" className="font-bold">G/M</span>
        </span>
        <div>
          <h2 id="auth-provider-heading" className="text-lg font-semibold">طرق تسجيل الدخول</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            اربط Google أو Microsoft بحسابك الحالي. لا ينشئ الربط حسابًا جديدًا ولا ينقل بياناتك.
          </p>
        </div>
      </div>

      <label className="mt-5 block text-sm">
        كلمة مرور حسابك الحالية للتأكيد
        <input
          className="mt-2 w-full rounded-lg border bg-background px-3 py-2"
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoComplete="current-password"
          dir="ltr"
        />
      </label>

      <div className="mt-5 divide-y divide-border rounded-xl border">
        {providers.map(({ id, label }) => {
          const linked = linkedQuery.data?.providers.find((item) => item.provider === id);
          const busy = linking === id || unlinkMutation.isPending;
          return (
            <div key={id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {linked
                    ? `مرتبط${linked.emailAddress ? ` · ${linked.emailAddress}` : ""}`
                    : "غير مرتبط"}
                </p>
              </div>
              <button
                type="button"
                disabled={!currentPassword || busy || linkedQuery.isLoading || linkedQuery.isError}
                onClick={() => linked ? unlink(id) : void link(id)}
                className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                  linked
                    ? "border bg-background hover:bg-muted"
                    : "bg-primary text-primary-foreground hover:opacity-90"
                }`}
              >
                {busy ? "جارٍ المعالجة…" : linked ? "إلغاء الربط" : "ربط"}
              </button>
            </div>
          );
        })}
      </div>
      {linkedQuery.isLoading && <p className="mt-3 text-sm text-muted-foreground">جارٍ تحميل طرق تسجيل الدخول…</p>}
      {linkedQuery.isError && <p className="mt-3 text-sm text-destructive">تعذر تحميل طرق تسجيل الدخول.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-primary">{notice}</p>}
    </section>
  );
}
