import { and, asc, desc, eq } from "drizzle-orm";
import {
  activityEventEntitiesTable,
  activityEventsTable,
  commitmentsTable,
  commitmentPeopleTable,
  financialPartiesTable,
  financialPartyPeopleTable,
  financialPartyProjectsTable,
  financialPartyPurposesTable,
  db,
  expensesTable,
  peopleTable,
  projectPeopleTable,
  projectsTable,
  purposesTable,
  reminderPeopleTable,
  reminderProjectsTable,
  taskPeopleTable,
  taskProjectsTable,
  tasksTable,
  remindersTable,
  type ActivityEvent,
} from "@workspace/db";

export type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;
export type GraphEntityType = "person" | "project" | "financial_party";
export type Identity = { tenantId: string; userId: string };
const GRAPH_LIMIT = 100;

type ActivityEntityRef = {
  entityType: string;
  entityId: string;
  role?: string;
};

export async function recordActivityEvent(
  identity: Identity,
  input: {
    eventType: string;
    sourceType: string;
    sourceId?: string | null;
    summary: string;
    metadata?: Record<string, unknown>;
    entities: ActivityEntityRef[];
  },
  executor: DbExecutor = db,
) {
  const [event] = await executor.insert(activityEventsTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    eventType: input.eventType,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    actorType: "user",
    actorId: identity.userId,
    summary: input.summary,
    metadata: input.metadata ?? {},
  }).returning();

  if (input.entities.length > 0) {
    await executor.insert(activityEventEntitiesTable).values(
      input.entities.map((entity) => ({
        tenantId: identity.tenantId,
        ownerUserId: identity.userId,
        eventId: event.id,
        entityType: entity.entityType,
        entityId: entity.entityId,
        role: entity.role ?? "related",
      })),
    ).onConflictDoNothing();
  }
  return event;
}

function entityRef(entityType: string, entityId: unknown, role = "related"): ActivityEntityRef | null {
  return typeof entityId === "string" && entityId.length > 0
    ? { entityType, entityId, role }
    : null;
}

