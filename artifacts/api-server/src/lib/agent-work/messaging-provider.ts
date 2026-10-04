import { createHash } from "node:crypto";
import type { AgentWorkIdentity } from "./types";

export type MessageChannel = "sms" | "chat" | "in_app";

export type OutboundMessageInput = {
  recipient: string;
  channel: MessageChannel;
  body: string;
  idempotencyKey: string;
};

export type MessagingProviderReference = {
  messageId: string;
};

export type MessagingProviderReceipt = MessagingProviderReference & {
  recipient: string;
  channel: MessageChannel;
  contentHash: string;
};

export class MessagingProviderError extends Error {
  constructor(
    readonly code: string,
    readonly outcome: "rejected" | "failed" | "unknown_result",
    readonly providerReference?: MessagingProviderReference,
  ) {
    super(code);
    this.name = "MessagingProviderError";
  }
}

/**
 * Provider-neutral transport contract. Implementations own account and
 * channel routing; callers pass the signed-in identity and a stable key.
 */
export interface MessagingProviderAdapter {
  send(
    identity: AgentWorkIdentity,
    input: OutboundMessageInput,
  ): Promise<MessagingProviderReference>;
  /** Read-only lookup. It must not send or replay a message. */
  findByIdempotencyKey(
    identity: AgentWorkIdentity,
    idempotencyKey: string,
  ): Promise<MessagingProviderReceipt | null>;
}

export function messageContentHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}