import assert from "node:assert/strict";
import test from "node:test";
import {
  deterministicExpensePeriod,
  isBroadExpenseReportRequest,
} from "../src/lib/expense-report.ts";

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

test("recognizes only exact unscoped expense period totals", () => {
  assert.equal(deterministicExpensePeriod("أنا صرفت كام الأسبوع ده؟"), "this_week");
  assert.equal(deterministicExpensePeriod("إجمالي المصروفات الأسبوع اللي فات"), "last_week");
  assert.equal(deterministicExpensePeriod("كام صرفنا الشهر ده؟"), "this_month");
  assert.equal(deterministicExpensePeriod("مصاريف الشهر الماضي"), "last_month");
});

test("keeps scoped or ambiguous period questions on the model path", () => {
  assert.equal(deterministicExpensePeriod("أنا صرفت كام على مشروع النخيل الأسبوع ده؟"), null);
  assert.equal(deterministicExpensePeriod("كام دفعت لمحمد الشهر ده؟"), null);
  assert.equal(deterministicExpensePeriod("إيه المصروفات من أول الشهر؟"), null);
});