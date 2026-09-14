import { featureFlags } from "./feature-flags";

export type RoutedProvider = "gemini" | "groq" | "mistral" | "cohere";

export type ProviderRoute = {
  provider: RoutedProvider;
  reason: string;
  confidence: number;
  enabled: boolean;
};

const supportedProviders: RoutedProvider[] = ["gemini", "groq", "mistral", "cohere"];

function configuredOrder(): RoutedProvider[] {
  const configured = (process.env.PROVIDER_ROUTING_ORDER ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is RoutedProvider => supportedProviders.includes(value as RoutedProvider));
  return configured.length > 0 ? configured : ["gemini", "groq", "mistral", "cohere"];
}

export function routeProvider(message: string, preferred?: RoutedProvider): ProviderRoute {
  if (preferred) {
    return { provider: preferred, reason: "explicit_preference", confidence: 1, enabled: featureFlags.providerRouting() };
  }
  const order = configuredOrder();
  const isArabic = /[\u0600-\u06FF]/u.test(message);
  const isShort = message.trim().length < 80;
  const provider = isArabic && isShort && order.includes("gemini")
    ? "gemini"
    : order[0];
  return {
    provider,
    reason: isArabic && isShort ? "short_arabic_request" : "configured_priority",
    confidence: isArabic && isShort ? 0.78 : 0.6,
    enabled: featureFlags.providerRouting(),
  };
}

export function providerOrder(): RoutedProvider[] {
  return configuredOrder();
}