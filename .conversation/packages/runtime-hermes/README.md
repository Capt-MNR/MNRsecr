# Hermes Adapter — Inactive Placeholder

This directory is intentionally inactive in the first implementation phase.

Rules:

- Do not add Hermes to `pyproject.toml` or any runtime dependency list.
- Do not import Hermes modules here or anywhere in the active application.
- Do not launch Hermes from the API, worker, tests, or deployment commands.
- Do not vendor, fork, or copy Hermes source here.
- A future adapter must implement the product-owned `AgentRuntime` contract.
- Product identity, authorization, persistence, memory, scheduling, and audit
  remain outside the adapter.

The active runtime is `packages/agent_runtime/first_party.py`.
