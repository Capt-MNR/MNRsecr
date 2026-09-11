from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from packages.contracts.models import ExecutionContext
from packages.domain.errors import AuthorizationError, IdempotencyConflict, InvalidOperation
from packages.domain.ids import new_id
from packages.persistence.ports import PersistencePort


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_name(value: str) -> str:
    value = " ".join(value.strip().split())
    if not value:
        raise InvalidOperation("A name cannot be empty")
    return value


def fingerprint(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha256(encoded).hexdigest()


class ApplicationService:
    """All mutations enter through this service, never through the runtime."""

    def __init__(self, store: PersistencePort) -> None:
        self.store = store

    def _assert_context(self, context: ExecutionContext) -> None:
        if not context.tenant_id or not context.user_id:
            raise AuthorizationError("Server-derived tenant and user context are required")

    def _assert_capability(self, context: ExecutionContext, capability: str) -> None:
        self._assert_context(context)
        if capability not in context.capabilities and "*" not in context.capabilities:
            raise AuthorizationError(f"Capability required: {capability}")

    def _find_or_create_person(
        self, context: ExecutionContext, name: str
    ) -> tuple[str, bool]:
        normalized = normalize_name(name)
        person_id = self.store.find_person_id(
            tenant_id=context.tenant_id,
            owner_user_id=context.user_id,
            name=normalized,
        )
        if person_id:
            return person_id, False
        return (
            self.store.create_person(
                tenant_id=context.tenant_id,
                owner_user_id=context.user_id,
                name=normalized,
                created_at=utc_now(),
            ),
            True,
        )

    def _find_or_create_project(
        self, context: ExecutionContext, name: str
    ) -> tuple[str, bool]:
        normalized = normalize_name(name)
        project_id = self.store.find_project_id(
            tenant_id=context.tenant_id,
            owner_user_id=context.user_id,
            name=normalized,
        )
        if project_id:
            return project_id, False
        return (
            self.store.create_project(
                tenant_id=context.tenant_id,
                owner_user_id=context.user_id,
                name=normalized,
                created_at=utc_now(),
            ),
            True,
        )

    def record_expense(
        self,
        *,
        context: ExecutionContext,
        amount_minor: int,
        currency: str,
        description: str,
        person_name: str | None,
        project_name: str | None,
        idempotency_key: str,
    ) -> dict[str, Any]:
        self._assert_capability(context, "expenses.write")
        if amount_minor < 0:
            raise InvalidOperation("Expense amount cannot be negative")
        if not currency:
            raise InvalidOperation("Currency is required")
        payload = {
            "operation": "record_expense",
            "amount_minor": amount_minor,
            "currency": currency.upper(),
            "description": description,
            "person_name": person_name,
            "project_name": project_name,
        }
        request_fingerprint = fingerprint(payload)
        existing = self.store.get_idempotent(
            context.tenant_id, context.user_id, idempotency_key
        )
        if existing:
            if existing["request_fingerprint"] != request_fingerprint:
                raise IdempotencyConflict("Idempotency key was reused for another request")
            return json.loads(existing["result_json"])

        with self.store.transaction():
            person_id = None
            project_id = None
            created_people: list[str] = []
            created_projects: list[str] = []
            if person_name:
                person_id, created = self._find_or_create_person(context, person_name)
                if created:
                    created_people.append(person_id)
            if project_name:
                project_id, created = self._find_or_create_project(context, project_name)
                if created:
                    created_projects.append(project_id)
            expense_id = self.store.create_expense(
                tenant_id=context.tenant_id,
                owner_user_id=context.user_id,
                amount_minor=amount_minor,
                currency=currency.upper(),
                description=description,
                person_id=person_id,
                project_id=project_id,
                occurred_at=utc_now(),
                created_at=utc_now(),
            )
            result = {
                "expense_id": expense_id,
                "amount_minor": amount_minor,
                "currency": currency.upper(),
                "description": description,
                "person_id": person_id,
                "project_id": project_id,
                "created_people": created_people,
                "created_projects": created_projects,
            }
            self.store.save_idempotent(
                context.tenant_id,
                context.user_id,
                idempotency_key,
                request_fingerprint,
                result,
            )
            self.store.audit(
                event_id=new_id("audit"),
                tenant_id=context.tenant_id,
                user_id=context.user_id,
                conversation_id=context.conversation_id,
                event_type="expense.recorded",
                payload=result,
            )
            return result

    def summarize_project_expenses(
        self, *, context: ExecutionContext, project_name: str
    ) -> dict[str, Any]:
        self._assert_capability(context, "expenses.read")
        return self.store.summarize_project_expenses(
            tenant_id=context.tenant_id,
            owner_user_id=context.user_id,
            project_name=normalize_name(project_name),
        )

    def summarize_person_expenses(
        self, *, context: ExecutionContext, person_name: str
    ) -> dict[str, Any]:
        self._assert_capability(context, "expenses.read")
        return self.store.summarize_person_expenses(
            tenant_id=context.tenant_id,
            owner_user_id=context.user_id,
            person_name=normalize_name(person_name),
        )

    def list_project_people(
        self, *, context: ExecutionContext, project_name: str
    ) -> dict[str, Any]:
        self._assert_capability(context, "people.read")
        return self.store.list_project_people(
            tenant_id=context.tenant_id,
            owner_user_id=context.user_id,
            project_name=normalize_name(project_name),
        )

    def get_today_context(self, *, context: ExecutionContext) -> dict[str, Any]:
        self._assert_capability(context, "context.read")
        return self.store.get_today_context(
            tenant_id=context.tenant_id,
            owner_user_id=context.user_id,
            now=utc_now(),
        )

    def create_reminder(
        self,
        *,
        context: ExecutionContext,
        text: str,
        due_at: datetime,
        timezone_name: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        self._assert_capability(context, "reminders.write")
        if due_at.tzinfo is None:
            raise InvalidOperation("Reminder due_at must include a timezone")
        payload = {
            "operation": "create_reminder",
            "text": text,
            "due_at": due_at.astimezone(timezone.utc).isoformat(),
            "timezone": timezone_name,
        }
        request_fingerprint = fingerprint(payload)
        existing = self.store.get_idempotent(
            context.tenant_id, context.user_id, idempotency_key
        )
        if existing:
            if existing["request_fingerprint"] != request_fingerprint:
                raise IdempotencyConflict("Idempotency key was reused for another request")
            return json.loads(existing["result_json"])
        with self.store.transaction():
            reminder_id = new_id("reminder")
            result = {
                "reminder_id": reminder_id,
                "text": text,
                "due_at": due_at.isoformat(),
                "timezone": timezone_name,
                "status": "pending",
            }
            self.store.create_reminder(
                reminder_id=reminder_id,
                tenant_id=context.tenant_id,
                owner_user_id=context.user_id,
                text=text,
                due_at=due_at,
                timezone_name=timezone_name,
                created_at=utc_now(),
            )
            self.store.save_idempotent(
                context.tenant_id,
                context.user_id,
                idempotency_key,
                request_fingerprint,
                result,
            )
            self.store.audit(
                event_id=new_id("audit"),
                tenant_id=context.tenant_id,
                user_id=context.user_id,
                conversation_id=context.conversation_id,
                event_type="reminder.created",
                payload=result,
            )
            return result

    def claim_due_reminder(
        self, lease_seconds: int = 60, tenant_id: str | None = None
    ) -> dict[str, Any] | None:
        return self.store.claim_due_reminder(lease_seconds, tenant_id)

    def mark_reminder_delivered(self, reminder_id: str) -> None:
        self.store.mark_reminder_delivered(reminder_id)

    def mark_reminder_failed(self, reminder_id: str, error: str) -> None:
        self.store.mark_reminder_failed(reminder_id, error)
