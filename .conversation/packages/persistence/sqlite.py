from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (tenant_id, user_id, name)
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (tenant_id, user_id, name)
);

CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
    currency TEXT NOT NULL,
    description TEXT NOT NULL,
    person_id TEXT REFERENCES people(id),
    project_id TEXT REFERENCES projects(id),
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    due_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'delivered', 'cancelled')),
    claimed_at TEXT,
    lease_until TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    conversation_id TEXT,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_project
    ON expenses (tenant_id, user_id, project_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_reminders_due
    ON reminders (status, due_at);
"""


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


class SQLiteStore:
    """Durable development adapter behind the persistence boundary.

    Production deployment can replace this adapter with Postgres/Supabase
    without changing domain or application use cases.
    """

    def __init__(self, path: str | Path = "data/personal-ai-os.sqlite3") -> None:
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(
            self.path,
            check_same_thread=False,
            isolation_level=None,
        )
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.execute("PRAGMA journal_mode = WAL")
        self.connection.executescript(SCHEMA)
        self._ensure_reminder_columns()

    def _ensure_reminder_columns(self) -> None:
        """Upgrade databases created by the initial Phase 1 schema in place."""
        columns = {
            row["name"]
            for row in self.connection.execute("PRAGMA table_info(reminders)")
        }
        additions = {
            "claimed_at": "TEXT",
            "lease_until": "TEXT",
            "attempt_count": "INTEGER NOT NULL DEFAULT 0",
            "last_error": "TEXT",
        }
        for name, definition in additions.items():
            if name not in columns:
                self.connection.execute(
                    f"ALTER TABLE reminders ADD COLUMN {name} {definition}"
                )

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            yield self.connection
        except Exception:
            self.connection.rollback()
            raise
        else:
            self.connection.commit()

    def close(self) -> None:
        self.connection.close()

    def find_person_id(
        self, *, tenant_id: str, owner_user_id: str, name: str
    ) -> str | None:
        row = self.fetchone(
            """
            SELECT id FROM people
            WHERE tenant_id = ? AND user_id = ? AND lower(name) = lower(?)
            """,
            (tenant_id, owner_user_id, name),
        )
        return str(row["id"]) if row else None

    def create_person(
        self, *, tenant_id: str, owner_user_id: str, name: str, created_at: datetime
    ) -> str:
        from packages.domain.ids import new_id

        person_id = new_id("person")
        self.execute(
            """
            INSERT INTO people (id, tenant_id, user_id, name, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (person_id, tenant_id, owner_user_id, name, iso(created_at)),
        )
        return person_id

    def find_project_id(
        self, *, tenant_id: str, owner_user_id: str, name: str
    ) -> str | None:
        row = self.fetchone(
            """
            SELECT id FROM projects
            WHERE tenant_id = ? AND user_id = ? AND lower(name) = lower(?)
            """,
            (tenant_id, owner_user_id, name),
        )
        return str(row["id"]) if row else None

    def create_project(
        self, *, tenant_id: str, owner_user_id: str, name: str, created_at: datetime
    ) -> str:
        from packages.domain.ids import new_id

        project_id = new_id("project")
        self.execute(
            """
            INSERT INTO projects (id, tenant_id, user_id, name, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (project_id, tenant_id, owner_user_id, name, iso(created_at)),
        )
        return project_id

    def create_expense(self, **values: Any) -> str:
        from packages.domain.ids import new_id

        expense_id = new_id("expense")
        self.execute(
            """
            INSERT INTO expenses
              (id, tenant_id, user_id, amount_minor, currency, description,
               person_id, project_id, occurred_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                iso(values["occurred_at"]),
                iso(values["created_at"]),
            ),
        )
        return expense_id

    def summarize_project_expenses(
        self, *, tenant_id: str, owner_user_id: str, project_name: str
    ) -> dict[str, Any]:
        project = self.fetchone(
            """
            SELECT id, name FROM projects
            WHERE tenant_id = ? AND user_id = ? AND lower(name) = lower(?)
            """,
            (tenant_id, owner_user_id, project_name),
        )
        if not project:
            return {
                "project_name": project_name,
                "total_minor": 0,
                "currency": None,
                "expense_count": 0,
            }
        row = self.fetchone(
            """
            SELECT COALESCE(SUM(amount_minor), 0) AS total_minor,
                   COUNT(*) AS expense_count,
                   MIN(currency) AS currency
            FROM expenses
            WHERE tenant_id = ? AND user_id = ? AND project_id = ?
            """,
            (tenant_id, owner_user_id, project["id"]),
        )
        return {
            "project_id": project["id"],
            "project_name": project["name"],
            "total_minor": int(row["total_minor"]),
            "currency": row["currency"],
            "expense_count": int(row["expense_count"]),
        }

    def summarize_person_expenses(
        self, *, tenant_id: str, owner_user_id: str, person_name: str
    ) -> dict[str, Any]:
        person = self.fetchone(
            """
            SELECT id, name FROM people
            WHERE tenant_id = ? AND user_id = ? AND lower(name) = lower(?)
            """,
            (tenant_id, owner_user_id, person_name),
        )
        if not person:
            return {
                "person_name": person_name,
                "total_minor": 0,
                "currency": None,
                "expense_count": 0,
            }
        rows = self.fetchall(
            """
            SELECT currency, COALESCE(SUM(amount_minor), 0) AS total_minor,
                   COUNT(*) AS expense_count
            FROM expenses
            WHERE tenant_id = ? AND user_id = ? AND person_id = ?
            GROUP BY currency
            """,
            (tenant_id, owner_user_id, person["id"]),
        )
        if len(rows) != 1:
            return {
                "person_id": person["id"],
                "person_name": person["name"],
                "total_minor": 0 if not rows else sum(int(row["total_minor"]) for row in rows),
                "currency": rows[0]["currency"] if len(rows) == 1 else None,
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
            "person_id": person["id"],
            "person_name": person["name"],
            "total_minor": int(row["total_minor"]),
            "currency": row["currency"],
            "expense_count": int(row["expense_count"]),
        }

    def list_project_people(
        self, *, tenant_id: str, owner_user_id: str, project_name: str
    ) -> dict[str, Any]:
        project = self.fetchone(
            """
            SELECT id, name FROM projects
            WHERE tenant_id = ? AND user_id = ? AND lower(name) = lower(?)
            """,
            (tenant_id, owner_user_id, project_name),
        )
        if not project:
            return {"project_name": project_name, "people": []}
        people = self.fetchall(
            """
            SELECT DISTINCT people.id, people.name
            FROM people
            JOIN expenses ON expenses.person_id = people.id
            WHERE expenses.tenant_id = ? AND expenses.user_id = ?
              AND expenses.project_id = ?
            ORDER BY lower(people.name)
            """,
            (tenant_id, owner_user_id, project["id"]),
        )
        return {
            "project_id": project["id"],
            "project_name": project["name"],
            "people": [{"id": row["id"], "name": row["name"]} for row in people],
        }

    def get_today_context(
        self, *, tenant_id: str, owner_user_id: str, now: datetime
    ) -> dict[str, Any]:
        reminders = self.fetchall(
            """
            SELECT id, text, due_at, timezone, status
            FROM reminders
            WHERE tenant_id = ? AND user_id = ?
              AND status IN ('pending', 'claimed')
            ORDER BY due_at ASC
            LIMIT 8
            """,
            (tenant_id, owner_user_id),
        )
        expenses = self.fetchall(
            """
            SELECT expenses.id, expenses.amount_minor, expenses.currency,
                   expenses.description, expenses.occurred_at,
                   people.name AS person_name, projects.name AS project_name
            FROM expenses
            LEFT JOIN people ON people.id = expenses.person_id
            LEFT JOIN projects ON projects.id = expenses.project_id
            WHERE expenses.tenant_id = ? AND expenses.user_id = ?
            ORDER BY expenses.occurred_at DESC
            LIMIT 8
            """,
            (tenant_id, owner_user_id),
        )
        projects = self.fetchall(
            """
            SELECT id, name, created_at
            FROM projects
            WHERE tenant_id = ? AND user_id = ?
            ORDER BY created_at DESC
            LIMIT 8
            """,
            (tenant_id, owner_user_id),
        )
        people = self.fetchall(
            """
            SELECT DISTINCT people.id, people.name
            FROM people
            WHERE tenant_id = ? AND user_id = ?
            ORDER BY lower(name)
            LIMIT 12
            """,
            (tenant_id, owner_user_id),
        )
        return {
            "upcoming_reminders": [dict(row) for row in reminders],
            "recent_expenses": [dict(row) for row in expenses],
            "active_projects": [dict(row) for row in projects],
            "relevant_people": [dict(row) for row in people],
            # SQLite has no task table in the Phase 1 runtime yet.
            "pending_tasks": [],
            "as_of": iso(now),
        }

    def create_reminder(self, **values: Any) -> None:
        self.execute(
            """
            INSERT INTO reminders
              (id, tenant_id, user_id, text, due_at, timezone, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
            """,
            (
                values["reminder_id"],
                values["tenant_id"],
                values["owner_user_id"],
                values["text"],
                iso(values["due_at"]),
                values["timezone_name"],
                iso(values["created_at"]),
            ),
        )

    def claim_due_reminder(
        self, lease_seconds: int = 60, tenant_id: str | None = None
    ) -> dict[str, Any] | None:
        now = iso(utc_now())
        lease_until = iso(utc_now() + timedelta(seconds=lease_seconds))
        with self.transaction():
            row = self.fetchone(
                """
                SELECT id, tenant_id, user_id, text, due_at, timezone,
                       attempt_count, last_error
                FROM reminders
                WHERE due_at <= ?
                  AND (? IS NULL OR tenant_id = ?)
                  AND (
                    status = 'pending'
                    OR (status = 'claimed' AND lease_until IS NOT NULL AND lease_until <= ?)
                  )
                ORDER BY due_at ASC
                LIMIT 1
                """,
                (now, tenant_id, tenant_id, now),
            )
            if not row:
                return None
            updated = self.execute(
                """
                UPDATE reminders
                SET status = 'claimed',
                    claimed_at = ?,
                    lease_until = ?,
                    attempt_count = attempt_count + 1
                WHERE id = ?
                  AND (
                    status = 'pending'
                    OR (status = 'claimed' AND lease_until IS NOT NULL AND lease_until <= ?)
                  )
                """,
                (now, lease_until, row["id"], now),
            )
            if updated.rowcount != 1:
                return None
            claimed = dict(row)
            claimed["claimed_at"] = now
            claimed["lease_until"] = lease_until
            claimed["attempt_count"] = int(row["attempt_count"]) + 1
            return claimed

    def mark_reminder_delivered(self, reminder_id: str) -> None:
        self.execute(
            """
            UPDATE reminders
            SET status = 'delivered', claimed_at = NULL, lease_until = NULL, last_error = NULL
            WHERE id = ? AND status = 'claimed'
            """,
            (reminder_id,),
        )

    def mark_reminder_failed(self, reminder_id: str, error: str) -> None:
        self.execute(
            """
            UPDATE reminders
            SET status = 'pending', claimed_at = NULL, lease_until = NULL, last_error = ?
            WHERE id = ? AND status = 'claimed'
            """,
            (error[:1000], reminder_id),
        )

    def audit_service(
        self,
        *,
        event_id: str,
        tenant_id: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        self.execute(
            """
            INSERT INTO audit_events
              (id, tenant_id, user_id, event_type, payload_json, created_at)
            VALUES (?, ?, 'service-worker', ?, ?, ?)
            """,
            (event_id, tenant_id, event_type, json.dumps(payload), iso(utc_now())),
        )

    def execute(self, sql: str, params: tuple[Any, ...] = ()) -> sqlite3.Cursor:
        return self.connection.execute(sql, params)

    def fetchone(self, sql: str, params: tuple[Any, ...] = ()) -> sqlite3.Row | None:
        return self.connection.execute(sql, params).fetchone()

    def fetchall(self, sql: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
        return list(self.connection.execute(sql, params).fetchall())

    def save_idempotent(
        self,
        tenant_id: str,
        user_id: str,
        key: str,
        fingerprint: str,
        result: dict[str, Any],
    ) -> None:
        self.execute(
            """
            INSERT INTO idempotency_records
              (tenant_id, user_id, idempotency_key, request_fingerprint, result_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (tenant_id, user_id, key, fingerprint, json.dumps(result), iso(utc_now())),
        )

    def get_idempotent(
        self, tenant_id: str, user_id: str, key: str
    ) -> sqlite3.Row | None:
        return self.fetchone(
            """
            SELECT request_fingerprint, result_json
            FROM idempotency_records
            WHERE tenant_id = ? AND user_id = ? AND idempotency_key = ?
            """,
            (tenant_id, user_id, key),
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
        self.execute(
            """
            INSERT INTO audit_events
              (id, tenant_id, user_id, conversation_id, event_type, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                tenant_id,
                user_id,
                conversation_id,
                event_type,
                json.dumps(payload, ensure_ascii=False),
                iso(utc_now()),
            ),
        )

    def readiness_check(self) -> bool:
        try:
            row = self.fetchone("SELECT 1 AS ok")
            return bool(row and row["ok"] == 1)
        except sqlite3.Error:
            return False
