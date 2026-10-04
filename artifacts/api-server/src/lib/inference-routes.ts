export type ProviderId = string;
export type GatewayId = string;
export type InferenceRouteId = string;

export type InferenceRouteKind = "direct_provider" | "gateway";

export const INFERENCE_CAPABILITIES = [
  "tool_calling",
  "structured_output",
  "vision",
  "audio_input",
  "audio_output",
] as const;

export type InferenceCapability = typeof INFERENCE_CAPABILITIES[number];

export function isInferenceCapability(value: unknown): value is InferenceCapability {
  return typeof value === "string"
    && (INFERENCE_CAPABILITIES as readonly string[]).includes(value);
}

export type InferenceModelIdentity = {
  id: string;
  upstreamName: string;
  capabilities?: readonly InferenceCapability[];
};

export type InferenceRoute =
  | {
      id: InferenceRouteId;
      kind: "direct_provider";
      providerId: ProviderId;
      model: InferenceModelIdentity;
    }
  | {
      id: InferenceRouteId;
      kind: "gateway";
      gatewayId: GatewayId;
      model: InferenceModelIdentity;
    };

function modelIdentity(
  kind: InferenceRouteKind,
  targetId: string,
  upstreamName: string,
  capabilities?: readonly InferenceCapability[],
): InferenceModelIdentity {
  const normalizedName = upstreamName.trim() || "unconfigured";
  return {
    id: `${kind}:${targetId}:${normalizedName}`,
    upstreamName: normalizedName,
    ...(capabilities !== undefined ? { capabilities: [...new Set(capabilities)] } : {}),
  };
}

export function directProviderRoute(
  providerId: ProviderId,
  upstreamName: string,
  capabilities?: readonly InferenceCapability[],
): InferenceRoute {
  return {
    id: `direct:${providerId}`,
    kind: "direct_provider",
    providerId,
    model: modelIdentity("direct_provider", providerId, upstreamName, capabilities),
  };
}

export function gatewayRoute(
  gatewayId: GatewayId,
  upstreamName: string,
  capabilities?: readonly InferenceCapability[],
): InferenceRoute {
  return {
    id: `gateway:${gatewayId}`,
    kind: "gateway",
    gatewayId,
    model: modelIdentity("gateway", gatewayId, upstreamName, capabilities),
  };
}

export function routeTargetId(route: InferenceRoute): string {
  return route.kind === "direct_provider" ? route.providerId : route.gatewayId;
}

export function routeHealthKey(route: InferenceRoute): string {
  return `${route.kind}:${routeTargetId(route)}`;
}

export function routeWithModel(
  route: InferenceRoute,
  upstreamName: string,
  capabilities?: readonly InferenceCapability[],
): InferenceRoute {
  const routeCapabilities = capabilities
    ?? (upstreamName.trim() === route.model.upstreamName ? route.model.capabilities : undefined);
  return route.kind === "direct_provider"
    ? directProviderRoute(route.providerId, upstreamName, routeCapabilities)
    : gatewayRoute(route.gatewayId, upstreamName, routeCapabilities);
}