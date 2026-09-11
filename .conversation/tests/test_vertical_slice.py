from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from packages.agent_runtime.first_party import FirstPartyRuntime
from packages.application.use_cases import ApplicationService
from packages.contracts.models import ExecutionContext, TurnRequest
from packages.llm.dev_provider import DeterministicDevelopmentProvider
from packages.persistence.sqlite import SQLiteStore


class VerticalSliceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.store = SQLiteStore(f"{self.tempdir.name}/test.sqlite3")
        self.runtime = FirstPartyRuntime(
            gateway=DeterministicDevelopmentProvider(),
            application=ApplicationService(self.store),
        )
        self.context = ExecutionContext(
            tenant_id="tenant-test",
            user_id="user-test",
            conversation_id="conversation-test",
            channel="test",
            capabilities=frozenset(
                {"expenses.read", "expenses.write", "reminders.write"}
            ),
        )

    def tearDown(self) -> None:
        self.store.close()
        self.tempdir.cleanup()

    def turn(self, message: str, key: str):
        return self.runtime.handle(
            TurnRequest(
                context=self.context,
                user_message=message,
                idempotency_key=key,
                allowed_capabilities=frozenset(
                    {"expenses.read", "expenses.write", "reminders.write"}
                ),
                deadline_at=datetime.now(timezone.utc) + timedelta(seconds=5),
            )
        )

    def test_record_and_retrieve_structured_expense(self) -> None:
        recorded = self.turn("دفعت لمحمد 11500 جنيه تشطيبات", "expense-1")
        self.assertEqual(recorded.failure, None)
        self.assertEqual(recorded.committed_actions[0].status, "committed")

        summary = self.turn("دفعت كام في التشطيبات؟", "query-1")
        self.assertIn("11,500.00", summary.assistant_message)
        self.assertEqual(summary.proposed_actions[0].result["total_minor"], 1_150_000)

    def test_expense_is_idempotent(self) -> None:
        first = self.turn("دفعت لمحمد 11500 جنيه تشطيبات", "same-key")
        second = self.turn("دفعت لمحمد 11500 جنيه تشطيبات", "same-key")
        self.assertEqual(
            first.committed_actions[0].result["expense_id"],
            second.committed_actions[0].result["expense_id"],
        )
        row = self.store.fetchone("SELECT COUNT(*) AS count FROM expenses")
        self.assertEqual(row["count"], 1)

    def test_reminder_is_durable(self) -> None:
        result = self.turn("فكرني الخميس أكلم محمد", "reminder-1")
        self.assertEqual(result.committed_actions[0].name, "create_reminder")
        row = self.store.fetchone("SELECT status FROM reminders")
        self.assertEqual(row["status"], "pending")


if __name__ == "__main__":
    unittest.main()
