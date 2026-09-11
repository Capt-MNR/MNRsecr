# Phase 1.1 — Security and Reliability Hardening

**Status:** Completed  
**Architecture:** Unchanged  
**Hermes:** Inactive  
**Persistence:** SQLite development adapter

## Authentication boundary

```text
HTTP Authorization header
  -> AuthenticationProvider
  -> TrustedIdentity
  -> ExecutionContext
  -> FirstPartyRuntime
  -> ApplicationService authorization
  -> Persistence
```

The development implementation is `DevelopmentAuthenticator` in
`packages/identity/auth.py`. It maps a bearer token to a server-side identity.
The HTTP body cannot set tenant or user identity, and the model receives no
authority to change `TrustedIdentity` or `ExecutionContext`.

The provider is replaceable: a future Supabase/Auth implementation only needs
to satisfy `AuthenticationProvider.authenticate(...)`.

## Capability enforcement

`TrustedIdentity.capabilities` represents the server-granted policy.
`TurnRequest.allowed_capabilities` is a per-turn upper bound. The active
runtime computes:

```text
effective_capabilities =
    trusted_capabilities ∩ allowed_capabilities
```

The model sees only the effective context. It cannot add capabilities.
Application use cases still perform the final capability check, so allowing a
runtime capability does not bypass application authorization.

## Reminder leases

The SQLite reminder lifecycle is:

```text
pending
  -> claimed (claimed_at, lease_until, attempt_count)
  -> delivered
```

If a worker crashes after claiming, the row remains durable. Once
`lease_until` expires, another worker can reclaim it. Delivery failures record
`last_error`, clear the lease, and return the row to `pending`.

The reminder ID is the stable delivery key exposed to a future channel
adapter. This prevents duplicate processing after completion, while a real
external channel will still need an outbox and provider-level idempotency
before delivery is considered exactly-once.

## Readiness and shutdown

- `/healthz` checks process liveness only.
- `/readyz` performs a lightweight persistence query and returns 503 when the
  persistence boundary is unavailable.
- API SIGTERM/SIGINT handlers request server shutdown and close the server and
  persistence resources in `finally`.
- Worker SIGTERM/SIGINT stops new polling; durable claimed work can recover
  through lease expiry after restart.

This is 24/7-ready process behavior, not a claim that the system is currently
hosted 24/7.

## Explicit non-goals

Phase 1.1 did not:

- migrate to Supabase/Postgres
- add a production model provider
- add Redis or another queue
- activate or integrate Hermes
- build Android or Telegram
- implement production authentication
- implement the complete permission, memory, or domain model