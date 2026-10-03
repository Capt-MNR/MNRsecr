import type { PendingOperation } from "../secretary-operations";
import type { ExternalActionConnector } from "./external-action";
import {
  createEmailExternalActionConnector,
  fakeEmailExternalActionConnector,
} from "./fake-email-action";
import { GmailEmailProviderAdapter } from "./gmail-email-provider";
import { gmailOAuthConfigured, gmailOAuthService } from "../gmail-oauth";
import { googleSheetsExternalActionConnector } from "./google-sheets-action";

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