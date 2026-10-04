import {
  directProviderRoute,
  gatewayRoute,
  isInferenceCapability,
  type InferenceRoute,
  type InferenceCapability,
  type InferenceRouteKind,
} from "./inference-routes";

export type ProviderProtocol = "gemini" | "openai-compatible" | "cohere";

export type ModelCapabilityDeclaration = {
  modelName: string;
  capabilities: readonly InferenceCapability[];
};

export type ProviderDefinition = {
  name: string;
  kind: InferenceRouteKind;
  protocol: ProviderProtocol;
  apiKeyEnv: string;
  modelEnv: string;
  defaultModel: string;
  apiUrlEnv?: string;
  defaultApiUrl?: string;
  /** Declares capabilities only for the exact upstream model names listed. */
  modelCapabilities?: readonly ModelCapabilityDeclaration[];
};

const builtInProviderDefinitions: ProviderDefinition[] = [
  {
    name: "gemini",
    kind: "direct_provider",
    protocol: "gemini",
    apiKeyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    defaultModel: "gemini-3.6-flash",
  },
  {
    name: "groq",
    kind: "direct_provider",
    protocol: "openai-compatible",
    apiKeyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    defaultModel: "openai/gpt-oss-20b",
    defaultApiUrl: "https://api.groq.com/openai/v1/chat/completions",
  },
  {
    name: "mistral",
    kind: "direct_provider",
    protocol: "openai-compatible",
    apiKeyEnv: "MISTRAL_API_KEY",
    modelEnv: "MISTRAL_MODEL",
    defaultModel: "mistral-small-latest",
    defaultApiUrl: "https://api.mistral.ai/v1/chat/completions",
  },
  {
    name: "cohere",
    kind: "direct_provider",
    protocol: "cohere",
    apiKeyEnv: "COHERE_API_KEY",
    modelEnv: "COHERE_MODEL",
    defaultModel: "command-r-08-2024",
    defaultApiUrl: "https://api.cohere.com/v2/chat",
  },
  {
    name: "deepseek",
    kind: "direct_provider",
    protocol: "openai-compatible",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    modelEnv: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-chat",
    apiUrlEnv: "DEEPSEEK_API_URL",
    defaultApiUrl: "https://api.deepseek.com/chat/completions",
  },
  {
    name: "qwen",
    kind: "direct_provider",
    protocol: "openai-compatible",
    apiKeyEnv: "QWEN_API_KEY",
    modelEnv: "QWEN_MODEL",
    defaultModel: "qwen-plus",
    apiUrlEnv: "QWEN_API_URL",
    defaultApiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  },
  {
    name: "openrouter",
    kind: "gateway",
    protocol: "openai-compatible",
    apiKeyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
    defaultModel: "openai/gpt-oss-20b",
    apiUrlEnv: "OPENROUTER_API_URL",
    defaultApiUrl: "https://openrouter.ai/api/v1/chat/completions",
  },
];

export type ProviderName = string;

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{1,63}$/u.test(value);
}

function validEnvironmentName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{1,127}$/u.test(value);
}

type ProviderDefinitionInput = Omit<ProviderDefinition, "kind"> & {
  kind?: InferenceRouteKind;
};

function validModelCapabilityDeclarations(value: unknown): value is ModelCapabilityDeclaration[] {
  if (!Array.isArray(value)) return false;
  const modelNames = new Set<string>();
  for (const declaration of value) {
    if (!declaration || typeof declaration !== "object") return false;
    const item = declaration as Record<string, unknown>;
    if (typeof item.modelName !== "string" || !item.modelName.trim()) return false;
    const modelName = item.modelName.trim();
    if (modelNames.has(modelName)) return false;
    modelNames.add(modelName);
    if (!Array.isArray(item.capabilities) || !item.capabilities.every(isInferenceCapability)) return false;
  }
  return true;
}

function validProviderDefinition(value: unknown): value is ProviderDefinitionInput {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (!validIdentifier(item.name)) return false;
  if (item.protocol !== "openai-compatible") return false;
  if (
    item.kind !== undefined
    && item.kind !== "direct_provider"
    && item.kind !== "gateway"
  ) return false;
  if (!validEnvironmentName(item.apiKeyEnv) || !validEnvironmentName(item.modelEnv)) return false;
  if (typeof item.defaultModel !== "string" || item.defaultModel.trim().length === 0) return false;
  if (item.apiUrlEnv !== undefined && !validEnvironmentName(item.apiUrlEnv)) return false;
  if (typeof item.defaultApiUrl !== "string" || !/^https:\/\//u.test(item.defaultApiUrl)) return false;
  if (item.modelCapabilities !== undefined && !validModelCapabilityDeclarations(item.modelCapabilities)) return false;
  return true;
}

function normalizeProviderDefinition(definition: ProviderDefinitionInput): ProviderDefinition {
  return {
    ...definition,
    kind: definition.kind ?? (definition.name === "openrouter" ? "gateway" : "direct_provider"),
    ...(definition.modelCapabilities !== undefined
      ? {
          modelCapabilities: definition.modelCapabilities.map((item) => ({
            modelName: item.modelName.trim(),
            capabilities: [...new Set(item.capabilities)],
          })),
        }
      : {}),
  };
}

function configuredProviderDefinitions(): ProviderDefinition[] {
  const raw = process.env.AI_PROVIDER_CATALOG?.trim();
  if (!raw) return builtInProviderDefinitions.map((definition) => ({ ...definition }));

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("INVALID_AI_PROVIDER_CATALOG:expected_json");
  }
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).providers)
      ? (parsed as { providers: unknown[] }).providers
      : null;
  if (!entries || entries.length === 0 || entries.some((entry) => !validProviderDefinition(entry))) {
    throw new Error("INVALID_AI_PROVIDER_CATALOG:expected_openai_compatible_providers");
  }
  const definitions = entries as ProviderDefinition[];
  const names = new Set<string>();
  for (const definition of definitions) {
    if (names.has(definition.name)) throw new Error(`INVALID_AI_PROVIDER_CATALOG:duplicate:${definition.name}`);
    names.add(definition.name);
  }
  return definitions.map(normalizeProviderDefinition);
}

