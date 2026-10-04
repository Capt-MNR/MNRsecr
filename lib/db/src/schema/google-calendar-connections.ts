import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const googleCalendarConnectionsTable = pgTable(
  "google_calendar_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    emailAddress: text("email_address").notNull(),
    grantedScopes: text("granted_scopes").array().notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("google_calendar_connections_owner_unique")
      .on(table.tenantId, table.ownerUserId),
    index("google_calendar_connections_email_idx").on(table.emailAddress),
  ],
);

export const googleCalendarOAuthStatesTable = pgTable(
  "google_calendar_oauth_states",
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
    uniqueIndex("google_calendar_oauth_states_hash_unique").on(table.stateHash),
    index("google_calendar_oauth_states_expiry_idx").on(table.expiresAt),
    index("google_calendar_oauth_states_owner_idx").on(table.tenantId, table.ownerUserId),
  ],
);

export const insertGoogleCalendarConnectionSchema =
  createInsertSchema(googleCalendarConnectionsTable).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  });
export const insertGoogleCalendarOAuthStateSchema =
  createInsertSchema(googleCalendarOAuthStatesTable).omit({
    id: true,
    createdAt: true,
  });

export type GoogleCalendarConnection = typeof googleCalendarConnectionsTable.$inferSelect;
export type InsertGoogleCalendarConnection = z.infer<typeof insertGoogleCalendarConnectionSchema>;
export type GoogleCalendarOAuthState = typeof googleCalendarOAuthStatesTable.$inferSelect;
export type InsertGoogleCalendarOAuthState = z.infer<typeof insertGoogleCalendarOAuthStateSchema>;