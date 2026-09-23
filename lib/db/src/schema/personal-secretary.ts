import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
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

export const authUsersTable = pgTable(
  "auth_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    disabled: boolean("disabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_users_email_unique").on(table.email),
  ],
);

export const authTenantsTable = pgTable(
  "auth_tenants",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const authMembershipsTable = pgTable(
  "auth_memberships",
  {
    tenantId: text("tenant_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_memberships_tenant_user_unique").on(table.tenantId, table.userId),
    index("auth_memberships_user_idx").on(table.userId),
  ],
);

export const authSessionsTable = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    accessTokenHash: text("access_token_hash").notNull(),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_sessions_access_hash_unique").on(table.accessTokenHash),
    uniqueIndex("auth_sessions_refresh_hash_unique").on(table.refreshTokenHash),
    index("auth_sessions_user_idx").on(table.userId, table.revokedAt),
  ],
);

export const peopleTable = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    notes: text("notes"),
    phone: text("phone"),
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
    sourceConversationId: text("source_conversation_id"),
    sourceTurnId: text("source_turn_id"),
    sourceOperationId: text("source_operation_id"),
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
    sourceConversationId: text("source_conversation_id"),
    sourceTurnId: text("source_turn_id"),
    sourceOperationId: text("source_operation_id"),
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
    sourceConversationId: text("source_conversation_id"),
    sourceTurnId: text("source_turn_id"),
    sourceOperationId: text("source_operation_id"),
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
  targetProperty: string,
  targetColumn: string,
  target: () => any,
) {
  return pgTable(
    name,
    {
      id: uuid("id").primaryKey().defaultRandom(),
      ...ownershipColumns,
      reminderId: uuid("reminder_id").notNull().references(() => remindersTable.id),
      [targetProperty]: uuid(targetColumn).notNull().references(target),
      relationship: text("relationship"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
      rowVersion: integer("row_version").notNull().default(1),
    },
    (table: any) => [
      uniqueIndex(`${name}_owner_pair_unique`).on(
        table.tenantId, table.ownerUserId, table.reminderId, table[targetProperty],
      ),
    ],
  );
}

export const reminderPeopleTable = reminderRelationshipTable(
  "reminder_people", "personId", "person_id", () => peopleTable.id,
);
export const reminderProjectsTable = reminderRelationshipTable(
  "reminder_projects", "projectId", "project_id", () => projectsTable.id,
);
export const reminderTasksTable = reminderRelationshipTable(
  "reminder_tasks", "taskId", "task_id", () => tasksTable.id,
);

function commitmentRelationshipTable(
  name: string,
  targetProperty: string,
  targetColumn: string,
  target: () => any,
) {
  return pgTable(
    name,
    {
      id: uuid("id").primaryKey().defaultRandom(),
      ...ownershipColumns,
      commitmentId: uuid("commitment_id").notNull().references(() => commitmentsTable.id),
      [targetProperty]: uuid(targetColumn).notNull().references(target),
      relationship: text("relationship"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
      rowVersion: integer("row_version").notNull().default(1),
    },
    (table: any) => [
      uniqueIndex(`${name}_owner_pair_unique`).on(
        table.tenantId, table.ownerUserId, table.commitmentId, table[targetProperty],
      ),
    ],
  );
}

export const commitmentPeopleTable = commitmentRelationshipTable(
  "commitment_people", "personId", "person_id", () => peopleTable.id,
);
export const commitmentProjectsTable = commitmentRelationshipTable(
  "commitment_projects", "projectId", "project_id", () => projectsTable.id,
);
export const commitmentPurposesTable = commitmentRelationshipTable(
  "commitment_purposes", "purposeId", "purpose_id", () => purposesTable.id,
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
    sourceTurnId: text("source_turn_id"),
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

export const mobilePushTokensTable = pgTable(
  "mobile_push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    token: text("token").notNull(),
    provider: text("provider").notNull().default("expo"),
    platform: text("platform").notNull(),
    appId: text("app_id").notNull(),
    deviceId: text("device_id"),
    enabled: integer("enabled").notNull().default(1),
    disabledReason: text("disabled_reason"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mobile_push_tokens_token_unique").on(table.token),
    uniqueIndex("mobile_push_tokens_owner_token_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.token,
    ),
    index("mobile_push_tokens_owner_enabled_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.enabled,
    ),
  ],
);

export const notificationOutboxTable = pgTable(
  "notification_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    workId: uuid("work_id"),
    runId: uuid("run_id"),
    sourceEventId: uuid("source_event_id"),
    operationId: text("operation_id"),
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("queued"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_outbox_owner_dedupe_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.dedupeKey,
    ),
    index("notification_outbox_status_next_attempt_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    index("notification_outbox_owner_created_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.createdAt,
    ),
  ],
);

export const triggerOutboxTable = pgTable(
  "trigger_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    quarantinedAt: timestamp("quarantined_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("trigger_outbox_owner_dedupe_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.dedupeKey,
    ),
    index("trigger_outbox_status_available_idx").on(
      table.status,
      table.availableAt,
    ),
    index("trigger_outbox_lease_idx").on(
      table.status,
      table.leaseExpiresAt,
    ),
    index("trigger_outbox_owner_occurred_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.occurredAt,
    ),
  ],
);

export const notificationDeliveriesTable = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    notificationId: uuid("notification_id").notNull(),
    tokenId: uuid("token_id").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    providerTicket: text("provider_ticket"),
    lastErrorClass: text("last_error_class"),
    lastError: text("last_error"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_deliveries_owner_notification_token_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.notificationId,
      table.tokenId,
    ),
    index("notification_deliveries_status_next_attempt_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    index("notification_deliveries_notification_idx").on(table.notificationId),
  ],
);

