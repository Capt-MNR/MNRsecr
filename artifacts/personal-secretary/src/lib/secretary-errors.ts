type ErrorPayload = {
  category?: string;
  code?: string;
  error?: string;
  requestId?: string;
  retryable?: boolean;
};

export type UserFacingError = {
  category:
    | "network"
    | "timeout"
    | "validation"
    | "authentication"
    | "permission"
    | "conflict"
    | "not_found"
    | "rate_limit"
    | "provider"
    | "agent"
    | "response_parse"
    | "server"
    | "unknown";
  message: string;
  retryable: boolean;
  requestId?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function payloadFrom(error: unknown): ErrorPayload {
  const record = asRecord(error);
  const data = asRecord(record?.data);
  return {
    category: typeof data?.category === "string" ? data.category : undefined,
    code: typeof data?.code === "string" ? data.code : undefined,
    error: typeof data?.error === "string" ? data.error : undefined,
    requestId: typeof data?.requestId === "string" ? data.requestId : undefined,
    retryable: typeof data?.retryable === "boolean" ? data.retryable : undefined,
  };
}

function statusFrom(error: unknown): number | undefined {
  const status = asRecord(error)?.status;
  return typeof status === "number" ? status : undefined;
}

export function classifySecretaryError(error: unknown): UserFacingError {
  const record = asRecord(error);
  const name = typeof record?.name === "string" ? record.name : "";
  const status = statusFrom(error);
  const payload = payloadFrom(error);

  if (name === "FetchTimeoutError") {
    return {
      category: "timeout",
      message: "الطلب أخذ وقتًا أطول من المتوقع. حاول مرة أخرى بعد قليل.",
      retryable: true,
      requestId: payload.requestId,
    };
  }

  if (name === "ResponseParseError") {
    return {
      category: "response_parse",
      message: "وصل رد غير مفهوم من السكرتير. حاول مرة أخرى، وإذا تكرر الأمر راجع الدعم.",
      retryable: true,
      requestId: payload.requestId,
    };
  }

  if (status !== undefined) {
    if (status === 400 || payload.category === "validation_error") {
      return {
        category: "validation",
        message: "الرسالة غير مكتملة أو تحتوي على بيانات غير صحيحة.",
        retryable: false,
        requestId: payload.requestId,
      };
    }
    if (status === 401 || status === 403 || payload.category === "authentication_error" || payload.category === "permission_error") {
      return {
        category: status === 403 || payload.category === "permission_error" ? "permission" : "authentication",
        message: "انتهت جلسة الدخول أو لا تملك صلاحية تنفيذ هذا الطلب.",
        retryable: false,
        requestId: payload.requestId,
      };
    }
    if (status === 404 || payload.category === "not_found") {
      const isMissingRoute = payload.code === "ROUTE_NOT_FOUND";
      return {
        category: "not_found",
        message: isMissingRoute
          ? "خدمة السكرتير غير متاحة بهذا المسار حاليًا. حاول تحديث الصفحة."
          : "السجل المطلوب غير موجود أو لم يعد متاحًا. حدّث السجلات وحاول مرة أخرى.",
        retryable: false,
        requestId: payload.requestId,
      };
    }
    if (status === 409 || payload.category === "conflict_error") {
      return {
        category: "conflict",
        message: payload.error ?? "لا يمكن تنفيذ العملية لأن السجل مرتبط ببيانات أخرى.",
        retryable: false,
        requestId: payload.requestId,
      };
    }
    if (status === 408 || status === 504 || payload.category === "timeout") {
      return {
        category: "timeout",
        message: "الطلب أخذ وقتًا أطول من المتوقع. حاول مرة أخرى بعد قليل.",
        retryable: true,
        requestId: payload.requestId,
      };
    }
    if (status === 429 || payload.category === "rate_limit" || payload.category === "provider_rate_limit") {
      return {
        category: "rate_limit",
        message: "السكرتير مشغول حاليًا. انتظر قليلًا ثم حاول مرة أخرى.",
        retryable: true,
        requestId: payload.requestId,
      };
    }
    if (payload.category === "provider_unavailable" || status === 503) {
      return {
        category: "provider",
        message: "خدمة الذكاء الاصطناعي غير متاحة مؤقتًا. حاول مرة أخرى بعد قليل.",
        retryable: true,
        requestId: payload.requestId,
      };
    }
    if (payload.category === "provider_error" || status === 502) {
      return {
        category: "provider",
        message: "حدث خطأ في خدمة الذكاء الاصطناعي. حاول مرة أخرى بعد قليل.",
        retryable: true,
        requestId: payload.requestId,
      };
    }
    if (payload.category === "agent_error") {
      return {
        category: "agent",
        message: "تعذر تنفيذ الطلب بالكامل، ولم يتم تغيير البيانات. جرّب صياغة أقصر أو حاول مرة أخرى.",
        retryable: false,
        requestId: payload.requestId,
      };
    }
    if (status >= 500) {
      return {
        category: "server",
        message: "حدث خطأ داخلي أثناء معالجة الطلب. حاول مرة أخرى.",
        retryable: false,
        requestId: payload.requestId,
      };
    }
  }

  if (name === "TypeError" || name === "NetworkError" || name === "AbortError") {
    return {
      category: "network",
      message: "تعذر الاتصال بخدمة السكرتير. تحقق من الاتصال وحاول مرة أخرى.",
      retryable: true,
    };
  }

  return {
    category: "unknown",
    message: "حدث خطأ غير متوقع أثناء إرسال الرسالة. حاول مرة أخرى.",
    retryable: false,
    requestId: payload.requestId,
  };
}