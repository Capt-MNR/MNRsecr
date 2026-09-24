type JsonRecord = Record<string, unknown>;
export type InputAuditProvider = "groq" | "gemini";

export type SizeStats = {
  characters: number;
  bytes: number;
  items: number;
};

type MessageCategory =
  | "userMessages"
  | "conversationHistory"
  | "contextAssemblyEvidence"
  | "applicationContext"
  | "otherMessages";

const MESSAGE_CATEGORIES: MessageCategory[] = [
  "userMessages",
  "conversationHistory",
  "contextAssemblyEvidence",
  "applicationContext",
  "otherMessages",
];

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function serialized(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

function sizeOfText(value: string, items = 1): SizeStats {
  return {
    characters: Array.from(value).length,
    bytes: Buffer.byteLength(value, "utf8"),
    items,
  };
}

function sizeOfJson(value: unknown, items = 1): SizeStats {
  return sizeOfText(serialized(value), items);
}

function sizeOfTextValues(values: string[]): SizeStats {
  return values.reduce<SizeStats>((total, value) => {
    const current = sizeOfText(value, 0);
    return {
      characters: total.characters + current.characters,
      bytes: total.bytes + current.bytes,
      items: total.items + 1,
    };
  }, { characters: 0, bytes: 0, items: 0 });
}

function sizeOfJsonNodes(values: unknown[]): SizeStats {
  return values.reduce<SizeStats>((total, value) => {
    const current = sizeOfJson(value, 0);
    return {
      characters: total.characters + current.characters,
      bytes: total.bytes + current.bytes,
      items: total.items + 1,
    };
  }, { characters: 0, bytes: 0, items: 0 });
}

function difference(total: SizeStats, parts: SizeStats[]): SizeStats {
  return {
    characters: total.characters - parts.reduce((sum, item) => sum + item.characters, 0),
    bytes: total.bytes - parts.reduce((sum, item) => sum + item.bytes, 0),
    items: 0,
  };
}

function textParts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((part) => {
    const text = objectValue(part).text;
    return typeof text === "string" ? [text] : [];
  });
}

function classifyMessage(text: string, prompt: string): MessageCategory {
  const appContextPrefix = "[سياق موثوق من التطبيق]\n";
  const classificationText = text.startsWith(appContextPrefix)
    ? text.slice(appContextPrefix.length)
    : text;

  if (classificationText.trim() === prompt) return "userMessages";
  if (classificationText.startsWith("[Context Assembly v1")) return "contextAssemblyEvidence";
  if (
    classificationText.startsWith("[ملخص محادثة سابق")
    || classificationText.startsWith("[حالة المحادثة المنظمة")
    || classificationText.includes("[نتيجة التنفيذ:")
  ) {
    return "conversationHistory";
  }
  if (
    classificationText.startsWith("[خطة الاسترجاع المحددة حتميًا]")
    || classificationText.startsWith("[سياق سكرتير محدود]")
    || classificationText.startsWith("[بيانات قناة سكرتير مستقبلية]")
    || classificationText.startsWith("[قناة السكرتير:")
    || classificationText.startsWith("[قرار Brain v1 transient")
  ) {
    return "applicationContext";
  }
  return "otherMessages";
}

