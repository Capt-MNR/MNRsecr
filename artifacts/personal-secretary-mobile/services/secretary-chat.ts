import {
  approveSecretaryOperation,
  createTurn,
  customFetch,
  ApiError,
  FetchTimeoutError,
  ResponseParseError,
  getConversation,
  listConversations,
  rejectSecretaryOperation,
} from '@workspace/api-client-react';
import type {
  ApprovalResponse,
  ConversationListResponse,
  ConversationDetail,
  ListConversationsParams,
  TurnResponse,
} from '@workspace/api-client-react';
import type { ActionResult, FinalResponse } from '@workspace/api-client-react';
import { useMutation, useQuery } from '@tanstack/react-query';

export type SecretaryChatChannel = 'main' | 'quick' | 'record';

export type SecretaryChatContext = {
  recordType: string;
  recordId: string;
  title: string;
  sourceConversationId?: string | null;
  sourceTurnId?: string | null;
  sourceOperationId?: string | null;
};

export type SecretaryChatPeer = {
  agentId: string;
  displayName?: string;
  protocol?: string;
  capabilities?: string[];
};

export type SecretaryChatTurnInput = {
  message: string;
  conversationId?: string | null;
  channel: SecretaryChatChannel;
  context?: SecretaryChatContext | null;
  peer?: SecretaryChatPeer | null;
  inputId?: string | null;
  idempotencyKey?: string | null;
};

export type SecretaryApprovalArgs = Record<string, unknown>;

export interface SecretaryChatTransport {
  sendTurn(input: SecretaryChatTurnInput): Promise<TurnResponse>;
  listConversations(params?: ListConversationsParams): Promise<ConversationListResponse>;
  loadConversation(conversationId: string): Promise<ConversationDetail>;
  approveOperation(operationId: string, args?: SecretaryApprovalArgs): Promise<ApprovalResponse>;
  rejectOperation(operationId: string): Promise<ApprovalResponse>;
}

export interface SecretaryChatService {
  sendTurn(input: SecretaryChatTurnInput): Promise<TurnResponse>;
  listConversations(params?: ListConversationsParams): Promise<ConversationListResponse>;
  loadConversation(conversationId: string): Promise<ConversationDetail>;
  approveOperation(operationId: string, args?: SecretaryApprovalArgs): Promise<ApprovalResponse>;
  rejectOperation(operationId: string): Promise<ApprovalResponse>;
}

export type SecretaryChatErrorCategory =
  | 'validation_error'
  | 'authentication_error'
  | 'permission_error'
  | 'conflict_error'
  | 'not_found'
  | 'rate_limit'
  | 'timeout'
  | 'provider_error'
  | 'provider_rate_limit'
  | 'provider_unavailable'
  | 'agent_error'
  | 'response_parse_error'
  | 'internal_error';

export class SecretaryChatTransportError extends Error {
  readonly name = 'SecretaryChatTransportError';
  readonly status: number;
  readonly code: string;
  readonly category: SecretaryChatErrorCategory;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly provider?: string;
  readonly cause?: unknown;

