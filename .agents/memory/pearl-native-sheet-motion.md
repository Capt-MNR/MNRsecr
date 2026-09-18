---
name: Native sheet motion on Web
description: Cross-platform implementation constraint for Expo sheet snap points and measured offsets.
---

For Expo Web sheet snap points, keep the rendered translation as a numeric state derived from the measured sheet height. Do not rely on the initial value of a native-driver `Animated.Value` being applied by the preview renderer.

**Why:** The preview rendered a percentage-height sheet fully open even though its native animated value was initialized to the collapsed offset. The measured numeric state produced the expected 80% starting position while preserving PanResponder drag calculations.

**How to apply:** Measure the sheet with `onLayout`, convert snap percentages to pixels, update the numeric offset during drag, and snap to the nearest reviewed point on release. Keep the interaction implementation independent of mock data.