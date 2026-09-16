---
name: Learning signal capture
description: Safety boundary for collecting corrections as future training data.
---

An explicit correction can be attached to the originating conversation turn as a review-only learning signal with a bounded category and confidence. It is evidence for evaluation, not permission to mutate records or production behavior.

**Why:** A correction may refer to an amount, date, person, project, or intent, and the surrounding conversation is required to interpret it. Applying a single correction automatically could corrupt financial data or teach a false rule.

**How to apply:** Keep the signal tenant-scoped through conversation memory, omit raw duplicate text from the signal metadata, require human or benchmark review before promotion, and retain `autoApply: false` until a separate approval pipeline exists.