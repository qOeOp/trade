# research/rd-supervisor

## Type

atomic orchestration module

## Owns

- Autonomous R&D supervisor loop.
- `plan_next -> loop/campaign -> state writeback` orchestration.
- Draft strategy policy creation after a validated candidate.

## Inputs

- `--state` path for durable R&D memory.
- `--supervisor-job` J04 entrypoint for native domain-runtime job execution.
- JSON supervisor payload, including optional `max_iterations`, `now`, and `strategy_root`.
- Optional J04 goal payload used to initialize missing durable R&D memory.
- Optional catalog DB path.

## Outputs

- `rd-supervisor-run-result`.
- Native `domain-runtime.domain-job-result.v1` for J04 `rd_strategy_supervisor`, with `research_state_store` and `artifact_catalog` as the only logical write surfaces.
- Research artifacts and optional draft strategy markdown.
- Explicit RD state writeback through the RD program state boundary.

## Boundaries

- May call research loop/campaign execution and RD state commands.
- May write only research artifacts, catalog refs, RD state, and draft strategy policy files.
- Does not write `trade.db`, call exchange APIs, review strategy evidence, promote, or execute trades.
- Uses `research-strategy-development/rd-campaign-runner` for campaign orchestration.
- If durable state is missing, initializes supervised R&D memory itself; control tower must not bypass J04 owner by dispatching `rd-program-state` as the J04 job.