  constructor(
    message: string,
    details: {
      status?: number;
      code?: string;
      category?: SecretaryChatErrorCategory;
      requestId?: string;
      retryable?: boolean;
      provider?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.status = details.status ?? 502;
    this.code = details.code ?? 'SECRETARY_TRANSPORT_FAILED';
    this.category = details.category ?? 'provider_unavailable';
    this.requestId = details.requestId;
    this.retryable = details.retryable ?? this.category === 'provider_unavailable';
    this.provider = details.provider;
    this.cause = details.cause;
  }
}

export type SecretaryA2ATurnMetadata = {
  conversationId: string | null;
  channel: SecretaryChatChannel;
  context: SecretaryChatContext | null;
  peer: SecretaryChatPeer | null;
  inputId: string | null;
  idempotencyKey: string | null;
};

export type SecretaryA2AMessage = {
  messageId: string;
  role: 'user';
  parts: Array<{ kind: 'text'; text: string }>;
  metadata: {
    secretary: SecretaryA2ATurnMetadata;
  };
};

export type SecretaryA2ARequest = {
  jsonrpc: '2.0';
  id: string;
  method:
    | 'message/send'
    | 'secretary/conversations/list'
    | 'secretary/conversations/get'
    | 'secretary/approvals/approve'
    | 'secretary/approvals/reject';
  params: Record<string, unknown>;
};

type SecretaryChatRequest = typeof customFetch;

export type A2ASecretaryChatTransportOptions = {
  /** The remote peer's A2A message/send endpoint. */
  endpoint: string;
  /** Headers supplied by the caller, including peer authentication when needed. */
  headers?: HeadersInit;
  /** Abort slow peer calls while retaining the normal retryable error contract. */
  timeoutMs?: number;
  /** Injectable request function for tests or an application-specific HTTP client. */
  request?: SecretaryChatRequest;
};

const A2A_METHODS = {
  sendTurn: 'message/send',
  listConversations: 'secretary/conversations/list',
  loadConversation: 'secretary/conversations/get',
  approveOperation: 'secretary/approvals/approve',
  rejectOperation: 'secretary/approvals/reject',
} as const;

const SECRETARY_ERROR_CATEGORIES = new Set<SecretaryChatErrorCategory>([
  'validation_error',
  'authentication_error',
  'permission_error',
  'conflict_error',
  'not_found',
  'rate_limit',
  'timeout',
  'provider_error',
  'provider_rate_limit',
  'provider_unavailable',
  'agent_error',
  'response_parse_error',
  'internal_error',
]);

const APPROVAL_STATUSES = new Set<ApprovalResponse['status']>([
  'pending',
  'executing',
  'completed',
  'rejected',
  'expired',
  'failed',
]);

let nextA2ARequestId = 0;

function createA2ARequestId(): string {
  nextA2ARequestId += 1;
  return `secretary-a2a-${nextA2ARequestId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function errorCategory(value: unknown): SecretaryChatErrorCategory | undefined {
  return typeof value === 'string' && SECRETARY_ERROR_CATEGORIES.has(value as SecretaryChatErrorCategory)
    ? value as SecretaryChatErrorCategory
    : undefined;
}

function actionValue(value: unknown): ActionResult | undefined {
  return isRecord(value) ? value as ActionResult : undefined;
}

function finalResponseValue(value: unknown): FinalResponse | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.kind !== 'string' || typeof value.message !== 'string') return undefined;
  return value as unknown as FinalResponse;
}

function responsePayload(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new SecretaryChatTransportError('The external secretary returned an invalid response.', {
      category: 'response_parse_error',
      code: 'EXTERNAL_RESPONSE_INVALID',
      retryable: false,
    });
  }
  if (isRecord(value.error)) {
    const remoteError = value.error;
    const details = isRecord(remoteError.data) ? remoteError.data : remoteError;
    throw new SecretaryChatTransportError(
      stringValue(remoteError.message) ?? 'The external secretary rejected the request.',
      {
        status: typeof details.status === 'number' ? details.status : 502,
        code: stringValue(details.code) ?? 'EXTERNAL_PEER_ERROR',
        category: errorCategory(details.category),
        requestId: stringValue(details.requestId),
        retryable: typeof details.retryable === 'boolean' ? details.retryable : undefined,
        provider: stringValue(details.provider),
      },
    );
  }
  const result = value.result;
  if (result === undefined) return value;
  if (!isRecord(result)) {
    throw new SecretaryChatTransportError('The external secretary returned an invalid result.', {
      category: 'response_parse_error',
      code: 'EXTERNAL_RESULT_INVALID',
      retryable: false,
    });
  }
  return result;
}

function textFromA2A(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.assistantMessage === 'string') return value.assistantMessage;
  const history = Array.isArray(value.history) ? value.history : [];
  const historicalMessage = [...history]
    .reverse()
    .find((entry) => isRecord(entry) && (entry.role === 'agent' || entry.role === 'assistant'));
  const message = isRecord(value.message)
    ? value.message
    : isRecord(value.artifact)
      ? value.artifact
      : isRecord(historicalMessage)
        ? historicalMessage
        : null;
  if (!message || !Array.isArray(message.parts)) return undefined;
  const textPart = message.parts.find((part) => isRecord(part) && typeof part.text === 'string');
  return isRecord(textPart) ? stringValue(textPart.text) : undefined;
}

function normalizeTurnResponse(payload: Record<string, unknown>): TurnResponse {
  const source = isRecord(payload.turn) ? payload.turn : payload;
  const metadata = isRecord(source.metadata) ? source.metadata : {};
  const secretaryMetadata = isRecord(metadata.secretary) ? metadata.secretary : {};
  const conversationId = stringValue(source.conversationId)
    ?? stringValue(metadata.conversationId)
    ?? stringValue(source.contextId)
    ?? (isRecord(source.task) ? stringValue(source.task.contextId) : undefined);
  const turnId = stringValue(source.turnId)
    ?? stringValue(metadata.turnId)
    ?? stringValue(source.messageId)
    ?? stringValue(source.id)
    ?? (isRecord(source.message) ? stringValue(source.message.messageId) : undefined);
  const assistantMessage = textFromA2A(source);
  if (!conversationId || !turnId || !assistantMessage) {
    throw new SecretaryChatTransportError('The external secretary returned an incomplete turn.', {
      category: 'response_parse_error',
      code: 'EXTERNAL_TURN_INVALID',
      retryable: false,
    });
  }
  return {
    conversationId,
    turnId,
    assistantMessage,
    ...(actionValue(source.action ?? secretaryMetadata.action)
      ? { action: actionValue(source.action ?? secretaryMetadata.action) }
      : {}),
    ...(finalResponseValue(source.response ?? secretaryMetadata.response)
      ? { response: finalResponseValue(source.response ?? secretaryMetadata.response) }
      : {}),
    provider: stringValue(source.provider) ?? 'external',
    model: stringValue(source.model) ?? 'a2a',
  };
}

function normalizeApprovalResponse(
  payload: Record<string, unknown>,
  operationId: string,
): ApprovalResponse {
  const source = isRecord(payload.approval) ? payload.approval : payload;
  const conversationId = stringValue(source.conversationId);
  const turnId = stringValue(source.turnId);
  const assistantMessage = stringValue(source.assistantMessage);
  const statusValue = stringValue(source.status);
  const status = statusValue && APPROVAL_STATUSES.has(statusValue as ApprovalResponse['status'])
    ? statusValue as ApprovalResponse['status']
    : undefined;
  if (!conversationId || !turnId || !assistantMessage || !status) {
    throw new SecretaryChatTransportError('The external secretary returned an incomplete approval.', {
      category: 'response_parse_error',
      code: 'EXTERNAL_APPROVAL_INVALID',
      retryable: false,
    });
  }
  return {
    operationId: stringValue(source.operationId) ?? operationId,
    status,
    conversationId,
    turnId,
    assistantMessage,
    ...(actionValue(source.action) ? { action: actionValue(source.action) } : {}),
    ...(finalResponseValue(source.response) ? { response: finalResponseValue(source.response) } : {}),
    provider: stringValue(source.provider) ?? 'external',
    model: stringValue(source.model) ?? 'a2a',
  };
}

function classifyTransportError(error: unknown): SecretaryChatTransportError {
  if (error instanceof SecretaryChatTransportError) return error;
  if (error instanceof ApiError) {
    const data = isRecord(error.data) ? error.data : {};
    const category = errorCategory(data.category);
    return new SecretaryChatTransportError(
      stringValue(data.error) ?? error.message,
      {
        status: error.status,
        code: stringValue(data.code) ?? 'EXTERNAL_HTTP_ERROR',
        category,
        requestId: stringValue(data.requestId),
        retryable: typeof data.retryable === 'boolean' ? data.retryable : undefined,
        provider: stringValue(data.provider),
        cause: error,
      },
    );
  }
  if (error instanceof FetchTimeoutError) {
    return new SecretaryChatTransportError(error.message, {
      status: 504,
      code: 'EXTERNAL_PEER_TIMEOUT',
      category: 'timeout',
      retryable: true,
      cause: error,
    });
  }
  if (error instanceof ResponseParseError) {
    return new SecretaryChatTransportError(error.message, {
      status: error.status,
      code: 'EXTERNAL_RESPONSE_PARSE_FAILED',
      category: 'response_parse_error',
      retryable: false,
      cause: error,
    });
  }
  return new SecretaryChatTransportError(
    error instanceof Error ? error.message : 'The external secretary could not be reached.',
    {
      status: 503,
      code: 'EXTERNAL_PEER_UNAVAILABLE',
      category: 'provider_unavailable',
      retryable: true,
      cause: error,
    },
  );
}

export function isSecretaryAuthenticationFailure(error: unknown): boolean {
  const classified = classifyTransportError(error);
  return classified.status === 401 || classified.category === 'authentication_error';
}

/**
 * A transport for a secretary peer that speaks A2A JSON-RPC.
 *
 * The local API transport remains the default used by Main, Quick, and record
 * chat. This adapter is opt-in and keeps peer protocol details outside those
 * surfaces.
 */
export class A2ASecretaryChatTransport implements SecretaryChatTransport {
  private readonly endpoint: string;
  private readonly headers: HeadersInit | undefined;
  private readonly timeoutMs: number | undefined;
  private readonly request: SecretaryChatRequest;

  constructor(options: A2ASecretaryChatTransportOptions) {
    if (!options.endpoint.trim()) {
      throw new Error('An A2A peer endpoint is required.');
    }
    this.endpoint = options.endpoint;
    this.headers = options.headers;
    this.timeoutMs = options.timeoutMs;
    this.request = options.request ?? customFetch;
  }

  private async call(
    method: SecretaryA2ARequest['method'],
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const body: SecretaryA2ARequest = {
      jsonrpc: '2.0',
      id: createA2ARequestId(),
      method,
      params,
    };
    try {
      const response = await this.request<Record<string, unknown>>(this.endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(body),
        ...(this.timeoutMs ? { timeoutMs: this.timeoutMs } : {}),
        responseType: 'json',
      });
      return responsePayload(response);
    } catch (error) {
      throw classifyTransportError(error);
    }
  }

  async sendTurn(input: SecretaryChatTurnInput): Promise<TurnResponse> {
    const message: SecretaryA2AMessage = {
      messageId: input.inputId ?? input.idempotencyKey ?? createA2ARequestId(),
      role: 'user',
      parts: [{ kind: 'text', text: input.message }],
      metadata: {
        secretary: {
          conversationId: input.conversationId ?? null,
          channel: input.channel,
          context: input.context ?? null,
          peer: input.peer ?? null,
          inputId: input.inputId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      },
    };
    const response = await this.call(A2A_METHODS.sendTurn, {
      message,
      metadata: message.metadata,
    });
    return normalizeTurnResponse(response);
  }

  async listConversations(params?: ListConversationsParams): Promise<ConversationListResponse> {
    const response = await this.call(A2A_METHODS.listConversations, {
      ...(params?.search ? { search: params.search } : {}),
    });
    if (!Array.isArray(response.conversations)) {
      throw new SecretaryChatTransportError('The external secretary returned invalid conversations.', {
        category: 'response_parse_error',
        code: 'EXTERNAL_CONVERSATIONS_INVALID',
        retryable: false,
      });
    }
    return { conversations: response.conversations as ConversationListResponse['conversations'] };
  }

  async loadConversation(conversationId: string): Promise<ConversationDetail> {
    const response = await this.call(A2A_METHODS.loadConversation, { conversationId });
    return response as unknown as ConversationDetail;
  }

  async approveOperation(operationId: string, args?: SecretaryApprovalArgs): Promise<ApprovalResponse> {
    const response = await this.call(A2A_METHODS.approveOperation, {
      operationId,
      ...(args ? { args } : {}),
    });
    return normalizeApprovalResponse(response, operationId);
  }

  async rejectOperation(operationId: string): Promise<ApprovalResponse> {
    const response = await this.call(A2A_METHODS.rejectOperation, { operationId });
    return normalizeApprovalResponse(response, operationId);
  }
}

export { A2ASecretaryChatTransport as ExternalSecretaryChatTransport };

const apiTransport: SecretaryChatTransport = {
  sendTurn: (input) => createTurn({
    message: input.message,
    conversationId: input.conversationId ?? null,
    channel: input.channel,
    context: input.context ?? null,
    peer: input.peer ?? null,
    inputId: input.inputId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  }),
  listConversations: (params) => listConversations(params),
  loadConversation: (conversationId) => getConversation(conversationId),
  approveOperation: (operationId, args) => approveSecretaryOperation(
    operationId,
    args ? { args } : undefined,
  ),
  rejectOperation: (operationId) => rejectSecretaryOperation(operationId),
};

class ApiSecretaryChatService implements SecretaryChatService {
  constructor(private readonly transport: SecretaryChatTransport) {}

  sendTurn(input: SecretaryChatTurnInput) {
    return this.transport.sendTurn(input);
  }

  listConversations(params?: ListConversationsParams) {
    return this.transport.listConversations(params);
  }

  loadConversation(conversationId: string) {
    return this.transport.loadConversation(conversationId);
  }

  approveOperation(operationId: string, args?: SecretaryApprovalArgs) {
    return this.transport.approveOperation(operationId, args);
  }

  rejectOperation(operationId: string) {
    return this.transport.rejectOperation(operationId);
  }
}

export function createSecretaryChatService(
  transport: SecretaryChatTransport,
): SecretaryChatService {
  return new ApiSecretaryChatService(transport);
}

export const secretaryChatService: SecretaryChatService = new ApiSecretaryChatService(apiTransport);

export function useSecretaryChatService(
  conversationId: string | null,
  conversationSearch = '',
  conversationsEnabled = true,
) {
  const turnMutation = useMutation({
    mutationFn: (input: SecretaryChatTurnInput) => secretaryChatService.sendTurn(input),
  });
  const approveMutation = useMutation({
    mutationFn: ({ operationId, args }: { operationId: string; args?: SecretaryApprovalArgs }) =>
      secretaryChatService.approveOperation(operationId, args),
  });
  const rejectMutation = useMutation({
    mutationFn: (operationId: string) => secretaryChatService.rejectOperation(operationId),
  });
  const conversationQuery = useQuery({
    queryKey: ['secretary-chat-conversation', conversationId],
    queryFn: () => secretaryChatService.loadConversation(conversationId ?? ''),
    enabled: Boolean(conversationId),
    staleTime: 20_000,
  });
  const conversationsQuery = useQuery({
    queryKey: ['secretary-chat-conversations', conversationSearch],
    queryFn: () => secretaryChatService.listConversations(
      conversationSearch ? { search: conversationSearch } : undefined,
    ),
    enabled: conversationsEnabled,
    staleTime: 20_000,
  });

  return {
    sendTurn: turnMutation.mutateAsync,
    isSending: turnMutation.isPending,
    approveOperation: (operationId: string, args?: SecretaryApprovalArgs) =>
      approveMutation.mutateAsync({ operationId, args }),
    rejectOperation: rejectMutation.mutateAsync,
    conversationsQuery,
    isApproving: approveMutation.isPending,
    isRejecting: rejectMutation.isPending,
    conversationQuery,
  };
}