function analyzeContextAssembly(text: string): JsonRecord | null {
  const separator = text.indexOf("\n");
  if (separator < 0) return null;

  const header = text.slice(0, separator + 1);
  const assemblyJsonText = text.slice(separator + 1);
  let assembly: JsonRecord;
  try {
    assembly = objectValue(JSON.parse(assemblyJsonText));
  } catch {
    return null;
  }

  const evidence = objectValue(assembly.evidence);
  const structuredRecords = Array.isArray(evidence.structuredRecords)
    ? evidence.structuredRecords
    : [];
  const relationships = Array.isArray(evidence.relationships) ? evidence.relationships : [];
  const activity = Array.isArray(evidence.activity) ? evidence.activity : [];
  const memories = Array.isArray(evidence.memories) ? evidence.memories : [];
  const resolvedEntities = Array.isArray(assembly.resolvedEntities) ? assembly.resolvedEntities : [];
  const conversationReferences = Array.isArray(assembly.conversationReferences)
    ? assembly.conversationReferences
    : [];
  const responseStylePreferences = Array.isArray(assembly.responseStylePreferences)
    ? assembly.responseStylePreferences
    : [];
  const primaryEntity = assembly.primaryEntity ?? null;

  const recordsByType = new Map<string, unknown[]>();
  const temporalStateCounts: Record<string, number> = {};
  for (const record of [...structuredRecords, ...relationships, ...activity, ...memories]) {
    const recordObject = objectValue(record);
    const state = typeof recordObject.temporalState === "string"
      ? recordObject.temporalState
      : "unknown";
    temporalStateCounts[state] = (temporalStateCounts[state] ?? 0) + 1;
  }
  for (const record of structuredRecords) {
    const data = objectValue(objectValue(record).data);
    const type = typeof data.type === "string" ? data.type : "other";
    const group = recordsByType.get(type) ?? [];
    group.push(record);
    recordsByType.set(type, group);
  }

  const secondBrainSourcedEntities = resolvedEntities.filter((entity) =>
    objectValue(entity).source === "second_brain");
  const primaryEntityIsSecondBrain = objectValue(primaryEntity).source === "second_brain";
  const omittedTopLevelFields = new Set([
    "version",
    "selection",
    "temporalMode",
    "responseStylePreferences",
    "resolvedEntities",
    "primaryEntity",
    "conversationReferences",
    "evidence",
    "unresolvedConflicts",
    "uncertainties",
    "truncated",
  ]);
  const otherTopLevelFields = Object.fromEntries(
    Object.entries(assembly).filter(([key]) => !omittedTopLevelFields.has(key)),
  );

  const assemblyFields = {
    primaryEntity: sizeOfJson(primaryEntity),
    resolvedEntities: sizeOfJson(resolvedEntities, resolvedEntities.length),
    conversationReferences: sizeOfJson(conversationReferences, conversationReferences.length),
    structuredRecords: sizeOfJson(structuredRecords, structuredRecords.length),
    relationships: sizeOfJson(relationships, relationships.length),
    activity: sizeOfJson(activity, activity.length),
    memories: sizeOfJson(memories, memories.length),
    responseStylePreferences: sizeOfJson(
      responseStylePreferences,
      responseStylePreferences.length,
    ),
    unresolvedConflicts: sizeOfJson(
      assembly.unresolvedConflicts ?? [],
      Array.isArray(assembly.unresolvedConflicts) ? assembly.unresolvedConflicts.length : 0,
    ),
    uncertainties: sizeOfJson(
      assembly.uncertainties ?? [],
      Array.isArray(assembly.uncertainties) ? assembly.uncertainties.length : 0,
    ),
    otherTopLevelFields: sizeOfJson(otherTopLevelFields, Object.keys(otherTopLevelFields).length),
  };

  const structuredRecordBreakdown = [...recordsByType.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, records]) => ({
      type,
      count: records.length,
      recordJson: sizeOfJsonNodes(records),
      dataJson: sizeOfJsonNodes(records.map((record) => objectValue(record).data)),
      temporalStates: records.reduce<Record<string, number>>((counts, record) => {
        const state = objectValue(record).temporalState;
        const key = typeof state === "string" ? state : "unknown";
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {}),
    }));

  return {
    messageText: sizeOfText(text),
    header: sizeOfText(header),
    serializedJsonText: sizeOfText(assemblyJsonText),
    assemblyObject: sizeOfJson(assembly),
    primaryEntityKind: objectValue(primaryEntity).type ?? null,
    primaryEntitySource: objectValue(primaryEntity).source ?? null,
    primaryEntityNamePresent: typeof objectValue(primaryEntity).name === "string",
    resolvedEntityCount: resolvedEntities.length,
    conversationReferenceCount: conversationReferences.length,
    fields: assemblyFields,
    structuredRecordBreakdown,
    relationshipEvidenceCount: relationships.length,
    activityEvidenceCount: activity.length,
    secondBrain: {
      memoryEvidenceCount: memories.length,
      memoryEvidenceJson: assemblyFields.memories,
      responseStylePreferenceCount: responseStylePreferences.length,
      responseStylePreferenceJson: assemblyFields.responseStylePreferences,
      resolvedEntitiesFromSecondBrain: secondBrainSourcedEntities.length,
      primaryEntityFromSecondBrain: primaryEntityIsSecondBrain,
    },
    temporal: {
      mode: assembly.temporalMode ?? null,
      stateCounts: temporalStateCounts,
      memoryStates: memories.reduce<Record<string, number>>((counts, memory) => {
        const state = objectValue(memory).temporalState;
        const key = typeof state === "string" ? state : "unknown";
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {}),
    },
  };
}

