/**
 * Experimental only.
 *
 * This module is deliberately outside the production deterministic gate. Its
 * observations are not user-facing facts and are disabled unless explicitly
 * enabled with EXPERIMENTAL_PATTERN_INSIGHTS_ENABLED.
 */
export type RelationshipRecord = {
  personId: string;
  projectId: string;
  relationship?: string | null;
};

export type ExpensePatternRecord = {
  id: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  personId?: string | null;
  projectId?: string | null;
};

export type PatternInsight = {
  kind: "relationship" | "recurring_expense" | "frequent_entity" | "recent_activity";
  confidence: number;
  qualification: "observed" | "repeated_observation" | "derived_from_saved_rows";
  value: Record<string, unknown>;
};

export function buildPatternInsights(
  relationships: RelationshipRecord[],
  expenses: ExpensePatternRecord[],
  now = new Date(),
): PatternInsight[] {
  const insights: PatternInsight[] = [];
  for (const relationship of relationships) {
    if (!relationship.personId || !relationship.projectId) continue;
    insights.push({
      kind: "relationship",
      confidence: 1,
      qualification: "derived_from_saved_rows",
      value: {
        personId: relationship.personId,
        projectId: relationship.projectId,
        relationship: relationship.relationship ?? null,
      },
    });
  }

  const entityCounts = new Map<string, number>();
  for (const expense of expenses) {
    for (const key of [expense.personId ? `person:${expense.personId}` : "", expense.projectId ? `project:${expense.projectId}` : ""]) {
      if (key) entityCounts.set(key, (entityCounts.get(key) ?? 0) + 1);
    }
    const ageMs = now.getTime() - new Date(expense.occurredAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 7 * 24 * 60 * 60 * 1000) {
      insights.push({
        kind: "recent_activity",
        confidence: 1,
        qualification: "derived_from_saved_rows",
        value: { expenseId: expense.id, occurredAt: expense.occurredAt },
      });
    }
  }

  for (const [entity, count] of entityCounts) {
    if (count < 2) continue;
    insights.push({
      kind: "frequent_entity",
      confidence: Math.min(0.99, 0.6 + count / 20),
      qualification: "repeated_observation",
      value: { entity, observations: count },
    });
  }

  const recurrenceGroups = new Map<string, ExpensePatternRecord[]>();
  for (const expense of expenses) {
    const key = [
      expense.amountMinor,
      expense.currency.toUpperCase(),
      expense.personId ?? "",
      expense.projectId ?? "",
    ].join("|");
    recurrenceGroups.set(key, [...(recurrenceGroups.get(key) ?? []), expense]);
  }
  for (const [key, rows] of recurrenceGroups) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const gaps = sorted.slice(1).map((row, index) =>
      Math.abs(new Date(row.occurredAt).getTime() - new Date(sorted[index].occurredAt).getTime())
      / (24 * 60 * 60 * 1000),
    );
    if (gaps.length > 0 && gaps.every((gap) => gap >= 25 && gap <= 35)) {
      insights.push({
        kind: "recurring_expense",
        confidence: Math.min(0.98, 0.7 + rows.length / 20),
        qualification: "repeated_observation",
        value: { key, observations: rows.length, averageGapDays: gaps.reduce((a, b) => a + b, 0) / gaps.length },
      });
    }
  }
  return insights;
}