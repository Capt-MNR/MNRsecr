import assert from "node:assert/strict";
import test from "node:test";
import {
  DeepSeekModelGateway,
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