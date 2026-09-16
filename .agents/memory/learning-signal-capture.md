---
name: Learning signal capture
description: Safety boundary for collecting corrections as future training data.
---

An explicit correction is detected from the originating conversation turn as a review-only learning signal with a bounded category and confidence. Its review status and benchmark snapshot belong in a separate review record, not in structured conversation memory. Approval makes it an offline benchmark candidate, not a production rule.

**Why:** A correction may refer to an amount, date, person, project, or intent, and the surrounding conversation is required to interpret it. Applying a single correction automatically could corrupt financial data or teach a false rule; storing review state in conversation memory would also mix operational context with evaluation workflow.

**How to apply:** Keep detection linked to tenant-scoped conversation memory, store review decisions and a bounded snapshot separately, require explicit human review before benchmark promotion, and retain `autoApply: false` permanently for this path.