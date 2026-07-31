# research.rd-campaign-runner

## Responsibility

Run one bounded R&D campaign from a hypothesis queue. The module owns campaign-level gates, discovery-to-locked-validation orchestration, campaign artifact writeback, catalog registration, and optional RD program-state writeback.

## Inputs

- JSON payload matching `StrategyRndCampaignInput`
- Discovery and validation manifests for every runnable hypothesis
- Optional calibration report
- Optional panel negative-control report
- Optional explicit `rd_program_ref` plus `rd_state_db` for durable research-state writeback
- Optional deployment `environment_id`, propagated unchanged to every child loop and Catalog write

## Outputs

- `strategy-rnd-campaign-result.schema.json`
- Campaign artifact JSON
- Catalog artifact row
- Optional RD program-state update

## Boundaries

- Calls `research.rd-loop-runner` logic for each discovery or validation loop.
- Uses `candidate-batch-engine` only to count candidate budget.
- Does not generate candidate families itself.
- Does not write `trade.db`.
- Does not call exchange APIs.
- Does not promote or draft strategies.
- Does not own long-running supervisor policy.

## Current Notes

- Uses `research-strategy-development/rd-ledger` for ledger and holdout idempotence helpers.