export function inferenceServiceDefinitions(): ProviderDefinition[] {
  return configuredProviderDefinitions();
}

export function providerDefinitions(): ProviderDefinition[] {
  return inferenceServiceDefinitions().filter((definition) => definition.kind === "direct_provider");
}

export function directProviderDefinitions(): ProviderDefinition[] {
  return providerDefinitions();
}

export function gatewayDefinitions(): ProviderDefinition[] {
  return inferenceServiceDefinitions().filter((definition) => definition.kind === "gateway");
}

export function defaultProviderOrder(): ProviderName[] {
  return providerDefinitions().map((definition) => definition.name);
}

export function defaultInferenceServiceOrder(): ProviderName[] {
  return inferenceServiceDefinitions().map((definition) => definition.name);
}

export function isProviderName(value: string | undefined): value is ProviderName {
  return Boolean(value) && providerDefinitions().some((definition) => definition.name === value);
}

export function inferenceServiceIsKnown(value: string | undefined): value is ProviderName {
  return Boolean(value) && inferenceServiceDefinitions().some((definition) => definition.name === value);
}

export function providerDefinition(provider: ProviderName): ProviderDefinition {
  const definition = providerDefinitions().find((item) => item.name === provider);
  if (!definition) throw new Error(`UNKNOWN_PROVIDER:${provider}`);
  return definition;
}

export function inferenceServiceDefinition(serviceName: ProviderName): ProviderDefinition {
  const definition = inferenceServiceDefinitions().find((item) => item.name === serviceName);
  if (!definition) throw new Error(`UNKNOWN_INFERENCE_SERVICE:${serviceName}`);
  return definition;
}

export function providerIsConfigured(provider: ProviderName): boolean {
  return Boolean(process.env[providerDefinition(provider).apiKeyEnv]);
}

export function inferenceServiceIsConfigured(serviceName: ProviderName): boolean {
  return Boolean(process.env[inferenceServiceDefinition(serviceName).apiKeyEnv]);
}

export function providerModel(provider: ProviderName): string {
  const definition = providerDefinition(provider);
  return process.env[definition.modelEnv] ?? definition.defaultModel;
}

export function inferenceServiceModel(serviceName: ProviderName): string {
  const definition = inferenceServiceDefinition(serviceName);
  return process.env[definition.modelEnv] ?? definition.defaultModel;
}

export function inferenceModelCapabilitiesForService(
  serviceName: ProviderName,
  modelName = inferenceServiceModel(serviceName),
): readonly InferenceCapability[] | undefined {
  const definition = inferenceServiceDefinition(serviceName);
  return definition.modelCapabilities?.find((item) => item.modelName === modelName.trim())?.capabilities;
}

export function providerApiUrl(provider: ProviderName): string | undefined {
  const definition = providerDefinition(provider);
  return definition.apiUrlEnv
    ? process.env[definition.apiUrlEnv] ?? definition.defaultApiUrl
    : definition.defaultApiUrl;
}

export function inferenceServiceApiUrl(serviceName: ProviderName): string | undefined {
  const definition = inferenceServiceDefinition(serviceName);
  return definition.apiUrlEnv
    ? process.env[definition.apiUrlEnv] ?? definition.defaultApiUrl
    : definition.defaultApiUrl;
}

export function inferenceRouteForService(
  serviceName: ProviderName,
  modelName = inferenceServiceModel(serviceName),
): InferenceRoute {
  const definition = inferenceServiceDefinition(serviceName);
  const capabilities = inferenceModelCapabilitiesForService(serviceName, modelName);
  return definition.kind === "gateway"
    ? gatewayRoute(definition.name, modelName, capabilities)
    : directProviderRoute(definition.name, modelName, capabilities);
}

export function routeIdForService(serviceName: ProviderName): string {
  const definition = inferenceServiceDefinition(serviceName);
  return definition.kind === "gateway"
    ? `gateway:${definition.name}`
    : `direct:${definition.name}`;
}

export function serviceNameForRouteId(routeId: string): ProviderName | undefined {
  const separator = routeId.indexOf(":");
  if (separator < 1) return undefined;
  const kind = routeId.slice(0, separator);
  const name = routeId.slice(separator + 1);
  const definition = inferenceServiceDefinitions().find((item) => item.name === name);
  if (!definition) return undefined;
  if (kind === "direct" && definition.kind === "direct_provider") return name;
  if (kind === "gateway" && definition.kind === "gateway") return name;
  return undefined;
}