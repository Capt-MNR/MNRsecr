import { z } from "zod";
import type { ExternalActionConnector } from "./external-action";
import { createSingleStepExternalActionConnector } from "./single-step-external-action";
import {
  messageContentHash,
  MessagingProviderError,
  type MessagingProviderAdapter,
  type MessagingProviderReceipt,
} from "./messaging-provider";
import type { AgentWorkIdentity } from "./types";

const messageActionSchema = z.object({
  type: z.literal("send_message"),
  recipient: z.string().trim().min(1).max(320),
  channel: z.enum(["sms", "chat", "in_app"]),
  body: z.string().min(1).max(4_000),
}).strict();

type MessageAction = z.infer<typeof messageActionSchema>;
type StoredMessageAction = MessageAction & {
  actionId: string;
  setupApprovalOperationId: string;
};

const storedMessageActionSchema = messageActionSchema.extend({
  actionId: z.string().uuid(),
  setupApprovalOperationId: z.string().uuid(),
}).strict();

function receiptMatches(
  receipt: MessagingProviderReceipt | null,
  action: StoredMessageAction,
): boolean {
  return receipt !== null
    && receipt.recipient === action.recipient
    && receipt.channel === action.channel
    && receipt.contentHash === messageContentHash(action.body);
}

function unknownOutcome(code: string, providerReference?: { messageId: string }) {
  return {
    status: "unknown_result" as const,
    error: {
      code,
      outcome: "unknown_result" as const,
      retryable: false,
      reviewRequired: true,
    },
    verification: { state: "unknown_result", reason: code },
    ...(providerReference ? { providerReference } : {}),
  };
}

export function createMessagingExternalActionConnector(
  provider: MessagingProviderAdapter,
): ExternalActionConnector {
  return createSingleStepExternalActionConnector<MessageAction, StoredMessageAction>({
    provider: "messaging",
    actionType: "send_message",
    approvalToolName: "message_send",
    version: "messaging-v1",
    toolGuidance:
      "Messaging is provider-neutral. Use send_message with recipient, channel, and exact text. A separate approval is required before sending. Unknown outcomes are checked by read-only lookup and are never resent automatically.",
    parseAction(value) {
      const parsed = messageActionSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    },
    storeAction(action, actionId, setupApprovalOperationId) {
      const parsed = storedMessageActionSchema.safeParse({
        ...action,
        actionId,
        setupApprovalOperationId,
      });
      return parsed.success ? parsed.data : null;
    },
    parseStoredAction(value) {
      const parsed = storedMessageActionSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    },
    display(action) {
      return {
        title: "Review message before sending",
        details: [
          `Channel: ${action.channel}`,
          `To: ${action.recipient}`,
          `Message: ${action.body}`,
          "The message will not be sent until this action is approved.",
        ],
      };
    },
    evidence(action) {
      return {
        channel: action.channel,
        recipientCount: 1,
        bodyLength: action.body.length,
        contentHash: messageContentHash(action.body),
      };
    },
    notification() {
      return {
        title: "Message needs approval",
        body: "Review the recipient and exact message; nothing has been sent.",
      };
    },
    adapter: {
      async execute({ identity, action, idempotencyKey }) {
        try {
          const providerReference = await provider.send(identity, {
            recipient: action.recipient,
            channel: action.channel,
            body: action.body,
            idempotencyKey,
          });
          const receipt = await provider.findByIdempotencyKey(identity, idempotencyKey);
          if (!receiptMatches(receipt, action)) {
            return unknownOutcome("MESSAGE_SEND_NOT_CONFIRMED", providerReference);
          }
          return {
            status: "verified" as const,
            providerReference: { messageId: receipt!.messageId },
            verification: { state: "verified", method: "provider_receipt_lookup" },
          };
        } catch (error) {
          if (error instanceof MessagingProviderError && error.outcome !== "unknown_result") {
            return {
              status: "failed" as const,
              error: {
                code: error.code,
                outcome: error.outcome,
                retryable: false,
                reviewRequired: true,
              },
              ...(error.providerReference ? { providerReference: error.providerReference } : {}),
              verification: { state: "failed", reason: error.code },
            };
          }
          return unknownOutcome(
            error instanceof MessagingProviderError
              ? error.code
              : "MESSAGE_SEND_OUTCOME_UNKNOWN",
            error instanceof MessagingProviderError ? error.providerReference : undefined,
          );
        }
      },
      async reconcile({ identity, action, idempotencyKey, providerReference }) {
        let receipt: MessagingProviderReceipt | null;
        try {
          receipt = await provider.findByIdempotencyKey(identity, idempotencyKey);
        } catch {
          return unknownOutcome("MESSAGE_RECONCILIATION_UNAVAILABLE", {
            messageId: typeof providerReference?.messageId === "string"
              ? providerReference.messageId
              : "",
          });
        }
        if (!receipt || !receiptMatches(receipt, action)) {
          return unknownOutcome(
            "MESSAGE_NOT_FOUND_OR_CONTENT_MISMATCH",
            receipt ? { messageId: receipt.messageId } : undefined,
          );
        }
        return {
          status: "verified" as const,
          providerReference: { messageId: receipt.messageId },
          verification: { state: "verified", method: "idempotency_lookup" },
        };
      },
    },
  });
}