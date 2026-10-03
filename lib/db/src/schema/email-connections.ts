import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const emailConnectionsTable = pgTable(
  "email_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    provider: text("provider").notNull().default("gmail"),
    emailAddress: text("email_address").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("email_connections_owner_provider_unique")
      .on(table.tenantId, table.ownerUserId, table.provider),
    index("email_connections_email_idx").on(table.emailAddress),
  ],
);

export const emailOAuthStatesTable = pgTable(
  "email_oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    stateHash: text("state_hash").notNull(),
    codeVerifierCiphertext: text("code_verifier_ciphertext").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("email_oauth_states_hash_unique").on(table.stateHash),
    index("email_oauth_states_expiry_idx").on(table.expiresAt),
    index("email_oauth_states_owner_idx").on(table.tenantId, table.ownerUserId),
  ],
);

export const insertEmailConnectionSchema = createInsertSchema(emailConnectionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertEmailOAuthStateSchema = createInsertSchema(emailOAuthStatesTable).omit({
  id: true,
  createdAt: true,
});

export type EmailConnection = typeof emailConnectionsTable.$inferSelect;
export type InsertEmailConnection = z.infer<typeof insertEmailConnectionSchema>;
export type EmailOAuthState = typeof emailOAuthStatesTable.$inferSelect;
export type InsertEmailOAuthState = z.infer<typeof insertEmailOAuthStateSchema>;