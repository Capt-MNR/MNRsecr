import assert from "node:assert/strict";
import test from "node:test";
import { isBroadExpenseReportRequest } from "../src/lib/expense-report.ts";

test("recognizes broad expense report requests", () => {
  assert.equal(isBroadExpenseReportRequest("عايز تقرير بالمصروفات"), true);
  assert.equal(isBroadExpenseReportRequest("تقرير شامل بالمصروفات"), true);
  assert.equal(isBroadExpenseReportRequest("تقرير المصاريف كلها"), true);
});

test("does not steal scoped expense queries from entity resolution", () => {
  assert.equal(isBroadExpenseReportRequest("تقرير مصروفات مشروع النخيل"), false);
  assert.equal(isBroadExpenseReportRequest("إجمالي المصروفات لمحمد"), false);
  assert.equal(isBroadExpenseReportRequest("كام دفعت في التشطيبات"), false);
});