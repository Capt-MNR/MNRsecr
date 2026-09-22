type ProviderProtocol = "gemini" | "openai-compatible" | "cohere";

export type ProviderDefinition = {
  name: string;
  protocol: ProviderProtocol;
  apiKeyEnv: string;
  modelEnv: string;
  defaultModel: string;
  apiUrlEnv?: string;
  defaultApiUrl?: string;
};

const builtInProviderDefinitions: ProviderDefinition[] = [
  {
    name: "gemini",
    protocol: "gemini",
    apiKeyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    defaultModel: "gemini-3.6-flash",
  },
  {
    name: "groq",
    protocol: "openai-compatible",
    apiKeyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    defaultModel: "openai/gpt-oss-20b",
    defaultApiUrl: "https://api.groq.com/openai/v1/chat/completions",
  },
  {
    name: "mistral",
    protocol: "openai-compatible",
    apiKeyEnv: "MISTRAL_API_KEY",
    modelEnv: "MISTRAL_MODEL",
    defaultModel: "mistral-small-latest",
    defaultApiUrl: "https://api.mistral.ai/v1/chat/completions",
  },
  {
    name: "cohere",
    protocol: "cohere",
    apiKeyEnv: "COHERE_API_KEY",
    modelEnv: "COHERE_MODEL",
    defaultModel: "command-r-08-2024",
    defaultApiUrl: "https://api.cohere.com/v2/chat",
  },
  {
    name: "deepseek",
    protocol: "openai-compatible",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    modelEnv: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-chat",
    apiUrlEnv: "DEEPSEEK_API_URL",
    defaultApiUrl: "https://api.deepseek.com/chat/completions",
  },
  {
    name: "qwen",
    protocol: "openai-compatible",
    apiKeyEnv: "QWEN_API_KEY",
    modelEnv: "QWEN_MODEL",
    defaultModel: "qwen-plus",
    apiUrlEnv: "QWEN_API_URL",
    defaultApiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  },
  {
    name: "openrouter",
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

function validProviderDefinition(value: unknown): value is ProviderDefinition {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (!validIdentifier(item.name)) return false;
  if (item.protocol !== "openai-compatible") return false;
  if (!validEnvironmentName(item.apiKeyEnv) || !validEnvironmentName(item.modelEnv)) return false;
  if (typeof item.defaultModel !== "string" || item.defaultModel.trim().length === 0) return false;
  if (item.apiUrlEnv !== undefined && !validEnvironmentName(item.apiUrlEnv)) return false;
  if (typeof item.defaultApiUrl !== "string" || !/^https:\/\//u.test(item.defaultApiUrl)) return false;
  return true;
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
  return definitions.map((definition) => ({ ...definition }));
}

export function providerDefinitions(): ProviderDefinition[] {
  return configuredProviderDefinitions();
}

export function defaultProviderOrder(): ProviderName[] {
  return providerDefinitions().map((definition) => definition.name);
}

export function isProviderName(value: string | undefined): value is ProviderName {
  return Boolean(value) && providerDefinitions().some((definition) => definition.name === value);
}

export function providerDefinition(provider: ProviderName): ProviderDefinition {
  const definition = providerDefinitions().find((item) => item.name === provider);
  if (!definition) throw new Error(`UNKNOWN_PROVIDER:${provider}`);
  return definition;
}

export function providerIsConfigured(provider: ProviderName): boolean {
  return Boolean(process.env[providerDefinition(provider).apiKeyEnv]);
}

export function providerModel(provider: ProviderName): string {
  const definition = providerDefinition(provider);
  return process.env[definition.modelEnv] ?? definition.defaultModel;
}

export function providerApiUrl(provider: ProviderName): string | undefined {
  const definition = providerDefinition(provider);
  return definition.apiUrlEnv
    ? process.env[definition.apiUrlEnv] ?? definition.defaultApiUrl
    : definition.defaultApiUrl;
}