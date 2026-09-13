import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  commitmentsTable,
  db,
  expensesTable,
  peopleTable,
  projectsTable,
  remindersTable,
  tasksTable,
} from "@workspace/db";
import {
  ListRecordsResponse,
  UpdateRecordBody,
  UpdateRecordResponse,
  DeleteRecordResponse,
  UndoCreatedRecordBody,
  UndoCreatedRecordResponse,
} from "@workspace/api-zod";
import {
  executeStructuredTool,
  type ProviderName,
} from "../lib/phase2";
import type { Identity } from "../lib/secretary";
import {
  requireIdentity,
  requestId,
  sendRouteError,
} from "./route-context";

const router: IRouter = Router();
const recordTypes = new Set(["expense", "person", "project", "task", "reminder", "commitment"]);
type RecordKind = "expense" | "person" | "project" | "task" | "reminder" | "commitment";

function isRecordKind(value: string): value is RecordKind {
  return recordTypes.has(value as RecordKind);
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

async function listRecords(identity: Identity) {
  const [expenses, people, projects, tasks, reminders, commitments] = await Promise.all([
    db.select({
      id: expensesTable.id,
      amountMinor: expensesTable.amountMinor,
      currency: expensesTable.currency,
      description: expensesTable.description,
      personId: expensesTable.personId,
      personName: peopleTable.name,
      projectId: expensesTable.projectId,
      projectName: projectsTable.name,
      occurredAt: expensesTable.occurredAt,
      createdAt: expensesTable.createdAt,
    }).from(expensesTable)
      .leftJoin(peopleTable, and(
        eq(expensesTable.personId, peopleTable.id),
        eq(peopleTable.tenantId, identity.tenantId),
        eq(peopleTable.ownerUserId, identity.userId),
      ))
      .leftJoin(projectsTable, and(
        eq(expensesTable.projectId, projectsTable.id),
        eq(projectsTable.tenantId, identity.tenantId),
        eq(projectsTable.ownerUserId, identity.userId),
      ))
      .where(and(eq(expensesTable.tenantId, identity.tenantId), eq(expensesTable.ownerUserId, identity.userId)))
      .orderBy(desc(expensesTable.occurredAt)).limit(100),
    db.select().from(peopleTable).where(and(eq(peopleTable.tenantId, identity.tenantId), eq(peopleTable.ownerUserId, identity.userId))).orderBy(desc(peopleTable.updatedAt)).limit(100),
    db.select().from(projectsTable).where(and(eq(projectsTable.tenantId, identity.tenantId), eq(projectsTable.ownerUserId, identity.userId))).orderBy(desc(projectsTable.updatedAt)).limit(100),
    db.select().from(tasksTable).where(and(eq(tasksTable.tenantId, identity.tenantId), eq(tasksTable.ownerUserId, identity.userId))).orderBy(desc(tasksTable.createdAt)).limit(100),
    db.select().from(remindersTable).where(and(eq(remindersTable.tenantId, identity.tenantId), eq(remindersTable.ownerUserId, identity.userId))).orderBy(desc(remindersTable.dueAt)).limit(100),
    db.select({
      id: commitmentsTable.id,
      title: commitmentsTable.title,
      personId: commitmentsTable.personId,
      personName: peopleTable.name,
      dueAt: commitmentsTable.dueAt,
      status: commitmentsTable.status,
      createdAt: commitmentsTable.createdAt,
    }).from(commitmentsTable)
      .leftJoin(peopleTable, and(
        eq(commitmentsTable.personId, peopleTable.id),
        eq(peopleTable.tenantId, identity.tenantId),
        eq(peopleTable.ownerUserId, identity.userId),
      ))
      .where(and(eq(commitmentsTable.tenantId, identity.tenantId), eq(commitmentsTable.ownerUserId, identity.userId)))
      .orderBy(desc(commitmentsTable.createdAt)).limit(100),
  ]);
  return {
    expenses: expenses.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString(), createdAt: row.createdAt.toISOString() })),
    people: people.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })),
    projects: projects.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })),
    tasks: tasks.map((row) => ({ ...row, dueAt: iso(row.dueAt), createdAt: row.createdAt.toISOString() })),
    reminders: reminders.map((row) => ({ ...row, dueAt: row.dueAt.toISOString(), createdAt: row.createdAt.toISOString() })),
    commitments: commitments.map((row) => ({ ...row, dueAt: iso(row.dueAt), createdAt: row.createdAt.toISOString() })),
  };
}

router.get("/records", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  try {
    res.json(ListRecordsResponse.parse(await listRecords(identity)));
  } catch (error) {
    req.log.error({ error }, "Records list failed");
    sendRouteError(req, res, 500, "تعذر تحميل السجلات.", "RECORDS_READ_FAILED");
  }
});

