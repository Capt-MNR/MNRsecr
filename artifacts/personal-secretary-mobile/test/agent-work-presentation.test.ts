import assert from 'node:assert/strict';
import test from 'node:test';
import { agentWorkIdFromAction, workRetryAllowed } from '../services/agent-work-presentation';

test('only a real agent_work_created action exposes a Work link', () => {
  assert.equal(agentWorkIdFromAction({ type: 'agent_work_created', workId: 'work-123' }), 'work-123');
  assert.equal(agentWorkIdFromAction({ type: 'agent_work_created', workId: '  ' }), undefined);
  assert.equal(agentWorkIdFromAction({ type: 'approval_required', workId: 'work-123' }), undefined);
  assert.equal(agentWorkIdFromAction(null), undefined);
});

test('failed Work can be retried only when the result is known and not under review', () => {
  assert.equal(workRetryAllowed('failed', false, false), true);
  assert.equal(workRetryAllowed('failed', true, false), false);
  assert.equal(workRetryAllowed('failed', false, true), false);
  assert.equal(workRetryAllowed('active', false, false), false);
});
