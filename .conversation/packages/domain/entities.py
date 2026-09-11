from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Person:
    id: str
    tenant_id: str
    user_id: str
    name: str
    created_at: datetime


@dataclass(frozen=True)
class Project:
    id: str
    tenant_id: str
    user_id: str
    name: str
    created_at: datetime


@dataclass(frozen=True)
class Expense:
    id: str
    tenant_id: str
    user_id: str
    amount_minor: int
    currency: str
    description: str
    person_id: str | None
    project_id: str | None
    occurred_at: datetime
    created_at: datetime


@dataclass(frozen=True)
class Reminder:
    id: str
    tenant_id: str
    user_id: str
    text: str
    due_at: datetime
    timezone: str
    status: str
    created_at: datetime
