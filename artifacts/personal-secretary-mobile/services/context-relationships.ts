export type ContextRelationshipSpec = {
  relation: string;
  targetRecordType: 'person' | 'project' | 'task';
  targetIdField: 'personId' | 'projectId' | 'taskId';
  targetCollection: 'people' | 'projects' | 'tasks';
};

const relationsByRecordType: Record<string, ContextRelationshipSpec[]> = {
  task: [
    { relation: 'task_people', targetRecordType: 'person', targetIdField: 'personId', targetCollection: 'people' },
    { relation: 'task_projects', targetRecordType: 'project', targetIdField: 'projectId', targetCollection: 'projects' },
  ],
  reminder: [
    { relation: 'reminder_people', targetRecordType: 'person', targetIdField: 'personId', targetCollection: 'people' },
    { relation: 'reminder_projects', targetRecordType: 'project', targetIdField: 'projectId', targetCollection: 'projects' },
    { relation: 'reminder_tasks', targetRecordType: 'task', targetIdField: 'taskId', targetCollection: 'tasks' },
  ],
  commitment: [
    { relation: 'commitment_people', targetRecordType: 'person', targetIdField: 'personId', targetCollection: 'people' },
    { relation: 'commitment_projects', targetRecordType: 'project', targetIdField: 'projectId', targetCollection: 'projects' },
  ],
};

export function contextRelationshipSpecs(recordType: string): ContextRelationshipSpec[] {
  return relationsByRecordType[recordType] ?? [];
}

export function contextRelationshipTargetId(
  spec: ContextRelationshipSpec,
  relationship: unknown,
): string | null {
  if (!relationship || typeof relationship !== 'object' || Array.isArray(relationship)) return null;
  const id = (relationship as Record<string, unknown>)[spec.targetIdField];
  return typeof id === 'string' && id.trim() ? id : null;
}

export function sortContextActionsByUrgency<T extends { status?: unknown; dueAt?: unknown }>(
  items: T[],
  now = Date.now(),
): T[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const soonLimit = new Date(startOfTomorrow);
  soonLimit.setDate(soonLimit.getDate() + 3);
  const closedStatuses = new Set(['completed', 'cancelled', 'archived']);

  function priority(item: T): { bucket: number; due: number } {
    const status = typeof item.status === 'string' ? item.status : '';
    const due = typeof item.dueAt === 'string' ? new Date(item.dueAt).getTime() : Number.NaN;
    if (closedStatuses.has(status)) return { bucket: 4, due: Number.POSITIVE_INFINITY };
    if (!Number.isFinite(due)) return { bucket: 3, due: Number.POSITIVE_INFINITY };
    if (due < now) return { bucket: 0, due };
    if (due < startOfTomorrow.getTime()) return { bucket: 1, due };
    if (due < soonLimit.getTime()) return { bucket: 2, due };
    return { bucket: 3, due };
  }

  return [...items].sort((left, right) => {
    const leftPriority = priority(left);
    const rightPriority = priority(right);
    return leftPriority.bucket - rightPriority.bucket || leftPriority.due - rightPriority.due;
  });
}
