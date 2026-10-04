import type { AgentWorkIdentity } from "./types";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const REQUEST_TIMEOUT_MS = 15_000;

export type CalendarEventContent = {
  summary: string;
  description?: string;
  startAt: string;
  endAt: string;
  timeZone: string;
};

export type CalendarEventRecord = CalendarEventContent & {
  eventId: string;
  calendarId: string;
  status: "confirmed" | "tentative" | "cancelled" | "unknown";
};

export type CalendarEventQuery = {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
};

export class CalendarProviderError extends Error {
  constructor(
    readonly code: string,
    readonly outcome: "failed" | "unknown_result",
  ) {
    super(code);
    this.name = "CalendarProviderError";
  }
}

export interface CalendarProviderAdapter {
  listEvents(identity: AgentWorkIdentity, query?: CalendarEventQuery): Promise<CalendarEventRecord[]>;
  getEvent(
    identity: AgentWorkIdentity,
    calendarId: string,
    eventId: string,
  ): Promise<CalendarEventRecord | null>;
  createEvent(
    identity: AgentWorkIdentity,
    calendarId: string,
    content: CalendarEventContent,
    idempotencyKey: string,
  ): Promise<CalendarEventRecord>;
  updateEvent(
    identity: AgentWorkIdentity,
    calendarId: string,
    eventId: string,
    content: CalendarEventContent,
  ): Promise<CalendarEventRecord>;
  cancelEvent(
    identity: AgentWorkIdentity,
    calendarId: string,
    eventId: string,
  ): Promise<CalendarEventRecord>;
  deleteEvent(identity: AgentWorkIdentity, calendarId: string, eventId: string): Promise<void>;
}

type GoogleEvent = Record<string, unknown> & {
  id?: unknown;
  summary?: unknown;
  description?: unknown;
  status?: unknown;
  start?: unknown;
  end?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return {};
  }
}

function eventRecord(value: unknown, calendarId: string): CalendarEventRecord | null {
  const event = asRecord(value) as GoogleEvent;
  const start = asRecord(event.start);
  const end = asRecord(event.end);
  const startAt = typeof start.dateTime === "string"
    ? start.dateTime
    : typeof start.date === "string" ? start.date : null;
  const endAt = typeof end.dateTime === "string"
    ? end.dateTime
    : typeof end.date === "string" ? end.date : null;
  if (typeof event.id !== "string" || !event.id || !startAt || !endAt) return null;
  const status = event.status === "confirmed"
    || event.status === "tentative"
    || event.status === "cancelled"
    ? event.status
    : "unknown";
  return {
    eventId: event.id,
    calendarId,
    summary: typeof event.summary === "string" ? event.summary : "",
    ...(typeof event.description === "string" ? { description: event.description } : {}),
    startAt,
    endAt,
    timeZone: typeof start.timeZone === "string"
      ? start.timeZone
      : typeof end.timeZone === "string" ? end.timeZone : "UTC",
    status,
  };
}

