import assert from "node:assert/strict";
import test from "node:test";
import { analyzeProviderInputPayload } from "./provider-input-audit.ts";

const prompt = "أحمد كان المفروض يعمل إيه؟";
const contextAssembly = `[Context Assembly v1]\n${JSON.stringify({
  version: 1,
  selection: "deterministic_rules",
  temporalMode: "current",
  responseStylePreferences: [],
  resolvedEntities: [{
    id: "synthetic-person-id",
    name: "أحمد",
    type: "person",
    matchType: "exact",
    confidence: 1,
    source: "relationship_context",
  }],
  primaryEntity: {
    id: "synthetic-person-id",
    name: "أحمد",
    type: "person",
    matchType: "exact",
    confidence: 1,
    source: "relationship_context",
  },
  conversationReferences: [],
  evidence: {
    structuredRecords: [{
      source: "structured_record",
      confidence: 1,
      temporalState: "current",
      provenance: { recordId: "synthetic-task-id" },
      data: { type: "task", title: "إرسال العرض" },
    }],
    relationships: [],
    activity: [],
    memories: [],
  },
  unresolvedConflicts: [],
  uncertainties: [],
  truncated: false,
})}`;

const finalResponseOpenAi = {
  type: "function",
  function: {
    name: "final_response",
    description: "Finish the turn.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["answer", "clarification"] },
        message: { type: "string" },
      },
      required: ["kind", "message"],
    },
  },
};

const recallContextOpenAi = {
  type: "function",
  function: {
    name: "recall_context",
    description: "Read saved context.",
    parameters: { type: "object", properties: {} },
  },
};

test("Groq audit separates prompt, application context, Context Assembly, and tool schemas", () => {
  const payload = {
    model: "openai/gpt-oss-20b",
    messages: [
      { role: "system", content: "System instructions and request guidance." },
      { role: "user", content: "[خطة الاسترجاع المحددة حتميًا]\n{}" },
      { role: "user", content: contextAssembly },
      { role: "user", content: prompt },
    ],
    tools: [finalResponseOpenAi, recallContextOpenAi],
    tool_choice: "auto",
    reasoning_effort: "low",
    include_reasoning: false,
    temperature: 0.15,
    max_tokens: 2048,
  };
  const body = JSON.stringify(payload);
  const audit = analyzeProviderInputPayload("groq", "/chat/completions", body, prompt, 40, 10) as any;

  assert.equal(audit.body.reconstructedJsonMatchesExactBody, true);
  assert.equal(audit.systemInstructions.rawText.characters, Array.from(payload.messages[0].content).length);
  assert.equal(audit.messages.groups.applicationContext.messageCount, 1);
  assert.equal(audit.messages.groups.contextAssemblyEvidence.messageCount, 1);
  assert.equal(audit.messages.groups.userMessages.messageCount, 1);
  assert.equal(audit.contextAssembly.messageCount, 1);
  assert.equal(audit.contextAssembly.detail.structuredRecordBreakdown[0].type, "task");
  assert.equal(audit.tools.sentDefinitionCount, 2);
  assert.equal(audit.tools.finalResponse.declaration.items, 1);

  const fieldValueBytes = Object.values(audit.body.topLevelFieldValues as Record<string, { bytes: number }>)
    .reduce((sum, value) => sum + value.bytes, 0);
  assert.equal(fieldValueBytes + audit.body.rootJsonEnvelope.bytes, audit.body.bytes);
});

test("Gemini audit records its systemInstruction, trusted-context prefix, and function declarations", () => {
  const finalResponseGemini = {
    name: "final_response",
    description: "Finish the turn.",
    parameters: finalResponseOpenAi.function.parameters,
  };
  const recallContextGemini = {
    name: "recall_context",
    description: "Read saved context.",
    parameters: { type: "object", properties: {} },
  };
  const payload = {
    systemInstruction: { parts: [{ text: "System instructions and request guidance." }] },
    contents: [
      { role: "user", parts: [{ text: "[سياق موثوق من التطبيق]\n[قناة السكرتير: main]" }] },
      { role: "user", parts: [{ text: contextAssembly }] },
      { role: "user", parts: [{ text: prompt }] },
    ],
    tools: [{ functionDeclarations: [finalResponseGemini, recallContextGemini] }],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { temperature: 0.15, maxOutputTokens: 8192 },
  };
  const body = JSON.stringify(payload);
  const audit = analyzeProviderInputPayload("gemini", "/models/gemini-test:generateContent", body, prompt, 40, 10) as any;

  assert.equal(audit.body.reconstructedJsonMatchesExactBody, true);
  assert.equal(audit.systemInstructions.placement, "systemInstruction.parts[]");
  assert.equal(audit.messages.geminiTrustedApplicationPrefixCount, 1);
  assert.equal(audit.messages.groups.applicationContext.messageCount, 1);
  assert.equal(audit.messages.groups.contextAssemblyEvidence.messageCount, 1);
  assert.equal(audit.messages.groups.userMessages.messageCount, 1);
  assert.equal(audit.tools.sentDefinitionCount, 2);
  assert.equal(audit.tools.finalResponse.parameters.items, 1);

  const fieldValueBytes = Object.values(audit.body.topLevelFieldValues as Record<string, { bytes: number }>)
    .reduce((sum, value) => sum + value.bytes, 0);
  assert.equal(fieldValueBytes + audit.body.rootJsonEnvelope.bytes, audit.body.bytes);
});