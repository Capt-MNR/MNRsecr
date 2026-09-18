import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  conversationMemoryTable,
  db,
  peopleTable,
  secondBrainMemoriesTable,
} from "@workspace/db";
import {
  parseSecondBrainCommand,
  rememberSecondBrain,
  searchSecondBrain,
} from "../src/lib/second-brain.ts";
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

async function cleanup() {
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
}

test("parses explicit remember, preference, and recall commands", () => {
  assert.deepEqual(parseSecondBrainCommand("افتكر إني بحب الردود المختصرة")?.type, "remember");
  assert.deepEqual(parseSecondBrainCommand("أنا بفضل الفواتير بالجنيه")?.type, "remember");
  assert.deepEqual(parseSecondBrainCommand("افتكر إن اسم ميدو هو محمد أحمد"), {
    type: "remember",
    memoryKind: "alias",
    key: "alias:ميدو",
    value: "محمد أحمد",
    metadata: {
      alias: "ميدو",
      canonical: "محمد أحمد",
    },
  });
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
    metadata: { alias: "ميدو", canonical: "محمد أحمد" },
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
  const saved = await runtime.run(identity, {
    message: "افتكر إني بفضل الردود المختصرة",
    conversationId,
    requestId: "memory-command-save",
  });
  const recalled = await runtime.run(identity, {
    message: "فاكر إيه اللي حفظته؟",
    conversationId,
    requestId: "memory-command-recall",
  });

  assert.equal(saved.action?.type, "second_brain_memory_saved");
  assert.match(recalled.assistantMessage, /الردود المختصرة/);
  assert.equal(gatewayCalls, 0);
  await cleanup();
});