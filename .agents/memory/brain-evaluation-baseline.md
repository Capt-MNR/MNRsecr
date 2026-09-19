---
name: Brain evaluation baseline
description: How the Secretary Brain v1 evaluation distinguishes executable envelope observations from unavailable live subsystems.
---

Ground-truth Brain evaluations must keep deterministic parser/envelope observations separate from provider-failure, persisted-operation, verification-failure, and proactive-scheduler scenarios. A missing isolated fixture or injection seam is reported as blocked or not executable, never converted into a pass/fail result; token counts are N/A when no provider was called.

**Why:** The fixed 30-scenario contract includes safety cases whose expected behavior depends on authoritative state transitions and controlled failures. Running only the envelope boundary cannot establish those outcomes without overstating coverage.

**How to apply:** Preserve the contract unchanged, use fixed clocks and isolated identities, report expected and observed fields side by side, and keep production behavior untouched during baseline runs. For missing planning intervals, require clarification before provider-backed record reads; provider runs can vary by failover and must retain per-round traces and token completeness.