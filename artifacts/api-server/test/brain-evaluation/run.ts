import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { evaluateAllIsolated, writeEvaluationReport } from "./evaluator";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const outputPath = resolve(
  process.cwd(),
  args[0] ?? "test/brain-evaluation/results/brain-v1-isolated.json",
);
const reportPath = resolve(
  process.cwd(),
  args[1] ?? "test/brain-evaluation/REPORT.md",
);
await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(reportPath), { recursive: true });
const records = await evaluateAllIsolated();
await writeEvaluationReport(outputPath, records, reportPath);
const counts = records.reduce<Record<string, number>>((summary, record) => {
  summary[record.status] = (summary[record.status] ?? 0) + 1;
  return summary;
}, {});
console.log(JSON.stringify({ outputPath, reportPath, total: records.length, counts }, null, 2));