import { featureFlags } from "./feature-flags";

export type BudgetMessage = {
  role: string;
  text?: string;
  toolCalls?: unknown[];
};

export type BudgetTool = {
  name: string;
  [key: string]: unknown;
};

export type ContextBudget = {
  maxConversationChars: number;
  maxToolDefinitions: number;
  maxToolResultChars: number;
};

export type ContextBudgetResult = {
  messages: BudgetMessage[];
  tools: BudgetTool[];
  truncated: boolean;
  originalConversationChars: number;
  finalConversationChars: number;
};

const DEFAULT_BUDGET: ContextBudget = {
  maxConversationChars: 8_000,
  maxToolDefinitions: 16,
  maxToolResultChars: 2_000,
};

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getContextBudget(): ContextBudget {
  return {
    maxConversationChars: positiveInt(
      process.env.CTX_BUDGET_MAX_CONVERSATION_CHARS,
      DEFAULT_BUDGET.maxConversationChars,
    ),
    maxToolDefinitions: positiveInt(
      process.env.CTX_BUDGET_MAX_TOOL_DEFINITIONS,
      DEFAULT_BUDGET.maxToolDefinitions,
    ),
    maxToolResultChars: positiveInt(
      process.env.CTX_BUDGET_MAX_TOOL_RESULT_CHARS,
      DEFAULT_BUDGET.maxToolResultChars,
    ),
  };
}

function messageSize(message: BudgetMessage): number {
  return JSON.stringify(message).length;
}

function trimToolResult(message: BudgetMessage, maxChars: number): BudgetMessage {
  if (message.role !== "tool" || !message.text || message.text.length <= maxChars) {
    return message;
  }
  return {
    ...message,
    text: `${message.text.slice(0, Math.max(0, maxChars - 28))}…[truncated]`,
  };
}

export function budgetContext(
  messages: BudgetMessage[],
  tools: BudgetTool[],
  budget: ContextBudget = getContextBudget(),
): ContextBudgetResult {
  const originalConversationChars = messages.reduce((total, message) => total + messageSize(message), 0);
  if (!featureFlags.contextBudgeter()) {
    return {
      messages,
      tools,
      truncated: false,
      originalConversationChars,
      finalConversationChars: originalConversationChars,
    };
  }

  const required = messages.filter((message) => message.role === "system" || message.role === "user");
  const optional = messages
    .filter((message) => message.role !== "system" && message.role !== "user")
    .map((message) => trimToolResult(message, budget.maxToolResultChars));
  const selected: BudgetMessage[] = [...required];
  let used = selected.reduce((total, message) => total + messageSize(message), 0);
  for (const message of optional.reverse()) {
    const size = messageSize(message);
    if (used + size > budget.maxConversationChars) continue;
    selected.unshift(message);
    used += size;
  }

  const seen = new Set<string>();
  const limitedTools = tools.filter((tool) => {
    if (seen.has(tool.name)) return false;
    seen.add(tool.name);
    return true;
  }).slice(0, budget.maxToolDefinitions);

  const finalConversationChars = selected.reduce((total, message) => total + messageSize(message), 0);
  return {
    messages: selected,
    tools: limitedTools,
    truncated: selected.length !== messages.length || limitedTools.length !== tools.length,
    originalConversationChars,
    finalConversationChars,
  };
}