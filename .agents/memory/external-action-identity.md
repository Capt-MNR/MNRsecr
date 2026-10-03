---
name: External action identity and uncertainty
description: Identity and retry boundaries for future provider-backed external actions.
---

An execution design must distinguish durable Work (`workId`), a worker attempt (`runId`), the existing secretary approval (`approvalOperationId`), the full external action (`actionId`), and each provider step (`stepId`). Step-level receipts and idempotency use `stepId`; action-level approval and results retain `actionId`. Reuse Agent Work and the existing approval lifecycle; do not create a parallel worker or approval path. If a provider call may have taken effect but its result is not confirmed, record `unknown_result`, require review/reconciliation, and never retry it automatically. Internal database activity receipts do not prove that an external provider action occurred. Evidence for external actions must be bounded and redacted at the storage boundary.

The accepted architecture proof baseline includes the real Google Sheets connector, test-gated Fake Email, the generic External Action contract, canonical approval binding, separated Work/Run/ApprovalOperation/Action/Step identities, unknown-result reconciliation, and sanitized evidence. Do not rebuild these or change Agent Core, Agent Work, or Approval architecture just to add another connector. At registry dispatch, explicit `provider` and `agentWorkSource` hints must agree and match the approval tool; unknown, conflicting, or mismatched identities fail closed. Duplicate provider or approval-tool registrations must fail at registry construction.

**Why:** Work leases and secretary operations already protect internal flows, but an external side effect can complete while its response is lost; treating it like an atomic database transaction can duplicate sends or writes. Explicit provider identity is also a dispatch boundary and must not be overridden by a tool-name fallback as the registry grows.

**How to apply:** Before enabling an external mutation, define durable action identity, provider idempotency behavior, unknown-result states, reconciliation, approval binding, and action-scoped evidence. Keep connector credentials outside model-visible inputs. Preserve the accepted proof baseline; make registry identity checks strict before registering more providers.
