import assert from 'node:assert/strict';
import test from 'node:test';
import { operationNoticeFromAction } from '../src/lib/operation-presentation.ts';

test('operation states remain distinct', () => {
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

test('nested unknown external outcome overrides a completed operation status', () => {
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

test('only allowlisted verification and safe failure summaries are shown', () => {
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
