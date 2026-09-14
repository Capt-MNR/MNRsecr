import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

type EvaluationCase = {
  id: string;
  category: string;
  message: string;
  contextMode: "none" | "context_required";
  expected: {
    intent: string;
    primaryTool: string;
    acceptableTools: string[];
    clarification: boolean;
    write: boolean;
  };
};

type Dataset = {
  version: number;
  cases: EvaluationCase[];
};

type LogRecord = {
  msg?: string;
  requestId?: string;
  provider?: string;
  model?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  dryRun?: boolean;
  llmCall?: number;
  attempt?: number;
  latencyMs?: number;
  retryAfterSeconds?: number;
  [key: string]: unknown;
};

type WorkerRecord = {
  ok: boolean;
  caseId: string;
  mode: string;
  dryRun: boolean;
  elapsedMs: number;
  provider?: string;
  model?: string;
  responseKind?: string;
  assistantMessage?: string;
  action?: {
    type?: string;
    lastTool?: string;
    llmCalls?: number;
    toolCalls?: number;
    providerTrace?: Record<string, unknown>;
  };
  tokenUsage?: unknown[];
  rowCountsBefore?: Record<string, number>;
  rowCountsAfter?: Record<string, number>;
  error?: Record<string, unknown>;
};

type ToolSelection = {
  name: string;
  arguments: Record<string, unknown>;
  dryRun: boolean;
};

type CaseResult = {
  id: string;
  category: string;
  message: string;
  expected: EvaluationCase["expected"];
  contextMode: EvaluationCase["contextMode"];
  status: "evaluated" | "context_not_provided" | "provider_error" | "runner_error";
  actualIntent: string | null;
  actualTool: string | null;
  actualTools: string[];
  toolArguments: ToolSelection[];
  clarificationAsked: boolean | null;
  logicalLlmCalls: number;
  actualHttpAttempts: number;
  httpAttemptsByProvider: Record<string, number>;
  provider: string | null;
  model: string | null;
  fallback: boolean;
  fallbackReason: string | null;
  latencyMs: number;
  tokenUsage: unknown[] | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  cacheHit: boolean;
  cacheMiss: boolean;
  requestBytesByProvider: Record<string, number>;
  maxRequestBytes: number;
  systemPromptChars: number;
  toolDefinitionsChars: number;
  toolDefinitionsCount: number;
  maxConversationChars: number;
  contextBreakdown: Record<string, number | null>;
  rowCountsBefore: Record<string, number>;
  rowCountsAfter: Record<string, number>;
  rowCountChanged: boolean;
  approvalReached: boolean;
  wouldSelectWriteTool: boolean;
  writeOccurred: boolean;
  noWriteViolation: boolean;
  intentMatch: boolean | null;
  toolSelectionMatch: boolean | null;
  clarificationMatch: boolean | null;
  error?: Record<string, unknown>;
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DEFAULT_DATASET = resolve(dirname(fileURLToPath(import.meta.url)), "dataset.json");
const WORKER = resolve(dirname(fileURLToPath(import.meta.url)), "worker.ts");
const TSX = process.env.INTENT_EVAL_TSX
  ?? resolve(ROOT, "scripts/node_modules/.bin/tsx");
const WRITE_TOOLS = new Set([
  "create_person",
  "update_person",
  "create_project",
  "update_project",
  "link_person_to_project",
  "update_person_project_relationship",
  "record_expense",
  "update_expense",
  "create_task",
  "create_commitment",
  "create_reminder",
  "update_task",
  "update_commitment",
  "update_reminder",
  "delete_person",
  "delete_project",
  "delete_expense",
  "delete_task",
  "delete_commitment",
  "delete_reminder",
]);

function valueArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasArg(args: string[], name: string): boolean {
  return args.includes(name);
}

function usage(): void {
  console.log(`NLU Evaluation Harness (real provider, explicit dry-run)

Required safety flag:
  --confirm-live                 Allow real provider HTTP calls. Never writes.

Provider mode:
  --provider groq|gemini|failover

Case selection:
  --case A01,A02                 Run selected cases only
  --all --max-cases 3            Run a bounded prefix of the dataset

Output:
  --out path.json                Save results
  --baseline path.json           Print Before/After accuracy deltas
  --dataset path.json            Use another compatible dataset

Examples:
  pnpm --filter @workspace/api-server run test:intent-eval -- --provider groq --case A01 --confirm-live
  pnpm --filter @workspace/api-server run test:intent-eval -- --provider gemini --all --max-cases 3 --confirm-live
  pnpm --filter @workspace/api-server run test:intent-eval -- --provider failover --all --max-cases 36 --confirm-live
`);
}

function parseJsonLines(output: string): {
  records: LogRecord[];
  worker?: WorkerRecord;
} {
  const records: LogRecord[] = [];
  let worker: WorkerRecord | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("EVAL_RESULT ")) {
      try {
        worker = JSON.parse(line.slice("EVAL_RESULT ".length)) as WorkerRecord;
      } catch {
        // The runner reports a missing worker result below.
      }
      continue;
    }
    try {
      const parsed = JSON.parse(line) as LogRecord;
      if (parsed && typeof parsed === "object") records.push(parsed);
    } catch {
      // tsx or a provider may print a non-JSON diagnostic line.
    }
  }
  return { records, worker };
}

