---
name: Quick initial layout
description: Layout constraint for the Quick surface before a conversation has user messages.
---

Render Quick's intro state in a normal list and switch to an inverted list only after the conversation has multiple messages.

**Why:** On short Expo Web viewports, an inverted list with the intro as a footer can place that footer under the header; moving the list with transforms can also reverse its content.

**How to apply:** Keep the welcome card and starter suggestions in a normal `ListHeaderComponent` for the fresh state. Use the existing inverted message ordering once the user sends or loads a real conversation.