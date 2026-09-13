---
name: Approval lifecycle memory
description: Durable writes require a persisted approval intent and a persisted post-approval turn.
---

The approval request and the committed result are separate conversation events. After an approval executes, persist the resulting action back into conversation memory so later corrections and follow-up turns resolve against the committed entity rather than the pending intent.

**Why:** A pending approval is not evidence that a write occurred; treating it as the latest state breaks multi-turn corrections after approval.

**How to apply:** Any new approval execution path must append its completed or rejected outcome to the scoped conversation memory without accepting tool arguments from the client.