function selectedTools(logs: LogRecord[]): ToolSelection[] {
  return logs
    .filter((record) => record.msg === "agent tool selected" && typeof record.tool === "string")
    .map((record) => ({
      name: record.tool as string,
      arguments: record.arguments ?? {},
      dryRun: record.dryRun === true,
    }));
}

function actualIntent(
  worker: WorkerRecord | undefined,
  tools: ToolSelection[],
): string | null {
  if (!worker?.ok) return null;
  const names = new Set(tools.map((tool) => tool.name));
  if (names.has("record_expense")) return "expense";
  if (names.has("create_person")) return "create_person";
  if (names.has("update_expense")) return "correction";
  if (worker.responseKind === "clarification" || names.has("final_response")) {
    return "clarification";
  }
  return null;
}

function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageTotals(usage: unknown[] | undefined): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let cachedTokens = 0;
  for (const item of usage ?? []) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const promptTokens = numberFrom(record.promptTokenCount ?? record.prompt_tokens ?? record.input_tokens);
    const completionTokens = numberFrom(
      record.candidatesTokenCount
      ?? record.completion_tokens
      ?? record.output_tokens,
    );
    const itemTotal = numberFrom(record.totalTokenCount ?? record.total_tokens);
    const details = record.prompt_tokens_details;
    const cachedFromDetails = details && typeof details === "object"
      ? numberFrom((details as Record<string, unknown>).cached_tokens)
      : 0;
    const nestedTokens = record.tokens;
    const nestedInput = nestedTokens && typeof nestedTokens === "object"
      ? numberFrom((nestedTokens as Record<string, unknown>).input_tokens)
      : 0;
    const nestedOutput = nestedTokens && typeof nestedTokens === "object"
      ? numberFrom((nestedTokens as Record<string, unknown>).output_tokens)
      : 0;
    inputTokens += promptTokens || nestedInput;
    outputTokens += completionTokens || nestedOutput;
    totalTokens += itemTotal || promptTokens + completionTokens || nestedInput + nestedOutput;
    cachedTokens += numberFrom(record.cachedContentTokenCount ?? record.cached_tokens) || cachedFromDetails;
  }
  return { inputTokens, outputTokens, totalTokens, cachedTokens };
}

function measuredLogValue(
  record: LogRecord | undefined,
  key: string,
  fallback: number | null,
): number | null {
  if (!record) return fallback;
  return typeof record[key] === "number" && Number.isFinite(record[key])
    ? Number(record[key])
    : null;
}

function sumMeasured(values: Array<number | null>): number | null {
  const measured = values.filter((value): value is number => value !== null);
  return measured.length > 0 ? measured.reduce((sum, value) => sum + value, 0) : null;
}

