import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PendingOperation } from "../src/lib/secretary-operations";
import type {
  AgentWorkEventRecord,
  AgentWorkIdentity,
  AgentWorkRecord,
  AgentWorkRunRecord,
  StorageAdapter,
} from "../src/lib/agent-work/types";
import { createCalendarExternalActionConnector } from "../src/lib/agent-work/calendar-action";
import {
  CalendarProviderError,
  GoogleCalendarProviderAdapter,
} from "../src/lib/agent-work/calendar-provider";
import { createMessagingExternalActionConnector } from "../src/lib/agent-work/messaging-action";
import { createExternalActionRegistry } from "../src/lib/agent-work/external-action-registry";
import {
  FakeCalendarProviderForTests,
  FakeMessagingProviderForTests,
} from "../src/lib/agent-work/fake-integration-providers";
import type { ExternalActionConnector } from "../src/lib/agent-work/external-action";

const identity: AgentWorkIdentity = {
  tenantId: `integration-ready-${process.pid}-${Date.now()}`,
  userId: "integration-owner",
};

function recordForContext<TAction extends Record<string, unknown>>(input: {
  connector: ExternalActionConnector;
  provider: string;
  identity: AgentWorkIdentity;
  action: TAction;
}) {
  const workId = randomUUID();
  const runId = randomUUID();
  const setupApprovalOperationId = randomUUID();
  const operationId = randomUUID();
  const storedAction = input.connector.validateSetupAction(
    input.action,
    setupApprovalOperationId,
  );
  assert.ok(storedAction);
  const work = {
    id: workId,
    kind: "external_action",
    status: "waiting",
    source: { type: input.provider },
    action: storedAction,
  } as unknown as AgentWorkRecord;
  const run = { id: runId, workId } as AgentWorkRunRecord;
  const events: AgentWorkEventRecord[] = [];
  const storage = {
    driver: "stub",
    getWork: async () => work,
    getRun: async () => run,
    listEvents: async () => [...events],
    addEvent: async (eventInput: {
      workId: string;
      runId?: string | null;
      eventType: string;
      actorType?: string;
      summary: string;
      metadata?: Record<string, unknown>;
    }) => {
      const event = {
        id: randomUUID(),
        workId: eventInput.workId,
        runId: eventInput.runId ?? runId,
        eventType: eventInput.eventType,
        actorType: eventInput.actorType ?? "system",
        summary: eventInput.summary,
        metadata: eventInput.metadata ?? {},
        createdAt: new Date(),
      } as AgentWorkEventRecord;
      events.push(event);
      return event;
    },
  } as unknown as StorageAdapter;
  const prepared = input.connector.prepareApproval({
    identity: input.identity,
    work,
    runId,
  });
  const operation = {
    operationId,
    toolName: input.connector.approvalToolName,
    args: prepared.args,
    conversationId: null,
  } as PendingOperation;
  return { work, run, storage, events, operation, prepared };
}

function externalStatus(value: unknown): unknown {
  if (!value || typeof value !== "object") return null;
  const action = (value as Record<string, unknown>).action;
  if (!action || typeof action !== "object") return null;
  const external = (action as Record<string, unknown>).externalAction;
  return external && typeof external === "object"
    ? (external as Record<string, unknown>).status
    : null;
}

test("Calendar REST adapter uses injected identity tokens and maps provider results without live OAuth", async () => {
  const requests: Array<{ url: string; method: string; token: string; body?: Record<string, unknown> }> = [];
  let event: Record<string, unknown> = {
    id: "event-1",
    summary: "Initial event",
    status: "confirmed",
    start: { dateTime: "2026-10-12T10:00:00Z", timeZone: "Africa/Cairo" },
    end: { dateTime: "2026-10-12T10:30:00Z", timeZone: "Africa/Cairo" },
  };
  const adapter = new GoogleCalendarProviderAdapter(
    async (requestIdentity) => {
      assert.equal(requestIdentity.tenantId, identity.tenantId);
      return "mock-calendar-access-token";
    },
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as Record<string, unknown>
        : undefined;
      requests.push({
        url: String(input),
        method,
        token: new Headers(init?.headers).get("authorization") ?? "",
        ...(body ? { body } : {}),
      });
      if (method === "GET" && String(input).includes("/events?")) {
        return Response.json({ items: [event] });
      }
      if (method === "POST") {
        event = { ...body, status: "confirmed" };
        return Response.json(event);
      }
      if (method === "PATCH") {
        event = {
          ...event,
          ...body,
          start: body?.start ?? event.start,
          end: body?.end ?? event.end,
        };
        return Response.json(event);
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      return Response.json(event);
    }) as typeof fetch,
  );

  const listed = await adapter.listEvents(identity, {
    calendarId: "team-calendar",
    timeMin: "2026-10-12T00:00:00Z",
    maxResults: 25,
  });
  assert.equal(listed[0]?.eventId, "event-1");
  assert.equal(requests[0]?.token, "Bearer mock-calendar-access-token");
  assert.ok(requests[0]?.url.includes("maxResults=25"));

  const found = await adapter.getEvent(identity, "team-calendar", "event-1");
  assert.equal(found?.summary, "Initial event");
  const content = {
    summary: "Updated event",
    description: "Review calendar change.",
    startAt: "2026-10-12T11:00:00Z",
    endAt: "2026-10-12T11:30:00Z",
    timeZone: "Africa/Cairo",
  };
  const idempotencyKey = `agent-action:${"a".repeat(64)}`;
  const created = await adapter.createEvent(
    identity,
    "team-calendar",
    content,
    idempotencyKey,
  );
  assert.equal(created.eventId, "a".repeat(64));
  assert.equal(created.summary, content.summary);
  const updated = await adapter.updateEvent(identity, "team-calendar", "event-1", content);
  assert.equal(updated.summary, content.summary);
  const cancelled = await adapter.cancelEvent(identity, "team-calendar", "event-1");
  assert.equal(cancelled.status, "cancelled");
  await adapter.deleteEvent(identity, "team-calendar", "event-1");
  assert.deepEqual(requests.map((request) => request.method), [
    "GET",
    "GET",
    "POST",
    "PATCH",
    "PATCH",
    "DELETE",
  ]);

  const timeoutAdapter = new GoogleCalendarProviderAdapter(
    async () => "mock-token",
    (async () => {
      throw new Error("simulated network interruption");
    }) as typeof fetch,
  );
  await assert.rejects(
    timeoutAdapter.createEvent(identity, "primary", content, idempotencyKey),
    (error: unknown) => error instanceof CalendarProviderError
      && error.outcome === "unknown_result",
  );
});

