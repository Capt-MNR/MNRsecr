import assert from 'node:assert/strict';
import test from 'node:test';
import {
  A2ASecretaryChatTransport,
  SecretaryChatTransportError,
  type A2ASecretaryChatTransportOptions,
  type SecretaryA2ARequest,
} from '../services/secretary-chat';
import type { CustomFetchOptions } from '@workspace/api-client-react';

type PeerRequest = NonNullable<A2ASecretaryChatTransportOptions['request']>;

test('A2A transport preserves peer, context, input, and idempotency metadata', async () => {
  const requests: SecretaryA2ARequest[] = [];
  const requestPeer = (async <T>(_url: RequestInfo | URL, options?: CustomFetchOptions) => {
    assert.ok(options);
    const body = JSON.parse(String(options.body)) as SecretaryA2ARequest;
    requests.push(body);
    return {
      jsonrpc: '2.0',
      id: body.id,
      result: {
        conversationId: 'peer-conversation',
        turnId: 'peer-turn',
        assistantMessage: 'راجعت الطلب.',
        provider: 'peer-provider',
        model: 'peer-model',
      },
    } as T;
  }) as PeerRequest;
  const transport = new A2ASecretaryChatTransport({
    endpoint: 'https://peer.example/a2a',
    headers: { Authorization: 'Bearer peer-token' },
    request: requestPeer,
  });

  const response = await transport.sendTurn({
    message: 'راجع هذا المصروف',
    conversationId: 'conversation-1',
    channel: 'record',
    context: {
      recordType: 'expense',
      recordId: 'expense-1',
      title: 'غداء',
      sourceConversationId: 'source-conversation',
      sourceTurnId: 'source-turn',
      sourceOperationId: 'source-operation',
    },
    peer: {
      agentId: 'remote-secretary',
      displayName: 'Remote Secretary',
      protocol: 'a2a',
      capabilities: ['read', 'approve'],
    },
    inputId: 'receipt-1',
    idempotencyKey: 'turn-1',
  });

  assert.equal(response.turnId, 'peer-turn');
  const request = requests[0];
  assert.ok(request);
  assert.equal(request.method, 'message/send');
  assert.deepEqual(request.params.metadata, {
    secretary: {
      conversationId: 'conversation-1',
      channel: 'record',
      context: {
        recordType: 'expense',
        recordId: 'expense-1',
        title: 'غداء',
        sourceConversationId: 'source-conversation',
        sourceTurnId: 'source-turn',
        sourceOperationId: 'source-operation',
      },
      peer: {
        agentId: 'remote-secretary',
        displayName: 'Remote Secretary',
        protocol: 'a2a',
        capabilities: ['read', 'approve'],
      },
      inputId: 'receipt-1',
      idempotencyKey: 'turn-1',
    },
  });
});

test('A2A transport keeps approval mutations explicit and returns peer action data', async () => {
  const requests: SecretaryA2ARequest[] = [];
  const requestPeer = (async <T>(_url: RequestInfo | URL, options?: CustomFetchOptions) => {
    assert.ok(options);
    const body = JSON.parse(String(options.body)) as SecretaryA2ARequest;
    requests.push(body);
    return {
      result: {
        operationId: 'operation-1',
        status: 'completed',
        conversationId: 'conversation-1',
        turnId: 'approval-turn',
        assistantMessage: 'تم التنفيذ.',
        action: { type: 'expense_recorded', expenseId: 'expense-1' },
        provider: 'peer-provider',
        model: 'peer-model',
      },
    } as T;
  }) as PeerRequest;
  const transport = new A2ASecretaryChatTransport({
    endpoint: 'https://peer.example/a2a',
    request: requestPeer,
  });

  const response = await transport.approveOperation('operation-1', {
    amountMinor: 12500,
  });
  assert.equal(response.status, 'completed');
  assert.deepEqual(requests[0], {
    jsonrpc: '2.0',
    id: requests[0]?.id,
    method: 'secretary/approvals/approve',
    params: {
      operationId: 'operation-1',
      args: { amountMinor: 12500 },
    },
  });
});

test('A2A transport normalizes a standard task history without losing turn identity', async () => {
  const requestPeer = (async <T>() => ({
    result: {
      id: 'task-1',
      contextId: 'peer-conversation',
      history: [
        { role: 'user', parts: [{ kind: 'text', text: 'راجع هذا' }] },
        { role: 'agent', parts: [{ kind: 'text', text: 'تمت المراجعة.' }] },
      ],
      metadata: {
        secretary: {
          action: { type: 'answer' },
        },
      },
    },
  } as T)) as PeerRequest;
  const transport = new A2ASecretaryChatTransport({
    endpoint: 'https://peer.example/a2a',
    request: requestPeer,
  });

  const response = await transport.sendTurn({
    message: 'راجع هذا',
    channel: 'main',
  });
  assert.equal(response.conversationId, 'peer-conversation');
  assert.equal(response.turnId, 'task-1');
  assert.equal(response.assistantMessage, 'تمت المراجعة.');
  assert.deepEqual(response.action, { type: 'answer' });
});

test('A2A transport maps remote error envelopes to the secretary error contract', async () => {
  const requestPeer = (async <T>() => ({
    jsonrpc: '2.0',
    id: 'request-1',
    error: {
      code: -32001,
      message: 'Peer is busy',
      data: {
        code: 'PEER_BUSY',
        category: 'provider_unavailable',
        requestId: 'peer-request-1',
        retryable: true,
      },
    },
  } as T)) as PeerRequest;
  const transport = new A2ASecretaryChatTransport({
    endpoint: 'https://peer.example/a2a',
    request: requestPeer,
  });

  await assert.rejects(
    transport.sendTurn({
      message: 'اختبار',
      channel: 'quick',
    }),
    (error: unknown) => {
      assert.ok(error instanceof SecretaryChatTransportError);
      assert.equal(error.code, 'PEER_BUSY');
      assert.equal(error.category, 'provider_unavailable');
      assert.equal(error.requestId, 'peer-request-1');
      assert.equal(error.retryable, true);
      return true;
    },
  );
});