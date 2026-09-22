import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuickActionGuard } from '../services/quick-action-guard';

type ApprovalStatus = 'pending' | 'completed' | 'rejected';

type TurnResult = {
  conversationId: string;
  operationId?: string;
  status?: ApprovalStatus;
};

type FakeTransport = {
  turns: Array<{ message: string; idempotencyKey: string }>;
  approvals: Array<{ operationId: string; status: 'completed' | 'rejected' }>;
  sendTurn(input: { message: string; idempotencyKey: string }): Promise<TurnResult>;
  approveOperation(operationId: string): Promise<TurnResult>;
  rejectOperation(operationId: string): Promise<TurnResult>;
};

function createFakeTransport(responses: Array<TurnResult | Error>): FakeTransport {
  const pendingResponses = [...responses];
  const transport: FakeTransport = {
    turns: [],
    approvals: [],
    async sendTurn(input) {
      transport.turns.push(input);
      const response = pendingResponses.shift() ?? new Error('missing fixture response');
      if (response instanceof Error) throw response;
      return response;
    },
    async approveOperation(operationId) {
      transport.approvals.push({ operationId, status: 'completed' });
      return { conversationId: 'conversation-quick', operationId, status: 'completed' };
    },
    async rejectOperation(operationId) {
      transport.approvals.push({ operationId, status: 'rejected' });
      return { conversationId: 'conversation-quick', operationId, status: 'rejected' };
    },
  };
  return transport;
}

/**
 * This is the mobile action contract exercised by QuickRoute. It intentionally
 * uses the same synchronous guard as the component while keeping the transport
 * fixture framework-free and deterministic.
 */
function createQuickFixture(
  transport: FakeTransport,
  storage = new Map<string, string>(),
) {
  const guard = createQuickActionGuard();
  let retryKey: { message: string; key: string } | null = null;
  let nextKey = 0;

  async function send(message: string) {
    const normalized = message.trim();
    if (!normalized || !guard.tryBeginTurn()) return null;
    const idempotencyKey = retryKey?.message === normalized
      ? retryKey.key
      : `mobile-test-turn-${++nextKey}`;
    retryKey = { message: normalized, key: idempotencyKey };
    try {
      const response = await transport.sendTurn({ message: normalized, idempotencyKey });
      retryKey = null;
      storage.set('conversation', response.conversationId);
      return response;
    } catch (error) {
      storage.set('last-error', normalized);
      throw error;
    } finally {
      guard.endTurn();
    }
  }

  async function decide(
    operationId: string,
    status: 'completed' | 'rejected',
  ) {
    if (!guard.tryBeginApproval(operationId)) return null;
    try {
      const response = status === 'completed'
        ? await transport.approveOperation(operationId)
        : await transport.rejectOperation(operationId);
      storage.set(`approval:${operationId}`, response.status ?? status);
      return response;
    } finally {
      guard.endApproval(operationId);
    }
  }

  return {
    send,
    approve: (operationId: string) => decide(operationId, 'completed'),
    reject: (operationId: string) => decide(operationId, 'rejected'),
    storage,
  };
}

test('Quick suggestion and typed request each produce one turn, and an approval executes once', async () => {
  const transport = createFakeTransport([
    { conversationId: 'conversation-quick', operationId: 'operation-approve', status: 'pending' },
    { conversationId: 'conversation-quick', operationId: 'operation-reject', status: 'pending' },
  ]);
  const quick = createQuickFixture(transport);

  const [suggestion, duplicateSuggestion] = await Promise.all([
    quick.send('What do I have today?'),
    quick.send('What do I have today?'),
  ]);
  assert.equal(suggestion?.conversationId, 'conversation-quick');
  assert.equal(duplicateSuggestion, null);
  assert.equal(transport.turns.length, 1);

  const typed = await quick.send('Remind me tomorrow to call Mohamed');
  assert.equal(typed?.operationId, 'operation-reject');
  assert.equal(transport.turns.length, 2);

  await Promise.all([
    quick.approve('operation-approve'),
    quick.approve('operation-approve'),
  ]);
  assert.deepEqual(transport.approvals, [
    { operationId: 'operation-approve', status: 'completed' },
  ]);
  assert.equal(quick.storage.get('approval:operation-approve'), 'completed');
});

test('Quick rejection is one mutation even when the approval card is tapped twice', async () => {
  const transport = createFakeTransport([
    { conversationId: 'conversation-quick', operationId: 'operation-reject', status: 'pending' },
  ]);
  const quick = createQuickFixture(transport);
  const response = await quick.send('Record a lunch expense');
  assert.equal(response?.operationId, 'operation-reject');

  await Promise.all([
    quick.reject('operation-reject'),
    quick.reject('operation-reject'),
  ]);
  assert.deepEqual(transport.approvals, [
    { operationId: 'operation-reject', status: 'rejected' },
  ]);
  assert.equal(quick.storage.get('approval:operation-reject'), 'rejected');
});

test('a failed Quick request can be retried once with the same idempotency key', async () => {
  const transport = createFakeTransport([
    new Error('fixture network failure'),
    { conversationId: 'conversation-retry' },
  ]);
  const quick = createQuickFixture(transport);

  await assert.rejects(quick.send('How much does Mohamed owe me?'), /fixture network failure/);
  assert.equal(transport.turns.length, 1);
  assert.equal(quick.storage.get('last-error'), 'How much does Mohamed owe me?');

  const retry = await quick.send('How much does Mohamed owe me?');
  assert.equal(retry?.conversationId, 'conversation-retry');
  assert.equal(transport.turns.length, 2);
  assert.equal(transport.turns[0]?.idempotencyKey, transport.turns[1]?.idempotencyKey);
});

test('each Quick test fixture has isolated stored conversation and approval state', async () => {
  const first = createQuickFixture(
    createFakeTransport([{ conversationId: 'conversation-first' }]),
  );
  const second = createQuickFixture(
    createFakeTransport([{ conversationId: 'conversation-second' }]),
  );

  await first.send('What do I have today?');
  await second.send('What do I have today?');

  assert.equal(first.storage.get('conversation'), 'conversation-first');
  assert.equal(second.storage.get('conversation'), 'conversation-second');
  assert.notEqual(first.storage.get('conversation'), second.storage.get('conversation'));
  assert.equal(first.storage.has('approval:operation-approve'), false);
  assert.equal(second.storage.has('approval:operation-approve'), false);
});