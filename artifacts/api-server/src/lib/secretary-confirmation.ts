import type { TurnInputChannel } from "@workspace/api-zod";

export type ConfirmationMode = "immediate_approval" | "deferred_confirmation";

const QUICK_DIRECT_APPROVAL_TOOLS = new Set(["record_expense", "create_reminder"]);

export function confirmationModeFor(
  channel: TurnInputChannel | undefined,
  toolName: unknown,
): ConfirmationMode {
  return channel === "quick"
    && typeof toolName === "string"
    && QUICK_DIRECT_APPROVAL_TOOLS.has(toolName)
    ? "deferred_confirmation"
    : "immediate_approval";
}

export function annotateApprovalAction(
  action: Record<string, unknown> | undefined,
  channel: TurnInputChannel | undefined,
): Record<string, unknown> | undefined {
  if (!action || action.type !== "approval_required") return action;
  const mode = confirmationModeFor(channel, action.toolName);
  return {
    ...action,
    type: mode === "deferred_confirmation" ? "pending_confirmation" : "approval_required",
    confirmationMode: mode,
    quickApprove: mode === "deferred_confirmation",
  };
}

export function approvalMessage(
  action: Record<string, unknown> | undefined,
  fallback: string,
  channel: TurnInputChannel | undefined,
): string {
  const annotated = annotateApprovalAction(action, channel);
  if (annotated?.type !== "pending_confirmation") return fallback;
  const display = annotated.display && typeof annotated.display === "object"
    ? annotated.display as { details?: unknown }
    : {};
  const details = Array.isArray(display.details)
    ? display.details.filter((detail): detail is string => typeof detail === "string")
    : [];
  return `تمام، كتبتها مؤقتًا${details.length > 0 ? `: ${details.join(" — ")}` : ""}. في انتظار تأكيدك.`;
}