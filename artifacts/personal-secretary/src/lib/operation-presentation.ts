export type OperationPresentationStatus =
  | 'pending_approval'
  | 'executing'
  | 'verifying'
  | 'completed'
  | 'rejected'
  | 'expired'
  | 'failed'
  | 'unknown_result'
  | 'needs_review'
  | 'cancelled'
  | 'waiting';

export type OperationNotice = {
  status: OperationPresentationStatus;
  operationId?: string;
  serviceLabel?: string;
  verificationSummary?: string;
  checkedAt?: string;
  errorSummary?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapStatus(value: unknown): OperationPresentationStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const status = value.toLowerCase();
  if (['unknown_result', 'uncertain', 'unknown'].includes(status)) return 'unknown_result';
  if (status === 'needs_review') return 'needs_review';
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
  if (['pending', 'pending_approval', 'approval_required', 'pending_confirmation'].includes(status)) return 'pending_approval';
  if (['queued', 'waiting'].includes(status)) return 'waiting';
  if (['claimed', 'running', 'executing'].includes(status)) return 'executing';
  if (status === 'verifying') return 'verifying';
  if (['verified', 'completed'].includes(status)) return 'completed';
  if (status === 'rejected') return 'rejected';
  if (status === 'expired') return 'expired';
  if (status === 'failed') return 'failed';
  return undefined;
}

function mapActionType(value: unknown): OperationPresentationStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const suffix = value.toLowerCase().match(/(?:^|_)(unknown_result|needs_review|verified|verifying|executing|rejected|expired|failed|cancelled|canceled)$/)?.[1];
  return mapStatus(suffix);
}

function serviceLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const labels: Record<string, string> = {
    google_sheets: 'Google Sheets',
    calendar: 'Google Calendar',
    email: 'Gmail',
    messaging: 'خدمة الرسائل',
  };
  return labels[value];
}

function verificationSummary(method: unknown): string | undefined {
  if (typeof method !== 'string') return undefined;
  const summaries: Record<string, string> = {
    provider_receipt_lookup: 'تم التحقق من إيصال الخدمة.',
    idempotency_lookup: 'تم التحقق من النتيجة عبر سجل الخدمة.',
    event_read_back: 'تمت مراجعة النتيجة من الخدمة.',
    event_absence_lookup: 'تم التحقق من عدم وجود العنصر في الخدمة.',
  };
  return summaries[method];
}

function safeFailureSummary(error: unknown): string | undefined {
  const code = asRecord(error).code;
  if (typeof code !== 'string') return undefined;
  const normalized = code.toLowerCase();
  if (/authentication|unauthorized|token_expired/.test(normalized)) return 'الحساب محتاج تسجيل دخول.';
  if (/permission|forbidden|access_denied/.test(normalized)) return 'السكرتير مش عنده الصلاحية المطلوبة.';
  if (/not_found|missing/.test(normalized)) return 'العنصر المطلوب غير موجود أو لم يعد متاحًا.';
  if (/conflict|stale/.test(normalized)) return 'البيانات اتغيرت قبل التنفيذ.';
  if (/rate_limit|quota/.test(normalized)) return 'الخدمة مشغولة حاليًا.';
  if (/timeout|deadline/.test(normalized)) return 'الخدمة ما ردتش في الوقت المتوقع.';
  if (/unavailable|service_disabled/.test(normalized)) return 'الخدمة غير متاحة حاليًا.';
  return 'التنفيذ فشل لدى الخدمة. راجع سجل العملية للتفاصيل المتاحة.';
}

