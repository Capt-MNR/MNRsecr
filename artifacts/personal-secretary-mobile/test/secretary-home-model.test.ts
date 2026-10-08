import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentWork, PendingApprovalSummary, TodayContext } from '@workspace/api-client-react';
import { buildSecretaryHomeModel } from '../features/main/secretary-home-model';

const asOf = '2026-10-08T12:00:00.000Z';

function context(overrides: Partial<TodayContext> = {}): TodayContext {
  return {
    upcomingReminders: [],
    recentExpenses: [],
    activeProjects: [],
    relevantPeople: [],
    pendingTasks: [],
    asOf,
    ...overrides,
  };
}

function approval(operationId: string, updatedAt = '2026-10-07T12:00:00.000Z'): PendingApprovalSummary {
  return {
    operationId,
    conversationId: 'conversation-1',
    toolName: 'record_expense',
    display: { title: `موافقة ${operationId}`, details: ['تفاصيل'] },
    status: 'pending',
    updatedAt,
  };
}

function work(id: string, overrides: Partial<AgentWork> = {}): AgentWork {
  return { id, title: id, status: 'active', ...overrides };
}

test('ranks pending approvals before overdue tasks and work needing review', () => {
  const model = buildSecretaryHomeModel(
    context({
      pendingTasks: [{ id: 'late', title: 'مهمة متأخرة', dueAt: '2026-10-07T10:00:00.000Z', status: 'pending' }],
    }),
    [
      work('review', { status: 'needs_review', lastRunAt: '2026-10-08T11:00:00.000Z' }),
      work('uncertain', { lastRunStatus: 'uncertain' }),
      work('failed', { lastRunStatus: 'failed' }),
    ],
    [approval('approve')],
  );

  assert.deepEqual(model.attention.map((item) => item.kind), ['approval', 'task', 'work', 'work', 'work']);
  assert.equal(model.attention[1]?.kind === 'task' ? model.attention[1].id : '', 'late');
  assert.deepEqual(
    model.attention.filter((item) => item.kind === 'work').map((item) => item.status).sort(),
    ['failed', 'needs_review', 'unknown_result'],
  );
  assert.equal(model.attention.find((item) => item.kind === 'work' && item.status === 'unknown_result')?.reason,
    'النتيجة غير مؤكدة؛ لن يُعاد التنفيذ تلقائيًا.');
});

test('splits today, upcoming, and overdue items chronologically without repeating them', () => {
  const model = buildSecretaryHomeModel(
    context({
      pendingTasks: [
        { id: 'tomorrow-task', title: 'مهمة غدًا', dueAt: '2026-10-09T09:00:00.000Z', status: 'pending' },
        { id: 'today-task-late', title: 'مهمة اليوم لاحقًا', dueAt: '2026-10-08T18:00:00.000Z', status: 'pending' },
        { id: 'today-task-early', title: 'مهمة اليوم مبكرًا', dueAt: '2026-10-08T13:00:00.000Z', status: 'in_progress' },
        { id: 'undated-task', title: 'بلا موعد', dueAt: null, status: 'pending' },
        { id: 'overdue-task', title: 'متأخرة', dueAt: '2026-10-07T12:00:00.000Z', status: 'pending' },
        { id: 'today-task-early', title: 'مكررة', dueAt: '2026-10-08T13:00:00.000Z', status: 'pending' },
      ],
      upcomingReminders: [
        { id: 'tomorrow-reminder', text: 'تذكير غدًا', dueAt: '2026-10-09T08:00:00.000Z', timezone: 'Africa/Cairo', status: 'scheduled' },
        { id: 'today-reminder', text: 'تذكير اليوم', dueAt: '2026-10-08T14:00:00.000Z', timezone: 'Africa/Cairo', status: 'scheduled' },
      ],
    }),
    [],
    [],
  );

  assert.deepEqual(model.today.map((item) => item.id), ['today-task-early', 'today-reminder', 'today-task-late', 'undated-task']);
  assert.deepEqual(model.upcoming.map((item) => item.id), ['tomorrow-reminder', 'tomorrow-task']);
  assert.deepEqual(model.attention.map((item) => item.key), ['task:overdue-task']);
  assert.equal(
    [...model.today, ...model.upcoming, ...model.attention].filter((item) => item.key === 'task:today-task-early').length,
    1,
  );
});

test('does not repeat a review work item in the secretary tracking section', () => {
  const model = buildSecretaryHomeModel(
    context(),
    [
      work('tracked', { status: 'active', nextRunAt: '2026-10-09T08:00:00.000Z' }),
      work('review', { status: 'needs_review' }),
      work('tracked'),
    ],
    [],
  );

  assert.deepEqual(model.watching.map((item) => item.id), ['tracked']);
  assert.deepEqual(model.attention.map((item) => item.key), ['work:review']);
});

test('keeps recent expenses newest-first and deduplicated by real record ID', () => {
  const recentExpenses: TodayContext['recentExpenses'] = [
    { id: 'older', amountMinor: 100, currency: 'EGP', description: 'قديم', occurredAt: '2026-10-07T09:00:00.000Z' },
    { id: 'newer', amountMinor: 200, currency: 'EGP', description: 'أحدث', occurredAt: '2026-10-08T09:00:00.000Z' },
    { id: 'newer', amountMinor: 200, currency: 'EGP', description: 'مكرر', occurredAt: '2026-10-08T09:00:00.000Z' },
  ];
  const model = buildSecretaryHomeModel(context({ recentExpenses }), [], []);

  assert.deepEqual(model.recentExpenses.map((item) => item.id), ['newer', 'older']);
});
