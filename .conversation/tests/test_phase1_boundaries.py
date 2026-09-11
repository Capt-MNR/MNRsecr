from __future__ import annotations

import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

from packages.agent_runtime.first_party import FirstPartyRuntime
from packages.application.use_cases import ApplicationService
from packages.contracts.models import ExecutionContext, TurnRequest
from packages.domain.errors import AuthorizationError
from packages.identity.auth import DevelopmentAuthenticator, TrustedIdentity
from packages.llm.dev_provider import DeterministicDevelopmentProvider
from packages.llm.gateway import IntentPlan, ModelResponse
from packages.persistence.sqlite import SQLiteStore
from apps.worker.main import ReminderWorker


CAPABILITIES = frozenset({"expenses.read", "expenses.write", "reminders.write"})


class MaliciousArgumentProvider:
    """Provider-shaped object attempting to smuggle identity fields."""

    def complete(self, request):
        return ModelResponse(
            text="",
            intent=IntentPlan(
                name="record_expense",
                arguments={
                    "amount_minor": 100,
                    "currency": "EGP",
                    "description": "attempt",
                    "person_name": None,
                    "project_name": None,
                    "tenant_id": "attacker-tenant",
                    "user_id": "attacker-user",
                },
                confidence=1.0,
            ),
            provider="test",
            model="malicious-test-provider",
            input_units=1,
            output_units=1,
        )


class CapabilityInjectionProvider:
    def complete(self, request):
        return ModelResponse(
            text="",
            intent=IntentPlan(
                name="record_expense",
                arguments={
                    "amount_minor": 100,
                    "currency": "EGP",
                    "description": "attempt",
                    "person_name": None,
                    "project_name": None,
                    "allowed_capabilities": ["expenses.write"],
                },
                confidence=1.0,
            ),
            provider="test",
            model="capability-injection-provider",
            input_units=1,
            output_units=1,
        )


class BoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.path = f"{self.tempdir.name}/test.sqlite3"
        self.store = SQLiteStore(self.path)
        self.application = ApplicationService(self.store)
        self.runtime = FirstPartyRuntime(
            gateway=DeterministicDevelopmentProvider(),
            application=self.application,
        )

    def tearDown(self) -> None:
        self.store.close()
        self.tempdir.cleanup()

    def context(
        self,
        tenant_id: str = "tenant-a",
        user_id: str = "user-a",
        capabilities: frozenset[str] = CAPABILITIES,
    ) -> ExecutionContext:
        return ExecutionContext(
            tenant_id=tenant_id,
            user_id=user_id,
            conversation_id="boundary-conversation",
            channel="test",
            capabilities=capabilities,
        )

    def turn(self, context: ExecutionContext, message: str, key: str):
        return self.runtime.handle(
            TurnRequest(
                context=context,
                user_message=message,
                idempotency_key=key,
                allowed_capabilities=CAPABILITIES,
                deadline_at=datetime.now(timezone.utc) + timedelta(seconds=5),
            )
        )

    def test_cross_tenant_retrieval_cannot_see_expense(self) -> None:
        self.turn(
            self.context("tenant-a", "user-a"),
            "دفعت لمحمد 11500 جنيه تشطيبات",
            "tenant-a-expense",
        )
        other_tenant = self.turn(
            self.context("tenant-b", "user-b"),
            "دفعت كام في التشطيبات؟",
            "tenant-b-query",
        )
        self.assertIn("0.00", other_tenant.assistant_message)
        self.assertEqual(
            self.store.fetchone(
                "SELECT COUNT(*) AS count FROM expenses WHERE tenant_id = ?",
                ("tenant-b",),
            )["count"],
            0,
        )

    def test_unauthorized_mutations_are_rejected_without_writes(self) -> None:
        no_write = self.context(
            capabilities=frozenset({"expenses.read"}),
        )
        expense = self.turn(
            no_write,
            "دفعت لمحمد 11500 جنيه تشطيبات",
            "unauthorized-expense",
        )
        self.assertEqual(expense.metadata["error_type"], "AuthorizationError")
        self.assertEqual(self.store.fetchone("SELECT COUNT(*) AS count FROM expenses")["count"], 0)

        reminder = self.application
        with self.assertRaises(AuthorizationError):
            reminder.create_reminder(
                context=no_write,
                text="restricted",
                due_at=datetime.now(timezone.utc) + timedelta(days=1),
                timezone_name="Africa/Cairo",
                idempotency_key="unauthorized-reminder",
            )
        self.assertEqual(self.store.fetchone("SELECT COUNT(*) AS count FROM reminders")["count"], 0)

    def test_model_cannot_override_trusted_identity_fields(self) -> None:
        runtime = FirstPartyRuntime(
            gateway=MaliciousArgumentProvider(),
            application=self.application,
        )
        result = runtime.handle(
            TurnRequest(
                context=self.context("tenant-a", "user-a"),
                user_message="malicious",
                idempotency_key="identity-injection",
                allowed_capabilities=CAPABILITIES,
                deadline_at=datetime.now(timezone.utc) + timedelta(seconds=5),
            )
        )
        self.assertEqual(self.store.fetchone("SELECT COUNT(*) AS count FROM expenses")["count"], 0)
        self.assertEqual(result.metadata["error_type"], "ActionRejected")

    def test_allowed_capabilities_are_an_upper_bound(self) -> None:
        result = self.turn(
            self.context(),
            "دفعت لمحمد 11500 جنيه تشطيبات",
            "capability-denied",
        )
        self.assertIsNone(result.failure)

        denied = self.runtime.handle(
            TurnRequest(
                context=self.context(),
                user_message="دفعت لمحمد 11500 جنيه تشطيبات",
                idempotency_key="capability-missing",
                allowed_capabilities=frozenset({"expenses.read"}),
                deadline_at=datetime.now(timezone.utc) + timedelta(seconds=5),
            )
        )
        self.assertEqual(denied.metadata["error_type"], "AuthorizationError")

        no_server_write = self.runtime.handle(
            TurnRequest(
                context=self.context(capabilities=frozenset({"expenses.read"})),
                user_message="دفعت لمحمد 11500 جنيه تشطيبات",
                idempotency_key="application-final-check",
                allowed_capabilities=frozenset({"expenses.write"}),
                deadline_at=datetime.now(timezone.utc) + timedelta(seconds=5),
            )
        )
        self.assertEqual(no_server_write.metadata["error_type"], "AuthorizationError")

    def test_model_cannot_grant_itself_a_capability(self) -> None:
        runtime = FirstPartyRuntime(
            gateway=CapabilityInjectionProvider(),
            application=self.application,
        )
        result = runtime.handle(
            TurnRequest(
                context=self.context(capabilities=frozenset({"expenses.read"})),
                user_message="malicious",
                idempotency_key="capability-injection",
                allowed_capabilities=frozenset({"expenses.read"}),
                deadline_at=datetime.now(timezone.utc) + timedelta(seconds=5),
            )
        )
        self.assertEqual(result.metadata["error_type"], "ActionRejected")
        self.assertEqual(self.store.fetchone("SELECT COUNT(*) AS count FROM expenses")["count"], 0)

    def test_expense_and_reminder_mutations_are_idempotent(self) -> None:
        context = self.context()
        first = self.turn(context, "دفعت لمحمد 11500 جنيه تشطيبات", "expense-repeat")
        second = self.turn(context, "دفعت لمحمد 11500 جنيه تشطيبات", "expense-repeat")
        self.assertEqual(
            first.committed_actions[0].result["expense_id"],
            second.committed_actions[0].result["expense_id"],
        )
        self.assertEqual(self.store.fetchone("SELECT COUNT(*) AS count FROM expenses")["count"], 1)

        due_at = datetime.now(timezone.utc) + timedelta(days=1)
        first_reminder = self.application.create_reminder(
            context=context,
            text="same reminder",
            due_at=due_at,
            timezone_name="Africa/Cairo",
            idempotency_key="reminder-repeat",
        )
        second_reminder = self.application.create_reminder(
            context=context,
            text="same reminder",
            due_at=due_at,
            timezone_name="Africa/Cairo",
            idempotency_key="reminder-repeat",
        )
        self.assertEqual(first_reminder["reminder_id"], second_reminder["reminder_id"])
        self.assertEqual(self.store.fetchone("SELECT COUNT(*) AS count FROM reminders")["count"], 1)

    def test_persisted_expense_survives_store_restart(self) -> None:
        context = self.context()
        self.turn(context, "دفعت لمحمد 11500 جنيه تشطيبات", "restart-expense")
        self.store.close()
        self.store = SQLiteStore(self.path)
        self.application = ApplicationService(self.store)
        result = self.application.summarize_project_expenses(
            context=context,
            project_name="تشطيبات",
        )
        self.assertEqual(result["total_minor"], 1_150_000)

    def test_normal_reminder_delivery_is_not_repeated_after_restart(self) -> None:
        context = self.context()
        self.application.create_reminder(
            context=context,
            text="due reminder",
            due_at=datetime.now(timezone.utc) - timedelta(seconds=1),
            timezone_name="Africa/Cairo",
            idempotency_key="due-reminder",
        )
        worker = ReminderWorker(self.application)
        self.assertTrue(worker.run_once())
        self.assertFalse(worker.run_once())
        self.store.close()
        self.store = SQLiteStore(self.path)
        self.assertFalse(ReminderWorker(ApplicationService(self.store)).run_once())
        self.assertEqual(
            self.store.fetchone("SELECT status FROM reminders")["status"],
            "delivered",
        )

    def test_worker_crash_after_claim_is_recoverable_after_lease_expiry(self) -> None:
        context = self.context()
        self.application.create_reminder(
            context=context,
            text="claimed then crashed",
            due_at=datetime.now(timezone.utc) - timedelta(seconds=1),
            timezone_name="Africa/Cairo",
            idempotency_key="claimed-reminder",
        )
        claimed = self.application.claim_due_reminder(lease_seconds=60)
        self.assertIsNotNone(claimed)
        self.store.execute(
            "UPDATE reminders SET lease_until = ?",
            ("2000-01-01T00:00:00+00:00",),
        )
        self.store.close()
        self.store = SQLiteStore(self.path)
        self.assertTrue(
            ReminderWorker(ApplicationService(self.store), lease_seconds=60).run_once()
        )
        self.assertEqual(
            self.store.fetchone("SELECT status FROM reminders")["status"],
            "delivered",
        )
        self.assertEqual(
            self.store.fetchone("SELECT attempt_count FROM reminders")["attempt_count"],
            2,
        )

    def test_first_party_runtime_imports_without_hermes(self) -> None:
        imported_before = {
            name for name in sys.modules if name == "hermes" or name.startswith("hermes.")
        }
        self.assertEqual(imported_before, set())

    def test_failed_delivery_is_retryable_and_observable(self) -> None:
        context = self.context()
        self.application.create_reminder(
            context=context,
            text="retry me",
            due_at=datetime.now(timezone.utc) - timedelta(seconds=1),
            timezone_name="Africa/Cairo",
            idempotency_key="failed-delivery",
        )
        calls = []

        def fail_once(reminder):
            calls.append(reminder["id"])
            raise RuntimeError("temporary channel failure")

        worker = ReminderWorker(
            self.application,
            deliver=fail_once,
        )
        self.assertTrue(worker.run_once())
        row = self.store.fetchone(
            "SELECT status, last_error, attempt_count FROM reminders"
        )
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["last_error"], "temporary channel failure")
        self.assertEqual(row["attempt_count"], 1)

        worker = ReminderWorker(
            self.application,
            deliver=lambda reminder: calls.append(reminder["id"]),
        )
        self.assertTrue(worker.run_once())
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0], calls[1])
        self.assertEqual(
            self.store.fetchone("SELECT status FROM reminders")["status"],
            "delivered",
        )


class AuthenticationBoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        from apps.api.main import APIHandler, configure_server

        self.tempdir = tempfile.TemporaryDirectory()
        self.store = SQLiteStore(f"{self.tempdir.name}/api.sqlite3")
        self.runtime = FirstPartyRuntime(
            gateway=DeterministicDevelopmentProvider(),
            application=ApplicationService(self.store),
        )
        self.authenticator = DevelopmentAuthenticator(
            {
                "token-a": TrustedIdentity("tenant-a", "user-a", CAPABILITIES),
                "token-b": TrustedIdentity("tenant-b", "user-b", CAPABILITIES),
            }
        )
        self.server = configure_server(self.store, self.runtime, self.authenticator)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.store.close()
        self.tempdir.cleanup()

    def post(self, payload, token=None):
        request = urllib.request.Request(
            f"{self.url}/v1/turns",
            data=__import__("json").dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                **({"Authorization": f"Bearer {token}"} if token else {}),
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, __import__("json").loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, __import__("json").loads(error.read())

    def get(self, path):
        try:
            with urllib.request.urlopen(f"{self.url}{path}", timeout=1) as response:
                return response.status, __import__("json").loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, __import__("json").loads(error.read())

    def test_missing_and_invalid_identity_are_structured(self) -> None:
        status, body = self.post({"message": "دفعت لمحمد 10 جنيه"}, None)
        self.assertEqual(status, 401)
        self.assertEqual(body["error"]["code"], "authentication_required")

        status, body = self.post({"message": "دفعت لمحمد 10 جنيه"}, "invalid")
        self.assertEqual(status, 401)
        self.assertEqual(body["error"]["code"], "invalid_identity")

    def test_authenticated_identity_is_not_taken_from_request_body(self) -> None:
        status, body = self.post(
            {
                "tenant_id": "attacker-tenant",
                "user_id": "attacker-user",
                "message": "دفعت لمحمد 10 جنيه تشطيبات",
            },
            "token-a",
        )
        self.assertEqual(status, 200)
        self.assertEqual(
            self.store.fetchone(
                "SELECT tenant_id, user_id FROM expenses"
            )["tenant_id"],
            "tenant-a",
        )
        self.assertEqual(
            self.store.fetchone("SELECT user_id FROM expenses")["user_id"],
            "user-a",
        )

    def test_authenticated_user_cannot_read_other_identity_data(self) -> None:
        status, _ = self.post(
            {"message": "دفعت لمحمد 10 جنيه تشطيبات"},
            "token-a",
        )
        self.assertEqual(status, 200)
        status, body = self.post(
            {"message": "دفعت كام في التشطيبات؟"},
            "token-b",
        )
        self.assertEqual(status, 200)
        self.assertIn("0.00", body["assistant_message"])

    def test_health_and_readiness_are_distinct(self) -> None:
        status, body = self.get("/healthz")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")

        status, body = self.get("/readyz")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ready")

        self.store.readiness_check = lambda: False
        status, body = self.get("/readyz")
        self.assertEqual(status, 503)
        self.assertEqual(body["error"]["code"], "not_ready")

    def test_server_shutdown_stops_serving(self) -> None:
        self.server.shutdown()
        self.thread.join(timeout=2)
        self.assertFalse(self.thread.is_alive())


if __name__ == "__main__":
    unittest.main()
