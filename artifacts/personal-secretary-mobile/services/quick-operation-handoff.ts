export type QuickOperationStateHint = 'unknown_result' | 'needs_review';

export type QuickOperationRouteParams = {
  operationId: string;
  conversationId?: string;
  operationState?: QuickOperationStateHint;
};

export function quickOperationRouteParams(
  operationId: string,
  conversationId?: string,
  operationState?: QuickOperationStateHint,
): QuickOperationRouteParams {
  return {
    operationId,
    ...(conversationId ? { conversationId } : {}),
    ...(operationState ? { operationState } : {}),
  };
}
