import assert from 'node:assert/strict';
import test from 'node:test';
import { contextRelationshipSpecs, contextRelationshipTargetId, sortContextActionsByUrgency } from '../services/context-relationships';

test('only record types supported by the relationship API request typed links', () => {
  assert.deepEqual(
    contextRelationshipSpecs('task').map(({ relation, targetRecordType }) => [relation, targetRecordType]),
    [['task_people', 'person'], ['task_projects', 'project']],
  );
  assert.deepEqual(
    contextRelationshipSpecs('reminder').map(({ relation, targetRecordType }) => [relation, targetRecordType]),
    [['reminder_people', 'person'], ['reminder_projects', 'project'], ['reminder_tasks', 'task']],
  );
  assert.deepEqual(contextRelationshipSpecs('commitment').map(({ relation }) => relation), ['commitment_people', 'commitment_projects']);
  assert.deepEqual(contextRelationshipSpecs('expense'), []);
  assert.deepEqual(contextRelationshipSpecs('person'), []);
  assert.deepEqual(contextRelationshipSpecs('project'), []);
});

test('relationship targets are read only from the expected foreign-key field', () => {
  const [personSpec] = contextRelationshipSpecs('task');
  assert.equal(contextRelationshipTargetId(personSpec, { personId: 'person-id' }), 'person-id');
  assert.equal(contextRelationshipTargetId(personSpec, { projectId: 'wrong-field' }), null);
  assert.equal(contextRelationshipTargetId(personSpec, { personId: '  ' }), null);
  assert.equal(contextRelationshipTargetId(personSpec, null), null);
});

test('linked tasks and reminders order overdue, today, soon, remaining, then closed', () => {
  const now = new Date(2026, 9, 8, 12).getTime();
  const actions = [
    { id: 'later', status: 'pending', dueAt: new Date(2026, 9, 20, 9).toISOString() },
    { id: 'closed', status: 'completed', dueAt: new Date(2026, 9, 7, 9).toISOString() },
    { id: 'soon', status: 'scheduled', dueAt: new Date(2026, 9, 10, 9).toISOString() },
    { id: 'today', status: 'pending', dueAt: new Date(2026, 9, 8, 17).toISOString() },
    { id: 'overdue', status: 'pending', dueAt: new Date(2026, 9, 7, 9).toISOString() },
  ];
  assert.deepEqual(sortContextActionsByUrgency(actions, now).map((item) => item.id), [
    'overdue', 'today', 'soon', 'later', 'closed',
  ]);
});
