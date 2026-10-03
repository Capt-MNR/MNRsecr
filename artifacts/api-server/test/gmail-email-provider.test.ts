import assert from "node:assert/strict";
import test from "node:test";
import {
  EmailProviderError,
  type EmailVerificationInput,
} from "../src/lib/agent-work/email-provider";
import { GmailEmailProviderAdapter } from "../src/lib/agent-work/gmail-email-provider";

const identity = { tenantId: "gmail-provider-test-tenant", userId: "gmail-provider-test-user" };
const stableMessageId = `<${"b".repeat(64)}@agent-work.invalid>`;
const idempotencyKey = `agent-action:${"a".repeat(64)}`;

const input: EmailVerificationInput = {
  identity,
  recipient: "recipient@example.test",
  subject: "Test subject",
  idempotencyKey,
  stableMessageId,
};

function metadataMessage() {
  return {
    id: "gmail-message-123",
    threadId: "gmail-thread-456",
    labelIds: ["SENT"],
    payload: {
      headers: [
        { name: "To", value: input.recipient },
        { name: "Message-ID", value: stableMessageId },
        { name: "X-Agent-Work-Step", value: idempotencyKey.slice("agent-action:".length) },
      ],
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Gmail send sends once and verifies only matching sent-mail metadata", async () => {
  const requests: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
  const adapter = new GmailEmailProviderAdapter(
    async () => "mock-access-token",
    async (url, init) => {
      requests.push({
        url: String(url),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: String(init?.body ?? ""),
      });
      if (init?.method === "POST") {
        return jsonResponse({ id: "gmail-message-123", threadId: "gmail-thread-456" });
      }
      return jsonResponse(metadataMessage());
    },
  );

  const reference = await adapter.send({
    ...input,
    body: "This is a mocked email body.",
  });
  const verified = await adapter.verify({ ...input, providerReference: reference });

  assert.equal(requests.filter((request) => request.method === "POST").length, 1);
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer mock-access-token");
  assert.equal(reference.messageId, "gmail-message-123");
  assert.equal(verified.state, "verified");
  assert.equal(verified.method, "provider_message_id");
  assert.equal(requests[1]?.url.includes("format=metadata"), true);
  assert.equal(requests[1]?.url.includes("fields="), true);
});

test("a lost send acknowledgement can be reconciled by read-only sent search", async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const adapter = new GmailEmailProviderAdapter(
    async () => "mock-access-token",
    async (url, init) => {
      const method = init?.method ?? "GET";
      requests.push({ method, url: String(url) });
      if (method === "POST") throw new TypeError("simulated connection loss");
      if (String(url).includes("/messages?")) {
        return jsonResponse({ messages: [{ id: "gmail-message-123", threadId: "gmail-thread-456" }] });
      }
      return jsonResponse(metadataMessage());
    },
  );

  let sendError: unknown;
  try {
    await adapter.send({ ...input, body: "Mock body" });
  } catch (error) {
    sendError = error;
  }
  assert.ok(sendError instanceof EmailProviderError);
  assert.equal(sendError.outcome, "unknown_result");
  assert.equal(sendError.providerReference?.stableMessageId, stableMessageId);

  const reconciled = await adapter.reconcile(input);
  assert.equal(reconciled.state, "verified");
  assert.equal(reconciled.method, "sent_search_and_metadata");
  assert.deepEqual(requests.map((request) => request.method), ["POST", "GET", "GET"]);
  assert.equal(requests.filter((request) => request.method === "POST").length, 1);
  assert.equal(
    new URL(requests[1]?.url ?? "https://example.test").searchParams.get("q")?.includes("rfc822msgid:"),
    true,
  );
});

test("ambiguous Gmail search results stay unknown and do not send", async () => {
  const requests: Array<string> = [];
  const adapter = new GmailEmailProviderAdapter(
    async () => "mock-access-token",
    async (url) => {
      requests.push(String(url));
      return jsonResponse({
        messages: [{ id: "one" }, { id: "two" }],
      });
    },
  );

  const result = await adapter.reconcile(input);
  assert.equal(result.state, "unknown_result");
  assert.equal(result.reason, "MULTIPLE_MATCHES");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.includes("/messages?"), true);
});

test("Gmail header injection is rejected before provider access", async () => {
  let requests = 0;
  const adapter = new GmailEmailProviderAdapter(
    async () => "mock-access-token",
    async () => {
      requests += 1;
      return jsonResponse({});
    },
  );
  await assert.rejects(
    adapter.send({ ...input, recipient: "recipient@example.test\r\nBcc: other@example.test", body: "x" }),
    (error: unknown) => error instanceof EmailProviderError && error.outcome === "rejected",
  );
  assert.equal(requests, 0);
});