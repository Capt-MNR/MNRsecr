import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataset = JSON.parse(
  await readFile(new URL("./dataset.json", import.meta.url), "utf8"),
);

test("intent evaluation dataset has stable coverage across all requested categories", () => {
  assert.ok(dataset.version >= 1);
  assert.ok(dataset.cases.length >= 30);
  assert.deepEqual(
    new Set(dataset.cases.map((item) => item.category)),
    new Set([
      "expense_intent",
      "create_person",
      "ambiguous",
      "expense_with_project",
      "correction",
      "negative_guard",
    ]),
  );
  assert.equal(
    new Set(dataset.cases.map((item) => item.id)).size,
    dataset.cases.length,
  );
});

test("every dataset case is explicitly no-write and has an expected tool contract", () => {
  for (const item of dataset.cases) {
    assert.equal(item.expected.write, false, item.id);
    assert.equal(typeof item.expected.intent, "string", item.id);
    assert.equal(typeof item.expected.primaryTool, "string", item.id);
    assert.ok(item.expected.acceptableTools.includes(item.expected.primaryTool), item.id);
    assert.ok(["none", "context_required"].includes(item.contextMode), item.id);
  }
});