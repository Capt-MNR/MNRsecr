import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  conversationMemoryTable,
  db,
  peopleTable,
  projectsTable,
  secondBrainCandidatesTable,
  secondBrainMemoriesTable,
} from "@workspace/db";
import {
  parseSecondBrainCandidate,
  parseSecondBrainCommand,
  createSecondBrainCandidate,
  applySecondBrainContextBudget,
  applySecondBrainPolicy,
  classifySecondBrainQuery,
  emptyRetrievalTrace,
  rememberSecondBrain,
  retrieveSecondBrain,
  searchSecondBrain,
  shouldSearchSecondBrain,
  associateSecondBrainCandidate,
  reviewSecondBrainCandidate,
  SecondBrainCandidateAssociationError,
  SecondBrainCandidateReviewError,
} from "../src/lib/second-brain.ts";
import type { SecondBrainMemory } from "@workspace/db";
import { Phase2AgentRuntime, type ModelGateway } from "../src/lib/phase2.ts";
import { resolveEntity } from "../src/lib/entity-resolver.ts";

const identity = {
  tenantId: `second-brain-${process.pid}-${Date.now()}`,
  userId: "second-brain-user",
};
const otherIdentity = {
  tenantId: `${identity.tenantId}-other`,
  userId: identity.userId,
};

function traceMemory(overrides: Partial<SecondBrainMemory> = {}): SecondBrainMemory {
  return {
    id: "trace-memory",
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    kind: "fact",
    key: "note:trace",
    value: "secret memory value that must not enter the trace",
    normalizedValue: "secret memory value that must not enter the trace",
    confidenceBps: 10000,
    status: "active",
    metadata: {
      source: "explicit_user_instruction",
      entityType: "person",
      entityId: "person-trace",
    },
    sourceConversationId: "source-conversation",
    sourceTurnId: "source-turn",
    createdAt: new Date("2026-09-22T00:00:00.000Z"),
    updatedAt: new Date("2026-09-22T00:00:00.000Z"),
    lastConfirmedAt: null,
    ...overrides,
  };
}

async function cleanup() {
  await db.delete(secondBrainCandidatesTable).where(and(
    eq(secondBrainCandidatesTable.tenantId, identity.tenantId),
    eq(secondBrainCandidatesTable.ownerUserId, identity.userId),
  ));
  await db.delete(secondBrainCandidatesTable).where(and(
    eq(secondBrainCandidatesTable.tenantId, otherIdentity.tenantId),
    eq(secondBrainCandidatesTable.ownerUserId, otherIdentity.userId),
  ));
  await db.delete(secondBrainMemoriesTable).where(and(
    eq(secondBrainMemoriesTable.tenantId, identity.tenantId),
    eq(secondBrainMemoriesTable.ownerUserId, identity.userId),
  ));
  await db.delete(secondBrainMemoriesTable).where(and(
    eq(secondBrainMemoriesTable.tenantId, otherIdentity.tenantId),
    eq(secondBrainMemoriesTable.ownerUserId, otherIdentity.userId),
  ));
  await db.delete(conversationMemoryTable).where(and(
    eq(conversationMemoryTable.tenantId, identity.tenantId),
    eq(conversationMemoryTable.ownerUserId, identity.userId),
  ));
  await db.delete(peopleTable).where(and(
    eq(peopleTable.tenantId, identity.tenantId),
    eq(peopleTable.ownerUserId, identity.userId),
  ));
  await db.delete(peopleTable).where(and(
    eq(peopleTable.tenantId, otherIdentity.tenantId),
    eq(peopleTable.ownerUserId, otherIdentity.userId),
  ));
  await db.delete(projectsTable).where(and(
    eq(projectsTable.tenantId, identity.tenantId),
    eq(projectsTable.ownerUserId, identity.userId),
  ));
}

