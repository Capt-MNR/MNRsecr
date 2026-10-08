export type SecretaryHomeTask = {
  id: string;
  title: string;
  dueAt?: string | null;
  status: string;
};

export type SecretaryHomeReminder = {
  id: string;
  text: string;
  dueAt: string;
  status: string;
};

export type SecretaryHomeApproval = {
  operationId: string;
  conversationId?: string | null;
  updatedAt: string;
  display: { title: string; details: string[] };
};

export type SecretaryHomeWork = {
  id?: string;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  nextRunAt?: string | null;
};

export type SecretaryHomeExpense = {
  id: string;
  description: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  personName?: string | null;
  projectName?: string | null;
};

export type SecretaryHomeAgendaItem = {
  id: string;
  type: 'task' | 'reminder';
  title: string;
  dueAt: string | null;
  status: string;
};

export type SecretaryHomeAttentionItem =
  | {
      key: string;
      kind: 'approval';
      title: string;
      reason: string;
      approval: SecretaryHomeApproval;
      sortAt: number;
    }
  | {
      key: string;
      kind: 'task';
      title: string;
      reason: string;
      task: SecretaryHomeTask;
      sortAt: number;
    }
  | {
      key: string;
      kind: 'work';
      title: string;
      reason: string;
      work: SecretaryHomeWork & { id: string };
      status: string;
      sortAt: number;
    };

export type SecretaryHomeModel = {
  attention: SecretaryHomeAttentionItem[];
  today: SecretaryHomeAgendaItem[];
  upcoming: SecretaryHomeAgendaItem[];
  watching: (SecretaryHomeWork & { id: string })[];
  recorded: SecretaryHomeExpense[];
};

function parsedTime(value: string | null | undefined): number | null {
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

function uniqueBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function needsAttention(work: SecretaryHomeWork): boolean {
  return work.status === 'needs_review'
    || work.status === 'failed'
    || work.lastRunStatus === 'needs_review'
    || work.lastRunStatus === 'failed'
    || work.lastRunStatus === 'uncertain'
    || work.lastRunStatus === 'unknown_result'
    || work.lastRunStatus === 'unknown';
}

export function buildSecretaryHomeModel(input: {
  asOf?: string | null;
  tasks: SecretaryHomeTask[];
  reminders: SecretaryHomeReminder[];
  works: SecretaryHomeWork[];
  approvals: SecretaryHomeApproval[];
  expenses: SecretaryHomeExpense[];
}): SecretaryHomeModel {
  const asOf = parsedTime(input.asOf) ?? 0;
  const uniqueTasks = uniqueBy(input.tasks, (task) => task.id);
  const uniqueReminders = uniqueBy(input.reminders, (reminder) => reminder.id);
  const uniqueWorks = uniqueBy(
    input.works.filter((work): work is SecretaryHomeWork & { id: string } => Boolean(work.id)),
    (work) => work.id,
  );
  const uniqueApprovals = uniqueBy(input.approvals, (approval) => approval.operationId);
  const overdueTasks = uniqueTasks.filter((task) => {
    const due = parsedTime(task.dueAt);
    return due !== null && due < asOf;
  });
  const attentionWorks = uniqueWorks.filter(needsAttention);

  const attention: SecretaryHomeAttentionItem[] = [
    ...uniqueApprovals.map((approval): SecretaryHomeAttentionItem => ({
      key: `approval:${approval.operationId}`,
      kind: 'approval',
      title: approval.display.title,
      reason: 'موافقتك مطلوبة قبل تنفيذ العملية.',
      approval,
      sortAt: parsedTime(approval.updatedAt) ?? asOf,
    })),
    ...overdueTasks.map((task): SecretaryHomeAttentionItem => ({
      key: `task:${task.id}`,
      kind: 'task',
      title: task.title,
      reason: 'موعد المهمة مرّ وما زالت مفتوحة.',
      task,
      sortAt: parsedTime(task.dueAt) ?? asOf,
    })),
    ...attentionWorks.map((work): SecretaryHomeAttentionItem => {
      const status = work.lastRunStatus === 'uncertain'
        || work.lastRunStatus === 'unknown_result'
        || work.lastRunStatus === 'unknown'
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
        work,
        status,
        sortAt: parsedTime(work.lastRunAt) ?? asOf,
      };
    }),
  ];
  const attentionPriority: Record<SecretaryHomeAttentionItem['kind'], number> = {
    approval: 0,
    task: 1,
    work: 2,
  };
  const workStatusPriority: Record<string, number> = { needs_review: 0, unknown_result: 1, failed: 2 };
  attention.sort((left, right) => {
    const groupOrder = attentionPriority[left.kind] - attentionPriority[right.kind];
    if (groupOrder !== 0) return groupOrder;
    if (left.kind === 'work' && right.kind === 'work') {
      const statusOrder = workStatusPriority[left.status] - workStatusPriority[right.status];
      if (statusOrder !== 0) return statusOrder;
    }
    return left.sortAt - right.sortAt || left.key.localeCompare(right.key);
  });

  const overdueTaskIds = new Set(overdueTasks.map((task) => task.id));
  const agendaItems = uniqueBy(
    [
      ...uniqueTasks
        .filter((task) => !overdueTaskIds.has(task.id))
        .map((task): SecretaryHomeAgendaItem => ({
          id: task.id,
          type: 'task',
          title: task.title,
          dueAt: task.dueAt ?? null,
          status: task.status,
        })),
      ...uniqueReminders.map((reminder): SecretaryHomeAgendaItem => ({
        id: reminder.id,
        type: 'reminder',
        title: reminder.text,
        dueAt: reminder.dueAt,
        status: reminder.status,
      })),
    ],
    (item) => item.id,
  );
  const today: SecretaryHomeAgendaItem[] = [];
  const upcoming: SecretaryHomeAgendaItem[] = [];
  for (const item of agendaItems) {
    const due = parsedTime(item.dueAt);
    if (due === null || sameLocalDay(due, asOf)) {
      today.push(item);
    } else if (due > asOf) {
      upcoming.push(item);
    }
  }
  const chronological = (left: SecretaryHomeAgendaItem, right: SecretaryHomeAgendaItem) => {
    const a = parsedTime(left.dueAt) ?? Number.POSITIVE_INFINITY;
    const b = parsedTime(right.dueAt) ?? Number.POSITIVE_INFINITY;
    return a - b || left.id.localeCompare(right.id);
  };
  today.sort(chronological);
  upcoming.sort(chronological);

  const attentionWorkIds = new Set(attentionWorks.map((work) => work.id));
  const watching = uniqueWorks
    .filter((work) => (work.status === 'active' || work.status === 'waiting')
      && !attentionWorkIds.has(work.id))
    .sort((left, right) => {
      const a = parsedTime(left.nextRunAt) ?? Number.POSITIVE_INFINITY;
      const b = parsedTime(right.nextRunAt) ?? Number.POSITIVE_INFINITY;
      return a - b || (left.title ?? '').localeCompare(right.title ?? '');
    });
  const recorded = uniqueBy(input.expenses, (expense) => expense.id)
    .sort((left, right) => (parsedTime(right.occurredAt) ?? 0) - (parsedTime(left.occurredAt) ?? 0))
    .slice(0, 4);

  return { attention, today, upcoming, watching, recorded };
}
