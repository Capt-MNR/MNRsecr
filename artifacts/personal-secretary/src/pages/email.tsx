import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, LoaderCircle, Mail, ShieldCheck, Unlink } from "lucide-react";
import {
  getGetGmailEmailAccountQueryKey,
  useConnectGmailEmailAccount,
  useDisconnectGmailEmailAccount,
  useGetGmailEmailAccount,
} from "@workspace/api-client-react";
import { Link, useLocation, useSearch } from "wouter";

function EmailSettings() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const [notice, setNotice] = useState("");
  const handledCallbackRef = useRef<string | null>(null);
  const accountQuery = useGetGmailEmailAccount({
    query: {
      queryKey: getGetGmailEmailAccountQueryKey(),
      staleTime: 0,
    },
  });
  const connectMutation = useConnectGmailEmailAccount();
  const disconnectMutation = useDisconnectGmailEmailAccount();

  useEffect(() => {
    const status = new URLSearchParams(searchString).get("email_connection");
    if (!status) return;
    if (handledCallbackRef.current === searchString) return;
    handledCallbackRef.current = searchString;
    if (status === "connected") {
      setNotice("تم ربط Gmail. تحقق من عنوان الحساب أدناه.");
      void queryClient.invalidateQueries({ queryKey: getGetGmailEmailAccountQueryKey() });
    } else if (status === "cancelled") {
      setNotice("أُلغيت عملية ربط Gmail.");
    } else {
      setNotice("تعذر إكمال ربط Gmail. لم يتم حفظ الحساب.");
    }
    setLocation("/email", { replace: true });
  }, [queryClient, searchString, setLocation]);

  function connectGmail() {
    connectMutation.mutate(undefined, {
      onSuccess: (response) => window.location.assign(response.authorizationUrl),
    });
  }

  function disconnectGmail() {
    if (!window.confirm("هل تريد إزالة اتصال Gmail من حسابك؟")) return;
    disconnectMutation.mutate(undefined, {
      onSuccess: () => {
        setNotice("تمت إزالة اتصال Gmail.");
        void queryClient.invalidateQueries({ queryKey: getGetGmailEmailAccountQueryKey() });
      },
    });
  }

  const account = accountQuery.data;
  const busy = connectMutation.isPending || disconnectMutation.isPending;

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-8">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          data-testid="link-email-back-home"
        >
          <ArrowLeft className="size-4" />
          العودة إلى مساحة العمل
        </Link>

        <section className="rounded-3xl border border-border/80 bg-card p-6 shadow-sm sm:p-8">
          <div className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Mail className="size-6" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">الحسابات المتصلة</p>
              <h1 className="mt-2 font-serif text-3xl tracking-tight">البريد الإلكتروني</h1>
              <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
                اربط صندوق Gmail الخاص بك. سيستخدمه السكرتير لإرسال رسالة واحدة فقط بعد مراجعتها والموافقة عليها.
              </p>
            </div>
          </div>

          {notice && (
            <p
              className="mt-6 rounded-xl border border-border bg-muted/60 px-4 py-3 text-sm"
              role="status"
              data-testid="status-email-connection-notice"
            >
              {notice}
            </p>
          )}

          <div className="mt-7 rounded-2xl border border-border/80 bg-background/60 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {accountQuery.isPending ? (
                    <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                  ) : account?.connected ? (
                    <CheckCircle2 className="size-4 text-emerald-600" />
                  ) : (
                    <Mail className="size-4 text-muted-foreground" />
                  )}
                  {accountQuery.isPending
                    ? "جارٍ فحص الاتصال…"
                    : account?.connected
                      ? "حساب Gmail متصل"
                      : "لا يوجد حساب متصل"}
                </div>
                {account?.connected && account.emailAddress && (
                  <p className="mt-2 text-sm text-muted-foreground" data-testid="text-gmail-account">
                    {account.emailAddress}
                  </p>
                )}
              </div>

              {account?.connected ? (
                <button
                  type="button"
                  onClick={disconnectGmail}
                  disabled={busy}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-destructive/30 px-4 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/5 disabled:opacity-50"
                  data-testid="button-disconnect-gmail"
                >
                  {disconnectMutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Unlink className="size-4" />}
                  إزالة الحساب
                </button>
              ) : (
                <button
                  type="button"
                  onClick={connectGmail}
                  disabled={!account?.configured || busy || accountQuery.isPending}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="button-connect-gmail"
                >
                  {connectMutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Mail className="size-4" />}
                  ربط Gmail
                </button>
              )}
            </div>
            {accountQuery.isError && (
              <p className="mt-4 text-sm text-destructive" role="alert" data-testid="status-gmail-load-error">
                تعذر تحميل حالة اتصال البريد. أعد تحميل الصفحة للمحاولة مرة أخرى.
              </p>
            )}
            {connectMutation.isError && (
              <p className="mt-4 text-sm text-destructive" role="alert" data-testid="status-gmail-connect-error">
                ربط Gmail غير متاح في هذه البيئة أو تعذر بدء العملية.
              </p>
            )}
            {disconnectMutation.isError && (
              <p className="mt-4 text-sm text-destructive" role="alert" data-testid="status-gmail-disconnect-error">
                تعذر إزالة اتصال Gmail.
              </p>
            )}
            {account && !account.configured && !account.connected && (
              <p className="mt-4 text-sm leading-6 text-muted-foreground" data-testid="status-gmail-not-configured">
                ربط Gmail غير مفعّل هنا بعد. لا تُرسل رسائل حقيقية من بيئة الإنتاج؛ يجب إكمال إعداد OAuth والتحقق قبل تفعيله.
              </p>
            )}
          </div>

          <div className="mt-6 flex gap-3 rounded-2xl bg-primary/5 p-4 text-sm leading-6">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
            <p>
              بيانات OAuth تُحفظ مشفّرة ومربوطة بحسابك. لا تظهر رموز الدخول في سجل الإجراءات، ونتيجة الإرسال غير المؤكدة لا تؤدي إلى إعادة الإرسال تلقائيًا.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

export default EmailSettings;