---
name: Android build gate
description: Conditions to satisfy before spending another EAS Android native build.
---

Do not spend another EAS Android build only to retest the current APK. Batch a meaningful mobile change first, then build only after Expo SDK compatibility checks pass and authenticated production data access is healthy. The next APK must be checked on a physical Android device for startup, data loading, background and terminated notifications, Quick context, and single approval execution.

**Why:** A successful Gradle build did not catch a missing native peer dependency and mismatched Expo SDK package versions that may cause an installed APK to crash at startup. A build before API and device checks would still fail to prove the user-facing flow.

**How to apply:** Before invoking EAS, run `CI=1 pnpm exec expo install --check` and `pnpm dlx expo-doctor@latest` from the mobile package, verify the published `/api/today` and `/api/conversations` endpoints with an authenticated session, confirm the intended mobile changes are ready, and run the Android verification matrix in `artifacts/personal-secretary-mobile/docs/native-push-verification.md`.