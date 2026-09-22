/**
 * Synchronous client-side gates for Quick actions.
 *
 * React state is useful for rendering a busy button, but it is not a safe
 * duplicate guard: two presses can arrive before the state update rerenders.
 * Keep this small and framework-free so the mobile action contract can be
 * regression-tested without starting a native runtime.
 */
export function createQuickActionGuard() {
  let turnInFlight = false;
  const approvalsInFlight = new Set<string>();

  return {
    tryBeginTurn() {
      if (turnInFlight) return false;
      turnInFlight = true;
      return true;
    },

    endTurn() {
      turnInFlight = false;
    },

    tryBeginApproval(operationId: string) {
      if (approvalsInFlight.has(operationId)) return false;
      approvalsInFlight.add(operationId);
      return true;
    },

    endApproval(operationId: string) {
      approvalsInFlight.delete(operationId);
    },
  };
}