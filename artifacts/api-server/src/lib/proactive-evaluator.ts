import {
  and,
  eq,
  gte,
  gt,
  inArray,
  lte,
} from "drizzle-orm";
import {
  commitmentProjectsTable,
  commitmentsTable,
  peopleTable,
  projectPeopleTable,
  projectsTable,
  proactivePreferencesTable,
  proactiveSuppressionsTable,
  reminderProjectsTable,
  remindersTable,
  reminderPeopleTable,
  taskPeopleTable,
  taskProjectsTable,
  tasksTable,
} from "@workspace/db";
import {
  evaluateProactiveBehavior,
  type ProactiveDecision,
  type ProactivePreferences as BehaviorPreferences,
} from "./proactive-behavior";
import type { DbExecutor, Identity } from "./entity-graph";
import type { TriggerOutboxEvent, TriggerEvaluation } from "./trigger-outbox";

type ActiveRecord = {
  entityType: "task" | "commitment" | "reminder";
  entityId: string;
  title: string;
  dueAt: Date;
  status: string;
  rowVersion: number;
};

type ProactivePreferenceRow = typeof proactivePreferencesTable.$inferSelect;

const dayMs = 24 * 60 * 60 * 1000;

function activeStatus(entityType: ActiveRecord["entityType"], status: string): boolean {
  if (entityType === "task") return ["pending", "in_progress"].includes(status);
  if (entityType === "reminder") return ["scheduled", "pending", "open", "active"].includes(status);
  return ["open", "active", "in_progress", "pending"].includes(status);
}

function behaviorPreferences(row?: ProactivePreferenceRow): BehaviorPreferences {
  const style = row?.communicationStyle;
  const language = row?.language;
  return {
    style: style === "formal" || style === "friendly" || style === "concise" || style === "balanced"
      ? style
      : "balanced",
    language: language === "en" ? "en" : "ar",
    repeatPermission: row?.repeatReminders ?? false,
  };
}

function proactiveLevel(value: string | null | undefined): "low" | "balanced" | "high" {
  return value === "low" || value === "high" ? value : "balanced";
}

async function readPreferences(
  executor: DbExecutor,
  identity: Identity,
): Promise<ProactivePreferenceRow | undefined> {
  const [row] = await executor.select().from(proactivePreferencesTable).where(and(
    eq(proactivePreferencesTable.tenantId, identity.tenantId),
    eq(proactivePreferencesTable.ownerUserId, identity.userId),
  )).limit(1);
  return row;
}

async function readRecord(
  event: TriggerOutboxEvent,
  executor: DbExecutor,
): Promise<ActiveRecord | undefined> {
  const identity = { tenantId: event.tenantId, userId: event.ownerUserId };
  if (event.aggregateType === "task") {
    const [row] = await executor.select({
      id: tasksTable.id,
      title: tasksTable.title,
      dueAt: tasksTable.dueAt,
      status: tasksTable.status,
      rowVersion: tasksTable.rowVersion,
    }).from(tasksTable).where(and(
      eq(tasksTable.tenantId, identity.tenantId),
      eq(tasksTable.ownerUserId, identity.userId),
      eq(tasksTable.id, event.aggregateId),
    )).limit(1);
    if (!row?.dueAt) return undefined;
    return { entityType: "task", entityId: row.id, title: row.title, dueAt: row.dueAt, status: row.status, rowVersion: row.rowVersion };
  }
  if (event.aggregateType === "commitment") {
    const [row] = await executor.select({
      id: commitmentsTable.id,
      title: commitmentsTable.title,
      dueAt: commitmentsTable.dueAt,
      status: commitmentsTable.status,
      rowVersion: commitmentsTable.rowVersion,
    }).from(commitmentsTable).where(and(
      eq(commitmentsTable.tenantId, identity.tenantId),
      eq(commitmentsTable.ownerUserId, identity.userId),
      eq(commitmentsTable.id, event.aggregateId),
    )).limit(1);
    if (!row?.dueAt) return undefined;
    return { entityType: "commitment", entityId: row.id, title: row.title, dueAt: row.dueAt, status: row.status, rowVersion: row.rowVersion };
  }
  if (event.aggregateType === "reminder") {
    const [row] = await executor.select({
      id: remindersTable.id,
      title: remindersTable.text,
      dueAt: remindersTable.dueAt,
      status: remindersTable.status,
      rowVersion: remindersTable.rowVersion,
    }).from(remindersTable).where(and(
      eq(remindersTable.tenantId, identity.tenantId),
      eq(remindersTable.ownerUserId, identity.userId),
      eq(remindersTable.id, event.aggregateId),
    )).limit(1);
    if (!row) return undefined;
    return { entityType: "reminder", entityId: row.id, title: row.title, dueAt: row.dueAt, status: row.status, rowVersion: row.rowVersion };
  }
  return undefined;
}

