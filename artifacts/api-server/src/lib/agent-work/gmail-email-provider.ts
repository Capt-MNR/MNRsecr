import { GMAIL_API_BASE, gmailOAuthService } from "../gmail-oauth";
import type { AgentWorkIdentity } from "./types";
import {
  EmailProviderError,
  type EmailProviderAdapter,
  type EmailProviderReference,
  type EmailProviderVerification,
  type EmailSendInput,
  type EmailVerificationInput,
} from "./email-provider";

const REQUEST_TIMEOUT_MS = 15_000;

type GmailMessage = {
  id?: unknown;
  threadId?: unknown;
  labelIds?: unknown;
  payload?: {
    headers?: unknown;
  };
};

type GmailMessagesList = {
  messages?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return {};
  }
}

function encodeHeader(value: string): string {
  if (/[\r\n\0]/u.test(value)) throw new EmailProviderError("EMAIL_HEADER_INVALID", "rejected");
  if (/^[\x20-\x7e]*$/u.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function base64Lines(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/.{1,76}/gu, "$&\r\n")
    .trimEnd();
}

function rawMessage(input: EmailSendInput): string {
  if (/[\r\n\0]/u.test(input.recipient) || /[\r\n\0]/u.test(input.subject)) {
    throw new EmailProviderError("EMAIL_HEADER_INVALID", "rejected");
  }
  if (!/^<[^<>\s@]+@agent-work\.invalid>$/u.test(input.stableMessageId)) {
    throw new EmailProviderError("EMAIL_STABLE_MESSAGE_ID_INVALID", "rejected");
  }
  return [
    `To: ${input.recipient}`,
    `Subject: ${encodeHeader(input.subject)}`,
    `Message-ID: ${input.stableMessageId}`,
    `X-Agent-Work-Step: ${input.idempotencyKey.replace(/^agent-action:/u, "")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(input.body),
  ].join("\r\n");
}

function providerReference(
  messageId: string | undefined,
  threadId: string | undefined,
  stableMessageId: string,
): EmailProviderReference {
  return {
    ...(messageId ? { messageId } : {}),
    ...(threadId ? { threadId } : {}),
    stableMessageId,
  };
}

function verification(
  input: EmailVerificationInput,
  state: EmailProviderVerification["state"],
  method: string,
  reason?: string,
  messageId?: string,
  threadId?: string,
): EmailProviderVerification {
  return {
    state,
    method,
    ...(reason ? { reason } : {}),
    providerReference: providerReference(
      messageId ?? input.providerReference?.messageId,
      threadId ?? input.providerReference?.threadId,
      input.stableMessageId,
    ),
  };
}

export class GmailEmailProviderAdapter implements EmailProviderAdapter {
  constructor(
    private readonly accessTokenForIdentity: (identity: AgentWorkIdentity) => Promise<string> =
      (identity) => gmailOAuthService.accessToken(identity),
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(input: EmailSendInput): Promise<EmailProviderReference> {
    const reference = providerReference(undefined, undefined, input.stableMessageId);
    const raw = rawMessage(input);
    let accessToken: string;
    try {
      accessToken = await this.accessTokenForIdentity(input.identity);
    } catch (error) {
      const code = error instanceof Error && /^EMAIL_GMAIL_[A-Z_]+$/u.test(error.message)
        ? error.message
        : "EMAIL_GMAIL_AUTH_UNAVAILABLE";
      throw new EmailProviderError(code, "failed");
    }

    let response: Response;
    try {
      response = await this.fetcher(`${GMAIL_API_BASE}/users/me/messages/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: Buffer.from(raw, "utf8").toString("base64url") }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new EmailProviderError(
        "EMAIL_GMAIL_SEND_OUTCOME_UNKNOWN",
        "unknown_result",
        reference,
      );
    }

    const payload = await jsonResponse(response);
    if (!response.ok) {
      const rejected = response.status >= 400 && response.status < 500;
      throw new EmailProviderError(
        rejected ? "EMAIL_GMAIL_SEND_REJECTED" : "EMAIL_GMAIL_SEND_OUTCOME_UNKNOWN",
        rejected ? "rejected" : "unknown_result",
        reference,
      );
    }
    if (typeof payload.id !== "string" || !payload.id) {
      throw new EmailProviderError(
        "EMAIL_GMAIL_SEND_ACK_INCOMPLETE",
        "unknown_result",
        reference,
      );
    }
    return providerReference(
      payload.id,
      typeof payload.threadId === "string" ? payload.threadId : undefined,
      input.stableMessageId,
    );
  }

  async verify(input: EmailVerificationInput): Promise<EmailProviderVerification> {
    const messageId = input.providerReference?.messageId;
    if (!messageId) return this.reconcile(input);

    let accessToken: string;
    try {
      accessToken = await this.accessTokenForIdentity(input.identity);
    } catch {
      return verification(input, "unknown_result", "provider_message_lookup", "AUTH_UNAVAILABLE");
    }
    let response: Response;
    try {
      const query = new URLSearchParams({
        format: "metadata",
        fields: "id,threadId,labelIds,payload(headers(name,value))",
      });
      for (const header of ["To", "Message-ID", "X-Agent-Work-Step"]) {
        query.append("metadataHeaders", header);
      }
      response = await this.fetcher(
        `${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(messageId)}?${query.toString()}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      return verification(input, "unknown_result", "provider_message_lookup", "LOOKUP_UNAVAILABLE");
    }
    if (!response.ok) {
      return verification(input, "unknown_result", "provider_message_lookup", "LOOKUP_UNCONFIRMED");
    }
    const message = await jsonResponse(response) as GmailMessage;
    return this.verifyMetadata(input, message, "provider_message_id");
  }

  async reconcile(input: EmailVerificationInput): Promise<EmailProviderVerification> {
    let accessToken: string;
    try {
      accessToken = await this.accessTokenForIdentity(input.identity);
    } catch {
      return verification(input, "unknown_result", "sent_search", "AUTH_UNAVAILABLE");
    }
    const messageIdValue = input.stableMessageId.slice(1, -1);
    const query = new URLSearchParams({
      q: `in:sent rfc822msgid:${messageIdValue}`,
      maxResults: "2",
      fields: "messages(id,threadId)",
    });
    let response: Response;
    try {
      response = await this.fetcher(
        `${GMAIL_API_BASE}/users/me/messages?${query.toString()}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      return verification(input, "unknown_result", "sent_search", "SEARCH_UNAVAILABLE");
    }
    if (!response.ok) {
      return verification(input, "unknown_result", "sent_search", "SEARCH_UNCONFIRMED");
    }

    const list = await jsonResponse(response) as GmailMessagesList;
    const matches = Array.isArray(list.messages)
      ? list.messages.map(asRecord).filter((item) => typeof item.id === "string")
      : [];
    if (matches.length !== 1) {
      return verification(
        input,
        "unknown_result",
        "sent_search",
        matches.length > 1 ? "MULTIPLE_MATCHES" : "NO_MATCH_YET",
      );
    }
    const match = matches[0]!;
    const result = await this.verify({
      ...input,
      providerReference: {
        ...(typeof match.id === "string" ? { messageId: match.id } : {}),
        ...(typeof match.threadId === "string" ? { threadId: match.threadId } : {}),
        stableMessageId: input.stableMessageId,
      },
    });
    return {
      ...result,
      method: result.state === "verified" ? "sent_search_and_metadata" : "sent_search",
    };
  }

  private verifyMetadata(
    input: EmailVerificationInput,
    message: GmailMessage,
    method: string,
  ): EmailProviderVerification {
    const labels = Array.isArray(message.labelIds)
      ? message.labelIds.filter((label): label is string => typeof label === "string")
      : [];
    const headers = Array.isArray(message.payload?.headers)
      ? message.payload.headers.map(asRecord)
      : [];
    const header = (name: string) => {
      const found = headers.find((item) =>
        typeof item.name === "string" && item.name.toLowerCase() === name.toLowerCase());
      return typeof found?.value === "string" ? found.value.trim() : "";
    };
    const recipientMatches = header("To").toLowerCase() === input.recipient.toLowerCase();
    const messageIdMatches = header("Message-ID") === input.stableMessageId;
    const workStepMatches = header("X-Agent-Work-Step")
      === input.idempotencyKey.replace(/^agent-action:/u, "");
    const sent = labels.includes("SENT");
    if (!sent || !recipientMatches || !messageIdMatches || !workStepMatches) {
      return verification(
        input,
        "unknown_result",
        method,
        "MESSAGE_METADATA_MISMATCH",
        typeof message.id === "string" ? message.id : undefined,
        typeof message.threadId === "string" ? message.threadId : undefined,
      );
    }
    return verification(
      input,
      "verified",
      method,
      undefined,
      typeof message.id === "string" ? message.id : undefined,
      typeof message.threadId === "string" ? message.threadId : undefined,
    );
  }
}