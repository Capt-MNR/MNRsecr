import { and, eq } from "drizzle-orm";
import {
  commitmentPeopleTable,
  commitmentProjectsTable,
  commitmentPurposesTable,
  commitmentsTable,
  db,
  peopleTable,
  projectPeopleTable,
  projectsTable,
  purposesTable,
  reminderPeopleTable,
  reminderProjectsTable,
  reminderTasksTable,
  remindersTable,
  taskPeopleTable,
  taskProjectsTable,
  taskPurposesTable,
  tasksTable,
} from "@workspace/db";
import type { DbExecutor, Identity } from "./entity-graph";

export const RELATION_TYPES = [
  "project_people",
  "task_people",
  "task_projects",
  "task_purposes",
  "reminder_people",
  "reminder_projects",
  "reminder_tasks",
  "commitment_people",
  "commitment_projects",
  "commitment_purposes",
] as const;

export type RelationType = typeof RELATION_TYPES[number];

type RelationConfig = {
  table: any;
  leftKey: string;
  leftTable: any;
  rightKey: string;
  rightTable: any;
};

const configs: Record<RelationType, RelationConfig> = {
  project_people: { table: projectPeopleTable, leftKey: "projectId", leftTable: projectsTable, rightKey: "personId", rightTable: peopleTable },
  task_people: { table: taskPeopleTable, leftKey: "taskId", leftTable: tasksTable, rightKey: "personId", rightTable: peopleTable },
  task_projects: { table: taskProjectsTable, leftKey: "taskId", leftTable: tasksTable, rightKey: "projectId", rightTable: projectsTable },
  task_purposes: { table: taskPurposesTable, leftKey: "taskId", leftTable: tasksTable, rightKey: "purposeId", rightTable: purposesTable },
  reminder_people: { table: reminderPeopleTable, leftKey: "reminderId", leftTable: remindersTable, rightKey: "personId", rightTable: peopleTable },
  reminder_projects: { table: reminderProjectsTable, leftKey: "reminderId", leftTable: remindersTable, rightKey: "projectId", rightTable: projectsTable },
  reminder_tasks: { table: reminderTasksTable, leftKey: "reminderId", leftTable: remindersTable, rightKey: "taskId", rightTable: tasksTable },
  commitment_people: { table: commitmentPeopleTable, leftKey: "commitmentId", leftTable: commitmentsTable, rightKey: "personId", rightTable: peopleTable },
  commitment_projects: { table: commitmentProjectsTable, leftKey: "commitmentId", leftTable: commitmentsTable, rightKey: "projectId", rightTable: projectsTable },
  commitment_purposes: { table: commitmentPurposesTable, leftKey: "commitmentId", leftTable: commitmentsTable, rightKey: "purposeId", rightTable: purposesTable },
};

function configFor(relation: unknown): RelationConfig {
  if (typeof relation !== "string" || !RELATION_TYPES.includes(relation as RelationType)) {
    throw new Error("Unknown typed relationship.");
  }
  return configs[relation as RelationType];
}

async function accessible(identity: Identity, table: any, id: string, executor: DbExecutor = db) {
  const [row] = await executor.select({ id: table.id }).from(table).where(and(
    eq(table.id, id),
    eq(table.tenantId, identity.tenantId),
    eq(table.ownerUserId, identity.userId),
  ));
  if (!row) throw new Error("Related entity is not accessible.");
}

export async function createTypedRelationship(
  identity: Identity,
  args: Record<string, unknown>,
  executor: DbExecutor = db,
) {
  const relation = String(args.relation ?? "");
  const config = configFor(relation);
  const leftId = typeof args.leftId === "string" ? args.leftId : "";
  const rightId = typeof args.rightId === "string" ? args.rightId : "";
  if (!leftId || !rightId) throw new Error("leftId and rightId are required.");
  await accessible(identity, config.leftTable, leftId, executor);
  await accessible(identity, config.rightTable, rightId, executor);
  const values = {
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    [config.leftKey]: leftId,
    [config.rightKey]: rightId,
    relationship: typeof args.relationship === "string" ? args.relationship.trim() || null : null,
  };
  const createdRows = await executor.insert(config.table).values(values).onConflictDoNothing().returning() as any[];
  const created = createdRows[0];
  if (created) return { relation, relationship: created };
  const [existing] = await executor.select().from(config.table).where(and(
    eq(config.table.tenantId, identity.tenantId),
    eq(config.table.ownerUserId, identity.userId),
    eq(config.table[config.leftKey], leftId),
    eq(config.table[config.rightKey], rightId),
  ));
  if (!existing) throw new Error("Could not save the typed relationship.");
  return { relation, relationship: existing, created: false };
}

export async function deleteTypedRelationship(identity: Identity, args: Record<string, unknown>, executor: DbExecutor = db) {
  const relation = String(args.relation ?? "");
  const config = configFor(relation);
  const relationshipId = typeof args.relationshipId === "string" ? args.relationshipId : "";
  if (!relationshipId) throw new Error("relationshipId is required.");
  const deletedRows = await executor.delete(config.table).where(and(
    eq(config.table.id, relationshipId),
    eq(config.table.tenantId, identity.tenantId),
    eq(config.table.ownerUserId, identity.userId),
  )).returning() as any[];
  const deleted = deletedRows[0];
  if (!deleted) throw new Error("Typed relationship is not accessible.");
  return { relation, relationship: deleted };
}

export async function listTypedRelationships(
  identity: Identity,
  relation: string,
  side: "left" | "right",
  entityId: string,
) {
  const config = configFor(relation);
  const key = side === "left" ? config.leftKey : config.rightKey;
  await accessible(identity, side === "left" ? config.leftTable : config.rightTable, entityId);
  return db.select().from(config.table).where(and(
    eq(config.table.tenantId, identity.tenantId),
    eq(config.table.ownerUserId, identity.userId),
    eq(config.table[key], entityId),
  )).limit(100);
}