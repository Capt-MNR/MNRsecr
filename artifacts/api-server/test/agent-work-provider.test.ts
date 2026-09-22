import assert from "node:assert/strict";
import test from "node:test";
import {
  DeepSeekModelGateway,
  OpenRouterModelGateway,
  QwenModelGateway,
  type GatewayCallContext,
} from "../src/lib/phase2.ts";

test("DeepSeek uses the existing OpenAI-compatible gateway contract", async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  try {
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    delete process.env.DEEPSEEK_API_URL;
    globalThis.fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push({ url: String(input), body });
      return new Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{
              id: "deepseek-call",
              function: {
                name: "final_response",
                arguments: JSON.stringify({ kind: "answer", message: "تم" }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const context: GatewayCallContext = {
      requestId: "deepseek-contract-test",
      callNumber: 1,
      toolCallsExecuted: 0,
    };
    const gateway = new DeepSeekModelGateway();
    const response = await gateway.generate([], context);

    assert.equal(gateway.provider, "deepseek");
    assert.equal(gateway.modelName, "deepseek-chat");
    assert.equal(response.toolCalls[0]?.name, "final_response");
    assert.equal(requests[0]?.url, "https://api.deepseek.com/chat/completions");
    assert.equal(requests[0]?.body.model, "deepseek-chat");
    assert.equal((requests[0]?.body.messages as Array<{ role: string }>)[0]?.role, "system");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
    delete process.env.DEEPSEEK_API_URL;
  }
});

test("Qwen is available through the provider-neutral OpenAI-compatible contract", async () => {
  const previousKey = process.env.QWEN_API_KEY;
  const previousModel = process.env.QWEN_MODEL;
  const previousUrl = process.env.QWEN_API_URL;
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  try {
    process.env.QWEN_API_KEY = "test-qwen-key";
    process.env.QWEN_MODEL = "qwen-test-model";
    process.env.QWEN_API_URL = "https://qwen.test/v1/chat/completions";
    globalThis.fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push({ url: String(input), body });
      return new Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{
              id: "qwen-call",
              function: {
                name: "final_response",
                arguments: JSON.stringify({ kind: "answer", message: "تم" }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const context: GatewayCallContext = {
      requestId: "qwen-contract-test",
      callNumber: 1,
      toolCallsExecuted: 0,
    };
    const gateway = new QwenModelGateway();
    const response = await gateway.generate([], context);

    assert.equal(gateway.provider, "qwen");
    assert.equal(gateway.modelName, "qwen-test-model");
    assert.equal(response.toolCalls[0]?.name, "final_response");
    assert.equal(requests[0]?.url, "https://qwen.test/v1/chat/completions");
    assert.equal(requests[0]?.body.model, "qwen-test-model");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.QWEN_API_KEY;
    else process.env.QWEN_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.QWEN_MODEL;
    else process.env.QWEN_MODEL = previousModel;
    if (previousUrl === undefined) delete process.env.QWEN_API_URL;
    else process.env.QWEN_API_URL = previousUrl;
  }
});

test("OpenRouter uses the shared OpenAI-compatible gateway contract", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousModel = process.env.OPENROUTER_MODEL;
  const previousUrl = process.env.OPENROUTER_API_URL;
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  try {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.OPENROUTER_MODEL = "openai/gpt-oss-20b";
    delete process.env.OPENROUTER_API_URL;
    globalThis.fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push({ url: String(input), body });
      return new Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{
              id: "openrouter-call",
              function: {
                name: "final_response",
                arguments: JSON.stringify({ kind: "answer", message: "تم" }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const context: GatewayCallContext = {
      requestId: "openrouter-contract-test",
      callNumber: 1,
      toolCallsExecuted: 0,
    };
    const gateway = new OpenRouterModelGateway();
    const response = await gateway.generate([], context);

    assert.equal(gateway.provider, "openrouter");
    assert.equal(gateway.modelName, "openai/gpt-oss-20b");
    assert.equal(response.toolCalls[0]?.name, "final_response");
    assert.equal(requests[0]?.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(requests[0]?.body.model, "openai/gpt-oss-20b");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = previousModel;
    if (previousUrl === undefined) delete process.env.OPENROUTER_API_URL;
    else process.env.OPENROUTER_API_URL = previousUrl;
  }
});