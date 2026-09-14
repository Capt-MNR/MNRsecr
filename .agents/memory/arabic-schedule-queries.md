---
name: Arabic schedule queries
description: Durable rules for reliable Arabic date, reminder, and task questions.
---

Arabic punctuation such as `؟` must be separated from words before matching date and schedule terms. Read-only schedule questions should be resolved from scoped saved data before the language model, while write phrases such as «فكرني» must remain on the approval path.

**Why:** Arabic punctuation can otherwise turn «النهارده؟» into a false search token, and letting the model decide whether saved tasks exist produced user-visible «لا توجد» answers despite real data.

**How to apply:** When adding Arabic schedule intents, normalize Unicode letters/numbers and punctuation, distinguish reminders from tasks, and preserve tenant/user filters on the deterministic read.