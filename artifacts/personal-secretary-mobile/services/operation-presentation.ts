import {
  isSecretaryAuthenticationFailure,
  SecretaryChatTransportError,
} from './secretary-chat';

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

type AppLanguage = 'ar' | 'en';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function lowerString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.toLowerCase() : undefined;
}

function statusFrom(value: unknown): OperationPresentationStatus | undefined {
  const normalized = lowerString(value);
  if (!normalized) return undefined;
  if (['unknown_result', 'uncertain', 'unknown'].includes(normalized)) return 'unknown_result';
  if (normalized === 'needs_review') return 'needs_review';
  if (['cancelled', 'canceled'].includes(normalized)) return 'cancelled';
  if (['pending', 'pending_approval', 'approval_required', 'pending_confirmation'].includes(normalized)) return 'pending_approval';
  if (['queued', 'waiting'].includes(normalized)) return 'waiting';
  if (['claimed', 'running', 'executing'].includes(normalized)) return 'executing';
  if (normalized === 'verifying') return 'verifying';
  if (['verified', 'completed'].includes(normalized)) return 'completed';
  if (normalized === 'rejected') return 'rejected';
  if (normalized === 'expired') return 'expired';
  if (normalized === 'failed') return 'failed';
  return undefined;
}

export function operationNoticeFromStatus(status: string): OperationNotice | undefined {
  const mapped = statusFrom(status);
  return mapped ? { status: mapped } : undefined;
}

export function operationNoticeForHandoff(
  status: string,
  operationId: string,
  stateHint?: 'unknown_result' | 'needs_review',
): OperationNotice {
  const current = operationNoticeFromStatus(status);
  const notice = current?.status === 'pending_approval' && stateHint
    ? { status: stateHint }
    : current ?? { status: stateHint ?? 'unknown_result' };
  return { ...notice, operationId };
}

function typeStatus(value: unknown): OperationPresentationStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const type = value.toLowerCase();
  const suffix = type.match(/(?:^|_)(unknown_result|needs_review|verified|verifying|executing|rejected|expired|failed|cancelled|canceled)$/)?.[1];
  return statusFrom(suffix);
}

function serviceLabel(provider: unknown): string | undefined {
  if (typeof provider !== 'string') return undefined;
  const labels: Record<string, string> = {
    google_sheets: 'Google Sheets',
    calendar: 'Google Calendar',
    email: 'Gmail',
    messaging: 'خدمة الرسائل',
  };
  return labels[provider];
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
  const code = lowerString(asRecord(error).code);
  if (!code) return undefined;
  if (/authentication|unauthorized|token_expired/.test(code)) return 'الحساب محتاج تسجيل دخول.';
  if (/permission|forbidden|access_denied/.test(code)) return 'السكرتير مش عنده الصلاحية المطلوبة.';
  if (/not_found|missing/.test(code)) return 'العنصر المطلوب غير موجود أو لم يعد متاحًا.';
  if (/conflict|stale/.test(code)) return 'البيانات اتغيرت قبل التنفيذ.';
  if (/rate_limit|quota/.test(code)) return 'الخدمة مشغولة حاليًا.';
  if (/timeout|deadline/.test(code)) return 'الخدمة ما ردتش في الوقت المتوقع.';
  if (/unavailable|service_disabled/.test(code)) return 'الخدمة غير متاحة حاليًا.';
  return 'التنفيذ فشل لدى الخدمة. راجع سجل العملية للتفاصيل المتاحة.';
}

function statusFromType(value: Record<string, unknown>): OperationPresentationStatus | undefined {
  return typeStatus(value.type);
}

