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

export interface SecretaryChatTransport {
  sendTurn(input: { message: string; conversationId?: string | null }): Promise<TurnResponse>;
  listConversations(params?: ListConversationsParams): Promise<ConversationListResponse>;
  loadConversation(conversationId: string): Promise<ConversationDetail>;
  approveOperation(operationId: string): Promise<ApprovalResponse>;
  rejectOperation(operationId: string): Promise<ApprovalResponse>;
}

export interface SecretaryChatService {
  sendTurn(input: SecretaryChatTurnInput): Promise<TurnResponse>;
  listConversations(params?: ListConversationsParams): Promise<ConversationListResponse>;
  loadConversation(conversationId: string): Promise<ConversationDetail>;
  approveOperation(operationId: string): Promise<ApprovalResponse>;
  rejectOperation(operationId: string): Promise<ApprovalResponse>;
}

const apiTransport: SecretaryChatTransport = {
  sendTurn: ({ message, conversationId }) => createTurn({ message, conversationId: conversationId ?? null }),
  listConversations: (params) => listConversations(params),
  loadConversation: (conversationId) => getConversation(conversationId),
  approveOperation: (operationId) => approveSecretaryOperation(operationId),
  rejectOperation: (operationId) => rejectSecretaryOperation(operationId),
};

class ApiSecretaryChatService implements SecretaryChatService {
  constructor(private readonly transport: SecretaryChatTransport) {}

  sendTurn(input: SecretaryChatTurnInput) {
    // The current HTTP contract accepts message and conversationId. Context,
    // channel, and peer stay at this boundary so an A2A transport can carry
    // them later without changing either chat surface.
    return this.transport.sendTurn({
      message: input.message,
      conversationId: input.conversationId ?? null,
    });
  }

  listConversations(params?: ListConversationsParams) {
    return this.transport.listConversations(params);
  }

  loadConversation(conversationId: string) {
    return this.transport.loadConversation(conversationId);
  }

  approveOperation(operationId: string) {
    return this.transport.approveOperation(operationId);
  }

  rejectOperation(operationId: string) {
    return this.transport.rejectOperation(operationId);
  }
}

export const secretaryChatService: SecretaryChatService = new ApiSecretaryChatService(apiTransport);

export function useSecretaryChatService(conversationId: string | null, conversationSearch = '') {
  const turnMutation = useMutation({
    mutationFn: (input: SecretaryChatTurnInput) => secretaryChatService.sendTurn(input),
  });
  const approveMutation = useMutation({
    mutationFn: (operationId: string) => secretaryChatService.approveOperation(operationId),
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
    staleTime: 20_000,
  });

  return {
    sendTurn: turnMutation.mutateAsync,
    isSending: turnMutation.isPending,
    approveOperation: approveMutation.mutateAsync,
    rejectOperation: rejectMutation.mutateAsync,
    conversationsQuery,
    isApproving: approveMutation.isPending,
    isRejecting: rejectMutation.isPending,
    conversationQuery,
  };
}