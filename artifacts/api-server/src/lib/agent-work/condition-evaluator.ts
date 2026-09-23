import { compareReadOnlyEvidence } from "./contract";

export type ComparisonOperator = "gt" | "gte" | "eq" | "lt" | "lte";

export function comparisonOperator(value: unknown): ComparisonOperator | null {
  return value === "gt"
    || value === "gte"
    || value === "eq"
    || value === "lt"
    || value === "lte"
    ? value
    : null;
}

export function compareCondition(
  value: number,
  operator: ComparisonOperator,
  threshold: number,
): boolean {
  if (operator === "gt") return value > threshold;
  if (operator === "gte") return value >= threshold;
  if (operator === "eq") return value === threshold;
  if (operator === "lt") return value < threshold;
  return value <= threshold;
}

export function comparisonOperatorLabel(operator: ComparisonOperator): string {
  return operator === "gt"
    ? "أكبر من"
    : operator === "gte"
      ? "أكبر من أو يساوي"
      : operator === "eq"
        ? "يساوي"
        : operator === "lt"
          ? "أقل من"
          : "أقل من أو يساوي";
}

export const evaluateReadOnlyEvidence = compareReadOnlyEvidence;