function analyzeMessageGroups(
  entries: Array<{ node: unknown; role: string; texts: string[] }>,
  prompt: string,
): JsonRecord {
  const groups = Object.fromEntries(MESSAGE_CATEGORIES.map((category) => [
    category,
    { nodes: [] as unknown[], texts: [] as string[], roles: {} as Record<string, number> },
  ])) as Record<MessageCategory, {
    nodes: unknown[];
    texts: string[];
    roles: Record<string, number>;
  }>;
  let trustedPrefixCount = 0;
  const trustedPrefix = "[سياق موثوق من التطبيق]\n";

  for (const entry of entries) {
    const combinedText = entry.texts.join("\n");
    const category = classifyMessage(combinedText, prompt);
    const group = groups[category];
    group.nodes.push(entry.node);
    group.texts.push(...entry.texts);
    group.roles[entry.role] = (group.roles[entry.role] ?? 0) + 1;
    trustedPrefixCount += entry.texts.filter((text) => text.startsWith(trustedPrefix)).length;
  }

  const groupStats = Object.fromEntries(MESSAGE_CATEGORIES.map((category) => {
    const group = groups[category];
    return [category, {
      messageCount: group.nodes.length,
      roles: group.roles,
      rawText: sizeOfTextValues(group.texts),
      serializedMessageNodes: sizeOfJsonNodes(group.nodes),
    }];
  }));
  const nodes = entries.map((entry) => entry.node);
  const arrayStats = sizeOfJson(nodes, nodes.length);
  const nodeStats = sizeOfJsonNodes(nodes);

  return {
    count: entries.length,
    roles: entries.reduce<Record<string, number>>((counts, entry) => {
      counts[entry.role] = (counts[entry.role] ?? 0) + 1;
      return counts;
    }, {}),
    serializedArray: arrayStats,
    arraySyntax: difference(arrayStats, [nodeStats]),
    groups: groupStats,
    geminiTrustedApplicationPrefixCount: trustedPrefixCount,
    geminiTrustedApplicationPrefixText: sizeOfText(
      trustedPrefix.repeat(trustedPrefixCount),
      trustedPrefixCount,
    ),
  };
}

