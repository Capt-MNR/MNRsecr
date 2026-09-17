import { createHash, randomUUID } from "node:crypto";
import {
  providerExceptionError,
  providerResponseError,
  providerTimeoutError,
  SecretaryError,
} from "./error-contract";

export type InputAssetKind = "voice" | "receipt";

export type InputAssetProcessInput = {
  kind: InputAssetKind;
  mimeType: string;
  base64: string;
};

export type InputAssetScope = {
  tenantId: string;
  userId: string;
};

export type InputAssetProcessResult = {
  inputId: string;
  kind: InputAssetKind;
  text: string;
  receipt?: {
    merchant: string | null;
    amountMinor: number | null;
    currency: string | null;
    occurredAt: string | null;
    description: string | null;
    confidence: number;
  };
  processing: {
    provider: string;
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheHit: boolean;
  };
};

const INPUT_PROVIDER = "gemini";
const INPUT_MODEL = process.env.GEMINI_INPUT_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
const MAX_INPUT_BYTES = 9_000_000;
const INPUT_CACHE_TTL_MS = 30 * 60_000;
const INPUT_CACHE_MAX_ENTRIES = 500;
const processedInputCache = new Map<string, {
  result: InputAssetProcessResult;
  expiresAt: number;
}>();

function inputCacheKey(input: InputAssetProcessInput, scope: InputAssetScope): string {
  return createHash("sha256")
    .update(JSON.stringify({
      tenantId: scope.tenantId,
      userId: scope.userId,
      kind: input.kind,
      mimeType: input.mimeType,
      base64: input.base64,
    }))
    .digest("hex");
}

function pruneInputCache(now = Date.now()): void {
  for (const [key, entry] of processedInputCache) {
    if (entry.expiresAt <= now) processedInputCache.delete(key);
  }
  while (processedInputCache.size >= INPUT_CACHE_MAX_ENTRIES) {
    const oldestKey = processedInputCache.keys().next().value;
    if (!oldestKey) break;
    processedInputCache.delete(oldestKey);
  }
}

function parseJsonResponse(raw: string): Record<string, unknown> {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Input processor returned a non-object response.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new SecretaryError("تعذر قراءة نتيجة معالجة الإدخال.", {
      status: 502,
      category: "response_parse_error",
      code: "INPUT_PROCESSING_RESPONSE_INVALID",
      retryable: false,
      provider: INPUT_PROVIDER,
      cause: error,
    });
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function boundedConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
}

function normalizeReceipt(value: unknown): InputAssetProcessResult["receipt"] {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    merchant: nullableString(record.merchant),
    amountMinor: nullableInteger(record.amountMinor),
    currency: nullableString(record.currency),
    occurredAt: nullableString(record.occurredAt),
    description: nullableString(record.description),
    confidence: boundedConfidence(record.confidence),
  };
}

function inputPrompt(kind: InputAssetKind): string {
  if (kind === "voice") {
    return [
      "حوّل التسجيل الصوتي إلى نص عربي واضح فقط.",
      "حافظ على الأسماء والأرقام والعملات كما نُطقت.",
      "لا تضف شرحًا ولا تخمينًا.",
      'أعد JSON بالشكل: {"text":"النص المستخرج"}',
    ].join("\n");
  }
  return [
    "حلل صورة الفاتورة لاستخراج بياناتها فقط.",
    "المبلغ يجب أن يكون amountMinor بوحدة أصغر للعملة، مثل 750 جنيه = 75000.",
    "إذا لم تتأكد من قيمة اتركها null، ولا تخمن.",
    "occurredAt يجب أن يكون ISO date أو null.",
    "confidence رقم بين 0 و1 يعكس ثقتك في الحقول المهمة.",
    'أعد JSON بالشكل: {"text":"وصف مختصر","receipt":{"merchant":null,"amountMinor":null,"currency":null,"occurredAt":null,"description":null,"confidence":0}}',
  ].join("\n");
}

export async function processInputAsset(
  input: InputAssetProcessInput,
  scope: InputAssetScope,
): Promise<InputAssetProcessResult> {
  const cacheKey = inputCacheKey(input, scope);
  pruneInputCache();
  const cached = processedInputCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.result,
      processing: {
        ...cached.result.processing,
        cacheHit: true,
      },
    };
  }
  if (cached) processedInputCache.delete(cacheKey);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new SecretaryError("معالجة الإدخال غير متاحة حاليًا.", {
      status: 503,
      category: "provider_unavailable",
      code: "INPUT_PROCESSOR_UNAVAILABLE",
      retryable: true,
      provider: INPUT_PROVIDER,
    });
  }
  const base64Bytes = Buffer.byteLength(input.base64, "base64");
  if (base64Bytes <= 0 || base64Bytes > MAX_INPUT_BYTES) {
    throw new SecretaryError("حجم الملف أكبر من الحد المسموح.", {
      status: 400,
      category: "validation_error",
      code: "INPUT_ASSET_TOO_LARGE",
      retryable: false,
    });
  }
  if (input.kind === "receipt" && !input.mimeType.startsWith("image/")) {
    throw new SecretaryError("صورة الفاتورة غير صالحة.", {
      status: 400,
      category: "validation_error",
      code: "RECEIPT_IMAGE_MIME_INVALID",
      retryable: false,
    });
  }
  if (input.kind === "voice" && !input.mimeType.startsWith("audio/")) {
    throw new SecretaryError("التسجيل الصوتي غير صالح.", {
      status: 400,
      category: "validation_error",
      code: "VOICE_AUDIO_MIME_INVALID",
      retryable: false,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${INPUT_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: inputPrompt(input.kind) },
              { inlineData: { mimeType: input.mimeType, data: input.base64 } },
            ],
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 512,
            responseMimeType: "application/json",
          },
        }),
        signal: controller.signal,
      },
    );
    const raw = await response.text();
    if (!response.ok) {
      throw providerResponseError(INPUT_PROVIDER, response.status, raw);
    }
    const parsed = JSON.parse(raw) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };
    const output = parsed.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!output) {
      throw new SecretaryError("لم يرجع مزود المعالجة نتيجة.", {
        status: 502,
        category: "response_parse_error",
        code: "INPUT_PROCESSING_EMPTY",
        retryable: true,
        provider: INPUT_PROVIDER,
      });
    }
    const payload = parseJsonResponse(output);
    const receipt = input.kind === "receipt" ? normalizeReceipt(payload.receipt) : undefined;
    const result = {
      inputId: randomUUID(),
      kind: input.kind,
      text: nullableString(payload.text) ?? "",
      ...(receipt ? { receipt } : {}),
      processing: {
        provider: INPUT_PROVIDER,
        model: INPUT_MODEL,
        inputTokens: parsed.usageMetadata?.promptTokenCount ?? null,
        outputTokens: parsed.usageMetadata?.candidatesTokenCount ?? null,
        cacheHit: false,
      },
    };
    pruneInputCache();
    processedInputCache.set(cacheKey, {
      result,
      expiresAt: Date.now() + INPUT_CACHE_TTL_MS,
    });
    return result;
  } catch (error) {
    if (error instanceof SecretaryError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw providerTimeoutError(INPUT_PROVIDER, error);
    }
    throw providerExceptionError(INPUT_PROVIDER, error);
  } finally {
    clearTimeout(timeout);
  }
}