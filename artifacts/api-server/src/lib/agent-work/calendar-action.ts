import { z } from "zod";
import type { ExternalActionConnector } from "./external-action";
import {
  CalendarProviderError,
  type CalendarEventContent,
  type CalendarEventRecord,
  type CalendarProviderAdapter,
} from "./calendar-provider";
import { createSingleStepExternalActionConnector } from "./single-step-external-action";
import type { AgentWorkIdentity } from "./types";

const dateTimeSchema = z.string().trim().datetime({ offset: true }).max(40);
const calendarIdSchema = z.string().trim().min(1).max(255).default("primary");
const eventIdSchema = z.string().trim().min(1).max(512);

const calendarActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_event"),
    calendarId: calendarIdSchema,
    summary: z.string().trim().min(1).max(200),
    description: z.string().max(8_000).optional(),
    startAt: dateTimeSchema,
    endAt: dateTimeSchema,
    timeZone: z.string().trim().min(1).max(100),
  }).strict(),
  z.object({
    type: z.literal("update_event"),
    calendarId: calendarIdSchema,
    eventId: eventIdSchema,
    summary: z.string().trim().min(1).max(200),
    description: z.string().max(8_000).optional(),
    startAt: dateTimeSchema,
    endAt: dateTimeSchema,
    timeZone: z.string().trim().min(1).max(100),
  }).strict(),
  z.object({
    type: z.literal("cancel_event"),
    calendarId: calendarIdSchema,
    eventId: eventIdSchema,
  }).strict(),
  z.object({
    type: z.literal("delete_event"),
    calendarId: calendarIdSchema,
    eventId: eventIdSchema,
  }).strict(),
]).superRefine((action, context) => {
  if ("startAt" in action && Date.parse(action.endAt) <= Date.parse(action.startAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endAt"],
      message: "Calendar event end must be after its start.",
    });
  }
});

type CalendarAction = z.infer<typeof calendarActionSchema>;
type StoredCalendarAction = CalendarAction & {
  actionId: string;
  setupApprovalOperationId: string;
};

function parseStoredCalendarAction(value: unknown): StoredCalendarAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { actionId, setupApprovalOperationId, ...actionValue } =
    value as Record<string, unknown>;
  if (!z.string().uuid().safeParse(actionId).success
    || !z.string().uuid().safeParse(setupApprovalOperationId).success) {
    return null;
  }
  const parsedAction = calendarActionSchema.safeParse(actionValue);
  if (!parsedAction.success) return null;
  return {
    ...parsedAction.data,
    actionId: actionId as string,
    setupApprovalOperationId: setupApprovalOperationId as string,
  } as StoredCalendarAction;
}

function contentFor(action: StoredCalendarAction): CalendarEventContent | null {
  if (!("startAt" in action)) return null;
  return {
    summary: action.summary,
    ...(action.description !== undefined ? { description: action.description } : {}),
    startAt: action.startAt,
    endAt: action.endAt,
    timeZone: action.timeZone,
  };
}

function eventMatches(
  event: CalendarEventRecord,
  action: StoredCalendarAction,
  status: CalendarEventRecord["status"] = "confirmed",
): boolean {
  const content = contentFor(action);
  if (!content) return event.status === status;
  return event.status === status
    && event.summary === content.summary
    && Date.parse(event.startAt) === Date.parse(content.startAt)
    && Date.parse(event.endAt) === Date.parse(content.endAt)
    && event.timeZone === content.timeZone
    && (event.description ?? "") === (content.description ?? "");
}

function stableCreateEventId(idempotencyKey: string): string {
  return idempotencyKey.split(":")[1] ?? "";
}

async function reconcileCalendarAction(input: {
  provider: CalendarProviderAdapter;
  identity: AgentWorkIdentity;
  action: StoredCalendarAction;
  idempotencyKey: string;
}): Promise<
  | { status: "verified"; verification: Record<string, unknown>; providerReference?: Record<string, unknown> }
  | {
      status: "unknown_result";
      error: {
        code: string;
        outcome: "unknown_result";
        retryable: false;
        reviewRequired: true;
      };
      verification: Record<string, unknown>;
      providerReference?: Record<string, unknown>;
    }
