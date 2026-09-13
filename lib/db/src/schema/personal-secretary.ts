import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const ownershipColumns = {
  tenantId: text("tenant_id").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
};

export const peopleTable = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("people_owner_name_key_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.nameKey,
    ),
  ],
);

export const projectsTable = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("projects_owner_name_key_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.nameKey,
    ),
  ],
);

export const expensesTable = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    description: text("description").notNull(),
    personId: uuid("person_id").references(() => peopleTable.id),
    projectId: uuid("project_id").references(() => projectsTable.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("expenses_owner_occurred_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.occurredAt,
    ),
  ],
);

export const remindersTable = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    text: text("text").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull().default("Africa/Cairo"),
    status: text("status").notNull().default("scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("reminders_owner_due_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.dueAt,
    ),
  ],
);

export const tasksTable = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    title: text("title").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tasks_owner_status_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.status,
    ),
  ],
);

export const projectPeopleTable = pgTable(
  "project_people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => peopleTable.id),
    relationship: text("relationship"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("project_people_owner_pair_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.projectId,
      table.personId,
    ),
  ],
);

export const commitmentsTable = pgTable(
  "commitments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    title: text("title").notNull(),
    personId: uuid("person_id").references(() => peopleTable.id),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("commitments_owner_status_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.status,
    ),
  ],
);

export const idempotencyRecordsTable = pgTable(
  "idempotency_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    key: text("key").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idempotency_owner_key_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.key,
    ),
  ],
);

export const secretaryOperationsTable = pgTable(
  "secretary_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    conversationId: text("conversation_id"),
    idempotencyKey: text("idempotency_key"),
    toolName: text("tool_name").notNull(),
    argumentsJson: text("arguments_json").notNull(),
    displayJson: text("display_json").notNull(),
    status: text("status").notNull().default("pending"),
    resultJson: text("result_json"),
    errorJson: text("error_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    index("secretary_operations_owner_status_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.status,
    ),
    index("secretary_operations_owner_conversation_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.conversationId,
    ),
    uniqueIndex("secretary_operations_owner_idempotency_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.idempotencyKey,
    ),
  ],
);

export const conversationMemoryTable = pgTable(
  "conversation_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    conversationId: text("conversation_id").notNull(),
    recentStateJson: text("recent_state_json").notNull().default("[]"),
    summary: text("summary"),
    turnCount: bigint("turn_count", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("conversation_memory_owner_conversation_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.conversationId,
    ),
    index("conversation_memory_owner_updated_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.updatedAt,
    ),
  ],
);

export const insertPersonSchema = createInsertSchema(peopleTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertExpenseSchema = createInsertSchema(expensesTable).omit({
  id: true,
  createdAt: true,
});
export const insertReminderSchema = createInsertSchema(remindersTable).omit({
  id: true,
  createdAt: true,
});

export type Person = typeof peopleTable.$inferSelect;
export type Project = typeof projectsTable.$inferSelect;
export type Expense = typeof expensesTable.$inferSelect;
export type Reminder = typeof remindersTable.$inferSelect;
export type Task = typeof tasksTable.$inferSelect;
export type ProjectPerson = typeof projectPeopleTable.$inferSelect;
export type Commitment = typeof commitmentsTable.$inferSelect;
export type ConversationMemory = typeof conversationMemoryTable.$inferSelect;
export type SecretaryOperation = typeof secretaryOperationsTable.$inferSelect;
export type InsertPerson = z.infer<typeof insertPersonSchema>;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type InsertReminder = z.infer<typeof insertReminderSchema>;