from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Mapping, Protocol

from packages.contracts.models import ExecutionContext


DEFAULT_CAPABILITIES = frozenset(
    {
        "context.read",
        "expenses.read",
        "expenses.write",
        "people.read",
        "projects.read",
        "reminders.write",
    }
)


class AuthenticationError(Exception):
    """A request did not present a valid authenticated principal."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class TrustedIdentity:
    """Identity produced by an authentication provider, never by the model."""

    tenant_id: str
    user_id: str
    capabilities: frozenset[str] = DEFAULT_CAPABILITIES

    def to_context(self, *, conversation_id: str, channel: str) -> ExecutionContext:
        return ExecutionContext(
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            conversation_id=conversation_id,
            channel=channel,
            capabilities=self.capabilities,
        )


class AuthenticationProvider(Protocol):
    def authenticate(self, headers: Mapping[str, str]) -> TrustedIdentity:
        ...


class DevelopmentAuthenticator:
    """Small replaceable development authenticator.

    Tokens are mapped server-side to identities. The client presents a token;
    it does not present an accepted tenant/user pair. A future Supabase/Auth
    adapter can implement AuthenticationProvider without changing use cases.

    Optional DEV_AUTH_TOKENS is a JSON object:
      {"dev-user-a": {"tenant_id": "tenant-a", "user_id": "user-a",
                      "capabilities": ["expenses.read"]}}
    """

    def __init__(self, identities: Mapping[str, TrustedIdentity] | None = None) -> None:
        self.identities = dict(
            identities
            or {
                "dev-user": TrustedIdentity(
                    tenant_id="development-tenant",
                    user_id="development-user",
                )
            }
        )

    @classmethod
    def from_environment(cls) -> "DevelopmentAuthenticator":
        raw = os.getenv("DEV_AUTH_TOKENS")
        if not raw:
            return cls()
        try:
            payload = json.loads(raw)
            identities = {
                token: TrustedIdentity(
                    tenant_id=str(value["tenant_id"]),
                    user_id=str(value["user_id"]),
                    capabilities=frozenset(
                        value.get("capabilities", DEFAULT_CAPABILITIES)
                    ),
                )
                for token, value in payload.items()
            }
        except (TypeError, ValueError, KeyError) as error:
            raise RuntimeError("DEV_AUTH_TOKENS must be valid identity JSON") from error
        return cls(identities)

    def authenticate(self, headers: Mapping[str, str]) -> TrustedIdentity:
        authorization = headers.get("Authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.casefold() != "bearer" or not token:
            raise AuthenticationError(
                "authentication_required",
                "A bearer authentication token is required",
            )
        identity = self.identities.get(token)
        if identity is None or not identity.tenant_id or not identity.user_id:
            raise AuthenticationError(
                "invalid_identity",
                "The authentication identity is invalid",
            )
        return identity
