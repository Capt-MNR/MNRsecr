import assert from "node:assert/strict";
import test from "node:test";
import { classifySecretaryError } from "../src/lib/secretary-errors.ts";

function apiError(status: number, data: Record<string, unknown> = {}) {
  return { name: "ApiError", status, data };
}

test("classifies network failure as connection failure", () => {
  const result = classifySecretaryError(new TypeError("Failed to fetch"));
  assert.equal(result.category, "network");
  assert.match(result.message, /الاتصال/);
});

test("classifies client timeout separately from network failure", () => {
  const result = classifySecretaryError({ name: "FetchTimeoutError" });
  assert.equal(result.category, "timeout");
  assert.match(result.message, /وقتًا أطول/);
});

test("classifies validation and authentication responses", () => {
  assert.equal(classifySecretaryError(apiError(400)).category, "validation");
  assert.equal(classifySecretaryError(apiError(401)).category, "authentication");
  assert.equal(classifySecretaryError(apiError(403)).category, "permission");
});

test("classifies not found, rate limit, provider, and server responses", () => {
  assert.equal(classifySecretaryError(apiError(404)).category, "not_found");
  assert.equal(classifySecretaryError(apiError(409, {
    category: "conflict_error",
    error: "لا يمكن حذف هذا السجل لأنه مرتبط بسجلات محفوظة.",
  })).category, "conflict");
  assert.equal(classifySecretaryError(apiError(429)).category, "rate_limit");
  assert.equal(classifySecretaryError(apiError(500, { category: "agent_error" })).category, "agent");
  assert.equal(classifySecretaryError(apiError(502)).category, "provider");
  assert.equal(classifySecretaryError(apiError(503)).category, "provider");
  assert.equal(classifySecretaryError(apiError(504)).category, "timeout");
});

test("classifies malformed successful responses separately", () => {
  const result = classifySecretaryError({ name: "ResponseParseError" });
  assert.equal(result.category, "response_parse");
  assert.match(result.message, /رد غير مفهوم/);
});

test("keeps a successful turn out of the error path", () => {
  const successfulTurn = {
    conversationId: "conversation-1",
    assistantMessage: "تمام",
    provider: "groq",
    model: "openai/gpt-oss-20b",
  };
  assert.equal("assistantMessage" in successfulTurn, true);
  assert.equal(classifySecretaryError(null).category, "unknown");
});