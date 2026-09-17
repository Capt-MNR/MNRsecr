import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { processInputAsset } from "../src/lib/input-assets.ts";

test("processed input cache is tenant-scoped and avoids duplicate provider work", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;
  let fetchCount = 0;
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              text: "سجلت فاتورة بقالة",
              receipt: {
                merchant: "متجر",
                amountMinor: 12500,
                currency: "EGP",
                occurredAt: "2026-09-18",
                description: "بقالة",
                confidence: 0.92,
              },
            }),
          }],
        },
      }],
      usageMetadata: {
        promptTokenCount: 20,
        candidatesTokenCount: 12,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const input = {
    kind: "receipt" as const,
    mimeType: "image/jpeg",
    base64: Buffer.from(`receipt-fixture-${randomUUID()}`).toString("base64"),
  };
  try {
    const first = await processInputAsset(input, { tenantId: "tenant-a", userId: "user-a" });
    const sameScope = await processInputAsset(input, { tenantId: "tenant-a", userId: "user-a" });
    const otherScope = await processInputAsset(input, { tenantId: "tenant-a", userId: "user-b" });

    assert.equal(fetchCount, 2);
    assert.equal(first.processing.cacheHit, false);
    assert.equal(sameScope.processing.cacheHit, true);
    assert.equal(sameScope.inputId, first.inputId);
    assert.equal(otherScope.processing.cacheHit, false);
    assert.notEqual(otherScope.inputId, first.inputId);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  }
});

test("concurrent processing for the same scoped input shares one provider flight", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;
  let fetchCount = 0;
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = async () => {
    fetchCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({ text: "تسجيل صوتي تجريبي" }),
          }],
        },
      }],
    }), { status: 200 });
  };

  const input = {
    kind: "voice" as const,
    mimeType: "audio/m4a",
    base64: Buffer.from(`concurrent-voice-fixture-${randomUUID()}`).toString("base64"),
  };
  try {
    const [first, second] = await Promise.all([
      processInputAsset(input, { tenantId: "tenant-concurrent", userId: "user-a" }),
      processInputAsset(input, { tenantId: "tenant-concurrent", userId: "user-a" }),
    ]);

    assert.equal(fetchCount, 1);
    assert.equal(first.inputId, second.inputId);
    assert.equal(first.processing.cacheHit, false);
    assert.equal(second.processing.cacheHit, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  }
});