function measuredContextNumber(result: CaseResult, key: string): number | null {
  const value = result.contextBreakdown[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function runWorker(
  evaluationCase: EvaluationCase,
  mode: string,
  datasetPath: string,
): Promise<{ worker?: WorkerRecord; logs: LogRecord[]; exitCode: number | null; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(TSX, [
      WORKER,
      "--case",
      evaluationCase.id,
      "--mode",
      mode,
      "--dataset",
      datasetPath,
    ], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "production",
        LOG_LEVEL: "info",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), 90_000);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      const parsed = parseJsonLines(stdout);
        resolvePromise({ logs: parsed.records, worker: parsed.worker, exitCode, stderr });
    });
  });
}

function makeCaseResult(
  evaluationCase: EvaluationCase,
  mode: string,
  run: { worker?: WorkerRecord; logs: LogRecord[]; exitCode: number | null; stderr: string },
): CaseResult {
  const tools = selectedTools(run.logs);
  const worker = run.worker;
  const names = tools.map((tool) => tool.name);
  const nonFinalTools = names.filter((name) => name !== "final_response");
  const actualTool = nonFinalTools[0]
    ?? (names.includes("final_response") ? "final_response" : worker?.ok ? "text_response" : null);
  const trace = worker?.action?.providerTrace ?? {};
  const usage = usageTotals(worker?.tokenUsage);
  const usageSummary = run.logs.find((record) => record.msg === "agent llm usage summary");
  const usageContext = usageSummary?.context && typeof usageSummary.context === "object"
    ? usageSummary.context as Record<string, unknown>
    : undefined;
  const fallbackLog = run.logs.find((record) => record.msg === "agent provider fallback");
  const startedLogs = run.logs.filter((record) => record.msg === "agent llm call started");
  const attemptsByProvider: Record<string, number> = {};
  for (const record of startedLogs) {
    if (record.provider) attemptsByProvider[record.provider] = (attemptsByProvider[record.provider] ?? 0) + 1;
  }
  const approvalReached = run.logs.some((record) => record.msg === "agent write awaiting approval");
  const wouldSelectWriteTool = tools.some((tool) => WRITE_TOOLS.has(tool.name));
  const rowCountsBefore = worker?.rowCountsBefore ?? {};
  const rowCountsAfter = worker?.rowCountsAfter ?? {};
  const rowCountChanged = Object.keys({ ...rowCountsBefore, ...rowCountsAfter }).some(
    (key) => Number(rowCountsBefore[key] ?? 0) !== Number(rowCountsAfter[key] ?? 0),
  );
  const writeResultWithoutDryRun = run.logs.some((record) =>
    record.msg === "agent tool result"
    && typeof record.tool === "string"
    && WRITE_TOOLS.has(record.tool)
    && record.dryRun !== true,
  );
  const writeOccurred = rowCountChanged || writeResultWithoutDryRun;
  const noWriteViolation = writeOccurred;
  const providerError = !worker;
  const contextLimited = evaluationCase.contextMode === "context_required"
    && !process.env.INTENT_EVAL_CONVERSATION_ID;
  const status: CaseResult["status"] = providerError
    ? "runner_error"
    : worker.ok
      ? contextLimited ? "context_not_provided" : "evaluated"
      : "provider_error";
  const intent = actualIntent(worker, tools);
  const clarification = worker?.ok ? worker.responseKind === "clarification" : null;
  const intentMatch = status === "evaluated" ? intent === evaluationCase.expected.intent : null;
  const toolSelectionMatch = status === "evaluated"
    ? evaluationCase.expected.acceptableTools.some((tool) => names.includes(tool))
    : null;
  const clarificationMatch = status === "evaluated"
    ? clarification === evaluationCase.expected.clarification
    : null;

  return {
    id: evaluationCase.id,
    category: evaluationCase.category,
    message: evaluationCase.message,
    expected: evaluationCase.expected,
    contextMode: evaluationCase.contextMode,
    status,
    actualIntent: intent,
    actualTool,
    actualTools: names,
    toolArguments: tools,
    clarificationAsked: clarification,
    logicalLlmCalls: measuredLogValue(usageSummary, "totalLogicalLlmCalls", null)
      ?? worker?.action?.llmCalls
      ?? Math.max(0, ...startedLogs.map((record) => Number(record.llmCall ?? 0))),
    actualHttpAttempts: measuredLogValue(usageSummary, "totalHttpAttempts", null)
      ?? Number(trace.httpAttempts ?? startedLogs.length),
    httpAttemptsByProvider: (trace.httpAttemptsByProvider as Record<string, number> | undefined)
      ?? attemptsByProvider,
    provider: worker?.provider
      ?? (typeof trace.selectedProvider === "string" ? trace.selectedProvider : null)
      ?? (typeof fallbackLog?.provider === "string" ? fallbackLog.provider : null),
    model: worker?.model ?? (typeof trace.selectedProvider === "string"
      ? String(trace.selectedProvider)
      : null),
    fallback: Boolean(trace.fallbackOccurred ?? fallbackLog),
    fallbackReason: typeof trace.fallbackReason === "string"
      ? trace.fallbackReason
      : typeof fallbackLog?.fallbackReason === "string" ? fallbackLog.fallbackReason : null,
    latencyMs: Number(
      run.logs.find((record) => record.msg === "agent final response")?.latencyMs
        ?? worker?.elapsedMs
        ?? 0,
    ),
    tokenUsage: worker?.tokenUsage && worker.tokenUsage.length > 0 ? worker.tokenUsage : null,
    inputTokens: measuredLogValue(usageSummary, "totalInputTokens", usage.inputTokens || null),
    outputTokens: measuredLogValue(usageSummary, "totalOutputTokens", usage.outputTokens || null),
    totalTokens: measuredLogValue(usageSummary, "totalTokens", usage.totalTokens || null),
    cachedTokens: measuredLogValue(usageSummary, "totalCachedTokens", usage.cachedTokens || null),
    cacheHit: usageSummary?.cacheHit === true || trace.cacheHit === true,
    cacheMiss: usageSummary?.cacheMiss === true || trace.cacheMiss === true,
    requestBytesByProvider: (trace.requestBytesByProvider as Record<string, number> | undefined) ?? {},
    maxRequestBytes: Number(trace.maxRequestBytes ?? 0),
    systemPromptChars: Number(trace.systemPromptChars ?? 0),
    toolDefinitionsChars: Number(trace.toolDefinitionsChars ?? 0),
    toolDefinitionsCount: Number(trace.toolDefinitionsCount ?? 0),
    maxConversationChars: Number(trace.maxConversationChars ?? 0),
    contextBreakdown: usageContext
      ? Object.fromEntries(Object.entries(usageContext).map(([key, value]) => [
        key,
        typeof value === "number" && Number.isFinite(value) ? value : null,
      ]))
      : {
        systemPromptChars: null,
        requestGuidanceChars: null,
        userMessageChars: null,
        recentConversationChars: null,
        summaryChars: null,
        structuredStateChars: null,
        toolResultChars: null,
        otherConversationChars: null,
        conversationChars: null,
        toolDefinitionsChars: null,
        requestBytes: null,
      },
    rowCountsBefore,
    rowCountsAfter,
    rowCountChanged,
    approvalReached,
    wouldSelectWriteTool,
    writeOccurred,
    noWriteViolation,
    intentMatch,
    toolSelectionMatch,
    clarificationMatch,
    ...(worker?.error
      ? { error: worker.error }
      : run.stderr
        ? { error: { message: run.stderr.trim().slice(-2000), exitCode: run.exitCode } }
        : {}),
  };
}