function toolForUpdate(kind: RecordKind): string {
  return {
    expense: "update_expense",
    person: "update_person",
    project: "update_project",
    task: "update_task",
    reminder: "update_reminder",
    commitment: "update_commitment",
  }[kind];
}

function toolForDelete(kind: RecordKind): string {
  return `delete_${kind}`;
}

function updateArgs(kind: RecordKind, id: string, body: Record<string, unknown>): Record<string, unknown> {
  if (kind === "expense") return { expenseId: id, ...body };
  if (kind === "person") return { personId: id, ...body };
  if (kind === "project") return { projectId: id, ...body };
  if (kind === "task") return { taskId: id, ...body };
  if (kind === "reminder") return { reminderId: id, ...body };
  return { commitmentId: id, ...body };
}

function resultRecord(result: Record<string, unknown>, kind: RecordKind): Record<string, unknown> | undefined {
  return (result[kind] ?? result[`${kind}Record`]) as Record<string, unknown> | undefined;
}

function resultDeletedRecord(result: Record<string, unknown>, kind: RecordKind): Record<string, unknown> | undefined {
  return result[`deleted${kind[0].toUpperCase()}${kind.slice(1)}`] as Record<string, unknown> | undefined;
}

router.patch("/records/:recordType/:recordId", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const kind = req.params.recordType;
  if (!isRecordKind(kind)) {
    sendRouteError(req, res, 400, "نوع السجل غير صالح.", "INVALID_RECORD_TYPE");
    return;
  }
  const parsed = UpdateRecordBody.safeParse(req.body);
  if (!parsed.success) {
    sendRouteError(req, res, 400, "بيانات تعديل السجل غير صالحة.", "INVALID_RECORD_UPDATE");
    return;
  }
  try {
    const result = await executeStructuredTool(identity, toolForUpdate(kind), updateArgs(kind, req.params.recordId, parsed.data), { requestId: requestId(req) });
    if (!result.ok) {
      sendRouteError(req, res, 404, String(result.error ?? "السجل غير موجود."), "RECORD_UPDATE_FAILED");
      return;
    }
    const record = resultRecord(result, kind);
    res.json(UpdateRecordResponse.parse({ ok: true, recordType: kind, recordId: req.params.recordId, record }));
  } catch (error) {
    req.log.error({ error, recordType: kind }, "Record update failed");
    sendRouteError(req, res, 500, "تعذر تعديل السجل.", "RECORD_UPDATE_FAILED");
  }
});

router.delete("/records/:recordType/:recordId", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const kind = req.params.recordType;
  if (!isRecordKind(kind)) {
    sendRouteError(req, res, 400, "نوع السجل غير صالح.", "INVALID_RECORD_TYPE");
    return;
  }
  try {
    const result = await executeStructuredTool(identity, toolForDelete(kind), {
      [`${kind}Id`]: req.params.recordId,
    }, { requestId: requestId(req) });
    if (!result.ok) {
      const message = String(result.error ?? "السجل غير موجود.");
      const isDependencyConflict = message.includes("has saved records");
      sendRouteError(
        req,
        res,
        isDependencyConflict ? 409 : 404,
        isDependencyConflict
          ? "لا يمكن حذف هذا السجل لأنه مرتبط بسجلات محفوظة. احذف الروابط أو السجلات المرتبطة أولًا."
          : message,
        isDependencyConflict ? "RECORD_DELETE_CONFLICT" : "RECORD_DELETE_FAILED",
      );
      return;
    }
    res.json(DeleteRecordResponse.parse({
      ok: true,
      deleted: true,
      recordType: kind,
      recordId: req.params.recordId,
      record: resultDeletedRecord(result, kind),
    }));
  } catch (error) {
    req.log.error({ error, recordType: kind }, "Record delete failed");
    sendRouteError(req, res, 500, "تعذر حذف السجل.", "RECORD_DELETE_FAILED");
  }
});

router.post("/records/undo", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const parsed = UndoCreatedRecordBody.safeParse(req.body);
  if (!parsed.success) {
    sendRouteError(req, res, 400, "بيانات التراجع غير صالحة.", "INVALID_UNDO");
    return;
  }
  const { recordType, recordId, createdAt } = parsed.data;
  try {
    const result = await executeStructuredTool(identity, toolForDelete(recordType), {
      [`${recordType}Id`]: recordId,
      expectedCreatedAt: createdAt,
    }, { requestId: requestId(req) });
    if (!result.ok) {
      sendRouteError(req, res, 404, String(result.error ?? "لا يمكن التراجع عن هذا السجل."), "UNDO_NOT_APPLIED");
      return;
    }
    res.json(UndoCreatedRecordResponse.parse({
      ok: true,
      deleted: true,
      recordType,
      recordId,
      record: resultDeletedRecord(result, recordType),
    }));
  } catch (error) {
    req.log.error({ error }, "Record undo failed");
    sendRouteError(req, res, 500, "تعذر تنفيذ التراجع.", "UNDO_FAILED");
  }
});

export default router;