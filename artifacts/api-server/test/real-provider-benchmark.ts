import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  activityEventEntitiesTable,
  activityEventsTable,
  agentWorkEvidenceTable,
  agentWorkEventsTable,
  agentWorkRunsTable,
  agentWorksTable,
  commitmentPeopleTable,
  commitmentsTable,
  conversationMemoryTable,
  db,
  notificationOutboxTable,
  peopleTable,
  reminderPeopleTable,
  remindersTable,
  secretaryOperationsTable,
  secondBrainCandidatesTable,
  secondBrainMemoriesTable,
  secondBrainMemoryHistoryTable,
  taskPeopleTable,
  tasksTable,
  triggerOutboxTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  CohereModelGateway,
  classifyToolScope,
  FailoverModelGateway,
  GeminiModelGateway,
  GroqModelGateway,
  normalizeProviderUsage,
  Phase2AgentRuntime,
  phase2Tools,
  type ConversationMessage,
  type GatewayCallContext,
  type GatewayResponse,
  type ModelGateway,
  type ProviderName,
} from "../src/lib/phase2.ts";
import { analyzeProviderInputPayload } from "./provider-input-audit.ts";
import { classifyBenchmarkRun } from "./provider-benchmark-classification.ts";
import type { Identity } from "../src/lib/secretary.ts";

type BenchmarkProvider = "groq" | "gemini" | "cohere";

type ProviderGeneration = {
  provider: BenchmarkProvider;
  callNumber: number;
  model: string;
  inputFingerprint: string;
  elapsedMs: number;
  outcome: "SUCCESS" | "FAIL";
  errorCode?: string;
  toolCalls: string[];
  finalResponseCallCount: number;
  finalResponseArgumentsParsed: boolean;
  finalResponseMessagePresent: boolean;
  finalResponseMessage: string | null;
  finalResponseGroundedFactsCount: number;
  usage: ReturnType<typeof normalizeProviderUsage>;
};

type HttpAttempt = {
  provider: BenchmarkProvider;
  callNumber: number | null;
  model: string | null;
  path: string;
  status: number | null;
  elapsedMs: number;
  errorName?: string;
};

export type ContextAssembly = {
  primaryEntity: { id: string; name: string | null } | null;
  evidence: {
    structuredRecords: Array<{
      temporalState: string;
      provenance: { recordId?: string };
      data: Record<string, unknown>;
    }>;
  };
};

type ProviderUsageBreakdown = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  toolUsePromptTokens: number | null;
  thinkingTokens: number | null;
  promptTokenDetails: Array<{ modality: string; tokens: number }>;
};

type ProviderResponseUsageAudit = {
  provider: "groq" | "gemini";
  callNumber: number | null;
  status: number;
  usage: ProviderUsageBreakdown | null;
};

const providers: Array<{
  name: BenchmarkProvider;
  apiKeyName: string;
  createGateway: () => ModelGateway;
}> = [
  { name: "groq", apiKeyName: "GROQ_API_KEY", createGateway: () => new GroqModelGateway() },
  { name: "gemini", apiKeyName: "GEMINI_API_KEY", createGateway: () => new GeminiModelGateway() },
  { name: "cohere", apiKeyName: "COHERE_API_KEY", createGateway: () => new CohereModelGateway() },
];

const mutationTables = {
  people: peopleTable,
  conversationMemory: conversationMemoryTable,
  secondBrainMemories: secondBrainMemoriesTable,
  secondBrainHistory: secondBrainMemoryHistoryTable,
  secondBrainCandidates: secondBrainCandidatesTable,
  commitments: commitmentsTable,
  commitmentPeople: commitmentPeopleTable,
  tasks: tasksTable,
  taskPeople: taskPeopleTable,
  reminders: remindersTable,
  reminderPeople: reminderPeopleTable,
  activities: activityEventsTable,
  activityEventEntities: activityEventEntitiesTable,
  agentWorks: agentWorksTable,
  agentWorkRuns: agentWorkRunsTable,
  agentWorkEvents: agentWorkEventsTable,
  agentWorkEvidence: agentWorkEvidenceTable,
  triggerOutbox: triggerOutboxTable,
  notificationOutbox: notificationOutboxTable,
  approvals: secretaryOperationsTable,
} as const;

