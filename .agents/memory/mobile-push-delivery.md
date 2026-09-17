---
name: Mobile push delivery
description: The mobile secretary's server-owned push boundary and provider choice.
---

Use Expo push tokens for the mobile secretary notification path. The server stores them per tenant and owner, and sends approval-event notifications through Expo's gateway, which hands delivery to FCM on Android and APNs on iOS. Native EAS verification also requires the Expo project to be linked to the GitHub repository used by the build service.

**Why:** The mobile bundle must not contain FCM or APNs credentials, and the app must remain event-driven rather than running a background polling or LLM process.

**How to apply:** Keep registration authenticated and tenant-scoped, disable tokens reported as unregistered, and dispatch from server events such as pending approvals. Before triggering EAS builds, link the Expo project to the repository and branch containing the app. Native delivery still needs verification in an Expo/EAS-capable build; web preview cannot prove FCM/APNs delivery.