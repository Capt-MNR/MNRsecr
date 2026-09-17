---
name: EAS native build environment
description: Environment constraints discovered while building the Expo SDK 57 mobile artifact on EAS.
---

Expo SDK 57 native builds need an explicit Node 20 runtime and an Android image with Java 17. The automatic Android image selected Java 11, which Gradle 9.3.1 rejects; the `sdk-57` Android image is the compatible choice. iOS production builds also require a validated remote Distribution Certificate before non-interactive EAS builds can proceed.

**Why:** The project reached native bundling only after the runtime was fixed, then Android failed at Gradle because the auto-selected Java version was too old, while iOS stopped at remote credential validation.

**How to apply:** Keep Node 20 and the SDK-matched Android image in EAS profiles. Treat iOS signing validation as a prerequisite for TestFlight builds rather than a JavaScript or app-code failure.