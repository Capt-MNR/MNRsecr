---
name: Intent evaluation baseline constraints
description: Durable rules for comparing live before/after NLU evaluation runs safely and honestly.
---

Live provider baselines must use the same provider mode, dataset, tenant fixtures, and context setup on both sides. Full sequential runs can be dominated by provider rate limits, so provider-error cases must be excluded from accuracy and reported separately; use bounded batches or a stable failover mode instead of presenting a partial run as a quality baseline.

**Why:** A full Groq run hit rate limits in the middle of the dataset, producing a misleading 100% intent score from only the surviving cases.

**How to apply:** Keep the raw report, label provider failures explicitly, and only compare before/after summaries when evaluated-case coverage is acceptable and equivalent.

Dry-run no-write validation must treat approval as safe, identify writes only for known write tools, and compare tenant-scoped row counts before and after each case. Read-tool result logs may omit the `dryRun` field.

**Why:** The old harness interpreted ordinary read results as writes and counted approval-required paths as violations.

**How to apply:** Use row-count snapshots plus write-tool result classification; never infer a write from approval reaching alone.