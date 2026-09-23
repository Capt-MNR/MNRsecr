---
name: Brain isolated evidence
description: Rules for running the fixed Brain scenario contract without shared-tenant contamination or provider-limit score distortion.
---

Each Brain evaluation scenario gets a generated tenant, user, and correlation ID. Fixture rows are always cleaned in a finally path, with activity-event child rows deleted before their parent rows. Provider-rate-limited cases are safety evidence but are excluded from correctness scoring; scripted provider failures do not provide token measurements.

**Why:** A shared tenant or a quota-limited provider can make a safety baseline look reproducible or accurate when it is actually contaminated or incomplete.

**How to apply:** Keep parser/envelope PASS/FAIL separate from isolated safety-fixture PASS results, report expected and observed outcomes together, and leave scenarios without an authoritative fixture as blocked or not executable.