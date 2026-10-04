import assert from "node:assert/strict";
import test from "node:test";
import type { DbExecutor } from "../src/lib/entity-graph";
import {
  enqueueProactiveDeadlineTriggers,
  type ProactiveDeadlineRecord,
} from "../src/lib/proactive-triggers";
import type {
  EnqueueTriggerOutboxInput,
  TriggerOutboxEvent,
} from "../src/lib/trigger-outbox";
import { enqueueTriggerOutbox } from "../src/lib/trigger-outbox";

const identity = { tenantId: "tenant-a", userId: "owner-a" };
const executor = {} as DbExecutor;

function captureWriter(events: EnqueueTriggerOutboxInput[]) {
  const writer: typeof enqueueTriggerOutbox = async (input) => {
    events.push(input);
    return {
      event: {} as TriggerOutboxEvent,
      created: true,
    };
  };
  return writer;
}

function deadline(
  overrides: Partial<ProactiveDeadlineRecord> = {},
): ProactiveDeadlineRecord {
  return {
    entityType: "task",
    entityId: "record-a",
    title: "Prepare review",
    dueAt: new Date("2026-09-25T12:00:00.000Z"),
    status: "pending",
    rowVersion: 4,
    occurredAt: new Date("2026-09-24T00:00:00.000Z"),
    ...overrides,
  };
}

test("active task deadline creates next-day and overdue events with versioned identity", async () => {
  const events: EnqueueTriggerOutboxInput[] = [];
  await enqueueProactiveDeadlineTriggers(identity, deadline(), executor, captureWriter(events));

  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.eventType), ["task.approaching", "task.overdue"]);
  assert.equal(events[0]?.availableAt?.toISOString(), "2026-09-24T12:00:00.000Z");
  assert.equal(events[1]?.availableAt?.toISOString(), "2026-09-25T12:00:00.000Z");
  assert.match(events[0]?.dedupeKey ?? "", /:v4:/);
  assert.match(events[1]?.dedupeKey ?? "", /:overdue:v4:/);
});

test("commitments keep overdue events and reminders get a separate due-time event", async () => {
  const commitmentEvents: EnqueueTriggerOutboxInput[] = [];
  await enqueueProactiveDeadlineTriggers(
    identity,
    deadline({
      entityType: "commitment",
      status: "open",
      dueAt: new Date("2026-09-24T03:00:00.000Z"),
    }),
    executor,
    captureWriter(commitmentEvents),
  );
  assert.deepEqual(
    commitmentEvents.map((event) => event.eventType),
    ["commitment.approaching", "commitment.overdue"],
  );
  assert.equal(commitmentEvents[0]?.availableAt?.toISOString(), "2026-09-24T00:00:00.000Z");

  const reminderEvents: EnqueueTriggerOutboxInput[] = [];
  await enqueueProactiveDeadlineTriggers(
    identity,
    deadline({
      entityType: "reminder",
      entityId: "reminder-a",
      status: "scheduled",
      dueAt: new Date("2026-09-26T12:00:00.000Z"),
    }),
    executor,
    captureWriter(reminderEvents),
  );
  assert.deepEqual(reminderEvents.map((event) => event.eventType), ["reminder.approaching", "reminder.due"]);
  assert.equal(reminderEvents[0]?.availableAt?.toISOString(), "2026-09-25T12:00:00.000Z");
  assert.equal(reminderEvents[1]?.availableAt?.toISOString(), "2026-09-26T12:00:00.000Z");
  assert.equal(reminderEvents[1]?.occurredAt.toISOString(), "2026-09-26T12:00:00.000Z");
  assert.equal(reminderEvents[1]?.payload.window, "due-time");
  assert.match(reminderEvents[1]?.dedupeKey ?? "", /:due-time:v4:/);

  const imminentReminderEvents: EnqueueTriggerOutboxInput[] = [];
  await enqueueProactiveDeadlineTriggers(
    identity,
    deadline({
      entityType: "reminder",
      entityId: "reminder-imminent",
      status: "scheduled",
      dueAt: new Date("2026-09-24T03:00:00.000Z"),
    }),
    executor,
    captureWriter(imminentReminderEvents),
  );
  assert.equal(imminentReminderEvents[0]?.availableAt?.toISOString(), "2026-09-24T00:00:00.000Z");

  const pastReminderEvents: EnqueueTriggerOutboxInput[] = [];
  await enqueueProactiveDeadlineTriggers(
    identity,
    deadline({
      entityType: "reminder",
      entityId: "reminder-past",
      status: "scheduled",
      dueAt: new Date("2026-09-24T03:00:00.000Z"),
      occurredAt: new Date("2026-09-25T03:00:00.000Z"),
    }),
    executor,
    captureWriter(pastReminderEvents),
  );
  assert.deepEqual(pastReminderEvents.map((event) => event.eventType), ["reminder.due"]);
  assert.equal(pastReminderEvents[0]?.availableAt?.toISOString(), "2026-09-24T03:00:00.000Z");
});

test("inactive or undated records never schedule proactive events", async () => {
  const events: EnqueueTriggerOutboxInput[] = [];
  const writer = captureWriter(events);
  await enqueueProactiveDeadlineTriggers(
    identity,
    deadline({ status: "completed" }),
    executor,
    writer,
  );
  await enqueueProactiveDeadlineTriggers(
    identity,
    deadline({ dueAt: null }),
    executor,
    writer,
  );
  assert.equal(events.length, 0);
});