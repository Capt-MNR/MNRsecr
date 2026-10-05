import { createInsertSchema } from "drizzle-zod";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const authExternalIdentitiesTable = pgTable(
  "auth_external_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    emailAddress: text("email_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_external_identities_provider_subject_unique")
      .on(table.provider, table.providerSubject),
    uniqueIndex("auth_external_identities_owner_provider_unique")
      .on(table.tenantId, table.ownerUserId, table.provider),
    index("auth_external_identities_owner_idx").on(table.tenantId, table.ownerUserId),
  ],
);

export const authExternalOAuthStatesTable = pgTable(
  "auth_external_oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stateHash: text("state_hash").notNull(),
    provider: text("provider").notNull(),
    mode: text("mode").notNull(),
    client: text("client").notNull(),
    tenantId: text("tenant_id"),
    ownerUserId: text("owner_user_id"),
    returnTo: text("return_to").notNull(),
    codeVerifierCiphertext: text("code_verifier_ciphertext").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ticketHash: text("ticket_hash"),
    ticketExpiresAt: timestamp("ticket_expires_at", { withTimezone: true }),
    ticketConsumedAt: timestamp("ticket_consumed_at", { withTimezone: true }),
    resolvedTenantId: text("resolved_tenant_id"),
    resolvedUserId: text("resolved_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_external_oauth_states_hash_unique").on(table.stateHash),
    uniqueIndex("auth_external_oauth_states_ticket_hash_unique").on(table.ticketHash),
    index("auth_external_oauth_states_expiry_idx").on(table.expiresAt),
  ],
);

export const insertAuthExternalIdentitySchema =
  createInsertSchema(authExternalIdentitiesTable).omit({
    id: true,
    createdAt: true,
    lastUsedAt: true,
  });
export const insertAuthExternalOAuthStateSchema =
  createInsertSchema(authExternalOAuthStatesTable).omit({
    id: true,
    createdAt: true,
  });

export type AuthExternalIdentity = typeof authExternalIdentitiesTable.$inferSelect;
export type InsertAuthExternalIdentity = z.infer<typeof insertAuthExternalIdentitySchema>;
export type AuthExternalOAuthState = typeof authExternalOAuthStatesTable.$inferSelect;
export type InsertAuthExternalOAuthState = z.infer<typeof insertAuthExternalOAuthStateSchema>;
