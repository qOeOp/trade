---
name: run-trade-research
description: Run or continue bounded strategy R&D in the trade repository through the trade-agent MCP workflow. Use when Codex must inspect an RD program, design the next structured hypothesis, validate and queue it, run J04 asynchronously, follow status/results, or explain a blocked/no-promote research outcome. Trigger for requests such as run R&D, continue research, design the next hypothesis, run J04, 跑一次策略研发, or 继续研发策略.
---

# Run Trade Research

Use the Agent for hypothesis synthesis, project code/docs for source inspection, and `trade-agent` MCP for bounded owner operations. Keep MCP as an adapter; never replace research owners or gates.

## Preconditions

1. Confirm the `trade-agent` MCP server exposes:
   - `research_hypothesis_brief`
   - `research_hypothesis_prepare`
   - `research_job_submit`
   - `research_job_status`
   - `research_job_result`
   - `rd_program_read`
   - `artifact_catalog_query` and `artifact_read`
2. If the server is unavailable, tell the user to open a new task or restart Codex so `.codex/config.toml` reloads. Do not replace the missing MCP surface with arbitrary command execution.
3. Default `program_id` to `rd-program` only when the user did not name another program.

## Workflow

### 1. Read the program brief

Call `research_hypothesis_brief` with `program_id`. Treat its program memory and Control Plane context as authoritative.

- If `planning.status=ready`, run the existing ready queue through `research_job_submit` without inventing another hypothesis.
- If the program is paused, budget-exhausted, or has found a shadow candidate, stop and report that terminal boundary. Do not reactivate it.
- If the program is blocked or has no ready hypothesis, inspect `queue_seed_recommendation.required_action` and the latest failure.
- If the program does not exist, require the user's explicit objective and inspect `docs/research/strategy/rd-strategy-universe-design.md` plus `docs/research/strategy/strategy-universe-family-backlog.json` before designing a new program contract.

Do not open a locked holdout while gathering context.

### 2. Route non-trial prerequisites

Do not force every recommendation into J04.

- `strategy_trial`: continue to hypothesis design.
- `universe_gate_run`: run or request the owner universe/marketability gate first.
- `panel_research`: run or request the panel evaluator first.
- `family_design`: create the missing family contract/implementation before trials.
- `data_governance`: acquire or repair the required point-in-time data surface before trials.
- Unknown or missing capability: report the exact blocker and spend zero trials.

Never change a path, family, mode, or `ready` flag merely to bypass a blocked projection.

### 3. Design one contract

Use the `prompt` and structured `context` returned by the brief. Produce exactly one JSON object with schema `trade-flow.strategy-hypothesis-contract.v1`.

Preserve these disciplines:

- Start from a market mechanism, not parameter search.
- Make universe selection, filters, entry, exit, holding, cost, funding, and risk geometry part of the predeclared hypothesis.
- Name falsification conditions and mechanism-specific negative controls.
- Bind only real family, manifest, feature, and validation refs observed in the repository.
- Treat a repair to a rejected mechanism as a new hypothesis.
- Keep locked holdout use at zero unless the user explicitly authorizes frozen post-selection validation.

Keep the contract in memory unless the user explicitly asks for a durable draft.

### 4. Prepare before writing

Call `research_hypothesis_prepare` with the contract.

- On `valid=false`, revise only the reported contract defects and prepare again.
- On `ready=false`, stop submission and route the exact `blocked_reason` to the corresponding family, panel, or data owner.
- On `ready=true`, use the same unchanged contract for submission.
- Review warnings; never silently discard one that changes evidence integrity.

Do not construct or submit a raw queue item.

### 5. Submit idempotently

Call `research_job_submit` with:

- one stable `request_id`, reused for every retry in the same logical run;
- `program_id`;
- the authoritative objective;
- an explicit bounded budget for a new program;
- the prepared, unchanged `hypothesis_contract` when seeding or extending a program.

Default a new program to `max_locked_holdout_uses=0`. Let the MCP host request write approval; do not create a second approval ritual. Never set or request live exchange writes.

### 6. Follow the asynchronous job

Poll `research_job_status` using the same `request_id`. Avoid tight polling.

- `queued` or `running`: continue waiting.
- `completed`, `blocked`, or `failed`: call `research_job_result`.
- Preserve both `status` and `cycle_status`; J04 `blocked` is not the same as worker failure.

Do not resubmit with a new request ID merely because the job is slow.

### 7. Read memory and evidence

After a terminal result:

1. Call `rd_program_read` for the program.
2. Read `latest_failure_summary`, `latest_reliability_gate`, usage, queue, lessons, rejected mechanisms, and artifact refs.
3. Resolve relevant evidence through `artifact_catalog_query`; use `artifact_read` only for an exact cataloged text artifact.
4. State the research outcome precisely:
   - `no_promote`, reject, or blocker is a completed research run, not a discovered strategy.
   - A candidate is not shadow/live authority without the existing review and promotion gates.

## Hard boundaries

- Do not call Binance write tools or write `trade.db`.
- Do not promote, publish, or edit a strategy policy from research output alone.
- Do not bypass designer validation, Control Plane scope, data splits, negative controls, or locked-holdout rules.
- Do not claim success from process completion; judge the gate, artifacts, and durable RD state.
- Keep temporary run data under ignored `tmp/` or `data/`; do not turn one run into permanent memory or policy.
