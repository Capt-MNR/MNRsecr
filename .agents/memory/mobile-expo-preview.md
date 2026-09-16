---
name: Mobile Expo preview environment
description: Expo previews can serve successfully despite local DevTools and package freshness warnings.
---

The mobile Expo workflow can be considered available when Metro reports the Expo Go URL and the preview loads, even if React Native DevTools cannot start because the container lacks `libglib-2.0.so.0`. Production builds inherit that warning; running them with `CI=1 EXPO_NO_DEVTOOLS=1` allows Metro to finish. The static build also needs its fixed 8081 port free while it runs. Expo's package freshness fixer may also fail temporarily when a newly published patch version is blocked by the workspace package firewall's minimum-release-age policy.

**Why:** Treating either warning as an application failure leads to unnecessary dependency changes or bypasses; the actual preview remained usable and the app rendered correctly.

**How to apply:** Verify the workflow status, Metro URL, typecheck, and app preview first. For a static mobile build, temporarily stop any other service using 8081, run with the two CI/DevTools environment flags, then restore that service. Only change system dependencies or package policy when the app itself fails to bundle or render.