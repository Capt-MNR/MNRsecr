---
name: Main approved UI constraints
description: Main must follow the approved office mockup and keep visible controls tied to real existing interactions.
---

The Main Home screen is an approved visual specification, not a prompt for a new dashboard concept. Preserve its composition: greeting and summary, central Secretary Chat, Today and Quick Actions, Recent Activity, and bottom navigation. Visible icons must sit inside real actions; remove decorative-only symbols rather than inventing handlers. Main may use a mockup-matched palette derived from the shared light/dark preference without changing Quick.

**Why:** Visual drift and decorative controls make the mobile product look like a different app and imply functionality that the current runtime does not provide.

**How to apply:** Before changing Main, compare the rendered screen with the approved mockup, reuse existing navigation/API flows, and keep Quick, Secretary Runtime, Memory, and approval architecture untouched.