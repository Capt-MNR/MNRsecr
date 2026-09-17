# Native push verification

This verification is required before the mobile architecture phase is complete.
Use an Android internal APK and an iOS TestFlight build. Expo Go and web preview
do not count as proof of remote notification delivery.

## Preconditions

- Install the current build on one physical Android device and one physical iPhone.
- Sign in as the same test tenant on the device and on the client that creates the approval.
- Allow notifications, sound, and lock-screen/banner delivery.
- Open the app once and wait until push registration completes.
- Confirm the device has network access and record the OS version, device model,
  app build number, notification permission state, and battery/background restrictions.

## Required matrix

Run every row independently. Create a fresh approval-required operation for each row.

| Platform | Starting state | Required result |
| --- | --- | --- |
| Android | Background: app open but not visible | One OS notification arrives |
| Android | Terminated: app fully removed from recents | One OS notification arrives |
| iOS | Background: app open but not visible | One OS notification arrives |
| iOS | Terminated: app fully closed | One OS notification arrives |

For each row:

1. Record the exact time the backend creates the approval.
2. Start a timer.
3. Wait up to 120 seconds without reopening the app.
4. Record the exact arrival time and latency in seconds.
5. Record whether a banner/lock-screen notification appeared.
6. Record whether the notification played a sound.
7. Record whether the notification was duplicated.
8. Tap the notification.
9. Confirm it opens Quick.
10. Confirm Quick loads the matching approval and preserves the operation and
    conversation context.
11. Approve or reject once and confirm the action is not executed twice.

## Result template

| Field | Value |
| --- | --- |
| Platform and OS | |
| Device model | |
| Build number | |
| Starting state: background or terminated | |
| Approval created at | |
| Notification arrived at | |
| Latency in seconds | |
| Banner/lock-screen shown | yes / no |
| Sound played | yes / no |
| Duplicate notification | yes / no |
| Tap opened Quick | yes / no |
| Correct operation loaded | yes / no |
| Correct conversation loaded | yes / no |
| Approval executed exactly once | yes / no |
| Battery/background restrictions | |
| Notes, screenshots, or screen recording | |

## Pass criteria

All four rows must pass. A missing notification, latency over 120 seconds,
duplicate delivery, incorrect route/context, or repeated approval execution is a
failure that must be investigated before completing the phase.