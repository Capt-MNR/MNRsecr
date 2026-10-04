import {
  CalendarProviderError,
  type CalendarEventContent,
  type CalendarEventQuery,
  type CalendarEventRecord,
  type CalendarProviderAdapter,
} from "./calendar-provider";
import {
  messageContentHash,
  MessagingProviderError,
  type MessagingProviderAdapter,
  type MessagingProviderReceipt,
} from "./messaging-provider";
import type { AgentWorkIdentity } from "./types";

type FakeCalendarOutcome =
  | "accepted"
  | "rejected"
  | "timeout_before_write"
  | "accepted_ack_lost";

function identityKey(identity: AgentWorkIdentity): string {
  return `${identity.tenantId}:${identity.userId}`;
}

function calendarKey(
  identity: AgentWorkIdentity,
  calendarId: string,
  eventId: string,
): string {
  return `${identityKey(identity)}:${calendarId}:${eventId}`;
}

export class FakeCalendarProviderForTests implements CalendarProviderAdapter {
  outcome: FakeCalendarOutcome = "accepted";
  writeCount = 0;
  readCount = 0;
  private readonly events = new Map<string, CalendarEventRecord>();

  reset(outcome: FakeCalendarOutcome = "accepted"): void {
    this.outcome = outcome;
    this.writeCount = 0;
    this.readCount = 0;
    this.events.clear();
  }

  seed(identity: AgentWorkIdentity, event: CalendarEventRecord): void {
    this.events.set(calendarKey(identity, event.calendarId, event.eventId), { ...event });
  }

  async listEvents(
    identity: AgentWorkIdentity,
    query: CalendarEventQuery = {},
  ): Promise<CalendarEventRecord[]> {
    this.readCount += 1;
    const calendarId = query.calendarId || "primary";
    const prefix = `${identityKey(identity)}:`;
    return [...this.events.entries()]
      .filter(([key, event]) => key.startsWith(prefix) && event.calendarId === calendarId)
      .map(([, event]) => ({ ...event }));
  }

  async getEvent(
    identity: AgentWorkIdentity,
    calendarId: string,
    eventId: string,
  ): Promise<CalendarEventRecord | null> {
    this.readCount += 1;
    const event = this.events.get(calendarKey(identity, calendarId, eventId));
    return event ? { ...event } : null;
  }

  async createEvent(
    identity: AgentWorkIdentity,
    calendarId: string,
    content: CalendarEventContent,
    idempotencyKey: string,
  ): Promise<CalendarEventRecord> {
    this.beginWrite();
    const eventId = idempotencyKey.split(":")[1]!;
    const event: CalendarEventRecord = {
      ...content,
      eventId,
      calendarId,
      status: "confirmed",
    };
    this.events.set(calendarKey(identity, calendarId, eventId), event);
    this.acknowledgeWrite();
    return { ...event };
  }

  async updateEvent(
    identity: AgentWorkIdentity,
    calendarId: string,
    eventId: string,
    content: CalendarEventContent,
  ): Promise<CalendarEventRecord> {
    this.beginWrite();
    const key = calendarKey(identity, calendarId, eventId);
    const current = this.events.get(key);
    if (!current) throw new CalendarProviderError("CALENDAR_EVENT_NOT_FOUND", "failed");
    const event = { ...content, eventId, calendarId, status: "confirmed" as const };
    this.events.set(key, event);
    this.acknowledgeWrite();
    return { ...event };
  }

  async cancelEvent(
    identity: AgentWorkIdentity,
    calendarId: string,
    eventId: string,
  ): Promise<CalendarEventRecord> {
    this.beginWrite();
    const key = calendarKey(identity, calendarId, eventId);
    const current = this.events.get(key);
    if (!current) throw new CalendarProviderError("CALENDAR_EVENT_NOT_FOUND", "failed");
    const event = { ...current, status: "cancelled" as const };
    this.events.set(key, event);
    this.acknowledgeWrite();
    return { ...event };
  }

  async deleteEvent(
    identity: AgentWorkIdentity,
    calendarId: string,
    eventId: string,
  ): Promise<void> {
    this.beginWrite();
    this.events.delete(calendarKey(identity, calendarId, eventId));
    this.acknowledgeWrite();
  }

  private beginWrite(): void {
    this.writeCount += 1;
    if (this.outcome === "rejected") {
      throw new CalendarProviderError("CALENDAR_WRITE_REJECTED", "failed");
    }
    if (this.outcome === "timeout_before_write") {
      throw new CalendarProviderError("CALENDAR_WRITE_TIMEOUT", "unknown_result");
    }
  }

  private acknowledgeWrite(): void {
    if (this.outcome === "accepted_ack_lost") {
      throw new CalendarProviderError("CALENDAR_WRITE_ACK_LOST", "unknown_result");
    }
  }
}

type FakeMessagingOutcome =
  | "accepted"
  | "rejected"
  | "timeout_before_accept"
  | "accepted_ack_lost";

export class FakeMessagingProviderForTests implements MessagingProviderAdapter {
  outcome: FakeMessagingOutcome = "accepted";
  sendCount = 0;
  lookupCount = 0;
  private sequence = 0;
  private readonly receipts = new Map<string, MessagingProviderReceipt>();

  reset(outcome: FakeMessagingOutcome = "accepted"): void {
    this.outcome = outcome;
    this.sendCount = 0;
    this.lookupCount = 0;
    this.sequence = 0;
    this.receipts.clear();
  }

  async send(
    identity: AgentWorkIdentity,
    input: {
      recipient: string;
      channel: "sms" | "chat" | "in_app";
      body: string;
      idempotencyKey: string;
    },
  ): Promise<{ messageId: string }> {
    this.sendCount += 1;
    if (this.outcome === "rejected") {
      throw new MessagingProviderError("MESSAGE_REJECTED", "rejected");
    }
    if (this.outcome === "timeout_before_accept") {
      throw new MessagingProviderError("MESSAGE_ACK_UNAVAILABLE", "unknown_result");
    }
    const key = `${identityKey(identity)}:${input.idempotencyKey}`;
    let receipt = this.receipts.get(key);
    if (!receipt) {
      receipt = {
        messageId: `fake-message-${++this.sequence}`,
        recipient: input.recipient,
        channel: input.channel,
        contentHash: messageContentHash(input.body),
      };
      this.receipts.set(key, receipt);
    }
    if (this.outcome === "accepted_ack_lost") {
      throw new MessagingProviderError(
        "MESSAGE_ACCEPTED_ACK_LOST",
        "unknown_result",
        { messageId: receipt.messageId },
      );
    }
    return { messageId: receipt.messageId };
  }

  async findByIdempotencyKey(
    identity: AgentWorkIdentity,
    idempotencyKey: string,
  ): Promise<MessagingProviderReceipt | null> {
    this.lookupCount += 1;
    const receipt = this.receipts.get(`${identityKey(identity)}:${idempotencyKey}`);
    return receipt ? { ...receipt } : null;
  }
}

export const fakeCalendarProviderForTests = new FakeCalendarProviderForTests();
export const fakeMessagingProviderForTests = new FakeMessagingProviderForTests();