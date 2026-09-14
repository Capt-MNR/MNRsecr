import { z } from "zod";

const optionalDisplayName = z.string().trim().min(1).optional();
const nullableUuid = z.string().uuid().nullable().optional();

export const expenseApprovalSchema = z.object({
  amountMinor: z.number().int().positive().safe(),
  currency: z.string().trim().min(1).max(10),
  description: z.string().trim().min(1).max(500),
  personId: nullableUuid,
  projectId: nullableUuid,
  // Display-only labels. The server strips these before persisting/executing args.
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
    personName: _personName,
    projectName: _projectName,
    personCandidates: _personCandidates,
    projectCandidates: _projectCandidates,
    ...persisted
  } = args;
  return persisted;
}