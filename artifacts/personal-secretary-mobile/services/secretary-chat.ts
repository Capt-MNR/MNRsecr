import {
  approveSecretaryOperation,
  createTurn,
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

const apiTransport: SecretaryChatTransport = {
  sendTurn: (input) => createTurn({
    message: input.message,
    conversationId: input.conversationId ?? null,
    channel: input.channel,
    context: input.context ?? null,
    peer: input.peer ?? null,
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