export function operationNoticeFromAction(
  action: unknown,
  operationStatus?: unknown,
): OperationNotice | undefined {
  const value = asRecord(action);
  const external = asRecord(value.externalAction);
  const externalError = asRecord(external.error);
  const verification = asRecord(external.verification ?? value.verification);
  const candidates = [
    external.status,
    verification.state,
    verification.status,
    verification.outcome,
    verification.verified === true ? 'verified' : undefined,
    value.actionState,
    mapActionType(value.type),
    operationStatus,
    value.status,
  ];
  const status = candidates
    .map(mapStatus)
    .find((candidate): candidate is OperationPresentationStatus => Boolean(candidate));
  if (!status) return undefined;
  const service = serviceLabel(external.provider ?? value.provider);
  const checkedAt = typeof verification.checkedAt === 'string'
    ? verification.checkedAt
    : typeof verification.verifiedAt === 'string'
      ? verification.verifiedAt
      : undefined;
  return {
    status,
    ...(typeof value.operationId === 'string' ? { operationId: value.operationId } : {}),
    ...(service ? { serviceLabel: service } : {}),
    ...(status === 'completed' && verificationSummary(verification.method)
      ? { verificationSummary: verificationSummary(verification.method) }
      : {}),
    ...(checkedAt ? { checkedAt } : {}),
    ...(status === 'failed' && safeFailureSummary(externalError) ? { errorSummary: safeFailureSummary(externalError) } : {}),
  };
}

export function approvalExplanation(toolName: string): { service: string; reason: string; afterApproval: string } {
  const known: Record<string, { service: string; reason: string; afterApproval: string }> = {
    record_expense: {
      service: 'سجلات السكرتير',
      reason: 'هذه الخطوة تحفظ مصروفًا في سجلاتك.',
      afterApproval: 'سيحفظ السكرتير التفاصيل التي راجعتها.',
    },
    update_expense: {
      service: 'سجلات السكرتير',
      reason: 'هذه الخطوة تعدّل مصروفًا محفوظًا.',
      afterApproval: 'سيطبّق السكرتير التعديل الذي راجعته.',
    },
    create_reminder: {
      service: 'سجلات السكرتير',
      reason: 'هذه الخطوة تضيف تذكيرًا إلى سجلاتك.',
      afterApproval: 'سيُحفظ التذكير بالموعد الذي راجعته.',
    },
    create_agent_work: {
      service: 'Work',
      reason: 'هذه الخطوة تنشئ عملًا يتابعه السكرتير.',
      afterApproval: 'سيُنشأ العمل؛ وأي إجراء خارجي سيظل محتاجًا لموافقة مستقلة.',
    },
    google_sheets_execute: {
      service: 'Google Sheets',
      reason: 'هذه الخطوة تعدّل جدولًا وتحتاج موافقتك قبل الاتصال بـGoogle Sheets.',
      afterApproval: 'سينفذ السكرتير التغيير الموافق عليه ويتحقق من نتيجته.',
    },
    calendar_execute: {
      service: 'Google Calendar',
      reason: 'هذه الخطوة تعدّل التقويم وتحتاج موافقتك قبل الاتصال بالخدمة.',
      afterApproval: 'سينفذ السكرتير التغيير الموافق عليه ويتحقق من نتيجته.',
    },
    email_send: {
      service: 'Gmail',
      reason: 'هذه الخطوة ترسل رسالة وتحتاج موافقتك قبل الإرسال.',
      afterApproval: 'سيرسل السكرتير الرسالة التي راجعتها ويتحقق من حالتها.',
    },
    message_send: {
      service: 'خدمة الرسائل',
      reason: 'هذه الخطوة ترسل رسالة وتحتاج موافقتك قبل الإرسال.',
      afterApproval: 'سيرسل السكرتير الرسالة التي راجعتها ويتحقق من حالتها.',
    },
  };
  return known[toolName] ?? {
    service: 'إجراء السكرتير',
    reason: 'هذا الإجراء متوقف حتى تراجعه وتوافق عليه.',
    afterApproval: 'ستستكمل العملية عبر مسارها المعتمد بعد موافقتك.',
  };
}

export function operationNoticeFromStatus(status: string): OperationNotice | undefined {
  const mapped = mapStatus(status);
  return mapped ? { status: mapped } : undefined;
}

export function approvalOutcomeMayBeUnknown(error: unknown): boolean {
  const value = asRecord(error);
  const response = asRecord(value.response);
  const status = typeof value.status === 'number'
    ? value.status
    : typeof response.status === 'number' ? response.status : undefined;
  const name = typeof value.name === 'string' ? value.name : '';
  const category = typeof value.category === 'string' ? value.category : '';
  return error instanceof TypeError
    || name === 'FetchTimeoutError'
    || category === 'timeout'
    || category === 'network'
    || status === 0
    || status === 408
    || status === 504
    || (typeof status === 'number' && status >= 500);
}
