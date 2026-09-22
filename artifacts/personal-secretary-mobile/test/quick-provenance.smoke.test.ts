import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuickActionGuard } from '../services/quick-action-guard';
import {
  addOrigin,
  recordLinkFromAction,
  secretaryContextFromRecord,
  type MobileRecordRow,
} from '../features/quick/quick-provenance';

type QuickAction = Record<string, unknown>;

type QuickTurnResponse = {
  conversationId: string;
  turnId: string;
  assistantMessage: string;
  action?: QuickAction;
};

type QuickApprovalResponse = QuickTurnResponse & {
  operationId: string;
  status: 'completed';
};

type QuickTurnInput = {
  message: string;
  channel: 'quick';
  conversationId: string | null;
  idempotencyKey: string;
};

type QuickTransport = {
  tenantId: string;
  turns: QuickTurnInput[];
  approvals: string[];
  sendTurn(input: QuickTurnInput): Promise<QuickTurnResponse>;
  approveOperation(operationId: string): Promise<QuickApprovalResponse>;
  loadConversation(conversationId: string): Promise<{
    conversationId: string;
    recentTurns: Array<Record<string, unknown>>;
  }>;
};

function createIsolatedTransport(): QuickTransport {
  const tenantId = `quick-provenance-${process.pid}-${Date.now()}`;
  const conversationId = `${tenantId}-conversation`;
  const operationId = `${tenantId}-operation`;
  const expenseId = `${tenantId}-expense`;
  const turns: QuickTurnInput[] = [];
  const approvals: string[] = [];
  const recentTurns: Array<Record<string, unknown>> = [];
  let initialResponse: QuickTurnResponse | null = null;

  const transport: QuickTransport = {
    tenantId,
    turns,
    approvals,
    async sendTurn(input) {
      turns.push(input);
      if (initialResponse) return initialResponse;

      initialResponse = {
        conversationId,
        turnId: `${tenantId}-turn`,
        assistantMessage: 'راجِع تسجيل المصروف ثم وافق.',
        action: {
          type: 'approval_required',
          operationId,
          status: 'pending',
          toolName: 'record_expense',
          display: { title: 'تسجيل مصروف', details: ['القيمة: 125 EGP'] },
        },
      };
      recentTurns.push({
        turnId: initialResponse.turnId,
        userMessage: input.message,
        assistantMessage: initialResponse.assistantMessage,
        action: initialResponse.action,
      });
      return initialResponse;
    },
    async approveOperation(requestedOperationId) {
      assert.equal(requestedOperationId, operationId);
      approvals.push(requestedOperationId);
      const response: QuickApprovalResponse = {
        conversationId,
        turnId: `${tenantId}-approval-turn`,
        operationId,
        status: 'completed',
        assistantMessage: 'تمام، سجلت المصروف بنجاح.',
        action: {
          type: 'expense_recorded',
          operationId,
          expenseId,
          description: 'غداء',
          amountMinor: 12500,
          currency: 'EGP',
        },
      };
      recentTurns.push({
        turnId: response.turnId,
        userMessage: 'موافقة على العملية',
        assistantMessage: response.assistantMessage,
        action: response.action,
      });
      return response;
    },
    async loadConversation(requestedConversationId) {
      assert.equal(requestedConversationId, conversationId);
      return { conversationId, recentTurns };
    },
  };

  return transport;
}

function createQuickFixture(transport: QuickTransport) {
  const guard = createQuickActionGuard();
  let conversationId: string | null = null;
  let retryKey: { message: string; key: string } | null = null;
  let nextKey = 0;

  async function send(message: string) {
    const normalized = message.trim();
    if (!normalized || !guard.tryBeginTurn()) return null;
    const idempotencyKey = retryKey?.message === normalized
      ? retryKey.key
      : `quick-provenance-turn-${++nextKey}`;
    retryKey = { message: normalized, key: idempotencyKey };
    try {
      const response = await transport.sendTurn({
        message: normalized,
        channel: 'quick',
        conversationId,
        idempotencyKey,
      });
      retryKey = null;
      conversationId = response.conversationId;
      return response;
    } finally {
      guard.endTurn();
    }
  }

  async function approve(operationId: string) {
    if (!guard.tryBeginApproval(operationId)) return null;
    try {
      return await transport.approveOperation(operationId);
    } finally {
      guard.endApproval(operationId);
    }
  }

  return { send, approve };
}

test('Quick record provenance opens details and restores the original conversation after approval', async () => {
  const transport = createIsolatedTransport();
  const quick = createQuickFixture(transport);

  const [pending, duplicatePending] = await Promise.all([
    quick.send('سجلت 125 جنيه غداء'),
    quick.send('سجلت 125 جنيه غداء'),
  ]);
  assert.equal(pending?.action?.type, 'approval_required');
  assert.equal(duplicatePending, null);
  assert.equal(transport.turns.length, 1);
  assert.equal(transport.turns[0]?.channel, 'quick');
  assert.equal(transport.turns[0]?.conversationId, null);

  const operationId = pending?.action?.operationId;
  assert.equal(typeof operationId, 'string');

  const [approved, duplicateApproval] = await Promise.all([
    quick.approve(operationId as string),
    quick.approve(operationId as string),
  ]);
  assert.equal(duplicateApproval, null);
  assert.deepEqual(transport.approvals, [operationId]);
  assert.equal(approved?.action?.operationId, operationId);
  assert.equal(approved?.conversationId, `${transport.tenantId}-conversation`);

  const completedRecord = recordLinkFromAction(approved?.action);
  assert.ok(completedRecord, 'the completed Quick action should expose an open-details record');
  assert.equal(completedRecord.id, `${transport.tenantId}-expense`);

  const linkedRecord = addOrigin(
    completedRecord,
    approved?.conversationId ?? '',
    approved?.action?.operationId as string,
    approved?.turnId,
  );
  assert.deepEqual(linkedRecord.origin, {
    conversationId: approved?.conversationId,
    turnId: approved?.turnId,
    operationId,
  });

  const quickDetail = await transport.loadConversation(linkedRecord.origin?.conversationId ?? '');
  assert.ok(
    quickDetail.recentTurns.some((turn) => turn.action === approved?.action),
    'Quick history should retain the completed record action',
  );

  let openedRecord: MobileRecordRow = linkedRecord;
  const openRecord = (record: MobileRecordRow) => {
    openedRecord = record;
  };
  openRecord(linkedRecord);
  assert.equal(openedRecord.origin?.operationId, operationId);

  const recordContext = secretaryContextFromRecord(openedRecord);
  let restoredConversationId: string | null = null;
  const openOriginalConversation = (context: typeof recordContext) => {
    restoredConversationId = context.sourceConversationId ?? null;
  };
  openOriginalConversation(recordContext);
  assert.equal(restoredConversationId, linkedRecord.origin?.conversationId);

  const restoredConversation = await transport.loadConversation(restoredConversationId as string);
  assert.equal(restoredConversation.conversationId, `${transport.tenantId}-conversation`);
  assert.ok(
    restoredConversation.recentTurns.some((turn) => turn.turnId === approved?.turnId),
    'opening the original conversation should restore the approval turn',
  );
  assert.equal(transport.turns.length, 1, 'the drill-down flow must not create another Quick operation');
  assert.equal(transport.approvals.length, 1, 'the drill-down flow must not re-approve the operation');
});