import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  db,
  googleCalendarConnectionsTable,
  googleCalendarOAuthStatesTable,
} from "@workspace/db";
import { encryptEmailToken } from "../src/lib/email-token-crypto";
import { createLinkedGoogleCalendarExternalActionConnector, createLinkedGoogleCalendarProvider } from "../src/lib/agent-work/linked-calendar-provider";
import { CalendarProviderError } from "../src/lib/agent-work/calendar-provider";

test("linked Calendar provider refreshes the authenticated owner's token before Google API access", async () => {
  const identity = {
    tenantId: `linked-calendar-provider-${process.pid}-${Date.now()}`,
    userId: "linked-calendar-owner",
  };
  const otherIdentity = { ...identity, userId: "different-calendar-owner" };
  const environmentKeys = [
    "NODE_ENV",
    "GOOGLE_CALENDAR_ENABLED",
    "GOOGLE_CALENDAR_CLIENT_ID",
    "GOOGLE_CALENDAR_CLIENT_SECRET",
    "GOOGLE_CALENDAR_REDIRECT_URI",
    "EMAIL_TOKEN_ENCRYPTION_KEY",
  ] as const;
  const previousEnvironment = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  const originalFetch = globalThis.fetch;
  const testEncryptionKey = Buffer.alloc(32, 4).toString("base64");
  const tokenCalls: string[] = [];
  const calendarCalls: Array<{ url: string; authorization: string }> = [];
  process.env.NODE_ENV = "test";
  process.env.GOOGLE_CALENDAR_ENABLED = "true";
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "mock-linked-client";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "mock-linked-secret";
  process.env.GOOGLE_CALENDAR_REDIRECT_URI =
    "https://example.test/api/calendar/google/oauth/callback";
  process.env.EMAIL_TOKEN_ENCRYPTION_KEY = testEncryptionKey;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    tokenCalls.push(url);
    assert.equal(url, "https://oauth2.googleapis.com/token");
    const body = typeof init?.body === "string"
      ? init.body
      : init?.body instanceof URLSearchParams
        ? init.body.toString()
        : "";
    assert.equal(new URLSearchParams(body).get("grant_type"), "refresh_token");
    assert.equal(
      new URLSearchParams(body).get("refresh_token"),
      "mock-linked-refresh-token",
    );
    return Response.json({
      access_token: "mock-linked-access-token",
      token_type: "Bearer",
    });
  }) as typeof fetch;

  const cleanup = async () => {
    await db.delete(googleCalendarConnectionsTable).where(and(
      eq(googleCalendarConnectionsTable.tenantId, identity.tenantId),
      eq(googleCalendarConnectionsTable.ownerUserId, identity.userId),
    ));
    await db.delete(googleCalendarOAuthStatesTable).where(and(
      eq(googleCalendarOAuthStatesTable.tenantId, identity.tenantId),
      eq(googleCalendarOAuthStatesTable.ownerUserId, identity.userId),
    ));
  };

  try {
    await cleanup();
    await db.insert(googleCalendarConnectionsTable).values({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      emailAddress: "linked-calendar@example.test",
      grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/calendar.events"],
      refreshTokenCiphertext: encryptEmailToken(
        "mock-linked-refresh-token",
        testEncryptionKey,
      ),
    });

    const calendarFetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get("authorization") ?? "";
      calendarCalls.push({ url, authorization });
      return Response.json({
        items: [{
          id: "linked-mock-event",
          summary: "Mock event",
          status: "confirmed",
          start: { dateTime: "2026-10-05T10:00:00Z", timeZone: "UTC" },
          end: { dateTime: "2026-10-05T10:30:00Z", timeZone: "UTC" },
        }],
      });
    };
    const provider = createLinkedGoogleCalendarProvider(calendarFetcher);
    const events = await provider.listEvents(identity, { calendarId: "primary" });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.eventId, "linked-mock-event");
    assert.equal(tokenCalls.length, 1);
    assert.equal(calendarCalls.length, 1);
    assert.equal(
      calendarCalls[0]?.authorization,
      "Bearer mock-linked-access-token",
    );
    assert.match(calendarCalls[0]?.url ?? "", /calendar\/v3\/calendars\/primary\/events/u);

    await assert.rejects(
      provider.listEvents(otherIdentity),
      (error: unknown) => error instanceof CalendarProviderError
        && error.code === "CALENDAR_AUTH_UNAVAILABLE",
    );
    assert.equal(calendarCalls.length, 1, "an unlinked user must not reach the Calendar API");

    const actionConnector = createLinkedGoogleCalendarExternalActionConnector(calendarFetcher);
    assert.equal(actionConnector.provider, "calendar");
    assert.equal(actionConnector.approvalToolName, "calendar_execute");

    process.env.NODE_ENV = "development";
    const actionRegistry = await import("../src/lib/agent-work/external-action-registry");
    const registeredCalendar = actionRegistry.externalActionConnectorForProvider("calendar");
    assert.ok(registeredCalendar, "configured development OAuth should register the linked Calendar provider");
    assert.equal(registeredCalendar.approvalToolName, "calendar_execute");
    assert.equal(
      actionRegistry.externalActionConnectorForOperation({
        toolName: "calendar_execute",
        args: { provider: "calendar" },
      }),
      registeredCalendar,
      "Agent Work approval dispatch should resolve to the linked Calendar connector",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await cleanup();
    for (const key of environmentKeys) {
      const previous = previousEnvironment[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
});