---
name: Android Quick notification
description: The Android notification is only a persistent doorway to the Quick surface.
---

The Quick notification must remain a UI entry point only. It may create one low-priority sticky local notification and route taps to Quick, but it must not host LLM work, Secretary Runtime execution, polling, a foreground service, or a reboot receiver.

**Why:** Quick and Main are intentionally separated; keeping the notification lightweight prevents the Android entry point from becoming a second runtime or an always-running battery consumer. Android process death and reboot are separate lifecycle cases: a local ongoing notification can outlive the JS process, but reboot restoration requires a boot/background mechanism that would violate the lightweight boundary unless explicitly accepted.

**How to apply:** Keep notification payloads minimal, use the existing root route whose initial view is Quick, and keep all request/approval behavior on the existing Secretary API.