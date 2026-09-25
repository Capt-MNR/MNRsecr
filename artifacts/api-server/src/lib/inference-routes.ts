export type ProviderId = string;
export type GatewayId = string;
export type InferenceRouteId = string;

export type InferenceRouteKind = "direct_provider" | "gateway";

export type InferenceModelIdentity = {
  id: string;
  upstreamName: string;
  capabilities?: readonly string[];
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

function modelIdentity(kind: InferenceRouteKind, targetId: string, upstreamName: string): InferenceModelIdentity {
  const normalizedName = upstreamName.trim() || "unconfigured";
  return {
    id: `${kind}:${targetId}:${normalizedName}`,
    upstreamName: normalizedName,
  };
}

export function directProviderRoute(providerId: ProviderId, upstreamName: string): InferenceRoute {
  return {
    id: `direct:${providerId}`,
    kind: "direct_provider",
    providerId,
    model: modelIdentity("direct_provider", providerId, upstreamName),
  };
}

export function gatewayRoute(gatewayId: GatewayId, upstreamName: string): InferenceRoute {
  return {
    id: `gateway:${gatewayId}`,
    kind: "gateway",
    gatewayId,
    model: modelIdentity("gateway", gatewayId, upstreamName),
  };
}

export function routeTargetId(route: InferenceRoute): string {
  return route.kind === "direct_provider" ? route.providerId : route.gatewayId;
}

export function routeHealthKey(route: InferenceRoute): string {
  return `${route.kind}:${routeTargetId(route)}`;
}

export function routeWithModel(route: InferenceRoute, upstreamName: string): InferenceRoute {
  return route.kind === "direct_provider"
    ? directProviderRoute(route.providerId, upstreamName)
    : gatewayRoute(route.gatewayId, upstreamName);
}