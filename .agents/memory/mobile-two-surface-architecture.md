---
name: Mobile two-surface architecture
description: The mobile app opens on a lightweight quick surface and contains a progressive secretary office.
---

The mobile app should stay as one product with two directly switchable surfaces: a lightweight Quick conversation that opens by default, and a Main Office that opens on a newest-first feed of real saved records. Keep pending approvals pinned above that scrolling feed and open the existing conversation only when the user chooses to review one. Selecting an original conversation from a record must open that conversation even when Main Office has just remounted. The full records browser is a separate destination from the office; the web app remains the broader desktop workspace.

**Why:** The user approved a focused Quick conversation and a feed-first Main surface. The feed should not become another always-visible chat, but intentional conversation navigation—especially provenance from a record—must not be lost when the record route replaces Main Office.

**How to apply:** Default to Quick and keep a one-tap Main entry. Build the feed only from real records and available dates; do not fabricate activity or expand backend/API scope for this presentation change. Keep approval execution in the existing conversation, preserve a pinned review path, and carry explicit conversation-opening intent across record navigation. Continue using bounded tenant-scoped context and defer full records/financial loading until explicit exploration.