test("retrieval traces explain every outcome without exposing memory values", () => {
  const notTriggered = emptyRetrievalTrace(
    "محادثة عادية",
    false,
    "general_conversation",
    { requestId: "request-noop", conversationId: "conversation-noop" },
  );
  assert.equal(notTriggered.outcome, "not_triggered");
  assert.equal(notTriggered.llmContextReason, "not_triggered");
  assert.equal(notTriggered.requestId, "request-noop");
  assert.equal(notTriggered.conversationId, "conversation-noop");

  const excludedMemory = traceMemory({ confidenceBps: 7000 });
  const excludedTrace = emptyRetrievalTrace(
    "أنا بفضل الردود المختصرة",
    true,
    "preference",
    { requestId: "request-excluded", conversationId: "conversation-excluded" },
  );
  excludedTrace.selected = [{
    memoryId: excludedMemory.id,
    kind: excludedMemory.kind,
    relevanceScore: 0.8,
    confidence: 0.7,
    association: null,
    provenance: {
      sourceType: "explicit_user_instruction",
      sourceConversationId: excludedMemory.sourceConversationId,
      sourceTurnId: excludedMemory.sourceTurnId,
    },
  }];
  const excluded = applySecondBrainPolicy([excludedMemory], excludedTrace);
  assert.equal(excluded.trace.outcome, "excluded_matches");
  assert.equal(excluded.trace.llmContextIncluded, false);
  assert.equal(excluded.trace.excluded[0]?.reason, "type_not_allowed");
  assert.equal(excluded.trace.excluded[0]?.confidence, 0.7);
  assert.equal(excluded.trace.excluded[0]?.relevanceScore, 0.8);
  assert.equal(excluded.trace.excluded[0]?.provenance?.sourceType, "explicit_user_instruction");
  assert.equal(JSON.stringify(excluded.trace).includes(excludedMemory.value), false);

  const selectedMemory = traceMemory({ id: "trace-selected", kind: "fact" });
  const selectedTrace = emptyRetrievalTrace(
    "فاكر المعلومة الشخصية",
    true,
    "personal_fact",
    { requestId: "request-selected", conversationId: "conversation-selected" },
  );
  selectedTrace.selected = [{
    memoryId: selectedMemory.id,
    kind: selectedMemory.kind,
    relevanceScore: 0.9,
    confidence: 1,
    association: null,
    provenance: {
      sourceType: "explicit_user_instruction",
      sourceConversationId: selectedMemory.sourceConversationId,
      sourceTurnId: selectedMemory.sourceTurnId,
    },
  }];
  const selected = applySecondBrainPolicy([selectedMemory], selectedTrace);
  assert.equal(selected.trace.outcome, "selected_context");
  assert.equal(selected.trace.llmContextIncluded, true);
  assert.equal(selected.trace.selected[0]?.provenance.sourceTurnId, "source-turn");

  const noMatchTrace = emptyRetrievalTrace(
    "فاكر إيه؟",
    true,
    "memory_recall",
    { requestId: "request-empty", conversationId: "conversation-empty" },
  );
  const noMatch = applySecondBrainPolicy([], noMatchTrace);
  assert.equal(noMatch.trace.outcome, "no_matches");
  assert.equal(noMatch.trace.llmContextReason, "no_matches");

  const boundedTrace = emptyRetrievalTrace("تفضيل", true, "preference");
  const manyMemories = Array.from({ length: 140 }, (_, index) =>
    traceMemory({
      id: `trace-bounded-${index}`,
      kind: "fact",
      confidenceBps: 7000,
    }));
  const bounded = applySecondBrainPolicy(manyMemories, boundedTrace);
  assert.equal(bounded.trace.outcome, "excluded_matches");
  assert.equal(bounded.trace.excluded.length, 128);

  const budgetTrace = emptyRetrievalTrace("معلومة", true, "personal_fact");
  const oversized = traceMemory({
    id: "trace-budget",
    value: "x".repeat(5000),
    normalizedValue: "x".repeat(5000),
  });
  budgetTrace.selected = [{
    memoryId: oversized.id,
    kind: oversized.kind,
    relevanceScore: 1,
    confidence: 1,
    association: null,
    provenance: {
      sourceType: "explicit_user_instruction",
      sourceConversationId: oversized.sourceConversationId,
      sourceTurnId: oversized.sourceTurnId,
    },
  }];
  const budgeted = applySecondBrainContextBudget([oversized], budgetTrace);
  assert.equal(budgeted.length, 0);
  assert.equal(budgetTrace.outcome, "excluded_matches");
  assert.equal(budgetTrace.excluded[0]?.reason, "budget");
});

