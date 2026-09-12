export type ApiErrorCategory =
  | "validation_error"
  | "authentication_error"
  | "permission_error"
  | "not_found"
  | "rate_limit"
  | "timeout"
  | "provider_error"
  | "provider_rate_limit"
  | "provider_unavailable"
  | "agent_error"
  | "response_parse_error"
  | "internal_error";

export type ApiErrorOptions = {
  status: number;
  category: ApiErrorCategory;
  code: string;
  retryable: boolean;
  provider?: string;
  upstreamStatus?: number;
  providerError?: string;
  toolName?: string;
  cause?: unknown;
};

export class SecretaryError extends Error {
  readonly status: number;
  readonly category: ApiErrorCategory;
  readonly code: string;
  readonly retryable: boolean;
  readonly provider?: string;
  readonly upstreamStatus?: number;
  readonly providerError?: string;
  readonly toolName?: string;

  constructor(message: string, options: ApiErrorOptions) {
    super(message, { cause: options.cause });
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "SecretaryError";
    this.status = options.status;
    this.category = options.category;
    this.code = options.code;
    this.retryable = options.retryable;
    this.provider = options.provider;
    this.upstreamStatus = options.upstreamStatus;
    this.providerError = options.providerError;
    this.toolName = options.toolName;
  }
}

export function sanitizeProviderError(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/("(?:api[_-]?key|access[_-]?token|token|secret)"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"')
    .replace(/(?:api[_-]?key|access[_-]?token|token|secret)\s*[:=]\s*[^\s,}]+/gi, "credential=[redacted]")
    .slice(0, 500);
}

export function providerResponseError(
  provider: string,
  upstreamStatus: number,
  providerError: string,
): SecretaryError {
  if (upstreamStatus === 429) {
    return new SecretaryError("The configured provider rate limit was reached.", {
      status: 429,
      category: "provider_rate_limit",
      code: "PROVIDER_RATE_LIMIT",
      retryable: true,
      provider,
      upstreamStatus,
      providerError: sanitizeProviderError(providerError),
    });
  }

  return new SecretaryError(`The ${provider} provider returned an error.`, {
    status: upstreamStatus === 503 ? 503 : 502,
    category: upstreamStatus === 503 ? "provider_unavailable" : "provider_error",
    code: upstreamStatus === 503 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_API_ERROR",
    retryable: upstreamStatus >= 500,
    provider,
    upstreamStatus,
    providerError: sanitizeProviderError(providerError),
  });
}

export function providerTimeoutError(provider: string, cause?: unknown): SecretaryError {
  return new SecretaryError(`The ${provider} provider timed out.`, {
    status: 504,
    category: "timeout",
    code: "PROVIDER_TIMEOUT",
    retryable: true,
    provider,
    cause,
  });
}

export function providerExceptionError(provider: string, cause: unknown): SecretaryError {
  if (cause instanceof SecretaryError) return cause;
  if (cause instanceof Error && cause.name === "AbortError") {
    return providerTimeoutError(provider, cause);
  }
  return new SecretaryError(`The ${provider} provider could not be reached.`, {
    status: 502,
    category: "provider_error",
    code: "PROVIDER_REQUEST_FAILED",
    retryable: true,
    provider,
    providerError: cause instanceof Error ? sanitizeProviderError(cause.message) : "Unknown provider error",
    cause,
  });
}

export function isTransientProviderFailure(error: unknown): error is SecretaryError {
  if (!(error instanceof SecretaryError)) return false;
  if (error.category === "provider_rate_limit" || error.category === "timeout" || error.category === "provider_unavailable") {
    return true;
  }
  return error.category === "provider_error"
    && (error.code === "PROVIDER_REQUEST_FAILED" || (error.upstreamStatus ?? 0) >= 500);
}

export function providerFailoverError(
  primaryProvider: string,
  primaryError: SecretaryError,
  fallbackProvider: string,
  fallbackError: SecretaryError,
): SecretaryError {
  const primaryDetail = `${primaryProvider}:${primaryError.code}${primaryError.upstreamStatus ? `/${primaryError.upstreamStatus}` : ""}`;
  const fallbackDetail = `${fallbackProvider}:${fallbackError.code}${fallbackError.upstreamStatus ? `/${fallbackError.upstreamStatus}` : ""}`;
  return new SecretaryError("All configured LLM providers failed.", {
    status: fallbackError.status,
    category: fallbackError.category,
    code: "PROVIDER_FAILOVER_FAILED",
    retryable: fallbackError.retryable,
    provider: fallbackProvider,
    upstreamStatus: fallbackError.upstreamStatus,
    providerError: sanitizeProviderError(`${primaryDetail}; ${fallbackDetail}`),
    cause: fallbackError,
  });
}

export function agentToolError(toolName: string, cause: unknown): SecretaryError {
  return new SecretaryError("Agent tool execution failed.", {
    status: 500,
    category: "agent_error",
    code: "AGENT_TOOL_EXECUTION_FAILED",
    retryable: false,
    toolName,
    cause,
  });
}

export function classifySecretaryError(error: unknown): SecretaryError {
  if (error instanceof SecretaryError) return error;
  if (error && typeof error === "object" && (error as { name?: unknown }).name === "ZodError") {
    return new SecretaryError("The API response did not match its contract.", {
      status: 500,
      category: "response_parse_error",
      code: "RESPONSE_CONTRACT_INVALID",
      retryable: false,
      cause: error,
    });
  }
  if (error && typeof error === "object" && (
    (error as { name?: unknown }).name === "SyntaxError"
    || (error as { type?: unknown }).type === "entity.parse.failed"
  )) {
    return new SecretaryError("The request body is not valid JSON.", {
      status: 400,
      category: "validation_error",
      code: "INVALID_JSON_BODY",
      retryable: false,
      cause: error,
    });
  }
  return new SecretaryError("An unexpected secretary error occurred.", {
    status: 500,
    category: "internal_error",
    code: "INTERNAL_ERROR",
    retryable: false,
    cause: error,
  });
}

export function errorLogFields(error: SecretaryError): Record<string, unknown> {
  const cause = (error as Error & { cause?: unknown }).cause;
  const causeMessage = cause instanceof Error
    ? sanitizeProviderError(cause.message)
    : typeof cause === "string" ? sanitizeProviderError(cause) : undefined;
  return {
    errorCategory: error.category,
    errorCode: error.code,
    retryable: error.retryable,
    ...(error.provider ? { provider: error.provider } : {}),
    ...(error.upstreamStatus ? { upstreamStatus: error.upstreamStatus } : {}),
    ...(error.providerError ? { providerError: error.providerError } : {}),
    ...(error.toolName ? { toolName: error.toolName } : {}),
    ...(causeMessage ? { cause: causeMessage } : {}),
  };
}