from __future__ import annotations

import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover - exercised only without optional driver
    psycopg = None
    dict_row = None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PostgresStore:
    """Postgres adapter implementing the application persistence port.

    The schema and RLS policies are deployed separately by Supabase migrations.
    This adapter is intentionally not imported by the default SQLite
    development path.
    """

    def __init__(self, dsn: str) -> None:
        if psycopg is None:
            raise RuntimeError(
                "Postgres persistence requires psycopg; install the project dependencies"
            )
        if not dsn:
            raise ValueError("A Postgres DATABASE_URL is required")
        self.connection = psycopg.connect(
            dsn,
            row_factory=dict_row,
            autocommit=True,
        )

    @contextmanager
    def transaction(self) -> Iterator[Any]:
        with self.connection.transaction():
            yield self.connection

    def close(self) -> None:
        self.connection.close()

    @staticmethod
    def _id() -> str:
        return str(uuid.uuid4())

    def find_person_id(self, *, tenant_id: str, owner_user_id: str, name: str) -> str | None:
        row = self.connection.execute(
            """
            SELECT id FROM people
            WHERE tenant_id = %s AND owner_user_id = %s AND name_key = lower(%s)
              AND status = 'active'
            """,
            (tenant_id, owner_user_id, name),
        ).fetchone()
        return str(row["id"]) if row else None

    def create_person(
        self, *, tenant_id: str, owner_user_id: str, name: str, created_at: datetime
    ) -> str:
        person_id = self._id()
        self.connection.execute(
            """
            INSERT INTO people
              (id, tenant_id, owner_user_id, display_name, name_key, status,
               created_at, updated_at)
            VALUES (%s, %s, %s, %s, lower(%s), 'active', %s, %s)
            """,
            (person_id, tenant_id, owner_user_id, name, name, created_at, created_at),
        )
        return person_id

    def find_project_id(self, *, tenant_id: str, owner_user_id: str, name: str) -> str | None:
        row = self.connection.execute(
            """
            SELECT id FROM projects
            WHERE tenant_id = %s AND owner_user_id = %s AND name_key = lower(%s)
              AND status <> 'archived'
            """,
            (tenant_id, owner_user_id, name),
        ).fetchone()
        return str(row["id"]) if row else None

    def create_project(
        self, *, tenant_id: str, owner_user_id: str, name: str, created_at: datetime
    ) -> str:
        project_id = self._id()
        self.connection.execute(
            """
            INSERT INTO projects
              (id, tenant_id, owner_user_id, name, name_key, status,
               created_at, updated_at)
            VALUES (%s, %s, %s, %s, lower(%s), 'active', %s, %s)
            """,
            (project_id, tenant_id, owner_user_id, name, name, created_at, created_at),
        )
        return project_id

    def create_expense(self, **values: Any) -> str:
        expense_id = self._id()
        self.connection.execute(
            """
            INSERT INTO expenses
              (id, tenant_id, owner_user_id, amount_minor, currency_code,
               description, person_id, project_id, occurred_at, created_at,
               updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                expense_id,
                values["tenant_id"],
                values["owner_user_id"],
                values["amount_minor"],
                values["currency"],
                values["description"],
                values["person_id"],
                values["project_id"],
                values["occurred_at"],
                values["created_at"],
                values["created_at"],
            ),
        )
        return expense_id

    def summarize_project_expenses(
        self, *, tenant_id: str, owner_user_id: str, project_name: str
    ) -> dict[str, Any]:
        project = self.connection.execute(
            """
            SELECT id, name FROM projects
            WHERE tenant_id = %s AND owner_user_id = %s AND name_key = lower(%s)
              AND status <> 'archived'
            """,
            (tenant_id, owner_user_id, project_name),
        ).fetchone()
        if not project:
            return {
                "project_name": project_name,
                "total_minor": 0,
                "currency": None,
                "expense_count": 0,
            }
        rows = self.connection.execute(
            """
            SELECT currency_code AS currency,
                   COALESCE(SUM(amount_minor), 0) AS total_minor,
                   COUNT(*) AS expense_count
            FROM expenses
            WHERE tenant_id = %s AND owner_user_id = %s AND project_id = %s
            GROUP BY currency_code
            """,
            (tenant_id, owner_user_id, project["id"]),
        ).fetchall()
        if len(rows) != 1:
            return {
                "project_id": str(project["id"]),
                "project_name": project["name"],
                "total_minor": 0,
                "currency": None,
                "currency_totals": [
                    {
                        "currency": row["currency"],
                        "total_minor": int(row["total_minor"]),
                        "expense_count": int(row["expense_count"]),
                    }
                    for row in rows
                ],
                "expense_count": sum(int(row["expense_count"]) for row in rows),
            }
        row = rows[0]
        return {
            "project_id": str(project["id"]),
            "project_name": project["name"],
            "total_minor": int(row["total_minor"]),
            "currency": row["currency"],
            "expense_count": int(row["expense_count"]),
        }

    def summarize_person_expenses(
        self, *, tenant_id: str, owner_user_id: str, person_name: str
    ) -> dict[str, Any]:
        person = self.connection.execute(
            """
            SELECT id, display_name AS name FROM people
            WHERE tenant_id = %s AND owner_user_id = %s
              AND name_key = lower(%s) AND status = 'active'
            """,
            (tenant_id, owner_user_id, person_name),
        ).fetchone()
        if not person:
            return {
                "person_name": person_name,
                "total_minor": 0,
                "currency": None,
                "expense_count": 0,
            }
        rows = self.connection.execute(
            """
            SELECT currency_code AS currency,
                   COALESCE(SUM(amount_minor), 0) AS total_minor,
                   COUNT(*) AS expense_count
            FROM expenses
            WHERE tenant_id = %s AND owner_user_id = %s AND person_id = %s
            GROUP BY currency_code
            """,
            (tenant_id, owner_user_id, person["id"]),
        ).fetchall()
        if len(rows) != 1:
            return {
                "person_id": str(person["id"]),
                "person_name": person["name"],
                "total_minor": sum(int(row["total_minor"]) for row in rows),
                "currency": None,
                "currency_totals": [
                    {
                        "currency": row["currency"],
                        "total_minor": int(row["total_minor"]),
                        "expense_count": int(row["expense_count"]),
                    }
                    for row in rows
                ],
                "expense_count": sum(int(row["expense_count"]) for row in rows),
            }
        row = rows[0]
        return {
            "person_id": str(person["id"]),
            "person_name": person["name"],
            "total_minor": int(row["total_minor"]),
            "currency": row["currency"],
            "expense_count": int(row["expense_count"]),
        }

    def list_project_people(
        self, *, tenant_id: str, owner_user_id: str, project_name: str
    ) -> dict[str, Any]:
        project = self.connection.execute(
            """
            SELECT id, name FROM projects
            WHERE tenant_id = %s AND owner_user_id = %s
              AND name_key = lower(%s) AND status <> 'archived'
            """,
            (tenant_id, owner_user_id, project_name),
        ).fetchone()
        if not project:
            return {"project_name": project_name, "people": []}
        people = self.connection.execute(
            """
            SELECT DISTINCT people.id, people.display_name AS name
            FROM project_people
            JOIN people ON people.id = project_people.person_id
            WHERE project_people.tenant_id = %s
              AND project_people.project_id = %s
              AND project_people.ended_at IS NULL
            ORDER BY name
            """,
            (tenant_id, project["id"]),
        ).fetchall()
        # Expenses are also a meaningful relationship for the current runtime.
        expense_people = self.connection.execute(
            """
            SELECT DISTINCT people.id, people.display_name AS name
            FROM expenses
            JOIN people ON people.id = expenses.person_id
            WHERE expenses.tenant_id = %s AND expenses.owner_user_id = %s
              AND expenses.project_id = %s
            """,
            (tenant_id, owner_user_id, project["id"]),
        ).fetchall()
        merged = {str(row["id"]): {"id": str(row["id"]), "name": row["name"]} for row in people}
        merged.update(
            {str(row["id"]): {"id": str(row["id"]), "name": row["name"]} for row in expense_people}
        )
        return {
            "project_id": str(project["id"]),
            "project_name": project["name"],
            "people": sorted(merged.values(), key=lambda row: row["name"].casefold()),
        }

    def get_today_context(
        self, *, tenant_id: str, owner_user_id: str, now: datetime
    ) -> dict[str, Any]:
        reminders = self.connection.execute(
            """
            SELECT id, text, due_at, timezone, lifecycle_status, delivery_status
            FROM reminders
            WHERE tenant_id = %s AND owner_user_id = %s
              AND lifecycle_status = 'scheduled'
              AND delivery_status IN ('pending', 'claimed')
            ORDER BY due_at ASC
            LIMIT 8
            """,
            (tenant_id, owner_user_id),
        ).fetchall()
        expenses = self.connection.execute(
            """
            SELECT expenses.id, expenses.amount_minor, expenses.currency_code AS currency,
                   expenses.description, expenses.occurred_at,
                   people.display_name AS person_name, projects.name AS project_name
            FROM expenses
            LEFT JOIN people ON people.id = expenses.person_id
            LEFT JOIN projects ON projects.id = expenses.project_id
            WHERE expenses.tenant_id = %s AND expenses.owner_user_id = %s
            ORDER BY expenses.occurred_at DESC
            LIMIT 8
            """,
            (tenant_id, owner_user_id),
        ).fetchall()
        projects = self.connection.execute(
            """
            SELECT id, name, created_at
            FROM projects
            WHERE tenant_id = %s AND owner_user_id = %s AND status <> 'archived'
            ORDER BY created_at DESC
            LIMIT 8
            """,
            (tenant_id, owner_user_id),
        ).fetchall()
        people = self.connection.execute(
            """
            SELECT id, display_name AS name
            FROM people
            WHERE tenant_id = %s AND owner_user_id = %s AND status = 'active'
            ORDER BY lower(display_name)
            LIMIT 12
            """,
            (tenant_id, owner_user_id),
        ).fetchall()
        tasks = self.connection.execute(
            """
            SELECT id, title, due_at, status
            FROM tasks
            WHERE tenant_id = %s AND owner_user_id = %s
              AND status NOT IN ('completed', 'cancelled')
            ORDER BY due_at NULLS LAST, created_at DESC
            LIMIT 8
            """,
            (tenant_id, owner_user_id),
        ).fetchall()
        return {
            "upcoming_reminders": [dict(row) for row in reminders],
            "recent_expenses": [dict(row) for row in expenses],
            "active_projects": [dict(row) for row in projects],
            "relevant_people": [dict(row) for row in people],
            "pending_tasks": [dict(row) for row in tasks],
            "as_of": now.isoformat(),
        }

    def create_reminder(self, **values: Any) -> None:
        self.connection.execute(
            """
            INSERT INTO reminders
              (id, tenant_id, owner_user_id, text, due_at, timezone,
               lifecycle_status, delivery_status, attempt_count, created_at,
               updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, 'scheduled', 'pending', 0, %s, %s)
            """,
            (
                values["reminder_id"],
                values["tenant_id"],
                values["owner_user_id"],
                values["text"],
                values["due_at"].astimezone(timezone.utc),
                values["timezone_name"],
                values["created_at"],
                values["created_at"],
            ),
        )

    def claim_due_reminder(
        self, lease_seconds: int = 60, tenant_id: str | None = None
    ) -> dict[str, Any] | None:
        now = utc_now()
        lease_until = now + timedelta(seconds=lease_seconds)
        scope_sql = "AND tenant_id = %s" if tenant_id else ""
        scope_params: tuple[Any, ...] = (tenant_id,) if tenant_id else ()
        with self.transaction():
            row = self.connection.execute(
                f"""
                SELECT id, tenant_id, owner_user_id, text, due_at, timezone,
                       attempt_count, last_error
                FROM reminders
                WHERE due_at <= %s
                  AND lifecycle_status = 'scheduled'
                  AND (
                    delivery_status = 'pending'
                    OR (delivery_status = 'claimed' AND lease_until <= %s)
                  )
                  {scope_sql}
                ORDER BY due_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
                """,
                (now, now, *scope_params),
            ).fetchone()
            if not row:
                return None
            self.connection.execute(
                """
                UPDATE reminders
                SET delivery_status = 'claimed',
                    claimed_at = %s,
                    lease_until = %s,
                    attempt_count = attempt_count + 1,
                    updated_at = %s
                WHERE id = %s
                """,
                (now, lease_until, now, row["id"]),
            )
            claimed = dict(row)
            claimed["user_id"] = str(row["owner_user_id"])
            claimed["id"] = str(row["id"])
            claimed["claimed_at"] = now
            claimed["lease_until"] = lease_until
            claimed["attempt_count"] = int(row["attempt_count"]) + 1
            self.audit_service(
                event_id=self._id(),
                tenant_id=str(row["tenant_id"]),
                event_type="reminder.claimed",
                payload={"reminder_id": str(row["id"]), "attempt_count": claimed["attempt_count"]},
            )
            return claimed

    def mark_reminder_delivered(self, reminder_id: str) -> None:
        row = self.connection.execute(
            "SELECT tenant_id FROM reminders WHERE id = %s AND delivery_status = 'claimed'",
            (reminder_id,),
        ).fetchone()
        self.connection.execute(
            """
            UPDATE reminders
            SET delivery_status = 'delivered',
                claimed_at = NULL,
                lease_until = NULL,
                last_error = NULL,
                delivered_at = now(),
                updated_at = now()
            WHERE id = %s AND delivery_status = 'claimed'
            """,
            (reminder_id,),
        )
        if row:
            self.audit_service(
                event_id=self._id(),
                tenant_id=str(row["tenant_id"]),
                event_type="reminder.delivered",
                payload={"reminder_id": reminder_id},
            )

    def mark_reminder_failed(self, reminder_id: str, error: str) -> None:
        row = self.connection.execute(
            "SELECT tenant_id FROM reminders WHERE id = %s AND delivery_status = 'claimed'",
            (reminder_id,),
        ).fetchone()
        self.connection.execute(
            """
            UPDATE reminders
            SET delivery_status = 'pending',
                claimed_at = NULL,
                lease_until = NULL,
                last_error = %s,
                updated_at = now()
            WHERE id = %s AND delivery_status = 'claimed'
            """,
            (error[:1000], reminder_id),
        )
        if row:
            self.audit_service(
                event_id=self._id(),
                tenant_id=str(row["tenant_id"]),
                event_type="reminder.failed",
                payload={"reminder_id": reminder_id, "error": error[:1000]},
            )

    def get_idempotent(self, tenant_id: str, user_id: str, key: str) -> dict[str, Any] | None:
        row = self.connection.execute(
            """
            SELECT request_fingerprint, response
            FROM idempotency_records
            WHERE tenant_id = %s AND owner_user_id = %s AND idempotency_key = %s
            """,
            (tenant_id, user_id, key),
        ).fetchone()
        if not row:
            return None
        return {
            "request_fingerprint": row["request_fingerprint"],
            "result_json": json.dumps(row["response"], ensure_ascii=False),
        }

    def save_idempotent(
        self,
        tenant_id: str,
        user_id: str,
        key: str,
        fingerprint: str,
        result: dict[str, Any],
    ) -> None:
        self.connection.execute(
            """
            INSERT INTO idempotency_records
              (id, tenant_id, owner_user_id, operation, idempotency_key,
               request_fingerprint, status, response, created_at, updated_at)
            VALUES (%s, %s, %s, 'application.use_case', %s, %s, 'completed',
                    %s, now(), now())
            """,
            (self._id(), tenant_id, user_id, key, fingerprint, json.dumps(result)),
        )

    def audit(
        self,
        *,
        event_id: str,
        tenant_id: str,
        user_id: str,
        conversation_id: str | None,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        persisted_conversation_id = conversation_id
        if conversation_id is not None:
            row = self.connection.execute(
                """
                SELECT 1 FROM conversations
                WHERE tenant_id = %s AND id = %s
                """,
                (tenant_id, conversation_id),
            ).fetchone()
            if not row:
                # The current Phase 1 runtime carries a conversation scope but
                # does not yet persist conversation rows. Keep the audit event
                # durable without inventing a foreign record.
                persisted_conversation_id = None
        self.connection.execute(
            """
            INSERT INTO audit_events
              (id, tenant_id, actor_type, actor_id, event_type,
               conversation_id, payload, created_at)
            VALUES (%s, %s, 'user', %s, %s, %s, %s, now())
            """,
            (
                event_id,
                tenant_id,
                user_id,
                event_type,
                persisted_conversation_id,
                json.dumps(payload),
            ),
        )

    def audit_service(
        self,
        *,
        event_id: str,
        tenant_id: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        self.connection.execute(
            """
            INSERT INTO audit_events
              (id, tenant_id, actor_type, actor_id, event_type, payload, created_at)
            VALUES (%s, %s, 'service', NULL, %s, %s, now())
            """,
            (event_id, tenant_id, event_type, json.dumps(payload)),
        )

    def readiness_check(self) -> bool:
        try:
            row = self.connection.execute("SELECT 1 AS ok").fetchone()
            return bool(row and row["ok"] == 1)
        except Exception:
            return False