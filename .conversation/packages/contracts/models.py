from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from threading import Event
from typing import Any, Mapping, Sequence


@dataclass(frozen=True)
class ExecutionContext:
    """Server-derived identity and request scope.

    A model or client never chooses tenant_id or user_id. The API creates this
    object from its authenticated principal/configuration.
    """

    tenant_id: str
    user_id: str
    conversation_id: str
    channel: str
    capabilities: frozenset[str] = frozenset()

    def with_capabilities(self, capabilities: frozenset[str]) -> "ExecutionContext":
        return ExecutionContext(
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            conversation_id=self.conversation_id,
            channel=self.channel,
            capabilities=capabilities,
        )


@dataclass(frozen=True)
class MemorySnapshot:
    """Temporary context projection, never the canonical data store."""

    values: Mapping[str, Any] = field(default_factory=dict)
    source: str = "product"
    as_of: datetime | None = None


@dataclass(frozen=True)
class TurnRequest:
    context: ExecutionContext
    user_message: str
    idempotency_key: str
    allowed_capabilities: frozenset[str] = frozenset()
    memory_snapshot: MemorySnapshot | None = None
    memory_query_handle: str | None = None
    deadline_at: datetime | None = None
    cancellation: Event | None = None
    model_policy: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ProposedAction:
    action_id: str
    name: str
    arguments: Mapping[str, Any]
    status: str
    result: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class ToolTrace:
    name: str
    arguments: Mapping[str, Any]
    status: str
    started_at: datetime
    completed_at: datetime
    error: str | None = None


@dataclass(frozen=True)
class UsageMetadata:
    input_units: int = 0
    output_units: int = 0
    provider: str = "unknown"
    model: str = "unknown"


@dataclass(frozen=True)
class TurnResult:
    product_conversation_id: str
    runtime_session_id: str
    assistant_message: str
    proposed_actions: Sequence[ProposedAction] = ()
    committed_actions: Sequence[ProposedAction] = ()
    referenced_entities: Sequence[Mapping[str, Any]] = ()
    memory_operations: Sequence[Mapping[str, Any]] = ()
    tool_trace: Sequence[ToolTrace] = ()
    usage: UsageMetadata = UsageMetadata()
    metadata: Mapping[str, Any] = field(default_factory=dict)
    warnings: Sequence[str] = ()
    failure: str | None = None
