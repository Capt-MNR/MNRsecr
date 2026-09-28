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
  inferenceServiceApiUrl,
  inferenceServiceDefinition,
  inferenceServiceDefinitions,
  inferenceServiceModel,
  providerDefinitions,
  routeIdForService,
} from "../src/lib/provider-registry.ts";
import { providerTimeoutError } from "../src/lib/error-contract.ts";
import {
  MnrInferenceRouter,
  normalizeLlmUsage,
  normalizeProviderUsage,
  OpenAiCompatibleModelGateway,
  configuredRouteOrder,
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

test("a registry-configured Gateway reuses the adapter contract without exposing its upstream", async () => {
  const environmentKeys = [
    "AI_PROVIDER_CATALOG",
    "AI_ROUTE_ORDER",
    "AI_PRIMARY_ROUTE",
    "CUSTOM_RELAY_API_KEY",
    "CUSTOM_RELAY_API_URL",
    "CUSTOM_RELAY_MODEL",
  ] as const;
  const previousEnvironment = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  const previousFetch = globalThis.fetch;

  try {
    const relayUrl = "https://test-relay.invalid/v1/chat/completions";
    process.env.AI_PROVIDER_CATALOG = JSON.stringify({
      providers: [{
        name: "test-relay",
        kind: "gateway",
        protocol: "openai-compatible",
        apiKeyEnv: "CUSTOM_RELAY_API_KEY",
        modelEnv: "CUSTOM_RELAY_MODEL",
        defaultModel: "fixture-default-model",
        apiUrlEnv: "CUSTOM_RELAY_API_URL",
        defaultApiUrl: relayUrl,
      }],
    });
    process.env.AI_ROUTE_ORDER = "gateway:test-relay";
    process.env.AI_PRIMARY_ROUTE = "gateway:test-relay";
    process.env.CUSTOM_RELAY_API_KEY = "fixture-only-not-a-real-key";
    process.env.CUSTOM_RELAY_API_URL = relayUrl;
    process.env.CUSTOM_RELAY_MODEL = "test-model";

    const definition = inferenceServiceDefinition("test-relay");
    const route = inferenceRouteForService("test-relay", inferenceServiceModel("test-relay"));
    const gateway = new OpenAiCompatibleModelGateway(
      definition.name,
      inferenceServiceApiUrl("test-relay") ?? "",
      inferenceServiceModel("test-relay"),
      process.env[definition.apiKeyEnv],
      definition.apiKeyEnv,
      definition.kind,
    );
    const router = new MnrInferenceRouter(
      { [route.id]: gateway },
      [route.id],
      { [route.id]: route },
    );
    assert.deepEqual(configuredRouteOrder(), ["gateway:test-relay"]);

    let internalUpstream = "upstream-A";
    const fetchObservations: Array<{
      url: string;
      model: string | undefined;
      internalUpstream: string;
    }> = [];
    globalThis.fetch = async (input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { model?: string } : {};
      fetchObservations.push({
        url: String(input),
        model: body.model,
        internalUpstream,
      });
      return new Response(JSON.stringify({
        choices: [{ message: { content: `fixture response from ${internalUpstream}` } }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const firstContext: GatewayCallContext = {
      requestId: "test-relay-upstream-a",
      callNumber: 1,
      toolCallsExecuted: 0,
    };
    const firstResponse = await router.generate([], firstContext);
    internalUpstream = "upstream-B";
    const secondContext: GatewayCallContext = {
      requestId: "test-relay-upstream-b",
      callNumber: 1,
      toolCallsExecuted: 0,
    };
    const secondResponse = await router.generate([], secondContext);

    assert.equal(firstResponse.text, "fixture response from upstream-A");
    assert.equal(secondResponse.text, "fixture response from upstream-B");
    assert.deepEqual(fetchObservations, [
      { url: relayUrl, model: "test-model", internalUpstream: "upstream-A" },
      { url: relayUrl, model: "test-model", internalUpstream: "upstream-B" },
    ]);
    for (const requestId of [firstContext.requestId, secondContext.requestId]) {
      const trace = router.getTrace(requestId);
      assert.equal(trace.primaryRouteId, "gateway:test-relay");
      assert.equal(trace.selectedRouteId, "gateway:test-relay");
      assert.deepEqual(trace.routesAttempted, ["gateway:test-relay"]);
      assert.deepEqual(trace.providersAttempted, ["test-relay"]);
      assert.equal(trace.routesAttempted?.some((id) => id.includes("upstream-")), false);
      assert.deepEqual(router.getProviderForRequest(requestId), {
        provider: "test-relay",
        model: "test-model",
        routeId: "gateway:test-relay",
        routeKind: "gateway",
      });
    }
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of environmentKeys) {
      const value = previousEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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