test("Calendar and messaging use the shared external-action registry without provider aliasing", () => {
  const calendar = createCalendarExternalActionConnector(new FakeCalendarProviderForTests());
  const messaging = createMessagingExternalActionConnector(new FakeMessagingProviderForTests());
  const registry = createExternalActionRegistry([calendar, messaging]);
  assert.equal(registry.connectorForProvider("calendar"), calendar);
  assert.equal(registry.connectorForProvider("messaging"), messaging);
  assert.equal(registry.connectorForTool("calendar_execute"), calendar);
  assert.equal(registry.connectorForTool("message_send"), messaging);
  assert.equal(registry.connectorForOperation({
    toolName: "calendar_execute",
    args: { provider: "calendar" },
  }), calendar);
  assert.equal(registry.connectorForOperation({
    toolName: "calendar_execute",
    args: { provider: "messaging" },
  }), null);
});

test("Calendar supports read and approved create, update, cancel, and delete actions", async () => {
  const provider = new FakeCalendarProviderForTests();
  const connector = createCalendarExternalActionConnector(provider);
  const calendarId = "primary";
  const eventId = "existing-event";
  provider.seed(identity, {
    eventId,
    calendarId,
    summary: "Planning",
    description: "Initial plan",
    startAt: "2026-10-08T10:00:00Z",
    endAt: "2026-10-08T11:00:00Z",
    timeZone: "Africa/Cairo",
    status: "confirmed",
  });

  const read = await provider.listEvents(identity, { calendarId });
  assert.equal(read.length, 1);
  assert.equal(read[0]?.eventId, eventId);

  const createContext = recordForContext({
    connector,
    provider: "calendar",
    identity,
    action: {
      type: "create_event",
      calendarId,
      summary: "Design review",
      description: "Review the revised prototype.",
      startAt: "2026-10-09T10:00:00Z",
      endAt: "2026-10-09T10:30:00Z",
      timeZone: "Africa/Cairo",
    },
  });
  assert.equal(provider.writeCount, 0, "preparing approval must not contact the provider");
  const created = await connector.executeApproved({
    identity,
    operation: createContext.operation,
    storage: createContext.storage,
  });
  assert.equal(created.status, "verified");
  assert.equal(externalStatus(created.executionResult), "verified");
  assert.equal(provider.writeCount, 1);
  assert.deepEqual(
    createContext.events.map((event) => event.eventType),
    ["external_action_step_started", "external_action_step_verified"],
  );

  const updated = recordForContext({
    connector,
    provider: "calendar",
    identity,
    action: {
      type: "update_event",
      calendarId,
      eventId,
      summary: "Planning update",
      description: "Updated details.",
      startAt: "2026-10-08T11:00:00Z",
      endAt: "2026-10-08T12:00:00Z",
      timeZone: "Africa/Cairo",
    },
  });
  const updateResult = await connector.executeApproved({
    identity,
    operation: updated.operation,
    storage: updated.storage,
  });
  assert.equal(updateResult.status, "verified");
  assert.equal((await provider.getEvent(identity, calendarId, eventId))?.summary, "Planning update");

  const cancelled = recordForContext({
    connector,
    provider: "calendar",
    identity,
    action: { type: "cancel_event", calendarId, eventId },
  });
  const cancelResult = await connector.executeApproved({
    identity,
    operation: cancelled.operation,
    storage: cancelled.storage,
  });
  assert.equal(cancelResult.status, "verified");
  assert.equal((await provider.getEvent(identity, calendarId, eventId))?.status, "cancelled");

  const deleted = recordForContext({
    connector,
    provider: "calendar",
    identity,
    action: { type: "delete_event", calendarId, eventId },
  });
  const deleteResult = await connector.executeApproved({
    identity,
    operation: deleted.operation,
    storage: deleted.storage,
  });
  assert.equal(deleteResult.status, "verified");
  assert.equal(await provider.getEvent(identity, calendarId, eventId), null);
});

