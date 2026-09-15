import {
  bigint,
  index,
  integer,
  jsonb,
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
    rowVersion: integer("row_version").notNull().default(1),
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
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    index("projects_owner_name_key_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.nameKey,
    ),
  ],
);

export const purposesTable = pgTable(
  "purposes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("purposes_owner_name_key_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.nameKey,
    ),
  ],
);

export const financialPartiesTable = pgTable(
  "financial_parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    partyType: text("party_type").notNull(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    index("financial_parties_owner_name_key_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.nameKey,
    ),
  ],
);

export const financialPartyPeopleTable = pgTable(
  "financial_party_people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    partyId: uuid("party_id").notNull().references(() => financialPartiesTable.id),
    personId: uuid("person_id").notNull().references(() => peopleTable.id),
    relationship: text("relationship"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("financial_party_people_owner_pair_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.partyId,
      table.personId,
    ),
  ],
);

export const financialPartyProjectsTable = pgTable(
  "financial_party_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    partyId: uuid("party_id").notNull().references(() => financialPartiesTable.id),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id),
    relationship: text("relationship"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("financial_party_projects_owner_pair_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.partyId,
      table.projectId,
    ),
  ],
);

export const financialPartyPurposesTable = pgTable(
  "financial_party_purposes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    partyId: uuid("party_id").notNull().references(() => financialPartiesTable.id),
    purposeId: uuid("purpose_id").notNull().references(() => purposesTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("financial_party_purposes_owner_pair_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.partyId,
      table.purposeId,
    ),
  ],
);

export const financialObligationsTable = pgTable(
  "financial_obligations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    lenderPartyId: uuid("lender_party_id").notNull().references(() => financialPartiesTable.id),
    borrowerPartyId: uuid("borrower_party_id").notNull().references(() => financialPartiesTable.id),
    principalAmountMinor: bigint("principal_amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    purposeId: uuid("purpose_id").references(() => purposesTable.id),
    projectId: uuid("project_id").references(() => projectsTable.id),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    index("financial_obligations_owner_status_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.status,
    ),
    index("financial_obligations_owner_due_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.dueAt,
    ),
  ],
);

export const financialPaymentsTable = pgTable(
  "financial_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    paymentKind: text("payment_kind").notNull().default("general"),
    payerPartyId: uuid("payer_party_id").notNull().references(() => financialPartiesTable.id),
    payeePartyId: uuid("payee_party_id").notNull().references(() => financialPartiesTable.id),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    description: text("description"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    index("financial_payments_owner_occurred_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.occurredAt,
    ),
  ],
);

export const obligationSettlementsTable = pgTable(
  "obligation_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    obligationId: uuid("obligation_id").notNull().references(() => financialObligationsTable.id),
    paymentId: uuid("payment_id").notNull().references(() => financialPaymentsTable.id),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("obligation_settlements_owner_obligation_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.obligationId,
      table.settledAt,
    ),
    uniqueIndex("obligation_settlements_owner_payment_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.obligationId,
      table.paymentId,
    ),
  ],
);

export const donationsTable = pgTable(
  "donations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    donorPartyId: uuid("donor_party_id").notNull().references(() => financialPartiesTable.id),
    recipientPartyId: uuid("recipient_party_id").notNull().references(() => financialPartiesTable.id),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    purposeId: uuid("purpose_id").references(() => purposesTable.id),
    projectId: uuid("project_id").references(() => projectsTable.id),
    description: text("description"),
    status: text("status").notNull().default("pledged"),
    pledgedAt: timestamp("pledged_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    index("donations_owner_status_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.status,
    ),
  ],
);

export const incomeReceivablesTable = pgTable(
  "income_receivables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    creditorPartyId: uuid("creditor_party_id").notNull().references(() => financialPartiesTable.id),
    debtorPartyId: uuid("debtor_party_id").notNull().references(() => financialPartiesTable.id),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    purposeId: uuid("purpose_id").references(() => purposesTable.id),
    projectId: uuid("project_id").references(() => projectsTable.id),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    index("income_receivables_owner_status_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.status,
    ),
  ],
);

