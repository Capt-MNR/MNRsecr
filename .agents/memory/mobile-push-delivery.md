---
name: Mobile push delivery
description: The mobile secretary's server-owned push boundary and provider choice.
---

Use Expo push tokens for the mobile secretary notification path. The server stores them per tenant and owner, and sends approval-event notifications through Expo's gateway, which hands delivery to FCM on Android and APNs on iOS. Native EAS verification also requires the Expo project to be linked to the GitHub repository used by the build service.

**Why:** The mobile bundle must not contain FCM or APNs credentials, and the app must remain event-driven rather than running a background polling or LLM process.

**How to apply:** Keep registration authenticated and tenant-scoped, disable tokens reported as unregistered, and dispatch from server events such as pending approvals. Before triggering EAS builds, link the Expo project to the repository and branch containing the app. Native delivery still needs verification in an Expo/EAS-capable build; web preview cannot prove FCM/APNs delivery.

Quick-safe approval notifications may expose native approve/reject actions, while complex approvals should only route to the scoped Quick conversation. Both actions must call the existing approval endpoints so the server remains the sole mutation boundary.

**Why:** Notification actions are another approval entry point, not a parallel financial-write path; keeping the action policy aligned with Quick prevents bypassing review requirements.

**How to apply:** Mark only deferred Quick confirmations as actionable in the push payload. Treat ordinary notification taps and reminder events as conversation navigation, and leave native delivery verification to a real device build.

The push boundary is an outbox, not a synchronous side effect: Agent Work completion and its logical notification must commit together, while each device delivery is leased and retried independently. A gateway ticket means submitted, not device-confirmed; timeout/network outcomes remain unknown and are bounded rather than retried forever.

**Why:** A process crash between a domain commit and a provider call can otherwise lose the notification, and treating a timeout as failed can create duplicate sends or false delivery claims.

**How to apply:** Keep the logical dedupe key tenant/owner scoped, snapshot enabled tokens into per-device deliveries, disable permanent invalid-token errors, and use provider receipts only to upgrade submitted to confirmed.