export class GoogleCalendarProviderAdapter implements CalendarProviderAdapter {
  constructor(
    private readonly accessTokenForIdentity: (identity: AgentWorkIdentity) => Promise<string>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async listEvents(
    identity: AgentWorkIdentity,
    query: CalendarEventQuery = {},
  ): Promise<CalendarEventRecord[]> {
    const calendarId = query.calendarId?.trim() || "primary";
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(Math.max(1, Math.min(250, query.maxResults ?? 100))),
    });
    if (query.timeMin) params.set("timeMin", query.timeMin);
    if (query.timeMax) params.set("timeMax", query.timeMax);
    const response = await this.request(
      identity,
      `${this.calendarPath(calendarId)}/events?${params.toString()}`,
      "GET",
      undefined,
      false,
    );
    const events = Array.isArray(response.items) ? response.items : [];
    return events
      .map((item) => eventRecord(item, calendarId))
      .filter((item): item is CalendarEventRecord => item !== null);
  }

  async getEvent(
    identity: AgentWorkIdentity,
    calendarId: string,
    eventId: string,
  ): Promise<CalendarEventRecord | null> {
    const response = await this.request(
      identity,
      `${this.calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}`,
      "GET",
      undefined,
      false,
      true,
    );
    return response ? eventRecord(response, calendarId) : null;
  }

  async createEvent(
    identity: AgentWorkIdentity,
    calendarId: string,
    content: CalendarEventContent,
    idempotencyKey: string,
  ): Promise<CalendarEventRecord> {
    const eventId = idempotencyKey.split(":")[1];
    if (!eventId || !/^[a-f0-9]{64}$/u.test(eventId)) {
      throw new CalendarProviderError("CALENDAR_IDEMPOTENCY_KEY_INVALID", "failed");
    }
    let response: Record<string, unknown>;
    try {
      response = await this.request(
        identity,
        `${this.calendarPath(calendarId)}/events`,
        "POST",
        { id: eventId, ...this.eventBody(content) },
        true,
      );
    } catch (error) {
      if (!(error instanceof CalendarProviderError)
        || error.code !== "CALENDAR_REQUEST_REJECTED") throw error;
      // A deterministic Google event ID makes a repeated create discoverable.
      const existing = await this.getEvent(identity, calendarId, eventId).catch(() => null);
      if (existing && this.matchesContent(existing, content)) return existing;
      throw error;
    }
    const created = eventRecord(response, calendarId);
    if (!created) throw new CalendarProviderError("CALENDAR_CREATE_ACK_INCOMPLETE", "unknown_result");
    return created;
  }

  async updateEvent(
    identity: AgentWorkIdentity,
    calendarId: string,
    eventId: string,
    content: CalendarEventContent,
  ): Promise<CalendarEventRecord> {
    const response = await this.request(
      identity,
      `${this.calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}`,
      "PATCH",
      this.eventBody(content),
      true,
    );
    const updated = eventRecord(response, calendarId);
    if (!updated) throw new CalendarProviderError("CALENDAR_UPDATE_ACK_INCOMPLETE", "unknown_result");
    return updated;
  }

  async cancelEvent(
    identity: AgentWorkIdentity,
    calendarId: string,
    eventId: string,
  ): Promise<CalendarEventRecord> {
    const response = await this.request(
      identity,
      `${this.calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}`,
      "PATCH",
      { status: "cancelled" },
      true,
    );
    const cancelled = eventRecord(response, calendarId);
    if (!cancelled) throw new CalendarProviderError("CALENDAR_CANCEL_ACK_INCOMPLETE", "unknown_result");
    return cancelled;
  }

  async deleteEvent(
    identity: AgentWorkIdentity,
    calendarId: string,
    eventId: string,
  ): Promise<void> {
    await this.request(
      identity,
      `${this.calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}`,
      "DELETE",
      undefined,
      true,
      true,
    );
  }

  private calendarPath(calendarId: string): string {
    return `/calendars/${encodeURIComponent(calendarId)}`;
  }

  private eventBody(content: CalendarEventContent): Record<string, unknown> {
    return {
      summary: content.summary,
      ...(content.description !== undefined ? { description: content.description } : {}),
      start: { dateTime: content.startAt, timeZone: content.timeZone },
      end: { dateTime: content.endAt, timeZone: content.timeZone },
    };
  }

  private matchesContent(
    event: CalendarEventRecord,
    content: CalendarEventContent,
  ): boolean {
    return event.summary === content.summary
      && event.startAt === content.startAt
      && event.endAt === content.endAt
      && event.timeZone === content.timeZone
      && (event.description ?? "") === (content.description ?? "");
  }

  private request(
    identity: AgentWorkIdentity,
    path: string,
    method: string,
    body: Record<string, unknown> | undefined,
    isWrite: boolean,
    allowNotFound: true,
  ): Promise<Record<string, unknown> | null>;
  private request(
    identity: AgentWorkIdentity,
    path: string,
    method: string,
    body: Record<string, unknown> | undefined,
    isWrite: boolean,
    allowNotFound?: false,
  ): Promise<Record<string, unknown>>;
  private async request(
    identity: AgentWorkIdentity,
    path: string,
    method: string,
    body: Record<string, unknown> | undefined,
    isWrite: boolean,
    allowNotFound = false,
  ): Promise<Record<string, unknown> | null> {
    let accessToken: string;
    try {
      accessToken = await this.accessTokenForIdentity(identity);
    } catch {
      throw new CalendarProviderError("CALENDAR_AUTH_UNAVAILABLE", "failed");
    }
    let response: Response;
    try {
      response = await this.fetcher(`${GOOGLE_CALENDAR_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new CalendarProviderError(
        "CALENDAR_REQUEST_OUTCOME_UNKNOWN",
        isWrite ? "unknown_result" : "failed",
      );
    }
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      throw new CalendarProviderError(
        response.status >= 500 && isWrite
          ? "CALENDAR_REQUEST_OUTCOME_UNKNOWN"
          : "CALENDAR_REQUEST_REJECTED",
        response.status >= 500 && isWrite ? "unknown_result" : "failed",
      );
    }
    return responseJson(response);
  }
}