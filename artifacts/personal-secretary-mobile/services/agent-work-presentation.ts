export function agentWorkIdFromAction(action: unknown): string | undefined {
  if (!action || typeof action !== 'object') return undefined;
  const value = action as Record<string, unknown>;
  return value.type === 'agent_work_created'
    && typeof value.workId === 'string'
    && value.workId.trim().length > 0
    ? value.workId
    : undefined;
}

export function workRetryAllowed(
  status: string,
  unknownOutcome: boolean,
  needsReview: boolean,
): boolean {
  return status === 'failed' && !unknownOutcome && !needsReview;
}