async function isSuppressed(
  executor: DbExecutor,
  identity: Identity,
  record: ActiveRecord,
  now: Date,
): Promise<boolean> {
  const [row] = await executor.select({ id: proactiveSuppressionsTable.id })
    .from(proactiveSuppressionsTable)
    .where(and(
      eq(proactiveSuppressionsTable.tenantId, identity.tenantId),
      eq(proactiveSuppressionsTable.ownerUserId, identity.userId),
      eq(proactiveSuppressionsTable.entityType, record.entityType),
      eq(proactiveSuppressionsTable.entityId, record.entityId),
      eq(proactiveSuppressionsTable.contextVersion, record.rowVersion),
      gt(proactiveSuppressionsTable.expiresAt, now),
    )).limit(1);
  return !!row;
}

async function linkedProjectIds(
  executor: DbExecutor,
  identity: Identity,
  record: ActiveRecord,
): Promise<string[]> {
  const relation = record.entityType === "task"
    ? taskProjectsTable
    : record.entityType === "commitment"
      ? commitmentProjectsTable
      : reminderProjectsTable;
  const foreignKey = record.entityType === "task"
    ? taskProjectsTable.taskId
    : record.entityType === "commitment"
      ? commitmentProjectsTable.commitmentId
      : reminderProjectsTable.reminderId;
  const projectColumn = record.entityType === "task"
    ? taskProjectsTable.projectId
    : record.entityType === "commitment"
      ? (commitmentProjectsTable as any).projectId
      : (reminderProjectsTable as any).projectId;
  const rows = await executor.select({ projectId: projectColumn }).from(relation).where(and(
    eq(relation.tenantId, identity.tenantId),
    eq(relation.ownerUserId, identity.userId),
    eq(foreignKey, record.entityId),
  ));
  return [...new Set(rows.map((row) => row.projectId))].sort();
}

