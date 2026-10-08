import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSecretaryHomeModel } from '../src/lib/secretary-home-model.ts';

const asOf = '2026-10-08T12:00:00.000Z';

test('ranks approvals before overdue tasks and unresolved Work, with stable oldest-first order', () => {
  const model = buildSecretaryHomeModel({
    asOf,
    approvals: [
      { operationId: 'newer', updatedAt: '2026-10-07T11:00:00.000Z', display: { title: 'موافقة أحدث', details: [] } },
      { operationId: 'older', updatedAt: '2026-10-07T10:00:00.000Z', display: { title: 'موافقة أقدم', details: [] } },
    ],
    tasks: [
      { id: 'late', title: 'متأخرة حديثًا', dueAt: '2026-10-08T11:00:00.000Z', status: 'pending' },
      { id: 'old', title: 'متأخرة من أمس', dueAt: '2026-10-07T10:00:00.000Z', status: 'pending' },
    ],
    works: [
      { id: 'review', title: 'مراجعة', status: 'needs_review', lastRunAt: '2026-10-08T11:00:00.000Z' },
      { id: 'uncertain', title: 'غير مؤكد', status: 'active', lastRunStatus: 'uncertain' },
      { id: 'failed', title: 'فشل', status: 'active', lastRunStatus: 'failed' },
    ],
    reminders: [],
    expenses: [],
  });

  assert.deepEqual(model.attention.map((item) => item.key), [
    'approval:older',
    'approval:newer',
    'task:old',
    'task:late',
    'work:review',
    'work:uncertain',
    'work:failed',
  ]);
  const uncertain = model.attention.find((item) => item.key === 'work:uncertain');
  assert.equal(uncertain?.kind === 'work' ? uncertain.status : '', 'unknown_result');
  assert.match(uncertain?.reason ?? '', /لن يُعاد التنفيذ تلقائيًا/);
});

test('separates overdue, today, and future agenda items without repeating overdue tasks', () => {
  const model = buildSecretaryHomeModel({
    asOf,
    tasks: [
      { id: 'overdue', title: 'متأخرة', dueAt: '2026-10-08T11:59:00.000Z', status: 'pending' },
      { id: 'today', title: 'اليوم', dueAt: '2026-10-08T18:00:00.000Z', status: 'in_progress' },
      { id: 'tomorrow', title: 'غدًا', dueAt: '2026-10-09T08:00:00.000Z', status: 'pending' },
      { id: 'undated', title: 'بلا موعد', dueAt: null, status: 'pending' },
      { id: 'today', title: 'نسخة مكررة', dueAt: '2026-10-08T18:00:00.000Z', status: 'pending' },
    ],
    reminders: [
      { id: 'today-reminder', text: 'تذكير اليوم', dueAt: '2026-10-08T14:00:00.000Z', status: 'scheduled' },
      { id: 'tomorrow-reminder', text: 'تذكير غدًا', dueAt: '2026-10-09T07:00:00.000Z', status: 'scheduled' },
    ],
    works: [],
    approvals: [],
    expenses: [],
  });

  assert.deepEqual(model.attention.map((item) => item.key), ['task:overdue']);
  assert.deepEqual(model.today.map((item) => item.id), ['today-reminder', 'today', 'undated']);
  assert.deepEqual(model.upcoming.map((item) => item.id), ['tomorrow-reminder', 'tomorrow']);
  assert.equal(model.today.some((item) => item.id === 'overdue'), false);
});

test('keeps only active or waiting Work in tracking, without duplicating review Work', () => {
  const model = buildSecretaryHomeModel({
    asOf,
    tasks: [],
    reminders: [],
    approvals: [],
    expenses: [],
    works: [
      { id: 'active', title: 'يتابع', status: 'active', nextRunAt: '2026-10-09T10:00:00.000Z', lastRunAt: '2026-10-08T11:00:00.000Z', lastRunStatus: 'verifying' },
      { id: 'waiting', title: 'ينتظر', status: 'waiting' },
      { id: 'review', title: 'مراجعة', status: 'needs_review' },
      { id: 'paused', title: 'متوقف', status: 'paused' },
    ],
  });

  assert.deepEqual(model.watching.map((work) => work.id), ['active', 'waiting']);
  assert.deepEqual(model.attention.map((item) => item.key), ['work:review']);
  assert.equal(model.watching[0]?.lastRunStatus, 'verifying');
});

test('deduplicates approvals and recent expenses, presenting recorded data newest-first', () => {
  const model = buildSecretaryHomeModel({
    asOf,
    tasks: [],
    reminders: [],
    works: [],
    approvals: [
      { operationId: 'op', updatedAt: asOf, display: { title: 'الأصل', details: [] } },
      { operationId: 'op', updatedAt: asOf, display: { title: 'مكرر', details: [] } },
    ],
    expenses: [
      { id: 'older', description: 'أقدم', amountMinor: 100, currency: 'EGP', occurredAt: '2026-10-07T09:00:00.000Z' },
      { id: 'newer', description: 'أحدث', amountMinor: 200, currency: 'EGP', occurredAt: '2026-10-08T09:00:00.000Z' },
      { id: 'newer', description: 'مكرر', amountMinor: 200, currency: 'EGP', occurredAt: '2026-10-08T09:00:00.000Z' },
    ],
  });

  assert.equal(model.attention.length, 1);
  assert.equal(model.attention[0]?.kind === 'approval' ? model.attention[0].title : '', 'الأصل');
  assert.deepEqual(model.recorded.map((expense) => expense.id), ['newer', 'older']);
});

test('returns real empty section lists rather than placeholder rows', () => {
  const model = buildSecretaryHomeModel({
    asOf,
    tasks: [],
    reminders: [],
    works: [],
    approvals: [],
    expenses: [],
  });

  assert.deepEqual(model, { attention: [], today: [], upcoming: [], watching: [], recorded: [] });
});