const cleanupTables = [
  notificationOutboxTable,
  triggerOutboxTable,
  agentWorkEvidenceTable,
  agentWorkEventsTable,
  agentWorkRunsTable,
  agentWorksTable,
  secretaryOperationsTable,
  secondBrainCandidatesTable,
  secondBrainMemoryHistoryTable,
  secondBrainMemoriesTable,
  conversationMemoryTable,
  activityEventEntitiesTable,
  activityEventsTable,
  commitmentPeopleTable,
  taskPeopleTable,
  reminderPeopleTable,
  remindersTable,
  tasksTable,
  commitmentsTable,
  peopleTable,
] as const;

export const prompt = "أحمد كان المفروض يعمل إيه؟";
export const expectedFacts = ["تسليم التقرير", "إرسال العرض", "مراجعة التقرير"];

export function createIdentity(): Identity {
  return {
    tenantId: `real-provider-benchmark-${randomUUID()}`,
    userId: "real-provider-benchmark",
  };
}

function ownerScope(table: any, identity: Identity) {
  return and(
    eq(table.tenantId, identity.tenantId),
    eq(table.ownerUserId, identity.userId),
  );
}

export async function mutationSnapshot(identity: Identity): Promise<Record<string, number>> {
  const entries = Object.entries(mutationTables);
  const counts = await Promise.all(entries.map(async ([, table]) => {
    const scopedTable = table as any;
    const rows = await db.select({ id: scopedTable.id })
      .from(scopedTable)
      .where(ownerScope(scopedTable, identity));
    return rows.length;
  }));
  return Object.fromEntries(entries.map(([name], index) => [name, counts[index]]));
}

export async function cleanupIdentity(identity: Identity): Promise<void> {
  for (const table of cleanupTables) {
    const scopedTable = table as any;
    await db.delete(scopedTable).where(ownerScope(scopedTable, identity));
  }
}

export function stableRequestSerialization(
  messages: ConversationMessage[],
  context: GatewayCallContext,
): string {
  return JSON.stringify({
    messages,
    context: {
      conversationId: context.conversationId ?? null,
      callNumber: context.callNumber,
      toolCallsExecuted: context.toolCallsExecuted,
      toolScope: context.toolScope
        ? {
            name: context.toolScope.name,
            allowedToolNames: [...context.toolScope.allowedToolNames].sort(),
            isFull: context.toolScope.isFull,
          }
        : null,
      finalResponseOnly: context.finalResponseOnly ?? false,
      currentUserMessage: context.currentUserMessage ?? null,
    },
  });
}

export function contextAssemblyFrom(messages: ConversationMessage[]): ContextAssembly | null {
  const message = messages.find((item) => item.text?.startsWith("[Context Assembly v1"));
  if (!message?.text) return null;
  const separator = message.text.indexOf("\n");
  if (separator < 0) return null;
  return JSON.parse(message.text.slice(separator + 1)) as ContextAssembly;
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  if (error instanceof Error) return error.name;
  return "UNKNOWN_ERROR";
}

function providerForHost(host: string): BenchmarkProvider | null {
  if (host === "api.groq.com") return "groq";
  if (host === "generativelanguage.googleapis.com") return "gemini";
  if (host === "api.cohere.com") return "cohere";
  return null;
}