export const notificationDeliveryAttemptsTable = pgTable(
  "notification_delivery_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    deliveryId: uuid("delivery_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    status: text("status").notNull(),
    providerRequestId: text("provider_request_id"),
    errorClass: text("error_class"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("notification_delivery_attempts_delivery_number_unique").on(
      table.deliveryId,
      table.attemptNumber,
    ),
    index("notification_delivery_attempts_delivery_idx").on(table.deliveryId),
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

export const secondBrainMemoriesTable = pgTable(
  "second_brain_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    confidenceBps: integer("confidence_bps").notNull().default(10000),
    status: text("status").notNull().default("active"),
    sourceConversationId: text("source_conversation_id"),
    sourceTurnId: text("source_turn_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("second_brain_memories_owner_kind_key_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.kind,
      table.key,
    ),
    index("second_brain_memories_owner_status_updated_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.status,
      table.updatedAt,
    ),
    index("second_brain_memories_owner_normalized_value_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.normalizedValue,
    ),
  ],
);

export const secondBrainCandidatesTable = pgTable(
  "second_brain_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    confidenceBps: integer("confidence_bps").notNull(),
    status: text("status").notNull().default("pending_review"),
    sourceConversationId: text("source_conversation_id"),
    sourceTurnId: text("source_turn_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    reviewerNote: text("reviewer_note"),
    promotedMemoryId: uuid("promoted_memory_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("second_brain_candidates_owner_status_updated_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.status,
      table.updatedAt,
    ),
    index("second_brain_candidates_owner_source_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.sourceConversationId,
      table.sourceTurnId,
    ),
  ],
);

export const inputAssetResultsTable = pgTable(
  "input_asset_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    inputId: text("input_id").notNull(),
    contentHash: text("content_hash").notNull(),
    kind: text("kind").notNull(),
    mimeType: text("mime_type").notNull(),
    text: text("text").notNull(),
    receipt: jsonb("receipt").$type<Record<string, unknown> | null>(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("input_asset_results_owner_hash_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.contentHash,
    ),
    uniqueIndex("input_asset_results_owner_input_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.inputId,
    ),
    index("input_asset_results_owner_expires_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.expiresAt,
    ),
  ],
);

export const inputAssetProvenanceTable = pgTable(
  "input_asset_provenance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    inputId: text("input_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    turnId: text("turn_id").notNull(),
    operationId: text("operation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("input_asset_provenance_owner_input_turn_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.inputId,
      table.turnId,
    ),
    index("input_asset_provenance_owner_conversation_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.conversationId,
    ),
  ],
);