test("parses explicit remember, inferred preference candidates, and recall commands", () => {
  assert.deepEqual(parseSecondBrainCommand("افتكر إني بحب الردود المختصرة")?.type, "remember");
  assert.equal(parseSecondBrainCommand("أنا بفضل الفواتير بالجنيه"), null);
  assert.deepEqual(parseSecondBrainCandidate("أنا بفضل الفواتير بالجنيه"), {
    memoryKind: "preference",
    key: "preference:انا بفضل الفواتير بالجنيه",
    value: "أنا بفضل الفواتير بالجنيه",
    confidenceBps: 7000,
    metadata: {
      source: "inferred_user_statement",
      suggestionType: "preference",
    },
  });
  const preferenceQuestion = "أنا بحب أتعامل مع الموضوع ده إزاي؟";
  assert.equal(parseSecondBrainCandidate(preferenceQuestion), null);
  assert.equal(parseSecondBrainCandidate("أنا بحب أتعامل مع الموضوع ده إزاي"), null);
  assert.equal(shouldSearchSecondBrain(preferenceQuestion), true);
  assert.equal(classifySecondBrainQuery(preferenceQuestion), "preference");
  assert.deepEqual(parseSecondBrainCommand("افتكر إن اسم ميدو هو محمد أحمد"), {
    type: "remember",
    memoryKind: "fact",
    key: "note:اسم ميدو هو محمد احمد",
    value: "اسم ميدو هو محمد أحمد",
  });
  assert.deepEqual(parseSecondBrainCommand("افتكر إن أبو علي هو محمد"), {
    type: "remember",
    memoryKind: "alias",
    key: "alias:ابو علي",
    value: "محمد",
    metadata: {
      alias: "أبو علي",
      canonical: "محمد",
    },
  });
  assert.equal(parseSecondBrainCommand("افتكر إن اسم المشروع الكبير هو المحجر")?.memoryKind, "alias");
  assert.deepEqual(parseSecondBrainCommand("فاكر إيه اللي حفظته؟")?.type, "recall");
  assert.equal(parseSecondBrainCommand("سجل مصروف لمحمد ٥٠٠"), null);
});

test("stores explicit memories with replacement and tenant isolation", async () => {
  await cleanup();
  await rememberSecondBrain(identity, {
    memoryKind: "preference",
    key: "preference:reply_style",
    value: "أفضل الردود المختصرة",
    conversationId: "conversation-1",
    turnId: "turn-1",
  });
  await rememberSecondBrain(identity, {
    memoryKind: "preference",
    key: "preference:reply_style",
    value: "أفضل الردود المختصرة جدًا",
    conversationId: "conversation-2",
    turnId: "turn-2",
  });
  await rememberSecondBrain(otherIdentity, {
    memoryKind: "preference",
    key: "preference:reply_style",
    value: "أفضل الردود الطويلة",
  });

  const own = await searchSecondBrain(identity, "الردود");
  const other = await searchSecondBrain(otherIdentity, "الردود");
  assert.equal(own.length, 1);
  assert.equal(own[0]?.value, "أفضل الردود المختصرة جدًا");
  assert.equal(other.length, 1);
  assert.equal(other[0]?.value, "أفضل الردود الطويلة");
  await cleanup();
});

test("explicit recall can include archived memory without crossing tenants", async () => {
  await cleanup();
  const ownArchived = await rememberSecondBrain(identity, {
    memoryKind: "preference",
    key: "preference:archived_reply_style",
    value: "أفضل الردود المؤرشفة المختصرة",
  });
  const otherArchived = await rememberSecondBrain(otherIdentity, {
    memoryKind: "preference",
    key: "preference:other_archived_reply_style",
    value: "أفضل الردود المؤرشفة الطويلة",
  });
  await db.update(secondBrainMemoriesTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(secondBrainMemoriesTable.id, ownArchived.id));
  await db.update(secondBrainMemoriesTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(secondBrainMemoriesTable.id, otherArchived.id));

  const activeOnly = await retrieveSecondBrain(identity, "الردود", {
    mode: "lexical_v1",
    queryDomain: "preference",
  });
  assert.equal(activeOnly.memories.length, 0);
  assert.equal(activeOnly.trace.archivedRequested, false);
  assert.equal(activeOnly.trace.archivedIncluded, false);
  assert.ok(activeOnly.trace.excluded.some(
    (item) => item.memoryId === ownArchived.id && item.reason === "archived_not_requested",
  ));

  const explicit = await retrieveSecondBrain(identity, "الردود", {
    mode: "explicit_recall",
    queryDomain: "memory_recall",
    includeArchived: true,
  });
  assert.deepEqual(explicit.memories.map((memory) => memory.id), [ownArchived.id]);
  assert.equal(explicit.trace.archivedRequested, true);
  assert.equal(explicit.trace.archivedIncluded, true);
  assert.equal(explicit.memories.some((memory) => memory.id === otherArchived.id), false);

  const gateway: ModelGateway = {
    provider: "groq",
    modelName: "test-archived-recall-gateway",
    async generate() {
      throw new Error("The model gateway must not be called for explicit memory recall.");
    },
  };
  const recalled = await new Phase2AgentRuntime(gateway).run(identity, {
    message: "فاكر إيه اللي حفظته؟",
    conversationId: "archived-recall-conversation",
    requestId: "archived-recall-request",
  });
  assert.match(recalled.assistantMessage, /الردود المؤرشفة المختصرة/);
  const recallTrace = (recalled.action as {
    secondBrainRetrievalTrace?: { archivedIncluded?: boolean };
  } | undefined)?.secondBrainRetrievalTrace;
  assert.equal(recallTrace?.archivedIncluded, true);
  await cleanup();
});

