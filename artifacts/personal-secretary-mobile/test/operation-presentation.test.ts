import assert from 'node:assert/strict';
import test from 'node:test';
import { operationNoticeForHandoff, operationNoticeFromAction } from '../services/operation-presentation';
import { quickOperationRouteParams } from '../services/quick-operation-handoff';

test('mobile operation presentation preserves distinct lifecycle states', () => {
  assert.equal(operationNoticeFromAction({ status: 'pending' })?.status, 'pending_approval');
  assert.equal(operationNoticeFromAction({ status: 'executing' })?.status, 'executing');
  assert.equal(operationNoticeFromAction({ status: 'verifying' })?.status, 'verifying');
  assert.equal(operationNoticeFromAction({ status: 'completed' })?.status, 'completed');
  assert.equal(operationNoticeFromAction({ status: 'rejected' })?.status, 'rejected');
  assert.equal(operationNoticeFromAction({ status: 'expired' })?.status, 'expired');
  assert.equal(operationNoticeFromAction({ status: 'failed' })?.status, 'failed');
  assert.equal(operationNoticeFromAction({ status: 'needs_review' })?.status, 'needs_review');
  assert.equal(operationNoticeFromAction({ status: 'cancelled' })?.status, 'cancelled');
});

test('unknown external outcomes stay unknown and do not expose provider details', () => {
  const notice = operationNoticeFromAction({
    type: 'google_sheets_action_unknown_result',
    status: 'completed',
    operationId: 'op-unknown',
    externalAction: {
      status: 'unknown_result',
      provider: 'google_sheets',
      error: { code: 'SECRET_PROVIDER_ERROR' },
      retryable: false,
      reviewRequired: true,
    },
  }, 'completed');
  assert.equal(notice?.status, 'unknown_result');
  assert.equal(notice?.serviceLabel, 'Google Sheets');
  assert.equal('errorSummary' in (notice ?? {}), false);
});

test('verified evidence is summarized and failed error codes are translated safely', () => {
  const verified = operationNoticeFromAction({
    actionState: 'verified',
    operationId: 'op-verified',
    externalAction: {
      status: 'verified',
      provider: 'google_sheets',
      verification: { method: 'provider_receipt_lookup', checkedAt: '2026-10-08T12:00:00.000Z' },
    },
  });
  assert.equal(verified?.status, 'completed');
  assert.equal(verified?.verificationSummary, 'تم التحقق من إيصال الخدمة.');
  assert.equal(verified?.checkedAt, '2026-10-08T12:00:00.000Z');

  const failed = operationNoticeFromAction({
    externalAction: {
      status: 'failed',
      provider: 'untrusted-provider',
      error: { code: 'PERMISSION_DENIED_PRIVATE_DETAIL' },
    },
  });
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.errorSummary, 'السكرتير مش عنده الصلاحية المطلوبة.');
  assert.equal(failed?.serviceLabel, undefined);
  assert.equal(failed?.errorSummary?.includes('PERMISSION_DENIED'), false);
});

test('Quick review handoff keeps operation and conversation context and never turns unknown into approval', () => {
  assert.deepEqual(
    quickOperationRouteParams('operation-1', 'conversation-1', 'unknown_result'),
    {
      operationId: 'operation-1',
      conversationId: 'conversation-1',
      operationState: 'unknown_result',
    },
  );
  assert.deepEqual(
    quickOperationRouteParams('operation-2'),
    { operationId: 'operation-2' },
  );

  assert.deepEqual(
    operationNoticeForHandoff('pending', 'operation-1', 'unknown_result'),
    { status: 'unknown_result', operationId: 'operation-1' },
  );
  assert.deepEqual(
    operationNoticeForHandoff('pending', 'operation-2', 'needs_review'),
    { status: 'needs_review', operationId: 'operation-2' },
  );
  assert.deepEqual(
    operationNoticeForHandoff('completed', 'operation-1', 'unknown_result'),
    { status: 'completed', operationId: 'operation-1' },
  );
  assert.deepEqual(
    operationNoticeForHandoff('unrecognized', 'operation-3'),
    { status: 'unknown_result', operationId: 'operation-3' },
  );
});
