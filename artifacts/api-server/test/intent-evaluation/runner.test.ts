import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { actualIntent } from "./runner.ts";

const baselineDataset = JSON.parse(
  await readFile(new URL("./baseline-scenarios.json", import.meta.url), "utf8"),
);

function tool(name: string) {
  return { name, arguments: {}, dryRun: true };
}

test("A and B match their intent when the correct tool is selected", () => {
  const cases = ["A", "B"].map((id) => {
    const evaluationCase = baselineDataset.cases.find((item: { id: string }) => item.id === id);
    assert.ok(evaluationCase, id);
    return evaluationCase;
  });

  for (const evaluationCase of cases) {
    const intent = actualIntent(
      { ok: true, responseKind: "answer", caseId: evaluationCase.id, mode: "test", dryRun: true, elapsedMs: 0 },
      [tool(evaluationCase.expected.primaryTool)],
    );

    assert.equal(intent, evaluationCase.expected.intent, evaluationCase.id);
    assert.equal(intent === evaluationCase.expected.intent, true, evaluationCase.id);
  }
});