export function operationNoticeFromAction(
  action: unknown,
  operationStatus?: unknown,
): OperationNotice | undefined {
  const value = asRecord(action);
  const external = asRecord(value.externalAction);
  const externalError = asRecord(external.error);
  const verification = asRecord(external.verification ?? value.verification);
  const status = [
    external.status,
    verification.state,
    verification.status,
    verification.outcome,
    verification.verified === true ? 'verified' : undefined,
    value.actionState,
    statusFromType(value),
    operationStatus,
    value.status,
  ]
    .map(statusFrom)
    .find((candidate): candidate is OperationPresentationStatus => Boolean(candidate));

  if (!status) return undefined;
  const service = serviceLabel(external.provider ?? value.provider);
  const methodSummary = status === 'completed' ? verificationSummary(verification.method) : undefined;
  const checkedAt = typeof verification.checkedAt === 'string'
    ? verification.checkedAt
    : typeof verification.verifiedAt === 'string'
      ? verification.verifiedAt
      : undefined;
  const errorSummary = status === 'failed' ? safeFailureSummary(externalError) : undefined;
  return {
    status,
    ...(typeof value.operationId === 'string' ? { operationId: value.operationId } : {}),
    ...(service ? { serviceLabel: service } : {}),
    ...(methodSummary ? { verificationSummary: methodSummary } : {}),
    ...(checkedAt ? { checkedAt } : {}),
    ...(errorSummary ? { errorSummary } : {}),
  };
}

export function approvalExplanation(
  toolName: string | undefined,
  language: AppLanguage,
): { service: string; reason: string; afterApproval: string } {
  const english = language === 'en';
  const known: Record<string, { service: string; reason: string; afterApproval: string }> = {
    record_expense: {
      service: english ? 'Secretary records' : 'سجلات السكرتير',
      reason: english ? 'This step saves an expense to your records.' : 'هذه الخطوة تحفظ مصروفًا في سجلاتك.',
      afterApproval: english ? 'The secretary will save the reviewed details.' : 'سيحفظ السكرتير التفاصيل التي راجعتها.',
    },
    update_expense: {
      service: english ? 'Secretary records' : 'سجلات السكرتير',
      reason: english ? 'This step changes a saved expense.' : 'هذه الخطوة تعدّل مصروفًا محفوظًا.',
      afterApproval: english ? 'The secretary will apply the reviewed change.' : 'سيطبّق السكرتير التعديل الذي راجعته.',
    },
    create_reminder: {
      service: english ? 'Secretary records' : 'سجلات السكرتير',
      reason: english ? 'This step adds a reminder to your records.' : 'هذه الخطوة تضيف تذكيرًا إلى سجلاتك.',
      afterApproval: english ? 'The reminder will be saved with the reviewed time.' : 'سيُحفظ التذكير بالموعد الذي راجعته.',
    },
    create_agent_work: {
      service: 'Work',
      reason: english ? 'This step creates work for the secretary to follow.' : 'هذه الخطوة تنشئ عملًا يتابعه السكرتير.',
      afterApproval: english
        ? 'The Work item will be created; any external action still needs separate approval.'
        : 'سيُنشأ العمل؛ وأي إجراء خارجي سيظل محتاجًا لموافقة مستقلة.',
    },
    google_sheets_execute: {
      service: 'Google Sheets',
      reason: english ? 'This step changes a spreadsheet and needs approval before contacting Google Sheets.' : 'هذه الخطوة تعدّل جدولًا وتحتاج موافقتك قبل الاتصال بـGoogle Sheets.',
      afterApproval: english ? 'The secretary will make the approved change and verify the result.' : 'سينفذ السكرتير التغيير الموافق عليه ويتحقق من نتيجته.',
    },
    calendar_execute: {
      service: 'Google Calendar',
      reason: english ? 'This step changes a calendar and needs approval before contacting the service.' : 'هذه الخطوة تعدّل التقويم وتحتاج موافقتك قبل الاتصال بالخدمة.',
      afterApproval: english ? 'The secretary will make the approved change and verify the result.' : 'سينفذ السكرتير التغيير الموافق عليه ويتحقق من نتيجته.',
    },
    email_send: {
      service: 'Gmail',
      reason: english ? 'This step sends a message and needs approval before it is sent.' : 'هذه الخطوة ترسل رسالة وتحتاج موافقتك قبل الإرسال.',
      afterApproval: english ? 'The secretary will send the reviewed message and check its status.' : 'سيرسل السكرتير الرسالة التي راجعتها ويتحقق من حالتها.',
    },
    message_send: {
      service: english ? 'Messaging service' : 'خدمة الرسائل',
      reason: english ? 'This step sends a message and needs approval before it is sent.' : 'هذه الخطوة ترسل رسالة وتحتاج موافقتك قبل الإرسال.',
      afterApproval: english ? 'The secretary will send the reviewed message and check its status.' : 'سيرسل السكرتير الرسالة التي راجعتها ويتحقق من حالتها.',
    },
  };
  return known[toolName ?? ''] ?? {
    service: english ? 'Secretary action' : 'إجراء السكرتير',
    reason: english ? 'This action is paused until you review and approve it.' : 'هذا الإجراء متوقف حتى تراجعه وتوافق عليه.',
    afterApproval: english ? 'The approved operation will continue through its existing workflow.' : 'ستستكمل العملية عبر مسارها المعتمد بعد موافقتك.',
  };
}