function modelFromRequest(url: URL, init?: RequestInit): string | null {
  const bodyText = typeof init?.body === "string" ? init.body : "";
  if (bodyText) {
    try {
      const body = JSON.parse(bodyText) as { model?: unknown };
      if (typeof body.model === "string") return body.model;
    } catch {
      // Provider-specific URL parsing below still identifies Gemini's model.
    }
  }
  const match = url.pathname.match(/\/models\/([^/:]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function normalizeArabic(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numericField(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function providerUsageBreakdown(provider: "groq" | "gemini", responseText: string): ProviderUsageBreakdown | null {
  try {
    const root = objectRecord(JSON.parse(responseText));
    const usage = objectRecord(provider === "groq" ? root.usage : root.usageMetadata);
    if (Object.keys(usage).length === 0) return null;

    const promptDetails = provider === "groq"
      ? objectRecord(usage.prompt_tokens_details)
      : {};
    const modalityDetails = provider === "gemini" && Array.isArray(usage.promptTokensDetails)
      ? usage.promptTokensDetails
      : [];

    return provider === "groq"
      ? {
          inputTokens: numericField(usage, "prompt_tokens"),
          outputTokens: numericField(usage, "completion_tokens"),
          totalTokens: numericField(usage, "total_tokens"),
          cachedInputTokens: numericField(promptDetails, "cached_tokens"),
          toolUsePromptTokens: null,
          thinkingTokens: numericField(objectRecord(usage.completion_tokens_details), "reasoning_tokens"),
          promptTokenDetails: Object.entries(promptDetails)
            .filter((entry): entry is [string, number] =>
              typeof entry[1] === "number" && Number.isFinite(entry[1]))
            .map(([modality, tokens]) => ({ modality, tokens })),
        }
      : {
          inputTokens: numericField(usage, "promptTokenCount"),
          outputTokens: numericField(usage, "candidatesTokenCount"),
          totalTokens: numericField(usage, "totalTokenCount"),
          cachedInputTokens: numericField(usage, "cachedContentTokenCount"),
          toolUsePromptTokens: numericField(usage, "toolUsePromptTokenCount"),
          thinkingTokens: numericField(usage, "thoughtsTokenCount"),
          promptTokenDetails: modalityDetails.flatMap((entry) => {
            const detail = objectRecord(entry);
            const modality = detail.modality;
            const tokens = detail.tokenCount;
            return typeof modality === "string"
              && typeof tokens === "number"
              && Number.isFinite(tokens)
              ? [{ modality, tokens }]
              : [];
          }),
        };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (process.env.RUN_REAL_PROVIDER_BENCHMARK !== "1") {
    throw new Error("Live calls disabled. Set RUN_REAL_PROVIDER_BENCHMARK=1 to run the benchmark.");
  }

  const tokenInputAuditMode = process.env.RUN_REAL_PROVIDER_TOKEN_INPUT_AUDIT === "1";
  const activeProviders = tokenInputAuditMode
    ? providers.filter((provider) => provider.name === "groq" || provider.name === "gemini")
    : providers;
  if (
    tokenInputAuditMode
    && (
      activeProviders.length !== 2
      || activeProviders.some((provider) => provider.name === "cohere")
    )
  ) {
    throw new Error("Token input audit is restricted to Groq and Gemini.");
  }

  const missing = activeProviders
    .filter((provider) => !process.env[provider.apiKeyName])
    .map((provider) => provider.name);
  if (missing.length > 0) {
    throw new Error(`Live benchmark stopped before sending requests; missing configured providers: ${missing.join(", ")}`);
  }

  const scope = classifyToolScope(prompt);
  if (scope.name !== "read_only" || scope.isFull) {
    throw new Error(`Live benchmark stopped before sending requests; prompt scope is ${scope.name}, not read_only.`);
  }

  const identity = createIdentity();
  const conversationId = `real-provider-benchmark-${randomUUID()}`;
  const originalFetch = globalThis.fetch;
  const generations: ProviderGeneration[] = [];
  const httpAttempts: HttpAttempt[] = [];
  const inputPayloadAudits: Array<Record<string, unknown>> = [];
  const responseUsageAudits: ProviderResponseUsageAudit[] = [];
  const responseUsageAuditPromises: Promise<void>[] = [];
  const results: Array<Record<string, unknown>> = [];
  const fingerprintsByProvider: Partial<Record<BenchmarkProvider, string>> = {};
  let referenceSerialization: string | undefined;
  let activeGeneration: { provider: BenchmarkProvider; callNumber: number } | null = null;

  const baselineCounts = await mutationSnapshot(identity);
  const baselineWasEmpty = Object.values(baselineCounts).every((count) => count === 0);
  if (!baselineWasEmpty) {
    throw new Error("Unique benchmark tenant was not empty; no provider requests were sent.");
  }

  try {
    await seedFixture(identity);
    const beforeRuns = await mutationSnapshot(identity);

    globalThis.fetch = async (input, init) => {
      const requestUrl = input instanceof URL
        ? input
        : input instanceof Request
          ? new URL(input.url)
          : new URL(String(input));
      const provider = providerForHost(requestUrl.hostname);
      if (!provider) {
        throw new Error(`Benchmark blocked an unexpected external host: ${requestUrl.hostname}`);
      }
      if (tokenInputAuditMode && provider === "cohere") {
        throw new Error("Token input audit blocked Cohere before sending a request.");
      }
      const requestBody = typeof init?.body === "string" ? init.body : "";
      if (tokenInputAuditMode && (provider === "groq" || provider === "gemini")) {
        if (!requestBody) {
          throw new Error(`${provider} input audit could not inspect a JSON request body.`);
        }
        inputPayloadAudits.push(analyzeProviderInputPayload(
          provider,
          requestUrl.pathname,
          requestBody,
          prompt,
          phase2Tools.length,
          scope.allowedToolNames.size,
        ));
      }
      const startedAt = performance.now();
      try {
        const response = await originalFetch(input, init);
        httpAttempts.push({
          provider,
          callNumber: activeGeneration?.provider === provider ? activeGeneration.callNumber : null,
          model: modelFromRequest(requestUrl, init),
          path: requestUrl.pathname,
          status: response.status,
          elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
        });
        if (tokenInputAuditMode && (provider === "groq" || provider === "gemini")) {
          const usageAudit: ProviderResponseUsageAudit = {
            provider,
            callNumber: activeGeneration?.provider === provider ? activeGeneration.callNumber : null,
            status: response.status,
            usage: null,
          };
          responseUsageAudits.push(usageAudit);
          responseUsageAuditPromises.push(
            response.clone().text()
              .then((text) => {
                usageAudit.usage = providerUsageBreakdown(provider, text);
              })
              .catch(() => undefined),
          );
        }
        return response;
      } catch (error) {
        httpAttempts.push({
          provider,
          callNumber: activeGeneration?.provider === provider ? activeGeneration.callNumber : null,
          model: modelFromRequest(requestUrl, init),
          path: requestUrl.pathname,
          status: null,
          elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
          errorName: error instanceof Error ? error.name : "UNKNOWN_ERROR",
        });
        throw error;
      }
    };

    for (const providerConfig of activeProviders) {
      const inner = providerConfig.createGateway();
      let contextMismatch: string | undefined;
      const observedGateway: ModelGateway = {
        provider: inner.provider,
        get modelName() {
          return inner.modelName;
        },
        async generate(messages, context): Promise<GatewayResponse> {
          const serialized = stableRequestSerialization(messages, context);
          const fingerprint = createHash("sha256").update(serialized).digest("hex");
          if (context.callNumber === 1) {
            fingerprintsByProvider[providerConfig.name] = fingerprint;
            if (referenceSerialization === undefined) {
              referenceSerialization = serialized;
              const assembly = contextAssemblyFrom(messages);
              if (!assembly) {
                contextMismatch = "Context Assembly was missing before the first provider call.";
                throw new Error("Benchmark stopped: Context Assembly was missing.");
              }
              const fixtureIds = expectedFixtureIds;
              const includedIds = new Set(
                assembly.evidence.structuredRecords.map((record) => record.provenance.recordId),
              );
              if (
                assembly.primaryEntity?.name !== "أحمد"
                || fixtureIds.some((id) => !includedIds.has(id))
              ) {
                contextMismatch = "The assembled context did not contain the expected synthetic records.";
                throw new Error("Benchmark stopped: expected synthetic context was not assembled.");
              }
            } else if (serialized !== referenceSerialization) {
              contextMismatch = "Provider-independent request differed from the benchmark baseline.";
              throw new Error("Benchmark stopped before sending this provider request: context drift.");
            }
          }

          const generation: ProviderGeneration = {
            provider: providerConfig.name,
            callNumber: context.callNumber,
            model: inner.modelName,
            inputFingerprint: fingerprint,
            elapsedMs: 0,
            outcome: "FAIL",
            toolCalls: [],
            finalResponseCallCount: 0,
            finalResponseArgumentsParsed: false,
            finalResponseMessagePresent: false,
            finalResponseMessage: null,
            finalResponseGroundedFactsCount: 0,
            usage: normalizeProviderUsage(providerConfig.name, undefined),
          };
          generations.push(generation);
          const startedAt = performance.now();
          activeGeneration = { provider: providerConfig.name, callNumber: context.callNumber };
          try {
            // Omitting gateway metrics avoids Gemini's separate cachedContents
            // setup request; the original messages and tool scope stay intact.
            const response = await inner.generate(messages, { ...context, metrics: undefined });
            generation.outcome = "SUCCESS";
            generation.toolCalls = response.toolCalls.map((call) => call.name);
            const finalResponseCalls = response.toolCalls.filter((call) => call.name === "final_response");
            const finalResponseArgs = finalResponseCalls[0]?.args;
            const finalResponseArgsAreParsed = !!finalResponseArgs
              && typeof finalResponseArgs === "object"
              && !Array.isArray(finalResponseArgs);
            generation.finalResponseCallCount = finalResponseCalls.length;
            generation.finalResponseArgumentsParsed = finalResponseArgsAreParsed;
            generation.finalResponseMessagePresent = finalResponseArgsAreParsed
              && typeof finalResponseArgs.message === "string"
              && finalResponseArgs.message.trim().length > 0;
            generation.finalResponseMessage = generation.finalResponseMessagePresent
              ? (finalResponseArgs.message as string).trim()
              : null;
            generation.finalResponseGroundedFactsCount = finalResponseArgsAreParsed
              && Array.isArray(finalResponseArgs.groundedFacts)
              ? finalResponseArgs.groundedFacts.length
              : 0;
            generation.usage = normalizeProviderUsage(providerConfig.name, response.usage);
            return response;
          } catch (error) {
            generation.errorCode = errorCode(error);
            throw error;
          } finally {
            generation.elapsedMs = Math.round((performance.now() - startedAt) * 10) / 10;
            activeGeneration = null;
          }
        },
      };

      const requestId = `real-provider-${providerConfig.name}-${randomUUID()}`;
      const totalStartedAt = performance.now();
      let result: Awaited<ReturnType<Phase2AgentRuntime["run"]>> | undefined;
      let runError: string | undefined;
      try {
        result = await new Phase2AgentRuntime(
          new FailoverModelGateway(
            { [providerConfig.name]: observedGateway },
            [providerConfig.name],
          ),
        ).run(identity, {
          message: prompt,
          conversationId,
          requestId,
        }, { dryRun: true });
      } catch (error) {
        runError = errorCode(error);
      }
      if (tokenInputAuditMode) {
        await Promise.all(responseUsageAuditPromises);
      }

      if (contextMismatch) {
        throw new Error(`${providerConfig.name}: ${contextMismatch}`);
      }

      const providerGenerations = generations.filter((item) => item.provider === providerConfig.name);
      const providerHttp = httpAttempts.filter((item) => item.provider === providerConfig.name);
      const finalMessage = result?.response?.message ?? result?.assistantMessage ?? null;
      const normalizedAnswer = normalizeArabic(finalMessage ?? "");
      const factCoverage = expectedFacts.map((fact) => ({
        fact,
        literalMatch: normalizedAnswer.includes(normalizeArabic(fact)),
      }));
      const domainTools = [...new Set(providerGenerations.flatMap((item) => item.toolCalls)
        .filter((toolName) => toolName !== "final_response"))];
      const finalResponseCallCount = providerGenerations.reduce(
        (count, item) => count + item.finalResponseCallCount,
        0,
      );
      const finalResponseCapture = [...providerGenerations]
        .reverse()
        .find((item) => item.finalResponseCallCount > 0);
      const providerFinalResponseMessage = finalResponseCapture?.finalResponseMessage ?? null;
      const providerFactCoverage = expectedFacts.map((fact) => ({
        fact,
        literalMatch: normalizeArabic(providerFinalResponseMessage ?? "")
          .includes(normalizeArabic(fact)),
      }));
      const nonFinalToolCallCount = providerGenerations.reduce(
        (count, item) => count + item.toolCalls.filter((toolName) => toolName !== "final_response").length,
        0,
      );
      const classification = classifyBenchmarkRun({
        httpStatuses: providerHttp.map((attempt) => attempt.status),
        generationOutcomes: providerGenerations.map((generation) => generation.outcome),
        finalResponseCallCount,
        finalResponseArgumentsParsed: finalResponseCapture?.finalResponseArgumentsParsed ?? false,
        finalResponseMessagePresent: finalResponseCapture?.finalResponseMessagePresent ?? false,
        providerFinalResponseMessagePresent: providerFinalResponseMessage !== null,
        finalResponseGroundedFactsCount: finalResponseCapture?.finalResponseGroundedFactsCount ?? 0,
        nonFinalToolCallCount,
        runtimeResponseKind: result?.response?.kind ?? null,
        providerLiteralFactCoverage: providerFactCoverage.map((item) => item.literalMatch),
        literalFactCoverage: factCoverage.map((item) => item.literalMatch),
      });
      const attemptsPerLogicalCall = providerGenerations.map((generation) => ({
        callNumber: generation.callNumber,
        networkAttempts: providerHttp.filter((attempt) => attempt.callNumber === generation.callNumber).length,
        models: providerHttp
          .filter((attempt) => attempt.callNumber === generation.callNumber)
          .map((attempt) => attempt.model)
          .filter((model): model is string => model !== null),
      }));

      results.push({
        provider: providerConfig.name,
        configuredModel: inner.modelName,
        outcome: result?.response?.kind ?? (runError ? "FAILED" : "NO_FINAL_RESPONSE"),
        classification,
        runtimeResponseKind: result?.response?.kind ?? null,
        finalResponseCapture: {
          callCount: finalResponseCallCount,
          argumentsParsed: finalResponseCapture?.finalResponseArgumentsParsed ?? false,
          messagePresent: finalResponseCapture?.finalResponseMessagePresent ?? false,
          groundedFactsCount: finalResponseCapture?.finalResponseGroundedFactsCount ?? 0,
          nonFinalToolCallCount,
        },
        runError,
        totalElapsedMs: Math.round((performance.now() - totalStartedAt) * 10) / 10,
        providerGenerations: providerGenerations.map((generation) => ({
          callNumber: generation.callNumber,
          model: generation.model,
          elapsedMs: generation.elapsedMs,
          outcome: generation.outcome,
          errorCode: generation.errorCode,
          toolCalls: generation.toolCalls,
          usage: generation.usage,
        })),
        httpAttempts: providerHttp,
        attemptsPerLogicalCall,
        retryOrModelFallbackObserved: attemptsPerLogicalCall.some((call) => call.networkAttempts > 1),
        domainToolsUsed: domainTools,
        response: finalMessage,
        providerFinalResponseMessage,
        providerLiteralFactCoverage: providerFactCoverage,
        literalFactCoverage: factCoverage,
        providerTrace: result?.action?.providerTrace,
        contextFingerprint: fingerprintsByProvider[providerConfig.name],
      });

      const afterProvider = await mutationSnapshot(identity);
      if (JSON.stringify(afterProvider) !== JSON.stringify(beforeRuns)) {
        throw new Error(`${providerConfig.name}: benchmark detected a database mutation; later providers were not called.`);
      }
    }

    const afterRuns = await mutationSnapshot(identity);
    if (JSON.stringify(afterRuns) !== JSON.stringify(beforeRuns)) {
      throw new Error("Benchmark detected a database mutation.");
    }

    console.log("REAL_PROVIDER_BENCHMARK", JSON.stringify({
      prompt,
      contextFingerprint: fingerprintsByProvider.groq,
      allInitialContextsIdentical: new Set(Object.values(fingerprintsByProvider)).size === 1
        && Object.keys(fingerprintsByProvider).length === activeProviders.length,
      activeProviders: activeProviders.map((provider) => provider.name),
      contextRecords: ["commitment", "task", "reminder"],
      retries: "Network calls were observed, not simulated; a second request in the same logical call is reported as retry/model fallback.",
      cost: "No monetary charge was returned by these model response adapters; report N/A unless a provider rate card is separately applied.",
      results,
      ...(tokenInputAuditMode
        ? {
            tokenInputAudit: {
              providerPayloads: inputPayloadAudits,
              providerResponseUsage: responseUsageAudits,
              fullToolCatalogCount: phase2Tools.length,
              scopedToolCount: scope.allowedToolNames.size,
              tokenizerAvailability: "No model-specific tokenizer is installed locally; provider usage gives aggregate input tokens only. Per-component token counts are not measured.",
            },
          }
        : {}),
      databaseCountsBefore: beforeRuns,
      databaseCountsAfter: afterRuns,
      openRouterRequests: httpAttempts.filter((attempt) => attempt.provider as string === "openrouter").length,
    }));
  } finally {
    globalThis.fetch = originalFetch;
    await cleanupIdentity(identity);
  }

  const afterCleanup = await mutationSnapshot(identity);
  if (JSON.stringify(afterCleanup) !== JSON.stringify(baselineCounts)) {
    throw new Error("Benchmark fixture cleanup did not restore the unique tenant to its baseline.");
  }
}

export let expectedFixtureIds: string[] = [];

export async function seedFixture(identity: Identity): Promise<void> {
  const [ahmad] = await db.insert(peopleTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    name: "أحمد",
    nameKey: "احمد",
  }).returning();
  if (!ahmad) throw new Error("Could not create the synthetic person fixture.");

  const dueAt = new Date("2026-09-25T09:00:00.000Z");
  const [commitment] = await db.insert(commitmentsTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    title: "تسليم التقرير",
    personId: ahmad.id,
    dueAt,
    status: "open",
  }).returning();
  if (!commitment) throw new Error("Could not create the synthetic commitment fixture.");
  await db.insert(commitmentPeopleTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    commitmentId: commitment.id,
    personId: ahmad.id,
    relationship: "responsible",
  });

  const [task] = await db.insert(tasksTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    title: "إرسال العرض",
    dueAt,
    status: "pending",
  }).returning();
  if (!task) throw new Error("Could not create the synthetic task fixture.");
  await db.insert(taskPeopleTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    taskId: task.id,
    personId: ahmad.id,
    relationship: "assignee",
  });

  const [reminder] = await db.insert(remindersTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    text: "مراجعة التقرير",
    dueAt,
    timezone: "Africa/Cairo",
    status: "scheduled",
  }).returning();
  if (!reminder) throw new Error("Could not create the synthetic reminder fixture.");
  await db.insert(reminderPeopleTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    reminderId: reminder.id,
    personId: ahmad.id,
    relationship: "about",
  });

  expectedFixtureIds = [commitment.id, task.id, reminder.id];
}

const invokedEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedEntry === import.meta.url) {
  main().catch((error: unknown) => {
    console.error("REAL_PROVIDER_BENCHMARK_FAILED", errorCode(error));
    process.exitCode = 1;
  });
}