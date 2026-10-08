---
name: Mobile bottom dock layout
description: Keep fixed bottom navigation clear of scrollable mobile content and chat composers at compact heights.
---

When a mobile bottom bar is absolutely positioned, reserve its full height and bottom inset in the outer workspace. Keep chat transcripts as shrinkable flex content; large inner transcript padding is not a substitute for layout clearance and can make the transcript collide with the composer at short viewport heights.

**Why:** The Main chat overlap only appeared after reducing the viewport, where the fixed navigation still covered the workspace. Reserving space at the workspace boundary kept both the composer and transcript visible.

**How to apply:** For routes sharing a fixed bottom bar, calculate workspace clearance from the bar dimensions and safe-area inset. Verify chat layout around a 400px-wide, 550px-tall viewport.