export const resolverShadowLogTable = pgTable(
  "resolver_shadow_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ...ownershipColumns,
    entityType: text("entity_type").notNull(),
    queryText: text("query_text").notNull(),
    candidateCount: integer("candidate_count").notNull(),
    selectedId: uuid("selected_id"),
    confidence: doublePrecision("confidence"),
    matchType: text("match_type").notNull(),
    wouldChange: boolean("would_change").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("resolver_shadow_log_owner_created_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.createdAt,
    ),
  ],
);

export const learningSignalReviewsTable = pgTable(
  "learning_signal_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    signalId: text("signal_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    turnId: text("turn_id"),
    category: text("category").notNull(),
    confidenceBps: integer("confidence_bps").notNull(),
    status: text("status").notNull().default("pending_review"),
    reviewerNote: text("reviewer_note"),
    benchmarkPayload: jsonb("benchmark_payload").$type<Record<string, unknown>>().notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("learning_signal_reviews_owner_signal_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.signalId,
    ),
    index("learning_signal_reviews_owner_status_updated_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.status,
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

export const agentWorksTable = pgTable(
  "agent_works",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("draft"),
    source: jsonb("source").$type<Record<string, unknown>>().notNull().default({}),
    condition: jsonb("condition").$type<Record<string, unknown>>().notNull().default({}),
    action: jsonb("action").$type<Record<string, unknown>>().notNull().default({}),
    schedule: jsonb("schedule").$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text("dedupe_key"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastRunStatus: text("last_run_status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    index("agent_works_owner_status_next_run_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.status,
      table.nextRunAt,
    ),
    index("agent_works_owner_updated_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.updatedAt,
    ),
    uniqueIndex("agent_works_owner_dedupe_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.dedupeKey,
    ),
  ],
);

export const agentWorkRunsTable = pgTable(
  "agent_work_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    workId: uuid("work_id").notNull().references(() => agentWorksTable.id),
    attempt: integer("attempt").notNull().default(1),
    status: text("status").notNull().default("queued"),
    idempotencyKey: text("idempotency_key").notNull(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    verification: jsonb("verification").$type<Record<string, unknown> | null>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_work_runs_owner_idempotency_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.idempotencyKey,
    ),
    uniqueIndex("agent_work_runs_owner_attempt_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.workId,
      table.attempt,
    ),
    index("agent_work_runs_owner_work_created_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.workId,
      table.createdAt,
    ),
    index("agent_work_runs_lease_idx").on(
      table.status,
      table.leaseExpiresAt,
    ),
  ],
);

export const agentWorkEventsTable = pgTable(
  "agent_work_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    workId: uuid("work_id").notNull().references(() => agentWorksTable.id),
    runId: uuid("run_id").references(() => agentWorkRunsTable.id),
    eventType: text("event_type").notNull(),
    actorType: text("actor_type").notNull().default("agent"),
    actorId: text("actor_id"),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text("dedupe_key"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_work_events_owner_dedupe_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.dedupeKey,
    ),
    index("agent_work_events_owner_work_occurred_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.workId,
      table.occurredAt,
    ),
  ],
);

export const agentWorkEvidenceTable = pgTable(
  "agent_work_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownershipColumns,
    workId: uuid("work_id").notNull().references(() => agentWorksTable.id),
    runId: uuid("run_id").notNull().references(() => agentWorkRunsTable.id),
    snapshotHash: text("snapshot_hash").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    retentionClass: text("retention_class").notNull().default("standard"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_work_evidence_owner_run_hash_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.runId,
      table.snapshotHash,
    ),
    index("agent_work_evidence_owner_work_created_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.workId,
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
export type SecondBrainMemory = typeof secondBrainMemoriesTable.$inferSelect;
export type SecondBrainCandidate = typeof secondBrainCandidatesTable.$inferSelect;
export type LearningSignalReview = typeof learningSignalReviewsTable.$inferSelect;
export type SecretaryOperation = typeof secretaryOperationsTable.$inferSelect;
export type MobilePushToken = typeof mobilePushTokensTable.$inferSelect;
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
export type AgentWork = typeof agentWorksTable.$inferSelect;
export type AgentWorkRun = typeof agentWorkRunsTable.$inferSelect;
export type AgentWorkEvent = typeof agentWorkEventsTable.$inferSelect;
export type AgentWorkEvidence = typeof agentWorkEvidenceTable.$inferSelect;
export type InsertPerson = z.infer<typeof insertPersonSchema>;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type InsertReminder = z.infer<typeof insertReminderSchema>;