function percentage(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10000) / 100;
}

function summarize(results: CaseResult[]) {
  const evaluated = results.filter((result) => result.status === "evaluated");
  const latencies = evaluated
    .map((result) => result.latencyMs)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const percentile = (p: number): number => {
    if (latencies.length === 0) return 0;
    const index = Math.min(latencies.length - 1, Math.ceil(latencies.length * p) - 1);
    return latencies[index] ?? 0;
  };
  const ratio = (key: "intentMatch" | "toolSelectionMatch" | "clarificationMatch") =>
    evaluated.length === 0
      ? null
      : percentage(evaluated.filter((result) => result[key] === true).length / evaluated.length);
  return {
    totalCases: results.length,
    evaluatedCases: evaluated.length,
    providerErrors: results.filter((result) => result.status === "provider_error").length,
    contextNotProvided: results.filter((result) => result.status === "context_not_provided").length,
    runnerErrors: results.filter((result) => result.status === "runner_error").length,
    intentAccuracyPercent: ratio("intentMatch"),
    toolSelectionAccuracyPercent: ratio("toolSelectionMatch"),
    clarificationAccuracyPercent: ratio("clarificationMatch"),
    noWriteViolations: results.filter((result) => result.noWriteViolation || result.writeOccurred).length,
    totalLogicalLlmCalls: results.reduce((sum, result) => sum + result.logicalLlmCalls, 0),
    totalHttpAttempts: results.reduce((sum, result) => sum + result.actualHttpAttempts, 0),
    fallbackCases: results.filter((result) => result.fallback).length,
    totalInputTokens: sumMeasured(results.map((result) => result.inputTokens)),
    totalOutputTokens: sumMeasured(results.map((result) => result.outputTokens)),
    totalTokens: sumMeasured(results.map((result) => result.totalTokens)),
    totalCachedTokens: sumMeasured(results.map((result) => result.cachedTokens)),
    cacheHitCases: results.filter((result) => result.cacheHit).length,
    cacheMissCases: results.filter((result) => result.cacheMiss).length,
    totalRequestBytes: sumMeasured(results.map((result) => {
      const contextBytes = measuredContextNumber(result, "requestBytes");
      return contextBytes ?? Object.values(result.requestBytesByProvider)
        .reduce((inner, value) => inner + value, 0);
    })) ?? 0,
    averageLatencyMs: results.length === 0
      ? 0
      : Math.round(results.reduce((sum, result) => sum + result.latencyMs, 0) / results.length),
    latencyP50Ms: percentile(0.5),
    latencyP95Ms: percentile(0.95),
    averageConversationChars: results.length === 0
      ? 0
      : Math.round(results.reduce(
        (sum, result) => sum + (
          measuredContextNumber(result, "conversationChars")
          ?? result.maxConversationChars
        ),
        0,
      ) / results.length),
    rowCountChanges: results.filter((result) => result.rowCountChanged).length,
  };
}

