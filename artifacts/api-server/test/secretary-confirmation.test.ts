import assert from "node:assert/strict";
import test from "node:test";
import {
  annotateApprovalAction,
  approvalMessage,
  confirmationModeFor,
} from "../src/lib/secretary-confirmation.ts";

const approval = {
  type: "approval_required",
  operationId: "00000000-0000-0000-0000-000000000001",
  toolName: "record_expense",
  status: "pending",
  display: {
    title: "تسجيل مصروف",
    details: ["القيمة: 7,500 EGP", "الشخص: محمد"],
  },
};

test("quick expense captures become deferred confirmations without changing main approvals", () => {
  assert.equal(confirmationModeFor("quick", "record_expense"), "deferred_confirmation");
  assert.equal(confirmationModeFor("quick", "create_reminder"), "deferred_confirmation");
  assert.equal(confirmationModeFor("quick", "delete_expense"), "immediate_approval");
  assert.equal(confirmationModeFor("main", "record_expense"), "immediate_approval");

  const quickAction = annotateApprovalAction(approval, "quick");
  assert.equal(quickAction?.type, "pending_confirmation");
  assert.equal(quickAction?.confirmationMode, "deferred_confirmation");
  assert.equal(quickAction?.quickApprove, true);

  const mainAction = annotateApprovalAction(approval, "main");
  assert.equal(mainAction?.type, "approval_required");
  assert.equal(mainAction?.confirmationMode, "immediate_approval");
  assert.equal(mainAction?.quickApprove, false);
});

test("deferred confirmation language never claims that a write already happened", () => {
  const quickAction = annotateApprovalAction(approval, "quick");
  assert.match(
    approvalMessage(quickAction, "قبل ما أنفذ العملية، هل توافق؟", "quick"),
    /كتبتها مؤقتًا/,
  );
  assert.doesNotMatch(
    approvalMessage(quickAction, "قبل ما أنفذ العملية، هل توافق؟", "quick"),
    /سجلت المصروف بنجاح/,
  );
});