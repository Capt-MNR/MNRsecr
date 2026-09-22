import { desc, eq, and } from "drizzle-orm";
import {
  db,
  expensesTable,
  projectPeopleTable,
} from "@workspace/db";
import type { Identity } from "./secretary";

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
  amountMinor: number | null;
  currency: string | null;
  occurredAt: string | null;
  personId?: string | null;
  projectId?: string | null;
};

export type PatternEvidence = "fact" | "observation";

export type PatternInsight = {
  kind: "relationship" | "recurring_expense" | "frequent_entity" | "recent_activity";
  confidence: number;
  evidence: PatternEvidence;
  qualification: "observed" | "repeated_observation" | "derived_from_saved_rows";
  value: Record<string, unknown>;
};

const EXPERIMENTAL_PATTERN_EXPENSE_LIMIT = 500;
const EXPERIMENTAL_PATTERN_RELATIONSHIP_LIMIT = 200;

export async function loadExperimentalPatternHistory(identity: Identity): Promise<{
  relationships: RelationshipRecord[];
  expenses: ExpensePatternRecord[];
}> {
  const [expenseRows, relationshipRows] = await Promise.all([
    db.select({
      id: expensesTable.id,
      amountMinor: expensesTable.amountMinor,
      currency: expensesTable.currency,
      occurredAt: expensesTable.occurredAt,
      personId: expensesTable.personId,
      projectId: expensesTable.projectId,
    })
      .from(expensesTable)
      .where(and(
        eq(expensesTable.tenantId, identity.tenantId),
        eq(expensesTable.ownerUserId, identity.userId),
      ))
      .orderBy(desc(expensesTable.occurredAt))
      .limit(EXPERIMENTAL_PATTERN_EXPENSE_LIMIT),
    db.select({
      personId: projectPeopleTable.personId,
      projectId: projectPeopleTable.projectId,
      relationship: projectPeopleTable.relationship,
    })
      .from(projectPeopleTable)
      .where(and(
        eq(projectPeopleTable.tenantId, identity.tenantId),
        eq(projectPeopleTable.ownerUserId, identity.userId),
      ))
      .orderBy(desc(projectPeopleTable.updatedAt))
      .limit(EXPERIMENTAL_PATTERN_RELATIONSHIP_LIMIT),
  ]);

  return {
    expenses: expenseRows.map((row) => ({
      id: row.id,
      amountMinor: row.amountMinor,
      currency: row.currency,
      occurredAt: row.occurredAt.toISOString(),
      personId: row.personId,
      projectId: row.projectId,
    })),
    relationships: relationshipRows.map((row) => ({
      personId: row.personId,
      projectId: row.projectId,
      relationship: row.relationship,
    })),
  };
}

type ValidExpensePatternRecord = ExpensePatternRecord & {
  amountMinor: number;
  currency: string;
  occurredAt: string;
};

function validExpenseRecord(expense: ExpensePatternRecord): expense is ExpensePatternRecord & {
  amountMinor: number;
  currency: string;
  occurredAt: string;
} {
  const amountMinor = expense.amountMinor;
  const currency = expense.currency;
  const occurredAt = expense.occurredAt;
  return (
    typeof expense.id === "string"
    && typeof amountMinor === "number"
    && Number.isSafeInteger(amountMinor)
    && amountMinor >= 0
    && typeof currency === "string"
    && /^[A-Z]{3}$/u.test(currency.trim().toUpperCase())
    && typeof occurredAt === "string"
    && Number.isFinite(new Date(occurredAt).getTime())
  );
}

export function buildPatternInsights(
  relationships: RelationshipRecord[],
  expenses: ExpensePatternRecord[],
  now = new Date(),
): PatternInsight[] {
  const insights: PatternInsight[] = [];
  const validExpenses: ValidExpensePatternRecord[] = expenses.filter(validExpenseRecord).map((expense) => ({
    ...expense,
    currency: expense.currency.trim().toUpperCase(),
  }));

  for (const relationship of relationships) {
    if (!relationship.personId || !relationship.projectId) continue;
    insights.push({
      kind: "relationship",
      confidence: 1,
      evidence: "fact",
      qualification: "derived_from_saved_rows",
      value: {
        personId: relationship.personId,
        projectId: relationship.projectId,
        relationship: relationship.relationship ?? null,
      },
    });
  }

  const entityCounts = new Map<string, number>();
  for (const expense of validExpenses) {
    for (const key of [expense.personId ? `person:${expense.personId}` : "", expense.projectId ? `project:${expense.projectId}` : ""]) {
      if (key) entityCounts.set(key, (entityCounts.get(key) ?? 0) + 1);
    }
    const ageMs = now.getTime() - new Date(expense.occurredAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 7 * 24 * 60 * 60 * 1000) {
      insights.push({
        kind: "recent_activity",
        confidence: 1,
        evidence: "observation",
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
      evidence: "observation",
      qualification: "repeated_observation",
      value: { entity, observations: count },
    });
  }

  const recurrenceGroups = new Map<string, ValidExpensePatternRecord[]>();
  for (const expense of validExpenses) {
    // Without an explicit person or project anchor, equal amounts alone are
    // not enough evidence to call unrelated historical rows recurring.
    if (!expense.personId && !expense.projectId) continue;
    const key = [
      expense.amountMinor,
      expense.currency,
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
        evidence: "observation",
        qualification: "repeated_observation",
        value: {
          amountMinor: rows[0].amountMinor,
          currency: rows[0].currency,
          personId: rows[0].personId ?? null,
          projectId: rows[0].projectId ?? null,
          observations: rows.length,
          averageGapDays: gaps.reduce((a, b) => a + b, 0) / gaps.length,
        },
      });
    }
  }
  return insights;
}