from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol

from packages.contracts.models import ExecutionContext, MemorySnapshot


@dataclass(frozen=True)
class ModelRequest:
    context: ExecutionContext
    message: str
    memory_snapshot: MemorySnapshot | None
    model_policy: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class IntentPlan:
    name: str
    arguments: Mapping[str, Any]
    confidence: float
    explanation: str = ""


@dataclass(frozen=True)
class ModelResponse:
    text: str
    intent: IntentPlan | None
    provider: str
    model: str
    input_units: int
    output_units: int


class ModelGateway(Protocol):
    """Application-facing model boundary.

    Implementations own provider credentials and provider-specific protocol.
    They never receive client-held secrets.
    """

    def complete(self, request: ModelRequest) -> ModelResponse:
        ...
