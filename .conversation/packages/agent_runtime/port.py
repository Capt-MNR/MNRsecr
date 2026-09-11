from __future__ import annotations

from typing import Protocol

from packages.contracts.models import TurnRequest, TurnResult


class AgentRuntime(Protocol):
    """Runtime-neutral product port."""

    def handle(self, request: TurnRequest) -> TurnResult:
        ...
