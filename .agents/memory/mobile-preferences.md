---
name: Mobile preferences
description: Main and Quick share persisted language and appearance preferences through root providers.
---

Mobile presentation preferences are shared above the route and persisted locally, with Arabic and light mode as the defaults. Feature surfaces should read the providers instead of keeping separate theme or language state.

**Why:** Main, Quick, drawer settings, records, and chat need to change consistently when the user selects English or dark mode.

**How to apply:** Add future presentation options to the existing preference providers and keep server/domain data separate from translated UI labels.