> {
  const eventId = input.action.type === "create_event"
    ? stableCreateEventId(input.idempotencyKey)
    : input.action.eventId;
  try {
    const event = await input.provider.getEvent(
      input.identity,
      input.action.calendarId,
      eventId,
    );
    if (input.action.type === "delete_event") {
      return event === null
        ? {
            status: "verified",
            verification: { state: "verified", method: "event_absence_lookup" },
            providerReference: { calendarId: input.action.calendarId, eventId },
          }
        : {
            status: "unknown_result",
            error: {
              code: "CALENDAR_DELETE_NOT_CONFIRMED",
              outcome: "unknown_result",
              retryable: false,
              reviewRequired: true,
            },
            verification: { state: "unknown_result", reason: "EVENT_STILL_EXISTS" },
            providerReference: { calendarId: input.action.calendarId, eventId },
          };
    }
    const expectedStatus = input.action.type === "cancel_event" ? "cancelled" : "confirmed";
    if (!event || !eventMatches(event, input.action, expectedStatus)) {
      return {
        status: "unknown_result",
        error: {
          code: "CALENDAR_EVENT_NOT_CONFIRMED",
          outcome: "unknown_result",
          retryable: false,
          reviewRequired: true,
        },
        verification: { state: "unknown_result", reason: "EVENT_CONTENT_MISMATCH" },
        ...(event ? { providerReference: { calendarId: event.calendarId, eventId: event.eventId } } : {}),
      };
    }
    return {
      status: "verified",
      verification: { state: "verified", method: "event_read_back" },
      providerReference: { calendarId: event.calendarId, eventId: event.eventId },
    };
  } catch {
    return {
      status: "unknown_result",
      error: {
        code: "CALENDAR_RECONCILIATION_UNAVAILABLE",
        outcome: "unknown_result",
        retryable: false,
        reviewRequired: true,
      },
      verification: { state: "unknown_result", reason: "READ_BACK_UNAVAILABLE" },
      providerReference: { calendarId: input.action.calendarId, eventId },
    };
  }
}

export function createCalendarExternalActionConnector(
  provider: CalendarProviderAdapter,
): ExternalActionConnector {
  return createSingleStepExternalActionConnector<CalendarAction, StoredCalendarAction>({
    provider: "calendar",
    actionType: "calendar_event",
    approvalToolName: "calendar_execute",
    version: "calendar-event-v1",
    toolGuidance:
      "Calendar writes require a separate approval. Use create_event, update_event, cancel_event, or delete_event with an explicit calendar and event identity. Read-only event searches do not require approval. Unknown write results are reconciled by read-back and are never resent automatically.",
    parseAction(value) {
      const parsed = calendarActionSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    },
    storeAction(action, actionId, setupApprovalOperationId) {
      return parseStoredCalendarAction({
        ...action,
        actionId,
        setupApprovalOperationId,
      });
    },
    parseStoredAction(value) {
      return parseStoredCalendarAction(value);
    },
    display(action) {
      const title = action.type === "create_event"
        ? "Create calendar event"
        : action.type === "update_event"
          ? "Update calendar event"
          : action.type === "cancel_event"
            ? "Cancel calendar event"
            : "Delete calendar event";
      const details = [
        `Calendar: ${action.calendarId}`,
        ...("eventId" in action ? [`Event ID: ${action.eventId}`] : []),
        ...("summary" in action ? [`Title: ${action.summary}`] : []),
        ...("startAt" in action ? [`Start: ${action.startAt}`, `End: ${action.endAt}`] : []),
        "No calendar write occurs until this action is approved.",
      ];
      return { title, details };
    },
    evidence(action) {
      return {
        operation: action.type,
        calendarId: action.calendarId,
        ...(action.type === "create_event" || action.type === "update_event"
          ? { summaryLength: action.summary.length }
          : { targetEventId: action.eventId }),
      };
    },
    notification(action) {
      const operation = action.type.replace("_", " ");
      const subject = "summary" in action ? ` “${action.summary}”` : "";
      return {
        title: "Calendar action needs approval",
        body: `Review the ${operation}${subject}; no calendar write has started.`,
      };
    },
    adapter: {
      async execute({ identity, action, idempotencyKey }) {
        try {
          if (action.type === "create_event") {
            const content = contentFor(action)!;
            await provider.createEvent(identity, action.calendarId, content, idempotencyKey);
          } else if (action.type === "update_event") {
            await provider.updateEvent(identity, action.calendarId, action.eventId, contentFor(action)!);
          } else if (action.type === "cancel_event") {
            await provider.cancelEvent(identity, action.calendarId, action.eventId);
          } else {
            await provider.deleteEvent(identity, action.calendarId, action.eventId);
          }
          return reconcileCalendarAction({ provider, identity, action, idempotencyKey });
        } catch (error) {
          if (error instanceof CalendarProviderError && error.outcome === "failed") {
            return {
              status: "failed" as const,
              error: {
                code: error.code,
                outcome: "failed" as const,
                retryable: false,
                reviewRequired: true,
              },
              verification: { state: "failed", reason: error.code },
            };
          }
          return {
            status: "unknown_result" as const,
            error: {
              code: error instanceof CalendarProviderError
                ? error.code
                : "CALENDAR_WRITE_OUTCOME_UNKNOWN",
              outcome: "unknown_result" as const,
              retryable: false,
              reviewRequired: true,
            },
            verification: { state: "unknown_result", reason: "WRITE_ACKNOWLEDGEMENT_UNCONFIRMED" },
            providerReference: {
              calendarId: action.calendarId,
              eventId: action.type === "create_event"
                ? stableCreateEventId(idempotencyKey)
                : action.eventId,
            },
          };
        }
      },
      reconcile({ identity, action, idempotencyKey }) {
        return reconcileCalendarAction({ provider, identity, action, idempotencyKey });
      },
    },
  });
}