export function analyzeProviderInputPayload(
  provider: InputAuditProvider,
  path: string,
  bodyText: string,
  prompt: string,
  fullToolCatalogCount: number,
  scopeAllowedToolCount: number,
): JsonRecord {
  let payload: JsonRecord;
  try {
    payload = objectValue(JSON.parse(bodyText));
  } catch {
    throw new Error(`${provider} request body was not valid JSON; audit stopped before sending it.`);
  }
  const reconstructedBody = serialized(payload);
  if (reconstructedBody !== bodyText) {
    throw new Error(`${provider} request body was not stable JSON; audit stopped before sending it.`);
  }

  let systemText = "";
  let systemNode: unknown = null;
  let messageNodes: unknown[] = [];
  let messageEntries: Array<{ node: unknown; role: string; texts: string[] }> = [];
  let toolField: unknown = [];
  let toolDefinitions: unknown[] = [];
  let excludedBodyFields: Set<string>;

  if (provider === "groq") {
    const allMessages = Array.isArray(payload.messages) ? payload.messages : [];
    const systemIndex = allMessages.findIndex((message) => objectValue(message).role === "system");
    if (systemIndex >= 0) {
      systemNode = allMessages[systemIndex];
      const content = objectValue(systemNode).content;
      systemText = typeof content === "string" ? content : "";
    }
    messageNodes = allMessages.filter((_, index) => index !== systemIndex);
    messageEntries = messageNodes.map((node) => {
      const message = objectValue(node);
      return {
        node,
        role: typeof message.role === "string" ? message.role : "unknown",
        texts: textParts(message.content),
      };
    });
    toolField = payload.tools ?? [];
    toolDefinitions = Array.isArray(toolField) ? toolField : [];
    excludedBodyFields = new Set(["messages", "tools"]);
  } else {
    const systemInstruction = objectValue(payload.systemInstruction);
    const systemParts = Array.isArray(systemInstruction.parts) ? systemInstruction.parts : [];
    systemText = systemParts
      .map((part) => objectValue(part).text)
      .filter((value): value is string => typeof value === "string")
      .join("\n");
    systemNode = payload.systemInstruction ?? null;

    const contents = Array.isArray(payload.contents) ? payload.contents : [];
    messageNodes = contents;
    messageEntries = contents.map((node) => {
      const content = objectValue(node);
      const parts = Array.isArray(content.parts) ? content.parts : [];
      return {
        node,
        role: typeof content.role === "string" ? content.role : "unknown",
        texts: parts.flatMap((part) => {
          const text = objectValue(part).text;
          return typeof text === "string" ? [text] : [];
        }),
      };
    });
    toolField = payload.tools ?? [];
    const toolGroups = Array.isArray(toolField) ? toolField : [];
    toolDefinitions = toolGroups.flatMap((group) => {
      const declarations = objectValue(group).functionDeclarations;
      return Array.isArray(declarations) ? declarations : [];
    });
    excludedBodyFields = new Set(["systemInstruction", "contents", "tools"]);
  }

  const metadataEntries = Object.entries(payload)
    .filter(([key]) => !excludedBodyFields.has(key));
  const metadataValues = metadataEntries.map(([, value]) => value);
  const toolNames = toolDefinitions.map((definition) => {
    const candidate = provider === "groq"
      ? objectValue(objectValue(definition).function).name
      : objectValue(definition).name;
    return typeof candidate === "string" ? candidate : "unknown";
  });
  const finalResponseDefinition = toolDefinitions.find((definition) =>
    (provider === "groq"
      ? objectValue(objectValue(definition).function).name
      : objectValue(definition).name) === "final_response");
  const finalResponseParameters = finalResponseDefinition
    ? provider === "groq"
      ? objectValue(objectValue(objectValue(finalResponseDefinition).function).parameters)
      : objectValue(objectValue(finalResponseDefinition).parameters)
    : null;
  const finalResponseDeclarationSize = finalResponseDefinition
    ? sizeOfJson(finalResponseDefinition)
    : sizeOfText("", 0);
  const finalResponseParametersSize = finalResponseParameters
    ? sizeOfJson(finalResponseParameters)
    : sizeOfText("", 0);
  const nonFinalDefinitions = toolDefinitions.filter((definition) =>
    (provider === "groq"
      ? objectValue(objectValue(definition).function).name
      : objectValue(definition).name) !== "final_response");
  const toolFieldSize = sizeOfJson(toolField);
  const declarationNodesSize = sizeOfJsonNodes(toolDefinitions);
  const topLevelValueSize = sizeOfJsonNodes(Object.values(payload));
  const bodySize = sizeOfText(bodyText);

  const contextAssemblyEntries = messageEntries.flatMap((entry) =>
    entry.texts
      .filter((text) => text.startsWith("[Context Assembly v1"))
      .map((text) => ({ text, node: entry.node })),
  );
  const contextAssembly = contextAssemblyEntries[0]
    ? analyzeContextAssembly(contextAssemblyEntries[0].text)
    : null;

  return {
    provider,
    path,
    body: {
      ...bodySize,
      reconstructedJsonMatchesExactBody: reconstructedBody === bodyText,
      topLevelFieldNames: Object.keys(payload),
      topLevelFieldValues: Object.fromEntries(Object.entries(payload).map(([key, value]) => [
        key,
        sizeOfJson(value),
      ])),
      rootJsonEnvelope: difference(bodySize, [topLevelValueSize]),
      providerMetadataFieldNames: metadataEntries.map(([key]) => key),
      providerMetadataValues: sizeOfJsonNodes(metadataValues),
    },
    systemInstructions: {
      placement: provider === "groq" ? "messages[].role=system" : "systemInstruction.parts[]",
      rawText: sizeOfText(systemText),
      serializedNode: sizeOfJson(systemNode),
    },
    messages: analyzeMessageGroups(messageEntries, prompt),
    contextAssembly: {
      messageCount: contextAssemblyEntries.length,
      messageNode: contextAssemblyEntries[0]
        ? sizeOfJson(contextAssemblyEntries[0].node)
        : sizeOfText("", 0),
      detail: contextAssembly,
    },
    tools: {
      fullToolCatalogCount,
      scopeAllowedToolCount,
      sentDefinitionCount: toolDefinitions.length,
      sentDefinitionNames: toolNames,
      toolField: toolFieldSize,
      declarationNodes: declarationNodesSize,
      wrapperAndArraySyntax: difference(toolFieldSize, [declarationNodesSize]),
      finalResponse: {
        declaration: finalResponseDeclarationSize,
        parameters: finalResponseParametersSize,
      },
      otherDeclarationNodes: sizeOfJsonNodes(nonFinalDefinitions),
    },
    accountingNote: "Nested message, assembly, and tool details overlap their containing top-level field sizes; top-level field values plus rootJsonEnvelope reconcile to the exact request body.",
  };
}