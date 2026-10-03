import type { PendingOperation } from "../secretary-operations";
import type { ExternalActionConnector } from "./external-action";
import {
  createEmailExternalActionConnector,
  fakeEmailExternalActionConnector,
} from "./fake-email-action";
import { GmailEmailProviderAdapter } from "./gmail-email-provider";
import { gmailOAuthConfigured, gmailOAuthService } from "../gmail-oauth";
import { googleSheetsExternalActionConnector } from "./google-sheets-action";

export function createExternalActionRegistry(
  inputConnectors: readonly ExternalActionConnector[],
) {
  const connectors = Object.freeze([...inputConnectors]);
  const connectorsByProvider = new Map<string, ExternalActionConnector>();
  const connectorsByTool = new Map<string, ExternalActionConnector>();

  for (const connector of connectors) {
    if (!connector.provider || connector.provider.trim() !== connector.provider) {
      throw new Error("EXTERNAL_ACTION_CONNECTOR_PROVIDER_INVALID");
    }
    if (!connector.approvalToolName
      || connector.approvalToolName.trim() !== connector.approvalToolName) {
      throw new Error("EXTERNAL_ACTION_CONNECTOR_APPROVAL_TOOL_INVALID");
    }
    if (connectorsByProvider.has(connector.provider)) {
      throw new Error("EXTERNAL_ACTION_CONNECTOR_PROVIDER_DUPLICATE");
    }
    if (connectorsByTool.has(connector.approvalToolName)) {
      throw new Error("EXTERNAL_ACTION_CONNECTOR_APPROVAL_TOOL_DUPLICATE");
    }
    connectorsByProvider.set(connector.provider, connector);
    connectorsByTool.set(connector.approvalToolName, connector);
  }

  function connectorForOperation(
    operation: Pick<PendingOperation, "toolName" | "args">,
  ): ExternalActionConnector | null {
    const args = operation.args ?? {};
    const providerHints = [args.provider, args.agentWorkSource]
      .filter((value) => value !== undefined);
    if (providerHints.length === 0) {
      return connectorsByTool.get(operation.toolName) ?? null;
    }
    if (providerHints.some((value) =>
      typeof value !== "string" || value.length === 0 || value.trim() !== value)) {
      return null;
    }

    const [provider] = providerHints as string[];
    if (providerHints.some((value) => value !== provider)) return null;

    const connector = connectorsByProvider.get(provider!);
    return connector?.approvalToolName === operation.toolName ? connector : null;
  }

  return Object.freeze({
    connectors,
    connectorForProvider(provider: string | null | undefined) {
      return typeof provider === "string"
        ? connectorsByProvider.get(provider) ?? null
        : null;
    },
    connectorForTool(toolName: string | null | undefined) {
      return typeof toolName === "string"
        ? connectorsByTool.get(toolName) ?? null
        : null;
    },
    connectorForOperation,
    toolGuidance() {
      return connectors.map((connector) => connector.toolGuidance).join(" ");
    },
  });
}

const gmailEmailExternalActionConnector = createEmailExternalActionConnector({
  providerAdapter: new GmailEmailProviderAdapter((identity) =>
    gmailOAuthService.accessToken(identity)),
  supportsAttachmentRef: false,
  toolGuidance:
    "Email is available through the user's individually connected Gmail account only when explicitly enabled. Use action.type send_email with one recipient, subject, and plain-text body; attachments are not supported. Every send requires separate approval and is verified against the sent mailbox. Unknown outcomes are never resent automatically.",
});

const connectors: readonly ExternalActionConnector[] = [
  googleSheetsExternalActionConnector,
  ...(process.env.NODE_ENV === "test"
    && process.env.AGENT_WORK_TEST_FAKE_EMAIL_CONNECTOR === "true"
    ? [fakeEmailExternalActionConnector]
    : []),
  ...(process.env.NODE_ENV !== "test" && gmailOAuthConfigured()
    ? [gmailEmailExternalActionConnector]
    : []),
];

const externalActionRegistry = createExternalActionRegistry(connectors);

export function externalActionConnectorForProvider(
  provider: string | null | undefined,
): ExternalActionConnector | null {
  return externalActionRegistry.connectorForProvider(provider);
}

export function externalActionConnectorForTool(
  toolName: string | null | undefined,
): ExternalActionConnector | null {
  return externalActionRegistry.connectorForTool(toolName);
}

export function externalActionConnectorForOperation(
  operation: Pick<PendingOperation, "toolName" | "args">,
): ExternalActionConnector | null {
  return externalActionRegistry.connectorForOperation(operation);
}

export function isExternalActionOperation(
  operation: Pick<PendingOperation, "toolName" | "args">,
): boolean {
  return externalActionConnectorForOperation(operation) !== null;
}

export function registeredExternalActionProviders(): readonly ExternalActionConnector[] {
  return externalActionRegistry.connectors;
}

export function externalActionToolGuidance(): string {
  return externalActionRegistry.toolGuidance();
}