function numericDelta(
  current: number | null | undefined,
  baseline: number | null | undefined,
): number | null {
  return typeof current === "number" && typeof baseline === "number"
    ? current - baseline
    : null;
}

function printComparison(
  current: ReturnType<typeof summarize>,
  baseline: ReturnType<typeof summarize> | undefined,
): void {
  console.log(JSON.stringify({
    before: baseline ?? null,
    after: current,
    delta: baseline ? {
      intentAccuracyPercent: current.intentAccuracyPercent === null || baseline.intentAccuracyPercent === null
        ? null
        : current.intentAccuracyPercent - baseline.intentAccuracyPercent,
      toolSelectionAccuracyPercent: current.toolSelectionAccuracyPercent === null
        || baseline.toolSelectionAccuracyPercent === null
        ? null
        : current.toolSelectionAccuracyPercent - baseline.toolSelectionAccuracyPercent,
      clarificationAccuracyPercent: current.clarificationAccuracyPercent === null
        || baseline.clarificationAccuracyPercent === null
        ? null
        : current.clarificationAccuracyPercent - baseline.clarificationAccuracyPercent,
      totalLogicalLlmCalls: numericDelta(current.totalLogicalLlmCalls, baseline.totalLogicalLlmCalls),
      totalHttpAttempts: numericDelta(current.totalHttpAttempts, baseline.totalHttpAttempts),
      totalInputTokens: numericDelta(current.totalInputTokens, baseline.totalInputTokens),
      totalOutputTokens: numericDelta(current.totalOutputTokens, baseline.totalOutputTokens),
      totalTokens: numericDelta(current.totalTokens, baseline.totalTokens),
      totalCachedTokens: numericDelta(current.totalCachedTokens, baseline.totalCachedTokens),
      totalRequestBytes: numericDelta(current.totalRequestBytes, baseline.totalRequestBytes),
      averageLatencyMs: numericDelta(current.averageLatencyMs, baseline.averageLatencyMs),
      latencyP50Ms: numericDelta(current.latencyP50Ms, baseline.latencyP50Ms),
      latencyP95Ms: numericDelta(current.latencyP95Ms, baseline.latencyP95Ms),
      averageConversationChars: numericDelta(
        current.averageConversationChars,
        baseline.averageConversationChars,
      ),
    } : null,
  }, null, 2));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (hasArg(args, "--help") || !hasArg(args, "--confirm-live")) {
    usage();
    if (!hasArg(args, "--confirm-live")) {
      console.error("No provider call was made. Add --confirm-live only when you intentionally want a real-provider run.");
    }
    process.exitCode = hasArg(args, "--help") ? 0 : 2;
    return;
  }

  const mode = valueArg(args, "--provider");
  if (!mode || !["groq", "gemini", "failover"].includes(mode)) {
    throw new Error("--provider must be groq, gemini, or failover.");
  }
  if (mode === "groq" && !process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not configured.");
  if (mode === "gemini" && !process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured.");
  if (mode === "failover" && (!process.env.GROQ_API_KEY || !process.env.GEMINI_API_KEY)) {
    throw new Error("Failover mode requires both configured provider integrations.");
  }

  const datasetPath = resolve(valueArg(args, "--dataset") ?? DEFAULT_DATASET);
  const dataset = JSON.parse(await readFile(datasetPath, "utf8")) as Dataset;
  let cases: EvaluationCase[];
  const selectedCaseIds = valueArg(args, "--case")?.split(",").map((value) => value.trim()).filter(Boolean);
  if (selectedCaseIds?.length) {
    cases = selectedCaseIds.map((id) => {
      const item = dataset.cases.find((candidate) => candidate.id === id);
      if (!item) throw new Error(`Unknown dataset case: ${id}`);
      return item;
    });
  } else if (hasArg(args, "--all")) {
    const maxCases = Number(valueArg(args, "--max-cases"));
    if (!Number.isInteger(maxCases) || maxCases < 1) {
      throw new Error("--all requires a positive --max-cases safety bound.");
    }
    cases = dataset.cases.slice(0, maxCases);
  } else {
    throw new Error("Choose --case ID[,ID] or --all --max-cases N.");
  }

  const results: CaseResult[] = [];
  for (const evaluationCase of cases) {
    console.log(`Running ${evaluationCase.id} (${mode}) in dry-run mode...`);
    const run = await runWorker(evaluationCase, mode, datasetPath);
    results.push(makeCaseResult(evaluationCase, mode, run));
  }

  const summary = summarize(results);
  const outputPath = resolve(valueArg(args, "--out")
    ?? join(dirname(DEFAULT_DATASET), "results", `${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
  await mkdir(dirname(outputPath), { recursive: true });

  let baselineSummary;
  const baselinePath = valueArg(args, "--baseline");
  if (baselinePath) {
    const baseline = JSON.parse(await readFile(resolve(baselinePath), "utf8")) as {
      summary?: ReturnType<typeof summarize>;
    };
    baselineSummary = baseline.summary;
  }

  const report = {
    datasetVersion: dataset.version,
    providerMode: mode,
    label: valueArg(args, "--label") ?? "after",
    dryRun: true,
    generatedAt: new Date().toISOString(),
    summary,
    comparison: baselineSummary ? {
      before: baselineSummary,
      after: summary,
    } : undefined,
    cases: results,
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Saved ${outputPath}`);
  printComparison(summary, baselineSummary);
}

await main();