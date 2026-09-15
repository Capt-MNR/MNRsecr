import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  db,
  peopleTable,
  projectsTable,
  projectPeopleTable,
  tasksTable,
  taskPeopleTable,
} from "@workspace/db";
import {
  createTypedRelationship,
  deleteTypedRelationship,
  listTypedRelationships,
} from "../src/lib/relationship-graph";
import { createFinancialParty } from "../src/lib/financial-graph";

const identity = { tenantId: `relationship-test-${process.pid}-${Date.now()}`, userId: "relationship-user" };
const other = { tenantId: `${identity.tenantId}-other`, userId: "relationship-user" };

async function cleanup() {
  for (const table of [taskPeopleTable, projectPeopleTable, tasksTable, projectsTable, peopleTable]) {
    await db.delete(table).where(and(eq(table.tenantId, identity.tenantId), eq(table.ownerUserId, identity.userId)));
    await db.delete(table).where(and(eq(table.tenantId, other.tenantId), eq(table.ownerUserId, other.userId)));
  }
}

test("creates, lists, and deletes typed relationships within one tenant", async () => {
  await cleanup();
  const [person] = await db.insert(peopleTable).values({
    tenantId: identity.tenantId, ownerUserId: identity.userId, name: "شخص العلاقة", nameKey: "شخص العلاقة",
  }).returning();
  const [project] = await db.insert(projectsTable).values({
    tenantId: identity.tenantId, ownerUserId: identity.userId, name: "مشروع العلاقة", nameKey: "مشروع العلاقة",
  }).returning();
  const [task] = await db.insert(tasksTable).values({
    tenantId: identity.tenantId, ownerUserId: identity.userId, title: "مهمة العلاقة",
  }).returning();
  const projectLink = await createTypedRelationship(identity, {
    relation: "project_people", leftId: project.id, rightId: person.id, relationship: "owner",
  });
  const taskLink = await createTypedRelationship(identity, {
    relation: "task_people", leftId: task.id, rightId: person.id, relationship: "assignee",
  });
  const personProjects = await listTypedRelationships(identity, "project_people", "right", person.id);
  const personTasks = await listTypedRelationships(identity, "task_people", "right", person.id);
  assert.equal(personProjects.length, 1);
  assert.equal(personTasks.length, 1);
  await deleteTypedRelationship(identity, {
    relation: "project_people", relationshipId: projectLink.relationship.id,
  });
  assert.equal((await listTypedRelationships(identity, "project_people", "right", person.id)).length, 0);
  assert.equal(taskLink.relationship.relationship, "assignee");
  await cleanup();
});

test("rejects cross-tenant relationship traversal and party links", async () => {
  await cleanup();
  const [foreignPerson] = await db.insert(peopleTable).values({
    tenantId: other.tenantId, ownerUserId: other.userId, name: "شخص مستأجر آخر", nameKey: "شخص مستأجر آخر",
  }).returning();
  const [project] = await db.insert(projectsTable).values({
    tenantId: identity.tenantId, ownerUserId: identity.userId, name: "مشروع معزول", nameKey: "مشروع معزول",
  }).returning();
  await assert.rejects(createTypedRelationship(identity, {
    relation: "project_people", leftId: project.id, rightId: foreignPerson.id,
  }), /not accessible/);
  const party = await createFinancialParty(other, { partyType: "external", name: "طرف مستأجر آخر" });
  await assert.rejects(createTypedRelationship(identity, {
    relation: "project_people", leftId: project.id, rightId: party.id,
  }), /not accessible/);
  await cleanup();
}
);