---
name: Approval lifecycle memory
description: Durable writes require a persisted approval intent and a persisted post-approval turn.
---

The approval request and the committed result are separate conversation events. After an approval executes, persist the resulting action back into conversation memory so later corrections and follow-up turns resolve against the committed entity rather than the pending intent.

**Why:** A pending approval is not evidence that a write occurred; treating it as the latest state breaks multi-turn corrections after approval.

**How to apply:** Any new approval execution path must append its completed or rejected outcome to the scoped conversation memory without accepting tool arguments from the client. Optional clarification turns must remain pending and must not create a write until the user has supplied enough context and approved it.

Browser approval views must invalidate their cached operation after a terminal response and preserve local terminal status when stale conversation polling reloads the original pending action.

**Why:** The server stores the pending intent and the post-approval event separately, so history refreshes can legitimately return the original pending action after the UI has already confirmed or rejected it.

**How to apply:** On confirm or reject, refresh the scoped operation query and merge any locally terminal operation state over older history snapshots before rendering the approval form.

Approved domain mutation, activity, verification, and operation completion must commit in the same database transaction whenever they share the existing database executor. A stale `executing` operation may only be reconciled from a tenant-scoped activity receipt carrying its operation ID; without a receipt, reset it only after the execution grace period and retry the existing approval.

**Why:** A process can stop after a mutation commits but before a separate operation update, and blindly retrying would duplicate the mutation. The activity event is already in the mutation transaction, so it is the durable evidence needed to close the old boundary safely.

**How to apply:** Pass the transaction executor through the existing approved tool path, lock the executing operation row for the full mutation transaction, persist `sourceOperationId` in activity metadata, and keep the existing row-version and tenant/owner predicates on every mutation and recovery update. Do not add a second approval executor.

Idempotent turn replay must resolve the linked operation after the runtime returns its original approval envelope; terminal operations return the persisted operation result, while pending operations keep the approval envelope. The `/turns` response contract exposes terminal status through action fields rather than a top-level status field.

**Why:** The original approval request remains the idempotent conversation result even after execution or rejection, so returning it with only a current status produces contradictory `approval_required`/terminal responses.

**How to apply:** Keep operation lookup tenant-scoped, route completed/rejected/expired/failed operations through the existing operation-result helper, and do not dispatch a new approval notification for terminal replay.