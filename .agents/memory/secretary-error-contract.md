---
name: Secretary error contract
description: Durable boundary rules for classifying secretary request failures across the browser and API.
---

Only classify a request as a connection failure when the browser never receives an HTTP response. Once the API responds, use its status and error category; provider, agent, authentication, validation, timeout, and malformed-response failures must not be collapsed into a network message.

**Why:** A generic connection fallback hides whether the API restarted, rejected authentication, hit a provider limit, timed out, or failed inside a tool, which makes the MVP look intermittently offline.

**How to apply:** Keep stable machine-readable category/code fields in API error responses, map them to user-safe Arabic messages in the frontend, and include a request correlation ID in both the response and backend logs. Never include provider credentials, raw user prompts, or stack traces in the client response.