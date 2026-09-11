class DomainError(Exception):
    """Expected product/domain failure."""


class AuthorizationError(DomainError):
    """The current context cannot perform an operation."""


class IdempotencyConflict(DomainError):
    """An idempotency key was reused for a different request."""


class InvalidOperation(DomainError):
    """The requested operation is not valid."""


class ActionRejected(DomainError):
    """A proposed runtime action failed validation before execution."""