async function projectAwarenessFacts(
  executor: DbExecutor,
  identity: Identity,
  projectId: string,
  now: Date,
) {
  const upper = new Date(now.getTime() + dayMs);
  const [taskRows, commitmentRows, reminderRows] = await Promise.all([
    executor.select({
      id: tasksTable.id,
      title: tasksTable.title,
      dueAt: tasksTable.dueAt,
    }).from(taskProjectsTable).innerJoin(tasksTable, eq(taskProjectsTable.taskId, tasksTable.id))
      .where(and(
        eq(taskProjectsTable.tenantId, identity.tenantId),
        eq(taskProjectsTable.ownerUserId, identity.userId),
        eq(taskProjectsTable.projectId, projectId),
        eq(tasksTable.tenantId, identity.tenantId),
        eq(tasksTable.ownerUserId, identity.userId),
        inArray(tasksTable.status, ["pending", "in_progress"]),
        gte(tasksTable.dueAt, now),
        lte(tasksTable.dueAt, upper),
      )).limit(8),
    executor.select({
      id: commitmentsTable.id,
      title: commitmentsTable.title,
      dueAt: commitmentsTable.dueAt,
    }).from(commitmentProjectsTable).innerJoin(commitmentsTable, eq(commitmentProjectsTable.commitmentId, commitmentsTable.id))
      .where(and(
        eq(commitmentProjectsTable.tenantId, identity.tenantId),
        eq(commitmentProjectsTable.ownerUserId, identity.userId),
        eq((commitmentProjectsTable as any).projectId, projectId),
        eq(commitmentsTable.tenantId, identity.tenantId),
        eq(commitmentsTable.ownerUserId, identity.userId),
        inArray(commitmentsTable.status, ["open", "active", "in_progress", "pending"]),
        gte(commitmentsTable.dueAt, now),
        lte(commitmentsTable.dueAt, upper),
      )).limit(8),
    executor.select({
      id: remindersTable.id,
      title: remindersTable.text,
      dueAt: remindersTable.dueAt,
    }).from(reminderProjectsTable).innerJoin(remindersTable, eq(reminderProjectsTable.reminderId, remindersTable.id))
      .where(and(
        eq(reminderProjectsTable.tenantId, identity.tenantId),
        eq(reminderProjectsTable.ownerUserId, identity.userId),
        eq((reminderProjectsTable as any).projectId, projectId),
        eq(remindersTable.tenantId, identity.tenantId),
        eq(remindersTable.ownerUserId, identity.userId),
        inArray(remindersTable.status, ["scheduled", "pending", "open", "active"]),
        gte(remindersTable.dueAt, now),
        lte(remindersTable.dueAt, upper),
      )).limit(8),
  ]);
  const facts = [
    ...taskRows.map((row) => ({
      id: `task:${row.id}`,
      text: `Task: ${row.title}; due ${row.dueAt?.toISOString() ?? ""}`,
      anchor: `project:${projectId}`,
      occurredAt: row.dueAt ?? undefined,
      structured: true,
    })),
    ...commitmentRows.map((row) => ({
      id: `commitment:${row.id}`,
      text: `Commitment: ${row.title}; due ${row.dueAt?.toISOString() ?? ""}`,
      anchor: `project:${projectId}`,
      occurredAt: row.dueAt ?? undefined,
      structured: true,
    })),
    ...reminderRows.map((row) => ({
      id: `reminder:${row.id}`,
      text: `Reminder: ${row.title}; due ${row.dueAt.toISOString()}`,
      anchor: `project:${projectId}`,
      occurredAt: row.dueAt,
      structured: true,
    })),
  ];
  return facts.sort((a, b) =>
    (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0)
      || a.id.localeCompare(b.id),
  ).slice(0, 3);
}

async function projectTasks(
  executor: DbExecutor,
  identity: Identity,
  projectId: string,
) {
  return executor.select({
    id: tasksTable.id,
    title: tasksTable.title,
    rowVersion: tasksTable.rowVersion,
  }).from(taskProjectsTable).innerJoin(tasksTable, eq(taskProjectsTable.taskId, tasksTable.id))
    .where(and(
      eq(taskProjectsTable.tenantId, identity.tenantId),
      eq(taskProjectsTable.ownerUserId, identity.userId),
      eq(taskProjectsTable.projectId, projectId),
      eq(tasksTable.tenantId, identity.tenantId),
      eq(tasksTable.ownerUserId, identity.userId),
      inArray(tasksTable.status, ["pending", "in_progress"]),
    )).limit(5);
}

function ignored(triggerKey: string, reason: string): TriggerEvaluation {
  return { eligible: false, triggerKey, reason };
}

function messageEvaluation(input: {
  triggerKey: string;
  decision: ProactiveDecision;
  title: string;
  entityType: string;
  entityId: string;
  dedupeKey: string;
  data?: Record<string, unknown>;
}): TriggerEvaluation {
  if (input.decision.action === "ignore") return ignored(input.triggerKey, input.decision.reason);
  return {
    eligible: true,
    triggerKey: input.triggerKey,
    reason: input.decision.reason,
    workIntentDedupeKey: input.dedupeKey,
    proactiveMessage: {
      title: input.title,
      body: input.decision.renderedText,
      data: {
        proactive: true,
        action: input.decision.action,
        entityType: input.entityType,
        entityId: input.entityId,
        ...input.data,
      },
    },
  };
}

