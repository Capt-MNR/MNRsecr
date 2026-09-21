export type ProviderDefinition = {
  name: string;
  protocol: "gemini" | "openai-compatible" | "cohere";
  apiKeyEnv: string;
  modelEnv: string;
  defaultModel: string;
  apiUrlEnv?: string;
  defaultApiUrl?: string;
};

export const providerDefinitions = [
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
] as const satisfies readonly ProviderDefinition[];

export type ProviderName = typeof providerDefinitions[number]["name"];

export const defaultProviderOrder: ProviderName[] = providerDefinitions.map(
  (definition) => definition.name,
);

export function isProviderName(value: string | undefined): value is ProviderName {
  return providerDefinitions.some((definition) => definition.name === value);
}

export function providerDefinition(provider: ProviderName): ProviderDefinition {
  const definition = providerDefinitions.find((item) => item.name === provider);
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