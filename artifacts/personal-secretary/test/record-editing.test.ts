import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RECORD_REFRESH_FAILURE_MESSAGE,
  resolveRecordForEditing,
} from '../src/lib/record-editing.ts';

test('does not open a record when the refresh failed', () => {
  const result = resolveRecordForEditing(
    { isSuccess: false, data: [{ id: 'expense-1' }] },
    'expense-1',
  );

  assert.deepEqual(result, { status: 'refresh_failed' });
  assert.match(RECORD_REFRESH_FAILURE_MESSAGE, /لم نفتح نسخة قديمة/);
});

test('opens the refreshed record when it is still present', () => {
  const record = { id: 'expense-1', description: 'دفعة' };

  assert.deepEqual(
    resolveRecordForEditing({ isSuccess: true, data: [record] }, record.id),
    { status: 'ready', record },
  );
});

test('reports a record removed by another change separately from refresh failure', () => {
  assert.deepEqual(
    resolveRecordForEditing({ isSuccess: true, data: [{ id: 'expense-2' }] }, 'expense-1'),
    { status: 'missing' },
  );
});