from __future__ import annotations

import uuid


def new_id(prefix: str | None = None) -> str:
    """Return a storage-neutral UUID identifier.

    ``prefix`` is accepted for call-site readability and migration
    compatibility; identifiers are deliberately not adapter-specific strings.
    """

    return str(uuid.uuid4())