test("uses an explicit personal alias only for the owner's matching entity", async () => {
  await cleanup();
  const [person] = await db.insert(peopleTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    name: "محمد أحمد",
    nameKey: "محمد احمد",
  }).returning();
  await db.insert(peopleTable).values({
    tenantId: otherIdentity.tenantId,
    ownerUserId: otherIdentity.userId,
    name: "محمد أحمد",
    nameKey: "محمد احمد",
  });
  await rememberSecondBrain(identity, {
    memoryKind: "alias",
    key: "alias:ميدو",
    value: "محمد أحمد",
    metadata: {
      alias: "ميدو",
      canonical: "محمد أحمد",
      entityType: "person",
      entityId: person.id,
    },
  });

  const own = await resolveEntity(identity, "person", "ميدو");
  const other = await resolveEntity(otherIdentity, "person", "ميدو");
  assert.equal(own.selected?.id, person.id);
  assert.equal(own.matchType, "alias");
  assert.equal(other.selected, undefined);
  assert.equal(other.matchType, "none");
  await cleanup();
  await db.delete(peopleTable).where(and(
    eq(peopleTable.tenantId, identity.tenantId),
    eq(peopleTable.ownerUserId, identity.userId),
  ));
  await db.delete(peopleTable).where(and(
    eq(peopleTable.tenantId, otherIdentity.tenantId),
    eq(peopleTable.ownerUserId, otherIdentity.userId),
  ));
});

test("handles memory commands without calling the model gateway", async () => {
  await cleanup();
  let gatewayCalls = 0;
  const gateway: ModelGateway = {
    provider: "groq",
    modelName: "test-memory-gateway",
    async generate() {
      gatewayCalls += 1;
      throw new Error("The model gateway must not be called for memory commands.");
    },
  };
  const runtime = new Phase2AgentRuntime(gateway);
  const conversationId = "memory-command-conversation";
  const suggested = await runtime.run(identity, {
    message: "أنا بفضل الردود المختصرة",
    conversationId,
    requestId: "memory-command-save",
  });
  const recalled = await runtime.run(identity, {
    message: "فاكر إيه اللي حفظته؟",
    conversationId,
    requestId: "memory-command-recall",
  });

  assert.equal(suggested.action?.type, "second_brain_memory_candidate_created");
  assert.equal(recalled.assistantMessage, "لسه ما عنديش ملاحظات شخصية محفوظة عنك.");
  assert.equal(gatewayCalls, 0);
  await cleanup();
});

test("associates alias candidates only with same-tenant entities before approval", async () => {
  await cleanup();
  const [person] = await db.insert(peopleTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    name: "محمد أحمد",
    nameKey: "محمد احمد",
  }).returning();
  const [otherPerson] = await db.insert(peopleTable).values({
    tenantId: otherIdentity.tenantId,
    ownerUserId: otherIdentity.userId,
    name: "محمد أحمد",
    nameKey: "محمد احمد",
  }).returning();
  const [duplicateNamedPerson] = await db.insert(peopleTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    name: "محمد أحمد",
    nameKey: "محمد احمد",
  }).returning();
  const [differentPerson] = await db.insert(peopleTable).values({
    tenantId: identity.tenantId,
    ownerUserId: identity.userId,
    name: "ليلى",
    nameKey: "ليلى",
  }).returning();
  const alias = await createSecondBrainCandidate(identity, {
    memoryKind: "alias",
    key: "alias:ميدو",
    value: "محمد أحمد",
    confidenceBps: 8000,
    metadata: { entityType: "person", entityId: person.id },
  });
  assert.equal(alias.metadata?.entityId, undefined);
  await assert.rejects(
    () => associateSecondBrainCandidate(identity, alias.id, { entityType: "person", entityId: otherPerson.id }),
    (error: unknown) => error instanceof SecondBrainCandidateAssociationError
      && error.code === "MEMORY_CANDIDATE_ENTITY_NOT_FOUND",
  );
  await assert.rejects(
    () => associateSecondBrainCandidate(identity, alias.id, { entityType: "person", entityId: differentPerson.id }),
    (error: unknown) => error instanceof SecondBrainCandidateAssociationError
      && error.code === "MEMORY_CANDIDATE_ENTITY_NAME_MISMATCH",
  );
  const associated = await associateSecondBrainCandidate(identity, alias.id, {
    entityType: "person",
    entityId: person.id,
  });
  assert.equal(associated?.metadata?.entityType, "person");
  assert.equal(associated?.metadata?.entityId, person.id);
  const approved = await reviewSecondBrainCandidate(identity, alias.id, { status: "approved" });
  assert.equal(approved?.candidate.status, "approved");
  assert.equal(approved?.memory?.metadata?.entityId, person.id);
  const aliasResolution = await resolveEntity(identity, "person", "ميدو");
  assert.equal(aliasResolution.selected?.id, person.id);
  assert.notEqual(aliasResolution.selected?.id, duplicateNamedPerson.id);

  const fact = await createSecondBrainCandidate(identity, {
    memoryKind: "fact",
    key: "note:test",
    value: "test",
    confidenceBps: 7000,
  });
  await assert.rejects(
    () => associateSecondBrainCandidate(identity, fact.id, { entityType: "person", entityId: person.id }),
    (error: unknown) => error instanceof SecondBrainCandidateAssociationError
      && error.code === "SECOND_BRAIN_CANDIDATE_NOT_ASSOCIABLE",
  );
  await cleanup();
});

