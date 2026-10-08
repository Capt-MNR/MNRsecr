---
name: Mobile Expo preview environment
description: Expo previews can serve successfully despite local DevTools and package freshness warnings.
---

The mobile Expo workflow can be considered available when Metro reports the Expo Go URL and the preview loads, even if React Native DevTools cannot start because the container lacks `libglib-2.0.so.0`. Production builds inherit that warning; running them with `CI=1 EXPO_NO_DEVTOOLS=1` allows Metro to finish. The static build also needs its fixed 8081 port free while it runs; another healthy workflow can occupy that port and make the build fail before bundling. Expo's package freshness fixer may also fail temporarily when a newly published patch version is blocked by the workspace package firewall's minimum-release-age policy. A short browser capture can also show Main's loading indicator before its API-backed lists settle; confirm the DOM or network response before treating it as a rendering failure.

**Why:** Treating local tooling warnings or an early loading frame as an application failure leads to unnecessary dependency changes or bypasses; the actual preview remained usable and the app rendered correctly.

**How to apply:** Verify workflow status, Metro URL, typecheck, and app preview; allow live queries to settle or inspect browser responses before changing UI code. For a static mobile build, temporarily stop any other service using 8081, run with the two CI/DevTools environment flags, then restore that service. Only change system dependencies or package policy when the app itself fails to bundle or render.