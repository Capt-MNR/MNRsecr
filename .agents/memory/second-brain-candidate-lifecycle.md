---
name: Second Brain candidate lifecycle
description: Review-only personal-memory candidates must remain outside retrieval until explicit promotion.
---

Candidates are a separate review queue, not a lower-status form of active memory. They must remain excluded from Second Brain retrieval and alias resolution until explicit approval. Approval should atomically promote the candidate and mark the candidate approved; an already-approved candidate must not be demoted in a way that leaves an active promoted memory behind.

**Why:** Personal-memory suggestions can be uncertain, while active memory is allowed to influence later secretary context. A partial promotion or post-approval demotion would make the review decision unreliable.

**How to apply:** Preserve tenant/user scoping and provenance on candidate creation, expose pending candidates for review on web and mobile, and keep promotion plus candidate status update in one database transaction.