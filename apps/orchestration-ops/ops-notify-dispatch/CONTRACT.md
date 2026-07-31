# Ops Notify Dispatch Contract

Owns control tower `post_job / post_cycle` notification dispatch and takeover prompts.

`ops_notify_dispatch` is a lifecycle processor, not a domain job ticket.

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
