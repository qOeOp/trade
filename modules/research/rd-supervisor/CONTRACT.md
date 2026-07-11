# research/rd-supervisor

## Type

atomic orchestration module

## Owns

- Autonomous R&D supervisor loop.
- `plan_next -> loop/campaign -> state writeback` orchestration.
- Draft strategy policy creation after a validated candidate.

## Inputs

- `--state` path for durable R&D memory.
- JSON supervisor payload, including optional `max_iterations`, `now`, and `strategy_root`.
- Optional catalog DB path.

## Outputs

- `rd-supervisor-run-result`.
- Research artifacts and optional draft strategy markdown.
- Explicit RD state writeback through the RD program state boundary.

## Boundaries

- May call research loop/campaign execution and RD state commands.
- May write only research artifacts, catalog refs, RD state, and draft strategy policy files.
- Does not write `trade.db`, call exchange APIs, review strategy evidence, promote, or execute trades.
- Remaining direct dependency on `strategy-rd` loop/campaign is transitional until `rd-loop-runner` and `rd-campaign-runner` are split.
