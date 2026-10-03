import { createHash } from "node:crypto";
import type { AgentWorkIdentity } from "./types";

export type EmailProviderReference = {
  messageId?: string;
  threadId?: string;
  stableMessageId?: string;
};

export type EmailSendInput = {
  identity: AgentWorkIdentity;
  recipient: string;
  subject: string;
  body: string;
  attachmentRef?: string;
  idempotencyKey: string;
  stableMessageId: string;
};

export type EmailVerificationInput = Omit<EmailSendInput, "body"> & {
  providerReference?: EmailProviderReference;
};

export type EmailProviderVerification = {
  state: "verified" | "unknown_result";
  method: string;
  reason?: string;
  providerReference?: EmailProviderReference;
};

export interface EmailProviderAdapter {
  send(input: EmailSendInput): Promise<EmailProviderReference>;
  verify(input: EmailVerificationInput): Promise<EmailProviderVerification>;
  reconcile(input: EmailVerificationInput): Promise<EmailProviderVerification>;
}

export class EmailProviderError extends Error {
  constructor(
    readonly code: string,
    readonly outcome: "rejected" | "failed" | "unknown_result",
    readonly providerReference?: EmailProviderReference,
  ) {
    super(code);
    this.name = "EmailProviderError";
  }
}

export function stableEmailMessageId(stepId: string): string {
  const digest = createHash("sha256").update(stepId).digest("hex");
  return `<${digest}@agent-work.invalid>`;
}