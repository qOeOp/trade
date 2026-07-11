# Ops Notify Dispatch Contract

Owns J09 `ops_notify_dispatch` for orchestration notifications and takeover prompts.

## Responsibilities

- Convert cycle summaries, health status, or blocked job refs into notification attempts.
- Persist every attempt through `ops-runtime-store`.
- Support deterministic dry-run and local stdout dispatch.
- Return notification refs for supervisor summaries.

## Boundaries

- Does not decide trade, research, or review outcomes.
- Does not mutate trading truth.
- Does not call exchange APIs.
- Does not own channel credentials; external channel adapters must remain explicit and optional.