export const paymentLinksTable = pgTable(
  "payment_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    token: text("token").notNull(),
    paymentId: uuid("payment_id").references(() => financialPaymentsTable.id),
    receivableId: uuid("receivable_id").references(() => incomeReceivablesTable.id),
    donationId: uuid("donation_id").references(() => donationsTable.id),
    provider: text("provider").notNull().default("internal"),
    status: text("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_links_owner_token_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.token,
    ),
    index("payment_links_owner_status_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.status,
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
    purposeId: uuid("purpose_id").references(() => purposesTable.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
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
    rowVersion: integer("row_version").notNull().default(1),
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

export const taskPeopleTable = pgTable(
  "task_people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    taskId: uuid("task_id").notNull().references(() => tasksTable.id),
    personId: uuid("person_id").notNull().references(() => peopleTable.id),
    relationship: text("relationship"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("task_people_owner_pair_unique").on(
      table.tenantId, table.ownerUserId, table.taskId, table.personId,
    ),
    index("task_people_owner_person_idx").on(table.tenantId, table.ownerUserId, table.personId),
  ],
);

export const taskProjectsTable = pgTable(
  "task_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    taskId: uuid("task_id").notNull().references(() => tasksTable.id),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id),
    relationship: text("relationship"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("task_projects_owner_pair_unique").on(
      table.tenantId, table.ownerUserId, table.taskId, table.projectId,
    ),
    index("task_projects_owner_project_idx").on(table.tenantId, table.ownerUserId, table.projectId),
  ],
);

export const taskPurposesTable = pgTable(
  "task_purposes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    taskId: uuid("task_id").notNull().references(() => tasksTable.id),
    purposeId: uuid("purpose_id").notNull().references(() => purposesTable.id),
    relationship: text("relationship"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("task_purposes_owner_pair_unique").on(
      table.tenantId, table.ownerUserId, table.taskId, table.purposeId,
    ),
    index("task_purposes_owner_purpose_idx").on(table.tenantId, table.ownerUserId, table.purposeId),
  ],
);

function reminderRelationshipTable(
  name: string,
  targetColumn: string,
  target: () => any,
) {
  return pgTable(
    name,
    {
      id: uuid("id").primaryKey().defaultRandom(),
      ...ownershipColumns,
      reminderId: uuid("reminder_id").notNull().references(() => remindersTable.id),
      [targetColumn]: uuid(targetColumn).notNull().references(target),
      relationship: text("relationship"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
      rowVersion: integer("row_version").notNull().default(1),
    },
    (table: any) => [
      uniqueIndex(`${name}_owner_pair_unique`).on(
        table.tenantId, table.ownerUserId, table.reminderId, table[targetColumn],
      ),
    ],
  );
}

export const reminderPeopleTable = reminderRelationshipTable(
  "reminder_people", "person_id", () => peopleTable.id,
);
export const reminderProjectsTable = reminderRelationshipTable(
  "reminder_projects", "project_id", () => projectsTable.id,
);
export const reminderTasksTable = reminderRelationshipTable(
  "reminder_tasks", "task_id", () => tasksTable.id,
);

function commitmentRelationshipTable(
  name: string,
  targetColumn: string,
  target: () => any,
) {
  return pgTable(
    name,
    {
      id: uuid("id").primaryKey().defaultRandom(),
      ...ownershipColumns,
      commitmentId: uuid("commitment_id").notNull().references(() => commitmentsTable.id),
      [targetColumn]: uuid(targetColumn).notNull().references(target),
      relationship: text("relationship"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
      rowVersion: integer("row_version").notNull().default(1),
    },
    (table: any) => [
      uniqueIndex(`${name}_owner_pair_unique`).on(
        table.tenantId, table.ownerUserId, table.commitmentId, table[targetColumn],
      ),
    ],
  );
}

export const commitmentPeopleTable = commitmentRelationshipTable(
  "commitment_people", "person_id", () => peopleTable.id,
);
export const commitmentProjectsTable = commitmentRelationshipTable(
  "commitment_projects", "project_id", () => projectsTable.id,
);
export const commitmentPurposesTable = commitmentRelationshipTable(
  "commitment_purposes", "purpose_id", () => purposesTable.id,
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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

export const activityEventsTable = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    eventType: text("event_type").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id"),
    actorType: text("actor_type").notNull().default("user"),
    actorId: text("actor_id"),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("activity_events_owner_occurred_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.occurredAt,
    ),
    index("activity_events_owner_source_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.sourceType,
      table.sourceId,
    ),
  ],
);

export const activityEventEntitiesTable = pgTable(
  "activity_event_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    eventId: uuid("event_id").notNull().references(() => activityEventsTable.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    role: text("role").notNull().default("related"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("activity_event_entities_owner_event_entity_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.eventId,
      table.entityType,
      table.entityId,
      table.role,
    ),
    index("activity_event_entities_owner_entity_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  ],
);

export const insertPersonSchema = createInsertSchema(peopleTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  rowVersion: true,
});
export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  rowVersion: true,
});
export const insertExpenseSchema = createInsertSchema(expensesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  rowVersion: true,
});
export const insertReminderSchema = createInsertSchema(remindersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  rowVersion: true,
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
export type Purpose = typeof purposesTable.$inferSelect;
export type FinancialParty = typeof financialPartiesTable.$inferSelect;
export type FinancialPartyPerson = typeof financialPartyPeopleTable.$inferSelect;
export type FinancialPartyProject = typeof financialPartyProjectsTable.$inferSelect;
export type FinancialPartyPurpose = typeof financialPartyPurposesTable.$inferSelect;
export type FinancialObligation = typeof financialObligationsTable.$inferSelect;
export type FinancialPayment = typeof financialPaymentsTable.$inferSelect;
export type ObligationSettlement = typeof obligationSettlementsTable.$inferSelect;
export type Donation = typeof donationsTable.$inferSelect;
export type IncomeReceivable = typeof incomeReceivablesTable.$inferSelect;
export type PaymentLink = typeof paymentLinksTable.$inferSelect;
export type ActivityEvent = typeof activityEventsTable.$inferSelect;
export type ActivityEventEntity = typeof activityEventEntitiesTable.$inferSelect;
export type InsertPerson = z.infer<typeof insertPersonSchema>;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type InsertReminder = z.infer<typeof insertReminderSchema>;