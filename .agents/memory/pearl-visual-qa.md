---
name: Pearl visual QA
description: Visual porting rules for the approved Pearl secretary reference and the real Main data boundary.
---

The approved Pearl implementation is the visual blueprint. Validate the complete rendered screen side-by-side at 402×874 and 375×720; do not infer fidelity from matching component names or styles.

**Why:** The Pearl reference is populated with demo conversation and approval content, while Main can legitimately render a real empty conversation. Copying Pearl content would violate the real-data boundary, but treating an empty Main screenshot as visually equivalent would also be false.

**How to apply:** Match geometry, layering, spacing, and visual density using native equivalents. Keep Pearl demo messages and business state out of Main. If Main has no real messages, report that populated visual comparison remains unverified rather than declaring 1:1 fidelity.