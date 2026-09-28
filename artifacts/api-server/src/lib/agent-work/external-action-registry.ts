import type { PendingOperation } from "../secretary-operations";
import type { ExternalActionConnector } from "./external-action";
import { googleSheetsExternalActionConnector } from "./google-sheets-action";

const connectors: readonly ExternalActionConnector[] = [
  googleSheetsExternalActionConnector,
];

export function externalActionConnectorForProvider(
  provider: string | null | undefined,
): ExternalActionConnector | null {
  return typeof provider === "string"
    ? connectors.find((connector) => connector.provider === provider) ?? null
    : null;
}

export function externalActionConnectorForTool(
  toolName: string | null | undefined,
): ExternalActionConnector | null {
  return typeof toolName === "string"
    ? connectors.find((connector) => connector.approvalToolName === toolName) ?? null
    : null;
}

export function externalActionConnectorForOperation(
  operation: Pick<PendingOperation, "toolName" | "args">,
): ExternalActionConnector | null {
  const args = operation.args;
  return externalActionConnectorForProvider(
    typeof args.provider === "string" ? args.provider
      : typeof args.agentWorkSource === "string" ? args.agentWorkSource
        : null,
  ) ?? externalActionConnectorForTool(operation.toolName);
}

export function isExternalActionOperation(
  operation: Pick<PendingOperation, "toolName" | "args">,
): boolean {
  return externalActionConnectorForOperation(operation) !== null;
}

export function registeredExternalActionProviders(): readonly ExternalActionConnector[] {
  return connectors;
}

export function externalActionToolGuidance(): string {
  return connectors.map((connector) => connector.toolGuidance).join(" ");
}