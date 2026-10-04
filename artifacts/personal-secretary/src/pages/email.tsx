import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  LoaderCircle,
  Mail,
  ShieldCheck,
  Unlink,
} from "lucide-react";
import {
  getGetGoogleCalendarAccountQueryKey,
  getGetGmailEmailAccountQueryKey,
  useConnectGoogleCalendarAccount,
  useDisconnectGoogleCalendarAccount,
  useGetGoogleCalendarAccount,
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
  const calendarAccountQuery = useGetGoogleCalendarAccount({
    query: {
      queryKey: getGetGoogleCalendarAccountQueryKey(),
      staleTime: 0,
    },
  });
  const connectMutation = useConnectGmailEmailAccount();
  const disconnectMutation = useDisconnectGmailEmailAccount();
  const connectCalendarMutation = useConnectGoogleCalendarAccount();
  const disconnectCalendarMutation = useDisconnectGoogleCalendarAccount();

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const emailStatus = params.get("email_connection");
    const calendarStatus = params.get("calendar_connection");
    if (!emailStatus && !calendarStatus) return;
    if (handledCallbackRef.current === searchString) return;
    handledCallbackRef.current = searchString;
    if (calendarStatus) {
      if (calendarStatus === "connected") {
        setNotice("تم ربط Google Calendar. تحقق من عنوان الحساب والصلاحيات أدناه.");
        void queryClient.invalidateQueries({ queryKey: getGetGoogleCalendarAccountQueryKey() });
      } else if (calendarStatus === "cancelled") {
        setNotice("أُلغيت عملية ربط Google Calendar.");
      } else {
        setNotice("تعذر إكمال ربط Google Calendar. لم يتم حفظ الحساب.");
      }
    } else {
      if (emailStatus === "connected") {
        setNotice("تم ربط Gmail. تحقق من عنوان الحساب أدناه.");
        void queryClient.invalidateQueries({ queryKey: getGetGmailEmailAccountQueryKey() });
      } else if (emailStatus === "cancelled") {
        setNotice("أُلغيت عملية ربط Gmail.");
      } else {
        setNotice("تعذر إكمال ربط Gmail. لم يتم حفظ الحساب.");
      }
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

  function connectGoogleCalendar() {
    connectCalendarMutation.mutate(undefined, {
      onSuccess: (response) => window.location.assign(response.authorizationUrl),
    });
  }

  function disconnectGoogleCalendar() {
    if (!window.confirm("هل تريد إزالة اتصال Google Calendar وإلغاء صلاحيته لدى Google؟")) return;
    disconnectCalendarMutation.mutate(undefined, {
      onSuccess: (response) => {
        setNotice(response.revoked
          ? "تمت إزالة اتصال Google Calendar وإلغاء صلاحيته لدى Google."
          : "أُزيل الحساب من هذا التطبيق، لكن تعذّر تأكيد إلغاء الصلاحية لدى Google.");
        void queryClient.invalidateQueries({ queryKey: getGetGoogleCalendarAccountQueryKey() });
      },
    });
  }

  const account = accountQuery.data;
  const calendarAccount = calendarAccountQuery.data;
  const busy = connectMutation.isPending || disconnectMutation.isPending;
  const calendarBusy = connectCalendarMutation.isPending || disconnectCalendarMutation.isPending;

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
              <h1 className="mt-2 font-serif text-3xl tracking-tight">الحسابات المتصلة</h1>
              <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
                اربط Gmail أو Google Calendar بحسابك. يتطلب كل إجراء خارجي موافقة منفصلة قبل تنفيذه.
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

          <div className="mt-6 rounded-2xl border border-border/80 bg-background/60 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {calendarAccountQuery.isPending ? (
                    <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                  ) : calendarAccount?.connected ? (
                    <CheckCircle2 className="size-4 text-emerald-600" />
                  ) : (
                    <CalendarDays className="size-4 text-muted-foreground" />
                  )}
                  {calendarAccountQuery.isPending
                    ? "جارٍ فحص اتصال التقويم…"
                    : calendarAccount?.connected
                      ? "حساب Google Calendar متصل"
                      : "لا يوجد حساب تقويم متصل"}
                </div>
                {calendarAccount?.connected && calendarAccount.emailAddress && (
                  <p className="mt-2 text-sm text-muted-foreground" data-testid="text-calendar-account">
                    {calendarAccount.emailAddress}
                  </p>
                )}
                {calendarAccount?.connected && (
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="text-calendar-scope">
                    صلاحية أحداث التقويم فقط
                  </p>
                )}
              </div>

              {calendarAccount?.connected ? (
                <button
                  type="button"
                  onClick={disconnectGoogleCalendar}
                  disabled={calendarBusy}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-destructive/30 px-4 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/5 disabled:opacity-50"
                  data-testid="button-disconnect-google-calendar"
                >
                  {disconnectCalendarMutation.isPending
                    ? <LoaderCircle className="size-4 animate-spin" />
                    : <Unlink className="size-4" />}
                  إزالة الحساب
                </button>
              ) : (
                <button
                  type="button"
                  onClick={connectGoogleCalendar}
                  disabled={!calendarAccount?.configured || calendarBusy || calendarAccountQuery.isPending}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="button-connect-google-calendar"
                >
                  {connectCalendarMutation.isPending
                    ? <LoaderCircle className="size-4 animate-spin" />
                    : <CalendarDays className="size-4" />}
                  ربط Google Calendar
                </button>
              )}
            </div>
            {calendarAccountQuery.isError && (
              <p className="mt-4 text-sm text-destructive" role="alert" data-testid="status-calendar-load-error">
                تعذر تحميل حالة اتصال التقويم. أعد تحميل الصفحة للمحاولة مرة أخرى.
              </p>
            )}
            {connectCalendarMutation.isError && (
              <p className="mt-4 text-sm text-destructive" role="alert" data-testid="status-calendar-connect-error">
                تعذر بدء ربط Google Calendar.
              </p>
            )}
            {disconnectCalendarMutation.isError && (
              <p className="mt-4 text-sm text-destructive" role="alert" data-testid="status-calendar-disconnect-error">
                تعذر إزالة اتصال Google Calendar.
              </p>
            )}
            {calendarAccount && !calendarAccount.configured && !calendarAccount.connected && (
              <p className="mt-4 text-sm leading-6 text-muted-foreground" data-testid="status-calendar-not-configured">
                ربط Google Calendar غير مفعّل في هذه البيئة بعد؛ يلزم إعداد OAuth لاختبار حساب حقيقي.
              </p>
            )}
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              يُحفظ رمز التحديث مشفّراً. لا تُكتب التغييرات على التقويم إلا بعد موافقتك، وتُراجع النتيجة قبل اعتبارها مكتملة.
            </p>
          </div>

          <div className="mt-6 flex gap-3 rounded-2xl bg-primary/5 p-4 text-sm leading-6">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
            <p>
              بيانات OAuth تُحفظ مشفّرة ومربوطة بحسابك. لا تظهر رموز الدخول في سجل الإجراءات، والنتائج الخارجية غير المؤكدة لا تؤدي إلى تنفيذ جديد تلقائيًا.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

export default EmailSettings;