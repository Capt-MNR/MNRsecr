import { createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  authMembershipsTable,
  authSessionsTable,
  authTenantsTable,
  authUsersTable,
  db,
} from "@workspace/db";

const ACCESS_TTL_MS = 15 * 60_000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
const PASSWORD_KEY_BYTES = 64;

function derivePasswordKey(
  password: string,
  salt: string,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}

export const ACCESS_COOKIE = "secretary_access";
export const REFRESH_COOKIE = "secretary_refresh";

export type AuthIdentity = {
  tenantId: string;
  userId: string;
};

export type AuthUser = AuthIdentity & {
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      authIdentity?: AuthIdentity | null;
      authAccessToken?: string | null;
    }
  }
}

export type IssuedSession = {
  identity: AuthIdentity;
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message = code) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

function sessionSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new AuthError(503, "AUTH_SESSION_SECRET_MISSING");
  }
  return "development-only-session-secret";
}

function hashSessionToken(token: string): string {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = await derivePasswordKey(password, salt, PASSWORD_KEY_BYTES, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  }) as Buffer;
  return `scrypt$16384$8$1$${salt}$${derived.toString("base64url")}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, rawN, rawR, rawP, salt, encodedHash] = encoded.split("$");
  if (algorithm !== "scrypt" || !rawN || !rawR || !rawP || !salt || !encodedHash) return false;
  const n = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) return false;
  try {
    const expected = Buffer.from(encodedHash, "base64url");
    const actual = await derivePasswordKey(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    }) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function userFromRow(row: {
  id: string;
  email: string;
}, tenantId: string): AuthUser {
  return {
    userId: row.id,
    tenantId,
    email: row.email,
  };
}

async function issueSession(
  executor: Pick<typeof db, "insert">,
  user: AuthUser,
): Promise<IssuedSession> {
  const accessToken = newToken();
  const refreshToken = newToken();
  const now = Date.now();
  const accessExpiresAt = new Date(now + ACCESS_TTL_MS);
  const refreshExpiresAt = new Date(now + REFRESH_TTL_MS);
  const [session] = await executor.insert(authSessionsTable).values({
    id: randomUUID(),
    userId: user.userId,
    tenantId: user.tenantId,
    accessTokenHash: hashSessionToken(accessToken),
    refreshTokenHash: hashSessionToken(refreshToken),
    accessExpiresAt,
    refreshExpiresAt,
  }).returning();
  if (!session) throw new AuthError(500, "AUTH_SESSION_CREATE_FAILED");
  return {
    identity: { tenantId: user.tenantId, userId: user.userId },
    user,
    accessToken,
    refreshToken,
    accessExpiresAt,
    refreshExpiresAt,
  };
}

export async function registerAuthUser(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<IssuedSession> {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: authUsersTable.id })
        .from(authUsersTable)
        .where(eq(authUsersTable.email, email))
        .limit(1);
      if (existing) throw new AuthError(409, "AUTH_EMAIL_TAKEN");

      const userId = randomUUID();
      const tenantId = randomUUID();
      const [user] = await tx.insert(authUsersTable).values({
        id: userId,
        email,
        passwordHash,
      }).returning({ id: authUsersTable.id, email: authUsersTable.email });
      if (!user) throw new AuthError(500, "AUTH_USER_CREATE_FAILED");
      await tx.insert(authTenantsTable).values({
        id: tenantId,
        name: input.name?.trim() || email,
      });
      await tx.insert(authMembershipsTable).values({
        tenantId,
        userId,
        role: "owner",
      });
      return issueSession(tx, userFromRow(user, tenantId));
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (typeof error === "object" && error && "code" in error && (error as { code?: unknown }).code === "23505") {
      throw new AuthError(409, "AUTH_EMAIL_TAKEN");
    }
    throw error;
  }
}

export async function loginAuthUser(input: {
  email: string;
  password: string;
}): Promise<IssuedSession> {
  const email = normalizeEmail(input.email);
  const [user] = await db.select().from(authUsersTable)
    .where(eq(authUsersTable.email, email))
    .limit(1);
  if (!user || user.disabled || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AuthError(401, "AUTH_INVALID_CREDENTIALS");
  }
  const [membership] = await db.select().from(authMembershipsTable)
    .where(eq(authMembershipsTable.userId, user.id))
    .limit(1);
  if (!membership) throw new AuthError(403, "AUTH_MEMBERSHIP_MISSING");
  return db.transaction((tx) => issueSession(tx, userFromRow(user, membership.tenantId)));
}

export async function authenticateAccessToken(token: string | null | undefined): Promise<AuthIdentity | null> {
  if (!token || token.length < 32 || token.length > 512) return null;
  const now = new Date();
  const [session] = await db.select({
    session: authSessionsTable,
    user: authUsersTable,
    membership: authMembershipsTable,
  }).from(authSessionsTable)
    .innerJoin(authUsersTable, eq(authSessionsTable.userId, authUsersTable.id))
    .innerJoin(authMembershipsTable, and(
      eq(authMembershipsTable.userId, authSessionsTable.userId),
      eq(authMembershipsTable.tenantId, authSessionsTable.tenantId),
    ))
    .where(and(
      eq(authSessionsTable.accessTokenHash, hashSessionToken(token)),
      gt(authSessionsTable.accessExpiresAt, now),
      isNull(authSessionsTable.revokedAt),
      eq(authUsersTable.disabled, false),
    ))
    .limit(1);
  if (!session) return null;
  await db.update(authSessionsTable).set({ lastSeenAt: now })
    .where(eq(authSessionsTable.id, session.session.id));
  return { tenantId: session.session.tenantId, userId: session.session.userId };
}

export async function refreshAuthSession(refreshToken: string | null | undefined): Promise<IssuedSession> {
  if (!refreshToken || refreshToken.length < 32 || refreshToken.length > 512) {
    throw new AuthError(401, "AUTH_REFRESH_INVALID");
  }
  const now = new Date();
  return db.transaction(async (tx) => {
    const [current] = await tx.select({
      session: authSessionsTable,
      user: authUsersTable,
    }).from(authSessionsTable)
      .innerJoin(authUsersTable, eq(authSessionsTable.userId, authUsersTable.id))
      .where(and(
        eq(authSessionsTable.refreshTokenHash, hashSessionToken(refreshToken)),
        gt(authSessionsTable.refreshExpiresAt, now),
        isNull(authSessionsTable.revokedAt),
        eq(authUsersTable.disabled, false),
      ))
      .limit(1);
    if (!current) throw new AuthError(401, "AUTH_REFRESH_INVALID");
    const [membership] = await tx.select().from(authMembershipsTable).where(and(
      eq(authMembershipsTable.userId, current.session.userId),
      eq(authMembershipsTable.tenantId, current.session.tenantId),
    )).limit(1);
    if (!membership) throw new AuthError(403, "AUTH_MEMBERSHIP_MISSING");
    const accessToken = newToken();
    const nextRefreshToken = newToken();
    const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_MS);
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    const [updated] = await tx.update(authSessionsTable).set({
      accessTokenHash: hashSessionToken(accessToken),
      refreshTokenHash: hashSessionToken(nextRefreshToken),
      accessExpiresAt,
      refreshExpiresAt,
      lastSeenAt: now,
    }).where(and(
      eq(authSessionsTable.id, current.session.id),
      eq(authSessionsTable.refreshTokenHash, hashSessionToken(refreshToken)),
      isNull(authSessionsTable.revokedAt),
    )).returning();
    if (!updated) throw new AuthError(401, "AUTH_REFRESH_INVALID");
    const user = userFromRow(current.user, current.session.tenantId);
    return {
      identity: { tenantId: user.tenantId, userId: user.userId },
      user,
      accessToken,
      refreshToken: nextRefreshToken,
      accessExpiresAt,
      refreshExpiresAt,
    };
  });
}

export async function revokeAuthSession(input: {
  accessToken?: string | null;
  refreshToken?: string | null;
}): Promise<void> {
  const accessHash = input.accessToken ? hashSessionToken(input.accessToken) : null;
  const refreshHash = input.refreshToken ? hashSessionToken(input.refreshToken) : null;
  if (!accessHash && !refreshHash) return;
  await db.update(authSessionsTable)
    .set({ revokedAt: new Date() })
    .where(accessHash && refreshHash
      ? and(
        eq(authSessionsTable.accessTokenHash, accessHash),
        eq(authSessionsTable.refreshTokenHash, refreshHash),
      )
      : accessHash
        ? eq(authSessionsTable.accessTokenHash, accessHash)
        : eq(authSessionsTable.refreshTokenHash, refreshHash!));
}

export async function getAuthUser(identity: AuthIdentity): Promise<AuthUser | null> {
  const [row] = await db.select({
    id: authUsersTable.id,
    email: authUsersTable.email,
  }).from(authUsersTable)
    .innerJoin(authMembershipsTable, and(
      eq(authMembershipsTable.userId, authUsersTable.id),
      eq(authMembershipsTable.tenantId, identity.tenantId),
    ))
    .where(and(eq(authUsersTable.id, identity.userId), eq(authUsersTable.disabled, false)))
    .limit(1);
  return row ? userFromRow(row, identity.tenantId) : null;
}

export async function verifyAuthUserPassword(
  identity: AuthIdentity,
  password: string,
): Promise<boolean> {
  const [row] = await db.select({
    passwordHash: authUsersTable.passwordHash,
  }).from(authUsersTable)
    .innerJoin(authMembershipsTable, and(
      eq(authMembershipsTable.userId, authUsersTable.id),
      eq(authMembershipsTable.tenantId, identity.tenantId),
    ))
    .where(and(
      eq(authUsersTable.id, identity.userId),
      eq(authUsersTable.disabled, false),
    ))
    .limit(1);
  return row ? verifyPassword(password, row.passwordHash) : false;
}

export async function issueAuthSessionForIdentity(
  identity: AuthIdentity,
): Promise<IssuedSession> {
  const [row] = await db.select({
    id: authUsersTable.id,
    email: authUsersTable.email,
  }).from(authUsersTable)
    .innerJoin(authMembershipsTable, and(
      eq(authMembershipsTable.userId, authUsersTable.id),
      eq(authMembershipsTable.tenantId, identity.tenantId),
    ))
    .where(and(
      eq(authUsersTable.id, identity.userId),
      eq(authUsersTable.disabled, false),
    ))
    .limit(1);
  if (!row) throw new AuthError(401, "AUTH_PROVIDER_NOT_LINKED");
  return db.transaction((tx) => issueSession(tx, userFromRow(row, identity.tenantId)));
}