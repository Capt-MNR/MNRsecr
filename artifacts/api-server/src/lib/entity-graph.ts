import { and, asc, desc, eq } from "drizzle-orm";
import {
  activityEventEntitiesTable,
  activityEventsTable,
  commitmentsTable,
  db,
  expensesTable,
  peopleTable,
  projectPeopleTable,
  projectsTable,
  purposesTable,
  type ActivityEvent,
} from "@workspace/db";

export type GraphEntityType = "person" | "project";
export type Identity = { tenantId: string; userId: string };

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
) {
  return db.transaction(async (tx) => {
    const [event] = await tx.insert(activityEventsTable).values({
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
      await tx.insert(activityEventEntitiesTable).values(
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
  });
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
  return null;
}

export async function recordToolActivity(
  identity: Identity,
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
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

  if (entities.length === 0) return;
  const sourceType = toolName === "link_person_to_project" || toolName === "update_person_project_relationship"
    ? "project_person"
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
  });
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

async function timelineFor(identity: Identity, entityType: GraphEntityType, entityId: string) {
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
    .limit(100);
  return rows.map(({ event }) => serializeEvent(event));
}

export async function getPersonGraph(identity: Identity, personId: string) {
  const [person] = await db.select().from(peopleTable).where(and(
    eq(peopleTable.id, personId),
    eq(peopleTable.tenantId, identity.tenantId),
    eq(peopleTable.ownerUserId, identity.userId),
  ));
  if (!person) return null;

  const [projects, expenses, commitments, timeline] = await Promise.all([
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
      .orderBy(asc(projectsTable.name)),
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
      .orderBy(desc(expensesTable.occurredAt)),
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
    )).orderBy(desc(commitmentsTable.createdAt)),
    timelineFor(identity, "person", personId),
  ]);

  return {
    entity: { ...person, createdAt: person.createdAt.toISOString(), updatedAt: person.updatedAt.toISOString() },
    related: {
      projects: projects.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
      expenses: expenses.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
      commitments: commitments.map((row) => ({ ...row, dueAt: iso(row.dueAt) })),
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

  const [people, expenses, timeline] = await Promise.all([
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
      .orderBy(asc(peopleTable.name)),
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
      .orderBy(desc(expensesTable.occurredAt)),
    timelineFor(identity, "project", projectId),
  ]);

  return {
    entity: { ...project, createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString() },
    related: {
      people: people.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
      expenses: expenses.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
    },
    timeline,
  };
}

export async function getEntityTimeline(identity: Identity, entityType: GraphEntityType, entityId: string) {
  const entity = entityType === "person"
    ? await db.select({ id: peopleTable.id }).from(peopleTable).where(and(
      eq(peopleTable.id, entityId),
      eq(peopleTable.tenantId, identity.tenantId),
      eq(peopleTable.ownerUserId, identity.userId),
    ))
    : await db.select({ id: projectsTable.id }).from(projectsTable).where(and(
      eq(projectsTable.id, entityId),
      eq(projectsTable.tenantId, identity.tenantId),
      eq(projectsTable.ownerUserId, identity.userId),
    ));
  if (!entity[0]) return null;
  return timelineFor(identity, entityType, entityId);
}