async function relationshipDiscovery(
  event: TriggerOutboxEvent,
  executor: DbExecutor,
): Promise<TriggerEvaluation> {
  const triggerKey = "relationship-discovery-v1";
  const candidate = event.payload.candidate;
  const evidence = Array.isArray(event.payload.evidence) ? event.payload.evidence : [];
  const evidenceVersion = typeof event.payload.evidenceVersion === "string"
    ? event.payload.evidenceVersion
    : undefined;
  const decision = evaluateProactiveBehavior({
    kind: "relationship_discovery",
    relationship: {
      candidate: candidate && typeof candidate === "object"
        ? candidate as { id: string; name: string }
        : undefined,
      evidence: evidence as Array<{ source: string; sourceId?: string; value: string; structured?: boolean }>,
      evidenceVersion,
      rejectedEvidenceVersion: typeof event.payload.rejectedEvidenceVersion === "string"
        ? event.payload.rejectedEvidenceVersion
        : undefined,
    },
  });
  if (decision.action === "ignore") return ignored(triggerKey, decision.reason);
  const candidateData = candidate && typeof candidate === "object"
    ? candidate as Record<string, unknown>
    : {};
  const identity = { tenantId: event.tenantId, userId: event.ownerUserId };
  const preferences = await readPreferences(executor, identity);
  const localizedTitle = preferences?.language === "en" ? "Review a possible relationship" : "مراجعة علاقة محتملة";
  return messageEvaluation({
    triggerKey,
    decision: evaluateProactiveBehavior({
      kind: "relationship_discovery",
      preferences: behaviorPreferences(preferences),
      relationship: {
        candidate: candidate && typeof candidate === "object"
          ? candidate as { id: string; name: string }
          : undefined,
        evidence: evidence as Array<{ source: string; sourceId?: string; value: string; structured?: boolean }>,
        evidenceVersion,
        rejectedEvidenceVersion: typeof event.payload.rejectedEvidenceVersion === "string"
          ? event.payload.rejectedEvidenceVersion
          : undefined,
      },
    }),
    title: localizedTitle,
    entityType: "project_people",
    entityId: typeof candidateData.projectId === "string" ? candidateData.projectId : event.aggregateId,
    dedupeKey: [
      "proactive-relationship",
      event.tenantId,
      event.ownerUserId,
      event.aggregateId,
      evidenceVersion ?? event.eventId,
    ].join(":"),
    data: {
      relationType: typeof candidateData.relation === "string" ? candidateData.relation : "project_people",
      candidateProjectId: candidateData.projectId ?? null,
      candidatePersonId: candidateData.personId ?? null,
      evidenceIds: evidence.map((item) =>
        item && typeof item === "object" && typeof (item as Record<string, unknown>).sourceId === "string"
          ? (item as Record<string, unknown>).sourceId
          : null,
      ).filter(Boolean),
    },
  });
}

