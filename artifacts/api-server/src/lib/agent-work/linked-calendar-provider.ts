import { googleCalendarOAuthService } from "../google-calendar-oauth";
import { createCalendarExternalActionConnector } from "./calendar-action";
import {
  GoogleCalendarProviderAdapter,
  type CalendarProviderAdapter,
} from "./calendar-provider";

export function createLinkedGoogleCalendarProvider(
  fetcher: typeof fetch = fetch,
): CalendarProviderAdapter {
  return new GoogleCalendarProviderAdapter(
    (identity) => googleCalendarOAuthService.accessToken(identity),
    fetcher,
  );
}

export function createLinkedGoogleCalendarExternalActionConnector(
  fetcher: typeof fetch = fetch,
) {
  return createCalendarExternalActionConnector(createLinkedGoogleCalendarProvider(fetcher));
}