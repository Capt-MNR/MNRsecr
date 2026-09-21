---
name: HTTP integration provider fixture
description: Why API integration tests must explicitly provide a model gateway instead of relying on development mode
---

HTTP integration tests that exercise normal secretary turns must provide an explicit configured or scripted model provider. Setting `AI_PROVIDER=development` without provider credentials makes the HTTP runtime select the unavailable-provider path, so valid turns return `PROVIDER_NOT_CONFIGURED` rather than reaching deterministic or scripted behavior.

**Why:** The development provider label is useful for local routing tests, but it is not itself a test gateway for the HTTP server process.

**How to apply:** Keep malformed-body and authentication tests provider-independent; for normal turn/approval flows, inject a scripted gateway or configure an isolated provider fixture instead of relying on `AI_PROVIDER=development`.