export async function evaluateProactiveTrigger(
  event: TriggerOutboxEvent,
  executor: DbExecutor,
  now: Date,
): Promise<TriggerEvaluation> {
  if (event.eventType === "relationship.candidate") {
    return relationshipDiscovery(event, executor);
  }

  const record = await readRecord(event, executor);
  const key = `proactive-${event.aggregateType}-v1`;
  if (!record) return ignored(key, "proactive_record_not_found_or_has_no_deadline");
  if (!activeStatus(record.entityType, record.status)) return ignored(key, "proactive_record_not_active");

  const expectedDueAt = typeof event.payload.dueAt === "string" ? event.payload.dueAt : null;
  if (!expectedDueAt || expectedDueAt !== record.dueAt.toISOString()) {
    return ignored(key, "proactive_deadline_changed");
  }

  const identity = { tenantId: event.tenantId, userId: event.ownerUserId };
  const preferences = await readPreferences(executor, identity);
  const behaviorPrefs = behaviorPreferences(preferences);
  if (await isSuppressed(executor, identity, record, now)) {
    return ignored(key, "temporarily_suppressed_for_record_version");
  }

  if (event.eventType === "reminder.due") {
    if (record.entityType !== "reminder") return ignored(key, "reminder_due_event_aggregate_mismatch");
    if (record.dueAt.getTime() > now.getTime()) return ignored(key, "reminder_due_time_not_reached");
    if (event.payload.window !== "due-time") return ignored(key, "reminder_due_event_window_invalid");

    const decision = evaluateProactiveBehavior({
      kind: "reminder",
      now,
      preferences: behaviorPrefs,
      reminder: {
        id: record.entityId,
        title: record.title,
        dueAt: record.dueAt,
        status: "active",
        version: record.rowVersion,
        window: "due-time",
        repeatPermission: preferences?.repeatReminders ?? false,
      },
    });
    const deadlineEvidence = {
      kind: "reminder_due_time",
      triggerEventId: event.eventId,
      triggerEventType: event.eventType,
      dueAt: record.dueAt.toISOString(),
      triggerOccurredAt: event.occurredAt.toISOString(),
      triggerCreatedAt: event.createdAt.toISOString(),
      triggerAvailableAt: event.availableAt.toISOString(),
      evaluatedAt: now.toISOString(),
      triggerCreationOffsetMs: event.createdAt.getTime() - record.dueAt.getTime(),
      triggerProcessingLatenessMs: now.getTime() - record.dueAt.getTime(),
      triggerQueueDelayMs: now.getTime() - event.createdAt.getTime(),
    };
    return messageEvaluation({
      triggerKey: "proactive-reminder-due-time-v1",
      decision,
      title: preferences?.language === "en" ? "Reminder due now" : "حان موعد التذكير",
      entityType: record.entityType,
      entityId: record.entityId,
      dedupeKey: [
        "proactive-reminder-due-time",
        identity.tenantId,
        identity.userId,
        record.entityId,
        `v${record.rowVersion}`,
        record.dueAt.toISOString(),
      ].join(":"),
      data: { triggerEventId: event.eventId, deadlineEvidence },
    });
  }

  const isOverdueEvent = event.eventType === "task.overdue"
    || event.eventType === "commitment.overdue"
    || event.eventType === "commitment.deadline";
  if (isOverdueEvent) {
    if (record.dueAt.getTime() > now.getTime()) return ignored(key, "overdue_deadline_not_reached");
    const decision = evaluateProactiveBehavior({
      kind: "overdue",
      now,
      preferences: behaviorPrefs,
      overdue: {
        id: record.entityId,
        title: record.title,
        dueAt: record.dueAt,
        status: record.status === "completed" || record.status === "cancelled" ? record.status : "active",
        version: record.rowVersion,
        proactiveLevel: proactiveLevel(preferences?.proactive),
      },
    });
    return messageEvaluation({
      triggerKey: key,
      decision,
      title: preferences?.language === "en" ? "Deadline follow-up" : "متابعة موعد",
      entityType: record.entityType,
      entityId: record.entityId,
      dedupeKey: [
        "proactive-overdue",
        identity.tenantId,
        identity.userId,
        record.entityType,
        record.entityId,
        `v${record.rowVersion}`,
        record.dueAt.toISOString(),
      ].join(":"),
    });
  }

  if (record.dueAt.getTime() < now.getTime()) return ignored(key, "approaching_deadline_already_passed");
  if (record.dueAt.getTime() - now.getTime() > dayMs) return ignored(key, "outside_next_24_hours");

  const projects = await linkedProjectIds(executor, identity, record);
  for (const projectId of projects) {
    const facts = await projectAwarenessFacts(executor, identity, projectId, now);
    if (facts.length < 2) continue;
    const decision = evaluateProactiveBehavior({
      kind: "awareness",
      now,
      preferences: behaviorPrefs,
      awareness: { facts },
    });
    if (decision.action === "inform") {
      const [project] = await executor.select({ name: projectsTable.name }).from(projectsTable).where(and(
        eq(projectsTable.tenantId, identity.tenantId),
        eq(projectsTable.ownerUserId, identity.userId),
        eq(projectsTable.id, projectId),
      )).limit(1);
      return messageEvaluation({
        triggerKey: "structured-project-awareness-v1",
        decision,
        title: preferences?.language === "en" ? "Related items in one project" : "سجلات مترابطة في مشروع واحد",
        entityType: record.entityType,
        entityId: record.entityId,
        dedupeKey: [
          "proactive-awareness",
          identity.tenantId,
          identity.userId,
          projectId,
          `w${Math.floor(now.getTime() / dayMs)}`,
        ].join(":"),
        data: { projectId, projectName: project?.name ?? null },
      });
    }
  }

  if (record.entityType === "commitment") {
    for (const projectId of projects) {
      const tasks = await projectTasks(executor, identity, projectId);
      if (tasks.length === 0) continue;
      const [project] = await executor.select({ name: projectsTable.name }).from(projectsTable).where(and(
        eq(projectsTable.tenantId, identity.tenantId),
        eq(projectsTable.ownerUserId, identity.userId),
        eq(projectsTable.id, projectId),
      )).limit(1);
      const language = preferences?.language ?? "ar";
      const decision = evaluateProactiveBehavior({
        kind: "assistance",
        now,
        preferences: behaviorPrefs,
        assistance: {
          capability: {
            id: "query_tasks",
            name: language === "en" ? "Summarize project tasks" : "تلخيص مهام المشروع",
          },
          inputs: { projectId, taskIds: tasks.map((task) => task.id) },
          requiredInputKeys: ["projectId", "taskIds"],
          inputComplete: true,
          context: language === "en"
            ? `${record.title} in ${project?.name ?? "the linked project"} (${tasks.length} active tasks)`
            : `${record.title} في ${project?.name ?? "المشروع المرتبط"} (${tasks.length} مهام نشطة)`,
          benefit: language === "en"
            ? "prepare a short task summary before the commitment"
            : "إعداد ملخص قصير للمهام قبل الموعد",
        },
      });
      return messageEvaluation({
        triggerKey: "structured-task-summary-offer-v1",
        decision,
        title: language === "en" ? "Available help" : "مساعدة متاحة",
        entityType: "commitment",
        entityId: record.entityId,
        dedupeKey: [
          "proactive-assistance",
          identity.tenantId,
          identity.userId,
          projectId,
          `w${Math.floor(now.getTime() / dayMs)}`,
        ].join(":"),
        data: {
          projectId,
          commitmentId: record.entityId,
          capability: "query_tasks",
          taskIds: tasks.map((task) => task.id),
        },
      });
    }
  }

  const decision = evaluateProactiveBehavior({
    kind: "reminder",
    now,
    preferences: behaviorPrefs,
    reminder: {
      id: record.entityId,
      title: record.title,
      dueAt: record.dueAt,
      status: "active",
      version: record.rowVersion,
      window: "next-24-hours",
      repeatPermission: preferences?.repeatReminders ?? false,
    },
  });
  return messageEvaluation({
    triggerKey: key,
    decision,
    title: preferences?.language === "en" ? "Upcoming deadline" : "موعد قريب",
    entityType: record.entityType,
    entityId: record.entityId,
    dedupeKey: [
      "proactive-approaching",
      identity.tenantId,
      identity.userId,
      record.entityType,
      record.entityId,
      `v${record.rowVersion}`,
      record.dueAt.toISOString(),
      "next-24-hours",
    ].join(":"),
  });
}

