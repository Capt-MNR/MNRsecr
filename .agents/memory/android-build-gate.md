---
name: Android build gate
description: Conditions to satisfy before spending another EAS Android native build.
---

Do not spend another EAS Android build only to retest the current APK. Batch a meaningful mobile change first, then build only after production data access is healthy. The next APK must be checked on a physical Android device for data loading, background and terminated notifications, Quick context, and single approval execution.

**Why:** The current APK was built before its remote API domain was guaranteed, while production data access was independently blocked. Rebuilding without both conditions would consume another EAS attempt without proving the user-facing fix.

**How to apply:** Before invoking EAS, verify the published `/api/today` and `/api/conversations` endpoints return success, confirm the intended mobile changes are ready, and run the Android verification matrix in `artifacts/personal-secretary-mobile/docs/native-push-verification.md`.