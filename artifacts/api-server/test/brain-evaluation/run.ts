import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { evaluateAllIsolated, writeEvaluationReport } from "./evaluator";

const outputPath = resolve(
  process.cwd(),
  process.argv[2] ?? "test/brain-evaluation/results/brain-v1-isolated.json",
);
await mkdir(dirname(outputPath), { recursive: true });
const records = await evaluateAllIsolated();
await writeEvaluationReport(outputPath, records);
const counts = records.reduce<Record<string, number>>((summary, record) => {
  summary[record.status] = (summary[record.status] ?? 0) + 1;
  return summary;
}, {});
console.log(JSON.stringify({ outputPath, total: records.length, counts }, null, 2));