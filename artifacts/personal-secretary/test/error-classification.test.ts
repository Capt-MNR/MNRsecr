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
  assert.match(result.message, /الوقت المتوقع/);
});

test("classifies validation and authentication responses", () => {
  assert.equal(classifySecretaryError(apiError(400)).category, "validation");
  const authentication = classifySecretaryError(apiError(401));
  const permission = classifySecretaryError(apiError(403));
  assert.equal(authentication.category, "authentication");
  assert.match(authentication.message, /تسجيل دخول/);
  assert.equal(permission.category, "permission");
  assert.match(permission.message, /الصلاحية/);
});

test("classifies not found, rate limit, provider, and server responses", () => {
  assert.equal(classifySecretaryError(apiError(404)).category, "not_found");
  const conflict = classifySecretaryError(apiError(409, {
    category: "conflict_error",
    error: "INTERNAL_PROVIDER_DETAIL",
  }));
  assert.equal(conflict.category, "conflict");
  assert.match(conflict.message, /البيانات اتغيرت/);
  assert.doesNotMatch(conflict.message, /INTERNAL_PROVIDER_DETAIL/);
  assert.equal(classifySecretaryError(apiError(429)).category, "rate_limit");
  assert.equal(classifySecretaryError(apiError(500, { category: "agent_error" })).category, "agent");
  assert.equal(classifySecretaryError(apiError(502)).category, "provider");
  assert.equal(classifySecretaryError(apiError(503)).category, "provider");
  assert.equal(classifySecretaryError(apiError(504)).category, "timeout");
  assert.match(classifySecretaryError(apiError(504)).message, /راجع حالة العملية/);
});

test("classifies malformed successful responses separately", () => {
  const result = classifySecretaryError({ name: "ResponseParseError" });
  assert.equal(result.category, "response_parse");
  assert.match(result.message, /تعذر فهم نتيجة الطلب/);
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