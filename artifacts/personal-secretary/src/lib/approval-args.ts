export type ReminderApprovalInput = {
  text?: unknown;
  dueAt?: unknown;
  timezone?: unknown;
};

export type ReminderApprovalArgs = {
  text: string;
  dueAt: string;
  timezone: string;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function prepareReminderApprovalArgs(
  input: ReminderApprovalInput,
): ReminderApprovalArgs | null {
  const text = stringValue(input.text);
  const rawDueAt = stringValue(input.dueAt);
  const date = new Date(rawDueAt);
  if (!text || Number.isNaN(date.getTime())) return null;

  return {
    text,
    dueAt: date.toISOString(),
    timezone: stringValue(input.timezone) || "Africa/Cairo",
  };
}