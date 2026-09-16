import assert from "node:assert/strict";
import test from "node:test";
import { prepareReminderApprovalArgs } from "../src/lib/approval-args.ts";

test("normalizes a local reminder time and supplies the default timezone", () => {
  assert.deepEqual(
    prepareReminderApprovalArgs({
      text: "كلم شركة المياه",
      dueAt: "2026-09-17T12:00",
    }),
    {
      text: "كلم شركة المياه",
      dueAt: "2026-09-17T12:00:00.000Z",
      timezone: "Africa/Cairo",
    },
  );
});

test("keeps an offset reminder time unambiguous", () => {
  assert.deepEqual(
    prepareReminderApprovalArgs({
      text: "كلم شركة المياه",
      dueAt: "2026-09-17T12:00:00+03:00",
      timezone: "Africa/Cairo",
    }),
    {
      text: "كلم شركة المياه",
      dueAt: "2026-09-17T09:00:00.000Z",
      timezone: "Africa/Cairo",
    },
  );
});

test("rejects an incomplete reminder approval", () => {
  assert.equal(
    prepareReminderApprovalArgs({ text: "كلم شركة المياه", dueAt: "not-a-date" }),
    null,
  );
});