export function secretaryFailureText(error: unknown, language: AppLanguage, approval = false): string {
  if (isSecretaryAuthenticationFailure(error)) {
    return language === 'ar' ? 'الحساب محتاج تسجيل دخول.' : 'Sign in to continue.';
  }
  const value = asRecord(error);
  const category = error instanceof SecretaryChatTransportError ? error.category : value.category;
  const status = typeof value.status === 'number' ? value.status : undefined;
  const name = typeof value.name === 'string' ? value.name : '';
  if (category === 'permission_error' || category === 'permission' || status === 403) {
    return language === 'ar' ? 'السكرتير مش عنده الصلاحية المطلوبة.' : 'The secretary does not have the required permission.';
  }
  if (category === 'conflict_error' || category === 'conflict' || status === 409) {
    return language === 'ar' ? 'البيانات اتغيرت قبل التنفيذ. راجع أحدث حالة.' : 'The data changed before execution. Review the latest state.';
  }
  if (category === 'not_found' || status === 404) {
    return language === 'ar' ? 'العملية لم تعد متاحة. حدّث الحالة قبل المتابعة.' : 'This operation is no longer available. Refresh its status before continuing.';
  }
  if (category === 'timeout' || name === 'FetchTimeoutError' || status === 408 || status === 504) {
    return language === 'ar'
      ? approval ? 'الخدمة ما ردتش في الوقت المتوقع. راجع حالة العملية قبل أي إعادة.' : 'الخدمة ما ردتش في الوقت المتوقع. راجع المحادثة قبل إعادة الطلب.'
      : approval ? 'The service did not respond in time. Check the operation before trying again.' : 'The service did not respond in time. Check the conversation before resending.';
  }
  if (category === 'rate_limit' || category === 'provider_rate_limit' || status === 429) {
    return language === 'ar' ? 'الخدمة مشغولة حاليًا. انتظر قليلًا ثم حاول مرة أخرى.' : 'The service is busy. Wait briefly before trying again.';
  }
  if (category === 'provider_unavailable' || category === 'provider_error' || status === 502 || status === 503) {
    return language === 'ar' ? 'الخدمة المستخدمة غير متاحة حاليًا.' : 'The service is currently unavailable.';
  }
  if (category === 'validation_error' || category === 'validation' || status === 400 || status === 422) {
    return language === 'ar' ? 'الطلب يحتاج إلى تفاصيل أو تصحيح قبل إكماله.' : 'The request needs more detail or correction before it can continue.';
  }
  if (category === 'response_parse_error' || category === 'internal_error' || category === 'agent_error' || status && status >= 500) {
    return language === 'ar' ? 'تعذر إكمال الطلب بسبب خطأ داخلي. لم أعرض تفاصيل تقنية.' : 'The request could not be completed because of an internal error.';
  }
  if (error instanceof TypeError) {
    return language === 'ar' ? 'تعذر الاتصال بالخدمة. تحقّق من اتصالك.' : 'Could not reach the service. Check your connection.';
  }
  return language === 'ar'
    ? approval ? 'تعذر حفظ قرارك. راجع حالة العملية قبل المتابعة.' : 'تعذر إكمال الطلب. حاول مرة أخرى.'
    : approval ? 'Your decision could not be saved. Check the operation status before continuing.' : 'The request could not be completed. Try again.';
}

export function approvalOutcomeMayBeUnknown(error: unknown): boolean {
  const value = asRecord(error);
  return (error instanceof SecretaryChatTransportError && error.category === 'timeout')
    || value.name === 'FetchTimeoutError'
    || value.category === 'timeout'
    || value.status === 408
    || value.status === 504
    || error instanceof TypeError;
}
