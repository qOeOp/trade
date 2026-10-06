# Quickstart

This is the research operating sequence and end-to-end acceptance target. The [delivery roadmap](../architecture/) starts with V0.1 R-1 data/authoring/replay and extends sustained iteration in V0.2; the full research loop is not a first-release prerequisite. Check [current capabilities](./agent-implementation/)
and deployment first. Stop at a named unavailable step; the sequence assumes no target has shipped and requires no
Paper or Live session.

## 1. Register research bounds

Through R&D tools, the external agent submits sources, theme, risk tolerance, comparisons, spend cap and stops.
Read admission receipts and frozen identities, not transport delivery. Iterate inside the bounds; changed passing
criteria or scope require new confirmation.

## 2. Prepare PIT data

Use Market Data MCP to inspect instruments/coverage, submit bounded backfill and retain job identity. The service
runs the job; the agent queries status. Gaps and protected partitions refuse by name. `dataset_ref` describes market
and window; the backend resolves exact custody. The agent does not transport bar rows.

## 3. Author and seal

Submit JSON `research.strategy-authoring.v1`, validate signal/protection rules, bounded sizing and approved execution-policy references, then read the
immutable Artifact. R&D defines the current subset; a target description does not implement full R-1 orders/exits.

## 4. Run and read results

Submit through Backtest MCP. The backend owns the deterministic chain and returns stable job/run identities;
query the same identity after reconnecting. Reports bind inputs, models, native orders/fills and portfolio
statistics. Operational completion with an unknown business result remains unresolved, never a blind rerun.

## 5. Decide the next action

Compare preregistered portfolio return, drawdown and baselines. R&D records repair, successor, stop or selection,
retaining failures and spend. Only a selected frozen candidate proceeds to Qualification. Protected feedback cannot
optimize the strategy; qualification authorizes no trading.

## Completion

The agent recovers sources, Artifact, data, run and decision by original identities; the user can inspect facts and
named failures. Verify each step's integration and admission against the implementation guide and owning chapter; logs/charts cannot
substitute for results. [Research design](../scenarios/research/) defines full R-1 acceptance.
