import assert from "node:assert/strict";
import test from "node:test";
import {
  directProviderRoute,
  gatewayRoute,
} from "../src/lib/inference-routes.ts";
import {
  directProviderDefinitions,
  gatewayDefinitions,
  inferenceRouteForService,
  inferenceServiceDefinitions,
  providerDefinitions,
  routeIdForService,
} from "../src/lib/provider-registry.ts";
import { providerTimeoutError } from "../src/lib/error-contract.ts";
import {
  MnrInferenceRouter,
  normalizeLlmUsage,
  normalizeProviderUsage,
  type GatewayCallContext,
  type GatewayResponse,
  type ModelGateway,
} from "../src/lib/phase2.ts";

test("the route registry separates direct providers and Gateways without assuming capabilities", () => {
  assert.equal(routeIdForService("openrouter"), "gateway:openrouter");
  assert.equal(inferenceRouteForService("gemini").kind, "direct_provider");
  assert.equal(inferenceRouteForService("openrouter").kind, "gateway");
  assert.equal(directProviderDefinitions().some((definition) => definition.name === "openrouter"), false);
  assert.equal(providerDefinitions().some((definition) => definition.name === "openrouter"), false);
  assert.equal("capabilities" in inferenceRouteForService("openrouter").model, false);

  const previousCatalog = process.env.AI_PROVIDER_CATALOG;
  try {
    process.env.AI_PROVIDER_CATALOG = JSON.stringify({
      providers: [{
        name: "custom-relay",
        kind: "gateway",
        protocol: "openai-compatible",
        apiKeyEnv: "CUSTOM_RELAY_API_KEY",
        modelEnv: "CUSTOM_RELAY_MODEL",
        defaultModel: "vendor-z/model-y",
        apiUrlEnv: "CUSTOM_RELAY_API_URL",
        defaultApiUrl: "https://relay.example/v1/chat/completions",
      }],
    });
    assert.deepEqual(gatewayDefinitions().map((definition) => definition.name), ["custom-relay"]);
    assert.deepEqual(
      inferenceServiceDefinitions().map((definition) => definition.kind),
      ["gateway"],
    );
    assert.deepEqual(inferenceRouteForService("custom-relay"), {
      id: "gateway:custom-relay",
      kind: "gateway",
      gatewayId: "custom-relay",
      model: {
        id: "gateway:custom-relay:vendor-z/model-y",
        upstreamName: "vendor-z/model-y",
      },
    });
  } finally {
    if (previousCatalog === undefined) delete process.env.AI_PROVIDER_CATALOG;
    else process.env.AI_PROVIDER_CATALOG = previousCatalog;
  }
});

test("MNRsecr routes to an injected Gateway without selecting its upstream", async () => {
  const directRoute = directProviderRoute("new-provider", "provider-model");
  const relayRoute = gatewayRoute("new-gateway", "vendor-z/model-y");
  const messages = [] as const;
  const calls: Array<{ kind: string | undefined; routeId: string | undefined }> = [];
  const direct: ModelGateway = {
    provider: "new-provider",
    modelName: directRoute.model.upstreamName,
    routeKind: "direct_provider",
    async generate() {
      throw providerTimeoutError("new-provider");
    },
  };
  const gateway: ModelGateway = {
    provider: "new-gateway",
    modelName: relayRoute.model.upstreamName,
    routeKind: "gateway",
    async generate(_messages, context: GatewayCallContext): Promise<GatewayResponse> {
      calls.push({
        kind: context.route?.kind,
        routeId: context.route?.id,
      });
      return { text: "ok", toolCalls: [] };
    },
  };
  const router = new MnrInferenceRouter(
    {
      [directRoute.id]: direct,
      [relayRoute.id]: gateway,
    },
    [directRoute.id, relayRoute.id],
    {
      [directRoute.id]: directRoute,
      [relayRoute.id]: relayRoute,
    },
  );
  const context: GatewayCallContext = {
    requestId: "route-boundary-test",
    callNumber: 1,
    toolCallsExecuted: 0,
  };

  const response = await router.generate([...messages], context);

  assert.equal(response.text, "ok");
  assert.deepEqual(calls, [{ kind: "gateway", routeId: "gateway:new-gateway" }]);
  assert.deepEqual(router.getTrace(context.requestId).routesAttempted, [
    "direct:new-provider",
    "gateway:new-gateway",
  ]);
  assert.deepEqual(router.getTrace(context.requestId).providersAttempted, [
    "new-provider",
    "new-gateway",
  ]);
  assert.equal(router.getProviderForRequest(context.requestId).routeKind, "gateway");
  assert.equal(router.getProviderForRequest(context.requestId).routeId, "gateway:new-gateway");
});

test("usage normalization is selected by protocol format, not provider identity", () => {
  assert.deepEqual(
    normalizeLlmUsage("gemini", {
      promptTokenCount: 14,
      candidatesTokenCount: 6,
      totalTokenCount: 20,
      cachedContentTokenCount: 3,
    }),
    {
      inputTokens: 14,
      outputTokens: 6,
      totalTokens: 20,
      cachedTokens: 3,
      completeness: "complete",
    },
  );
  assert.deepEqual(
    normalizeLlmUsage("openai-compatible", {
      prompt_tokens: 14,
      completion_tokens: 6,
      total_tokens: 20,
    }),
    {
      inputTokens: 14,
      outputTokens: 6,
      totalTokens: 20,
      cachedTokens: null,
      completeness: "complete",
    },
  );
  assert.deepEqual(
    normalizeProviderUsage("gemini", {
      promptTokenCount: 14,
      candidatesTokenCount: 6,
      totalTokenCount: 20,
    }),
    normalizeLlmUsage("gemini", {
      promptTokenCount: 14,
      candidatesTokenCount: 6,
      totalTokenCount: 20,
    }),
  );
});