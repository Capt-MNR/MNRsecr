---
name: Fixed mockup composer layering
description: How mobile mockup composers should stay visible above draggable sheets and bottom navigation.
---

Fixed mobile composers should be mounted at the screen-level layout, not inside a translucent chat card that creates its own stacking context. Give the composer a safe-area-aware bottom offset above bottom navigation, and reserve equivalent message padding so the last message remains readable.

**Why:** A fixed child can still render behind a sibling sheet when its ancestor has effects such as backdrop blur or other stacking-context behavior. Changing only the child z-index does not reliably solve that overlap.

**How to apply:** When a mockup has a draggable sheet plus a persistent composer, keep the composer as a sibling of the chat card, use a z-index above the sheet, and verify at a phone viewport with the sheet partially open.