export async function findProjectPeopleEvidence(
  executor: DbExecutor,
  identity: Identity,
  input: { relation: "task_people" | "task_projects" | "reminder_people" | "reminder_projects"; relationship: Record<string, unknown> },
) {
  if (input.relation === "task_people" || input.relation === "task_projects") {
    const taskId = String(input.relationship.taskId ?? "");
    const rows = await executor.select({
      taskId: tasksTable.id,
      taskTitle: tasksTable.title,
      projectId: taskProjectsTable.projectId,
      projectRelationId: taskProjectsTable.id,
      personId: taskPeopleTable.personId,
      personRelationId: taskPeopleTable.id,
    }).from(tasksTable)
      .innerJoin(taskProjectsTable, eq(taskProjectsTable.taskId, tasksTable.id))
      .innerJoin(taskPeopleTable, eq(taskPeopleTable.taskId, tasksTable.id))
      .where(and(
        eq(tasksTable.tenantId, identity.tenantId),
        eq(tasksTable.ownerUserId, identity.userId),
        eq(tasksTable.id, taskId),
        eq(taskProjectsTable.tenantId, identity.tenantId),
        eq(taskProjectsTable.ownerUserId, identity.userId),
        eq(taskPeopleTable.tenantId, identity.tenantId),
        eq(taskPeopleTable.ownerUserId, identity.userId),
      ));
    return rows.map((row) => ({ ...row, anchorType: "task" as const }));
  }

  const reminderId = String(input.relationship.reminderId ?? "");
  const rows = await executor.select({
    reminderId: remindersTable.id,
    reminderTitle: remindersTable.text,
    projectId: (reminderProjectsTable as any).projectId,
    projectRelationId: reminderProjectsTable.id,
    personId: (reminderPeopleTable as any).personId,
    personRelationId: reminderPeopleTable.id,
  }).from(remindersTable)
    .innerJoin(reminderProjectsTable, eq(reminderProjectsTable.reminderId, remindersTable.id))
    .innerJoin(reminderPeopleTable, eq(reminderPeopleTable.reminderId, remindersTable.id))
    .where(and(
      eq(remindersTable.tenantId, identity.tenantId),
      eq(remindersTable.ownerUserId, identity.userId),
      eq(remindersTable.id, reminderId),
      eq(reminderProjectsTable.tenantId, identity.tenantId),
      eq(reminderProjectsTable.ownerUserId, identity.userId),
      eq(reminderPeopleTable.tenantId, identity.tenantId),
      eq(reminderPeopleTable.ownerUserId, identity.userId),
    ));
  return rows.map((row) => ({ ...row, anchorType: "reminder" as const }));
}

