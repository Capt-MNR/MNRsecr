---
name: Expo Quick separation limits
description: The mobile Quick/Main boundary is real at module evaluation and query initialization, but current Metro still ships one native launch bundle.
---

Quick and Main can be kept in separate feature modules with Main dynamically evaluated only after entering the office, while shared chat/provenance renderers stay in a Quick-safe module. The current Expo build uses one launch bundle per platform with no independently downloadable native chunks.

**Why:** Metro successfully builds the deferred import and the Quick preview avoids Main API imports, but bundle output still contains both surfaces and the environment exposes no reliable device RAM metric.

**How to apply:** Report separated imports, deferred Main evaluation, unmounted Main trees, and avoided Main queries as architectural evidence; never convert them into a RAM percentage or claim native code splitting without a measured build/runtime change.