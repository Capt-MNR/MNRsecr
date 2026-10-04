---
name: Brain evaluation baseline
description: How the Secretary Brain v1 evaluation distinguishes executable envelope observations from unavailable live subsystems.
---

Ground-truth Brain evaluations must keep deterministic parser/envelope observations separate from provider-failure, persisted-operation, verification-failure, and proactive-scheduler scenarios. A missing isolated fixture or injection seam is reported as blocked or not executable, never converted into a pass/fail result; token counts are N/A when no provider was called.

**Why:** The fixed 30-scenario contract includes safety cases whose expected behavior depends on authoritative state transitions and controlled failures. In planning runs, a provider may contradict retrieved schedule records or request an unrelated read even when retrieval is correct, so retrieval alone does not establish a grounded answer.

**How to apply:** Preserve the contract unchanged, use fixed clocks and isolated identities, report expected and observed fields side by side, and keep production behavior untouched during baseline runs. For missing planning intervals, require clarification before provider-backed record reads. For dated planning, constrain tool access to the planning response path and ground the final answer in the exact tenant-scoped records; report provider failures as `NOT_MEASURED` and retain per-round traces and token completeness.