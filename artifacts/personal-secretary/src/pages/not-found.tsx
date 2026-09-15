import { AlertCircle, ArrowRight, Home, List } from 'lucide-react';
import { useLocation } from 'wouter';

export default function NotFound() {
  const [, setLocation] = useLocation();
  return (
    <div dir="rtl" lang="ar" className="grain flex min-h-[100dvh] w-full items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-md rounded-[24px] border border-border bg-card p-7 text-center shadow-sm">
        <AlertCircle className="mx-auto size-9 text-destructive" />
        <h1 className="mt-4 font-serif text-2xl">الصفحة غير موجودة</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">الرابط الذي فتحته غير متاح، لكن يمكنك العودة إلى السكرتير أو السجلات.</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={() => setLocation('/')} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"><Home className="size-4" /> المحادثة</button>
          <button type="button" onClick={() => setLocation('/records')} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-semibold text-muted-foreground hover:bg-muted"><List className="size-4" /> السجلات</button>
        </div>
        <button type="button" onClick={() => window.history.back()} className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"><ArrowRight className="size-3.5" /> العودة</button>
      </div>
    </div>
  );
}