function recordFromResult(result: Record<string, unknown>, toolName: string): Record<string, unknown> | null {
  const key = toolName.startsWith("delete_")
    ? `deleted${toolName.slice("delete_".length).replace(/^./, (value) => value.toUpperCase())}`
    : toolName === "record_expense"
      ? "expense"
      : toolName === "link_person_to_project" || toolName === "update_person_project_relationship"
        ? "relationship"
        : toolName === "create_typed_relationship" || toolName === "delete_typed_relationship"
          ? "relationship"
        : toolName === "settle_financial_obligation"
          ? "obligation_settlement"
        : toolName.replace(/^(create_|update_)/, "");
  const value = result[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function entityTypeForTool(toolName: string): string | null {
  if (toolName.includes("person")) return "person";
  if (toolName.includes("project")) return "project";
  if (toolName.includes("expense")) return "expense";
  if (toolName.includes("reminder")) return "reminder";
  if (toolName.includes("commitment")) return "commitment";
  if (toolName.includes("task")) return "task";
  if (toolName.includes("financial_party")) return "financial_party";
  if (toolName.includes("financial_obligation")) return "financial_obligation";
  if (toolName.includes("financial_payment")) return "financial_payment";
  if (toolName.includes("donation")) return "donation";
  if (toolName.includes("income_receivable")) return "income_receivable";
  if (toolName.includes("payment_link")) return "payment_link";
  if (toolName.includes("settle_financial_obligation")) return "obligation_settlement";
  return null;
}

export async function recordToolActivity(
  identity: Identity,
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  executor: DbExecutor = db,
): Promise<void> {
  if (result.ok !== true || result.pendingApproval === true) return;
  if (toolName === "find_person" || toolName === "find_project" || toolName.startsWith("query_") || toolName === "recall_context") return;
  if (result.created === false) return;

  const record = recordFromResult(result, toolName);
  const primaryType = entityTypeForTool(toolName);
  const primaryId = record?.id;
  const entities: ActivityEntityRef[] = [];
  const primary = primaryType ? entityRef(primaryType, primaryId, "subject") : null;
  if (primary) entities.push(primary);

  const person = entityRef("person", args.personId, "person");
  const project = entityRef("project", args.projectId, "project");
  if (person && !entities.some((item) => item.entityType === person.entityType && item.entityId === person.entityId)) entities.push(person);
  if (project && !entities.some((item) => item.entityType === project.entityType && item.entityId === project.entityId)) entities.push(project);
  for (const [key, role] of [
    ["lenderPartyId", "lender"],
    ["borrowerPartyId", "borrower"],
    ["payerPartyId", "payer"],
    ["payeePartyId", "payee"],
    ["donorPartyId", "donor"],
    ["recipientPartyId", "recipient"],
    ["creditorPartyId", "creditor"],
    ["debtorPartyId", "debtor"],
    ["obligationId", "obligation"],
    ["paymentId", "payment"],
    ["receivableId", "receivable"],
    ["donationId", "donation"],
  ] as const) {
    const financialRef = entityRef(
      key.endsWith("PartyId") ? "financial_party" :
        key === "obligationId" ? "financial_obligation" :
          key === "paymentId" ? "financial_payment" :
            key === "receivableId" ? "income_receivable" :
              key === "donationId" ? "donation" : "financial_entity",
      args[key],
      role,
    );
    if (financialRef && !entities.some((item) => item.entityType === financialRef.entityType && item.entityId === financialRef.entityId)) {
      entities.push(financialRef);
    }
  }

  if (toolName === "link_person_to_project" || toolName === "update_person_project_relationship") {
    const relationship = entityRef("project_person", record?.id, "subject");
    if (relationship) entities.push(relationship);
    if (!person) {
      const relationshipPerson = entityRef("person", record?.personId, "person");
      if (relationshipPerson) entities.push(relationshipPerson);
    }
    if (!project) {
      const relationshipProject = entityRef("project", record?.projectId, "project");
      if (relationshipProject) entities.push(relationshipProject);
    }
  }

  if (toolName === "create_typed_relationship" || toolName === "delete_typed_relationship") {
    const relationTypes: Record<string, [string, string]> = {
      project_people: ["project", "person"],
      task_people: ["task", "person"],
      task_projects: ["task", "project"],
      task_purposes: ["task", "purpose"],
      reminder_people: ["reminder", "person"],
      reminder_projects: ["reminder", "project"],
      reminder_tasks: ["reminder", "task"],
      commitment_people: ["commitment", "person"],
      commitment_projects: ["commitment", "project"],
      commitment_purposes: ["commitment", "purpose"],
    };
    const [leftType, rightType] = relationTypes[String(args.relation)] ?? [];
    const left = leftType ? entityRef(leftType, args.leftId, "left") : null;
    const right = rightType ? entityRef(rightType, args.rightId, "right") : null;
    if (left) entities.push(left);
    if (right) entities.push(right);
  }

  if (entities.length === 0) return;
  const sourceType = toolName === "link_person_to_project" || toolName === "update_person_project_relationship"
    ? "project_person"
    : toolName === "create_typed_relationship" || toolName === "delete_typed_relationship"
      ? "typed_relationship"
    : primaryType ?? "record";
  await recordActivityEvent(identity, {
    eventType: `${toolName}.completed`,
    sourceType,
    sourceId: typeof primaryId === "string" ? primaryId : null,
    summary: toolName,
    metadata: { toolName, args: Object.fromEntries(
      Object.entries(args).filter(([, value]) =>
        ["string", "number", "boolean"].includes(typeof value) || value === null,
      ),
    ) },
    entities,
  }, executor);
}

function iso(date: Date | null): string | null {
  return date?.toISOString() ?? null;
}

function serializeEvent(event: ActivityEvent) {
  return {
    id: event.id,
    eventType: event.eventType,
    sourceType: event.sourceType,
    sourceId: event.sourceId,
    actorType: event.actorType,
    summary: event.summary,
    metadata: event.metadata,
    occurredAt: event.occurredAt.toISOString(),
    createdAt: event.createdAt.toISOString(),
  };
}

async function timelineFor(identity: Identity, entityType: string, entityId: string, limit = 50, offset = 0) {
  const rows = await db.select({ event: activityEventsTable })
    .from(activityEventEntitiesTable)
    .innerJoin(activityEventsTable, eq(activityEventEntitiesTable.eventId, activityEventsTable.id))
    .where(and(
      eq(activityEventEntitiesTable.tenantId, identity.tenantId),
      eq(activityEventEntitiesTable.ownerUserId, identity.userId),
      eq(activityEventEntitiesTable.entityType, entityType),
      eq(activityEventEntitiesTable.entityId, entityId),
      eq(activityEventsTable.tenantId, identity.tenantId),
      eq(activityEventsTable.ownerUserId, identity.userId),
    ))
    .orderBy(desc(activityEventsTable.occurredAt))
    .limit(Math.min(Math.max(limit, 1), 100))
    .offset(Math.max(offset, 0));
  return rows.map(({ event }) => serializeEvent(event));
}

export async function getPersonGraph(identity: Identity, personId: string) {
  const [person] = await db.select().from(peopleTable).where(and(
    eq(peopleTable.id, personId),
    eq(peopleTable.tenantId, identity.tenantId),
    eq(peopleTable.ownerUserId, identity.userId),
  ));
  if (!person) return null;

  const [projects, expenses, commitments, linkedCommitments, tasks, reminders, financialParties, timeline] = await Promise.all([
    db.select({
      id: projectsTable.id,
      name: projectsTable.name,
      status: projectsTable.status,
      relationship: projectPeopleTable.relationship,
      relationshipId: projectPeopleTable.id,
      updatedAt: projectPeopleTable.updatedAt,
    }).from(projectPeopleTable)
      .innerJoin(projectsTable, eq(projectPeopleTable.projectId, projectsTable.id))
      .where(and(
        eq(projectPeopleTable.tenantId, identity.tenantId),
        eq(projectPeopleTable.ownerUserId, identity.userId),
        eq(projectPeopleTable.personId, personId),
        eq(projectsTable.tenantId, identity.tenantId),
        eq(projectsTable.ownerUserId, identity.userId),
      ))
      .orderBy(asc(projectsTable.name))
      .limit(GRAPH_LIMIT),
    db.select({
      id: expensesTable.id,
      amountMinor: expensesTable.amountMinor,
      currency: expensesTable.currency,
      description: expensesTable.description,
      personId: expensesTable.personId,
      projectId: expensesTable.projectId,
      projectName: projectsTable.name,
      purposeId: expensesTable.purposeId,
      purposeName: purposesTable.name,
      occurredAt: expensesTable.occurredAt,
    }).from(expensesTable)
      .leftJoin(projectsTable, and(
        eq(expensesTable.projectId, projectsTable.id),
        eq(projectsTable.tenantId, identity.tenantId),
        eq(projectsTable.ownerUserId, identity.userId),
      ))
      .leftJoin(purposesTable, and(
        eq(expensesTable.purposeId, purposesTable.id),
        eq(purposesTable.tenantId, identity.tenantId),
        eq(purposesTable.ownerUserId, identity.userId),
      ))
      .where(and(
        eq(expensesTable.tenantId, identity.tenantId),
        eq(expensesTable.ownerUserId, identity.userId),
        eq(expensesTable.personId, personId),
      ))
      .orderBy(desc(expensesTable.occurredAt))
      .limit(GRAPH_LIMIT),
    db.select({
      id: commitmentsTable.id,
      title: commitmentsTable.title,
      personId: commitmentsTable.personId,
      dueAt: commitmentsTable.dueAt,
      status: commitmentsTable.status,
    }).from(commitmentsTable).where(and(
      eq(commitmentsTable.tenantId, identity.tenantId),
      eq(commitmentsTable.ownerUserId, identity.userId),
      eq(commitmentsTable.personId, personId),
    )).orderBy(desc(commitmentsTable.createdAt)).limit(GRAPH_LIMIT),
    db.select({
      id: commitmentsTable.id,
      title: commitmentsTable.title,
      personId: commitmentsTable.personId,
      dueAt: commitmentsTable.dueAt,
      status: commitmentsTable.status,
      relationship: commitmentPeopleTable.relationship,
    }).from(commitmentPeopleTable)
      .innerJoin(commitmentsTable, eq(commitmentPeopleTable.commitmentId, commitmentsTable.id))
      .where(and(
        eq(commitmentPeopleTable.tenantId, identity.tenantId),
        eq(commitmentPeopleTable.ownerUserId, identity.userId),
        eq((commitmentPeopleTable as any).personId, personId),
        eq(commitmentsTable.tenantId, identity.tenantId),
        eq(commitmentsTable.ownerUserId, identity.userId),
      )).orderBy(desc(commitmentsTable.createdAt)).limit(GRAPH_LIMIT),
    db.select({
      id: tasksTable.id,
      title: tasksTable.title,
      dueAt: tasksTable.dueAt,
      status: tasksTable.status,
      relationship: taskPeopleTable.relationship,
      relationshipId: taskPeopleTable.id,
    }).from(taskPeopleTable)
      .innerJoin(tasksTable, eq(taskPeopleTable.taskId, tasksTable.id))
      .where(and(
        eq(taskPeopleTable.tenantId, identity.tenantId),
        eq(taskPeopleTable.ownerUserId, identity.userId),
        eq(taskPeopleTable.personId, personId),
        eq(tasksTable.tenantId, identity.tenantId),
        eq(tasksTable.ownerUserId, identity.userId),
      )).orderBy(desc(tasksTable.updatedAt)).limit(GRAPH_LIMIT),
    db.select({
      id: remindersTable.id,
      text: remindersTable.text,
      dueAt: remindersTable.dueAt,
      status: remindersTable.status,
      relationship: reminderPeopleTable.relationship,
      relationshipId: reminderPeopleTable.id,
    }).from(reminderPeopleTable)
      .innerJoin(remindersTable, eq(reminderPeopleTable.reminderId, remindersTable.id))
      .where(and(
        eq(reminderPeopleTable.tenantId, identity.tenantId),
        eq(reminderPeopleTable.ownerUserId, identity.userId),
        eq((reminderPeopleTable as any).personId, personId),
        eq(remindersTable.tenantId, identity.tenantId),
        eq(remindersTable.ownerUserId, identity.userId),
      )).orderBy(desc(remindersTable.dueAt)).limit(GRAPH_LIMIT),
    db.select({ id: financialPartiesTable.id, name: financialPartiesTable.name, partyType: financialPartiesTable.partyType, relationship: financialPartyPeopleTable.relationship })
      .from(financialPartyPeopleTable)
      .innerJoin(financialPartiesTable, eq(financialPartyPeopleTable.partyId, financialPartiesTable.id))
      .where(and(
        eq(financialPartyPeopleTable.tenantId, identity.tenantId),
        eq(financialPartyPeopleTable.ownerUserId, identity.userId),
        eq(financialPartyPeopleTable.personId, personId),
        eq(financialPartiesTable.tenantId, identity.tenantId),
        eq(financialPartiesTable.ownerUserId, identity.userId),
      )).limit(GRAPH_LIMIT),
    timelineFor(identity, "person", personId),
  ]);

  return {
    entity: { ...person, createdAt: person.createdAt.toISOString(), updatedAt: person.updatedAt.toISOString() },
    related: {
      projects: projects.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
      expenses: expenses.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
      commitments: [...commitments, ...linkedCommitments.filter((linked) => !commitments.some((item) => item.id === linked.id))]
        .map((row) => ({ ...row, dueAt: iso(row.dueAt) })),
      tasks: tasks.map((row) => ({ ...row, dueAt: iso(row.dueAt) })),
      reminders: reminders.map((row) => ({ ...row, dueAt: iso(row.dueAt) })),
      financialParties,
    },
    timeline,
  };
}

export async function getProjectGraph(identity: Identity, projectId: string) {
  const [project] = await db.select().from(projectsTable).where(and(
    eq(projectsTable.id, projectId),
    eq(projectsTable.tenantId, identity.tenantId),
    eq(projectsTable.ownerUserId, identity.userId),
  ));
  if (!project) return null;

  const [people, expenses, tasks, reminders, financialParties, timeline] = await Promise.all([
    db.select({
      id: peopleTable.id,
      name: peopleTable.name,
      notes: peopleTable.notes,
      relationship: projectPeopleTable.relationship,
      relationshipId: projectPeopleTable.id,
      updatedAt: projectPeopleTable.updatedAt,
    }).from(projectPeopleTable)
      .innerJoin(peopleTable, eq(projectPeopleTable.personId, peopleTable.id))
      .where(and(
        eq(projectPeopleTable.tenantId, identity.tenantId),
        eq(projectPeopleTable.ownerUserId, identity.userId),
        eq(projectPeopleTable.projectId, projectId),
        eq(peopleTable.tenantId, identity.tenantId),
        eq(peopleTable.ownerUserId, identity.userId),
      ))
      .orderBy(asc(peopleTable.name))
      .limit(GRAPH_LIMIT),
    db.select({
      id: expensesTable.id,
      amountMinor: expensesTable.amountMinor,
      currency: expensesTable.currency,
      description: expensesTable.description,
      personId: expensesTable.personId,
      personName: peopleTable.name,
      projectId: expensesTable.projectId,
      occurredAt: expensesTable.occurredAt,
    }).from(expensesTable)
      .leftJoin(peopleTable, and(
        eq(expensesTable.personId, peopleTable.id),
        eq(peopleTable.tenantId, identity.tenantId),
        eq(peopleTable.ownerUserId, identity.userId),
      ))
      .where(and(
        eq(expensesTable.tenantId, identity.tenantId),
        eq(expensesTable.ownerUserId, identity.userId),
        eq(expensesTable.projectId, projectId),
      ))
      .orderBy(desc(expensesTable.occurredAt))
      .limit(GRAPH_LIMIT),
    db.select({
      id: tasksTable.id,
      title: tasksTable.title,
      dueAt: tasksTable.dueAt,
      status: tasksTable.status,
      relationship: taskProjectsTable.relationship,
      relationshipId: taskProjectsTable.id,
    }).from(taskProjectsTable)
      .innerJoin(tasksTable, eq(taskProjectsTable.taskId, tasksTable.id))
      .where(and(
        eq(taskProjectsTable.tenantId, identity.tenantId),
        eq(taskProjectsTable.ownerUserId, identity.userId),
        eq(taskProjectsTable.projectId, projectId),
        eq(tasksTable.tenantId, identity.tenantId),
        eq(tasksTable.ownerUserId, identity.userId),
      )).orderBy(desc(tasksTable.updatedAt)).limit(GRAPH_LIMIT),
    db.select({
      id: remindersTable.id,
      text: remindersTable.text,
      dueAt: remindersTable.dueAt,
      status: remindersTable.status,
      relationship: reminderProjectsTable.relationship,
      relationshipId: reminderProjectsTable.id,
    }).from(reminderProjectsTable)
      .innerJoin(remindersTable, eq(reminderProjectsTable.reminderId, remindersTable.id))
      .where(and(
        eq(reminderProjectsTable.tenantId, identity.tenantId),
        eq(reminderProjectsTable.ownerUserId, identity.userId),
        eq((reminderProjectsTable as any).projectId, projectId),
        eq(remindersTable.tenantId, identity.tenantId),
        eq(remindersTable.ownerUserId, identity.userId),
      )).orderBy(desc(remindersTable.dueAt)).limit(GRAPH_LIMIT),
    db.select({ id: financialPartiesTable.id, name: financialPartiesTable.name, partyType: financialPartiesTable.partyType, relationship: financialPartyProjectsTable.relationship })
      .from(financialPartyProjectsTable)
      .innerJoin(financialPartiesTable, eq(financialPartyProjectsTable.partyId, financialPartiesTable.id))
      .where(and(
        eq(financialPartyProjectsTable.tenantId, identity.tenantId),
        eq(financialPartyProjectsTable.ownerUserId, identity.userId),
        eq(financialPartyProjectsTable.projectId, projectId),
        eq(financialPartiesTable.tenantId, identity.tenantId),
        eq(financialPartiesTable.ownerUserId, identity.userId),
      )).limit(GRAPH_LIMIT),
    timelineFor(identity, "project", projectId),
  ]);

  return {
    entity: { ...project, createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString() },
    related: {
      people: people.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
      expenses: expenses.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
      tasks: tasks.map((row) => ({ ...row, dueAt: iso(row.dueAt) })),
      reminders: reminders.map((row) => ({ ...row, dueAt: iso(row.dueAt) })),
      financialParties,
    },
    timeline,
  };
}

export async function getEntityTimeline(
  identity: Identity,
  entityType: GraphEntityType,
  entityId: string,
  limit = 50,
  offset = 0,
) {
  const entity = entityType === "person"
    ? await db.select({ id: peopleTable.id }).from(peopleTable).where(and(
      eq(peopleTable.id, entityId),
      eq(peopleTable.tenantId, identity.tenantId),
      eq(peopleTable.ownerUserId, identity.userId),
    ))
    : entityType === "project"
      ? await db.select({ id: projectsTable.id }).from(projectsTable).where(and(
      eq(projectsTable.id, entityId),
      eq(projectsTable.tenantId, identity.tenantId),
      eq(projectsTable.ownerUserId, identity.userId),
      ))
      : await db.select({ id: financialPartiesTable.id }).from(financialPartiesTable).where(and(
        eq(financialPartiesTable.id, entityId),
        eq(financialPartiesTable.tenantId, identity.tenantId),
        eq(financialPartiesTable.ownerUserId, identity.userId),
      ));
  if (!entity[0]) return null;
  return timelineFor(identity, entityType, entityId, limit, offset);
}

export async function getEntityGraph(identity: Identity, entityType: GraphEntityType, entityId: string) {
  if (entityType === "person") return getPersonGraph(identity, entityId);
  if (entityType === "project") return getProjectGraph(identity, entityId);
  const [party] = await db.select().from(financialPartiesTable).where(and(
    eq(financialPartiesTable.id, entityId),
    eq(financialPartiesTable.tenantId, identity.tenantId),
    eq(financialPartiesTable.ownerUserId, identity.userId),
  ));
  if (!party) return null;
  const [people, projects, purposes, timeline] = await Promise.all([
    db.select({ id: peopleTable.id, name: peopleTable.name, relationship: financialPartyPeopleTable.relationship })
      .from(financialPartyPeopleTable)
      .innerJoin(peopleTable, eq(financialPartyPeopleTable.personId, peopleTable.id))
      .where(and(
        eq(financialPartyPeopleTable.partyId, entityId),
        eq(financialPartyPeopleTable.tenantId, identity.tenantId),
        eq(financialPartyPeopleTable.ownerUserId, identity.userId),
        eq(peopleTable.tenantId, identity.tenantId),
        eq(peopleTable.ownerUserId, identity.userId),
      )).limit(GRAPH_LIMIT),
    db.select({ id: projectsTable.id, name: projectsTable.name, relationship: financialPartyProjectsTable.relationship })
      .from(financialPartyProjectsTable)
      .innerJoin(projectsTable, eq(financialPartyProjectsTable.projectId, projectsTable.id))
      .where(and(
        eq(financialPartyProjectsTable.partyId, entityId),
        eq(financialPartyProjectsTable.tenantId, identity.tenantId),
        eq(financialPartyProjectsTable.ownerUserId, identity.userId),
        eq(projectsTable.tenantId, identity.tenantId),
        eq(projectsTable.ownerUserId, identity.userId),
      )).limit(GRAPH_LIMIT),
    db.select({ id: purposesTable.id, name: purposesTable.name })
      .from(financialPartyPurposesTable)
      .innerJoin(purposesTable, eq(financialPartyPurposesTable.purposeId, purposesTable.id))
      .where(and(
        eq(financialPartyPurposesTable.partyId, entityId),
        eq(financialPartyPurposesTable.tenantId, identity.tenantId),
        eq(financialPartyPurposesTable.ownerUserId, identity.userId),
        eq(purposesTable.tenantId, identity.tenantId),
        eq(purposesTable.ownerUserId, identity.userId),
      )).limit(GRAPH_LIMIT),
    timelineFor(identity, "financial_party", entityId),
  ]);
  return {
    entity: party,
    related: { people, projects, purposes },
    relationships: { people, projects, purposes },
    timeline,
    capabilities: { canEdit: true, canDelete: false },
  };
}