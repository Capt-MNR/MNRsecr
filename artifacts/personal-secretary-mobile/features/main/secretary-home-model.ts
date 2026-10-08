import type {
  AgentWork,
  ExpenseSummary,
  PendingApprovalSummary,
  PendingTask,
  ReminderSummary,
  TodayContext,
} from '@workspace/api-client-react';

export type SecretaryHomeRecord = {
  key: string;
  kind: 'task' | 'reminder';
  id: string;
  title: string;
  dueAt: string | null;
  status: string;
};

export type SecretaryHomeAttention =
  | {
      key: string;
      kind: 'approval';
      title: string;
      reason: string;
      operationId: string;
      conversationId?: string | null;
      sortAt: number;
    }
  | {
      key: string;
      kind: 'task';
      title: string;
      reason: string;
      id: string;
      dueAt: string;
      status: string;
      sortAt: number;
    }
  | {
      key: string;
      kind: 'work';
      title: string;
      reason: string;
      workId: string;
      status: string;
      sortAt: number;
    };

export type SecretaryHomeModel = {
  attention: SecretaryHomeAttention[];
  watching: AgentWork[];
  today: SecretaryHomeRecord[];
  upcoming: SecretaryHomeRecord[];
  recentExpenses: ExpenseSummary[];
};

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameLocalDay(left: number, right: number): boolean {
  const a = new Date(left);
  const b = new Date(right);
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function reminderRecord(item: ReminderSummary): SecretaryHomeRecord {
  return {
    key: `reminder:${item.id}`,
    kind: 'reminder',
    id: item.id,
    title: item.text,
    dueAt: item.dueAt,
    status: item.status,
  };
}

function taskRecord(item: PendingTask): SecretaryHomeRecord {
  return {
    key: `task:${item.id}`,
    kind: 'task',
    id: item.id,
    title: item.title,
    dueAt: item.dueAt ?? null,
    status: item.status,
  };
}

function workNeedsAttention(work: AgentWork): boolean {
  return work.status === 'needs_review'
    || work.status === 'failed'
    || work.lastRunStatus === 'needs_review'
    || work.lastRunStatus === 'failed'
    || work.lastRunStatus === 'uncertain'
    || work.lastRunStatus === 'unknown_result';
}

export function buildSecretaryHomeModel(
  context: TodayContext | undefined,
  works: AgentWork[],
  approvals: PendingApprovalSummary[],
): SecretaryHomeModel {
  const asOf = timestamp(context?.asOf) ?? 0;
  const uniqueApprovals = uniqueById(
    approvals.map((approval) => ({ ...approval, id: approval.operationId })),
  );
  const uniqueTasks = uniqueById(context?.pendingTasks ?? []);
  const uniqueReminders = uniqueById(context?.upcomingReminders ?? []);
  const uniqueWorks = uniqueById(works.filter((work): work is AgentWork & { id: string } => Boolean(work.id)));

  const overdueTasks = uniqueTasks
    .map((task) => ({ task, due: timestamp(task.dueAt) }))
    .filter((entry): entry is { task: PendingTask; due: number } => entry.due !== null && entry.due < asOf);
  const reviewWorks = uniqueWorks.filter(workNeedsAttention);
  const attention: SecretaryHomeAttention[] = [
    ...uniqueApprovals.map((approval): SecretaryHomeAttention => ({
      key: `approval:${approval.operationId}`,
      kind: 'approval',
      title: approval.display.title,
      reason: 'موافقتك مطلوبة قبل تنفيذ العملية.',
      operationId: approval.operationId,
      ...(approval.conversationId ? { conversationId: approval.conversationId } : {}),
      sortAt: timestamp(approval.updatedAt) ?? asOf,
    })),
    ...overdueTasks.map(({ task, due }): SecretaryHomeAttention => ({
      key: `task:${task.id}`,
      kind: 'task',
      title: task.title,
      reason: 'موعد المهمة مرّ وما زالت مفتوحة.',
      id: task.id,
      dueAt: task.dueAt!,
      status: task.status,
      sortAt: due,
    })),
    ...reviewWorks.map((work): SecretaryHomeAttention => {
      const status = work.lastRunStatus === 'uncertain' || work.lastRunStatus === 'unknown_result'
        ? 'unknown_result'
        : work.status === 'needs_review' || work.lastRunStatus === 'needs_review'
          ? 'needs_review'
          : 'failed';
      return {
        key: `work:${work.id}`,
        kind: 'work',
        title: work.title ?? 'عمل للمتابعة',
        reason: status === 'unknown_result'
          ? 'النتيجة غير مؤكدة؛ لن يُعاد التنفيذ تلقائيًا.'
          : status === 'needs_review'
            ? 'العمل يحتاج مراجعتك.'
            : 'آخر تنفيذ لهذا العمل فشل.',
        workId: work.id!,
        status,
        sortAt: timestamp(work.lastRunAt) ?? timestamp(work.updatedAt) ?? asOf,
      };
    }),
  ];
  const priority: Record<SecretaryHomeAttention['kind'], number> = {
    approval: 0,
    task: 1,
    work: 2,
  };
  const workStatusPriority: Record<string, number> = { needs_review: 0, unknown_result: 1, failed: 2 };
  attention.sort((left, right) => {
    const groupOrder = priority[left.kind] - priority[right.kind];
    if (groupOrder !== 0) return groupOrder;
    if (left.kind === 'work' && right.kind === 'work') {
      const statusOrder = workStatusPriority[left.status] - workStatusPriority[right.status];
      if (statusOrder !== 0) return statusOrder;
    }
    return left.sortAt - right.sortAt || left.key.localeCompare(right.key);
  });

  const today: SecretaryHomeRecord[] = [];
  const upcoming: SecretaryHomeRecord[] = [];
  const addByDate = (item: SecretaryHomeRecord) => {
    if (!item.dueAt) {
      today.push(item);
      return;
    }
    const due = timestamp(item.dueAt);
    if (due === null || sameLocalDay(due, asOf)) {
      today.push(item);
    } else if (due > asOf) {
      upcoming.push(item);
    }
  };

  uniqueTasks
    .filter((task) => !overdueTasks.some(({ task: overdue }) => overdue.id === task.id))
    .map(taskRecord)
    .forEach(addByDate);
  uniqueReminders.map(reminderRecord).forEach(addByDate);

  const chronological = (left: SecretaryHomeRecord, right: SecretaryHomeRecord) => {
    const a = timestamp(left.dueAt) ?? Number.POSITIVE_INFINITY;
    const b = timestamp(right.dueAt) ?? Number.POSITIVE_INFINITY;
    return a - b || left.key.localeCompare(right.key);
  };
  today.sort(chronological);
  upcoming.sort(chronological);

  const attentionWorkIds = new Set(reviewWorks.map((work) => work.id));
  const watching = uniqueWorks
    .filter((work) => (work.status === 'active' || work.status === 'waiting')
      && !attentionWorkIds.has(work.id))
    .sort((left, right) => {
      const a = timestamp(left.nextRunAt) ?? Number.POSITIVE_INFINITY;
      const b = timestamp(right.nextRunAt) ?? Number.POSITIVE_INFINITY;
      return a - b || (left.title ?? '').localeCompare(right.title ?? '');
    });
  const recentExpenses = uniqueById(context?.recentExpenses ?? [])
    .sort((left, right) => (timestamp(right.occurredAt) ?? 0) - (timestamp(left.occurredAt) ?? 0))
    .slice(0, 4);

  return { attention, watching, today, upcoming, recentExpenses };
}
