import test from "node:test";
import assert from "node:assert/strict";
import { evaluateProactiveBehavior } from "../src/lib/proactive-behavior";

const now = "2025-01-01T00:00:00.000Z";
test("approaching reminders end at due time and due-time reminders catch up without firing early", () => {
  assert.equal(evaluateProactiveBehavior({ kind: "reminder", now, reminder: { id: "r", title: "Call", dueAt: "2025-01-01T12:00:00Z" } }).action, "remind");
  assert.equal(evaluateProactiveBehavior({ kind: "reminder", now, reminder: { id: "r", title: "Call", dueAt: "2025-01-02T00:01:00Z" } }).action, "ignore");
  assert.equal(evaluateProactiveBehavior({ kind: "reminder", now, reminder: { id: "r", title: "Call", dueAt: "2024-12-31T23:00:00Z" } }).reason, "past_due_is_overdue");
  assert.equal(evaluateProactiveBehavior({ kind: "reminder", now, reminder: { id: "r", title: "Call", dueAt: now } }).reason, "approaching_window_ended_at_due_time");
  assert.equal(evaluateProactiveBehavior({
    kind: "reminder",
    now,
    reminder: { id: "r", title: "Call", dueAt: "2025-01-01T00:00:00Z", window: "due-time" },
  }).action, "remind");
  assert.equal(evaluateProactiveBehavior({
    kind: "reminder",
    now,
    reminder: { id: "r", title: "Call", dueAt: "2024-12-31T23:00:00Z", window: "due-time" },
  }).reason, "reminder_due_time_caught_up");
  assert.equal(evaluateProactiveBehavior({
    kind: "reminder",
    now,
    reminder: { id: "r", title: "Call", dueAt: "2025-01-01T00:01:00Z", window: "due-time" },
  }).reason, "reminder_due_time_not_reached");
});
test("delivery dedupe and explicit repeat permission", () => {
  const input = { kind: "reminder" as const, now, reminder: { id: "r", title: "Call", dueAt: "2025-01-01T12:00:00Z", version: 1, window: "morning" }, previousDeliveries: [{ deadline: "2025-01-01T12:00:00.000Z", version: 1, window: "morning" }] };
  assert.equal(evaluateProactiveBehavior(input).action, "ignore");
  assert.equal(evaluateProactiveBehavior({ ...input, reminder: { ...input.reminder, repeatPermission: true } }).action, "remind");
});
test("overdue suppression and level are deterministic", () => {
  assert.equal(evaluateProactiveBehavior({ kind: "overdue", now, overdue: { id: "x", title: "Pay", dueAt: now, temporarySuppression: true } }).action, "ignore");
  assert.equal(evaluateProactiveBehavior({ kind: "overdue", now, overdue: { id: "x", title: "Pay", dueAt: now, level: "high" } }).action, "offer_help");
});
test("inactive records and not-yet-due overdue records are ignored", () => {
  assert.equal(evaluateProactiveBehavior({ kind: "reminder", now, reminder: { id: "x", title: "Done", dueAt: now, status: "completed" } }).action, "ignore");
  assert.equal(evaluateProactiveBehavior({ kind: "overdue", now, overdue: { id: "x", title: "Cancelled", dueAt: now, status: "cancelled" } }).action, "ignore");
  assert.equal(evaluateProactiveBehavior({ kind: "overdue", now, overdue: { id: "x", title: "Later", dueAt: "2025-01-01T01:00:00Z" } }).action, "ignore");
  assert.equal(evaluateProactiveBehavior({ kind: "overdue", now, overdue: { id: "x", title: "Low", dueAt: now, proactiveLevel: "low" } }).action, "inform");
});
test("relationship discovery needs evidence and approval", () => {
  const base = { kind: "relationship_discovery" as const, relationship: { candidate: { id: "p", name: "Pat" }, evidence: [{ source: "tasks", value: "x" }, { source: "email", value: "y" }], evidenceVersion: 2 } };
  assert.equal(evaluateProactiveBehavior(base).action, "request_approval");
  assert.equal(evaluateProactiveBehavior({ kind: "relationship_discovery", relationship: { candidate: { id: "p", name: "Pat" } } }).action, "ignore");
  assert.equal(evaluateProactiveBehavior({ kind: "relationship_discovery", relationship: { candidate: { id: "p", name: "Pat" }, evidence: [{ sourceId: "one", source: "same", value: "x" }, { sourceId: "two", source: "same", value: "y" }] } }).action, "request_approval");
  assert.equal(evaluateProactiveBehavior({ ...base, relationship: { ...base.relationship, rejectedEvidenceVersion: 2 } }).action, "ignore");
  assert.equal(evaluateProactiveBehavior({ kind: "relationship_discovery", relationship: { evidence: [{ source: "same", sourceId: "one", value: "x" }, { source: "same", sourceId: "one", value: "y" }] } }).action, "ignore");
  assert.equal(evaluateProactiveBehavior({ kind: "relationship_discovery", relationship: { evidence: [{ source: "trusted", value: "x", trustedCandidate: true }] } }).action, "request_approval");
});
test("awareness uses one anchor, max three facts, and assistance never invents capability", () => {
  const facts = [1, 2, 3, 4].map((n) => ({ id: String(n), text: `f${n}`, anchor: "case", structured: true }));
  const awareness = evaluateProactiveBehavior({ kind: "awareness", awareness: { facts } });
  assert.equal((awareness.factualPayload.facts as unknown[]).length, 3);
  assert.equal(evaluateProactiveBehavior({ kind: "assistance", assistance: { context: "x", benefit: "y", inputs: { a: 1 } } }).action, "ignore");
  assert.equal(evaluateProactiveBehavior({ kind: "awareness", awareness: { facts: [{ id: "one", text: "one", anchor: "solo", structured: true }] } }).action, "ignore");
});
test("assistance completeness follows declared keys or explicit inputComplete", () => {
  const base = { kind: "assistance" as const, assistance: { capability: { id: "read", name: "Read" }, context: "case", benefit: "clarity", requiredInputKeys: ["recordId"], inputs: {} } };
  assert.equal(evaluateProactiveBehavior(base).action, "ignore");
  assert.equal(evaluateProactiveBehavior({ ...base, assistance: { ...base.assistance, inputs: { recordId: "r" } } }).action, "offer_help");
  assert.equal(evaluateProactiveBehavior({ ...base, assistance: { ...base.assistance, inputComplete: true } }).action, "offer_help");
  assert.equal(evaluateProactiveBehavior({ kind: "assistance", assistance: { capability: { id: "read", name: "Read" }, context: "case", benefit: "clarity", inputs: {} } }).action, "offer_help");
});
test("all styles have deterministic distinct phrasing and Arabic is the default", () => {
  const base = { kind: "reminder" as const, now, reminder: { id: "r", title: "Call", dueAt: "2025-01-01T12:00:00Z" } };
  const rendered = (["formal", "friendly", "concise", "balanced"] as const).map((style) => evaluateProactiveBehavior({ ...base, style }).renderedText);
  assert.equal(new Set(rendered).size, 4);
  assert.match(evaluateProactiveBehavior(base).renderedText, /تذكير/);
});
test("awareness, relationship, and assistance render their factual content", () => {
  const awareness = evaluateProactiveBehavior({ kind: "awareness", awareness: { facts: [
    { id: "f1", text: "invoice due", anchor: "case", structured: true },
    { id: "f2", text: "client waiting", anchor: "case", structured: true },
  ] }, language: "en" });
  assert.match(awareness.renderedText, /invoice due/);
  assert.match(awareness.renderedText, /client waiting/);
  const relationship = evaluateProactiveBehavior({ kind: "relationship_discovery", language: "en", relationship: {
    candidate: { id: "p", name: "Pat" },
    evidence: [{ source: "calendar", value: "same meeting" }, { source: "tasks", value: "same project" }],
  } });
  assert.match(relationship.renderedText, /same meeting/);
  assert.match(relationship.renderedText, /same project/);
  assert.match(relationship.renderedText, /no change occurs before approval/i);
  const assistance = evaluateProactiveBehavior({ kind: "assistance", language: "en", assistance: {
    capability: { id: "search", name: "Search records" }, inputs: {}, context: "the client case", benefit: "find the latest invoice",
  } });
  assert.match(assistance.renderedText, /Search records/);
  assert.match(assistance.renderedText, /the client case/);
  assert.match(assistance.renderedText, /find the latest invoice/);
  assert.match(assistance.renderedText, /\?/);
});
test("structured rendered content is copy-invariant across styles", () => {
  const input = { kind: "awareness" as const, language: "en" as const, awareness: { facts: [
    { id: "a", text: "alpha", anchor: "x", structured: true },
    { id: "b", text: "beta", anchor: "x", structured: true },
  ] } };
  const formal = evaluateProactiveBehavior({ ...input, style: "formal" }).renderedText;
  const friendly = evaluateProactiveBehavior({ ...input, style: "friendly" }).renderedText;
  for (const word of ["alpha", "beta"]) {
    assert.match(formal, new RegExp(word));
    assert.match(friendly, new RegExp(word));
  }
  assert.notEqual(formal, friendly);
});
test("rendering style and language never alter factual payload", () => {
  const base = { kind: "reminder" as const, now, reminder: { id: "r", title: "Call", dueAt: "2025-01-01T12:00:00Z" } };
  const a = evaluateProactiveBehavior({ ...base, style: "formal", language: "en" });
  const b = evaluateProactiveBehavior({ ...base, style: "friendly", language: "ar" });
  assert.deepEqual(a.factualPayload, b.factualPayload);
  assert.notEqual(a.renderedText, b.renderedText);
});