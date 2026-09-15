import { z } from "zod";

const optionalDisplayName = z.string().trim().min(1).optional();
const nullableUuid = z.string().uuid().nullable().optional();

export const expenseApprovalSchema = z.object({
  amountMinor: z.number().int().positive().safe(),
  currency: z.string().trim().min(1).max(10),
  description: z.string().trim().min(1).max(500),
  personId: nullableUuid,
  projectId: nullableUuid,
  // Candidate lists are display-only. Names remain part of the stored operation
  // because the approved executor uses them when no UUID was resolved.
  personName: optionalDisplayName,
  projectName: optionalDisplayName,
  personCandidates: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1),
    status: z.string().optional(),
  })).optional(),
  projectCandidates: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1),
    status: z.string().optional(),
  })).optional(),
  occurredAt: z.string().datetime().optional(),
}).strict();

export const reminderApprovalSchema = z.object({
  text: z.string().trim().min(1).max(500),
  dueAt: z.string().datetime(),
  timezone: z.string().trim().min(1).max(100),
}).strict();

export const approvalRequestSchema = z.object({
  args: z.record(z.string(), z.unknown()).optional(),
  // Older clients may send these fields when approving. They are accepted for
  // compatibility but never used to choose or replace the stored operation.
  toolName: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const approvalOperationIdSchema = z.string().uuid();

export type ExpenseApprovalArgs = z.infer<typeof expenseApprovalSchema>;
export type ReminderApprovalArgs = z.infer<typeof reminderApprovalSchema>;

export function approvalSchemaForTool(toolName: string) {
  if (toolName === "record_expense") return expenseApprovalSchema;
  if (toolName === "create_reminder") return reminderApprovalSchema;
  return null;
}

export function persistedApprovalArgs(args: Record<string, unknown>): Record<string, unknown> {
  const {
    personCandidates: _personCandidates,
    projectCandidates: _projectCandidates,
    ...persisted
  } = args;
  return persisted;
}