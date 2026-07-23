# research/rd-supervisor

## Type

atomic orchestration module

## Owns

- Autonomous R&D supervisor loop.
- `plan_next -> loop/campaign -> state writeback` orchestration.
- In Control Plane mode, Replay execution is wrapped by predeclared Trial reservation/completion and append-only Result publication.
- `--evaluation-job` consumes one immutable Experiment Evaluation Work Package, executes or recovers its deterministic compatibility candidate-batch artifact, then atomically completes the already-reserved Trials and publishes one classified Result.
- Derives an aggregate evidence fingerprint from nested Replay provenance and artifact content when a legacy runner does not return a top-level fingerprint.
- Publishes Result and finalizes its Trials in one Control Plane transaction; publication failure cannot leave completed Trials without a Result.
- Legacy Draft policy creation only when a migration caller explicitly sets `legacy_draft_materialization=true`; the canonical path is Reviewer `accept_for_draft` -> `research-control-plane/strategy-registry`.

## Inputs

- `--db` research state DB path and `--program-id` for durable R&D memory.
- `--supervisor-job` J04 entrypoint for native domain-runtime job execution.
- `--evaluation-job` owner entrypoint for an exact package id/hash, environment/database identity, artifact/catalog paths and completion time.
- JSON supervisor payload, including optional `max_iterations`, `now`, and `strategy_root`.
- Native J04 defaults `control_plane_required=true`; migration callers must explicitly set `false` to run a legacy hypothesis without registered Experiment/Trial facts.
- Optional J04 goal payload used to initialize missing durable R&D memory.
- Optional catalog DB path.

## Outputs

- `rd-supervisor-run-result`.
- `trade.rd-compatibility-evaluation-run-result.v1`, including whether a pre-existing exact artifact was recovered after an interrupted publication.
- Native `domain-runtime.domain-job-result.v1` for J04 `rd_strategy_supervisor`, with `research_state_store` and `artifact_catalog` as the only logical write surfaces.
- Research artifacts; legacy callers may explicitly request the deprecated draft renderer during migration.
- Explicit RD state writeback through the RD program state boundary.

## Boundaries

- May call research loop/campaign execution and RD state commands.
- A `control_plane` hypothesis executes once per Result idempotency key, suppresses legacy program writeback, and stops awaiting an independent Research Reviewer decision.
- Compatibility evaluation is deterministic scheduler/owner work, not an Agent tool: MCP roles may submit semantic Draft/Review artifacts but cannot mint a Work Package or invoke this execution boundary.
- Compatibility evidence is deliberately weaker than formal Replay evidence and cannot authorize a positive Reviewer promotion.
- May write only research artifacts, catalog refs, and RD state by default; direct draft files are a deprecated explicit compatibility mode.
- Does not write `trade.db`, call exchange APIs, review strategy evidence, promote, or execute trades.
- Uses `research-strategy-development/rd-campaign-runner` for campaign orchestration.
- Uses `research-strategy-development/strategy-policy-writer` for deterministic `strategies/*.md` policy rendering and shape lint.
- If durable state is missing, initializes supervised R&D memory itself; control tower must not bypass J04 owner by dispatching `rd-program-state` as the J04 job.
