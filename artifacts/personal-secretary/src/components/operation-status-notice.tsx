import { useState } from 'react';
import { CheckCircle2, ChevronDown, CircleAlert, CircleX, Clock3, LoaderCircle, PauseCircle } from 'lucide-react';
import type { OperationNotice } from '../lib/operation-presentation';

function checkedAtLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function label(status: OperationNotice['status']) {
  const labels: Record<OperationNotice['status'], string> = {
    pending_approval: 'محتاج موافقتك',
    executing: 'جارٍ التنفيذ',
    verifying: 'جارٍ التحقق',
    completed: 'تم التنفيذ ✓',
    rejected: 'تم رفض العملية',
    expired: 'انتهت صلاحية الموافقة',
    failed: 'التنفيذ فشل',
    unknown_result: 'النتيجة غير مؤكدة',
    needs_review: 'محتاج مراجعتك',
    cancelled: 'تم إلغاء العملية',
    waiting: 'في انتظار الخطوة التالية',
  };
  return labels[status];
}

function body(notice: OperationNotice) {
  switch (notice.status) {
    case 'pending_approval': return 'لن يبدأ التنفيذ قبل موافقتك.';
    case 'executing': return 'العملية قيد التنفيذ. لا ترسل موافقة أخرى.';
    case 'verifying': return 'جارٍ التحقق من النتيجة قبل تأكيد اكتمال العملية.';
    case 'completed': return notice.verificationSummary ?? 'وصلت نتيجة مكتملة للعملية.';
    case 'rejected': return 'تم رفض العملية.';
    case 'expired': return 'انتهت صلاحية الموافقة، ولم يتم اعتمادها.';
    case 'failed': return notice.errorSummary ?? 'التنفيذ فشل. راجع سجل العملية لأي سبب متاح.';
    case 'unknown_result': return 'لم أتمكن من التأكد هل تم التنفيذ. لن أعيد التنفيذ تلقائيًا.';
    case 'needs_review': return 'راجع تفاصيل العملية قبل اتخاذ خطوة أخرى.';
    case 'cancelled': return 'تم إلغاء العمل دون اعتباره مكتملًا.';
    case 'waiting': return 'العملية تنتظر الخطوة التالية.';
  }
}

export default function OperationStatusNotice({ notice }: { notice: OperationNotice }) {
  const [expanded, setExpanded] = useState(false);
  const icon = notice.status === 'completed' ? CheckCircle2
    : notice.status === 'rejected' ? CircleX
      : notice.status === 'executing' || notice.status === 'verifying' ? LoaderCircle
        : notice.status === 'pending_approval' || notice.status === 'waiting' ? Clock3
          : notice.status === 'cancelled' ? PauseCircle
            : CircleAlert;
  const StatusIcon = icon;
  const hasDetails = Boolean(notice.serviceLabel || notice.verificationSummary || notice.checkedAt);
  return (
    <section
      className="mt-3 rounded-xl border border-border/70 bg-background/60 p-3"
      data-testid={`operation-status-${notice.status}`}
      role={notice.status === 'unknown_result' || notice.status === 'needs_review' || notice.status === 'failed' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div className={`flex items-center gap-2 text-sm font-semibold ${notice.status === 'completed' ? 'text-emerald-600 dark:text-emerald-400' : notice.status === 'unknown_result' || notice.status === 'needs_review' || notice.status === 'failed' ? 'text-amber-700 dark:text-amber-300' : 'text-foreground'}`}>
        <StatusIcon className={`size-4 ${notice.status === 'executing' || notice.status === 'verifying' ? 'animate-spin' : ''}`} />
        {label(notice.status)}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body(notice)}</p>
      {hasDetails && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary"
            aria-expanded={expanded}
          >
            <ChevronDown className={`size-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            {expanded ? 'إخفاء التفاصيل' : 'تفاصيل التحقق'}
          </button>
          {expanded && (
            <div className="mt-2 space-y-1 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
              {notice.serviceLabel && <p>المصدر: {notice.serviceLabel}</p>}
              {notice.verificationSummary && <p>نتيجة التحقق: {notice.verificationSummary}</p>}
              {notice.checkedAt && <p>آخر تحقق: {checkedAtLabel(notice.checkedAt)}</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