test("Calendar unknown writes reconcile by read-back and are never automatically replayed", async () => {
  const provider = new FakeCalendarProviderForTests();
  provider.outcome = "accepted_ack_lost";
  const connector = createCalendarExternalActionConnector(provider);
  const context = recordForContext({
    connector,
    provider: "calendar",
    identity,
    action: {
      type: "create_event",
      calendarId: "primary",
      summary: "Ack-lost event",
      startAt: "2026-10-10T10:00:00Z",
      endAt: "2026-10-10T10:30:00Z",
      timeZone: "Africa/Cairo",
    },
  });
  const result = await connector.executeApproved({
    identity,
    operation: context.operation,
    storage: context.storage,
  });
  assert.equal(result.status, "verified");
  assert.equal(provider.writeCount, 1);
  assert.deepEqual(
    context.events.map((event) => event.eventType),
    [
      "external_action_step_started",
      "external_action_unknown_result",
      "external_action_step_verified",
    ],
  );

  const uncertainProvider = new FakeCalendarProviderForTests();
  uncertainProvider.outcome = "timeout_before_write";
  const uncertainConnector = createCalendarExternalActionConnector(uncertainProvider);
  const uncertain = recordForContext({
    connector: uncertainConnector,
    provider: "calendar",
    identity,
    action: {
      type: "create_event",
      calendarId: "primary",
      summary: "Unconfirmed event",
      startAt: "2026-10-11T10:00:00Z",
      endAt: "2026-10-11T10:30:00Z",
      timeZone: "Africa/Cairo",
    },
  });
  const first = await uncertainConnector.executeApproved({
    identity,
    operation: uncertain.operation,
    storage: uncertain.storage,
  });
  const replay = await uncertainConnector.executeApproved({
    identity,
    operation: uncertain.operation,
    storage: uncertain.storage,
  });
  assert.equal(first.status, "unknown_result");
  assert.equal(replay.status, "unknown_result");
  assert.equal(uncertainProvider.writeCount, 1);
});

test("provider-neutral messaging sends only after approval and reconciles lost acknowledgements", async () => {
  const provider = new FakeMessagingProviderForTests();
  provider.outcome = "accepted_ack_lost";
  const connector = createMessagingExternalActionConnector(provider);
  const context = recordForContext({
    connector,
    provider: "messaging",
    identity,
    action: {
      type: "send_message",
      recipient: "user:1234",
      channel: "chat",
      body: "I will arrive at 10:30.",
    },
  });
  assert.equal(provider.sendCount, 0, "preparing approval must not send");
  const result = await connector.executeApproved({
    identity,
    operation: context.operation,
    storage: context.storage,
  });
  assert.equal(result.status, "verified");
  assert.equal(provider.sendCount, 1);
  assert.equal(externalStatus(result.executionResult), "verified");
  assert.deepEqual(
    context.events.map((event) => event.eventType),
    [
      "external_action_step_started",
      "external_action_unknown_result",
      "external_action_step_verified",
    ],
  );
});

test("provider-neutral messaging keeps an unconfirmed send review-only and binds approval to exact content", async () => {
  const provider = new FakeMessagingProviderForTests();
  provider.outcome = "timeout_before_accept";
  const connector = createMessagingExternalActionConnector(provider);
  const context = recordForContext({
    connector,
    provider: "messaging",
    identity,
    action: {
      type: "send_message",
      recipient: "user:5678",
      channel: "sms",
      body: "Please call me.",
    },
  });
  const first = await connector.executeApproved({
    identity,
    operation: context.operation,
    storage: context.storage,
  });
  const replay = await connector.executeApproved({
    identity,
    operation: context.operation,
    storage: context.storage,
  });
  assert.equal(first.status, "unknown_result");
  assert.equal(replay.status, "unknown_result");
  assert.equal(provider.sendCount, 1);

  const tamperedProvider = new FakeMessagingProviderForTests();
  const tamperedConnector = createMessagingExternalActionConnector(tamperedProvider);
  const tampered = recordForContext({
    connector: tamperedConnector,
    provider: "messaging",
    identity,
    action: {
      type: "send_message",
      recipient: "user:9012",
      channel: "chat",
      body: "Approved text.",
    },
  });
  tampered.operation.args = {
    ...tampered.operation.args,
    action: {
      ...(tampered.operation.args as Record<string, unknown>).action as Record<string, unknown>,
      body: "Different text.",
    },
  };
  await assert.rejects(
    tamperedConnector.executeApproved({
      identity,
      operation: tampered.operation,
      storage: tampered.storage,
    }),
    /EXTERNAL_ACTION_APPROVAL_CONTEXT_MISMATCH/u,
  );
  assert.equal(tamperedProvider.sendCount, 0);
});