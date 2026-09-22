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