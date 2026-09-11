from __future__ import annotations

import os
import unittest
import uuid
from pathlib import Path

try:
    import psycopg
    from psycopg.conninfo import make_conninfo
except ImportError:  # pragma: no cover - optional integration dependency
    psycopg = None
    make_conninfo = None

from packages.application.use_cases import ApplicationService
from packages.contracts.models import ExecutionContext
from packages.persistence.postgres import PostgresStore


POSTGRES_DSN = os.getenv("TEST_POSTGRES_DSN")


@unittest.skipUnless(
    psycopg is not None and POSTGRES_DSN,
    "Set TEST_POSTGRES_DSN and install psycopg to run Postgres integration tests",
)
class PostgresFoundationTests(unittest.TestCase):
    """Runs against an operator-provided clean Supabase/Postgres database."""

    @classmethod
    def setUpClass(cls) -> None:
        assert psycopg is not None
        cls.connection = psycopg.connect(POSTGRES_DSN, autocommit=True)
        root = Path(__file__).parents[1]
        for migration in sorted((root / "supabase" / "migrations").glob("*.sql")):
            cls.connection.execute(migration.read_text())
        cls._create_test_roles()
        cls._seed_isolation_fixture()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.connection.close()

    @classmethod
    def _create_test_roles(cls) -> None:
        for role in ("phase12_user_a", "phase12_user_b"):
            exists = cls.connection.execute(
                "SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)
            ).fetchone()
            if not exists:
                cls.connection.execute(f"CREATE ROLE {role} LOGIN")
            cls.connection.execute(
                f"GRANT USAGE ON SCHEMA public, app, auth TO {role}"
            )
            cls.connection.execute(
                f"GRANT EXECUTE ON FUNCTION app.current_product_user_id() TO {role}"
            )
            cls.connection.execute(
                f"GRANT EXECUTE ON FUNCTION app.is_active_tenant_member(uuid) TO {role}"
            )
            cls.connection.execute(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {role}"
            )
            cls.connection.execute(
                f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {role}"
            )
        service_exists = cls.connection.execute(
            "SELECT 1 FROM pg_roles WHERE rolname = 'phase12_service'"
        ).fetchone()
        if not service_exists:
            cls.connection.execute("CREATE ROLE phase12_service LOGIN BYPASSRLS")
        cls.connection.execute(
            "GRANT USAGE ON SCHEMA public, app, auth TO phase12_service"
        )
        cls.connection.execute(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO phase12_service"
        )

    @classmethod
    def _seed_isolation_fixture(cls) -> None:
        cls.tenant_a = uuid.uuid4()
        cls.tenant_b = uuid.uuid4()
        cls.user_a = uuid.uuid4()
        cls.user_b = uuid.uuid4()
        cls.auth_a = uuid.uuid4()
        cls.auth_b = uuid.uuid4()
        cls.project_a = uuid.uuid4()
        cls.project_b = uuid.uuid4()
        cls.person_a = uuid.uuid4()
        cls.person_b = uuid.uuid4()
        cls.connection.execute(
            "INSERT INTO tenants (id, name, slug) VALUES (%s, 'Tenant A', %s), (%s, 'Tenant B', %s)",
            (
                cls.tenant_a,
                f"tenant-a-{cls.tenant_a}",
                cls.tenant_b,
                f"tenant-b-{cls.tenant_b}",
            ),
        )
        cls.connection.execute(
            """
            INSERT INTO users (id, auth_subject, display_name)
            VALUES (%s, %s, 'User A'), (%s, %s, 'User B')
            """,
            (cls.user_a, cls.auth_a, cls.user_b, cls.auth_b),
        )
        cls.connection.execute(
            """
            INSERT INTO tenant_memberships (tenant_id, user_id, status)
            VALUES (%s, %s, 'active'), (%s, %s, 'active')
            """,
            (cls.tenant_a, cls.user_a, cls.tenant_b, cls.user_b),
        )
        cls.connection.execute(
            """
            INSERT INTO currency_metadata (code, minor_unit_exponent, display_name)
            VALUES ('USD', 2, 'US Dollar')
            """
        )
        cls.connection.execute(
            """
            INSERT INTO people (id, tenant_id, owner_user_id, display_name, name_key)
            VALUES (%s, %s, %s, 'Person A', 'person a'),
                   (%s, %s, %s, 'Person B', 'person b')
            """,
            (
                cls.person_a,
                cls.tenant_a,
                cls.user_a,
                cls.person_b,
                cls.tenant_b,
                cls.user_b,
            ),
        )
        cls.connection.execute(
            """
            INSERT INTO projects (id, tenant_id, owner_user_id, name, name_key)
            VALUES (%s, %s, %s, 'Project A', 'project a'),
                   (%s, %s, %s, 'Project B', 'project b')
            """,
            (
                cls.project_a,
                cls.tenant_a,
                cls.user_a,
                cls.project_b,
                cls.tenant_b,
                cls.user_b,
            ),
        )

    @classmethod
    def _as_user_a(cls):
        connection = psycopg.connect(cls._user_dsn("phase12_user_a"), autocommit=True)
        connection.execute(
            "SELECT set_config('request.jwt.claim.sub', %s, false)",
            (str(cls.auth_a),),
        )
        return connection

    @classmethod
    def _user_dsn(cls, role: str) -> str:
        assert make_conninfo is not None
        return make_conninfo(POSTGRES_DSN, user=role)

    @classmethod
    def _user_store(cls) -> PostgresStore:
        store = PostgresStore(cls._user_dsn("phase12_user_a"))
        store.connection.execute(
            "SELECT set_config('request.jwt.claim.sub', %s, false)",
            (str(cls.auth_a),),
        )
        return store

    def test_expected_tables_exist(self) -> None:
        expected = {
            "tenants",
            "users",
            "tenant_memberships",
            "currency_metadata",
            "people",
            "relationships",
            "projects",
            "project_people",
            "tasks",
            "expenses",
            "commitments",
            "events",
            "reminders",
            "memories",
            "memory_people",
            "memory_projects",
            "memory_tasks",
            "memory_commitments",
            "permissions",
            "conversations",
            "conversation_turns",
            "conversation_people",
            "conversation_projects",
            "conversation_tasks",
            "conversation_commitments",
            "tool_calls",
            "idempotency_records",
            "audit_events",
            "domain_events",
        }
        rows = self.connection.execute(
            """
            SELECT tablename FROM pg_tables
            WHERE schemaname = 'public'
              AND tablename = ANY(%s)
            """,
            (list(expected),),
        ).fetchall()
        self.assertEqual({row[0] for row in rows}, expected)

    def test_rls_is_enabled_on_tenant_tables(self) -> None:
        rows = self.connection.execute(
            """
            SELECT relname
            FROM pg_class
            WHERE relnamespace = 'public'::regnamespace
              AND relrowsecurity
            """
        ).fetchall()
        enabled = {row[0] for row in rows}
        self.assertTrue({"people", "expenses", "reminders", "memories"} <= enabled)

    def test_tenant_scope_columns_are_required_and_money_is_integer_minor_units(self) -> None:
        tenant_tables = [
            "people",
            "relationships",
            "projects",
            "project_people",
            "tasks",
            "expenses",
            "commitments",
            "events",
            "reminders",
            "memories",
            "memory_people",
            "memory_projects",
            "memory_tasks",
            "memory_commitments",
            "permissions",
            "conversations",
            "conversation_turns",
            "tool_calls",
            "idempotency_records",
            "audit_events",
            "domain_events",
        ]
        nullable = self.connection.execute(
            """
            SELECT table_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND column_name = 'tenant_id'
              AND is_nullable <> 'NO'
              AND table_name = ANY(%s)
            """,
            (tenant_tables,),
        ).fetchall()
        self.assertEqual(nullable, [])
        money = self.connection.execute(
            """
            SELECT data_type, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'expenses'
              AND column_name = 'amount_minor'
            """
        ).fetchone()
        currency = self.connection.execute(
            """
            SELECT data_type, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'expenses'
              AND column_name = 'currency_code'
            """
        ).fetchone()
        self.assertEqual(money[0], "bigint")
        self.assertEqual(currency, ("character", 3))

    def test_identity_helpers_are_security_definer_with_fixed_search_path(self) -> None:
        rows = self.connection.execute(
            """
            SELECT proname, proconfig
            FROM pg_proc
            WHERE pronamespace = 'app'::regnamespace
              AND proname IN ('current_product_user_id', 'is_active_tenant_member')
            """
        ).fetchall()
        self.assertEqual({row[0] for row in rows}, {
            "current_product_user_id",
            "is_active_tenant_member",
        })
        self.assertTrue(
            all(row[1] and any("search_path=public, app, pg_temp" in item for item in row[1])
                for row in rows)
        )

    def test_composite_foreign_keys_exist(self) -> None:
        count = self.connection.execute(
            """
            SELECT count(*)
            FROM pg_constraint
            WHERE contype = 'f'
              AND conname LIKE '%tenant%'
            """
        ).fetchone()[0]
        self.assertGreaterEqual(count, 8)

    def test_idempotency_unique_constraint_exists(self) -> None:
        exists = self.connection.execute(
            """
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'idempotency_records'
              AND indexdef LIKE '%tenant_id%'
                AND indexdef LIKE '%idempotency_key%'
            """
        ).fetchone()
        self.assertIsNotNone(exists)

    def test_user_a_reads_only_own_tenant_and_owner_records(self) -> None:
        connection = self._as_user_a()
        try:
            self.assertEqual(
                connection.execute("SELECT app.current_product_user_id()").fetchone()[0],
                self.user_a,
            )
            projects = connection.execute(
                "SELECT id, tenant_id, owner_user_id FROM projects ORDER BY id"
            ).fetchall()
            tenants = connection.execute("SELECT id FROM tenants").fetchall()
            self.assertGreaterEqual(len(projects), 1)
            self.assertTrue(
                all(row[1] == self.tenant_a and row[2] == self.user_a for row in projects)
            )
            self.assertEqual({row[0] for row in tenants}, {self.tenant_a})
        finally:
            connection.close()

    def test_application_idempotency_is_durable(self) -> None:
        store = self._user_store()
        try:
            application = ApplicationService(store)
            context = ExecutionContext(
                tenant_id=str(self.tenant_a),
                user_id=str(self.user_a),
                conversation_id=str(uuid.uuid4()),
                channel="integration-test",
                capabilities=frozenset({"expenses.write"}),
            )
            first = application.record_expense(
                context=context,
                amount_minor=1250,
                currency="USD",
                description="idempotent expense",
                person_name=None,
                project_name="Idempotency Project",
                idempotency_key="postgres-idempotency-test",
            )
            second = application.record_expense(
                context=context,
                amount_minor=1250,
                currency="USD",
                description="idempotent expense",
                person_name=None,
                project_name="Idempotency Project",
                idempotency_key="postgres-idempotency-test",
            )
            self.assertEqual(first, second)
            self.assertEqual(
                store.connection.execute(
                    """
                    SELECT count(*) FROM expenses
                    WHERE tenant_id = %s AND description = 'idempotent expense'
                    """,
                    (self.tenant_a,),
                ).fetchone()["count"],
                1,
            )
        finally:
            store.close()

    def test_product_read_queries_use_the_postgres_persistence_port(self) -> None:
        store = self._user_store()
        try:
            application = ApplicationService(store)
            context = ExecutionContext(
                tenant_id=str(self.tenant_a),
                user_id=str(self.user_a),
                conversation_id=str(uuid.uuid4()),
                channel="integration-test",
                capabilities=frozenset(
                    {"context.read", "expenses.read", "people.read"}
                ),
            )
            person_total = application.summarize_person_expenses(
                context=context,
                person_name="Person A",
            )
            project_people = application.list_project_people(
                context=context,
                project_name="Project A",
            )
            today = application.get_today_context(context=context)
            self.assertEqual(person_total["total_minor"], 0)
            self.assertEqual(project_people["people"], [])
            self.assertTrue(
                all("amount_minor" in expense for expense in today["recent_expenses"])
            )
        finally:
            store.close()

    def test_reminder_lease_allows_one_claim_and_persists_delivery(self) -> None:
        reminder_id = uuid.uuid4()
        other_tenant_reminder_id = uuid.uuid4()
        self.connection.execute(
            """
            INSERT INTO reminders
              (id, tenant_id, owner_user_id, text, due_at, timezone,
               lifecycle_status, delivery_status, attempt_count, created_at)
            VALUES (%s, %s, %s, 'integration reminder', now(), 'UTC',
                    'scheduled', 'pending', 0, now())
            """,
            (reminder_id, self.tenant_a, self.user_a),
        )
        self.connection.execute(
            """
            INSERT INTO reminders
              (id, tenant_id, owner_user_id, text, due_at, timezone,
               lifecycle_status, delivery_status, attempt_count, created_at)
            VALUES (%s, %s, %s, 'other tenant reminder', now(), 'UTC',
                    'scheduled', 'pending', 0, now())
            """,
            (other_tenant_reminder_id, self.tenant_b, self.user_b),
        )
        first_store = PostgresStore(self._user_dsn("phase12_service"))
        second_store = PostgresStore(self._user_dsn("phase12_service"))
        try:
            first = first_store.claim_due_reminder(
                lease_seconds=60, tenant_id=str(self.tenant_a)
            )
            second = second_store.claim_due_reminder(
                lease_seconds=60, tenant_id=str(self.tenant_a)
            )
            self.assertIsNotNone(first)
            self.assertIsNone(second)
            self.assertEqual(
                self.connection.execute(
                    "SELECT attempt_count, delivery_status FROM reminders WHERE id = %s",
                    (reminder_id,),
                ).fetchone(),
                (1, "claimed"),
            )
            self.assertEqual(
                self.connection.execute(
                    "SELECT delivery_status FROM reminders WHERE id = %s",
                    (other_tenant_reminder_id,),
                ).fetchone()[0],
                "pending",
            )
            first_store.mark_reminder_delivered(str(reminder_id))
            self.assertEqual(
                self.connection.execute(
                    "SELECT delivery_status FROM reminders WHERE id = %s",
                    (reminder_id,),
                ).fetchone()[0],
                "delivered",
            )
        finally:
            first_store.close()
            second_store.close()

    def test_user_a_cannot_insert_another_tenant_or_owner(self) -> None:
        connection = self._as_user_a()
        try:
            with self.assertRaises(Exception):
                connection.execute(
                    """
                    INSERT INTO projects (id, tenant_id, owner_user_id, name, name_key)
                    VALUES (%s, %s, %s, 'bad tenant', 'bad tenant')
                    """,
                    (uuid.uuid4(), self.tenant_b, self.user_a),
                )
            with self.assertRaises(Exception):
                connection.execute(
                    """
                    INSERT INTO projects (id, tenant_id, owner_user_id, name, name_key)
                    VALUES (%s, %s, %s, 'bad owner', 'bad owner')
                    """,
                    (uuid.uuid4(), self.tenant_a, self.user_b),
                )
        finally:
            connection.close()

    def test_cross_tenant_references_and_relationships_are_rejected(self) -> None:
        connection = self._as_user_a()
        try:
            with self.assertRaises(Exception):
                connection.execute(
                    """
                    INSERT INTO expenses
                      (id, tenant_id, owner_user_id, amount_minor, currency_code,
                       description, person_id, project_id, occurred_at)
                    VALUES (%s, %s, %s, 100, 'USD', 'cross tenant',
                            %s, %s, now())
                    """,
                    (
                        uuid.uuid4(),
                        self.tenant_a,
                        self.user_a,
                        self.person_b,
                        self.project_a,
                    ),
                )
            with self.assertRaises(Exception):
                connection.execute(
                    """
                    INSERT INTO relationships
                      (id, tenant_id, source_person_id, target_person_id,
                       relationship_type, created_by_user_id)
                    VALUES (%s, %s, %s, %s, 'knows', %s)
                    """,
                    (
                        uuid.uuid4(),
                        self.tenant_a,
                        self.person_a,
                        self.person_b,
                        self.user_a,
                    ),
                )
        finally:
            connection.close()

    def test_revoked_and_suspended_memberships_lose_access(self) -> None:
        connection = self._as_user_a()
        try:
            self.assertGreater(
                connection.execute("SELECT count(*) FROM projects").fetchone()[0], 0
            )
            self.connection.execute(
                """
                UPDATE tenant_memberships SET status = 'suspended'
                WHERE tenant_id = %s AND user_id = %s
                """,
                (self.tenant_a, self.user_a),
            )
            self.assertEqual(
                connection.execute("SELECT count(*) FROM projects").fetchone()[0], 0
            )
            self.connection.execute(
                """
                UPDATE tenant_memberships SET status = 'removed'
                WHERE tenant_id = %s AND user_id = %s
                """,
                (self.tenant_a, self.user_a),
            )
            self.assertEqual(
                connection.execute("SELECT count(*) FROM projects").fetchone()[0], 0
            )
        finally:
            self.connection.execute(
                """
                UPDATE tenant_memberships SET status = 'active'
                WHERE tenant_id = %s AND user_id = %s
                """,
                (self.tenant_a, self.user_a),
            )
            connection.close()

    def test_permission_cannot_be_self_granted_by_authenticated_runtime(self) -> None:
        connection = self._as_user_a()
        try:
            with self.assertRaises(Exception):
                connection.execute(
                    """
                    INSERT INTO permissions
                      (tenant_id, grantee_type, grantee_id, capability,
                       access_level, scope_type, granted_by_user_id)
                    VALUES (%s, 'assistant', %s, 'expenses.write',
                            'EXECUTE', 'tenant', %s)
                    """,
                    (self.tenant_a, self.user_a, self.user_a),
                )
        finally:
            connection.close()