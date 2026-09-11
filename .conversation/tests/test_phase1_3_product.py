from __future__ import annotations

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from apps.api.main import configure_server
from packages.agent_runtime.first_party import FirstPartyRuntime
from packages.application.use_cases import ApplicationService
from packages.identity.auth import DevelopmentAuthenticator, TrustedIdentity
from packages.llm.dev_provider import DeterministicDevelopmentProvider
from packages.persistence.sqlite import SQLiteStore


class Phase13ProductTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.path = f"{self.tempdir.name}/product.sqlite3"
        self.start_server()

    def start_server(self) -> None:
        self.store = SQLiteStore(self.path)
        self.runtime = FirstPartyRuntime(
            gateway=DeterministicDevelopmentProvider(),
            application=ApplicationService(self.store),
            timezone_name="Africa/Cairo",
        )
        self.server = configure_server(
            self.store,
            self.runtime,
            DevelopmentAuthenticator(
                {"dev-user": TrustedIdentity("development-tenant", "development-user")}
            ),
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def stop_server(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.store.close()

    def tearDown(self) -> None:
        self.stop_server()
        self.tempdir.cleanup()

    def request(self, method: str, path: str, payload: dict | None = None):
        data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
        request = urllib.request.Request(
            f"{self.url}{path}",
            data=data,
            headers={
                "Authorization": "Bearer dev-user",
                "Content-Type": "application/json",
            },
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                raw = response.read()
                return response.status, (
                    json.loads(raw) if response.headers.get_content_type() == "application/json" else raw
                )
        except urllib.error.HTTPError as error:
            raw = error.read()
            return error.code, json.loads(raw)

    def test_end_to_end_product_flow_and_restart(self) -> None:
        status, expense = self.request(
            "POST",
            "/v1/turns",
            {
                "message": "دفعت لمحمد 11500 جنيه تشطيبات",
                "conversation_id": "00000000-0000-0000-0000-000000000001",
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(expense["committed_actions"][0]["result"]["amount_minor"], 1_150_000)
        self.assertEqual(expense["committed_actions"][0]["result"]["currency"], "EGP")

        status, person_total = self.request(
            "POST",
            "/v1/turns",
            {"message": "محمد أخد مني كام؟"},
        )
        self.assertEqual(status, 200)
        self.assertIn("11,500.00", person_total["assistant_message"])
        self.assertEqual(
            person_total["proposed_actions"][0]["result"]["total_minor"],
            1_150_000,
        )

        status, linked_people = self.request(
            "POST",
            "/v1/turns",
            {"message": "مين مرتبط بمشروع التشطيبات؟"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(
            linked_people["proposed_actions"][0]["result"]["people"][0]["name"],
            "محمد",
        )

        status, reminder = self.request(
            "POST",
            "/v1/turns",
            {"message": "فكرني بكرة أكلم محمد"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(reminder["committed_actions"][0]["name"], "create_reminder")

        status, context = self.request("GET", "/v1/today")
        self.assertEqual(status, 200)
        self.assertEqual(len(context["context"]["recent_expenses"]), 1)
        self.assertEqual(context["context"]["recent_expenses"][0]["amount_minor"], 1_150_000)
        self.assertEqual(context["context"]["relevant_people"][0]["name"], "محمد")
        self.assertEqual(context["context"]["active_projects"][0]["name"], "تشطيبات")
        self.assertEqual(len(context["context"]["upcoming_reminders"]), 1)

        self.stop_server()
        self.start_server()

        status, after_restart = self.request("GET", "/v1/today")
        self.assertEqual(status, 200)
        self.assertEqual(len(after_restart["context"]["recent_expenses"]), 1)
        self.assertEqual(len(after_restart["context"]["upcoming_reminders"]), 1)

        status, query_after_restart = self.request(
            "POST",
            "/v1/turns",
            {"message": "دفعت كام في التشطيبات؟"},
        )
        self.assertEqual(status, 200)
        self.assertIn("11,500.00", query_after_restart["assistant_message"])

    def test_browser_surface_is_served_without_secrets(self) -> None:
        status, html = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("سكرتيري الشخصي", html.decode("utf-8"))

        status, javascript = self.request("GET", "/app.js")
        self.assertEqual(status, 200)
        source = javascript.decode("utf-8")
        for forbidden in ("DATABASE_URL", "service_role", "OPENAI_API_KEY", "GEMINI_API_KEY"):
            self.assertNotIn(forbidden, source)

    def test_context_endpoint_keeps_authentication_boundary(self) -> None:
        request = urllib.request.Request(f"{self.url}/v1/today", method="GET")
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(request, timeout=2)
        self.assertEqual(raised.exception.code, 401)


if __name__ == "__main__":
    unittest.main()