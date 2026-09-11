from __future__ import annotations

from contextlib import AbstractContextManager
from datetime import datetime
from typing import Any, Protocol

class PersistencePort(Protocol):
    """Storage contract consumed by application use cases.

    The application layer intentionally knows nothing about SQL drivers,
    cursors, row classes, or transaction syntax. SQLite and Postgres adapters
    implement this same product-level contract.
    """

    def transaction(self) -> AbstractContextManager[Any]:
        ...

    def find_person_id(self, *, tenant_id: str, owner_user_id: str, name: str) -> str | None:
        ...

    def create_person(
        self, *, tenant_id: str, owner_user_id: str, name: str, created_at: datetime
    ) -> str:
        ...

    def find_project_id(self, *, tenant_id: str, owner_user_id: str, name: str) -> str | None:
        ...

    def create_project(
        self, *, tenant_id: str, owner_user_id: str, name: str, created_at: datetime
    ) -> str:
        ...

    def create_expense(self, **values: Any) -> str:
        ...

    def summarize_project_expenses(
        self, *, tenant_id: str, owner_user_id: str, project_name: str
    ) -> dict[str, Any]:
        ...

    def summarize_person_expenses(
        self, *, tenant_id: str, owner_user_id: str, person_name: str
    ) -> dict[str, Any]:
        ...

    def list_project_people(
        self, *, tenant_id: str, owner_user_id: str, project_name: str
    ) -> dict[str, Any]:
        ...

    def get_today_context(
        self, *, tenant_id: str, owner_user_id: str, now: datetime
    ) -> dict[str, Any]:
        ...

    def create_reminder(self, **values: Any) -> None:
        ...

    def claim_due_reminder(
        self, lease_seconds: int, tenant_id: str | None = None
    ) -> dict[str, Any] | None:
        ...

    def mark_reminder_delivered(self, reminder_id: str) -> None:
        ...

    def mark_reminder_failed(self, reminder_id: str, error: str) -> None:
        ...

    def audit_service(
        self,
        *,
        event_id: str,
        tenant_id: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        ...

    def get_idempotent(
        self, tenant_id: str, user_id: str, key: str
    ) -> Any | None:
        ...

    def save_idempotent(
        self,
        tenant_id: str,
        user_id: str,
        key: str,
        fingerprint: str,
        result: dict[str, Any],
    ) -> None:
        ...

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
        ...

    def readiness_check(self) -> bool:
        ...

    def close(self) -> None:
        ...