export async function projectPersonAlreadyLinked(
  executor: DbExecutor,
  identity: Identity,
  projectId: string,
  personId: string,
): Promise<boolean> {
  const [row] = await executor.select({ id: projectPeopleTable.id }).from(projectPeopleTable).where(and(
    eq(projectPeopleTable.tenantId, identity.tenantId),
    eq(projectPeopleTable.ownerUserId, identity.userId),
    eq(projectPeopleTable.projectId, projectId),
    eq(projectPeopleTable.personId, personId),
  )).limit(1);
  return !!row;
}

export async function relationshipCandidateNames(
  executor: DbExecutor,
  identity: Identity,
  projectId: string,
  personId: string,
) {
  const [[project], [person]] = await Promise.all([
    executor.select({ name: projectsTable.name }).from(projectsTable).where(and(
      eq(projectsTable.tenantId, identity.tenantId),
      eq(projectsTable.ownerUserId, identity.userId),
      eq(projectsTable.id, projectId),
    )).limit(1),
    executor.select({ name: peopleTable.name }).from(peopleTable).where(and(
      eq(peopleTable.tenantId, identity.tenantId),
      eq(peopleTable.ownerUserId, identity.userId),
      eq(peopleTable.id, personId),
    )).limit(1),
  ]);
  return { projectName: project?.name ?? null, personName: person?.name ?? null };
}