test("serializes duplicate candidate creation by owner and key", async () => {
  await cleanup();
  const input = {
    memoryKind: "preference" as const,
    key: "preference:reply-style",
    value: "أفضل الردود المختصرة",
    confidenceBps: 7000,
  };
  const [first, second] = await Promise.all([
    createSecondBrainCandidate(identity, input),
    createSecondBrainCandidate(identity, input),
  ]);
  assert.equal(first.id, second.id);
  const rows = await db.select().from(secondBrainCandidatesTable).where(and(
    eq(secondBrainCandidatesTable.tenantId, identity.tenantId),
    eq(secondBrainCandidatesTable.ownerUserId, identity.userId),
    eq(secondBrainCandidatesTable.kind, input.memoryKind),
    eq(secondBrainCandidatesTable.key, input.key),
    eq(secondBrainCandidatesTable.status, "pending_review"),
  ));
  assert.equal(rows.length, 1);
  await cleanup();
});

test("candidate review is serialized and an approved memory cannot be demoted", async () => {
  await cleanup();
  const candidate = await createSecondBrainCandidate(identity, {
    memoryKind: "fact",
    key: "note:concurrent-review",
    value: "حقيقة مراجعة متزامنة",
    confidenceBps: 7000,
  });
  await Promise.allSettled([
    reviewSecondBrainCandidate(identity, candidate.id, { status: "approved" }),
    reviewSecondBrainCandidate(identity, candidate.id, { status: "rejected" }),
  ]);
  const [reviewed] = await db.select().from(secondBrainCandidatesTable).where(and(
    eq(secondBrainCandidatesTable.id, candidate.id),
    eq(secondBrainCandidatesTable.tenantId, identity.tenantId),
    eq(secondBrainCandidatesTable.ownerUserId, identity.userId),
  ));
  assert.equal(reviewed.status, "approved");
  assert.ok(reviewed.promotedMemoryId);
  const [memory] = await db.select().from(secondBrainMemoriesTable).where(and(
    eq(secondBrainMemoriesTable.id, reviewed.promotedMemoryId!),
    eq(secondBrainMemoriesTable.tenantId, identity.tenantId),
    eq(secondBrainMemoriesTable.ownerUserId, identity.userId),
  ));
  assert.equal(memory.status, "active");
  await assert.rejects(
    () => reviewSecondBrainCandidate(identity, candidate.id, { status: "rejected" }),
    (error: unknown) => error instanceof SecondBrainCandidateReviewError
      && error.code === "SECOND_BRAIN_CANDIDATE_STATE_CONFLICT",
  );
  await cleanup();
});

test("approved candidate confidence stays explicit even when replacing an existing memory", async () => {
  await cleanup();
  await rememberSecondBrain(identity, {
    memoryKind: "preference",
    key: "preference:reply-style",
    value: "تفضيل قديم",
  });
  const candidate = await createSecondBrainCandidate(identity, {
    memoryKind: "preference",
    key: "preference:reply-style",
    value: "تفضيل تمت مراجعته",
    confidenceBps: 7000,
  });
  const promoted = await reviewSecondBrainCandidate(identity, candidate.id, { status: "approved" });
  assert.equal(promoted?.memory?.value, "تفضيل تمت مراجعته");
  assert.equal(promoted?.memory?.confidenceBps, 10000);
  await cleanup();
});